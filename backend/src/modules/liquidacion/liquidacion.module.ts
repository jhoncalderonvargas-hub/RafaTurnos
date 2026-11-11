import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleInit,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { extraerReglasDeEmpleado } from '../empresas/empresas-matching.util';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';
import {
  calcularDiasCompensatoriosDominicales,
  calcularMetaMensualPorDiasHabiles,
  CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS,
  contarDiasHabilesMes,
  contarDiasHabilesProrrateados,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  esDomingo,
  esTurnoProrrateable,
  evaluarJornadaSemanalPeriodo,
  hoyColombiaIso,
  ItemPeriodo,
  liquidarPeriodo,
  liquidarTurno,
  obtenerHorasAmortizacionTurno,
  PLANTILLA_CST_LEY_2466,
  PLANTILLA_DECRETO_1042,
  PLANTILLA_PERSONALIZADA_DEFAULT,
  r2,
  RECARGO_EXTRA_DIURNA,
  RECARGO_EXTRA_NOCTURNA,
  RECARGO_NOCTURNO,
  recargosVigentes,
  ReglasEmpresaContrato,
  resumenNormativoPeriodo,
  SEMAFORO_BANCO_HORAS,
  sumarDiasIso,
  TOPE_HORAS_EXTRAS_SEMANALES,
  TurnoLiquidable,
  VIGENCIAS_INICIO_NOCTURNO,
  VIGENCIAS_JORNADA_SEMANAL,
  VIGENCIAS_RECARGO_DOMINICAL,
} from '../../shared/liquidacion-horas';

export interface TipoTurnoLiquidableDb {
  id: string;
  codigo: string;
  nombre: string;
  horaInicio: string;
  horaFin: string;
  horasOrdinarias: number;
  horasDiurnas: number;
  horasNocturnas: number;
  minutosAlmuerzo: number;
  descuentaBancoHoras: boolean;
  modoAmortizacionBanco?: string;
  horasAmortizacionBanco?: number | null;
  prorrateaMetaContrato?: boolean;
  esAusencia?: boolean;
  bloqueaPermutas?: boolean;
  esNocturnoPesado: boolean;
  esSistemaObligatorio?: boolean;
  visibleEnPaleta?: boolean;
  activo?: boolean;
}

export interface HorasPersistibles {
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  hed: number;
  hen: number;
}

export function toTurnoLiquidable(
  tipo: Partial<TipoTurnoLiquidableDb> | null | undefined,
  codigo?: string
): TurnoLiquidable | null {
  if (!tipo) return null;
  const cod = (tipo.codigo || codigo || '').trim().toUpperCase();
  const esAusencia =
    typeof tipo.esAusencia === 'boolean' ? tipo.esAusencia : esCodigoExoneracionContrato(cod);
  const prorrateaMetaContrato =
    typeof tipo.prorrateaMetaContrato === 'boolean'
      ? tipo.prorrateaMetaContrato
      : esCodigoExoneracionContrato(cod);
  const bloqueaPermutas =
    typeof tipo.bloqueaPermutas === 'boolean'
      ? tipo.bloqueaPermutas
      : esCodigoExoneracionContrato(cod);

  return {
    codigo: cod || undefined,
    horaInicio: tipo.horaInicio,
    horaFin: tipo.horaFin,
    horasOrdinarias: Number(tipo.horasOrdinarias) || 0,
    horasDiurnas: Number(tipo.horasDiurnas) || 0,
    horasNocturnas: Number(tipo.horasNocturnas) || 0,
    minutosAlmuerzo: Number(tipo.minutosAlmuerzo) || 0,
    esAusencia,
    prorrateaMetaContrato,
    bloqueaPermutas,
    descuentaBancoHoras: Boolean(tipo.descuentaBancoHoras),
    modoAmortizacionBanco:
      tipo.modoAmortizacionBanco ?? (cod === 'COMP' ? 'DIA_HABIL_EMPRESA' : 'HORAS_FIJAS'),
    horasAmortizacionBanco: tipo.horasAmortizacionBanco ?? null,
  };
}

@Injectable()
export class LiquidacionService implements OnModuleInit {
  private readonly logger = new Logger(LiquidacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly festivosService: FestivosColombiaService
  ) {}

  onModuleInit(): void {
    this.festivosService.registrarListenerCambio(async (anio) => {
      await this.recalcularAnioYVispera(anio);
    });
  }

  private predicadoFestivo() {
    return (fechaIso: string) => this.festivosService.esFestivo(fechaIso);
  }

  private predicadoDescanso() {
    return (fechaIso: string) => esDomingo(fechaIso) || this.festivosService.esFestivo(fechaIso);
  }

