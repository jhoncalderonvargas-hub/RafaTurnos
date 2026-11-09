import {
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  TipoTurnoConfig,
} from './models';

export interface MetricasMesColaborador {
  horasTrabajadas: number;
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  horasAmortizadasComp: number;
  conteoNoches: number;
  conteoDomFest: number;
  diasVac: number;
  diasInc: number;
  saldoAntReal: number;
  diferenciaMes: number;
  nuevoSaldoBanco: number;
  causaCompensatorioDominical: boolean;
  estadoBanco: 'EQUILIBRADO' | 'ATENCION' | 'CRITICO';
  nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO';
}

/**
 * Función compartida para la liquidación mensual de turnos de un colaborador (CST + Ley 2466 + Ley 2101).
 * Unifica el cálculo entre el Planificador de Cuadrantes, el Módulo de Reportes de Nómina y Mi Calendario.
 */
export function calcularMetricasMesColaborador(
  emp: EmpleadoHospital,
  celdasEmp: Record<number, CeldaAsignacion> | undefined,
  dias: DiaColumna[],
  catalogo: Record<string, TipoTurnoConfig>,
  saldosConsolidados: Record<string, number>,
  anio: number,
  mes: number,
  saldoAnteriorCalculado?: number
): MetricasMesColaborador {
  const celdas = celdasEmp || {};
  let horasTrabajadas = 0;
  let hod = 0;
  let hon = 0;
  let hdfd = 0;
  let hdfn = 0;
  let horasAmortizadasComp = 0;
  let conteoNoches = 0;
  let conteoDomFest = 0;
  let diasVac = 0;
  let diasInc = 0;

  for (const d of dias) {
    const celda = celdas[d.dia];
    const cod = celda?.codigo || '';
    if (!cod) continue;

    const cfg = catalogo[cod];
    if (!cfg) continue;

    horasTrabajadas += cfg.horasOrdinarias;
    if (cfg.esNocturnoPesado || cfg.horasNocturnas > 0) {
      conteoNoches++;
    }
    if (cod === 'VAC') diasVac++;
    if (cod === 'INC') diasInc++;
    if (cfg.descuentaBancoHoras) {
      horasAmortizadasComp += 8; // Jornada estándar de amortización de compensatorio
    }

    const esDiaDominicalOFestivo = d.esDomingo || !!d.festivo;
    if (esDiaDominicalOFestivo && cfg.horasOrdinarias > 0) {
      conteoDomFest++;
      hdfd += cfg.horasDiurnas;
      hdfn += cfg.horasNocturnas;
    } else {
      hod += cfg.horasDiurnas;
      hon += cfg.horasNocturnas;
    }
  }

  const anioPrev = mes === 1 ? anio - 1 : anio;
  const mesPrev = mes === 1 ? 12 : mes - 1;
  const saldoKeyPrev = `${emp.id}::${anioPrev}-${mesPrev}`;
  const saldoAntReal =
    saldoAnteriorCalculado !== undefined
      ? saldoAnteriorCalculado
      : (saldosConsolidados[saldoKeyPrev] !== undefined
          ? saldosConsolidados[saldoKeyPrev]
          : emp.saldoBancoAnterior);

  const tieneTurnosOperativos = horasTrabajadas > 0 || horasAmortizadasComp > 0;
  const diferenciaMes = tieneTurnosOperativos
    ? horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp
    : 0;
  const nuevoSaldoBanco = saldoAntReal + diferenciaMes;

  let estadoBanco: 'EQUILIBRADO' | 'ATENCION' | 'CRITICO' = 'EQUILIBRADO';
  if (nuevoSaldoBanco > 30 || nuevoSaldoBanco < -18) {
    estadoBanco = 'CRITICO';
  } else if (nuevoSaldoBanco > 18 || nuevoSaldoBanco < -6) {
    estadoBanco = 'ATENCION';
  }

  let nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO' = 'BAJO';
  if (conteoNoches >= 5 || (conteoNoches >= 4 && conteoDomFest >= 3)) {
    nivelFatiga = 'ALTO';
  } else if (conteoNoches >= 3 || conteoDomFest >= 3) {
    nivelFatiga = 'MODERADO';
  }

  return {
    horasTrabajadas,
    hod,
    hon,
    hdfd,
    hdfn,
    horasAmortizadasComp,
    conteoNoches,
    conteoDomFest,
    diasVac,
    diasInc,
    saldoAntReal,
    diferenciaMes,
    nuevoSaldoBanco,
    causaCompensatorioDominical: conteoDomFest >= 3,
    estadoBanco,
    nivelFatiga,
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
