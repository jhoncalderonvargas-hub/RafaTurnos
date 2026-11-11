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
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';
import {
  calcularDiasCompensatoriosDominicales,
  calcularMetaContractualProrrateada,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  esDomingo,
  evaluarJornadaSemanalPeriodo,
  hoyColombiaIso,
  ItemPeriodo,
  liquidarPeriodo,
  liquidarTurno,
  obtenerHorasAmortizacionTurno,
  r2,
  RECARGO_EXTRA_DIURNA,
  RECARGO_EXTRA_NOCTURNA,
  RECARGO_NOCTURNO,
  recargosVigentes,
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
  horasAmortizacionBanco?: number | null;
  esNocturnoPesado: boolean;
}

export interface HorasPersistibles {
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  hed: number;
  hen: number;
}

const CODIGOS_AUSENCIA = new Set(['VAC', 'INC', 'LIC', 'FAM']);
const CODIGOS_VACIOS = new Set(['', 'BLANCO', 'L', 'S', 'COMP', 'DISP', 'FAM', 'VAC', 'INC', 'LIC']);

export function toTurnoLiquidable(
  tipo: Partial<TipoTurnoLiquidableDb> | null | undefined,
  codigo?: string
): TurnoLiquidable | null {
  if (!tipo) return null;
  const cod = (tipo.codigo || codigo || '').trim().toUpperCase();
  return {
    horaInicio: tipo.horaInicio,
    horaFin: tipo.horaFin,
    horasOrdinarias: Number(tipo.horasOrdinarias) || 0,
    horasDiurnas: Number(tipo.horasDiurnas) || 0,
    horasNocturnas: Number(tipo.horasNocturnas) || 0,
    minutosAlmuerzo: Number(tipo.minutosAlmuerzo) || 0,
    esAusencia: CODIGOS_AUSENCIA.has(cod),
    descuentaBancoHoras: Boolean(tipo.descuentaBancoHoras),
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

  private predicadoDescanso() {
    return (fechaIso: string) => esDomingo(fechaIso) || this.festivosService.esFestivo(fechaIso);
  }

  /** Calcula las horas legales (HOD, HON, HDFD, HDFN) de un turno que inicia en `fechaUtc`. */
  async calcularHorasPorTipo(
    tipo: Partial<TipoTurnoLiquidableDb> | null | undefined,
    fechaUtc: Date
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
    const liq = liquidarTurno(turnoLiq, fechaIso, this.predicadoDescanso());
    return {
      hod: liq.hod,
      hon: liq.hon,
      hdfd: liq.hdfd,
      hdfn: liq.hdfn,
      hed: 0,
      hen: 0,
    };
  }

  async calcularHorasPorCodigo(codigo: string, fechaUtc: Date): Promise<HorasPersistibles> {
    const cod = (codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') {
      return { hod: 0, hon: 0, hdfd: 0, hdfn: 0, hed: 0, hen: 0 };
    }
    const tipo = await this.prisma.tipoTurno.findUnique({ where: { codigo: cod } });
    return this.calcularHorasPorTipo(tipo, fechaUtc);
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
      include: { tipoTurno: true },
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
      const liq =
        !cod || cod === 'BLANCO'
          ? { hod: 0, hon: 0, hdfd: 0, hdfn: 0 }
          : liquidarTurno(toTurnoLiquidable(a.tipoTurno, cod), fechaIso, pred);

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

  /** Recalcula todo el año `anio` más el 31 de diciembre de `anio - 1` (turnos que cruzan medianoche hacia ene-1). */
  async recalcularAnioYVispera(anio: number): Promise<{ evaluadas: number; actualizadas: number }> {
    const desde = new Date(Date.UTC(anio - 1, 11, 31));
    const hasta = new Date(Date.UTC(anio, 11, 31, 23, 59, 59));
    const res = await this.recalcularAsignaciones({ fecha: { gte: desde, lte: hasta } });
    if (res.actualizadas > 0) {
      this.logger.log(
        `Recalculadas ${res.actualizadas}/${res.evaluadas} asignaciones tras cambio normativo/festivos de ${anio}.`
      );
    }
    return res;
  }

  async recalcularPorTipoTurno(tipoTurnoId: string): Promise<{ evaluadas: number; actualizadas: number }> {
    const res = await this.recalcularAsignaciones({
      tipoTurnoId,
      cuadrante: { estado: { not: 'CERRADO_NOMINA' } },
    });

    // Propagar también al Banco de Horas de cuadrantes PUBLICADOS afectados (por ejemplo al cambiar COMP o duración)
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
   * Consolida y retorna los saldos del Banco de Horas de `servicioId` en `(anio, mes)` calculados
   * autoritativamente desde PostgreSQL `asignaciones_turno` y `tipos_turno`.
   * Si `cascada = true`, encadena el recálculo hacia meses posteriores ya consolidados/publicados (`M+1..12+`).
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
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();

    await this.festivosService.asegurarAnios([anio, anio + 1]);
    const pred = this.predicadoDescanso();

    const extraEmpIds = Array.from(fallbacksSaldoInicial.keys());
    const empleados = await db.empleado.findMany({
      where: {
        OR: [
          { servicioBaseId: servicioId },
          ...(extraEmpIds.length > 0 ? [{ id: { in: extraEmpIds } }] : []),
        ],
      },
      select: { id: true, horasContratoMes: true },
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
      const lista = asigsPorEmp.get(emp.id) || [];
      let horasAmortizadasComp = 0;
      let diasExonerados = 0;
      const items: ItemPeriodo[] = [];
      for (const a of lista) {
        const cod = (a.tipoTurno?.codigo || '').trim().toUpperCase();
        if (!cod || cod === 'BLANCO') continue;
        horasAmortizadasComp += obtenerHorasAmortizacionTurno(a.tipoTurno);
        if (esCodigoExoneracionContrato(cod)) diasExonerados++;
        items.push({
          fechaIso: new Date(a.fecha).toISOString().substring(0, 10),
          turno: toTurnoLiquidable(a.tipoTurno, cod),
        });
      }
      horasAmortizadasComp = r2(horasAmortizadasComp);
      const horasTrabajadas = liquidarPeriodo(items, pred).total;
      const meta = calcularMetaContractualProrrateada(
        emp.horasContratoMes,
        diasDelMes,
        diasExonerados
      );
      const saldoInicial = r2(
        mapaPrevDb.get(emp.id) ?? fallbacksSaldoInicial.get(emp.id) ?? 0
      );
      const tieneTurnosOperativos = horasTrabajadas > 0 || horasAmortizadasComp > 0;
      const diferenciaMes = tieneTurnosOperativos
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
          horasContratadas: meta.horasContratadasEfectivas,
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
          horasContratadas: meta.horasContratadasEfectivas,
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
   * los periodos posteriores ya publicados/consolidados para mantener la continuidad del arrastre.
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
          estado: { in: ['PUBLICADO', 'VALIDADO', 'CERRADO_NOMINA'] },
          OR: [{ anio: { gt: anio } }, { anio, mes: { gt: mes } }],
        },
        select: { anio: true, mes: true },
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

    const mapaPeriodos = new Map<string, { anio: number; mes: number }>();
    for (const p of [...cuadrantesPost, ...saldosPost]) {
      mapaPeriodos.set(`${p.anio}-${p.mes}`, { anio: p.anio, mes: p.mes });
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
    const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const primerDiaIso = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const primerDiaBorde = new Date(Date.UTC(anio, mes - 1, 1 - 21));

    await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);
    const pred = this.predicadoDescanso();

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

      for (const a of ventanaEmp) {
        const cod = (a.tipoTurno?.codigo || '').trim().toUpperCase();
        if (!cod || cod === 'BLANCO') continue;

        const fechaUtc = new Date(a.fecha);
        const fechaIso = fechaUtc.toISOString().substring(0, 10);
        const turno = toTurnoLiquidable(a.tipoTurno, cod);
        itemsVentanaSemanal.push({ fechaIso, turno });

        if (fechaUtc < primerDia || fechaUtc > ultimoDia) continue;

        if (!esRotacionExterna || a.servicioEjecutorId === servicioId) {
          if (cod === 'VAC') diasVac++;
          else if (cod === 'INC') diasInc++;
          else if (cod === 'LIC') diasLic++;
          else if (cod === 'FAM') diasFam++;
          if (a.tipoTurno?.descuentaBancoHoras) {
            turnosComp++;
            horasAmortizadasComp += obtenerHorasAmortizacionTurno(a.tipoTurno);
          }

          itemsMes.push({ fechaIso, turno });

          const liqCelda = liquidarTurno(turno, fechaIso, pred);
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

      const liq = liquidarPeriodo(itemsMes, pred);
      const semanalRaw = evaluarJornadaSemanalPeriodo(itemsVentanaSemanal);
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
      const diasExonerados = diasVac + diasInc + diasLic + diasFam;
      const meta = calcularMetaContractualProrrateada(
        emp.horasContratoMes,
        diasDelMes,
        esRotacionExterna ? 0 : diasExonerados
      );

      return {
        empleadoId: emp.id,
        documento: emp.documento,
        nombre: emp.nombre,
        servicioId: emp.servicioBaseId,
        servicioCodigo: emp.servicioBase?.codigo || '',
        servicioNombre: emp.servicioBase?.nombre || '',
        esRotacionExterna,
        cargo: emp.categoria?.nombre || '',
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
        evaluacionSemanal: semanal,
      };
    });

    const resumenNormativo = resumenNormativoPeriodo(anio, mes);
    return {
      periodo: `${anio}-${String(mes).padStart(2, '0')}`,
      anio,
      mes,
      servicioId: servicioId || 'TODOS',
      normativaVigente: resumenNormativo,
      pendientesRecalculo,
      totalColaboradores: colaboradores.length,
      colaboradores,
    };
  }
}

@Controller('api/v1/liquidacion')
export class LiquidacionController {
  constructor(private readonly service: LiquidacionService) {}

  @Get('vigencias')
  obtenerVigencias(@Query('anio') anioStr?: string, @Query('mes') mesStr?: string) {
    const hoy = hoyColombiaIso();
    const anio = Number(anioStr) || Number(hoy.substring(0, 4));
    const mes = Number(mesStr) || Number(hoy.substring(5, 7));
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('Parámetros anio y mes inválidos.');
    }

    return {
      fechaReferenciaColombia: hoy,
      zonaHorariaOficial: 'America/Bogota',
      periodo: `${anio}-${String(mes).padStart(2, '0')}`,
      resumenPeriodo: resumenNormativoPeriodo(anio, mes),
      recargosHoy: recargosVigentes(hoy),
      parametrosBase: {
        recargoNocturno: RECARGO_NOCTURNO,
        recargoExtraDiurna: RECARGO_EXTRA_DIURNA,
        recargoExtraNocturna: RECARGO_EXTRA_NOCTURNA,
        descansoMinimoEntreTurnosMinutos: DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
        topeExtrasSemanalesHoras: TOPE_HORAS_EXTRAS_SEMANALES,
        semaforoBancoHoras: SEMAFORO_BANCO_HORAS,
        codigosNoLaborados: Array.from(CODIGOS_VACIOS).filter(Boolean),
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
    @Body() body?: { anio?: number; mes?: number; servicioId?: string }
  ) {
    const where: Record<string, any> = {};
    if (body?.anio && body?.mes) {
      where.cuadrante = {
        anio: Number(body.anio),
        mes: Number(body.mes),
        ...(body.servicioId ? { servicioId: body.servicioId } : {}),
      };
    } else if (body?.anio) {
      where.cuadrante = {
        anio: Number(body.anio),
        ...(body.servicioId ? { servicioId: body.servicioId } : {}),
      };
    } else if (body?.servicioId) {
      where.cuadrante = { servicioId: body.servicioId };
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
