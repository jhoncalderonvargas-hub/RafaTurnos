// ⚠️ ARCHIVO GENERADO desde /shared/liquidacion-horas.ts — NO EDITAR AQUÍ. Ejecuta: node scripts/sync-shared.mjs
/**
 * MOTOR ÚNICO DE LIQUIDACIÓN DE HORAS — Rafa Turnos
 * ==================================================
 * FUENTE CANÓNICA. No editar las copias en `frontend/src/app/shared/` ni `backend/src/shared/`:
 * se regeneran con `node scripts/sync-shared.mjs` (y `node scripts/verificar-liquidacion.mjs` falla si divergen).
 *
 * Principios (desacoplamiento financiero, Doc 10): el sistema NO calcula dinero. Mide HORAS por concepto
 * (HOD, HON, HDFD, HDFN) y expone los PORCENTAJES de recargo legalmente vigentes en cada empresa/fecha para que
 * Nómina los aplique con sus propios divisores y salarios.
 *
 * Soporta múltiples regímenes contractuales simultáneos (`ReglasEmpresaContrato`):
 *  - Planta Pública ESE (Decreto 1042: 44 h/sem, nocturno 18:00–06:00, dominical/festivo 100%).
 *  - Operadores Privados / Temporales (CST + Ley 2101 + Ley 2466: 42 h/sem, nocturno 19:00–06:00, dom gradual 90%->100%).
 *  - Regímenes Personalizados / Agremiaciones con parámetros configurables desde Talento Humano.
 *
 * Meta mensual universal por Días Hábiles (`!esDomingo && !esFestivo`):
 *  - `horasContratadasNominales = r2((diasHabilesMes * horasSemanales) / diasBaseSemana)`
 *  - Prorrateo selectivo: únicamente cuentan fechas con `TipoTurno.prorrateaMetaContrato === true` que caigan en DÍA HÁBIL.
 *  - `horasContratadasEfectivas = r2(((diasHabilesMes - diasHabilesProrrateados) * horasSemanales) / diasBaseSemana)`
 */

// ───────────────────────────── Constantes normativas ─────────────────────────────

export const MINUTOS_DIA = 1440;
/** Fin de la franja nocturna (06:00), estándar por defecto. */
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

/** Horas amortizadas por defecto por cada turno compensatorio (COMP) cuando usa modo HORAS_FIJAS sin valor explícito. */
export const HORAS_AMORTIZACION_COMP_DEFAULT = 8;

/** Respaldo legacy de códigos de exoneración cuando un objeto turno no trae `prorrateaMetaContrato`. */
export const CODIGOS_EXONERACION_CONTRATO: ReadonlySet<string> = new Set(['VAC', 'INC', 'LIC', 'FAM']);

/** Turnos estructurales obligatorios del sistema (protegidos contra borrado o cambio de código). */
export const CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS: ReadonlySet<string> = new Set([
  'BLANCO',
  'L',
  'S',
  'COMP',
  'VAC',
  'INC',
  'LIC',
  'FAM',
]);

/** Umbrales compartidos para el semáforo de Banco de Horas (Planificador, Reportes y Nómina). */
export const SEMAFORO_BANCO_HORAS = {
  ATENCION_POS: 18,
  CRITICO_POS: 30,
  ATENCION_NEG: -6,
  CRITICO_NEG: -18,
} as const;

// ───────────────────────────── Reglas Multi-Empresa ─────────────────────────────

export type PlantillaNormativaEmpresa = 'DECRETO_1042' | 'CST_LEY_2466' | 'PERSONALIZADA';
export type ModoRecargoDominicalEmpresa = 'LEY_2466' | 'FIJO';
export type ModoAmortizacionBanco = 'DIA_HABIL_EMPRESA' | 'HORAS_FIJAS';

export interface ReglasEmpresaContrato {
  empresaId?: string;
  codigo?: string;
  nombre?: string;
  estadoConfiguracion?: 'CONFIRMADA' | 'PENDIENTE_REGLAS' | string;
  plantillaNormativa?: PlantillaNormativaEmpresa | string;
  horasSemanalesContrato: number;
  diasBaseSemana: number;
  horaInicioNocturnoMin?: number | null;
  horaFinNocturnoMin?: number | null;
  porcentajeRecargoNocturno?: number;
  modoRecargoDominical?: ModoRecargoDominicalEmpresa | string;
  porcentajeRecargoDominicalFijo?: number | null;
  aplicaTopeHorasExtrasSemanal?: boolean;
  topeHorasExtrasSemanal?: number;
  usaBancoHoras?: boolean;
}