  resolverReglasEmpleado(emp?: {
    empresaContratante?: Partial<ReglasEmpresaContrato> | null;
    horasSemanalesOverride?: number | null;
    horasSemanalesLey?: number | null;
  } | null): ReglasEmpresaContrato {
    return extraerReglasDeEmpleado(emp);
  }

  /** Calcula las horas legales (HOD, HON, HDFD, HDFN) de un turno que inicia en `fechaUtc` aplicando las reglas de la empresa. */
  async calcularHorasPorTipo(
    tipo: Partial<TipoTurnoLiquidableDb> | null | undefined,
    fechaUtc: Date,
    reglas?: Partial<ReglasEmpresaContrato> | null
  ): Promise<HorasPersistibles> {
    if (!tipo) {
      return { hod: 0, hon: 0, hdfd: 0, hdfn: 0, hed: 0, hen: 0 };
    }
    const cod = (tipo.codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') {
      return { hod: 0, hon: 0, hdfd: 0, hdfn: 0, hed: 0, hen: 0 };
    }
    const fechaIso = fechaUtc.toISOString().substring(0, 10);
    const sigIso = sumarDiasIso(fechaIso, 1);
    await this.festivosService.asegurarAnios([
      Number(fechaIso.substring(0, 4)),
      Number(sigIso.substring(0, 4)),
    ]);

    const turnoLiq = toTurnoLiquidable(tipo, cod);
    const liq = liquidarTurno(turnoLiq, fechaIso, this.predicadoDescanso(), reglas);
    return {
      hod: liq.hod,
      hon: liq.hon,
      hdfd: liq.hdfd,
      hdfn: liq.hdfn,
      hed: 0,
      hen: 0,
    };
  }

  async calcularHorasPorCodigo(
    codigo: string,
    fechaUtc: Date,
    reglas?: Partial<ReglasEmpresaContrato> | null
  ): Promise<HorasPersistibles> {
    const cod = (codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') {
      return { hod: 0, hon: 0, hdfd: 0, hdfn: 0, hed: 0, hen: 0 };
    }
    const tipo = await this.prisma.tipoTurno.findUnique({ where: { codigo: cod } });
    return this.calcularHorasPorTipo(tipo, fechaUtc, reglas);
  }

  /** Recalcula y persiste `hod, hon, hdfd, hdfn` en un subconjunto filtrado de `asignaciones_turno`. */
  async recalcularAsignaciones(
    whereClause: Record<string, any> = {},
    tx?: Prisma.TransactionClient
  ): Promise<{
    evaluadas: number;
    actualizadas: number;
  }> {
    const db = tx || this.prisma;
    const asignaciones = await db.asignacionTurno.findMany({
      where: whereClause,
      include: {
        tipoTurno: true,
        empleado: {
          select: {
            horasSemanalesOverride: true,
            horasSemanalesLey: true,
            empresaContratante: true,
          },
        },
      },
    });
    if (asignaciones.length === 0) {
      return { evaluadas: 0, actualizadas: 0 };
    }

    const aniosSet = new Set<number>();
    for (const a of asignaciones) {
      const y = new Date(a.fecha).getUTCFullYear();
      aniosSet.add(y);
      aniosSet.add(y + 1);
    }
    await this.festivosService.asegurarAnios(Array.from(aniosSet));

    const pred = this.predicadoDescanso();
    const pendientes: Array<{ id: string } & HorasPersistibles> = [];

    for (const a of asignaciones) {
      const fechaIso = new Date(a.fecha).toISOString().substring(0, 10);
      const cod = (a.tipoTurno?.codigo || '').trim().toUpperCase();
      const reglas = this.resolverReglasEmpleado((a as any).empleado);
      const liq =
        !cod || cod === 'BLANCO'
          ? { hod: 0, hon: 0, hdfd: 0, hdfn: 0 }
          : liquidarTurno(toTurnoLiquidable(a.tipoTurno, cod), fechaIso, pred, reglas);

      if (
        Math.abs((a.hod || 0) - liq.hod) > 0.001 ||
        Math.abs((a.hon || 0) - liq.hon) > 0.001 ||
        Math.abs((a.hdfd || 0) - liq.hdfd) > 0.001 ||
        Math.abs((a.hdfn || 0) - liq.hdfn) > 0.001 ||
        (a.hed || 0) !== 0 ||
        (a.hen || 0) !== 0
      ) {
        pendientes.push({
          id: a.id,
          hod: liq.hod,
          hon: liq.hon,
          hdfd: liq.hdfd,
          hdfn: liq.hdfn,
          hed: 0,
          hen: 0,
        });
      }
    }

    const CHUNK = 200;
    for (let i = 0; i < pendientes.length; i += CHUNK) {
      const lote = pendientes.slice(i, i + CHUNK);
      const ops = lote.map((item) =>
        db.asignacionTurno.update({
          where: { id: item.id },
          data: {
            hod: item.hod,
            hon: item.hon,
            hdfd: item.hdfd,
            hdfn: item.hdfn,
            hed: item.hed,
            hen: item.hen,
          },
        })
      );
      if (tx) {
        await Promise.all(ops);
      } else {
        await this.prisma.$transaction(ops);
      }
    }

    return { evaluadas: asignaciones.length, actualizadas: pendientes.length };
  }

