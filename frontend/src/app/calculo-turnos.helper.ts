import {
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  TipoTurnoConfig,
} from './models';
import { FestivosColombiaHelper } from './festivos-colombia.helper';
import {
  calcularDiasCompensatoriosDominicales,
  calcularMetaMensualPorDiasHabiles,
  combinarReglasEmpresa,
  contarDiasHabilesMes,
  contarDiasHabilesProrrateados,
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
  ReglasEmpresaContrato,
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
  diasHabilesMes: number;
  diasHabilesProrrateados: number;
  diasExonerados: number;
  horasContratadasNominales: number;
  horasExoneradas: number;
  horasContratadasEfectivas: number;
  horasSemanalesAplicadas: number;
  empresaCodigo: string;
  empresaNombre: string;
  empresaEstadoConfiguracion: string;
  usaBancoHoras: boolean;
  saldoAntReal: number;
  diferenciaMes: number;
  nuevoSaldoBanco: number;
  causaCompensatorioDominical: boolean;
  estadoBanco: 'EQUILIBRADO' | 'ATENCION' | 'CRITICO';
  nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO';
  /** Porcentajes de recargo legalmente vigentes en el periodo según empresa/ley. */
  recargos: RecargosVigentes;
}

/** Predicado estándar de día de descanso obligatorio (domingo o festivo oficial/cívico cargado en el helper de festivos). */
export function predicadoDescansoObligatorio(): PredicadoDescanso {
  return crearPredicadoDescanso((fechaIso) => Boolean(FestivosColombiaHelper.esFestivo(fechaIso)));
}

/** Resuelve el conjunto de reglas contractuales aplicables a un colaborador (EmpresaContratante + override individual). */
export function reglasEmpresaDeEmpleado(
  emp?: Partial<EmpleadoHospital> | null
): ReglasEmpresaContrato {
  const ec = emp?.empresaContratante;
  const override =
    emp?.horasSemanalesOverride !== undefined && emp?.horasSemanalesOverride !== null
      ? emp.horasSemanalesOverride
      : !ec && emp?.horasSemanalesLey
        ? emp.horasSemanalesLey
        : undefined;

  return combinarReglasEmpresa(
    ec
      ? {
          empresaId: ec.id,
          codigo: ec.codigo,
          nombre: ec.nombre,
          estadoConfiguracion: ec.estadoConfiguracion,
          plantillaNormativa: ec.plantillaNormativa,
          horasSemanalesContrato: ec.horasSemanalesContrato,
          diasBaseSemana: ec.diasBaseSemana,
          horaInicioNocturnoMin: ec.horaInicioNocturnoMin,
          horaFinNocturnoMin: ec.horaFinNocturnoMin,
          porcentajeRecargoNocturno: ec.porcentajeRecargoNocturno,
          modoRecargoDominical: ec.modoRecargoDominical,
          porcentajeRecargoDominicalFijo: ec.porcentajeRecargoDominicalFijo,
          aplicaTopeHorasExtrasSemanal: ec.aplicaTopeHorasExtrasSemanal,
          topeHorasExtrasSemanal: ec.topeHorasExtrasSemanal,
          usaBancoHoras: ec.usaBancoHoras,
        }
      : undefined,
    override
  );
}

/** Meta mensual nominal de un colaborador calculada por días hábiles del periodo y reglas de su empresa. */
export function calcularMetaNominalMesEmpleado(
  emp: Partial<EmpleadoHospital> | undefined | null,
  anio: number,
  mes: number,
  esFestivo: (fechaIso: string) => boolean = (iso) => Boolean(FestivosColombiaHelper.esFestivo(iso))
): { diasHabilesMes: number; horasSemanalesAplicadas: number; horasContratadasNominales: number } {
  const reglas = reglasEmpresaDeEmpleado(emp);
  const resumen = contarDiasHabilesMes(anio, mes, esFestivo);
  const meta = calcularMetaMensualPorDiasHabiles(
    reglas.horasSemanalesContrato,
    resumen.diasHabilesMes,
    0,
    reglas.diasBaseSemana
  );
  return {
    diasHabilesMes: meta.diasHabilesMes,
    horasSemanalesAplicadas: meta.horasSemanalesAplicadas,
    horasContratadasNominales: meta.horasContratadasNominales,
  };
}