export const PLANTILLA_DECRETO_1042: ReglasEmpresaContrato = {
  plantillaNormativa: 'DECRETO_1042',
  horasSemanalesContrato: 44,
  diasBaseSemana: 6,
  horaInicioNocturnoMin: 18 * 60,
  horaFinNocturnoMin: 6 * 60,
  porcentajeRecargoNocturno: 0.35,
  modoRecargoDominical: 'FIJO',
  porcentajeRecargoDominicalFijo: 1.0,
  aplicaTopeHorasExtrasSemanal: true,
  topeHorasExtrasSemanal: 12,
  usaBancoHoras: true,
};

export const PLANTILLA_CST_LEY_2466: ReglasEmpresaContrato = {
  plantillaNormativa: 'CST_LEY_2466',
  horasSemanalesContrato: 42,
  diasBaseSemana: 6,
  horaInicioNocturnoMin: 19 * 60,
  horaFinNocturnoMin: 6 * 60,
  porcentajeRecargoNocturno: 0.35,
  modoRecargoDominical: 'LEY_2466',
  porcentajeRecargoDominicalFijo: null,
  aplicaTopeHorasExtrasSemanal: true,
  topeHorasExtrasSemanal: 12,
  usaBancoHoras: true,
};

export const PLANTILLA_PERSONALIZADA_DEFAULT: ReglasEmpresaContrato = {
  ...PLANTILLA_CST_LEY_2466,
  plantillaNormativa: 'PERSONALIZADA',
};

export function resolverPlantillaEmpresa(
  plantilla?: PlantillaNormativaEmpresa | string | null
): ReglasEmpresaContrato {
  const key = String(plantilla || '').trim().toUpperCase();
  if (key === 'DECRETO_1042') return { ...PLANTILLA_DECRETO_1042 };
  if (key === 'PERSONALIZADA') return { ...PLANTILLA_PERSONALIZADA_DEFAULT };
  return { ...PLANTILLA_CST_LEY_2466 };
}

export function combinarReglasEmpresa(
  empresa?: Partial<ReglasEmpresaContrato> | null,
  horasSemanalesOverride?: number | null
): ReglasEmpresaContrato {
  const base = resolverPlantillaEmpresa(empresa?.plantillaNormativa);
  const hOverride = Number(horasSemanalesOverride);
  const hEmpresa = Number(empresa?.horasSemanalesContrato);
  const horasSemanalesContrato =
    Number.isFinite(hOverride) && hOverride > 0
      ? hOverride
      : Number.isFinite(hEmpresa) && hEmpresa > 0
        ? hEmpresa
        : base.horasSemanalesContrato;

  return {
    ...base,
    ...(empresa || {}),
    horasSemanalesContrato,
    diasBaseSemana:
      empresa?.diasBaseSemana && empresa.diasBaseSemana > 0
        ? Math.round(empresa.diasBaseSemana)
        : base.diasBaseSemana,
    horaInicioNocturnoMin:
      empresa?.horaInicioNocturnoMin !== undefined
        ? empresa.horaInicioNocturnoMin
        : base.horaInicioNocturnoMin,
    horaFinNocturnoMin:
      empresa?.horaFinNocturnoMin !== undefined
        ? empresa.horaFinNocturnoMin
        : base.horaFinNocturnoMin,
    porcentajeRecargoNocturno:
      empresa?.porcentajeRecargoNocturno !== undefined && empresa.porcentajeRecargoNocturno >= 0
        ? empresa.porcentajeRecargoNocturno
        : base.porcentajeRecargoNocturno,
    modoRecargoDominical: empresa?.modoRecargoDominical || base.modoRecargoDominical,
    porcentajeRecargoDominicalFijo:
      empresa?.porcentajeRecargoDominicalFijo !== undefined
        ? empresa.porcentajeRecargoDominicalFijo
        : base.porcentajeRecargoDominicalFijo,
    aplicaTopeHorasExtrasSemanal:
      empresa?.aplicaTopeHorasExtrasSemanal !== undefined
        ? Boolean(empresa.aplicaTopeHorasExtrasSemanal)
        : base.aplicaTopeHorasExtrasSemanal,
    topeHorasExtrasSemanal:
      empresa?.topeHorasExtrasSemanal !== undefined && empresa.topeHorasExtrasSemanal >= 0
        ? empresa.topeHorasExtrasSemanal
        : base.topeHorasExtrasSemanal,
    usaBancoHoras:
      empresa?.usaBancoHoras !== undefined ? Boolean(empresa.usaBancoHoras) : base.usaBancoHoras,
  };
}

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
  codigo?: string;
  horaInicio?: string;
  horaFin?: string;
  horasOrdinarias: number;
  /** Solo se usan como respaldo si el turno no tiene horario válido. */
  horasDiurnas?: number;
  horasNocturnas?: number;
  minutosAlmuerzo?: number;
  esAusencia?: boolean;
  prorrateaMetaContrato?: boolean;
  bloqueaPermutas?: boolean;
  descuentaBancoHoras?: boolean;
  modoAmortizacionBanco?: ModoAmortizacionBanco | string;
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
  codigo?: string;
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
  /** True si hay al menos una semana > límite + tope extras o promedio 3 semanas > límite (Art. 165 CST). */
  tieneInfraccionSemanal: boolean;
}

