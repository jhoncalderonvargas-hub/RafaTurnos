// ⚠️ ARCHIVO GENERADO desde /shared/liquidacion-horas.ts — NO EDITAR AQUÍ. Ejecuta: node scripts/sync-shared.mjs
/**
 * MOTOR ÚNICO DE LIQUIDACIÓN DE HORAS — Rafa Turnos
 * ==================================================
 * FUENTE CANÓNICA. No editar las copias en `frontend/src/app/shared/` ni `backend/src/shared/`:
 * se regeneran con `node scripts/sync-shared.mjs` (y `node scripts/verificar-liquidacion.mjs` falla si divergen).
 *
 * Principios (desacoplamiento financiero, Doc 10): el sistema NO calcula dinero. Mide HORAS por concepto
 * (HOD, HON, HDFD, HDFN) y expone los PORCENTAJES de recargo legalmente vigentes en cada fecha para que Nómina
 * los aplique con sus propios divisores y salarios.
 *
 * Base normativa (verificada a nov-2026):
 *  - Art. 160 CST modificado por Art. 10 Ley 2466/2025: trabajo diurno 06:00–19:00 y nocturno 19:00–06:00,
 *    vigente desde el 25-dic-2025 (6 meses después de la sanción, 25-jun-2025). Antes (Ley 789/2002): nocturno desde 21:00.
 *  - Art. 168 CST: recargo nocturno 35%; extra diurna 25%; extra nocturna 75%.
 *  - Art. 179 CST modificado por Art. 14 Ley 2466/2025: trabajo en día de descanso obligatorio (domingo/festivo),
 *    recargo gradual: 75% (hasta 30-jun-2025), 80% (desde 1-jul-2025), 90% (desde 1-jul-2026), 100% (desde 1-jul-2027).
 *  - Ley 2101/2021: jornada máxima 48→47 (15-jul-2023)→46 (15-jul-2024)→44 (15-jul-2025)→42 h/sem (15-jul-2026).
 *
 * Reglas de liquidación de una hora trabajada (se evalúa MINUTO A MINUTO sobre la fecha calendario REAL del minuto):
 *  1. Franja: nocturna si minuto >= inicio nocturno vigente en ESA fecha, o minuto < 06:00; diurna en otro caso.
 *  2. Día: descanso obligatorio si la fecha calendario real (00:00–24:00) es domingo o festivo.
 *     Un turno que cruza medianoche se parte en las 00:00: cada tramo toma el tipo de día de SU fecha.
 *  3. Concepto: HOD (hábil diurna), HON (hábil nocturna), HDFD (dom/fest diurna), HDFN (dom/fest nocturna).
 *  4. Descanso intermedio no computable (Art. 167 CST, `minutosAlmuerzo`): se descuenta del concepto de MENOR recargo
 *     disponible (orden HOD → HON → HDFD → HDFN), criterio pro operario. Es la única convención no fijada por la ley.
 *  5. Todo el turno se liquida en el periodo (mes) de su fecha de INICIO; los recargos usan la fecha real de cada hora.
 */

// ───────────────────────────── Constantes normativas ─────────────────────────────

export const MINUTOS_DIA = 1440;
/** Fin de la franja nocturna (06:00), invariable en todas las vigencias. */
export const FIN_NOCTURNO_MIN = 6 * 60;

/** Vigencias del inicio de la franja nocturna (Art. 160 CST). Ordenadas por `desde` ascendente. */
export const VIGENCIAS_INICIO_NOCTURNO: ReadonlyArray<{ desde: string; inicioMin: number; norma: string }> = [
  { desde: '1900-01-01', inicioMin: 21 * 60, norma: 'Art. 25 Ley 789/2002 (21:00)' },
  { desde: '2025-12-25', inicioMin: 19 * 60, norma: 'Art. 10 Ley 2466/2025 (19:00)' },
];

/** Recargo dominical/festivo (Art. 179 CST). Ordenado por `desde` ascendente. Valores como fracción (0.90 = 90%). */
export const VIGENCIAS_RECARGO_DOMINICAL: ReadonlyArray<{ desde: string; valor: number; norma: string }> = [
  { desde: '1900-01-01', valor: 0.75, norma: 'Art. 26 Ley 789/2002 (75%)' },
  { desde: '2025-07-01', valor: 0.8, norma: 'Art. 14 Ley 2466/2025 — gradualidad (80%)' },
  { desde: '2026-07-01', valor: 0.9, norma: 'Art. 14 Ley 2466/2025 — gradualidad (90%)' },
  { desde: '2027-07-01', valor: 1.0, norma: 'Art. 14 Ley 2466/2025 — plena aplicación (100%)' },
];

