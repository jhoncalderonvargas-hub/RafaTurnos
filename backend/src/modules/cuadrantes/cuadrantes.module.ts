import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Optional,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EstadoCuadrante, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';
import { LiquidacionModule, LiquidacionService, TipoTurnoLiquidableDb, toTurnoLiquidable } from '../liquidacion/liquidacion.module';
import {
  calcularDescansoEntreTurnosMin,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esDomingo,
  esFechaIsoValida,
  hoyColombiaIso,
  r2,
  sumarDiasIso,
} from '../../shared/liquidacion-horas';

export interface ValidacionTurnoDto {
  empleadoId: string;
  fechaIso: string;
  turnoPrevioDiaAnterior: string;
  turnoPropuesto: string;
  turnoSiguienteDia?: string;
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

const CODIGOS_NO_OPERATIVOS = new Set(['L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM', 'DISP', 'BLANCO', '']);

@Injectable()
export class CuadrantesReglasService {
  constructor(
    private readonly festivosService: FestivosColombiaService,
    private readonly prisma: PrismaService
  ) {}

  async validarAsignacionCelda(
    dto: ValidacionTurnoDto,
    tx?: Prisma.TransactionClient
  ): Promise<{
    esValido: boolean;
    esFestivoColombia: boolean;
    esDescansoObligatorio: boolean;
    alertas: string[];
  }> {
    const db = tx || this.prisma;
    const alertas: string[] = [];
    const fechaIso = String(dto.fechaIso || '').trim();
    if (!esFechaIsoValida(fechaIso)) {
      throw new BadRequestException(
        `Fecha ISO inválida en validación de celda: "${dto.fechaIso}". Se requiere YYYY-MM-DD válida.`
      );
    }

    const codPrev = (dto.turnoPrevioDiaAnterior || '').trim().toUpperCase();
    const codProp = (dto.turnoPropuesto || '').trim().toUpperCase();
    const codSig = (dto.turnoSiguienteDia || '').trim().toUpperCase();

    await this.festivosService.asegurarAnios([
      Number(fechaIso.substring(0, 4)) - 1,
      Number(fechaIso.substring(0, 4)),
      Number(sumarDiasIso(fechaIso, 1).substring(0, 4)),
    ]);

    let novedadDb: { tipo: string } | null = null;
    if (dto.empleadoId) {
      const fechaUtc = new Date(`${fechaIso}T00:00:00.000Z`);
      novedadDb = await db.novedadAusencia.findFirst({
        where: {
          empleadoId: dto.empleadoId,
          fechaInicio: { lte: fechaUtc },
          fechaFin: { gte: fechaUtc },
        },
        select: { tipo: true },
      });
    }

    if ((dto.tieneAusenciaActiva || novedadDb) && (!novedadDb || codProp !== novedadDb.tipo.toUpperCase())) {
      const tipoTxt = novedadDb?.tipo || 'VAC / INC / LIC / FAM';
      alertas.push(
        `RN-03 Bloqueante: El colaborador presenta novedad oficial activa (${tipoTxt}) en la fecha.`
      );
    }

    const codigosConsultar = Array.from(
      new Set([codPrev, codProp, codSig].filter((c) => c && !CODIGOS_NO_OPERATIVOS.has(c)))
    );
    const tipos =
      codigosConsultar.length > 0
        ? await db.tipoTurno.findMany({ where: { codigo: { in: codigosConsultar } } })
        : [];
    const cfgPrev = tipos.find((t) => t.codigo.toUpperCase() === codPrev);
    const cfgProp = tipos.find((t) => t.codigo.toUpperCase() === codProp);
    const cfgSig = tipos.find((t) => t.codigo.toUpperCase() === codSig);

    if (codPrev && codProp && !CODIGOS_NO_OPERATIVOS.has(codPrev) && !CODIGOS_NO_OPERATIVOS.has(codProp)) {
      if (cfgPrev?.esNocturnoPesado && cfgProp && cfgProp.horasOrdinarias > 0) {
        alertas.push(
          `RN-01 Bloqueante: Infracción Post-Guardia (${codPrev}). El día previo fue turno pesado; requiere Saliente (S) o Libre (L).`
        );
      } else {
        const descansoMin = calcularDescansoEntreTurnosMin(
          toTurnoLiquidable(cfgPrev, codPrev),
          toTurnoLiquidable(cfgProp, codProp)
        );
        if (descansoMin !== null && descansoMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
          alertas.push(
            `RN-02 Bloqueante: Descanso insuficiente (${r2(descansoMin / 60)}h < 12h legales) entre ${codPrev} (${cfgPrev?.horaInicio}-${cfgPrev?.horaFin}) y ${codProp} (${cfgProp?.horaInicio}-${cfgProp?.horaFin}).`
          );
        }
      }
    }

    if (codProp && codSig && !CODIGOS_NO_OPERATIVOS.has(codProp) && !CODIGOS_NO_OPERATIVOS.has(codSig)) {
      if (cfgProp?.esNocturnoPesado && cfgSig && cfgSig.horasOrdinarias > 0) {
        alertas.push(
          `RN-01 Bloqueante: Asignar ${codProp} antes de ${codSig} incumple el descanso Post-Guardia del día siguiente.`
        );
      } else {
        const descansoSigMin = calcularDescansoEntreTurnosMin(
          toTurnoLiquidable(cfgProp, codProp),
          toTurnoLiquidable(cfgSig, codSig)
        );
        if (descansoSigMin !== null && descansoSigMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
          alertas.push(
            `RN-02 Bloqueante: Descanso insuficiente (${r2(descansoSigMin / 60)}h < 12h legales) entre ${codProp} y ${codSig} del día siguiente.`
          );
        }
      }
    }

    const esFestivoColombia = this.festivosService.esFestivo(fechaIso);
    return {
      esValido: alertas.length === 0,
      esFestivoColombia,
      esDescansoObligatorio: esDomingo(fechaIso) || esFestivoColombia,
      alertas,
    };
  }
}

@Controller('api/v1/cuadrantes')
export class CuadrantesController {
  constructor(
    private readonly reglasService: CuadrantesReglasService,
    private readonly prisma: PrismaService,
    private readonly liquidacionService: LiquidacionService,
    private readonly festivosService: FestivosColombiaService,
    @Optional() private readonly configService?: ConfigService
  ) {}