export interface ResumenDiasHabilesMes {
  diasDelMes: number;
  diasHabilesMes: number;
  fechasHabilesIso: string[];
}

export interface ResultadoMetaDiasHabiles {
  horasSemanalesAplicadas: number;
  diasHabilesMes: number;
  diasHabilesProrrateados: number;
  diasHabilesObjetivo: number;
  horasContratadasNominales: number;
  horasExoneradas: number;
  horasContratadasEfectivas: number;
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

/**
 * Concepto único de Día Hábil Colombia: todo día calendario distinto a domingo y distinto a festivo (oficial o cívico).
 */
export function esDiaHabilColombia(
  fechaIso: string,
  esFestivo: (fechaIso: string) => boolean | undefined | null
): boolean {
  return !esDomingo(fechaIso) && !Boolean(esFestivo(fechaIso));
}

/** Cuenta los días hábiles del mes calendario (`!esDomingo && !esFestivo`). */
export function contarDiasHabilesMes(
  anio: number,
  mes: number,
  esFestivo: (fechaIso: string) => boolean | undefined | null
): ResumenDiasHabilesMes {
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, '0');
  const fechasHabilesIso: string[] = [];
  for (let dia = 1; dia <= diasDelMes; dia++) {
    const iso = `${anio}-${mm}-${String(dia).padStart(2, '0')}`;
    if (esDiaHabilColombia(iso, esFestivo)) {
      fechasHabilesIso.push(iso);
    }
  }
  return {
    diasDelMes,
    diasHabilesMes: fechasHabilesIso.length,
    fechasHabilesIso,
  };
}

function valorVigente<T extends { desde: string }>(tabla: ReadonlyArray<T>, fechaIso: string): T {
  let vigente = tabla[0];
  for (const fila of tabla) {
    if (fila.desde <= fechaIso) vigente = fila;
    else break;
  }
  return vigente;
}

// ───────────────────────────── Vigencias y Parametrización ─────────────────────────────

export function finNocturnoVigente(reglas?: Partial<ReglasEmpresaContrato> | null): number {
  const val = Number(reglas?.horaFinNocturnoMin);
  return Number.isFinite(val) && val >= 0 && val <= 720 ? val : FIN_NOCTURNO_MIN;
}

export function inicioNocturnoVigente(
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): number {
  if (reglas?.horaInicioNocturnoMin !== undefined && reglas?.horaInicioNocturnoMin !== null) {
    const val = Number(reglas.horaInicioNocturnoMin);
    if (Number.isFinite(val) && val >= 720 && val <= MINUTOS_DIA) {
      return val;
    }
  }
  return valorVigente(VIGENCIAS_INICIO_NOCTURNO, fechaIso).inicioMin;
}

export function jornadaSemanalLegalVigente(
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): number {
  const h = Number(reglas?.horasSemanalesContrato);
  if (Number.isFinite(h) && h > 0) return h;
  return valorVigente(VIGENCIAS_JORNADA_SEMANAL, fechaIso).horas;
}

