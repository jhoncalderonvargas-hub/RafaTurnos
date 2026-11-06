import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { EstadoCuadrante } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';

export interface ValidacionTurnoDto {
  empleadoId: string;
  fechaIso: string;
  turnoPrevioDiaAnterior: string;
  turnoPropuesto: string;
  tieneAusenciaActiva: boolean;
}

export interface ActualizarEstadoCuadranteDto {
  servicioId: string;
  anio: number;
  mes: number;
  estado: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA';
  saldosConsolidados?: {
    empleadoId: string;
    saldoInicial: number;
    horasTrabajadas: number;
    horasContratadas: number;
    horasAmortizadasComp: number;
    diferenciaMes: number;
    saldoFinalAcumulado: number;
  }[];
}

export interface GuardarCeldaCuadranteDto {
  servicioId: string;
  anio: number;
  mes: number;
  dia: number;
  empleadoId: string;
  codigo: string;
  previsto?: string;
  esRotacion?: boolean;
  justificacion?: string;
}

export interface GuardarLoteCuadranteDto {
  servicioId: string;
  anio: number;
  mes: number;
  celdas: {
    empleadoId: string;
    dia: number;
    codigo: string;
    previsto?: string;
    esRotacion?: boolean;
  }[];
}

const CODIGO_CELDA_VACIA_DB = 'BLANCO';

@Injectable()
export class CuadrantesReglasService {
  constructor(private readonly festivosService: FestivosColombiaService) {}

  validarAsignacionCelda(dto: ValidacionTurnoDto): {
    esValido: boolean;
    esFestivoColombia: boolean;
    alertas: string[];
  } {
    const alertas: string[] = [];

    if (dto.tieneAusenciaActiva) {
      alertas.push(
        'RN-03 Bloqueante: El colaborador presenta vacaciones (VAC) o incapacidad médica (INC) activa en la fecha.'
      );
    }

    const codigosDescansoOAusencia = ['L', 'S', 'COMP', 'VAC', 'INC', 'DISP', 'BLANCO', ''];
    const turnosNocturnos = ['N', 'N8', 'N12'];
    if (
      dto.turnoPrevioDiaAnterior === 'G24' &&
      dto.turnoPropuesto &&
      !codigosDescansoOAusencia.includes(dto.turnoPropuesto)
    ) {
      alertas.push(
        `RN-01 Bloqueante: Infracción Post-Guardia 24h. El día previo fue G24, requiere Saliente (S) o Libre (L).`
      );
    } else if (
      turnosNocturnos.includes(dto.turnoPrevioDiaAnterior) &&
      dto.turnoPropuesto &&
      !codigosDescansoOAusencia.includes(dto.turnoPropuesto) &&
      !turnosNocturnos.includes(dto.turnoPropuesto)
    ) {
      alertas.push(
        `RN-02 Bloqueante: Descanso insuficiente (< 12h) tras turno nocturno (${dto.turnoPrevioDiaAnterior} → ${dto.turnoPropuesto}).`
      );
    }

    return {
      esValido: alertas.length === 0,
      esFestivoColombia: this.festivosService.esFestivo(dto.fechaIso),
      alertas,
    };
  }
}

@Controller('api/v1/cuadrantes')
export class CuadrantesController {
  private mapaTiposTurnoCache = new Map<string, string>();

  constructor(
    private readonly reglasService: CuadrantesReglasService,
    private readonly prisma: PrismaService
  ) {}

