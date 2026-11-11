import {
  calcularMetricasMesColaborador,
  horasLiquidadasCelda,
  resumirHorasPeriodo,
} from './calculo-turnos.helper';
import { CATALOGO_TURNOS, CeldaAsignacion, DiaColumna, EmpleadoHospital } from './models';
import { crearPredicadoDescanso } from './shared/liquidacion-horas';

function construirDiasMes(anio: number, mes: number, festivos: string[] = []): DiaColumna[] {
  const total = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const setFest = new Set(festivos);
  const res: DiaColumna[] = [];
  for (let d = 1; d <= total; d++) {
    const dt = new Date(Date.UTC(anio, mes - 1, d));
    const dow = dt.getUTCDay();
    const fechaIso = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    res.push({
      dia: d,
      fechaIso,
      letraDia: letras[dow],
      esSabado: dow === 6,
      esDomingo: dow === 0,
      festivo: setFest.has(fechaIso)
        ? { fecha: fechaIso, nombre: 'Festivo Test', esOficialLey: true }
        : undefined,
    });
  }
  return res;
}

describe('calculo-turnos.helper', () => {
  const empBase: EmpleadoHospital = {
    id: 'emp-1',
    documento: '1001',
    nombre: 'Laura Enfermera',
    categoria: 'Enfermero(a) Jefe',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 180,
    saldoBancoAnterior: 4,
    ultimoTurnoMesPrevio: 'L',
  };

  it('calcula HOD/HON/HDFD/HDFN con corte de medianoche y habitualidad dominical (>=3 domingos)', () => {
    const diasNov = construirDiasMes(2026, 11, ['2026-11-02', '2026-11-16']);
    const esDesc = crearPredicadoDescanso((iso) => iso === '2026-11-02' || iso === '2026-11-16');

    // Nov 2026 Sundays: 1, 8, 15, 22, 29.
    // Day 7 (Saturday) N12 crosses midnight into Sunday 8 -> counts Sunday 8 (5 HON + 6 HDFN + 1 HDFD)
    // Day 15 (Sunday) D12 -> counts Sunday 15 (12 HDFD)
    // Day 22 (Sunday) D12 -> counts Sunday 22 (12 HDFD)
    // Day 2 (Monday festivo) D12 -> 12 HDFD (festivo hábil, NOT a Sunday!)
    const celdas: Record<number, CeldaAsignacion> = {
      2: { codigo: 'D12' },
      3: { codigo: 'M8' },
      7: { codigo: 'N12' },
      15: { codigo: 'D12' },
      22: { codigo: 'D12' },
    };

    const m = calcularMetricasMesColaborador(
      empBase,
      celdas,
      diasNov,
      CATALOGO_TURNOS,
      {},
      2026,
      11,
      undefined,
      esDesc
    );

    expect(m.hod).toBe(8);
    expect(m.hon).toBe(5);
    expect(m.hdfd).toBe(37); // 12 + 1 + 12 + 12
    expect(m.hdfn).toBe(6);
    expect(m.horasTrabajadas).toBe(56);
    expect(m.conteoDomingos).toBe(3); // 8, 15, 22
    expect(m.conteoDomFest).toBe(4); // 2, 8, 15, 22
    expect(m.causaCompensatorioDominical).toBeTrue();
    expect(horasLiquidadasCelda(CATALOGO_TURNOS['M8'], '2026-11-03', esDesc)).toBe(8);
  });

  it('prorratea meta contractual con VAC/FAM, amortiza COMP y mantiene diferenciaMes=0 si solo hay ausencias', () => {
    const diasNov = construirDiasMes(2026, 11);
    const esDesc = crearPredicadoDescanso(() => false);

    // Case 1: Only VAC + FAM (no operative hours, no COMP) -> diferenciaMes = 0, no debt!
    const celdasVac: Record<number, CeldaAsignacion> = {
      1: { codigo: 'VAC' },
      2: { codigo: 'FAM' },
    };
    const mVac = calcularMetricasMesColaborador(
      { ...empBase, horasContratoMes: 150 },
      celdasVac,
      diasNov,
      CATALOGO_TURNOS,
      {},
      2026,
      11,
      undefined,
      esDesc
    );
    expect(mVac.diasVac).toBe(1);
    expect(mVac.diasFam).toBe(1);
    expect(mVac.diasExonerados).toBe(2);
    expect(mVac.horasExoneradas).toBe(10); // 2 * (150/30)
    expect(mVac.horasContratadasEfectivas).toBe(140);
    expect(mVac.diferenciaMes).toBe(0);
    expect(mVac.nuevoSaldoBanco).toBe(4);

    // Case 2: M8 + COMP (amortizes 8h) + VAC -> summarizes identically via resumirHorasPeriodo
    const celdasMix: Record<number, CeldaAsignacion> = {
      1: { codigo: 'VAC' },
      3: { codigo: 'M8' },
      4: { codigo: 'COMP' },
    };
    const resumen = resumirHorasPeriodo(celdasMix, 2026, 11, CATALOGO_TURNOS, esDesc);
    expect(resumen.horasTrabajadas).toBe(8);
    expect(resumen.horasAmortizadasComp).toBe(8);
    expect(resumen.diasExonerados).toBe(1);

    const mMix = calcularMetricasMesColaborador(
      { ...empBase, horasContratoMes: 150, saldoBancoOrigen: { anio: 2026, mes: 10, saldo: 10 } },
      celdasMix,
      diasNov,
      CATALOGO_TURNOS,
      { 'emp-1::2026-10': 20 },
      2026,
      11,
      25, // explicit saldoAnteriorCalculado wins
      esDesc
    );
    expect(mMix.saldoAntReal).toBe(25);
    expect(mMix.horasAmortizadasComp).toBe(8);
    expect(mMix.horasContratadasEfectivas).toBe(145);
    expect(mMix.diferenciaMes).toBe(-145); // 8 - 145 - 8
    expect(mMix.nuevoSaldoBanco).toBe(-120);
  });

  it('usa prioridad de saldos consolidados y origen cuando no se pasa saldoAnteriorCalculado', () => {
    const diasNov = construirDiasMes(2026, 11);
    const esDesc = crearPredicadoDescanso(() => false);
    const empConOrigen: EmpleadoHospital = {
      ...empBase,
      saldoBancoAnterior: 99,
      saldoBancoOrigen: { anio: 2026, mes: 10, saldo: 12 },
    };

    const desdeConsolidado = calcularMetricasMesColaborador(
      empConOrigen,
      {},
      diasNov,
      CATALOGO_TURNOS,
      { 'emp-1::2026-10': 18 },
      2026,
      11,
      undefined,
      esDesc
    );
    expect(desdeConsolidado.saldoAntReal).toBe(18);

    const desdeOrigen = calcularMetricasMesColaborador(
      empConOrigen,
      {},
      diasNov,
      CATALOGO_TURNOS,
      {},
      2026,
      11,
      undefined,
      esDesc
    );
    expect(desdeOrigen.saldoAntReal).toBe(12);
  });
});