/** Jornada máxima legal semanal (Ley 2101/2021). */
export const VIGENCIAS_JORNADA_SEMANAL: ReadonlyArray<{ desde: string; horas: number }> = [
  { desde: '1900-01-01', horas: 48 },
  { desde: '2023-07-15', horas: 47 },
  { desde: '2024-07-15', horas: 46 },
  { desde: '2025-07-15', horas: 44 },
  { desde: '2026-07-15', horas: 42 },
];

export const RECARGO_NOCTURNO = 0.35; // Art. 168 num. 1
export const RECARGO_EXTRA_DIURNA = 0.25; // Art. 168 num. 2
export const RECARGO_EXTRA_NOCTURNA = 0.75; // Art. 168 num. 3

/** Un turno se considera "de noche" (fatiga/equidad/cobertura) si tiene al menos esta cantidad de horas nocturnas. */
export const UMBRAL_HORAS_TURNO_NOCTURNO = 6;

/** Descanso mínimo recomendado entre el fin de un turno y el inicio del siguiente (minutos = 12 h). */
export const DESCANSO_MINIMO_ENTRE_TURNOS_MIN = 12 * 60;

/** Tope semanal de horas extras según Art. 22 Ley 50/1990 y Ley 2101/2021 (máx. 2 h/día, 12 h/semana). */
export const TOPE_HORAS_EXTRAS_SEMANALES = 12;

/** Horas amortizadas por defecto por cada turno compensatorio (COMP) cuando el tipo de turno no define un valor distinto. */
export const HORAS_AMORTIZACION_COMP_DEFAULT = 8;

/** Códigos oficiales de ausencia o exoneración remunerada que prorratean la meta contractual mensual. */
export const CODIGOS_EXONERACION_CONTRATO: ReadonlySet<string> = new Set(['VAC', 'INC', 'LIC', 'FAM']);

/** Umbrales compartidos para el semáforo de Banco de Horas (Planificador, Reportes y Nómina). */
export const SEMAFORO_BANCO_HORAS = {
  ATENCION_POS: 18,
  CRITICO_POS: 30,
  ATENCION_NEG: -6,
  CRITICO_NEG: -18,
} as const;

// ───────────────────────────── Tipos ─────────────────────────────

export interface RecargosVigentes {
  /** Fracción: 0.35 = 35%. */
  nocturno: number;
  dominical: number;
  /** Recargo nocturno en día de descanso obligatorio = dominical + nocturno (p. ej. 0.90 + 0.35 = 1.25). */
  nocturnoDominical: number;
  extraDiurna: number;
  extraNocturna: number;
  extraDiurnaDominical: number;
  extraNocturnaDominical: number;
}

export interface TurnoLiquidable {
  horaInicio?: string;
  horaFin?: string;
  horasOrdinarias: number;
  /** Solo se usan como respaldo si el turno no tiene horario válido. */
  horasDiurnas?: number;
  horasNocturnas?: number;
  minutosAlmuerzo?: number;
  esAusencia?: boolean;
  descuentaBancoHoras?: boolean;
  horasAmortizacionBanco?: number | null;
}

export interface MinutosLiquidados {
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
}

export interface HorasLiquidadas {
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  total: number;
}

export interface TramoLiquidado {
  fechaIso: string;
  esDescansoObligatorio: boolean;
  minutosDiurnos: number;
  minutosNocturnos: number;
}

export type PredicadoDescanso = (fechaIso: string) => boolean;

export interface ItemPeriodo {
  fechaIso: string;
  turno: TurnoLiquidable | undefined | null;
}

export interface DetalleDiaLiquidado extends HorasLiquidadas {
  fechaIso: string;
}

export interface LiquidacionPeriodo extends HorasLiquidadas {
  detalle: DetalleDiaLiquidado[];
  /** Fechas calendario dom/festivo con > 0 min netos trabajados (incluye cola posterior a medianoche tras almuerzo). */
  fechasDescansoLaboradas: string[];
  /** Cantidad total de fechas dom/festivo laboradas (Dom ∪ Fest). */
  diasDescansoLaborados: number;
  /** Fechas calendario estrictamente DOMINGO con > 0 min netos trabajados (Art. 179 Par. 1 CST). */
  fechasDomingosLaborados: string[];
  /** Cantidad de domingos laborados en el periodo (habitualidad dominical >= 3, Art. 179 Par. 1 y Art. 181 CST). */
  domingosLaborados: number;
}