  private async obtenerMapaTiposTurno(): Promise<Map<string, string>> {
    if (this.mapaTiposTurnoCache.size > 0) {
      return this.mapaTiposTurnoCache;
    }
    const tipos = await this.prisma.tipoTurno.findMany();
    for (const t of tipos) {
      this.mapaTiposTurnoCache.set(t.codigo, t.id);
    }
    // Asegurar que exista el registro marcador para celda explícitamente en blanco
    if (!this.mapaTiposTurnoCache.has(CODIGO_CELDA_VACIA_DB)) {
      const blanco = await this.prisma.tipoTurno.upsert({
        where: { codigo: CODIGO_CELDA_VACIA_DB },
        update: {},
        create: {
          codigo: CODIGO_CELDA_VACIA_DB,
          nombre: 'Celda en Blanco (Sin asignar)',
          horaInicio: '00:00',
          horaFin: '00:00',
          horasOrdinarias: 0,
          horasDiurnas: 0,
          horasNocturnas: 0,
          colorHex: '#FFFFFF',
          descuentaBancoHoras: false,
          esNocturnoPesado: false,
        },
      });
      this.mapaTiposTurnoCache.set(CODIGO_CELDA_VACIA_DB, blanco.id);
    }
    return this.mapaTiposTurnoCache;
  }

  private async resolverTipoTurnoId(codigo: string): Promise<string> {
    const mapa = await this.obtenerMapaTiposTurno();
    const codKey = !codigo ? CODIGO_CELDA_VACIA_DB : codigo;
    const existente = mapa.get(codKey);
    if (existente) return existente;

    const creado = await this.prisma.tipoTurno.upsert({
      where: { codigo: codKey },
      update: {},
      create: {
        codigo: codKey,
        nombre: `Turno ${codKey}`,
        horaInicio: '07:00',
        horaFin: '15:00',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        colorHex: '#E2E8F0',
        descuentaBancoHoras: codKey === 'COMP',
        esNocturnoPesado: ['N', 'N8', 'N12', 'G24'].includes(codKey),
      },
    });
    mapa.set(codKey, creado.id);
    return creado.id;
  }

  /**
   * 1. Carga el estado persistido en PostgreSQL:
   * - Estados de cada cuadrante (servicioId::anio-mes)
   * - Asignaciones de turnos guardadas en asignaciones_turno
   * - Saldos consolidados en banco_horas_saldos
   */
  @Get('estado-global')
  async obtenerEstadoGlobal(@Query('anio') anioStr = '2026') {
    const anio = Number(anioStr) || 2026;

    const [cuadrantes, asignaciones, saldos] = await Promise.all([
      this.prisma.cuadrante.findMany({
        where: {
          OR: [{ anio }, { anio: anio - 1, mes: 12 }],
        },
        select: {
          servicioId: true,
          anio: true,
          mes: true,
          estado: true,
        },
      }),
      this.prisma.asignacionTurno.findMany({
        where: {
          cuadrante: {
            OR: [{ anio }, { anio: anio - 1, mes: 12 }],
          },
        },
        select: {
          empleadoId: true,
          fecha: true,
          esRotacion: true,
          codigoPrevisto: true,
          servicioEjecutorId: true,
          tipoTurno: {
            select: { codigo: true },
          },
          cuadrante: {
            select: { anio: true },
          },
        },
      }),
      this.prisma.bancoHorasSaldo.findMany({
        where: {
          OR: [{ anio }, { anio: anio - 1, mes: 12 }],
        },
        select: {
          empleadoId: true,
          anio: true,
          mes: true,
          saldoFinalAcumulado: true,
        },
      }),
    ]);

    const estados: Record<string, string> = {};
    for (const c of cuadrantes) {
      estados[`${c.servicioId}::${c.anio}-${c.mes}`] =
        c.estado === 'VALIDADO' ? 'PUBLICADO' : c.estado;
    }

    const asignacionesPorPeriodo: Record<
      string,
      Record<
        string,
        Record<
          number,
          {
            codigo: string;
            previsto?: string;
            esRotacion?: boolean;
            servicioEjecutorId?: string;
          }
        >
      >
    > = {};

    for (const a of asignaciones) {
      const fechaUtc = new Date(a.fecha);
      const mes = fechaUtc.getUTCMonth() + 1;
      const dia = fechaUtc.getUTCDate();
      const periodoKey = `${a.cuadrante.anio}-${mes}`;

      if (!asignacionesPorPeriodo[periodoKey]) {
        asignacionesPorPeriodo[periodoKey] = {};
      }
      if (!asignacionesPorPeriodo[periodoKey][a.empleadoId]) {
        asignacionesPorPeriodo[periodoKey][a.empleadoId] = {};
      }

      const codigoReal =
        a.tipoTurno.codigo === CODIGO_CELDA_VACIA_DB ? '' : a.tipoTurno.codigo;

      asignacionesPorPeriodo[periodoKey][a.empleadoId][dia] = {
        codigo: codigoReal,
        previsto: a.codigoPrevisto ?? codigoReal,
        esRotacion: a.esRotacion,
        servicioEjecutorId: a.servicioEjecutorId,
      };
    }

    const saldosConsolidados: Record<string, number> = {};
    for (const s of saldos) {
      saldosConsolidados[`${s.empleadoId}::${s.anio}-${s.mes}`] = s.saldoFinalAcumulado;
    }

    return {
      anio,
      estados,
      asignacionesPorPeriodo,
      saldosConsolidados,
    };
  }

