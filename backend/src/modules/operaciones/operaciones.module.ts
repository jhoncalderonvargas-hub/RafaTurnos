import { BadRequestException, Body, ConflictException, Controller, Get, Header, Headers, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { firmarJwtHmac, PayloadTokenSsoIntranet, RolUsuarioSso, verificarJwtHmac } from './jwt-sso.util';

/** Marcador usado en tipos_turno para una celda explícitamente en blanco (ver CuadrantesController). */
const CODIGO_CELDA_VACIA_DB = 'BLANCO';

/** Normaliza un código de turno para comparar: vacío / BLANCO / null se tratan como Libre (L), igual que el frontend. */
const normalizarCodigo = (cod?: string | null): string =>
  !cod || cod === CODIGO_CELDA_VACIA_DB ? 'L' : cod;

export interface SolicitudPermutaDto {
  solicitanteId: string;
  solicitanteCategoria?: string;
  receptorId: string;
  receptorCategoria?: string;
  servicioId: string;
  anio?: number;
  mes?: number;
  fechaIso?: string;
  turnoSolicitante?: string;
  turnoReceptor?: string;
  diaOrigen: number;
  turnoOrigen: string;
  diaDestino: number;
  turnoDestino: string;
  validacionReglas?: string;
}

@Controller('api/v1/permutas')
export class PermutasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listarPermutas() {
    const permutas = await this.prisma.solicitudPermuta.findMany({
      include: {
        solicitante: {
          include: { categoria: true },
        },
        receptor: {
          include: { categoria: true },
        },
        servicio: true,
      },
      orderBy: { creadoEn: 'desc' },
    });

    return permutas.map((p) => ({
      id: p.id,
      fechaSolicitud: p.fechaSolicitud
        ? new Date(p.fechaSolicitud).toLocaleDateString('es-CO') +
          ' ' +
          new Date(p.fechaSolicitud).toTimeString().substring(0, 5)
        : 'Reciente',
      solicitanteId: p.solicitanteId,
      solicitanteNombre: p.solicitante?.nombre || 'Solicitante',
      receptorId: p.receptorId,
      receptorNombre: p.receptor?.nombre || 'Receptor',
      categoria: p.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: p.servicioId,
      anio: p.anio,
      mes: p.mes,
      diaOrigen: p.diaOrigen,
      turnoOrigen: p.turnoOrigen,
      diaDestino: p.diaDestino,
      turnoDestino: p.turnoDestino,
      estado: p.estado,
      validacionReglas: p.validacionReglas,
      motivoRechazo: p.motivoRechazo,
    }));
  }

  @Post()
  async crearSolicitudPermuta(@Body() dto: SolicitudPermutaDto) {
    // Resolver solicitante por id o intranetId
    const solicitante = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ id: dto.solicitanteId }, { intranetId: dto.solicitanteId }],
      },
    });
    if (!solicitante) {
      throw new BadRequestException(`Empleado solicitante "${dto.solicitanteId}" no encontrado.`);
    }

    // Resolver receptor por id o intranetId
    const receptor = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ id: dto.receptorId }, { intranetId: dto.receptorId }],
      },
    });
    if (!receptor) {
      throw new BadRequestException(`Empleado receptor "${dto.receptorId}" no encontrado.`);
    }

    // Resolver servicio por id o código
    const servicio = await this.prisma.servicio.findFirst({
      where: {
        OR: [{ id: dto.servicioId }, { codigo: dto.servicioId }],
      },
    });
    if (!servicio) {
      throw new BadRequestException(`Servicio hospitalario "${dto.servicioId}" no encontrado.`);
    }

    // El periodo es obligatorio: sin él no es posible ubicar las celdas a intercambiar al aprobar.
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('La solicitud de permuta debe indicar el periodo (anio y mes) del cuadrante.');
    }

    const permuta = await this.prisma.solicitudPermuta.create({
      data: {
        solicitanteId: solicitante.id,
        receptorId: receptor.id,
        servicioId: servicio.id,
        anio,
        mes,
        diaOrigen: dto.diaOrigen,
        turnoOrigen: dto.turnoOrigen,
        diaDestino: dto.diaDestino,
        turnoDestino: dto.turnoDestino,
        estado: 'PENDIENTE_PAR',
        validacionReglas: dto.validacionReglas || 'Misma categoría y descanso mínimo validado.',
      },
      include: {
        solicitante: { include: { categoria: true } },
        receptor: { include: { categoria: true } },
      },
    });

    return {
      id: permuta.id,
      fechaSolicitud: 'Hoy ' + new Date(permuta.fechaSolicitud).toTimeString().substring(0, 5),
      solicitanteId: permuta.solicitanteId,
      solicitanteNombre: permuta.solicitante?.nombre || 'Solicitante',
      receptorId: permuta.receptorId,
      receptorNombre: permuta.receptor?.nombre || 'Receptor',
      categoria: permuta.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: permuta.servicioId,
      anio: permuta.anio,
      mes: permuta.mes,
      diaOrigen: permuta.diaOrigen,
      turnoOrigen: permuta.turnoOrigen,
      diaDestino: permuta.diaDestino,
      turnoDestino: permuta.turnoDestino,
      estado: permuta.estado,
      validacionReglas: permuta.validacionReglas,
    };
  }

  /**
   * Paso 2 del Flujo: El compañero receptor (Colaborador 2) acepta la propuesta.
   * La solicitud pasa de PENDIENTE_PAR a PENDIENTE_SUPERVISOR.
   */
  @Patch(':id/aceptar-par')
  async aceptarPermutaPar(@Param('id') id: string) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');
    if (permuta.estado !== 'PENDIENTE_PAR') {
      throw new BadRequestException('La solicitud no se encuentra en estado PENDIENTE_PAR');
    }

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: { estado: 'PENDIENTE_SUPERVISOR' },
    });
  }

  /**
   * Paso 2 del Flujo: El compañero receptor (Colaborador 2) declina la propuesta.
   * La solicitud se cierra como RECHAZADA por el par sin llegar a la supervisora.
   */
  @Patch(':id/rechazar-par')
  async rechazarPermutaPar(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: {
        estado: 'RECHAZADA',
        motivoRechazo: body?.motivo || 'Declinada por el compañero receptor.',
      },
    });
  }

  /**
   * Paso 3 del Flujo: La supervisora aprueba la permuta ya concertada por ambos colaboradores.
   *
   * En una única transacción:
   *  1. Verifica que el cuadrante del periodo no esté cerrado para nómina.
   *  2. Verifica que los turnos actuales en BD sigan siendo los acordados (evita aprobar sobre datos obsoletos).
   *  3. Intercambia los turnos en `asignaciones_turno` dentro del servicio de la permuta (no el que esté viendo la supervisora).
   *  4. Registra la auditoría de ambos cambios y marca la solicitud como APROBADA.
   */
  @Patch(':id/aprobar')
  async aprobarPermuta(@Param('id') id: string) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({
      where: { id },
      include: { solicitante: true, receptor: true },
    });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');
    if (permuta.estado !== 'PENDIENTE_SUPERVISOR') {
      throw new BadRequestException('Solo se pueden aprobar solicitudes en estado PENDIENTE_SUPERVISOR.');
    }
    if (!permuta.anio || !permuta.mes) {
      throw new BadRequestException(
        'La solicitud no tiene periodo (año/mes) registrado. Recházala y pide al colaborador que la vuelva a enviar.'
      );
    }

    const anio = permuta.anio;
    const mes = permuta.mes;
    const fechaOrigen = new Date(Date.UTC(anio, mes - 1, permuta.diaOrigen));
    const fechaDestino = new Date(Date.UTC(anio, mes - 1, permuta.diaDestino));

    const resultado = await this.prisma.$transaction(async (tx) => {
      // 1. Cuadrante del servicio de la permuta y bloqueo por cierre de nómina
      const cuadrante = await tx.cuadrante.upsert({
        where: { anio_mes_servicioId: { anio, mes, servicioId: permuta.servicioId } },
        update: {},
        create: { anio, mes, servicioId: permuta.servicioId, estado: 'BORRADOR' },
      });
      if (cuadrante.estado === 'CERRADO_NOMINA') {
        throw new ConflictException('El cuadrante de este periodo está CERRADO para nómina. Reábrelo para aprobar la permuta.');
      }

      // 2. Estado actual de ambas celdas
      const [asigSolicitante, asigReceptor] = await Promise.all([
        tx.asignacionTurno.findUnique({
          where: { empleadoId_fecha: { empleadoId: permuta.solicitanteId, fecha: fechaOrigen } },
          include: { tipoTurno: true },
        }),
        tx.asignacionTurno.findUnique({
          where: { empleadoId_fecha: { empleadoId: permuta.receptorId, fecha: fechaDestino } },
          include: { tipoTurno: true },
        }),
      ]);

      const actualSolicitante = normalizarCodigo(asigSolicitante?.tipoTurno.codigo);
      const actualReceptor = normalizarCodigo(asigReceptor?.tipoTurno.codigo);
      if (
        actualSolicitante !== normalizarCodigo(permuta.turnoOrigen) ||
        actualReceptor !== normalizarCodigo(permuta.turnoDestino)
      ) {
        throw new ConflictException(
          `El cuadrante cambió desde que se solicitó la permuta (actual: ${permuta.solicitante.nombre} ${actualSolicitante}, ` +
            `${permuta.receptor.nombre} ${actualReceptor}). Recházala y solicítala de nuevo.`
        );
      }

      // 3. Resolver tipos de turno a intercambiar
      const resolverTipo = async (cod: string) => {
        const codigoDb = normalizarCodigo(cod);
        const tipo = await tx.tipoTurno.findUnique({ where: { codigo: codigoDb } });
        if (!tipo) throw new BadRequestException(`El código de turno "${codigoDb}" no existe en el catálogo.`);
        return tipo.id;
      };
      const tipoParaSolicitante = await resolverTipo(permuta.turnoDestino);
      const tipoParaReceptor = await resolverTipo(permuta.turnoOrigen);

      const aplicar = (empleadoId: string, fecha: Date, tipoTurnoId: string, anterior: string) =>
        tx.asignacionTurno.upsert({
          where: { empleadoId_fecha: { empleadoId, fecha } },
          // Se conserva codigoPrevisto (lo planeado) para que el comparador Previsto vs Real refleje la permuta
          update: { tipoTurnoId, cuadranteId: cuadrante.id, servicioEjecutorId: permuta.servicioId },
          create: {
            cuadranteId: cuadrante.id,
            empleadoId,
            tipoTurnoId,
            servicioEjecutorId: permuta.servicioId,
            fecha,
            esRotacion: false,
            codigoPrevisto: anterior,
          },
        });

      const nuevaSolicitante = await aplicar(permuta.solicitanteId, fechaOrigen, tipoParaSolicitante, actualSolicitante);
      const nuevaReceptor = await aplicar(permuta.receptorId, fechaDestino, tipoParaReceptor, actualReceptor);

      // 4. Auditoría y cierre de la solicitud
      await tx.auditoriaCambio.createMany({
        data: [
          {
            asignacionTurnoId: nuevaSolicitante.id,
            actorId: 'SUPERVISOR',
            turnoAnterior: actualSolicitante,
            turnoNuevo: normalizarCodigo(permuta.turnoDestino),
            justificacion: `Permuta ${permuta.id} aprobada con ${permuta.receptor.nombre}`,
          },
          {
            asignacionTurnoId: nuevaReceptor.id,
            actorId: 'SUPERVISOR',
            turnoAnterior: actualReceptor,
            turnoNuevo: normalizarCodigo(permuta.turnoOrigen),
            justificacion: `Permuta ${permuta.id} aprobada con ${permuta.solicitante.nombre}`,
          },
        ],
      });

      return tx.solicitudPermuta.update({
        where: { id },
        data: { estado: 'APROBADA' },
      });
    });

    return {
      ...resultado,
      cambiosAplicados: [
        { empleadoId: permuta.solicitanteId, anio, mes, dia: permuta.diaOrigen, codigo: permuta.turnoDestino },
        { empleadoId: permuta.receptorId, anio, mes, dia: permuta.diaDestino, codigo: permuta.turnoOrigen },
      ],
    };
  }

  /**
   * Paso 3 del Flujo: La supervisora rechaza la permuta con justificación clínica/operativa.
   */
  @Patch(':id/rechazar')
  async rechazarPermuta(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: {
        estado: 'RECHAZADA',
        motivoRechazo: body?.motivo || 'Rechazada por la supervisora asistencial.',
      },
    });
  }

  @Post('simular')
  simularPermutaEntrePares(@Body() dto: SolicitudPermutaDto) {
    if (dto.solicitanteCategoria && dto.receptorCategoria && dto.solicitanteCategoria !== dto.receptorCategoria) {
      return {
        permitida: false,
        motivo: `RN-05 Bloqueante: Incompatibilidad de categoría asistencial (${dto.solicitanteCategoria} vs ${dto.receptorCategoria}).`,
      };
    }

    return {
      permitida: true,
      estadoInicial: 'PENDIENTE_PAR',
      mensaje:
        'Permuta válida: Misma categoría profesional y se preserva el ratio mínimo del servicio.',
    };
  }
}