/** Divisor mensual de la hora ordinaria = (jornada semanal / 6 días) × 30 días (p. ej. 42 h → 210; 44 h → 220). */
export function divisorHorasMensualesVigente(
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): number {
  const diasSem = reglas?.diasBaseSemana && reglas.diasBaseSemana > 0 ? reglas.diasBaseSemana : 6;
  return r2((jornadaSemanalLegalVigente(fechaIso, reglas) / diasSem) * 30);
}

export const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Horas que amortiza un turno compensatorio en el Banco de Horas:
 * - `'DIA_HABIL_EMPRESA'`: amortiza `horasSemanalesEmpresa / diasBaseSemana` (7.33 h en 44 h/sem; 7.00 h en 42 h/sem).
 * - `'HORAS_FIJAS'`: usa `turno.horasAmortizacionBanco` (> 0) o `HORAS_AMORTIZACION_COMP_DEFAULT` (8 h).
 */
export function obtenerHorasAmortizacionTurno(
  turno:
    | {
        descuentaBancoHoras?: boolean;
        modoAmortizacionBanco?: ModoAmortizacionBanco | string | null;
        horasAmortizacionBanco?: number | null;
      }
    | undefined
    | null,
  horasSemanalesEmpresa = 42,
  diasBaseSemana = 6
): number {
  if (!turno?.descuentaBancoHoras) return 0;
  const modo = String(turno.modoAmortizacionBanco || 'HORAS_FIJAS').trim().toUpperCase();
  if (modo === 'DIA_HABIL_EMPRESA') {
    const hSem = Math.max(0, Number(horasSemanalesEmpresa) || 42);
    const dBase = Math.max(1, Number(diasBaseSemana) || 6);
    return r2(hSem / dBase);
  }
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

/** Determina si el turno prorratea la meta mensual usando la propiedad configurable y fallback legacy por código. */
export function esTurnoProrrateable(
  turno: { prorrateaMetaContrato?: boolean; codigo?: string } | undefined | null,
  codigoFallback?: string
): boolean {
  if (turno && typeof turno.prorrateaMetaContrato === 'boolean') {
    return turno.prorrateaMetaContrato;
  }
  return esCodigoExoneracionContrato(turno?.codigo ?? codigoFallback);
}

/** Cuenta únicamente los días hábiles (`!esDomingo && !esFestivo`) cuya asignación tiene `prorrateaMetaContrato === true`. */
export function contarDiasHabilesProrrateados(
  items: ReadonlyArray<ItemPeriodo>,
  esFestivo: (fechaIso: string) => boolean | undefined | null
): number {
  const fechasContadas = new Set<string>();
  for (const it of items) {
    if (!it?.fechaIso) continue;
    if (!esTurnoProrrateable(it.turno, it.codigo ?? it.turno?.codigo)) continue;
    if (esDiaHabilColombia(it.fechaIso, esFestivo)) {
      fechasContadas.add(it.fechaIso);
    }
  }
  return fechasContadas.size;
}

/**
 * Fórmula maestra de meta mensual dinámica por Días Hábiles y Prorrateo Selectivo:
 *  - `horasContratadasNominales = r2((diasHabilesMes * horasSemanalesContrato) / diasBaseSemana)`
 *  - `horasContratadasEfectivas = r2(((diasHabilesMes - diasHabilesProrrateados) * horasSemanalesContrato) / diasBaseSemana)`
 */
export function calcularMetaMensualPorDiasHabiles(
  horasSemanalesContrato: number,
  diasHabilesMes: number,
  diasHabilesProrrateados = 0,
  diasBaseSemana = 6
): ResultadoMetaDiasHabiles {
  const hSem = Math.max(0, Number(horasSemanalesContrato) || 0);
  const dBase = Math.max(1, Number(diasBaseSemana) || 6);
  const dHab = Math.max(0, Math.round(Number(diasHabilesMes) || 0));
  const dPror = Math.max(0, Math.min(dHab, Math.round(Number(diasHabilesProrrateados) || 0)));
  const dObj = Math.max(0, dHab - dPror);

  const horasContratadasNominales = dHab === 0 ? 0 : r2((dHab * hSem) / dBase);
  const horasContratadasEfectivas = dObj === 0 ? 0 : r2((dObj * hSem) / dBase);
  const horasExoneradas = Math.max(0, r2(horasContratadasNominales - horasContratadasEfectivas));

  return {
    horasSemanalesAplicadas: r2(hSem),
    diasHabilesMes: dHab,
    diasHabilesProrrateados: dPror,
    diasHabilesObjetivo: dObj,
    horasContratadasNominales,
    horasExoneradas,
    horasContratadasEfectivas,
  };
}

/**
 * Prorrateo legacy proporcional por días del mes. Conservado por compatibilidad con utilidades existentes.
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

export function recargosVigentes(
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): RecargosVigentes {
  const nocturno =
    reglas?.porcentajeRecargoNocturno !== undefined && reglas.porcentajeRecargoNocturno >= 0
      ? reglas.porcentajeRecargoNocturno
      : RECARGO_NOCTURNO;

  const usaDomFijo =
    String(reglas?.modoRecargoDominical || '').toUpperCase() === 'FIJO' &&
    reglas?.porcentajeRecargoDominicalFijo !== undefined &&
    reglas?.porcentajeRecargoDominicalFijo !== null;

  const dominical = usaDomFijo
    ? Math.max(0, Number(reglas!.porcentajeRecargoDominicalFijo))
    : valorVigente(VIGENCIAS_RECARGO_DOMINICAL, fechaIso).valor;

  return {
    nocturno,
    dominical,
    nocturnoDominical: r2(dominical + nocturno),
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

/** Texto de la franja diurna/nocturna vigente en una fecha, p. ej. "06:00–19:00" o "18:00–06:00". */
export function textoFranjasVigentes(
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): { diurna: string; nocturna: string } {
  const hh = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const ini = inicioNocturnoVigente(fechaIso, reglas);
  const fin = finNocturnoVigente(reglas);
  return { diurna: `${hh(fin)}–${hh(ini)}`, nocturna: `${hh(ini)}–${hh(fin)}` };
}

/** Franjas, jornada y recargos a mostrar en la cabecera de un periodo mensual. */
export function resumenNormativoPeriodo(
  anio: number,
  mes: number,
  reglas?: Partial<ReglasEmpresaContrato> | null
): {
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
    recargos: recargosVigentes(ultimo, reglas),
    franjas: textoFranjasVigentes(ultimo, reglas),
    jornadaSemanalHoras: jornadaSemanalLegalVigente(ultimo, reglas),
    divisorHorasMensuales: divisorHorasMensualesVigente(ultimo, reglas),
    franjaCambiaEnElMes: inicioNocturnoVigente(primero, reglas) !== inicioNocturnoVigente(ultimo, reglas),
    recargoDominicalCambiaEnElMes:
      recargosVigentes(cierreMesPrevio, reglas).dominical !== recargosVigentes(ultimo, reglas).dominical,
    jornadaSemanalCambiaEnElMes:
      jornadaSemanalLegalVigente(primero, reglas) !== jornadaSemanalLegalVigente(ultimo, reglas),
  };
}

