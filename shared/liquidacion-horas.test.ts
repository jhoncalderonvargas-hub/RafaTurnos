/**
 * Pruebas del motor único de liquidación. Ejecutar con: node scripts/verificar-liquidacion.mjs
 * Sin dependencias de test: usa node:assert.
 */
import * as assert from 'node:assert';
import {
  calcularDescansoEntreTurnosMin,
  calcularDiasCompensatoriosDominicales,
  calcularMetaContractualProrrateada,
  crearPredicadoDescanso,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  desglosarHorarioOrdinario,
  divisorHorasMensualesVigente,
  esCodigoExoneracionContrato,
  esDomingo,
  esFechaIsoValida,
  esTurnoNocturnoPrincipal,
  evaluarEstadoBancoHoras,
  evaluarJornadaSemanalPeriodo,
  formatearPorcentaje,
  HORAS_AMORTIZACION_COMP_DEFAULT,
  hoyColombiaIso,
  inicioNocturnoVigente,
  jornadaSemanalLegalVigente,
  liquidarPeriodo,
  liquidarTurno,
  liquidarTurnoMinutos,
  obtenerHorasAmortizacionTurno,
  r2,
  recargosVigentes,
  resumenNormativoPeriodo,
  sumarDiasIso,
  TurnoLiquidable,
} from './liquidacion-horas';

