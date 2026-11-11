import {
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  TipoTurnoConfig,
} from './models';
import { FestivosColombiaHelper } from './festivos-colombia.helper';
import {
  calcularDiasCompensatoriosDominicales,
  calcularMetaContractualProrrateada,
  crearPredicadoDescanso,
  esCodigoExoneracionContrato,
  esTurnoNocturnoPrincipal,
  evaluarEstadoBancoHoras,
  liquidarPeriodo,
  liquidarTurno,
  obtenerHorasAmortizacionTurno,
  PredicadoDescanso,
  r2,
  RecargosVigentes,
  recargosVigentes,
} from './shared/liquidacion-horas';

export interface MetricasMesColaborador {
  horasTrabajadas: number;
  /** Horas ordinarias diurnas en día hábil (Lun–Sáb no festivo). */
  hod: number;
  /** Horas ordinarias nocturnas en día hábil. */
  hon: number;
  /** Horas diurnas en domingo/festivo (calendario real, corte a las 00:00). */
  hdfd: number;
  /** Horas nocturnas en domingo/festivo. */
  hdfn: number;
  horasAmortizadasComp: number;
  conteoNoches: number;
  /** Fechas calendario dom/festivo con > 0 min netos trabajados (Dom ∪ Fest). */
  conteoDomFest: number;
  /** Fechas calendario estrictamente DOMINGO con > 0 min netos trabajados (Art. 179 Par. 1 y Art. 181 CST: >= 3 causa compensatorio). */
  conteoDomingos: number;
  diasVac: number;
  diasInc: number;
  diasLic: number;
  diasFam: number;
  diasExonerados: number;
  horasExoneradas: number;
  horasContratadasEfectivas: number;
  saldoAntReal: number;
  diferenciaMes: number;
  nuevoSaldoBanco: number;
  causaCompensatorioDominical: boolean;
  estadoBanco: 'EQUILIBRADO' | 'ATENCION' | 'CRITICO';
  nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO';
  /** Porcentajes de recargo legalmente vigentes en el periodo (Art. 168 y 179 CST, Ley 2466/2025). */
  recargos: RecargosVigentes;
}

/** Predicado estándar de día de descanso obligatorio (domingo o festivo oficial/cívico cargado en el helper de festivos). */
export function predicadoDescansoObligatorio(): PredicadoDescanso {
  return crearPredicadoDescanso((fechaIso) => Boolean(FestivosColombiaHelper.esFestivo(fechaIso)));
}

/** Horas liquidadas (netas) de un turno que inicia en `fechaIso`. Única vía para obtener horas de una celda. */
export function horasLiquidadasCelda(
  cfg: TipoTurnoConfig | undefined,
  fechaIso: string,
  esDescanso: PredicadoDescanso = predicadoDescansoObligatorio()
): number {
  return liquidarTurno(cfg, fechaIso, esDescanso).total;
}