  /**
   * 2. Cambia y persiste en PostgreSQL el estado de un cuadrante específico (servicioId, anio, mes)
   * y si pasa a CERRADO_NOMINA, consolida los saldos en banco_horas_saldos.
   */
  @Put('estado')
  async actualizarEstadoCuadrante(
    @Body() dto: ActualizarEstadoCuadranteDto,
    @Req() req?: any,
  ) {
    const estadoEnum = dto.estado as EstadoCuadrante;

    const cuadrantePrevio = await this.prisma.cuadrante.findUnique({
      where: {
        anio_mes_servicioId: {
          anio: Number(dto.anio),
          mes: Number(dto.mes),
          servicioId: dto.servicioId,
        },
      },
      select: { estado: true },
    });
    const estadoAnterior = cuadrantePrevio?.estado || 'SIN_PLANIFICAR';

    const cuadrante = await this.prisma.cuadrante.upsert({
      where: {
        anio_mes_servicioId: {
          anio: Number(dto.anio),
          mes: Number(dto.mes),
          servicioId: dto.servicioId,
        },
      },
      update: {
        estado: estadoEnum,
      },
      create: {
        anio: Number(dto.anio),
        mes: Number(dto.mes),
        servicioId: dto.servicioId,
        estado: estadoEnum,
      },
    });

    // Auditoría de Cambio de Estado Oficial del Cuadrante (Publicación / Cierre Nómina / Reapertura)
    if (estadoAnterior !== estadoEnum) {
      const srv = await this.prisma.servicio.findUnique({ where: { id: dto.servicioId } });
      const srvNombre = srv?.nombre || dto.servicioId;
      const usuario = req?.usuarioSso;
      const actor = usuario?.nombre
        ? `${usuario.nombre} (${usuario.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
        : 'Supervisión Asistencial / Nómina';

      const mesesNombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      const mesNom = mesesNombres[Number(dto.mes)] || String(dto.mes);

      let accionDetalle = `Cambio oficial de estado: ${estadoAnterior} → ${estadoEnum}`;
      if (estadoEnum === 'PUBLICADO') {
        accionDetalle = `Publicación oficial del cuadrante de ${mesNom} ${dto.anio} (${srvNombre})`;
      } else if (estadoEnum === 'CERRADO_NOMINA') {
        accionDetalle = `Cierre para Nómina y consolidación de horas de ${mesNom} ${dto.anio} (${srvNombre})`;
      } else if (estadoEnum === 'BORRADOR') {
        accionDetalle = `Reapertura a Borrador de ${mesNom} ${dto.anio} (${srvNombre})`;
      }

      await this.prisma.auditoriaCambio.create({
        data: {
          servicioId: dto.servicioId,
          actorId: actor,
          tipoAccion: 'ESTADO_CUADRANTE',
          turnoAnterior: estadoAnterior,
          turnoNuevo: estadoEnum,
          justificacion: accionDetalle,
        },
      });
    }

    // Al publicar el cuadrante, congelar la foto oficial del Turno Previsto (codigoPrevisto = turno actual)
    if (dto.estado === 'PUBLICADO') {
      await this.prisma.$executeRaw`
        UPDATE "asignaciones_turno" a
        SET "codigoPrevisto" = CASE WHEN t."codigo" = 'BLANCO' THEN '' ELSE t."codigo" END
        FROM "tipos_turno" t
        WHERE a."tipoTurnoId" = t."id"
          AND a."cuadranteId" = ${cuadrante.id}
      `;
    }

    if (
      (dto.estado === 'CERRADO_NOMINA' || dto.estado === 'PUBLICADO') &&
      Array.isArray(dto.saldosConsolidados) &&
      dto.saldosConsolidados.length > 0
    ) {
      await this.prisma.$transaction(
        dto.saldosConsolidados.map((s) =>
          this.prisma.bancoHorasSaldo.upsert({
            where: {
              empleadoId_anio_mes: {
                empleadoId: s.empleadoId,
                anio: Number(dto.anio),
                mes: Number(dto.mes),
              },
            },
            update: {
              saldoInicial: s.saldoInicial,
              horasTrabajadas: s.horasTrabajadas,
              horasContratadas: s.horasContratadas,
              horasAmortizadasComp: s.horasAmortizadasComp,
              diferenciaMes: s.diferenciaMes,
              saldoFinalAcumulado: s.saldoFinalAcumulado,
            },
            create: {
              empleadoId: s.empleadoId,
              anio: Number(dto.anio),
              mes: Number(dto.mes),
              saldoInicial: s.saldoInicial,
              horasTrabajadas: s.horasTrabajadas,
              horasContratadas: s.horasContratadas,
              horasAmortizadasComp: s.horasAmortizadasComp,
              diferenciaMes: s.diferenciaMes,
              saldoFinalAcumulado: s.saldoFinalAcumulado,
            },
          })
        )
      );
    }

    return {
      ok: true,
      cuadranteId: cuadrante.id,
      estado: cuadrante.estado,
    };
  }

  /**
   * 3. Guarda o actualiza una celda individual en asignaciones_turno en PostgreSQL.
   */
  @Put('celda')
  async guardarCelda(
    @Body() dto: GuardarCeldaCuadranteDto,
    @Req() req?: any,
  ) {
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    const dia = Number(dto.dia);
    const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia));

    // Validar protección por novedad oficial de Intranet (VAC, INC, LIC)
    const novedadActiva = await this.prisma.novedadAusencia.findFirst({
      where: {
        empleadoId: dto.empleadoId,
        fechaInicio: { lte: fechaUtc },
        fechaFin: { gte: fechaUtc },
      },
    });
    if (novedadActiva && dto.codigo !== novedadActiva.tipo && dto.codigo !== '') {
      throw new ConflictException(
        `Celda bloqueada: El colaborador tiene una novedad oficial de Intranet activa (${novedadActiva.tipo}) en esta fecha.`
      );
    }

    const cuadrante = await this.prisma.cuadrante.upsert({
      where: {
        anio_mes_servicioId: {
          anio,
          mes,
          servicioId: dto.servicioId,
        },
      },
      update: {},
      create: {
        anio,
        mes,
        servicioId: dto.servicioId,
        estado: EstadoCuadrante.BORRADOR,
      },
    });

    if (cuadrante.estado === EstadoCuadrante.CERRADO_NOMINA) {
      throw new ConflictException(
        'El cuadrante de este periodo se encuentra CERRADO para nómina. Para modificar turnos, Talento Humano debe reabrir el periodo.'
      );
    }

    // Consultar turno anterior para auditoría si el cuadrante está PUBLICADO
    const asigPrevia = await this.prisma.asignacionTurno.findUnique({
      where: {
        empleadoId_fecha: {
          empleadoId: dto.empleadoId,
          fecha: fechaUtc,
        },
      },
      include: { tipoTurno: true },
    });
    const codigoAnterior = asigPrevia?.tipoTurno?.codigo || 'L';

    const tipoTurnoId = await this.resolverTipoTurnoId(dto.codigo);

    const asignacion = await this.prisma.asignacionTurno.upsert({
      where: {
        empleadoId_fecha: {
          empleadoId: dto.empleadoId,
          fecha: fechaUtc,
        },
      },
      update: {
        cuadranteId: cuadrante.id,
        tipoTurnoId,
        servicioEjecutorId: dto.servicioId,
        esRotacion: Boolean(dto.esRotacion),
        codigoPrevisto: dto.previsto ?? dto.codigo,
      },
      create: {
        cuadranteId: cuadrante.id,
        empleadoId: dto.empleadoId,
        tipoTurnoId,
        servicioEjecutorId: dto.servicioId,
        fecha: fechaUtc,
        esRotacion: Boolean(dto.esRotacion),
        codigoPrevisto: dto.previsto ?? dto.codigo,
      },
    });

    // Auditar de forma estricta solo si el cuadrante está PUBLICADO y el código cambió
    const codigoNuevo = dto.codigo || 'L';
    if (
      cuadrante.estado === EstadoCuadrante.PUBLICADO &&
      codigoAnterior !== codigoNuevo
    ) {
      const actor = req?.usuarioSso?.nombre
        ? `${req.usuarioSso.nombre} (${req.usuarioSso.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
        : 'Supervisión Asistencial';
      await this.prisma.auditoriaCambio.create({
        data: {
          asignacionTurnoId: asignacion.id,
          servicioId: dto.servicioId,
          empleadoId: dto.empleadoId,
          actorId: actor,
          tipoAccion: 'EDICION_TURNO',
          turnoAnterior: codigoAnterior,
          turnoNuevo: codigoNuevo,
          justificacion:
            dto.justificacion ||
            `Modificación manual de turno (Día ${dto.dia}: [${codigoAnterior}] → [${codigoNuevo}]) sobre cuadrante publicado`,
        },
      });
    }

    return { ok: true, id: asignacion.id };
  }

  /**
   * 4. Guarda en lote múltiples celdas de un cuadrante (usado en Dejar en Blanco y Auto-Balancear Huecos).
   * Respeta y protege de forma estricta las celdas con novedades oficiales de Intranet.
   */
  @Put('lote')
  async guardarLote(
    @Body() dto: GuardarLoteCuadranteDto,
    @Req() req?: any,
  ) {
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);

    const cuadrante = await this.prisma.cuadrante.upsert({
      where: {
        anio_mes_servicioId: {
          anio,
          mes,
          servicioId: dto.servicioId,
        },
      },
      update: {},
      create: {
        anio,
        mes,
        servicioId: dto.servicioId,
        estado: EstadoCuadrante.BORRADOR,
      },
    });

    if (cuadrante.estado === EstadoCuadrante.CERRADO_NOMINA) {
      throw new ConflictException(
        'El cuadrante de este periodo se encuentra CERRADO para nómina. Para modificar turnos, Talento Humano debe reabrir el periodo.'
      );
    }

    // Consultar novedades del mes para proteger las celdas oficiales de Intranet
    const primerDiaMes = new Date(Date.UTC(anio, mes - 1, 1));
    const ultimoDiaMes = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));
    const novedadesMes = await this.prisma.novedadAusencia.findMany({
      where: {
        fechaInicio: { lte: ultimoDiaMes },
        fechaFin: { gte: primerDiaMes },
      },
    });