  private obtenerIntranetUrl(overrideUrl?: string): string {
    return (
      overrideUrl ||
      this.configService?.get<string>('INTRANET_API_URL') ||
      process.env.INTRANET_API_URL ||
      'http://localhost:4300'
    );
  }

  private obtenerIntranetHeaders(): Record<string, string> {
    const apiKey =
      this.configService?.get<string>('INTRANET_API_KEY') ||
      process.env.INTRANET_API_KEY ||
      '';
    return apiKey ? { 'x-api-key': apiKey } : {};
  }

  private construirFechaUtcStrict(anio: number, mes: number, dia: number): Date {
    if (
      !Number.isInteger(anio) ||
      !Number.isInteger(mes) ||
      !Number.isInteger(dia) ||
      anio < 1900 ||
      anio > 2100 ||
      mes < 1 ||
      mes > 12
    ) {
      throw new BadRequestException(`Periodo o fecha inválida (${anio}-${mes}-${dia}).`);
    }
    const ultimoDiaMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    if (dia < 1 || dia > ultimoDiaMes) {
      throw new BadRequestException(
        `Día ${dia} fuera de calendario para ${anio}-${String(mes).padStart(2, '0')} (rango válido: 1..${ultimoDiaMes}).`
      );
    }
    return new Date(Date.UTC(anio, mes - 1, dia));
  }

  private normalizarCodigoParaAuditoria(codigo?: string | null): string {
    const u = String(codigo ?? '').trim().toUpperCase();
    return !u || u === CODIGO_CELDA_VACIA_DB ? 'L' : u;
  }

  private async resolverTipoTurno(
    codigo: string,
    tx?: Prisma.TransactionClient
  ): Promise<TipoTurnoLiquidableDb> {
    const db = tx || this.prisma;
    const codKey = !codigo ? CODIGO_CELDA_VACIA_DB : String(codigo).trim().toUpperCase();
    const existente = await db.tipoTurno.findUnique({ where: { codigo: codKey } });
    if (existente) return existente;

    if (codKey === CODIGO_CELDA_VACIA_DB) {
      return db.tipoTurno.upsert({
        where: { codigo: CODIGO_CELDA_VACIA_DB },
        update: { visibleEnPaleta: false },
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
          visibleEnPaleta: false,
        },
      });
    }

    throw new BadRequestException(
      `El código de turno "${codKey}" no existe en el catálogo maestro. Regístralo primero en Configuración de Turnos.`
    );
  }