export interface EvaluacionSemanaJornada {
  semanaInicioIso: string;
  semanaFinIso: string;
  horasTotales: number;
  limiteOrdinarioVigente: number;
  excedeOrdinario: boolean;
  excedeTopeAbsoluto: boolean;
}

export interface EvaluacionJornadaPeriodo {
  semanas: EvaluacionSemanaJornada[];
  limiteOrdinarioMaximo: number;
  semanasSobreOrdinario: number;
  semanasSobreTopeAbsoluto: number;
  promedios3SemanasExcedidos: Array<{ desdeSemana: string; hastaSemana: string; promedio: number; limite: number }>;
  /** True si hay al menos una semana > límite + 12h extras (Art. 22 Ley 50/90) o promedio 3 semanas > límite (Art. 165 CST). */
  tieneInfraccionSemanal: boolean;
}

// ───────────────────────────── Fechas ─────────────────────────────

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(fechaIso: string): { y: number; m: number; d: number } {
  const mt = RE_ISO.exec(fechaIso);
  if (!mt) throw new Error(`Fecha ISO inválida: "${fechaIso}" (se espera YYYY-MM-DD)`);
  const y = +mt[1];
  const m = +mt[2];
  const d = +mt[3];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    m < 1 ||
    m > 12 ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new Error(`Fecha calendario inexistente: "${fechaIso}"`);
  }
  return { y, m, d };
}

export function esFechaIsoValida(fechaIso: string): boolean {
  try {
    parseIso(fechaIso);
    return true;
  } catch {
    return false;
  }
}