    const mapaNovedadesDia = new Map<string, string>();
    for (const n of novedadesMes) {
      const cur = new Date(n.fechaInicio);
      while (cur <= n.fechaFin) {
        if (cur.getUTCFullYear() === anio && cur.getUTCMonth() + 1 === mes) {
          mapaNovedadesDia.set(`${n.empleadoId}_${cur.getUTCDate()}`, n.tipo);
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    // Filtrar celdas: si el empleado tiene novedad oficial activa ese día, no se sobreescribe
    const celdasFiltradas = dto.celdas.filter((c) => {
      const tipoNov = mapaNovedadesDia.get(`${c.empleadoId}_${c.dia}`);
      if (tipoNov && c.codigo !== tipoNov) {
        return false;
      }
      return true;
    });

    // Asegurar que todos los códigos de turno del lote estén resueltos en caché
    const codigosUnicos = Array.from(new Set(celdasFiltradas.map((c) => c.codigo || '')));
    const mapaIds = new Map<string, string>();
    for (const cod of codigosUnicos) {
      mapaIds.set(cod, await this.resolverTipoTurnoId(cod));
    }

    await this.prisma.$transaction(
      celdasFiltradas.map((c) => {
        const fechaUtc = new Date(Date.UTC(anio, mes - 1, Number(c.dia)));
        const tipoTurnoId = mapaIds.get(c.codigo || '')!;
        return this.prisma.asignacionTurno.upsert({
          where: {
            empleadoId_fecha: {
              empleadoId: c.empleadoId,
              fecha: fechaUtc,
            },
          },
          update: {
            cuadranteId: cuadrante.id,
            tipoTurnoId,
            servicioEjecutorId: dto.servicioId,
            esRotacion: Boolean(c.esRotacion),
            codigoPrevisto: c.previsto ?? c.codigo,
          },
          create: {
            cuadranteId: cuadrante.id,
            empleadoId: c.empleadoId,
            tipoTurnoId,
            servicioEjecutorId: dto.servicioId,
            fecha: fechaUtc,
            esRotacion: Boolean(c.esRotacion),
            codigoPrevisto: c.previsto ?? c.codigo,
          },
        });
      })
    );

    if (cuadrante.estado === EstadoCuadrante.PUBLICADO && celdasFiltradas.length > 0) {
      const actor = req?.usuarioSso?.nombre
        ? `${req.usuarioSso.nombre} (${req.usuarioSso.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
        : 'Supervisión Asistencial';
      await this.prisma.auditoriaCambio.create({
        data: {
          servicioId: dto.servicioId,
          actorId: actor,
          tipoAccion: 'ACCION_MASIVA',
          turnoAnterior: 'LOTE',
          turnoNuevo: 'LOTE',
          justificacion: `Ajuste en bloque sobre cuadrante publicado: ${celdasFiltradas.length} turnos actualizados en ${mes}/${anio}`,
        },
      });
    }

    return { ok: true, totalGuardadas: celdasFiltradas.length };
  }

  /**
   * 5. Consulta de Novedades Oficiales persistidas en PostgreSQL (Caché local de Intranet)
   */
  @Get('novedades')
  async obtenerNovedades(
    @Query('anio') anioStr?: string,
    @Query('mes') mesStr?: string
  ) {
    const anio = Number(anioStr) || 2026;
    const mes = Number(mesStr) || 11;
    const primerDia = new Date(Date.UTC(anio, mes - 1, 1));
    const ultimoDia = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));

    const novedades = await this.prisma.novedadAusencia.findMany({
      where: {
        fechaInicio: { lte: ultimoDia },
        fechaFin: { gte: primerDia },
      },
      include: {
        empleado: {
          include: {
            servicioBase: true,
            categoria: true,
          },
        },
      },
      orderBy: { fechaInicio: 'asc' },
    });

    return novedades.map((n) => ({
      id: n.id,
      empleadoId: n.empleadoId,
      empleadoNombre: n.empleado.nombre,
      empleadoDocumento: n.empleado.documento,
      servicioId: n.empleado.servicioBaseId,
      servicioCodigo: n.empleado.servicioBase?.codigo,
      servicioNombre: n.empleado.servicioBase?.nombre,
      cargo: n.empleado.categoria?.nombre,
      tipo: n.tipo,
      fechaInicio: n.fechaInicio.toISOString().substring(0, 10),
      fechaFin: n.fechaFin.toISOString().substring(0, 10),
      codigoCie10: n.codigoCie10,
    }));
  }

  /**
   * 6. Sincronización de Novedades desde la Intranet Hospitalaria (Simulador puerto 4300 / API real)
   * Consulta las ausencias oficiales, las guarda en novedades_ausencia y bloquea automáticamente las celdas en el cuadrante.
   */
  @Post('sincronizar-novedades')
  async sincronizarNovedadesIntranet(
    @Body() body?: { anio?: number; mes?: number; intranetUrl?: string }
  ) {
    const anio = Number(body?.anio) || 2026;
    const mes = Number(body?.mes) || 11;
    const intranetUrl =
      body?.intranetUrl || process.env.INTRANET_API_URL || 'http://localhost:4300';

    let items: any[] = [];
    try {
      const resp = await fetch(`${intranetUrl}/api/intranet/novedades?mes=${mes}&anio=${anio}`);
      if (!resp.ok) {
        throw new BadRequestException(`Intranet respondió con código ${resp.status}`);
      }
      items = await resp.json();
    } catch (err: any) {
      throw new BadRequestException(
        `No se pudo conectar a la Intranet en ${intranetUrl}: ${err.message}`
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return {
        ok: true,
        mensaje: 'No se encontraron novedades en Intranet para este periodo.',
        totalSincronizadas: 0,
        celdasBloqueadas: 0,
        novedades: [],
      };
    }

    const docs = [
      ...new Set(
        items
          .map((i: any) => String(i.empleadoDocumento || '').trim())
          .filter(Boolean)
      ),
    ];

    const [empleadosDb, tiposDb] = await Promise.all([
      this.prisma.empleado.findMany({
        where: { documento: { in: docs } },
        select: {
          id: true,
          documento: true,
          nombre: true,
          servicioBaseId: true,
          servicioBase: {
            select: { codigo: true, nombre: true },
          },
          categoria: {
            select: { nombre: true },
          },
        },
      }),
      this.prisma.tipoTurno.findMany({
        select: { id: true, codigo: true },
      }),
    ]);

    const mapaEmpleados = new Map(empleadosDb.map((e) => [e.documento, e]));
    const mapaTipos = new Map(
      tiposDb.map((t) => [t.codigo.toUpperCase(), t.id])
    );

    let celdasBloqueadas = 0;
    const novedadesProcesadas: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      // Pre-crear o asegurar cuadrantes para cada servicio involucrado en lote
      const mapaCuadrantes = new Map<string, string>();
      for (const emp of empleadosDb) {
        if (!mapaCuadrantes.has(emp.servicioBaseId)) {
          const cuad = await tx.cuadrante.upsert({
            where: {
              anio_mes_servicioId: {
                anio,
                mes,
                servicioId: emp.servicioBaseId,
              },
            },
            update: {},
            create: {
              anio,
              mes,
              servicioId: emp.servicioBaseId,
              estado: EstadoCuadrante.BORRADOR,
            },
            select: { id: true },
          });
          mapaCuadrantes.set(emp.servicioBaseId, cuad.id);
        }
      }

      for (const item of items) {
        const doc = String(item.empleadoDocumento || '').trim();
        if (!doc) continue;

        const emp = mapaEmpleados.get(doc);
        if (!emp) continue;

        const tipoNov = String(item.tipoNovedad || 'VAC').trim().toUpperCase();
        const fInicio = new Date(`${item.fechaInicio}T00:00:00.000Z`);
        const fFin = new Date(`${item.fechaFin}T23:59:59.999Z`);

        // Eliminar registros previos idénticos para no duplicar en reintentos
        await tx.novedadAusencia.deleteMany({
          where: {
            empleadoId: emp.id,
            tipo: tipoNov,
            fechaInicio: fInicio,
          },
        });

        await tx.novedadAusencia.create({
          data: {
            empleadoId: emp.id,
            tipo: tipoNov,
            fechaInicio: fInicio,
            fechaFin: fFin,
            codigoCie10: item.codigoCie10 || null,
          },
        });

        // Resolver el tipo de turno en PostgreSQL (VAC, INC, LIC)
        let tipoTurnoId = mapaTipos.get(tipoNov);
        if (!tipoTurnoId) {
          const creado = await tx.tipoTurno.upsert({
            where: { codigo: tipoNov },
            update: {},
            create: {
              codigo: tipoNov,
              nombre: `Novedad ${tipoNov}`,
              horaInicio: '00:00',
              horaFin: '00:00',
              horasOrdinarias: 0,
              horasDiurnas: 0,
              horasNocturnas: 0,
              colorHex: '#fee2e2',
              descuentaBancoHoras: false,
              esNocturnoPesado: false,
              visibleEnPaleta: true,
            },
            select: { id: true },
          });
          tipoTurnoId = creado.id;
          mapaTipos.set(tipoNov, tipoTurnoId);
        }

        const cuadranteId = mapaCuadrantes.get(emp.servicioBaseId);
        if (!cuadranteId) continue;

        // Bloquear cada día del rango dentro de este mes
        const cur = new Date(fInicio);
        while (cur <= fFin) {
          if (cur.getUTCFullYear() === anio && cur.getUTCMonth() + 1 === mes) {
            const dia = cur.getUTCDate();
            const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia));

            await tx.asignacionTurno.upsert({
              where: {
                empleadoId_fecha: {
                  empleadoId: emp.id,
                  fecha: fechaUtc,
                },
              },
              update: {
                cuadranteId,
                tipoTurnoId,
                servicioEjecutorId: emp.servicioBaseId,
                esRotacion: false,
                codigoPrevisto: tipoNov,
              },
              create: {
                cuadranteId,
                empleadoId: emp.id,
                tipoTurnoId,
                servicioEjecutorId: emp.servicioBaseId,
                fecha: fechaUtc,
                esRotacion: false,
                codigoPrevisto: tipoNov,
              },
            });
            celdasBloqueadas++;
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }

        novedadesProcesadas.push({
          empleadoId: emp.id,
          empleadoNombre: emp.nombre,
          documento: emp.documento,
          tipo: tipoNov,
          desde: item.fechaInicio,
          hasta: item.fechaFin,
          servicioCodigo: emp.servicioBase?.codigo,
          servicioNombre: emp.servicioBase?.nombre,
          cargo: emp.categoria?.nombre,
        });
      }
    });

    return {
      ok: true,
      mensaje: `Sincronización completada exitosamente desde Intranet.`,
      totalSincronizadas: novedadesProcesadas.length,
      celdasBloqueadas,
      novedades: novedadesProcesadas,
    };
  }

  @Post('validar-celda')
  validarCelda(@Body() body: ValidacionTurnoDto) {
    return this.reglasService.validarAsignacionCelda(body);
  }

  @Get('rotacion-homologos')
  consultarReglaRotacion(@Query('tipoAsistencia') tipoAsistencia = 'CUIDADOS_INTENSIVOS') {
    return {
      tipoAsistencia,
      regla:
        'Un colaborador solo puede rotar hacia servicios que compartan exactamente el mismo tipoAsistencia y manteniendo unicidad global @@unique([empleadoId, fecha]).',
    };
  }
}

@Module({
  imports: [FestivosModule],
  controllers: [CuadrantesController],
  providers: [CuadrantesReglasService],
})
export class CuadrantesModule {}