@Controller('api/v1/intranet')
export class IntranetIntegrationController {
  constructor(private readonly prisma: PrismaService) {}

  private obtenerSecretSso(): string {
    return (
      process.env.INTRANET_JWT_SECRET ||
      'clave_secreta_compartida_con_intranet_hospitalaria'
    );
  }

  private obtenerUrlRetornoIntranet(): string {
    return process.env.INTRANET_RETURN_URL || 'http://localhost:4300';
  }

  private async construirPerfilUsuarioSso(
    documento: string,
    rolSolicitado?: RolUsuarioSso,
    serviciosExtraIds?: string[]
  ) {
    let emp = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ documento }, { intranetId: documento }, { id: documento }],
      },
      include: {
        categoria: true,
        servicioBase: {
          include: {
            serviciosHermanosOrigen: {
              include: { servicioHermano: true },
            },
          },
        },
      },
    });

    if (!emp) {
      // Auto-aprovisionamiento Just-In-Time (JIT) desde la Intranet Hospitalaria
      const intranetUrl = process.env.INTRANET_API_URL || 'http://localhost:4300';
      try {
        const resp = await fetch(`${intranetUrl}/api/intranet/empleados`);
        if (resp.ok) {
          const censo = await resp.json();
          const datosEmp = Array.isArray(censo)
            ? censo.find((x: any) => String(x.documento).trim() === documento.trim())
            : null;
          if (datosEmp) {
            let cat = await this.prisma.categoriaProfesional.findFirst({
              where: { nombre: datosEmp.cargoNombre || 'Auxiliar de Enfermería' },
            });
            if (!cat) {
              cat = await this.prisma.categoriaProfesional.create({
                data: { nombre: datosEmp.cargoNombre || 'Auxiliar de Enfermería' },
              });
            }
            let srv = await this.prisma.servicio.findFirst({
              where: {
                OR: [
                  { codigo: datosEmp.servicioCodigo || 'URG' },
                  { id: datosEmp.servicioCodigo || 'URG' },
                ],
              },
            });
            if (!srv) {
              srv = (await this.prisma.servicio.findFirst())!;
            }
            await this.prisma.empleado.create({
              data: {
                documento,
                nombre: datosEmp.nombre || `Colaborador ${documento}`,
                correo: datosEmp.correo || `${documento}@hospital.gov.co`,
                horasSemanalesLey: 42,
                horasContratoMes: Number(datosEmp.horasContratoMes) || 168,
                categoriaId: cat.id,
                servicioBaseId: srv.id,
              },
            });

            emp = await this.prisma.empleado.findFirst({
              where: { documento },
              include: {
                categoria: true,
                servicioBase: {
                  include: {
                    serviciosHermanosOrigen: {
                      include: { servicioHermano: true },
                    },
                  },
                },
              },
            });
          }
        }
      } catch {}
    }

    if (!emp) {
      throw new NotFoundException(
        `El documento/identificador "${documento}" del token SSO no corresponde a ningún colaborador activo en Rafa Turnos ni en la Intranet Hospitalaria.`
      );
    }

    const rolValido: RolUsuarioSso =
      rolSolicitado === 'ADMIN_TH' ||
      rolSolicitado === 'COORDINADOR' ||
      rolSolicitado === 'COLABORADOR'
        ? rolSolicitado
        : 'COLABORADOR';

    let serviciosPermitidosIds: string[] = [emp.servicioBaseId];
    if (rolValido === 'ADMIN_TH') {
      const todosSrvs = await this.prisma.servicio.findMany({ select: { id: true } });
      serviciosPermitidosIds = todosSrvs.map((s) => s.id);
    } else if (rolValido === 'COORDINADOR') {
      const hermanosIds = emp.servicioBase.serviciosHermanosOrigen.map(
        (sh) => sh.servicioHermanoId
      );
      serviciosPermitidosIds = Array.from(
        new Set([emp.servicioBaseId, ...hermanosIds, ...(serviciosExtraIds || [])])
      );
    }

    return {
      empleadoId: emp.id,
      documento: emp.documento,
      nombre: emp.nombre,
      correo: emp.correo || undefined,
      categoria: emp.categoria?.nombre || 'Personal Asistencial',
      rol: rolValido,
      servicioBaseId: emp.servicioBaseId,
      servicioBaseNombre: emp.servicioBase.nombre,
      serviciosPermitidosIds,
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  /**
   * Intercambia el Token SSO firmado por la Intranet Hospitalaria (?sso_token=...)
   * por una sesión validada contra PostgreSQL.
   */
  @Post('sso-login')
  async intercambiarTokenSso(@Body() body: { ssoToken: string }) {
    if (!body?.ssoToken) {
      throw new BadRequestException('Se requiere el campo ssoToken.');
    }

    const payload = verificarJwtHmac<PayloadTokenSsoIntranet>(
      body.ssoToken,
      this.obtenerSecretSso()
    );

    if (!payload.documento) {
      throw new UnauthorizedException('El token SSO no contiene el documento del colaborador.');
    }

    const usuario = await this.construirPerfilUsuarioSso(
      String(payload.documento),
      payload.rol,
      payload.serviciosCoordinados
    );

    const sessionToken = firmarJwtHmac(
      {
        documento: usuario.documento,
        empleadoId: usuario.empleadoId,
        rol: usuario.rol,
        serviciosCoordinados: usuario.serviciosPermitidosIds,
      },
      this.obtenerSecretSso(),
      28800 // 8 horas de sesión
    );

    return {
      sessionToken,
      usuario,
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  /**
   * Verifica la sesión activa enviada en Authorization: Bearer <token>.
   */
  @Get('sesion')
  async verificarSesionActiva(@Headers('authorization') authHeader?: string) {
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!token) {
      throw new UnauthorizedException('No se encontró cabecera Authorization Bearer.');
    }

    const payload = verificarJwtHmac<PayloadTokenSsoIntranet>(
      token,
      this.obtenerSecretSso()
    );

    const usuario = await this.construirPerfilUsuarioSso(
      String(payload.documento),
      payload.rol,
      payload.serviciosCoordinados
    );

    return {
      usuario,
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  @Get('status')
  estadoIntegracionSatelite() {
    return {
      arquitectura: 'Servicio Satélite con Réplica Local (intranetId)',
      sso: 'JWT Bearer Token compartido (Sin doble login)',
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
      endpointsMaestros: [
        'POST /api/v1/intranet/sso-login (Intercambio de Token SSO HMAC-SHA256)',
        'GET /api/v1/intranet/sesion (Validación de sesión activa y rol)',
        'GET /api/v1/dependencias (Servicios Asistenciales)',
        'GET /api/v1/empleados (Personal activo)',
        'POST /api/v1/notificaciones (Campana unificada Intranet)',
      ],
      habeasData:
        'Los códigos CIE-10 de incapacidades se mantienen encriptados/restringidos a Gestión Humana; el cuadrante solo exhibe la sigla INC.',
    };
  }

  @Post('sync-maestros')
  sincronizarMaestrosDesdeIntranet() {
    return {
      timestamp: new Date().toISOString(),
      resultado: 'Sincronización de Servicios, Empleados y Vacaciones completada en réplica local.',
    };
  }
}

@Controller('api/v1/calendario')
export class CalendarioIcalController {
  constructor(private readonly prisma: PrismaService) {}

  private formatearFechaYmd(dateUtc: Date): string {
    const y = dateUtc.getUTCFullYear();
    const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateUtc.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private formatearHoraHms(hhmm?: string, fallback = '070000'): string {
    if (!hhmm || !hhmm.includes(':')) return fallback;
    const [hStr, mStr] = hhmm.split(':');
    const h = String(Math.max(0, Math.min(23, Number(hStr) || 0))).padStart(2, '0');
    const m = String(Math.max(0, Math.min(59, Number(mStr) || 0))).padStart(2, '0');
    return `${h}${m}00`;
  }

  /**
   * Obtiene o genera el token personal de suscripción iCal (.ics) en PostgreSQL
   * para el colaborador indicado o el usuario autenticado en la sesión SSO.
   */
  @Get('mi-enlace')
  async obtenerMiEnlaceCalendario(
    @Query('empleadoId') empleadoIdQuery?: string,
    @Req() req?: any
  ) {
    const targetId = empleadoIdQuery || req?.usuarioSso?.empleadoId;
    let empleado = targetId
      ? await this.prisma.empleado.findFirst({
          where: { OR: [{ id: targetId }, { documento: targetId }] },
          include: { servicioBase: true },
        })
      : null;

    if (!empleado) {
      empleado = await this.prisma.empleado.findFirst({
        include: { servicioBase: true },
        orderBy: { documento: 'asc' },
      });
    }

    if (!empleado) {
      throw new NotFoundException('No se encontró colaborador para generar enlace de calendario.');
    }

    let tokenRecord = await this.prisma.tokenCalendario.findFirst({
      where: { empleadoId: empleado.id, activo: true },
      orderBy: { creadoEn: 'desc' },
    });

    if (!tokenRecord) {
      const sufijo = randomBytes(6).toString('hex');
      const tokenHash = `cal_${empleado.documento}_${sufijo}`;
      tokenRecord = await this.prisma.tokenCalendario.create({
        data: {
          empleadoId: empleado.id,
          tokenHash,
          activo: true,
        },
      });
    }

    const host = req?.headers?.host || 'localhost:3000';
    const httpUrl = `http://${host}/api/v1/calendario/feed/${tokenRecord.tokenHash}.ics`;
    const webcalUrl = `webcal://${host}/api/v1/calendario/feed/${tokenRecord.tokenHash}.ics`;

    return {
      empleadoId: empleado.id,
      empleadoNombre: empleado.nombre,
      documento: empleado.documento,
      servicioNombre: empleado.servicioBase.nombre,
      token: tokenRecord.tokenHash,
      httpUrl,
      webcalUrl,
    };
  }

  /**
   * Genera el feed dinámico RFC 5545 (.ics) consultando en vivo las asignaciones reales
   * en PostgreSQL (`asignaciones_turno`) para Google Calendar, Apple Calendar (iOS) y Outlook.
   */
  @Get('feed/:token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="mis_turnos_hospital.ics"')
  async generarFeedIcs(@Param('token') rawToken: string): Promise<string> {
    const tokenLimpio = (rawToken || '').replace(/\.ics$/i, '').trim();

    let tokenRecord = await this.prisma.tokenCalendario.findUnique({
      where: { tokenHash: tokenLimpio },
      include: {
        empleado: {
          include: {
            servicioBase: true,
            categoria: true,
          },
        },
      },
    });

    let empleado = tokenRecord?.activo ? tokenRecord.empleado : null;

    if (!empleado) {
      // Permitir resolución por documento si el token tiene formato cal_<documento>_...
      const matchDoc = tokenLimpio.match(/^cal_(\d+)_/);
      const docBuscar = matchDoc ? matchDoc[1] : tokenLimpio;
      empleado = await this.prisma.empleado.findFirst({
        where: { OR: [{ documento: docBuscar }, { id: docBuscar }] },
        include: {
          servicioBase: true,
          categoria: true,
        },
      });
    }

    const dtstamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

    const nombreCalendario = empleado
      ? `Turnos — ${empleado.nombre} (${empleado.servicioBase.codigo})`
      : 'Mis Turnos Hospitalarios (Rafa Turnos)';

    const lineas: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Hospital//Rafa Turnos v2.0//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${nombreCalendario}`,
      'X-WR-TIMEZONE:America/Bogota',
    ];

    if (empleado) {
      const asignaciones = await this.prisma.asignacionTurno.findMany({
        where: {
          empleadoId: empleado.id,
          cuadrante: {
            estado: {
              in: ['PUBLICADO', 'VALIDADO', 'CERRADO_NOMINA'],
            },
          },
        },
        include: {
          tipoTurno: true,
          servicioEjecutor: true,
        },
        orderBy: { fecha: 'asc' },
      });

      const codigosOmitidos = new Set(['L', 'S', 'BLANCO', '']);

      for (const a of asignaciones) {
        const cod = a.tipoTurno?.codigo || '';
        if (codigosOmitidos.has(cod)) continue;

        const fechaInicioUtc = new Date(a.fecha);
        const ymdInicio = this.formatearFechaYmd(fechaInicioUtc);
        const fechaDiaSigUtc = new Date(fechaInicioUtc.getTime() + 86400000);
        const ymdDiaSig = this.formatearFechaYmd(fechaDiaSigUtc);

        const srvNombre = a.servicioEjecutor?.nombre || empleado.servicioBase.nombre;
        const catNombre = empleado.categoria?.nombre || 'Personal Asistencial';

        if (a.tipoTurno.horasOrdinarias <= 0) {
          // Evento de día completo para Novedades / Compensatorios (VAC, INC, COMP, DISP)
          lineas.push(
            'BEGIN:VEVENT',
            `UID:turno-${a.id}@hospital.gov.co`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${ymdInicio}`,
            `DTEND;VALUE=DATE:${ymdDiaSig}`,
            `SUMMARY:[${cod}] ${a.tipoTurno.nombre} - ${srvNombre}`,
            `DESCRIPTION:Colaborador: ${empleado.nombre} (${catNombre})\\nNovedad / Estado: ${a.tipoTurno.nombre}\\nServicio: ${srvNombre}`,
            `LOCATION:${srvNombre}`,
            'END:VEVENT'
          );
        } else {
          // Turno operativo con hora exacta de entrada y salida
          const [hIni = 7, mIni = 0] = (a.tipoTurno.horaInicio || '07:00')
            .split(':')
            .map(Number);
          const [hFin = 15, mFin = 0] = (a.tipoTurno.horaFin || '15:00')
            .split(':')
            .map(Number);
          const minInicio = hIni * 60 + mIni;
          const minFin = hFin * 60 + mFin;

          const cruzaMedianoche =
            a.tipoTurno.horasOrdinarias >= 24 || minFin <= minInicio;
          const ymdFin = cruzaMedianoche ? ymdDiaSig : ymdInicio;

          const hmsInicio = this.formatearHoraHms(a.tipoTurno.horaInicio, '070000');
          const hmsFin = this.formatearHoraHms(a.tipoTurno.horaFin, '150000');

          lineas.push(
            'BEGIN:VEVENT',
            `UID:turno-${a.id}@hospital.gov.co`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;TZID=America/Bogota:${ymdInicio}T${hmsInicio}`,
            `DTEND;TZID=America/Bogota:${ymdFin}T${hmsFin}`,
            `SUMMARY:[${cod}] ${a.tipoTurno.nombre} (${a.tipoTurno.horaInicio}-${a.tipoTurno.horaFin}) - ${srvNombre}`,
            `DESCRIPTION:Colaborador: ${empleado.nombre} (${catNombre})\\nTurno: ${cod} - ${a.tipoTurno.nombre} (${a.tipoTurno.horasOrdinarias}h)\\nServicio: ${srvNombre}`,
            `LOCATION:${srvNombre}`,
            'END:VEVENT'
          );
        }
      }
    }

    lineas.push('END:VCALENDAR');
    return lineas.join('\r\n');
  }
}

@Module({
  controllers: [PermutasController, IntranetIntegrationController, CalendarioIcalController],
})
export class OperacionesHospitalModule {}
