import { Body, Controller, Get, Injectable, Module, Post, Put, Query } from '@nestjs/common';
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

    if (
      (dto.turnoPrevioDiaAnterior === 'N' ||
        dto.turnoPrevioDiaAnterior === 'N8' ||
        dto.turnoPrevioDiaAnterior === 'N12' ||
        dto.turnoPrevioDiaAnterior === 'G24') &&
      ['M', 'M8', 'M6', 'T', 'T8', 'T6', 'N', 'N8', 'N12', 'D12', 'G12', 'G24'].includes(
        dto.turnoPropuesto
      )
    ) {
      alertas.push(
        `RN-01 / RN-02 Bloqueante: Infracción Post-Guardia y descanso < 12h. El día previo finalizó en ${dto.turnoPrevioDiaAnterior}, requiere Saliente (S) o Libre (L).`
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
        where: { anio },
      }),
      this.prisma.asignacionTurno.findMany({
        where: {
          cuadrante: { anio },
        },
        include: {
          tipoTurno: true,
          cuadrante: true,
        },
      }),
      this.prisma.bancoHorasSaldo.findMany({
        where: { anio },
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
  async actualizarEstadoCuadrante(@Body() dto: ActualizarEstadoCuadranteDto) {
    const estadoEnum = dto.estado as EstadoCuadrante;

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

    if (
      dto.estado === 'CERRADO_NOMINA' &&
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
  async guardarCelda(@Body() dto: GuardarCeldaCuadranteDto) {
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    const dia = Number(dto.dia);

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

    const tipoTurnoId = await this.resolverTipoTurnoId(dto.codigo);
    const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia));

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

    return { ok: true, id: asignacion.id };
  }

  /**
   * 4. Guarda en lote múltiples celdas de un cuadrante (usado en Dejar en Blanco y Auto-Balancear Huecos).
   */
  @Put('lote')
  async guardarLote(@Body() dto: GuardarLoteCuadranteDto) {
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

    // Asegurar que todos los códigos de turno del lote estén resueltos en caché
    const codigosUnicos = Array.from(new Set(dto.celdas.map((c) => c.codigo || '')));
    const mapaIds = new Map<string, string>();
    for (const cod of codigosUnicos) {
      mapaIds.set(cod, await this.resolverTipoTurnoId(cod));
    }

    await this.prisma.$transaction(
      dto.celdas.map((c) => {
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

    return { ok: true, totalGuardadas: dto.celdas.length };
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