  /**
   * Recalcula todo el año `anio` más el 31 de diciembre de `anio - 1` (turnos que cruzan medianoche hacia ene-1),
   * respetando la inmutabilidad estricta de cuadrantes en estado `CERRADO_NOMINA`.
   */
  async recalcularAnioYVispera(anio: number): Promise<{ evaluadas: number; actualizadas: number }> {
    const desde = new Date(Date.UTC(anio - 1, 11, 31));
    const hasta = new Date(Date.UTC(anio, 11, 31, 23, 59, 59));
    const res = await this.recalcularAsignaciones({
      fecha: { gte: desde, lte: hasta },
      cuadrante: { estado: { not: 'CERRADO_NOMINA' } },
    });

    // Reconsolidar saldos abiertos de Banco de Horas en cuadrantes PUBLICADO / VALIDADO del año afectado (nunca CERRADO_NOMINA)
    const abiertos = await this.prisma.cuadrante?.findMany({
      where: {
        OR: [{ anio }, { anio: anio - 1, mes: 12 }],
        estado: { in: ['PUBLICADO', 'VALIDADO'] },
      },
      select: { servicioId: true, anio: true, mes: true },
    });
    if (Array.isArray(abiertos) && abiertos.length > 0) {
      const primerPorSrv = new Map<string, { anio: number; mes: number }>();
      for (const c of abiertos) {
        const curNum = c.anio * 100 + c.mes;
        const prev = primerPorSrv.get(c.servicioId);
        if (!prev || curNum < prev.anio * 100 + prev.mes) {
          primerPorSrv.set(c.servicioId, { anio: c.anio, mes: c.mes });
        }
      }
      for (const [srvId, per] of primerPorSrv.entries()) {
        await this.consolidarSaldosBancoServicio(srvId, per.anio, per.mes, new Map(), true);
      }
    }

    if (res.actualizadas > 0) {
      this.logger.log(
        `Recalculadas ${res.actualizadas}/${res.evaluadas} asignaciones tras cambio normativo/festivos de ${anio} (periodos CERRADO_NOMINA protegidos).`
      );
    }
    return res;
  }

  async recalcularPorTipoTurno(tipoTurnoId: string): Promise<{ evaluadas: number; actualizadas: number }> {
    const res = await this.recalcularAsignaciones({
      tipoTurnoId,
      cuadrante: { estado: { not: 'CERRADO_NOMINA' } },
    });

    // Propagar también al Banco de Horas de cuadrantes PUBLICADOS afectados (sin tocar CERRADO_NOMINA)
    const asigsAfectadas = await this.prisma.asignacionTurno.findMany({
      where: {
        tipoTurnoId,
        cuadrante: { estado: { in: ['PUBLICADO', 'VALIDADO'] } },
      },
      select: {
        cuadrante: { select: { servicioId: true, anio: true, mes: true } },
        empleado: { select: { servicioBaseId: true } },
      },
    });
    const primerPeriodoPorSrv = new Map<string, { anio: number; mes: number }>();
    for (const row of asigsAfectadas) {
      for (const srvId of new Set([row.cuadrante.servicioId, row.empleado.servicioBaseId])) {
        const prev = primerPeriodoPorSrv.get(srvId);
        const curNum = row.cuadrante.anio * 100 + row.cuadrante.mes;
        if (!prev || curNum < prev.anio * 100 + prev.mes) {
          primerPeriodoPorSrv.set(srvId, { anio: row.cuadrante.anio, mes: row.cuadrante.mes });
        }
      }
    }
    for (const [srvId, per] of primerPeriodoPorSrv.entries()) {
      await this.consolidarSaldosBancoServicio(srvId, per.anio, per.mes, new Map(), true);
    }

    return res;
  }