export function esDomingo(fechaIso: string): boolean {
  const { y, m, d } = parseIso(fechaIso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
}

export function sumarDiasIso(fechaIso: string, dias: number): string {
  const { y, m, d } = parseIso(fechaIso);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Fecha calendario YYYY-MM-DD actual en zona horaria oficial de Colombia (America/Bogota, UTC-5 sin DST). */
export function hoyColombiaIso(ahora: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(ahora);
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {}
  const co = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  return `${co.getUTCFullYear()}-${String(co.getUTCMonth() + 1).padStart(2, '0')}-${String(co.getUTCDate()).padStart(2, '0')}`;
}

/** Predicado estándar: día de descanso obligatorio = domingo o festivo (Art. 179 par. 2 Ley 2466). */
export function crearPredicadoDescanso(esFestivo: (fechaIso: string) => boolean | undefined | null): PredicadoDescanso {
  return (fechaIso: string) => esDomingo(fechaIso) || Boolean(esFestivo(fechaIso));
}

function valorVigente<T extends { desde: string }>(tabla: ReadonlyArray<T>, fechaIso: string): T {
  let vigente = tabla[0];
  for (const fila of tabla) {
    if (fila.desde <= fechaIso) vigente = fila;
    else break;
  }
  return vigente;
}

// ───────────────────────────── Vigencias ─────────────────────────────

export function inicioNocturnoVigente(fechaIso: string): number {
  return valorVigente(VIGENCIAS_INICIO_NOCTURNO, fechaIso).inicioMin;
}

export function jornadaSemanalLegalVigente(fechaIso: string): number {
  return valorVigente(VIGENCIAS_JORNADA_SEMANAL, fechaIso).horas;
}

/** Divisor mensual de la hora ordinaria = (jornada semanal / 6 días) × 30 días (p. ej. 42 h → 210). */
export function divisorHorasMensualesVigente(fechaIso: string): number {
  return (jornadaSemanalLegalVigente(fechaIso) / 6) * 30;
}

export const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Horas que amortiza un turno compensatorio en el Banco de Horas.
 * Toma el valor configurado en `TipoTurno.horasAmortizacionBanco` (> 0) o `HORAS_AMORTIZACION_COMP_DEFAULT` (8h).
 */
export function obtenerHorasAmortizacionTurno(
  turno: { descuentaBancoHoras?: boolean; horasAmortizacionBanco?: number | null } | undefined | null
): number {
  if (!turno?.descuentaBancoHoras) return 0;
  const val = Number(turno.horasAmortizacionBanco);
  return Number.isFinite(val) && val > 0 ? r2(val) : HORAS_AMORTIZACION_COMP_DEFAULT;
}

/**
 * Días compensatorios causados por habitualidad dominical (Art. 179 Par. 1 y Art. 181 CST):
 * con 3 o más domingos laborados en el mes calendario se causa 1 día compensatorio por cada domingo laborado.
 */
export function calcularDiasCompensatoriosDominicales(domingosLaborados: number): number {
  const dom = Math.max(0, Math.floor(Number(domingosLaborados) || 0));
  return dom >= 3 ? dom : 0;
}

export function esCodigoExoneracionContrato(codigo?: string | null): boolean {
  return CODIGOS_EXONERACION_CONTRATO.has((codigo || '').trim().toUpperCase());
}

/**
 * Prorratea las horas contractuales del mes descontando `horasContratoMes / diasMes` por cada día
 * con novedad oficial remunerada o exoneración (VAC, INC, LIC, FAM), evitando deudas injustas en Banco de Horas.
 */
export function calcularMetaContractualProrrateada(
  horasContratoMes: number,
  diasMes: number,
  diasExoneradosOficiales: number
): {
  horasContratadasNominales: number;
  diasExonerados: number;
  horasExoneradas: number;
  horasContratadasEfectivas: number;
} {
  const nominal = Math.max(0, Number(horasContratoMes) || 0);
  const dMes = Math.max(1, Math.round(Number(diasMes) || 30));
  const dExon = Math.max(0, Math.min(dMes, Math.round(Number(diasExoneradosOficiales) || 0)));
  const horasExoneradas = dExon >= dMes ? r2(nominal) : r2((nominal / dMes) * dExon);
  const horasContratadasEfectivas = Math.max(0, r2(nominal - horasExoneradas));
  return {
    horasContratadasNominales: r2(nominal),
    diasExonerados: dExon,
    horasExoneradas,
    horasContratadasEfectivas,
  };
}

export function evaluarEstadoBancoHoras(saldo: number): 'EQUILIBRADO' | 'ATENCION' | 'CRITICO' {
  if (saldo > SEMAFORO_BANCO_HORAS.CRITICO_POS || saldo < SEMAFORO_BANCO_HORAS.CRITICO_NEG) {
    return 'CRITICO';
  }
  if (saldo > SEMAFORO_BANCO_HORAS.ATENCION_POS || saldo < SEMAFORO_BANCO_HORAS.ATENCION_NEG) {
    return 'ATENCION';
  }
  return 'EQUILIBRADO';
}

export function recargosVigentes(fechaIso: string): RecargosVigentes {
  const dominical = valorVigente(VIGENCIAS_RECARGO_DOMINICAL, fechaIso).valor;
  return {
    nocturno: RECARGO_NOCTURNO,
    dominical,
    nocturnoDominical: r2(dominical + RECARGO_NOCTURNO),
    extraDiurna: RECARGO_EXTRA_DIURNA,
    extraNocturna: RECARGO_EXTRA_NOCTURNA,
    extraDiurnaDominical: r2(dominical + RECARGO_EXTRA_DIURNA),
    extraNocturnaDominical: r2(dominical + RECARGO_EXTRA_NOCTURNA),
  };
}

/** 0.9 → "90%"; 1.25 → "125%". */
export function formatearPorcentaje(fraccion: number): string {
  return `${Math.round(fraccion * 100)}%`;
}

/** Texto de la franja diurna/nocturna vigente en una fecha, p. ej. "06:00–19:00" / "19:00–06:00". */
export function textoFranjasVigentes(fechaIso: string): { diurna: string; nocturna: string } {
  const hh = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const ini = inicioNocturnoVigente(fechaIso);
  return { diurna: `${hh(FIN_NOCTURNO_MIN)}–${hh(ini)}`, nocturna: `${hh(ini)}–${hh(FIN_NOCTURNO_MIN)}` };
}

/** Franjas, jornada y recargos a mostrar en la cabecera de un periodo mensual (al ÚLTIMO día del mes; avisa si cambian en ese mes o desde el cierre del mes previo). */
export function resumenNormativoPeriodo(anio: number, mes: number): {
  recargos: RecargosVigentes;
  franjas: { diurna: string; nocturna: string };
  jornadaSemanalHoras: number;
  divisorHorasMensuales: number;
  franjaCambiaEnElMes: boolean;
  recargoDominicalCambiaEnElMes: boolean;
  jornadaSemanalCambiaEnElMes: boolean;
} {
  const mm = String(mes).padStart(2, '0');
  const primero = `${anio}-${mm}-01`;
  const cierreMesPrevio = sumarDiasIso(primero, -1);
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const ultimo = `${anio}-${mm}-${String(ultimoDia).padStart(2, '0')}`;
  return {
    recargos: recargosVigentes(ultimo),
    franjas: textoFranjasVigentes(ultimo),
    jornadaSemanalHoras: jornadaSemanalLegalVigente(ultimo),
    divisorHorasMensuales: divisorHorasMensualesVigente(ultimo),
    franjaCambiaEnElMes: inicioNocturnoVigente(primero) !== inicioNocturnoVigente(ultimo),
    recargoDominicalCambiaEnElMes:
      recargosVigentes(cierreMesPrevio).dominical !== recargosVigentes(ultimo).dominical,
    jornadaSemanalCambiaEnElMes:
      jornadaSemanalLegalVigente(primero) !== jornadaSemanalLegalVigente(ultimo),
  };
}

// ───────────────────────────── Clasificación de minutos ─────────────────────────────

export function parseHoraMin(hhmm?: string): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return null;
  return (h === 24 ? 0 : h) * 60 + m;
}

/** ¿El minuto del día (0–1439) de la fecha dada pertenece a la franja nocturna? */
export function esMinutoNocturno(minutoDelDia: number, fechaIso: string): boolean {
  return minutoDelDia >= inicioNocturnoVigente(fechaIso) || minutoDelDia < FIN_NOCTURNO_MIN;
}

/** Duración bruta en minutos del horario. Si fin < inicio cruza medianoche. `permitirMismaHora24h` controla si inicio===fin equivale a 24 h (guardia) o es inválido. */
export function duracionHorarioMin(
  horaInicio?: string,
  horaFin?: string,
  permitirMismaHora24h = true
): number | null {
  const s = parseHoraMin(horaInicio);
  const e = parseHoraMin(horaFin);
  if (s === null || e === null) return null;
  if (e === s) return permitirMismaHora24h ? MINUTOS_DIA : null;
  return e < s ? e + MINUTOS_DIA - s : e - s;
}

type TramoBase = Omit<TramoLiquidado, 'esDescansoObligatorio'>;
/** Caché de la segmentación (depende solo de fecha y horario, no de festivos cívicos que pueden cambiar). No mutar. */
const CACHE_TRAMOS = new Map<string, ReadonlyArray<TramoBase>>();
const CACHE_TRAMOS_MAX = 60000;

/**
 * Parte un horario en tramos por fecha calendario real y franja (diurna/nocturna), sin descuento de almuerzo.
 * Opera por intervalos (no minuto a minuto): rápido incluso en celdas de 24 h.
 */
export function segmentarHorario(
  fechaInicioIso: string,
  horaInicio: string,
  horaFin: string,
  esDescansoObligatorio: PredicadoDescanso
): TramoLiquidado[] {
  return segmentarBase(fechaInicioIso, horaInicio, horaFin).map((t) => ({
    ...t,
    esDescansoObligatorio: esDescansoObligatorio(t.fechaIso),
  }));
}

function segmentarBase(fechaInicioIso: string, horaInicio: string, horaFin: string): ReadonlyArray<TramoBase> {
  const clave = `${fechaInicioIso}|${horaInicio}|${horaFin}`;
  const cacheado = CACHE_TRAMOS.get(clave);
  if (cacheado) return cacheado;
  const tramos = calcularTramosBase(fechaInicioIso, horaInicio, horaFin);
  if (CACHE_TRAMOS.size >= CACHE_TRAMOS_MAX) CACHE_TRAMOS.clear();
  CACHE_TRAMOS.set(clave, tramos);
  return tramos;
}

function calcularTramosBase(fechaInicioIso: string, horaInicio: string, horaFin: string): TramoBase[] {
  const s = parseHoraMin(horaInicio);
  const duracion = duracionHorarioMin(horaInicio, horaFin);
  if (s === null || duracion === null) return [];
  const e = s + duracion; // absoluto, < 2880
  const fechaDia1 = sumarDiasIso(fechaInicioIso, 1);
  const ini0 = inicioNocturnoVigente(fechaInicioIso);
  const ini1 = inicioNocturnoVigente(fechaDia1);

  const cortes = new Set<number>([s, e]);
  for (const c of [FIN_NOCTURNO_MIN, ini0, MINUTOS_DIA, MINUTOS_DIA + FIN_NOCTURNO_MIN, MINUTOS_DIA + ini1]) {
    if (c > s && c < e) cortes.add(c);
  }
  const orden = Array.from(cortes).sort((a, b) => a - b);

  const acumulado = new Map<string, TramoBase>();
  for (let i = 0; i < orden.length - 1; i++) {
    const a = orden[i];
    const b = orden[i + 1];
    const fechaIso = a < MINUTOS_DIA ? fechaInicioIso : fechaDia1;
    const nocturno = esMinutoNocturno(a % MINUTOS_DIA, fechaIso);
    let tramo = acumulado.get(fechaIso);
    if (!tramo) {
      tramo = { fechaIso, minutosDiurnos: 0, minutosNocturnos: 0 };
      acumulado.set(fechaIso, tramo);
    }
    if (nocturno) tramo.minutosNocturnos += b - a;
    else tramo.minutosDiurnos += b - a;
  }
  return Array.from(acumulado.values());
}

// ───────────────────────────── Liquidación de un turno ─────────────────────────────

export function turnoEsLaborado(turno: TurnoLiquidable | undefined | null): turno is TurnoLiquidable {
  return Boolean(turno && !turno.esAusencia && (turno.horasOrdinarias || 0) > 0);
}

function descontarAlmuerzo(m: MinutosLiquidados, minutosAlmuerzo: number): MinutosLiquidados {
  let resto = Math.max(0, Math.round(minutosAlmuerzo || 0));
  const out = { ...m };
  for (const k of ['hod', 'hon', 'hdfd', 'hdfn'] as const) {
    const quitar = Math.min(out[k], resto);
    out[k] -= quitar;
    resto -= quitar;
  }
  return out;
}

/**
 * Calcula los minutos de descanso real entre el fin del turno en `día d-1` (`cfgPrev`)
 * y el inicio del turno en `día d` (`cfgAct`). Retorna `null` si alguno no es turno laborado o carece de horario válido.
 */
export function calcularDescansoEntreTurnosMin(
  cfgPrev: TurnoLiquidable | undefined | null,
  cfgAct: TurnoLiquidable | undefined | null
): number | null {
  if (!turnoEsLaborado(cfgPrev) || !turnoEsLaborado(cfgAct)) return null;
  const sPrev = parseHoraMin(cfgPrev.horaInicio);
  const durPrev = duracionHorarioMin(cfgPrev.horaInicio, cfgPrev.horaFin);
  const sAct = parseHoraMin(cfgAct.horaInicio);
  if (sPrev === null || durPrev === null || sAct === null) return null;
  return MINUTOS_DIA + sAct - (sPrev + durPrev);
}

interface BucketTramo {
  fechaIso: string;
  esDescanso: boolean;
  concepto: keyof MinutosLiquidados;
  min: number;
}

function liquidarTurnoConDetalleTramos(
  turno: TurnoLiquidable | undefined | null,
  fechaInicioIso: string,
  esDescansoObligatorio: PredicadoDescanso
): { minutos: MinutosLiquidados; netosPorFecha: Array<{ fechaIso: string; esDescanso: boolean; min: number }> } {
  const cero: MinutosLiquidados = { hod: 0, hon: 0, hdfd: 0, hdfn: 0 };
  if (!turnoEsLaborado(turno)) return { minutos: cero, netosPorFecha: [] };

  const tramos =
    turno.horaInicio && turno.horaFin
      ? segmentarHorario(fechaInicioIso, turno.horaInicio, turno.horaFin, esDescansoObligatorio)
      : [];

  if (tramos.length === 0) {
    const dom = esDescansoObligatorio(fechaInicioIso);
    const d = Math.round((turno.horasDiurnas || 0) * 60);
    const n = Math.round((turno.horasNocturnas || 0) * 60);
    const net = descontarAlmuerzo(
      dom ? { hod: 0, hon: 0, hdfd: d, hdfn: n } : { hod: d, hon: n, hdfd: 0, hdfn: 0 },
      turno.minutosAlmuerzo || 0
    );
    const sum = net.hod + net.hon + net.hdfd + net.hdfn;
    return {
      minutos: net,
      netosPorFecha: sum > 0 ? [{ fechaIso: fechaInicioIso, esDescanso: dom, min: sum }] : [],
    };
  }

  const buckets: BucketTramo[] = [];
  for (const t of tramos) {
    if (t.minutosDiurnos > 0) {
      buckets.push({
        fechaIso: t.fechaIso,
        esDescanso: t.esDescansoObligatorio,
        concepto: t.esDescansoObligatorio ? 'hdfd' : 'hod',
        min: t.minutosDiurnos,
      });
    }
    if (t.minutosNocturnos > 0) {
      buckets.push({
        fechaIso: t.fechaIso,
        esDescanso: t.esDescansoObligatorio,
        concepto: t.esDescansoObligatorio ? 'hdfn' : 'hon',
        min: t.minutosNocturnos,
      });
    }
  }

  let resto = Math.max(0, Math.round(turno.minutosAlmuerzo || 0));
  for (const concepto of ['hod', 'hon', 'hdfd', 'hdfn'] as const) {
    for (const b of buckets) {
      if (b.concepto !== concepto || resto <= 0) continue;
      const quitar = Math.min(b.min, resto);
      b.min -= quitar;
      resto -= quitar;
    }
  }

  const minutos: MinutosLiquidados = { ...cero };
  const mapaFecha = new Map<string, { fechaIso: string; esDescanso: boolean; min: number }>();
  for (const b of buckets) {
    minutos[b.concepto] += b.min;
    const prev = mapaFecha.get(b.fechaIso);
    if (prev) prev.min += b.min;
    else mapaFecha.set(b.fechaIso, { fechaIso: b.fechaIso, esDescanso: b.esDescanso, min: b.min });
  }

  return {
    minutos,
    netosPorFecha: Array.from(mapaFecha.values()).filter((x) => x.min > 0),
  };
}

/** Liquida un turno que INICIA en `fechaInicioIso`. Devuelve minutos enteros por concepto. */
export function liquidarTurnoMinutos(
  turno: TurnoLiquidable | undefined | null,
  fechaInicioIso: string,
  esDescansoObligatorio: PredicadoDescanso
): MinutosLiquidados {
  return liquidarTurnoConDetalleTramos(turno, fechaInicioIso, esDescansoObligatorio).minutos;
}

export function minutosAHoras(min: MinutosLiquidados): HorasLiquidadas {
  const h = (n: number) => Math.round((n / 60) * 100) / 100;
  const total = min.hod + min.hon + min.hdfd + min.hdfn;
  return { hod: h(min.hod), hon: h(min.hon), hdfd: h(min.hdfd), hdfn: h(min.hdfn), total: h(total) };
}

export function liquidarTurno(
  turno: TurnoLiquidable | undefined | null,
  fechaInicioIso: string,
  esDescansoObligatorio: PredicadoDescanso
): HorasLiquidadas {
  return minutosAHoras(liquidarTurnoMinutos(turno, fechaInicioIso, esDescansoObligatorio));
}

/**
 * Desglose de un horario para el catálogo de turnos, tomando un día hábil ordinario con las franjas vigentes en `fechaRefIso`.
 * Devuelve horas ordinarias netas (descontado almuerzo), diurnas y nocturnas.
 */
export function desglosarHorarioOrdinario(
  horaInicio: string,
  horaFin: string,
  minutosAlmuerzo: number,
  fechaRefIso: string,
  permitirMismaHora24h = true
): { ordinarias: number; diurnas: number; nocturnas: number } | null {
  if (duracionHorarioMin(horaInicio, horaFin, permitirMismaHora24h) === null) return null;
  const m = liquidarTurnoMinutos(
    { horaInicio, horaFin, horasOrdinarias: 1, minutosAlmuerzo },
    fechaRefIso,
    () => false
  );
  const h = minutosAHoras(m);
  return { ordinarias: h.total, diurnas: h.hod, nocturnas: h.hon };
}

/** Un turno es "de noche" (fatiga, equidad, KPI) si es guardia nocturna pesada o tiene >= 6 h nocturnas. T8 (4 h) NO lo es. */
export function esTurnoNocturnoPrincipal(
  turno: (TurnoLiquidable & { esNocturnoPesado?: boolean }) | undefined | null
): boolean {
  if (!turnoEsLaborado(turno)) return false;
  return Boolean(turno.esNocturnoPesado) || (turno.horasNocturnas || 0) >= UMBRAL_HORAS_TURNO_NOCTURNO;
}

// ───────────────────────────── Liquidación de un periodo ─────────────────────────────

export function liquidarPeriodo(items: ReadonlyArray<ItemPeriodo>, esDescansoObligatorio: PredicadoDescanso): LiquidacionPeriodo {
  const acum: MinutosLiquidados = { hod: 0, hon: 0, hdfd: 0, hdfn: 0 };
  const detalle: DetalleDiaLiquidado[] = [];
  const fechasDescanso = new Set<string>();
  const fechasDomingos = new Set<string>();

  for (const it of items) {
    if (!turnoEsLaborado(it.turno)) continue;
    const { minutos: mins, netosPorFecha } = liquidarTurnoConDetalleTramos(
      it.turno,
      it.fechaIso,
      esDescansoObligatorio
    );
    acum.hod += mins.hod;
    acum.hon += mins.hon;
    acum.hdfd += mins.hdfd;
    acum.hdfn += mins.hdfn;
    detalle.push({ fechaIso: it.fechaIso, ...minutosAHoras(mins) });

    for (const nf of netosPorFecha) {
      if (nf.esDescanso) fechasDescanso.add(nf.fechaIso);
      if (esDomingo(nf.fechaIso)) fechasDomingos.add(nf.fechaIso);
    }
  }

  const fechasDescansoLaboradas = Array.from(fechasDescanso).sort();
  const fechasDomingosLaborados = Array.from(fechasDomingos).sort();
  return {
    ...minutosAHoras(acum),
    detalle,
    fechasDescansoLaboradas,
    diasDescansoLaborados: fechasDescansoLaboradas.length,
    fechasDomingosLaborados,
    domingosLaborados: fechasDomingosLaborados.length,
  };
}

/** Lunes de la semana calendario correspondiente a `fechaIso` (ISO week: Lun–Dom). */
export function lunesDeSemanaIso(fechaIso: string): string {
  const { y, m, d } = parseIso(fechaIso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0=Dom..6=Sáb
  const diffALunes = day === 0 ? -6 : 1 - day;
  return sumarDiasIso(fechaIso, diffALunes);
}

/**
 * Evalúa la jornada semanal del periodo bajo Ley 2101/2021 (máx. 42 h/sem desde 15-jul-2026),
 * Art. 22 Ley 50/1990 (máx. +12 h extras/sem) y Art. 165 CST (turnos sucesivos: promedio de 3 semanas <= límite legal).
 */
export function evaluarJornadaSemanalPeriodo(items: ReadonlyArray<ItemPeriodo>): EvaluacionJornadaPeriodo {
  const porSemanaMin = new Map<string, number>();

  for (const it of items) {
    if (!turnoEsLaborado(it.turno)) continue;
    const m = liquidarTurnoMinutos(it.turno, it.fechaIso, () => false);
    const totalMin = m.hod + m.hon + m.hdfd + m.hdfn;
    if (totalMin <= 0) continue;
    const lun = lunesDeSemanaIso(it.fechaIso);
    porSemanaMin.set(lun, (porSemanaMin.get(lun) || 0) + totalMin);
  }

  const semanasOrdenadas = Array.from(porSemanaMin.keys()).sort();
  const semanas: EvaluacionSemanaJornada[] = [];
  let limiteOrdinarioMaximo = 0;

  for (const lun of semanasOrdenadas) {
    const dom = sumarDiasIso(lun, 6);
    const limite = jornadaSemanalLegalVigente(dom);
    if (limite > limiteOrdinarioMaximo) limiteOrdinarioMaximo = limite;
    const horasTotales = r2((porSemanaMin.get(lun) || 0) / 60);
    semanas.push({
      semanaInicioIso: lun,
      semanaFinIso: dom,
      horasTotales,
      limiteOrdinarioVigente: limite,
      excedeOrdinario: horasTotales > limite,
      excedeTopeAbsoluto: horasTotales > limite + TOPE_HORAS_EXTRAS_SEMANALES,
    });
  }

  const promedios3SemanasExcedidos: EvaluacionJornadaPeriodo['promedios3SemanasExcedidos'] = [];
  for (let i = 0; i <= semanas.length - 3; i++) {
    const w0 = semanas[i];
    const w1 = semanas[i + 1];
    const w2 = semanas[i + 2];
    // Solo evaluar ventanas realmente contiguas (3 semanas consecutivas en calendario)
    if (sumarDiasIso(w0.semanaInicioIso, 7) !== w1.semanaInicioIso || sumarDiasIso(w1.semanaInicioIso, 7) !== w2.semanaInicioIso) {
      continue;
    }
    const promedio = r2((w0.horasTotales + w1.horasTotales + w2.horasTotales) / 3);
    const limite = Math.max(w0.limiteOrdinarioVigente, w1.limiteOrdinarioVigente, w2.limiteOrdinarioVigente);
    if (promedio > limite) {
      promedios3SemanasExcedidos.push({
        desdeSemana: w0.semanaInicioIso,
        hastaSemana: w2.semanaFinIso,
        promedio,
        limite,
      });
    }
  }

  const semanasSobreOrdinario = semanas.filter((s) => s.excedeOrdinario).length;
  const semanasSobreTopeAbsoluto = semanas.filter((s) => s.excedeTopeAbsoluto).length;

  return {
    semanas,
    limiteOrdinarioMaximo,
    semanasSobreOrdinario,
    semanasSobreTopeAbsoluto,
    promedios3SemanasExcedidos,
    tieneInfraccionSemanal: semanasSobreTopeAbsoluto > 0 || promedios3SemanasExcedidos.length > 0,
  };
}