/** Horas liquidadas (netas) de un turno que inicia en `fechaIso`. Única vía para obtener horas de una celda. */
export function horasLiquidadasCelda(
  cfg: TipoTurnoConfig | undefined,
  fechaIso: string,
  esDescanso: PredicadoDescanso = predicadoDescansoObligatorio(),
  reglas?: Partial<ReglasEmpresaContrato> | null
): number {
  return liquidarTurno(cfg, fechaIso, esDescanso, reglas).total;
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
  esDescanso: PredicadoDescanso = predicadoDescansoObligatorio(),
  reglas?: Partial<ReglasEmpresaContrato> | null,
  esFestivo?: (fechaIso: string) => boolean
): {
  horasTrabajadas: number;
  horasAmortizadasComp: number;
  diasExonerados: number;
  diasHabilesProrrateados: number;
} {
  const predFest = esFestivo ?? ((iso: string) => esDescanso(iso));
  const hSem = reglas?.horasSemanalesContrato ?? 42;
  const dBase = reglas?.diasBaseSemana ?? 6;
  const items: { fechaIso: string; codigo?: string; turno: TipoTurnoConfig | undefined }[] = [];
  let horasAmortizadasComp = 0;

  for (const [diaStr, celda] of Object.entries(celdasEmp || {})) {
    const cod = (celda?.codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') continue;
    const cfg = catalogo[cod];
    const fechaIso = fechaIsoDelDia(anio, mes, Number(diaStr));
    if (!cfg) {
      items.push({ fechaIso, codigo: cod, turno: undefined });
      continue;
    }
    horasAmortizadasComp = r2(
      horasAmortizadasComp + obtenerHorasAmortizacionTurno(cfg, hSem, dBase)
    );
    items.push({ fechaIso, codigo: cod, turno: cfg });
  }

  const diasHabilesProrrateados = contarDiasHabilesProrrateados(items, predFest);
  return {
    horasTrabajadas: liquidarPeriodo(items, esDescanso, reglas).total,
    horasAmortizadasComp,
    diasExonerados: diasHabilesProrrateados,
    diasHabilesProrrateados,
  };
}

/**
 * Función compartida para la liquidación mensual de turnos de un colaborador (multi-empresa + días hábiles + CST/Ley 2466/Decreto 1042).
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
  esDescanso?: PredicadoDescanso,
  esFestivo?: (fechaIso: string) => boolean
): MetricasMesColaborador {
  const reglas = reglasEmpresaDeEmpleado(emp);
  const festivosEnDias = new Set(dias.filter((d) => Boolean(d.festivo)).map((d) => d.fechaIso));
  const predFest: (fechaIso: string) => boolean =
    esFestivo ??
    (esDescanso
      ? (iso: string) => esDescanso(iso)
      : (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso)) || festivosEnDias.has(iso));
  const predDescanso = esDescanso ?? crearPredicadoDescanso(predFest);

  const celdas = celdasEmp || {};
  let horasAmortizadasComp = 0;
  let conteoNoches = 0;
  let diasVac = 0;
  let diasInc = 0;
  let diasLic = 0;
  let diasFam = 0;
  const items: { fechaIso: string; codigo?: string; turno: TipoTurnoConfig | undefined }[] = [];

  for (const d of dias) {
    const cod = (celdas[d.dia]?.codigo || '').trim().toUpperCase();
    if (!cod || cod === 'BLANCO') continue;
    if (cod === 'VAC') diasVac++;
    if (cod === 'INC') diasInc++;
    if (cod === 'LIC') diasLic++;
    if (cod === 'FAM') diasFam++;

    const cfg = catalogo[cod];
    if (!cfg) {
      items.push({ fechaIso: d.fechaIso, codigo: cod, turno: undefined });
      continue;
    }

    items.push({ fechaIso: d.fechaIso, codigo: cod, turno: cfg });
    if (esTurnoNocturnoPrincipal(cfg)) conteoNoches++;
    horasAmortizadasComp = r2(
      horasAmortizadasComp +
        obtenerHorasAmortizacionTurno(cfg, reglas.horasSemanalesContrato, reglas.diasBaseSemana)
    );
  }

  const liq = liquidarPeriodo(items, predDescanso, reglas);
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

  const resumenHabiles = contarDiasHabilesMes(anio, mes, predFest);
  const diasHabilesProrrateados = contarDiasHabilesProrrateados(items, predFest);
  const meta = calcularMetaMensualPorDiasHabiles(
    reglas.horasSemanalesContrato,
    resumenHabiles.diasHabilesMes,
    diasHabilesProrrateados,
    reglas.diasBaseSemana
  );

  const tieneTurnosOperativos = horasTrabajadas > 0 || horasAmortizadasComp > 0;
  const diferenciaMes =
    reglas.usaBancoHoras === false
      ? 0
      : tieneTurnosOperativos
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
    diasHabilesMes: meta.diasHabilesMes,
    diasHabilesProrrateados: meta.diasHabilesProrrateados,
    diasExonerados: meta.diasHabilesProrrateados,
    horasContratadasNominales: meta.horasContratadasNominales,
    horasExoneradas: meta.horasExoneradas,
    horasContratadasEfectivas: meta.horasContratadasEfectivas,
    horasSemanalesAplicadas: meta.horasSemanalesAplicadas,
    empresaCodigo: emp.empresaContratante?.codigo || reglas.codigo || 'CST_DEFAULT',
    empresaNombre: emp.empresaContratante?.nombre || reglas.nombre || 'Régimen CST',
    empresaEstadoConfiguracion:
      emp.empresaContratante?.estadoConfiguracion || reglas.estadoConfiguracion || 'CONFIRMADA',
    usaBancoHoras: reglas.usaBancoHoras !== false,
    saldoAntReal,
    diferenciaMes,
    nuevoSaldoBanco,
    causaCompensatorioDominical: calcularDiasCompensatoriosDominicales(conteoDomingos) > 0,
    estadoBanco,
    nivelFatiga,
    recargos: recargosVigentes(fechaRefPeriodo, reglas),
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