  /**
   * Recalcula asignaciones y saldos abiertos (`BORRADOR`, `PUBLICADO`, `VALIDADO`) cuando Talento Humano
   * actualiza los parámetros de una `EmpresaContratante`. Respeta estrictamente `CERRADO_NOMINA`.
   */
  async recalcularPorEmpresa(empresaId: string): Promise<{ evaluadas: number; actualizadas: number }> {
    const res = await this.recalcularAsignaciones({
      empleado: { empresaContratanteId: empresaId },
      cuadrante: { estado: { not: 'CERRADO_NOMINA' } },
    });

    const cuadrantesAbiertos = await this.prisma.cuadrante.findMany({
      where: {
        estado: { in: ['PUBLICADO', 'VALIDADO'] },
        OR: [
          { servicio: { empleadosBase: { some: { empresaContratanteId: empresaId } } } },
          { asignaciones: { some: { empleado: { empresaContratanteId: empresaId } } } },
        ],
      },
      select: { servicioId: true, anio: true, mes: true },
    });

    const primerPorSrv = new Map<string, { anio: number; mes: number }>();
    for (const c of cuadrantesAbiertos) {
      const curNum = c.anio * 100 + c.mes;
      const prev = primerPorSrv.get(c.servicioId);
      if (!prev || curNum < prev.anio * 100 + prev.mes) {
        primerPorSrv.set(c.servicioId, { anio: c.anio, mes: c.mes });
      }
    }
    for (const [srvId, per] of primerPorSrv.entries()) {
      await this.consolidarSaldosBancoServicio(srvId, per.anio, per.mes, new Map(), true);
    }

    return res;
  }