function fechaIsoDelDia(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Horas trabajadas y horas amortizadas por compensatorio de un periodo, usando exactamente el mismo motor
 * que el cuadrante, reportes y exportación (evita divergencias en el arrastre del Banco de Horas).
 */
export function resumirHorasPeriodo(
  celdasEmp: Record<number, CeldaAsignacion> | undefined,
  anio: number,
  mes: number,
  catalogo: Record<string, TipoTurnoConfig>,
  esDescanso: PredicadoDescanso = predicadoDescansoObligatorio()
): { horasTrabajadas: number; horasAmortizadasComp: number; diasExonerados: number } {
  const items: { fechaIso: string; turno: TipoTurnoConfig | undefined }[] = [];
  let horasAmortizadasComp = 0;
  let diasExonerados = 0;
  for (const [diaStr, celda] of Object.entries(celdasEmp || {})) {
    const cod = (celda?.codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') continue;
    const cfg = catalogo[cod];
    if (!cfg) {
      if (esCodigoExoneracionContrato(cod)) diasExonerados++;
      continue;
    }
    horasAmortizadasComp = r2(horasAmortizadasComp + obtenerHorasAmortizacionTurno(cfg));
    if (cfg.esAusencia || esCodigoExoneracionContrato(cod)) {
      diasExonerados++;
    }
    items.push({ fechaIso: fechaIsoDelDia(anio, mes, Number(diaStr)), turno: cfg });
  }
  return {
    horasTrabajadas: liquidarPeriodo(items, esDescanso).total,
    horasAmortizadasComp,
    diasExonerados,
  };
}

/**
 * Función compartida para la liquidación mensual de turnos de un colaborador (CST + Ley 2466 + Ley 2101).
 * Unifica el cálculo entre el Planificador de Cuadrantes, el Módulo de Reportes de Nómina y Mi Calendario.
 * Delegada por completo en `shared/liquidacion-horas.ts` (mismo motor que usa el backend al persistir).
 */
export function calcularMetricasMesColaborador(
  emp: EmpleadoHospital,
  celdasEmp: Record<number, CeldaAsignacion> | undefined,
  dias: DiaColumna[],
  catalogo: Record<string, TipoTurnoConfig>,
  saldosConsolidados: Record<string, number>,
  anio: number,
  mes: number,
  saldoAnteriorCalculado?: number,
  esDescanso: PredicadoDescanso = predicadoDescansoObligatorio()
): MetricasMesColaborador {
  const celdas = celdasEmp || {};
  let horasAmortizadasComp = 0;
  let conteoNoches = 0;
  let diasVac = 0;
  let diasInc = 0;
  let diasLic = 0;
  let diasFam = 0;
  let diasExonerados = 0;
  const items: { fechaIso: string; turno: TipoTurnoConfig | undefined }[] = [];

  for (const d of dias) {
    const cod = (celdas[d.dia]?.codigo || '').trim().toUpperCase();
    if (!cod) continue;
    if (cod === 'VAC') diasVac++;
    if (cod === 'INC') diasInc++;
    if (cod === 'LIC') diasLic++;
    if (cod === 'FAM') diasFam++;

    const cfg = catalogo[cod];
    if (!cfg) {
      if (esCodigoExoneracionContrato(cod)) diasExonerados++;
      continue;
    }

    items.push({ fechaIso: d.fechaIso, turno: cfg });
    if (esTurnoNocturnoPrincipal(cfg)) conteoNoches++;
    if (cfg.esAusencia || esCodigoExoneracionContrato(cod)) {
      diasExonerados++;
    }
    horasAmortizadasComp = r2(horasAmortizadasComp + obtenerHorasAmortizacionTurno(cfg));
  }

  const liq = liquidarPeriodo(items, esDescanso);
  const horasTrabajadas = r2(liq.total);
  const hod = r2(liq.hod);
  const hon = r2(liq.hon);
  const hdfd = r2(liq.hdfd);
  const hdfn = r2(liq.hdfn);
  const conteoDomFest = liq.diasDescansoLaborados;
  const conteoDomingos = liq.domingosLaborados;

  const anioPrev = mes === 1 ? anio - 1 : anio;
  const mesPrev = mes === 1 ? 12 : mes - 1;
  const saldoKeyPrev = `${emp.id}::${anioPrev}-${mesPrev}`;
  const saldoFallbackOrigen =
    emp.saldoBancoOrigen !== undefined
      ? emp.saldoBancoOrigen.anio < anio ||
        (emp.saldoBancoOrigen.anio === anio && emp.saldoBancoOrigen.mes < mes)
        ? emp.saldoBancoOrigen.saldo
        : 0
      : emp.saldoBancoAnterior;
  const saldoAntReal = r2(
    saldoAnteriorCalculado !== undefined
      ? saldoAnteriorCalculado
      : saldosConsolidados[saldoKeyPrev] !== undefined
        ? saldosConsolidados[saldoKeyPrev]
        : saldoFallbackOrigen
  );

  const meta = calcularMetaContractualProrrateada(
    emp.horasContratoMes,
    dias.length,
    diasExonerados
  );
  const tieneTurnosOperativos = horasTrabajadas > 0 || horasAmortizadasComp > 0;
  const diferenciaMes = tieneTurnosOperativos
    ? r2(horasTrabajadas - meta.horasContratadasEfectivas - horasAmortizadasComp)
    : 0;
  const nuevoSaldoBanco = r2(saldoAntReal + diferenciaMes);
  const estadoBanco = evaluarEstadoBancoHoras(nuevoSaldoBanco);

  let nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO' = 'BAJO';
  if (conteoNoches >= 5 || (conteoNoches >= 4 && conteoDomFest >= 3)) {
    nivelFatiga = 'ALTO';
  } else if (conteoNoches >= 3 || conteoDomFest >= 3) {
    nivelFatiga = 'MODERADO';
  }

  const fechaRefPeriodo =
    dias.length > 0 ? dias[dias.length - 1].fechaIso : fechaIsoDelDia(anio, mes, 1);

  return {
    horasTrabajadas,
    hod,
    hon,
    hdfd,
    hdfn,
    horasAmortizadasComp,
    conteoNoches,
    conteoDomFest,
    conteoDomingos,
    diasVac,
    diasInc,
    diasLic,
    diasFam,
    diasExonerados: meta.diasExonerados,
    horasExoneradas: meta.horasExoneradas,
    horasContratadasEfectivas: meta.horasContratadasEfectivas,
    saldoAntReal,
    diferenciaMes,
    nuevoSaldoBanco,
    causaCompensatorioDominical: calcularDiasCompensatoriosDominicales(conteoDomingos) > 0,
    estadoBanco,
    nivelFatiga,
    recargos: recargosVigentes(fechaRefPeriodo),
  };
}

/**
 * Utilidades compartidas para lectura y persistencia segura en LocalStorage.
 */
export function leerStorageSeguro<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function guardarStorageSeguro<T>(key: string, valor: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(valor));
  } catch {}
}