let ok = 0;
function prueba(nombre: string, fn: () => void): void {
  try {
    fn();
    ok++;
    console.log(`  ✔ ${nombre}`);
  } catch (e: any) {
    console.error(`  ✘ ${nombre}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

// Festivos de prueba (2026: lunes 2-nov Todos los Santos; 2025-12-25 Navidad; 2027-01-01 Año Nuevo)
const FESTIVOS = new Set(['2025-12-25', '2026-11-02', '2026-12-08', '2026-12-25', '2027-01-01']);
const descanso = crearPredicadoDescanso((f) => FESTIVOS.has(f));
const habil = () => false;

const T = (horaInicio: string, horaFin: string, horasOrdinarias: number, extra: Partial<TurnoLiquidable> = {}): TurnoLiquidable => ({
  horaInicio,
  horaFin,
  horasOrdinarias,
  ...extra,
});
const N12 = T('19:00', '07:00', 12);
const N8 = T('23:00', '07:00', 8);
const T8 = T('15:00', '23:00', 8);
const M8 = T('07:00', '15:00', 8);
const D12 = T('07:00', '19:00', 12);
const G24 = T('07:00', '07:00', 24);

console.log('Vigencias normativas');
prueba('recargo dominical por fecha: 75→80→90→100%', () => {
  assert.strictEqual(recargosVigentes('2025-06-30').dominical, 0.75);
  assert.strictEqual(recargosVigentes('2025-07-01').dominical, 0.8);
  assert.strictEqual(recargosVigentes('2026-06-30').dominical, 0.8);
  assert.strictEqual(recargosVigentes('2026-07-01').dominical, 0.9);
  assert.strictEqual(recargosVigentes('2027-06-30').dominical, 0.9);
  assert.strictEqual(recargosVigentes('2027-07-01').dominical, 1.0);
});
prueba('recargo nocturno dominical = dominical + 35% (110/115/125/135)', () => {
  assert.strictEqual(recargosVigentes('2025-01-15').nocturnoDominical, 1.1);
  assert.strictEqual(recargosVigentes('2025-08-01').nocturnoDominical, 1.15);
  assert.strictEqual(recargosVigentes('2026-11-10').nocturnoDominical, 1.25);
  assert.strictEqual(recargosVigentes('2027-08-01').nocturnoDominical, 1.35);
  assert.strictEqual(formatearPorcentaje(recargosVigentes('2026-11-10').nocturnoDominical), '125%');
});
prueba('extras dominicales: 90%+25% y 90%+75% en nov-2026', () => {
  const r = recargosVigentes('2026-11-10');
  assert.strictEqual(r.extraDiurnaDominical, 1.15);
  assert.strictEqual(r.extraNocturnaDominical, 1.65);
});
prueba('inicio nocturno: 21:00 hasta 24-dic-2025, 19:00 desde 25-dic-2025', () => {
  assert.strictEqual(inicioNocturnoVigente('2025-12-24'), 21 * 60);
  assert.strictEqual(inicioNocturnoVigente('2025-12-25'), 19 * 60);
  assert.strictEqual(inicioNocturnoVigente('2026-11-10'), 19 * 60);
});
prueba('jornada semanal y divisor: 44 h/220 hasta 14-jul-2026; 42 h/210 desde 15-jul-2026', () => {
  assert.strictEqual(jornadaSemanalLegalVigente('2026-07-14'), 44);
  assert.strictEqual(divisorHorasMensualesVigente('2026-07-14'), 220);
  assert.strictEqual(jornadaSemanalLegalVigente('2026-07-15'), 42);
  assert.strictEqual(divisorHorasMensualesVigente('2026-11-10'), 210);
});

console.log('Fechas');
prueba('domingos y suma de días (incluye cambio de mes/año)', () => {
  assert.ok(esDomingo('2026-11-08'));
  assert.ok(!esDomingo('2026-11-09'));
  assert.strictEqual(sumarDiasIso('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(sumarDiasIso('2024-02-28', 1), '2024-02-29');
});

console.log('Liquidación por turno (franjas 19:00–06:00 vigentes)');
prueba('M8 hábil: 8 HOD', () => {
  assert.deepStrictEqual(liquidarTurno(M8, '2026-11-10', descanso), { hod: 8, hon: 0, hdfd: 0, hdfn: 0, total: 8 });
});
prueba('T8 hábil 15–23: 4 HOD + 4 HON', () => {
  assert.deepStrictEqual(liquidarTurno(T8, '2026-11-10', descanso), { hod: 4, hon: 4, hdfd: 0, hdfn: 0, total: 8 });
});
prueba('D12 hábil: 12 HOD', () => {
  assert.strictEqual(liquidarTurno(D12, '2026-11-10', descanso).hod, 12);
});
prueba('N12 hábil (martes→miércoles): 1 HOD + 11 HON', () => {
  assert.deepStrictEqual(liquidarTurno(N12, '2026-11-10', descanso), { hod: 1, hon: 11, hdfd: 0, hdfn: 0, total: 12 });
});
prueba('G24 hábil: 13 HOD + 11 HON', () => {
  assert.deepStrictEqual(liquidarTurno(G24, '2026-11-10', descanso), { hod: 13, hon: 11, hdfd: 0, hdfn: 0, total: 24 });
});
prueba('D12 en domingo: 12 HDFD', () => {
  assert.deepStrictEqual(liquidarTurno(D12, '2026-11-08', descanso), { hod: 0, hon: 0, hdfd: 12, hdfn: 0, total: 12 });
});
prueba('T8 en domingo: 4 HDFD + 4 HDFN', () => {
  assert.deepStrictEqual(liquidarTurno(T8, '2026-11-08', descanso), { hod: 0, hon: 0, hdfd: 4, hdfn: 4, total: 8 });
});

console.log('Corte de medianoche (las 00:00 parten el turno por fecha real)');
prueba('N12 sábado→domingo: 5 HON (sáb) + 6 HDFN + 1 HDFD (dom)', () => {
  assert.deepStrictEqual(liquidarTurno(N12, '2026-11-07', descanso), { hod: 0, hon: 5, hdfd: 1, hdfn: 6, total: 12 });
});
prueba('N12 domingo→lunes hábil: 5 HDFN (dom) + 6 HON + 1 HOD (lun)', () => {
  assert.deepStrictEqual(liquidarTurno(N12, '2026-11-08', descanso), { hod: 1, hon: 6, hdfd: 0, hdfn: 5, total: 12 });
});
prueba('N12 domingo 1-nov→lunes festivo 2-nov: todo dominical/festivo (5+6 HDFN + 1 HDFD)', () => {
  assert.deepStrictEqual(liquidarTurno(N12, '2026-11-01', descanso), { hod: 0, hon: 0, hdfd: 1, hdfn: 11, total: 12 });
});
prueba('N12 viernes→sábado hábil: nada dominical', () => {
  const r = liquidarTurno(N12, '2026-11-06', descanso);
  assert.strictEqual(r.hdfd + r.hdfn, 0);
});
prueba('N8 23:00–07:00 sábado→domingo: 1 HON + 6 HDFN + 1 HDFD', () => {
  assert.deepStrictEqual(liquidarTurno(N8, '2026-11-07', descanso), { hod: 0, hon: 1, hdfd: 1, hdfn: 6, total: 8 });
});
prueba('G24 sábado→domingo: sáb 07–19 HOD 12, 19–24 HON 5; dom 00–06 HDFN 6, 06–07 HDFD 1', () => {
  assert.deepStrictEqual(liquidarTurno(G24, '2026-11-07', descanso), { hod: 12, hon: 5, hdfd: 1, hdfn: 6, total: 24 });
});
prueba('G24 domingo→lunes: dom 07–19 HDFD 12, 19–24 HDFN 5; lun 00–06 HON 6, 06–07 HOD 1', () => {
  assert.deepStrictEqual(liquidarTurno(G24, '2026-11-08', descanso), { hod: 1, hon: 6, hdfd: 12, hdfn: 5, total: 24 });
});
prueba('N12 31-dic-2026 → 1-ene-2027 festivo (cruce de año)', () => {
  assert.deepStrictEqual(liquidarTurno(N12, '2026-12-31', descanso), { hod: 0, hon: 5, hdfd: 1, hdfn: 6, total: 12 });
});

console.log('Transición de franja nocturna (Ley 2466, 25-dic-2025)');
prueba('T8 el 24-dic-2025 (regía 21:00): 6 HOD + 2 HON', () => {
  assert.deepStrictEqual(liquidarTurno(T8, '2025-12-24', habil), { hod: 6, hon: 2, hdfd: 0, hdfn: 0, total: 8 });
});
prueba('T8 el 26-dic-2025 (rige 19:00): 4 HOD + 4 HON', () => {
  assert.deepStrictEqual(liquidarTurno(T8, '2025-12-26', habil), { hod: 4, hon: 4, hdfd: 0, hdfn: 0, total: 8 });
});
prueba('N12 del 24-dic-2025 a las 19:00 → franja nocturna desde 21:00 de ese día; 25-dic ya 19:00 (festivo)', () => {
  // 24-dic: 19–21 diurna (2 HOD), 21–24 nocturna (3 HON). 25-dic festivo: 0–6 HDFN 6, 6–7 HDFD 1.
  assert.deepStrictEqual(liquidarTurno(N12, '2025-12-24', descanso), { hod: 2, hon: 3, hdfd: 1, hdfn: 6, total: 12 });
});

console.log('Descanso intermedio (Art. 167) y consistencia');
prueba('M8 con 60 min de almuerzo → 7 HOD', () => {
  assert.strictEqual(liquidarTurno({ ...M8, minutosAlmuerzo: 60 }, '2026-11-10', descanso).hod, 7);
});
prueba('T8 con almuerzo 60 min se descuenta del concepto de menor recargo (HOD): 3 HOD + 4 HON', () => {
  assert.deepStrictEqual(liquidarTurno({ ...T8, minutosAlmuerzo: 60 }, '2026-11-10', descanso), { hod: 3, hon: 4, hdfd: 0, hdfn: 0, total: 7 });
});
prueba('ADM 08:00–17:00 con almuerzo 60 → 8 h', () => {
  assert.strictEqual(liquidarTurno(T('08:00', '17:00', 8, { minutosAlmuerzo: 60 }), '2026-11-10', descanso).total, 8);
});
prueba('desglosarHorarioOrdinario (catálogo) coincide con liquidación hábil', () => {
  assert.deepStrictEqual(desglosarHorarioOrdinario('15:00', '23:00', 0, '2026-11-10'), { ordinarias: 8, diurnas: 4, nocturnas: 4 });
  assert.deepStrictEqual(desglosarHorarioOrdinario('07:00', '07:00', 0, '2026-11-10'), { ordinarias: 24, diurnas: 13, nocturnas: 11 });
  assert.strictEqual(desglosarHorarioOrdinario('14:00', '14:00', 0, '2026-11-10', false), null);
});
prueba('ausencias y turnos sin horas no liquidan', () => {
  assert.strictEqual(liquidarTurno({ horasOrdinarias: 0 }, '2026-11-10', descanso).total, 0);
  assert.strictEqual(liquidarTurno({ ...M8, esAusencia: true }, '2026-11-10', descanso).total, 0);
  assert.strictEqual(liquidarTurno(undefined, '2026-11-10', descanso).total, 0);
});
prueba('turno sin horario usa respaldo diurnas/nocturnas en la fecha de inicio', () => {
  const r = liquidarTurno({ horasOrdinarias: 8, horasDiurnas: 4, horasNocturnas: 4 }, '2026-11-08', descanso);
  assert.deepStrictEqual(r, { hod: 0, hon: 0, hdfd: 4, hdfn: 4, total: 8 });
});
prueba('INVARIANTE: HOD+HON+HDFD+HDFN = duración − almuerzo para toda fecha 2025-12 a 2027-01 y todo turno', () => {
  const turnos: Array<[TurnoLiquidable, number]> = [
    [M8, 480], [T8, 480], [N8, 480], [D12, 720], [N12, 720], [G24, 1440], [T('13:00', '19:00', 6), 360],
    [T('08:00', '17:00', 8, { minutosAlmuerzo: 60 }), 480], [T('22:30', '06:15', 8), 465],
  ];
  let f = '2025-12-01';
  while (f <= '2027-01-31') {
    for (const [t, esperado] of turnos) {
      const m = liquidarTurnoMinutos(t, f, descanso);
      assert.strictEqual(m.hod + m.hon + m.hdfd + m.hdfn, esperado, `${f} ${t.horaInicio}-${t.horaFin}`);
      assert.ok(m.hod >= 0 && m.hon >= 0 && m.hdfd >= 0 && m.hdfn >= 0);
    }
    f = sumarDiasIso(f, 1);
  }
});

console.log('Liquidación de periodo y clasificación nocturna');
prueba('periodo: dom/fest laborados cuentan fechas reales (incluye cola tras medianoche)', () => {
  const r = liquidarPeriodo(
    [
      { fechaIso: '2026-11-06', turno: D12 }, // viernes
      { fechaIso: '2026-11-07', turno: N12 }, // sáb → dom (cola dominical)
      { fechaIso: '2026-11-09', turno: M8 }, // lunes hábil
    ],
    descanso
  );
  assert.deepStrictEqual(r.fechasDescansoLaboradas, ['2026-11-08']);
  assert.strictEqual(r.diasDescansoLaborados, 1);
  assert.strictEqual(r.total, 12 + 12 + 8);
  assert.strictEqual(r.hod, 12 + 8);
  assert.strictEqual(r.hon, 5);
  assert.strictEqual(r.hdfn, 6);
  assert.strictEqual(r.hdfd, 1);
  assert.strictEqual(r.detalle.length, 3);
});
prueba('habitualidad dominical (Art. 179 Par. 1 CST): 2 festivos hábiles + 1 domingo NO son 3 domingos', () => {
  const r = liquidarPeriodo(
    [
      { fechaIso: '2026-12-08', turno: D12 }, // martes festivo
      { fechaIso: '2026-12-25', turno: D12 }, // viernes festivo
      { fechaIso: '2026-12-06', turno: D12 }, // domingo
    ],
    descanso
  );
  assert.strictEqual(r.diasDescansoLaborados, 3);
  assert.strictEqual(r.domingosLaborados, 1);
});
prueba('habitualidad dominical: 3 domingos en un mes (incluyendo cola tras medianoche de sáb N12)', () => {
  const r = liquidarPeriodo(
    [
      { fechaIso: '2026-11-01', turno: D12 }, // domingo 1
      { fechaIso: '2026-11-02', turno: D12 }, // lunes festivo (NO es domingo)
      { fechaIso: '2026-11-07', turno: N12 }, // sáb -> domingo 8
      { fechaIso: '2026-11-15', turno: D12 }, // domingo 15
    ],
    descanso
  );
  assert.strictEqual(r.diasDescansoLaborados, 4);
  assert.strictEqual(r.domingosLaborados, 3);
  assert.deepStrictEqual(r.fechasDomingosLaborados, ['2026-11-01', '2026-11-08', '2026-11-15']);
});
prueba('descuento de almuerzo que anula tramo neto no cuenta fecha dom/fest', () => {
  const corto = T('23:30', '00:15', 0, { horasOrdinarias: 0.75, minutosAlmuerzo: 60 });
  const r = liquidarPeriodo([{ fechaIso: '2026-11-07', turno: corto }], descanso);
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.diasDescansoLaborados, 0);
  assert.strictEqual(r.domingosLaborados, 0);
});
prueba('turnos "de noche": N8/N12/G24 sí; T8 y D12 no', () => {
  assert.ok(esTurnoNocturnoPrincipal({ ...N8, horasNocturnas: 7 }));
  assert.ok(esTurnoNocturnoPrincipal({ ...N12, horasNocturnas: 11 }));
  assert.ok(esTurnoNocturnoPrincipal({ ...G24, horasNocturnas: 11, esNocturnoPesado: true }));
  assert.ok(!esTurnoNocturnoPrincipal({ ...T8, horasNocturnas: 4 }));
  assert.ok(!esTurnoNocturnoPrincipal({ ...D12, horasNocturnas: 0 }));
});

console.log('Descanso entre turnos, zona horaria Colombia, semáforo y Art. 165 CST');
prueba('calcularDescansoEntreTurnosMin detecta < 12h tras T8/N12/N8/G24 y respeta 12h exactas', () => {
  assert.strictEqual(calcularDescansoEntreTurnosMin(T8, M8), 8 * 60); // 480 < 720
  assert.strictEqual(calcularDescansoEntreTurnosMin(N12, M8), 0); // empalme inmediato post-guardia
  assert.strictEqual(calcularDescansoEntreTurnosMin(N12, T8), 8 * 60); // 480 < 720
  assert.strictEqual(calcularDescansoEntreTurnosMin(N12, N12), DESCANSO_MINIMO_ENTRE_TURNOS_MIN); // 12h exactas
  assert.strictEqual(calcularDescansoEntreTurnosMin(D12, D12), DESCANSO_MINIMO_ENTRE_TURNOS_MIN); // 12h exactas
  assert.strictEqual(calcularDescansoEntreTurnosMin(M8, M8), 16 * 60);
  assert.strictEqual(calcularDescansoEntreTurnosMin(N12, { horasOrdinarias: 0 }), null);
});
prueba('hoyColombiaIso usa America/Bogota (UTC-5) sin saltar de día después de las 19:00', () => {
  const utcNoche = new Date('2026-11-11T03:30:00Z'); // 22:30 del 10-nov en Bogotá
  assert.strictEqual(hoyColombiaIso(utcNoche), '2026-11-10');
});
prueba('resumenNormativoPeriodo detecta meses de transición y nov-2026 estable', () => {
  const dic25 = resumenNormativoPeriodo(2025, 12);
  assert.strictEqual(dic25.franjaCambiaEnElMes, true);
  assert.strictEqual(dic25.franjas.nocturna, '19:00–06:00');
  const jul26 = resumenNormativoPeriodo(2026, 7);
  assert.strictEqual(jul26.recargoDominicalCambiaEnElMes, true);
  assert.strictEqual(jul26.jornadaSemanalCambiaEnElMes, true);
  assert.strictEqual(jul26.recargos.dominical, 0.9);
  assert.strictEqual(jul26.jornadaSemanalHoras, 42);
  assert.strictEqual(jul26.divisorHorasMensuales, 210);
  const nov26 = resumenNormativoPeriodo(2026, 11);
  assert.strictEqual(nov26.franjaCambiaEnElMes, false);
  assert.strictEqual(nov26.recargoDominicalCambiaEnElMes, false);
  assert.strictEqual(nov26.jornadaSemanalCambiaEnElMes, false);
  assert.strictEqual(nov26.recargos.nocturnoDominical, 1.25);
});
prueba('semáforo banco de horas y redondeo r2', () => {
  assert.strictEqual(r2(12.345), 12.35);
  assert.strictEqual(evaluarEstadoBancoHoras(0), 'EQUILIBRADO');
  assert.strictEqual(evaluarEstadoBancoHoras(18.1), 'ATENCION');
  assert.strictEqual(evaluarEstadoBancoHoras(-6.5), 'ATENCION');
  assert.strictEqual(evaluarEstadoBancoHoras(30.1), 'CRITICO');
  assert.strictEqual(evaluarEstadoBancoHoras(-18.1), 'CRITICO');
});
prueba('evaluarJornadaSemanalPeriodo: permite rotación Art. 165 (48/36/42 → 42h) y alerta exceso promedio o >54h', () => {
  // Rotación válida Art. 165: sem1=48h, sem2=36h, sem3=42h -> prom 42h
  const valida = evaluarJornadaSemanalPeriodo([
    // Semana lun 2026-11-02..dom 08: 4 x D12 = 48h
    { fechaIso: '2026-11-02', turno: D12 },
    { fechaIso: '2026-11-03', turno: D12 },
    { fechaIso: '2026-11-04', turno: D12 },
    { fechaIso: '2026-11-05', turno: D12 },
    // Semana lun 2026-11-09..dom 15: 3 x D12 = 36h
    { fechaIso: '2026-11-09', turno: D12 },
    { fechaIso: '2026-11-10', turno: D12 },
    { fechaIso: '2026-11-11', turno: D12 },
    // Semana lun 2026-11-16..dom 22: 3xD12 + 6h = 42h
    { fechaIso: '2026-11-16', turno: D12 },
    { fechaIso: '2026-11-17', turno: D12 },
    { fechaIso: '2026-11-18', turno: D12 },
    { fechaIso: '2026-11-19', turno: T('07:00', '13:00', 6) },
  ]);
  assert.strictEqual(valida.semanasSobreOrdinario, 1);
  assert.strictEqual(valida.tieneInfraccionSemanal, false);

  // Rotación excesiva Art. 165: 48h, 48h, 42h -> prom 46h > 42h
  const excesoProm = evaluarJornadaSemanalPeriodo([
    { fechaIso: '2026-11-02', turno: D12 },
    { fechaIso: '2026-11-03', turno: D12 },
    { fechaIso: '2026-11-04', turno: D12 },
    { fechaIso: '2026-11-05', turno: D12 },
    { fechaIso: '2026-11-09', turno: D12 },
    { fechaIso: '2026-11-10', turno: D12 },
    { fechaIso: '2026-11-11', turno: D12 },
    { fechaIso: '2026-11-12', turno: D12 },
    { fechaIso: '2026-11-16', turno: D12 },
    { fechaIso: '2026-11-17', turno: D12 },
    { fechaIso: '2026-11-18', turno: D12 },
    { fechaIso: '2026-11-19', turno: T('07:00', '13:00', 6) },
  ]);
  assert.strictEqual(excesoProm.promedios3SemanasExcedidos.length, 1);
  assert.strictEqual(excesoProm.tieneInfraccionSemanal, true);

  // Exceso tope absoluto (> 42 + 12 = 54h en una semana)
  const topeAbs = evaluarJornadaSemanalPeriodo([
    { fechaIso: '2026-11-02', turno: D12 },
    { fechaIso: '2026-11-03', turno: D12 },
    { fechaIso: '2026-11-04', turno: D12 },
    { fechaIso: '2026-11-05', turno: D12 },
    { fechaIso: '2026-11-06', turno: D12 },
  ]);
  assert.strictEqual(topeAbs.semanasSobreTopeAbsoluto, 1);
  assert.strictEqual(topeAbs.tieneInfraccionSemanal, true);
});

console.log('Reglas de Calendario Estricto, COMP configurable, Compensatorios y Prorrata');
prueba('parseIso rechaza fechas calendario inexistentes (sin rollover silencioso)', () => {
  assert.throws(() => sumarDiasIso('2026-02-31', 1), /Fecha calendario inexistente/);
  assert.throws(() => esDomingo('2026-04-31'), /Fecha calendario inexistente/);
  assert.throws(() => sumarDiasIso('2026-13-01', 0), /Fecha calendario inexistente/);
  assert.strictEqual(sumarDiasIso('2024-02-29', 0), '2024-02-29');
  assert.strictEqual(esFechaIsoValida('2026-02-31'), false);
  assert.strictEqual(esFechaIsoValida('2026-11-10'), true);
});

prueba('obtenerHorasAmortizacionTurno usa valor del TipoTurno o default 8h', () => {
  assert.strictEqual(obtenerHorasAmortizacionTurno({ descuentaBancoHoras: false, horasAmortizacionBanco: 7 }), 0);
  assert.strictEqual(obtenerHorasAmortizacionTurno({ descuentaBancoHoras: true }), HORAS_AMORTIZACION_COMP_DEFAULT);
  assert.strictEqual(obtenerHorasAmortizacionTurno({ descuentaBancoHoras: true, horasAmortizacionBanco: null }), 8);
  assert.strictEqual(obtenerHorasAmortizacionTurno({ descuentaBancoHoras: true, horasAmortizacionBanco: 7 }), 7);
  assert.strictEqual(obtenerHorasAmortizacionTurno({ descuentaBancoHoras: true, horasAmortizacionBanco: 12 }), 12);
});

prueba('calcularDiasCompensatoriosDominicales: <3 -> 0; >=3 -> N días (Art. 179 Par. 1 CST)', () => {
  assert.strictEqual(calcularDiasCompensatoriosDominicales(0), 0);
  assert.strictEqual(calcularDiasCompensatoriosDominicales(1), 0);
  assert.strictEqual(calcularDiasCompensatoriosDominicales(2), 0);
  assert.strictEqual(calcularDiasCompensatoriosDominicales(3), 3);
  assert.strictEqual(calcularDiasCompensatoriosDominicales(4), 4);
  assert.strictEqual(calcularDiasCompensatoriosDominicales(5), 5);
});

prueba('calcularMetaContractualProrrateada descuenta VAC/INC/LIC/FAM sin generar deuda falsa', () => {
  assert.ok(esCodigoExoneracionContrato('VAC'));
  assert.ok(esCodigoExoneracionContrato('inc'));
  assert.ok(esCodigoExoneracionContrato('LIC'));
  assert.ok(esCodigoExoneracionContrato('FAM'));
  assert.ok(!esCodigoExoneracionContrato('M8'));

  const mitad = calcularMetaContractualProrrateada(168, 30, 15);
  assert.strictEqual(mitad.horasExoneradas, 84);
  assert.strictEqual(mitad.horasContratadasEfectivas, 84);

  const mesCompleto = calcularMetaContractualProrrateada(168, 30, 30);
  assert.strictEqual(mesCompleto.horasExoneradas, 168);
  assert.strictEqual(mesCompleto.horasContratadasEfectivas, 0);

  const cero = calcularMetaContractualProrrateada(168, 30, 0);
  assert.strictEqual(cero.horasExoneradas, 0);
  assert.strictEqual(cero.horasContratadasEfectivas, 168);
});

console.log(`\n${ok} pruebas OK${process.exitCode ? ' — HAY FALLOS' : ''}`);