  /**
   * Consolida y retorna los saldos del Banco de Horas de `servicioId` en `(anio, mes)` calculados
   * autoritativamente desde PostgreSQL `asignaciones_turno`, `tipos_turno` y `empresas_contratantes`.
   * Si `cascada = true`, encadena el recálculo hacia meses posteriores abiertos (`PUBLICADO` / `VALIDADO`),
   * protegiendo `CERRADO_NOMINA`.
   */
  async consolidarSaldosBancoServicio(
    servicioId: string,
    anio: number,
    mes: number,
    fallbacksSaldoInicial = new Map<string, number>(),
    cascada = true,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const db = tx || this.prisma;
    const primerDia = new Date(Date.UTC(anio, mes - 1, 1));
    const ultimoDia = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));

    await this.festivosService.asegurarAnios([anio, anio + 1]);
    const pred = this.predicadoDescanso();
    const predFest = this.predicadoFestivo();
    const resumenHabiles = contarDiasHabilesMes(anio, mes, predFest);

    const extraEmpIds = Array.from(fallbacksSaldoInicial.keys());
    const empleados = await db.empleado.findMany({
      where: {
        OR: [
          { servicioBaseId: servicioId },
          ...(extraEmpIds.length > 0 ? [{ id: { in: extraEmpIds } }] : []),
        ],
      },
      include: {
        empresaContratante: true,
      },
    });
    if (empleados.length === 0) return;

    const empIds = empleados.map((e) => e.id);
    const [asignacionesMes, saldosPreviosDb] = await Promise.all([
      db.asignacionTurno.findMany({
        where: {
          empleadoId: { in: empIds },
          fecha: { gte: primerDia, lte: ultimoDia },
        },
        include: { tipoTurno: true },
      }),
      // Busca el último saldo consolidado estrictamente anterior a (anio, mes), soportando saltos de mes
      db.bancoHorasSaldo.findMany({
        where: {
          empleadoId: { in: empIds },
          OR: [{ anio: { lt: anio } }, { anio, mes: { lt: mes } }],
        },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
        select: { empleadoId: true, saldoFinalAcumulado: true },
      }),
    ]);

    const mapaPrevDb = new Map<string, number>();
    for (const s of saldosPreviosDb) {
      if (!mapaPrevDb.has(s.empleadoId)) {
        mapaPrevDb.set(s.empleadoId, s.saldoFinalAcumulado);
      }
    }

    const asigsPorEmp = new Map<string, typeof asignacionesMes>();
    for (const a of asignacionesMes) {
      const lista = asigsPorEmp.get(a.empleadoId) || [];
      lista.push(a);
      asigsPorEmp.set(a.empleadoId, lista);
    }

    const upserts = empleados.map((emp) => {
      const reglas = this.resolverReglasEmpleado(emp as any);
      const empresaCodigoSnapshot =
        (emp as any).empresaContratante?.codigo || reglas.codigo || 'CST_DEFAULT';
      const lista = asigsPorEmp.get(emp.id) || [];
      let horasAmortizadasComp = 0;
      const items: ItemPeriodo[] = [];

      for (const a of lista) {
        const cod = (a.tipoTurno?.codigo || '').trim().toUpperCase();
        if (!cod || cod === 'BLANCO') continue;
        const turnoLiq = toTurnoLiquidable(a.tipoTurno, cod);
        horasAmortizadasComp += obtenerHorasAmortizacionTurno(
          turnoLiq,
          reglas.horasSemanalesContrato,
          reglas.diasBaseSemana
        );
        items.push({
          fechaIso: new Date(a.fecha).toISOString().substring(0, 10),
          codigo: cod,
          turno: turnoLiq,
        });
      }
      horasAmortizadasComp = r2(horasAmortizadasComp);
      const horasTrabajadas = liquidarPeriodo(items, pred, reglas).total;
      const diasHabilesProrrateados = contarDiasHabilesProrrateados(items, predFest);
      const meta = calcularMetaMensualPorDiasHabiles(
        reglas.horasSemanalesContrato,
        resumenHabiles.diasHabilesMes,
        diasHabilesProrrateados,
        reglas.diasBaseSemana
      );
      const saldoInicial = r2(
        mapaPrevDb.get(emp.id) ?? fallbacksSaldoInicial.get(emp.id) ?? 0
      );
      const tieneTurnosOperativos = horasTrabajadas > 0 || horasAmortizadasComp > 0;
      const diferenciaMes =
        reglas.usaBancoHoras === false
          ? 0
          : tieneTurnosOperativos
            ? r2(horasTrabajadas - meta.horasContratadasEfectivas - horasAmortizadasComp)
            : 0;
      const saldoFinalAcumulado = r2(saldoInicial + diferenciaMes);

      return db.bancoHorasSaldo.upsert({
        where: {
          empleadoId_anio_mes: { empleadoId: emp.id, anio, mes },
        },
        update: {
          saldoInicial,
          horasTrabajadas,
          horasContratadasNominales: meta.horasContratadasNominales,
          horasExoneradas: meta.horasExoneradas,
          horasContratadas: meta.horasContratadasEfectivas,
          diasHabilesMes: meta.diasHabilesMes,
          diasHabilesProrrateados: meta.diasHabilesProrrateados,
          horasSemanalesAplicadas: meta.horasSemanalesAplicadas,
          empresaCodigoSnapshot,
          horasAmortizadasComp,
          diferenciaMes,
          saldoFinalAcumulado,
        },
        create: {
          empleadoId: emp.id,
          anio,
          mes,
          saldoInicial,
          horasTrabajadas,
          horasContratadasNominales: meta.horasContratadasNominales,
          horasExoneradas: meta.horasExoneradas,
          horasContratadas: meta.horasContratadasEfectivas,
          diasHabilesMes: meta.diasHabilesMes,
          diasHabilesProrrateados: meta.diasHabilesProrrateados,
          horasSemanalesAplicadas: meta.horasSemanalesAplicadas,
          empresaCodigoSnapshot,
          horasAmortizadasComp,
          diferenciaMes,
          saldoFinalAcumulado,
        },
      });
    });

    if (tx) {
      for (const op of upserts) {
        await op;
      }
    } else {
      await this.prisma.$transaction(upserts);
    }

    if (cascada) {
      await this.recalcularCascadaPosterior(servicioId, empIds, anio, mes, db);
    }
  }

  /**
   * Elimina los saldos consolidados del mes revertido a BORRADOR y recalcula en cascada
   * los periodos posteriores abiertos (`PUBLICADO` / `VALIDADO`) para mantener la continuidad del arrastre
   * sin alterar jamás periodos ya cerrados en `CERRADO_NOMINA`.
   */
  async invalidarSaldosMesYCascada(
    servicioId: string,
    anio: number,
    mes: number,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const db = tx || this.prisma;
    const empleados = await db.empleado.findMany({
      where: { servicioBaseId: servicioId },
      select: { id: true },
    });
    if (empleados.length === 0) return;

    const empIds = empleados.map((e) => e.id);
    await db.bancoHorasSaldo.deleteMany({
      where: {
        empleadoId: { in: empIds },
        anio,
        mes,
      },
    });

    await this.recalcularCascadaPosterior(servicioId, empIds, anio, mes, db);
  }

  private async recalcularCascadaPosterior(
    servicioId: string,
    empIds: string[],
    anio: number,
    mes: number,
    db: Prisma.TransactionClient | PrismaService
  ): Promise<void> {
    const [cuadrantesPost, saldosPost] = await Promise.all([
      db.cuadrante.findMany({
        where: {
          servicioId,
          OR: [{ anio: { gt: anio } }, { anio, mes: { gt: mes } }],
        },
        select: { anio: true, mes: true, estado: true },
      }),
      db.bancoHorasSaldo.findMany({
        where: {
          empleadoId: { in: empIds },
          OR: [{ anio: { gt: anio } }, { anio, mes: { gt: mes } }],
        },
        distinct: ['anio', 'mes'],
        select: { anio: true, mes: true },
      }),
    ]);

    const periodosNoRecalculables = new Set<string>(
      cuadrantesPost
        .filter((c) => c.estado === 'CERRADO_NOMINA' || c.estado === 'BORRADOR')
        .map((c) => `${c.anio}-${c.mes}`)
    );

    const mapaPeriodos = new Map<string, { anio: number; mes: number }>();
    for (const c of cuadrantesPost) {
      if (c.estado === 'PUBLICADO' || c.estado === 'VALIDADO') {
        mapaPeriodos.set(`${c.anio}-${c.mes}`, { anio: c.anio, mes: c.mes });
      }
    }
    for (const p of saldosPost) {
      const k = `${p.anio}-${p.mes}`;
      if (!periodosNoRecalculables.has(k)) {
        mapaPeriodos.set(k, { anio: p.anio, mes: p.mes });
      }
    }

    const periodosOrdenados = Array.from(mapaPeriodos.values()).sort(
      (a, b) => a.anio * 100 + a.mes - (b.anio * 100 + b.mes)
    );

    const txAsArg = db === this.prisma ? undefined : (db as Prisma.TransactionClient);
    for (const p of periodosOrdenados) {
      await this.consolidarSaldosBancoServicio(
        servicioId,
        p.anio,
        p.mes,
        new Map(),
        false,
        txAsArg
      );
    }
  }

  /** Liquidación completa y autoritativa de un periodo (anio, mes) para Nómina / auditoría. */
  async liquidarPeriodoConsulta(anio: number, mes: number, servicioId?: string) {
    const primerDia = new Date(Date.UTC(anio, mes - 1, 1));
    const ultimoDia = new Date(Date.UTC(anio, mes, 0, 23, 59, 59));
    const primerDiaIso = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const primerDiaBorde = new Date(Date.UTC(anio, mes - 1, 1 - 21));

    await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);
    const pred = this.predicadoDescanso();
    const predFest = this.predicadoFestivo();
    const resumenHabiles = contarDiasHabilesMes(anio, mes, predFest);

    const empleados = await this.prisma.empleado.findMany({
      where: servicioId
        ? {
            OR: [
              { servicioBaseId: servicioId },
              {
                asignaciones: {
                  some: {
                    servicioEjecutorId: servicioId,
                    fecha: { gte: primerDia, lte: ultimoDia },
                  },
                },
              },
            ],
          }
        : {},
      include: {
        servicioBase: { select: { id: true, codigo: true, nombre: true } },
        categoria: { select: { nombre: true } },
        empresaContratante: true,
      },
      orderBy: [{ servicioBase: { nombre: 'asc' } }, { nombre: 'asc' }],
    });

    const empIds = empleados.map((e) => e.id);
    const asignacionesVentana =
      empIds.length > 0
        ? await this.prisma.asignacionTurno.findMany({
            where: {
              empleadoId: { in: empIds },
              fecha: { gte: primerDiaBorde, lte: ultimoDia },
            },
            include: { tipoTurno: true },
            orderBy: { fecha: 'asc' },
          })
        : [];

    const porEmpVentana = new Map<string, typeof asignacionesVentana>();
    for (const a of asignacionesVentana) {
      const lista = porEmpVentana.get(a.empleadoId) || [];
      lista.push(a);
      porEmpVentana.set(a.empleadoId, lista);
    }

    let pendientesRecalculo = 0;
    const colaboradores = empleados.map((emp) => {
      const reglas = this.resolverReglasEmpleado(emp as any);
      const empresaDb = (emp as any).empresaContratante;
      const ventanaEmp = porEmpVentana.get(emp.id) || [];
      const esRotacionExterna = Boolean(servicioId && emp.servicioBaseId !== servicioId);

      const itemsMes: ItemPeriodo[] = [];
      const itemsVentanaSemanal: ItemPeriodo[] = [];
      let turnosComp = 0;
      let horasAmortizadasComp = 0;
      let diasVac = 0;
      let diasInc = 0;
      let diasLic = 0;
      let diasFam = 0;
      let diasProrrateoOtro = 0;

      for (const a of ventanaEmp) {
        const cod = (a.tipoTurno?.codigo || '').trim().toUpperCase();
        if (!cod || cod === 'BLANCO') continue;

        const fechaUtc = new Date(a.fecha);
        const fechaIso = fechaUtc.toISOString().substring(0, 10);
        const turno = toTurnoLiquidable(a.tipoTurno, cod);
        itemsVentanaSemanal.push({ fechaIso, codigo: cod, turno });

        if (fechaUtc < primerDia || fechaUtc > ultimoDia) continue;

        if (!esRotacionExterna || a.servicioEjecutorId === servicioId) {
          if (cod === 'VAC') diasVac++;
          else if (cod === 'INC') diasInc++;
          else if (cod === 'LIC') diasLic++;
          else if (cod === 'FAM') diasFam++;
          else if (esTurnoProrrateable(turno, cod)) diasProrrateoOtro++;

          if (a.tipoTurno?.descuentaBancoHoras) {
            turnosComp++;
            horasAmortizadasComp += obtenerHorasAmortizacionTurno(
              turno,
              reglas.horasSemanalesContrato,
              reglas.diasBaseSemana
            );
          }

          itemsMes.push({ fechaIso, codigo: cod, turno });

          const liqCelda = liquidarTurno(turno, fechaIso, pred, reglas);
          if (
            Math.abs((a.hod || 0) - liqCelda.hod) > 0.001 ||
            Math.abs((a.hon || 0) - liqCelda.hon) > 0.001 ||
            Math.abs((a.hdfd || 0) - liqCelda.hdfd) > 0.001 ||
            Math.abs((a.hdfn || 0) - liqCelda.hdfn) > 0.001
          ) {
            pendientesRecalculo++;
          }
        }
      }

      const liq = liquidarPeriodo(itemsMes, pred, reglas);
      const semanalRaw = evaluarJornadaSemanalPeriodo(itemsVentanaSemanal, reglas);
      const semanasDelMes = semanalRaw.semanas.filter((s) => s.semanaFinIso >= primerDiaIso);
      const promediosDelMes = semanalRaw.promedios3SemanasExcedidos.filter(
        (p) => p.hastaSemana >= primerDiaIso
      );
      const semanal = {
        ...semanalRaw,
        semanas: semanasDelMes,
        promedios3SemanasExcedidos: promediosDelMes,
        semanasSobreOrdinario: semanasDelMes.filter((s) => s.excedeOrdinario).length,
        semanasSobreTopeAbsoluto: semanasDelMes.filter((s) => s.excedeTopeAbsoluto).length,
        tieneInfraccionSemanal:
          semanasDelMes.some((s) => s.excedeTopeAbsoluto) || promediosDelMes.length > 0,
      };

      const diasCompensatoriosCausados = calcularDiasCompensatoriosDominicales(
        liq.domingosLaborados
      );
      const causaCompensatorioDominical = diasCompensatoriosCausados > 0;
      const diasHabilesProrrateados = contarDiasHabilesProrrateados(itemsMes, predFest);
      const meta = calcularMetaMensualPorDiasHabiles(
        reglas.horasSemanalesContrato,
        resumenHabiles.diasHabilesMes,
        esRotacionExterna ? 0 : diasHabilesProrrateados,
        reglas.diasBaseSemana
      );
      const normativaColaborador = resumenNormativoPeriodo(anio, mes, reglas);

      return {
        empleadoId: emp.id,
        documento: emp.documento,
        nombre: emp.nombre,
        servicioId: emp.servicioBaseId,
        servicioCodigo: emp.servicioBase?.codigo || '',
        servicioNombre: emp.servicioBase?.nombre || '',
        esRotacionExterna,
        cargo: emp.categoria?.nombre || '',
        empresaContratanteId: emp.empresaContratanteId || empresaDb?.id || null,
        empresaCodigo: empresaDb?.codigo || reglas.codigo || 'CST_DEFAULT',
        empresaNombre: empresaDb?.nombre || reglas.nombre || 'Régimen CST',
        empresaEstadoConfiguracion: empresaDb?.estadoConfiguracion || 'CONFIRMADA',
        plantillaNormativa: empresaDb?.plantillaNormativa || reglas.plantillaNormativa || 'CST_LEY_2466',
        horasSemanalesAplicadas: meta.horasSemanalesAplicadas,
        diasHabilesMes: meta.diasHabilesMes,
        diasHabilesProrrateados: esRotacionExterna ? 0 : meta.diasHabilesProrrateados,
        usaBancoHoras: reglas.usaBancoHoras !== false,
        normativaColaborador,
        horasContratoMes: meta.horasContratadasEfectivas,
        horasContratadasNominales: meta.horasContratadasNominales,
        horasExoneradas: meta.horasExoneradas,
        horasContratadasEfectivas: meta.horasContratadasEfectivas,
        hod: liq.hod,
        hon: liq.hon,
        hdfd: liq.hdfd,
        hdfn: liq.hdfn,
        hed: 0,
        hen: 0,
        horasTrabajadas: liq.total,
        diasDescansoLaborados: liq.diasDescansoLaborados,
        fechasDescansoLaboradas: liq.fechasDescansoLaboradas,
        domingosLaborados: liq.domingosLaborados,
        fechasDomingosLaborados: liq.fechasDomingosLaborados,
        causaCompensatorioDominical,
        diasCompensatoriosCausados,
        turnosCompensatoriosTomados: turnosComp,
        horasAmortizadasComp: r2(horasAmortizadasComp),
        diasVac,
        diasInc,
        diasLic,
        diasFam,
        diasProrrateoOtro,
        evaluacionSemanal: semanal,
      };
    });

    const resumenNormativo = resumenNormativoPeriodo(anio, mes);
    return {
      periodo: `${anio}-${String(mes).padStart(2, '0')}`,
      anio,
      mes,
      diasDelMes: resumenHabiles.diasDelMes,
      diasHabilesMes: resumenHabiles.diasHabilesMes,
      servicioId: servicioId || 'TODOS',
      normativaVigente: resumenNormativo,
      pendientesRecalculo,
      totalColaboradores: colaboradores.length,
      colaboradores,
    };
  }

  async obtenerCodigosNoLaboradosDinamicos(): Promise<string[]> {
    try {
      const noLab = await this.prisma.tipoTurno.findMany({
        where: { activo: true, horasOrdinarias: { lte: 0 }, codigo: { not: 'BLANCO' } },
        select: { codigo: true },
        orderBy: { codigo: 'asc' },
      });
      if (Array.isArray(noLab) && noLab.length > 0) {
        return noLab.map((t) => t.codigo);
      }
    } catch {}
    return Array.from(CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS).filter((c) => c !== 'BLANCO');
  }
}