// ───────────────────────────── Clasificación de minutos ─────────────────────────────

export function parseHoraMin(hhmm?: string): number | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return null;
  return (h === 24 ? 0 : h) * 60 + m;
}

/** ¿El minuto del día (0–1439) de la fecha dada pertenece a la franja nocturna según empresa o ley? */
export function esMinutoNocturno(
  minutoDelDia: number,
  fechaIso: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): boolean {
  return (
    minutoDelDia >= inicioNocturnoVigente(fechaIso, reglas) ||
    minutoDelDia < finNocturnoVigente(reglas)
  );
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
/** Caché de segmentación indexada también por franja nocturna para soportar múltiples empresas sin colisión. */
const CACHE_TRAMOS = new Map<string, ReadonlyArray<TramoBase>>();
const CACHE_TRAMOS_MAX = 80000;

/**
 * Parte un horario en tramos por fecha calendario real y franja (diurna/nocturna), sin descuento de almuerzo.
 * Opera por intervalos (no minuto a minuto): rápido incluso en celdas de 24 h.
 */
export function segmentarHorario(
  fechaInicioIso: string,
  horaInicio: string,
  horaFin: string,
  esDescansoObligatorio: PredicadoDescanso,
  reglas?: Partial<ReglasEmpresaContrato> | null
): TramoLiquidado[] {
  return segmentarBase(fechaInicioIso, horaInicio, horaFin, reglas).map((t) => ({
    ...t,
    esDescansoObligatorio: esDescansoObligatorio(t.fechaIso),
  }));
}

function segmentarBase(
  fechaInicioIso: string,
  horaInicio: string,
  horaFin: string,
  reglas?: Partial<ReglasEmpresaContrato> | null
): ReadonlyArray<TramoBase> {
  const fechaDia1 = sumarDiasIso(fechaInicioIso, 1);
  const ini0 = inicioNocturnoVigente(fechaInicioIso, reglas);
  const ini1 = inicioNocturnoVigente(fechaDia1, reglas);
  const finNoc = finNocturnoVigente(reglas);

  const clave = `${fechaInicioIso}|${horaInicio}|${horaFin}|${ini0}|${ini1}|${finNoc}`;
  const cacheado = CACHE_TRAMOS.get(clave);
  if (cacheado) return cacheado;
  const tramos = calcularTramosBase(fechaInicioIso, fechaDia1, horaInicio, horaFin, ini0, ini1, finNoc);
  if (CACHE_TRAMOS.size >= CACHE_TRAMOS_MAX) CACHE_TRAMOS.clear();
  CACHE_TRAMOS.set(clave, tramos);
  return tramos;
}

function calcularTramosBase(
  fechaInicioIso: string,
  fechaDia1: string,
  horaInicio: string,
  horaFin: string,
  ini0: number,
  ini1: number,
  finNoc: number
): TramoBase[] {
  const s = parseHoraMin(horaInicio);
  const duracion = duracionHorarioMin(horaInicio, horaFin);
  if (s === null || duracion === null) return [];
  const e = s + duracion; // absoluto, < 2880

  const cortes = new Set<number>([s, e]);
  for (const c of [finNoc, ini0, MINUTOS_DIA, MINUTOS_DIA + finNoc, MINUTOS_DIA + ini1]) {
    if (c > s && c < e) cortes.add(c);
  }
  const orden = Array.from(cortes).sort((a, b) => a - b);

  const acumulado = new Map<string, TramoBase>();
  for (let i = 0; i < orden.length - 1; i++) {
    const a = orden[i];
    const b = orden[i + 1];
    const isDia0 = a < MINUTOS_DIA;
    const fechaIso = isDia0 ? fechaInicioIso : fechaDia1;
    const minDelDia = a % MINUTOS_DIA;
    const iniVigente = isDia0 ? ini0 : ini1;
    const nocturno = minDelDia >= iniVigente || minDelDia < finNoc;

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
  esDescansoObligatorio: PredicadoDescanso,
  reglas?: Partial<ReglasEmpresaContrato> | null
): { minutos: MinutosLiquidados; netosPorFecha: Array<{ fechaIso: string; esDescanso: boolean; min: number }> } {
  const cero: MinutosLiquidados = { hod: 0, hon: 0, hdfd: 0, hdfn: 0 };
  if (!turnoEsLaborado(turno)) return { minutos: cero, netosPorFecha: [] };

  const tramos =
    turno.horaInicio && turno.horaFin
      ? segmentarHorario(fechaInicioIso, turno.horaInicio, turno.horaFin, esDescansoObligatorio, reglas)
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
  esDescansoObligatorio: PredicadoDescanso,
  reglas?: Partial<ReglasEmpresaContrato> | null
): MinutosLiquidados {
  return liquidarTurnoConDetalleTramos(turno, fechaInicioIso, esDescansoObligatorio, reglas).minutos;
}

export function minutosAHoras(min: MinutosLiquidados): HorasLiquidadas {
  const h = (n: number) => Math.round((n / 60) * 100) / 100;
  const total = min.hod + min.hon + min.hdfd + min.hdfn;
  return { hod: h(min.hod), hon: h(min.hon), hdfd: h(min.hdfd), hdfn: h(min.hdfn), total: h(total) };
}

export function liquidarTurno(
  turno: TurnoLiquidable | undefined | null,
  fechaInicioIso: string,
  esDescansoObligatorio: PredicadoDescanso,
  reglas?: Partial<ReglasEmpresaContrato> | null
): HorasLiquidadas {
  return minutosAHoras(liquidarTurnoMinutos(turno, fechaInicioIso, esDescansoObligatorio, reglas));
}

/**
 * Desglose de un horario para el catálogo de turnos, tomando un día hábil ordinario con las franjas vigentes.
 */
export function desglosarHorarioOrdinario(
  horaInicio: string,
  horaFin: string,
  minutosAlmuerzo: number,
  fechaRefIso: string,
  permitirMismaHora24h = true,
  reglas?: Partial<ReglasEmpresaContrato> | null
): { ordinarias: number; diurnas: number; nocturnas: number } | null {
  if (duracionHorarioMin(horaInicio, horaFin, permitirMismaHora24h) === null) return null;
  const m = liquidarTurnoMinutos(
    { horaInicio, horaFin, horasOrdinarias: 1, minutosAlmuerzo },
    fechaRefIso,
    () => false,
    reglas
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

export function liquidarPeriodo(
  items: ReadonlyArray<ItemPeriodo>,
  esDescansoObligatorio: PredicadoDescanso,
  reglas?: Partial<ReglasEmpresaContrato> | null
): LiquidacionPeriodo {
  const acum: MinutosLiquidados = { hod: 0, hon: 0, hdfd: 0, hdfn: 0 };
  const detalle: DetalleDiaLiquidado[] = [];
  const fechasDescanso = new Set<string>();
  const fechasDomingos = new Set<string>();

  for (const it of items) {
    if (!turnoEsLaborado(it.turno)) continue;
    const { minutos: mins, netosPorFecha } = liquidarTurnoConDetalleTramos(
      it.turno,
      it.fechaIso,
      esDescansoObligatorio,
      reglas
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
 * Evalúa la jornada semanal del periodo respetando la empresa contratante (42 h CST, 44 h Decreto 1042, etc.),
 * el tope semanal de extras y la regla de turnos sucesivos del Art. 165 CST (promedio de 3 semanas <= límite ordinario).
 */
export function evaluarJornadaSemanalPeriodo(
  items: ReadonlyArray<ItemPeriodo>,
  reglas?: Partial<ReglasEmpresaContrato> | null
): EvaluacionJornadaPeriodo {
  const porSemanaMin = new Map<string, number>();

  for (const it of items) {
    if (!turnoEsLaborado(it.turno)) continue;
    const m = liquidarTurnoMinutos(it.turno, it.fechaIso, () => false, reglas);
    const totalMin = m.hod + m.hon + m.hdfd + m.hdfn;
    if (totalMin <= 0) continue;
    const lun = lunesDeSemanaIso(it.fechaIso);
    porSemanaMin.set(lun, (porSemanaMin.get(lun) || 0) + totalMin);
  }

  const aplicaTope = reglas?.aplicaTopeHorasExtrasSemanal !== false;
  const topeExtras =
    reglas?.topeHorasExtrasSemanal !== undefined && reglas.topeHorasExtrasSemanal >= 0
      ? Number(reglas.topeHorasExtrasSemanal)
      : TOPE_HORAS_EXTRAS_SEMANALES;

  const semanasOrdenadas = Array.from(porSemanaMin.keys()).sort();
  const semanas: EvaluacionSemanaJornada[] = [];
  let limiteOrdinarioMaximo = 0;

  for (const lun of semanasOrdenadas) {
    const dom = sumarDiasIso(lun, 6);
    const limite = jornadaSemanalLegalVigente(dom, reglas);
    if (limite > limiteOrdinarioMaximo) limiteOrdinarioMaximo = limite;
    const horasTotales = r2((porSemanaMin.get(lun) || 0) / 60);
    semanas.push({
      semanaInicioIso: lun,
      semanaFinIso: dom,
      horasTotales,
      limiteOrdinarioVigente: limite,
      excedeOrdinario: horasTotales > limite,
      excedeTopeAbsoluto: aplicaTope ? horasTotales > limite + topeExtras : false,
    });
  }

  const promedios3SemanasExcedidos: EvaluacionJornadaPeriodo['promedios3SemanasExcedidos'] = [];
  for (let i = 0; i <= semanas.length - 3; i++) {
    const w0 = semanas[i];
    const w1 = semanas[i + 1];
    const w2 = semanas[i + 2];
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