  /**
   * 1. Carga el estado persistido en PostgreSQL:
   * - Estados de cada cuadrante (servicioId::anio-mes)
   * - Asignaciones de turnos guardadas en asignaciones_turno
   * - Saldos consolidados en banco_horas_saldos
   */
  @Get('estado-global')
  async obtenerEstadoGlobal(@Query('anio') anioStr?: string) {
    const anio = Number(anioStr) || Number(hoyColombiaIso().substring(0, 4));

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
        previsto:
          a.codigoPrevisto === CODIGO_CELDA_VACIA_DB
            ? ''
            : (a.codigoPrevisto ?? codigoReal),
        esRotacion: codigoReal === '' ? false : a.esRotacion,
        servicioEjecutorId: codigoReal === '' ? undefined : a.servicioEjecutorId,
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
   * y si pasa a PUBLICADO / CERRADO_NOMINA, consolida los saldos en banco_horas_saldos en cascada M..12.
   * Si regresa a BORRADOR, invalida saldos del mes y recalcula meses posteriores en cascada.
   */
  @Put('estado')
  async actualizarEstadoCuadrante(
    @Body() dto: ActualizarEstadoCuadranteDto,
    @Req() req?: any,
  ) {
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    if (!dto?.servicioId || !Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('Debe indicar servicioId, anio y mes válidos (1–12).');
    }
    if (!['BORRADOR', 'PUBLICADO', 'CERRADO_NOMINA'].includes(String(dto.estado))) {
      throw new BadRequestException(`Estado de cuadrante inválido: "${dto.estado}".`);
    }

    const estadoEnum = dto.estado as EstadoCuadrante;
    await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);

    const cuadrante = await this.prisma.$transaction(
      async (tx) => {
        const srv = await tx.servicio.findUnique({ where: { id: dto.servicioId } });
        if (!srv) {
          throw new NotFoundException(`Servicio hospitalario "${dto.servicioId}" no encontrado.`);
        }

        const cuadrantePrevio = await tx.cuadrante.findUnique({
          where: {
            anio_mes_servicioId: {
              anio,
              mes,
              servicioId: dto.servicioId,
            },
          },
          select: { estado: true },
        });
        const estadoAnterior = cuadrantePrevio?.estado || 'SIN_PLANIFICAR';

        const cuad = await tx.cuadrante.upsert({
          where: {
            anio_mes_servicioId: {
              anio,
              mes,
              servicioId: dto.servicioId,
            },
          },
          update: {
            estado: estadoEnum,
          },
          create: {
            anio,
            mes,
            servicioId: dto.servicioId,
            estado: estadoEnum,
          },
        });

        // Auditoría de Cambio de Estado Oficial del Cuadrante
        if (estadoAnterior !== estadoEnum) {
          const usuario = req?.usuarioSso;
          const actor = usuario?.nombre
            ? `${usuario.nombre} (${usuario.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
            : 'Supervisión Asistencial / Nómina';

          const mesesNombres = [
            '',
            'Enero',
            'Febrero',
            'Marzo',
            'Abril',
            'Mayo',
            'Junio',
            'Julio',
            'Agosto',
            'Septiembre',
            'Octubre',
            'Noviembre',
            'Diciembre',
          ];
          const mesNom = mesesNombres[mes] || String(mes);

          let accionDetalle = `Cambio oficial de estado: ${estadoAnterior} → ${estadoEnum}`;
          if (estadoEnum === 'PUBLICADO') {
            accionDetalle = `Publicación oficial del cuadrante de ${mesNom} ${anio} (${srv.nombre})`;
          } else if (estadoEnum === 'CERRADO_NOMINA') {
            accionDetalle = `Cierre para Nómina y consolidación de horas de ${mesNom} ${anio} (${srv.nombre})`;
          } else if (estadoEnum === 'BORRADOR') {
            accionDetalle = `Reapertura a Borrador de ${mesNom} ${anio} (${srv.nombre})`;
          }

          await tx.auditoriaCambio.create({
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

        if (dto.estado === 'PUBLICADO') {
          await tx.$executeRaw`
            UPDATE "asignaciones_turno" a
            SET "codigoPrevisto" = CASE WHEN t."codigo" = 'BLANCO' THEN '' ELSE t."codigo" END
            FROM "tipos_turno" t
            WHERE a."tipoTurnoId" = t."id"
              AND a."cuadranteId" = ${cuad.id}
          `;
        }

        if (dto.estado === 'CERRADO_NOMINA' || dto.estado === 'PUBLICADO') {
          await this.liquidacionService.recalcularAsignaciones({ cuadranteId: cuad.id }, tx);
          const fallbacks = new Map<string, number>();
          for (const s of dto.saldosConsolidados || []) {
            if (s?.empleadoId) fallbacks.set(s.empleadoId, Number(s.saldoInicial) || 0);
          }
          await this.liquidacionService.consolidarSaldosBancoServicio(
            dto.servicioId,
            anio,
            mes,
            fallbacks,
            true,
            tx
          );
        } else if (dto.estado === 'BORRADOR') {
          await this.liquidacionService.invalidarSaldosMesYCascada(
            dto.servicioId,
            anio,
            mes,
            tx
          );
        }

        return cuad;
      },
      { timeout: 20000 }
    );

    return {
      ok: true,
      cuadranteId: cuadrante.id,
      estado: cuadrante.estado,
    };
  }

  /**
   * 3. Guarda o actualiza una celda individual en asignaciones_turno en PostgreSQL de forma transaccional.
   */
  @Put('celda')
  async guardarCelda(
    @Body() dto: GuardarCeldaCuadranteDto,
    @Req() req?: any,
  ) {
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    const dia = Number(dto.dia);
    const fechaUtc = this.construirFechaUtcStrict(anio, mes, dia);
    const fechaIso = fechaUtc.toISOString().substring(0, 10);
    const fechaPrevUtc = new Date(`${sumarDiasIso(fechaIso, -1)}T00:00:00.000Z`);
    const fechaSigUtc = new Date(`${sumarDiasIso(fechaIso, 1)}T00:00:00.000Z`);
    const codigoRaw = String(dto.codigo ?? '').trim().toUpperCase();
    const previstoNorm =
      dto.previsto !== undefined ? String(dto.previsto).trim().toUpperCase() : undefined;

    await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);

    return this.prisma.$transaction(
      async (tx) => {
        // Validar protección por novedad oficial de Intranet (VAC, INC, LIC, FAM)
        const novedadActiva = await tx.novedadAusencia.findFirst({
          where: {
            empleadoId: dto.empleadoId,
            fechaInicio: { lte: fechaUtc },
            fechaFin: { gte: fechaUtc },
          },
        });
        if (novedadActiva && codigoRaw !== novedadActiva.tipo.trim().toUpperCase()) {
          throw new ConflictException(
            `Celda bloqueada: El colaborador tiene una novedad oficial de Intranet activa (${novedadActiva.tipo}) en esta fecha.`
          );
        }

        const cuadrante = await tx.cuadrante.upsert({
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

        // Consultar turno anterior y vecinos de empalme dentro de la transacción
        const [asigPrevia, asigPrevDia, asigSigDia] = await Promise.all([
          tx.asignacionTurno.findUnique({
            where: {
              empleadoId_fecha: {
                empleadoId: dto.empleadoId,
                fecha: fechaUtc,
              },
            },
            include: {
              tipoTurno: true,
              servicioEjecutor: { select: { codigo: true, nombre: true } },
            },
          }),
          tx.asignacionTurno.findUnique({
            where: {
              empleadoId_fecha: { empleadoId: dto.empleadoId, fecha: fechaPrevUtc },
            },
            select: { tipoTurno: { select: { codigo: true } } },
          }),
          tx.asignacionTurno.findUnique({
            where: {
              empleadoId_fecha: { empleadoId: dto.empleadoId, fecha: fechaSigUtc },
            },
            select: { tipoTurno: { select: { codigo: true } } },
          }),
        ]);

        const codPrevRaw = String(asigPrevia?.tipoTurno?.codigo || '').trim().toUpperCase();
        const codigoAnteriorAud = this.normalizarCodigoParaAuditoria(codPrevRaw);

        // Bloqueo cruzado inter-servicio: no permitir sobreescribir un turno operativo activo de otro servicio
        if (
          asigPrevia &&
          asigPrevia.servicioEjecutorId &&
          asigPrevia.servicioEjecutorId !== dto.servicioId &&
          codPrevRaw &&
          ![CODIGO_CELDA_VACIA_DB, '', 'L', 'VAC', 'INC', 'LIC', 'FAM'].includes(codPrevRaw)
        ) {
          const nombreOtroSrv =
            asigPrevia.servicioEjecutor?.nombre || asigPrevia.servicioEjecutorId;
          throw new ConflictException(
            `Celda Espejo bloqueada: El colaborador ya tiene asignado el turno "${codPrevRaw}" en "${nombreOtroSrv}" en esta fecha. Libéralo primero en ese servicio.`
          );
        }

        const tipoTurno = await this.resolverTipoTurno(codigoRaw, tx);
        const horas = await this.liquidacionService.calcularHorasPorTipo(tipoTurno, fechaUtc);

        const validacion = await this.reglasService.validarAsignacionCelda(
          {
            empleadoId: dto.empleadoId,
            fechaIso,
            turnoPrevioDiaAnterior: this.normalizarCodigoParaAuditoria(
              asigPrevDia?.tipoTurno?.codigo
            ),
            turnoPropuesto: codigoRaw,
            turnoSiguienteDia: this.normalizarCodigoParaAuditoria(
              asigSigDia?.tipoTurno?.codigo
            ),
            tieneAusenciaActiva: Boolean(novedadActiva),
          },
          tx
        );

        const codigoPrevistoGuardar = previstoNorm ?? codigoRaw;
        const asignacion = await tx.asignacionTurno.upsert({
          where: {
            empleadoId_fecha: {
              empleadoId: dto.empleadoId,
              fecha: fechaUtc,
            },
          },
          update: {
            cuadranteId: cuadrante.id,
            tipoTurnoId: tipoTurno.id,
            servicioEjecutorId: dto.servicioId,
            esRotacion: Boolean(dto.esRotacion),
            codigoPrevisto: codigoPrevistoGuardar,
            ...horas,
          },
          create: {
            cuadranteId: cuadrante.id,
            empleadoId: dto.empleadoId,
            tipoTurnoId: tipoTurno.id,
            servicioEjecutorId: dto.servicioId,
            fecha: fechaUtc,
            esRotacion: Boolean(dto.esRotacion),
            codigoPrevisto: codigoPrevistoGuardar,
            ...horas,
          },
        });

        const codigoNuevoAud = this.normalizarCodigoParaAuditoria(codigoRaw);
        if (
          (cuadrante.estado === EstadoCuadrante.PUBLICADO ||
            cuadrante.estado === EstadoCuadrante.VALIDADO) &&
          codigoAnteriorAud !== codigoNuevoAud
        ) {
          const actor = req?.usuarioSso?.nombre
            ? `${req.usuarioSso.nombre} (${req.usuarioSso.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
            : 'Supervisión Asistencial';
          await tx.auditoriaCambio.create({
            data: {
              asignacionTurnoId: asignacion.id,
              servicioId: dto.servicioId,
              empleadoId: dto.empleadoId,
              actorId: actor,
              tipoAccion: 'EDICION_TURNO',
              turnoAnterior: codigoAnteriorAud,
              turnoNuevo: codigoNuevoAud,
              justificacion:
                dto.justificacion ||
                `Modificación manual de turno (Día ${dia}: [${codigoAnteriorAud}] → [${codigoNuevoAud}]) sobre cuadrante publicado`,
            },
          });
        }

        // Mantener banco_horas_saldos consistente si el cuadrante está PUBLICADO (y servicio base de rotados si aplica)
        if (
          cuadrante.estado === EstadoCuadrante.PUBLICADO ||
          cuadrante.estado === EstadoCuadrante.VALIDADO
        ) {
          await this.liquidacionService.consolidarSaldosBancoServicio(
            dto.servicioId,
            anio,
            mes,
            new Map(),
            true,
            tx
          );
          const emp = await tx.empleado.findUnique({
            where: { id: dto.empleadoId },
            select: { servicioBaseId: true },
          });
          if (emp && emp.servicioBaseId !== dto.servicioId) {
            const cuadBase = await tx.cuadrante.findUnique({
              where: {
                anio_mes_servicioId: { anio, mes, servicioId: emp.servicioBaseId },
              },
              select: { estado: true },
            });
            if (cuadBase && cuadBase.estado !== EstadoCuadrante.BORRADOR) {
              await this.liquidacionService.consolidarSaldosBancoServicio(
                emp.servicioBaseId,
                anio,
                mes,
                new Map(),
                true,
                tx
              );
            }
          }
        }

        return {
          ok: true,
          id: asignacion.id,
          advertenciasReglas: validacion.alertas,
        };
      },
      { timeout: 20000 }
    );
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
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException(`Periodo inválido en guardarLote (${dto.anio}-${dto.mes}).`);
    }
    const celdasInput = Array.isArray(dto.celdas) ? dto.celdas : [];
    for (const c of celdasInput) {
      this.construirFechaUtcStrict(anio, mes, Number(c.dia));
    }

    await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);

    return this.prisma.$transaction(
      async (tx) => {
        const cuadrante = await tx.cuadrante.upsert({
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

        // Consultar novedades del mes y asignaciones existentes para proteger novedades y Celda Espejo
        const primerDiaMes = new Date(Date.UTC(anio, mes - 1, 1));
        const ultimoDiaMes = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));
        const empIdsLote = Array.from(new Set(celdasInput.map((c) => c.empleadoId).filter(Boolean)));
        const [novedadesMes, asignacionesOtrosServicios, asignacionesPreviasServicio] =
          await Promise.all([
            tx.novedadAusencia.findMany({
              where: {
                fechaInicio: { lte: ultimoDiaMes },
                fechaFin: { gte: primerDiaMes },
              },
            }),
            tx.asignacionTurno.findMany({
              where: {
                fecha: { gte: primerDiaMes, lte: ultimoDiaMes },
                servicioEjecutorId: { not: dto.servicioId },
              },
              select: {
                empleadoId: true,
                fecha: true,
                tipoTurno: { select: { codigo: true } },
              },
            }),
            empIdsLote.length > 0
              ? tx.asignacionTurno.findMany({
                  where: {
                    empleadoId: { in: empIdsLote },
                    fecha: { gte: primerDiaMes, lte: ultimoDiaMes },
                  },
                  select: {
                    empleadoId: true,
                    fecha: true,
                    tipoTurno: { select: { codigo: true } },
                  },
                })
              : Promise.resolve([]),
          ]);

        const mapaNovedadesDia = new Map<string, string>();
        for (const n of novedadesMes) {
          const cur = new Date(n.fechaInicio);
          while (cur <= n.fechaFin) {
            if (cur.getUTCFullYear() === anio && cur.getUTCMonth() + 1 === mes) {
              mapaNovedadesDia.set(
                `${n.empleadoId}_${cur.getUTCDate()}`,
                n.tipo.trim().toUpperCase()
              );
            }
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
        }

        const celdasOcupadasOtroServicio = new Set<string>();
        for (const a of asignacionesOtrosServicios) {
          const cod = String(a.tipoTurno?.codigo || '').trim().toUpperCase();
          if (![CODIGO_CELDA_VACIA_DB, '', 'L', 'VAC', 'INC', 'LIC', 'FAM'].includes(cod)) {
            const diaUtc = new Date(a.fecha).getUTCDate();
            celdasOcupadasOtroServicio.add(`${a.empleadoId}_${diaUtc}`);
          }
        }

        const mapaPrevio = new Map<string, string>();
        for (const a of asignacionesPreviasServicio) {
          const d = new Date(a.fecha).getUTCDate();
          mapaPrevio.set(
            `${a.empleadoId}_${d}`,
            this.normalizarCodigoParaAuditoria(a.tipoTurno?.codigo)
          );
        }

        // Normalizar y filtrar celdas protegiendo novedades y Celda Espejo
        const celdasFiltradas = celdasInput
          .map((c) => ({
            ...c,
            dia: Number(c.dia),
            codigoNorm: String(c.codigo ?? '').trim().toUpperCase(),
            previstoNorm:
              c.previsto !== undefined
                ? String(c.previsto).trim().toUpperCase()
                : undefined,
          }))
          .filter((c) => {
            const key = `${c.empleadoId}_${c.dia}`;
            const tipoNov = mapaNovedadesDia.get(key);
            if (tipoNov && c.codigoNorm !== tipoNov) {
              return false;
            }
            if (celdasOcupadasOtroServicio.has(key)) {
              return false;
            }
            return true;
          });

        // Asegurar todos los tipos de turno del lote desde el catálogo maestro (rechaza códigos inexistentes)
        const codigosUnicos = Array.from(new Set(celdasFiltradas.map((c) => c.codigoNorm)));
        const mapaTipos = new Map<string, TipoTurnoLiquidableDb>();
        for (const cod of codigosUnicos) {
          mapaTipos.set(cod, await this.resolverTipoTurno(cod, tx));
        }

        const cambiosReales: Array<{ anterior: string; nuevo: string; dia: number }> = [];
        for (const c of celdasFiltradas) {
          const fechaUtc = this.construirFechaUtcStrict(anio, mes, c.dia);
          const tipoTurno = mapaTipos.get(c.codigoNorm)!;
          const horas = await this.liquidacionService.calcularHorasPorTipo(tipoTurno, fechaUtc);
          const codPrevGuardar = c.previstoNorm ?? c.codigoNorm;

          const antAud = mapaPrevio.get(`${c.empleadoId}_${c.dia}`) || 'L';
          const nueAud = this.normalizarCodigoParaAuditoria(c.codigoNorm);
          if (antAud !== nueAud) {
            cambiosReales.push({ anterior: antAud, nuevo: nueAud, dia: c.dia });
          }

          await tx.asignacionTurno.upsert({
            where: {
              empleadoId_fecha: {
                empleadoId: c.empleadoId,
                fecha: fechaUtc,
              },
            },
            update: {
              cuadranteId: cuadrante.id,
              tipoTurnoId: tipoTurno.id,
              servicioEjecutorId: dto.servicioId,
              esRotacion: Boolean(c.esRotacion),
              codigoPrevisto: codPrevGuardar,
              ...horas,
            },
            create: {
              cuadranteId: cuadrante.id,
              empleadoId: c.empleadoId,
              tipoTurnoId: tipoTurno.id,
              servicioEjecutorId: dto.servicioId,
              fecha: fechaUtc,
              esRotacion: Boolean(c.esRotacion),
              codigoPrevisto: codPrevGuardar,
              ...horas,
            },
          });
        }

        if (
          (cuadrante.estado === EstadoCuadrante.PUBLICADO ||
            cuadrante.estado === EstadoCuadrante.VALIDADO) &&
          cambiosReales.length > 0
        ) {
          const actor = req?.usuarioSso?.nombre
            ? `${req.usuarioSso.nombre} (${req.usuarioSso.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
            : 'Supervisión Asistencial';
          const anterioresUnicos = Array.from(new Set(cambiosReales.map((x) => x.anterior)))
            .slice(0, 4)
            .join(',');
          const nuevosUnicos = Array.from(new Set(cambiosReales.map((x) => x.nuevo)))
            .slice(0, 4)
            .join(',');
          const turnoAntResumen =
            anterioresUnicos === nuevosUnicos
              ? `${anterioresUnicos} (${cambiosReales.length})`
              : anterioresUnicos || 'MIX';
          const turnoNueResumen = nuevosUnicos || 'MIX';

          await tx.auditoriaCambio.create({
            data: {
              servicioId: dto.servicioId,
              actorId: actor,
              tipoAccion: 'ACCION_MASIVA',
              turnoAnterior: turnoAntResumen,
              turnoNuevo: turnoNueResumen,
              justificacion: `Ajuste en bloque sobre cuadrante publicado: ${cambiosReales.length} celda(s) modificada(s) en ${mes}/${anio} (${turnoAntResumen} → ${turnoNueResumen})`,
            },
          });
        }

        if (
          cuadrante.estado === EstadoCuadrante.PUBLICADO ||
          cuadrante.estado === EstadoCuadrante.VALIDADO
        ) {
          await this.liquidacionService.consolidarSaldosBancoServicio(
            dto.servicioId,
            anio,
            mes,
            new Map(),
            true,
            tx
          );
        }

        return { ok: true, totalGuardadas: celdasFiltradas.length };
      },
      { timeout: 20000 }
    );
  }

  /**
   * 5. Consulta de Novedades Oficiales persistidas en PostgreSQL (Caché local de Intranet)
   */
  @Get('novedades')
  async obtenerNovedades(
    @Query('anio') anioStr?: string,
    @Query('mes') mesStr?: string
  ) {
    const hoyCo = hoyColombiaIso();
    const anio = Number(anioStr) || Number(hoyCo.substring(0, 4));
    const mes = Number(mesStr) || Number(hoyCo.substring(5, 7));
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
    const hoyCo = hoyColombiaIso();
    const anio = Number(body?.anio) || Number(hoyCo.substring(0, 4));
    const mes = Number(body?.mes) || Number(hoyCo.substring(5, 7));
    const intranetUrl = this.obtenerIntranetUrl(body?.intranetUrl);

    let items: any[] = [];
    try {
      const resp = await fetch(`${intranetUrl}/api/intranet/novedades?mes=${mes}&anio=${anio}`, {
        headers: this.obtenerIntranetHeaders(),
      });
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

    await this.prisma.$transaction(
      async (tx) => {
        const mapaCuadrantes = new Map<string, { id: string; estado: EstadoCuadrante }>();
        const obtenerOCrearCuadranteMes = async (srvId: string, y: number, m: number) => {
          const k = `${srvId}::${y}-${m}`;
          const cacheado = mapaCuadrantes.get(k);
          if (cacheado) return cacheado;
          const cuad = await tx.cuadrante.upsert({
            where: {
              anio_mes_servicioId: { anio: y, mes: m, servicioId: srvId },
            },
            update: {},
            create: {
              anio: y,
              mes: m,
              servicioId: srvId,
              estado: EstadoCuadrante.BORRADOR,
            },
            select: { id: true, estado: true },
          });
          mapaCuadrantes.set(k, cuad);
          return cuad;
        };

        const serviciosPeriodosPublicados = new Map<
          string,
          { servicioId: string; anio: number; mes: number }
        >();

        for (const item of items) {
          const doc = String(item.empleadoDocumento || '').trim();
          if (!doc) continue;

          const emp = mapaEmpleados.get(doc);
          if (!emp) continue;

          const fInicioIso = String(item.fechaInicio || '').trim().substring(0, 10);
          const fFinIso = String(item.fechaFin || '').trim().substring(0, 10);
          if (!esFechaIsoValida(fInicioIso) || !esFechaIsoValida(fFinIso) || fInicioIso > fFinIso) {
            throw new BadRequestException(
              `Novedad con rango de fechas inválido para documento ${doc}: "${item.fechaInicio}" a "${item.fechaFin}".`
            );
          }

          const tipoNov = String(item.tipoNovedad || 'VAC').trim().toUpperCase();
          const fInicio = new Date(`${fInicioIso}T00:00:00.000Z`);
          const fFin = new Date(`${fFinIso}T23:59:59.999Z`);

          // Eliminar registros solapados previos del mismo empleado y tipo (evita residuos si cambió fechaInicio)
          await tx.novedadAusencia.deleteMany({
            where: {
              empleadoId: emp.id,
              tipo: tipoNov,
              fechaInicio: { lte: fFin },
              fechaFin: { gte: fInicio },
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

          // Bloquear todos los días y todos los meses abarcados por [fInicioIso .. fFinIso] (incluye cruces de mes/año)
          let diaIso = fInicioIso;
          while (diaIso <= fFinIso) {
            const anioDia = Number(diaIso.substring(0, 4));
            const mesDia = Number(diaIso.substring(5, 7));
            const cuad = await obtenerOCrearCuadranteMes(emp.servicioBaseId, anioDia, mesDia);
            const fechaUtc = new Date(`${diaIso}T00:00:00.000Z`);

            await tx.asignacionTurno.upsert({
              where: {
                empleadoId_fecha: {
                  empleadoId: emp.id,
                  fecha: fechaUtc,
                },
              },
              update: {
                cuadranteId: cuad.id,
                tipoTurnoId,
                servicioEjecutorId: emp.servicioBaseId,
                esRotacion: false,
                codigoPrevisto: tipoNov,
                hod: 0,
                hon: 0,
                hdfd: 0,
                hdfn: 0,
                hed: 0,
                hen: 0,
              },
              create: {
                cuadranteId: cuad.id,
                empleadoId: emp.id,
                tipoTurnoId,
                servicioEjecutorId: emp.servicioBaseId,
                fecha: fechaUtc,
                esRotacion: false,
                codigoPrevisto: tipoNov,
                hod: 0,
                hon: 0,
                hdfd: 0,
                hdfn: 0,
                hed: 0,
                hen: 0,
              },
            });
            celdasBloqueadas++;

            if (cuad.estado !== EstadoCuadrante.BORRADOR) {
              serviciosPeriodosPublicados.set(`${emp.servicioBaseId}::${anioDia}-${mesDia}`, {
                servicioId: emp.servicioBaseId,
                anio: anioDia,
                mes: mesDia,
              });
            }

            diaIso = sumarDiasIso(diaIso, 1);
          }

          novedadesProcesadas.push({
            empleadoId: emp.id,
            empleadoNombre: emp.nombre,
            documento: emp.documento,
            tipo: tipoNov,
            desde: fInicioIso,
            hasta: fFinIso,
            servicioCodigo: emp.servicioBase?.codigo,
            servicioNombre: emp.servicioBase?.nombre,
            cargo: emp.categoria?.nombre,
          });
        }

        const afectadosOrdenados = Array.from(serviciosPeriodosPublicados.values()).sort(
          (a, b) => a.anio * 100 + a.mes - (b.anio * 100 + b.mes)
        );
        for (const af of afectadosOrdenados) {
          await this.liquidacionService.consolidarSaldosBancoServicio(
            af.servicioId,
            af.anio,
            af.mes,
            new Map(),
            true,
            tx
          );
        }
      },
      { timeout: 20000 }
    );

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
  imports: [FestivosModule, LiquidacionModule],
  controllers: [CuadrantesController],
  providers: [CuadrantesReglasService],
})
export class CuadrantesModule {}