@Controller('api/v1/liquidacion')
export class LiquidacionController {
  constructor(private readonly service: LiquidacionService) {}

  @Get('vigencias')
  async obtenerVigencias(@Query('anio') anioStr?: string, @Query('mes') mesStr?: string) {
    const hoy = hoyColombiaIso();
    const anio = Number(anioStr) || Number(hoy.substring(0, 4));
    const mes = Number(mesStr) || Number(hoy.substring(5, 7));
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('Parámetros anio y mes inválidos.');
    }

    const codigosNoLaborados = await this.service.obtenerCodigosNoLaboradosDinamicos();

    return {
      fechaReferenciaColombia: hoy,
      zonaHorariaOficial: 'America/Bogota',
      periodo: `${anio}-${String(mes).padStart(2, '0')}`,
      resumenPeriodo: resumenNormativoPeriodo(anio, mes),
      recargosHoy: recargosVigentes(hoy),
      plantillasEmpresa: {
        DECRETO_1042: PLANTILLA_DECRETO_1042,
        CST_LEY_2466: PLANTILLA_CST_LEY_2466,
        PERSONALIZADA: PLANTILLA_PERSONALIZADA_DEFAULT,
      },
      parametrosBase: {
        recargoNocturno: RECARGO_NOCTURNO,
        recargoExtraDiurna: RECARGO_EXTRA_DIURNA,
        recargoExtraNocturna: RECARGO_EXTRA_NOCTURNA,
        descansoMinimoEntreTurnosMinutos: DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
        topeExtrasSemanalesHoras: TOPE_HORAS_EXTRAS_SEMANALES,
        semaforoBancoHoras: SEMAFORO_BANCO_HORAS,
        codigosNoLaborados,
      },
      tablasHistoricas: {
        inicioNocturno: VIGENCIAS_INICIO_NOCTURNO,
        recargoDominicalFestivo: VIGENCIAS_RECARGO_DOMINICAL,
        jornadaMaximaSemanal: VIGENCIAS_JORNADA_SEMANAL,
      },
    };
  }

  @Get('periodo')
  consultarLiquidacionPeriodo(
    @Query('anio') anioStr?: string,
    @Query('mes') mesStr?: string,
    @Query('servicioId') servicioId?: string
  ) {
    const hoy = hoyColombiaIso();
    const anio = Number(anioStr) || Number(hoy.substring(0, 4));
    const mes = Number(mesStr) || Number(hoy.substring(5, 7));
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('Parámetros anio y mes inválidos.');
    }
    return this.service.liquidarPeriodoConsulta(anio, mes, servicioId);
  }

  @Post('recalcular')
  async recalcularPersistido(
    @Body() body?: { anio?: number; mes?: number; servicioId?: string; incluirCerrados?: boolean }
  ) {
    const filtroEstado = body?.incluirCerrados ? {} : { estado: { not: 'CERRADO_NOMINA' } };
    const where: Record<string, any> = {};
    if (body?.anio && body?.mes) {
      where.cuadrante = {
        anio: Number(body.anio),
        mes: Number(body.mes),
        ...filtroEstado,
        ...(body.servicioId ? { servicioId: body.servicioId } : {}),
      };
    } else if (body?.anio) {
      where.cuadrante = {
        anio: Number(body.anio),
        ...filtroEstado,
        ...(body.servicioId ? { servicioId: body.servicioId } : {}),
      };
    } else if (body?.servicioId) {
      where.cuadrante = { servicioId: body.servicioId, ...filtroEstado };
    } else if (!body?.incluirCerrados) {
      where.cuadrante = { ...filtroEstado };
    }

    const res = await this.service.recalcularAsignaciones(where);
    return {
      ok: true,
      ...res,
      mensaje: `Recálculo normativo completado: ${res.actualizadas} asignaciones actualizadas de ${res.evaluadas} evaluadas.`,
    };
  }
}

@Module({
  imports: [FestivosModule],
  controllers: [LiquidacionController],
  providers: [LiquidacionService],
  exports: [LiquidacionService],
})
export class LiquidacionModule {}
