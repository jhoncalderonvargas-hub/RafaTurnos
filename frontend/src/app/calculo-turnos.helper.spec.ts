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

  it('calcula meta por días hábiles, prorrateo selectivo, amortización COMP y liquidación multi-empresa', () => {
    const festivosNov = ['2026-11-02', '2026-11-16'];
    const diasNov = construirDiasMes(2026, 11, festivosNov);
    const esFest = (iso: string) => iso === '2026-11-02' || iso === '2026-11-16';
    const esDesc = crearPredicadoDescanso(esFest);

    // Nov 2026: 30 días - 5 domingos - 2 festivos oficiales = 23 días hábiles.
    // Empresa CST por defecto (42h/sem): 23 * 42 / 6 = 161h nominales.
    // Case 1: VAC en domingo (día 1) + festivo (día 2) NO descuenta meta; VAC día 3 + FAM día 4 (2 días hábiles) SÍ prorratean (-14h)
    const celdasVac: Record<number, CeldaAsignacion> = {
      1: { codigo: 'VAC' },
      2: { codigo: 'VAC' },
      3: { codigo: 'VAC' },
      4: { codigo: 'FAM' },
      5: { codigo: 'L' },
    };
    const mVac = calcularMetricasMesColaborador(
      empBase,
      celdasVac,
      diasNov,
      CATALOGO_TURNOS,
      {},
      2026,
      11,
      undefined,
      esDesc,
      esFest
    );
    expect(mVac.diasHabilesMes).toBe(23);
    expect(mVac.horasContratadasNominales).toBe(161);
    expect(mVac.diasVac).toBe(3);
    expect(mVac.diasFam).toBe(1);
    expect(mVac.diasHabilesProrrateados).toBe(2);
    expect(mVac.diasExonerados).toBe(2);
    expect(mVac.horasExoneradas).toBe(14);
    expect(mVac.horasContratadasEfectivas).toBe(147);
    expect(mVac.diferenciaMes).toBe(0);
    expect(mVac.nuevoSaldoBanco).toBe(4);

    // Case 2: Turno libre remunerado personalizado (DLR, 0h, prorrateaMetaContrato: true, no es ausencia) sí prorratea día hábil
    const catalogoConDlr = {
      ...CATALOGO_TURNOS,
      DLR: {
        ...CATALOGO_TURNOS['L'],
        codigo: 'DLR',
        nombre: 'Día Libre Remunerado',
        esAusencia: false,
        prorrateaMetaContrato: true,
      },
    };
    const mDlr = calcularMetricasMesColaborador(
      empBase,
      { 3: { codigo: 'DLR' }, 4: { codigo: 'L' }, 10: { codigo: 'M8' } },
      diasNov,
      catalogoConDlr,
      {},
      2026,
      11,
      undefined,
      esDesc,
      esFest
    );
    expect(mDlr.diasHabilesProrrateados).toBe(1);
    expect(mDlr.horasContratadasEfectivas).toBe(154);

    // Case 3: M8 + COMP (DIA_HABIL_EMPRESA -> 42/6 = 7h) + VAC día 3 -> resumirHorasPeriodo y calcularMetricas coinciden
    const celdasMix: Record<number, CeldaAsignacion> = {
      3: { codigo: 'VAC' },
      4: { codigo: 'M8' },
      5: { codigo: 'COMP' },
    };
    const resumen = resumirHorasPeriodo(celdasMix, 2026, 11, CATALOGO_TURNOS, esDesc, undefined, esFest);
    expect(resumen.horasTrabajadas).toBe(8);
    expect(resumen.horasAmortizadasComp).toBe(7);
    expect(resumen.diasHabilesProrrateados).toBe(1);

    const mMix = calcularMetricasMesColaborador(
      { ...empBase, saldoBancoOrigen: { anio: 2026, mes: 10, saldo: 10 } },
      celdasMix,
      diasNov,
      CATALOGO_TURNOS,
      { 'emp-1::2026-10': 20 },
      2026,
      11,
      25,
      esDesc,
      esFest
    );
    expect(mMix.saldoAntReal).toBe(25);
    expect(mMix.horasAmortizadasComp).toBe(7);
    expect(mMix.horasContratadasEfectivas).toBe(154);
    expect(mMix.diferenciaMes).toBe(-153); // 8 - 154 - 7
    expect(mMix.nuevoSaldoBanco).toBe(-128);

    // Case 4: Empresa ESE Decreto 1042 (44h/sem, nocturno 18:00-06:00, dom 100%)
    const empEse: EmpleadoHospital = {
      ...empBase,
      empresaContratanteId: 'emp-ese',
      empresaContratante: {
        id: 'emp-ese',
        codigo: 'ESE_PLANTA',
        nombre: 'Planta ESE',
        estadoConfiguracion: 'CONFIRMADA',
        plantillaNormativa: 'DECRETO_1042',
        horasSemanalesContrato: 44,
        diasBaseSemana: 6,
        horaInicioNocturnoMin: 1080,
        horaFinNocturnoMin: 360,
        porcentajeRecargoNocturno: 0.35,
        modoRecargoDominical: 'FIJO',
        porcentajeRecargoDominicalFijo: 1.0,
      },
    };
    const mEse = calcularMetricasMesColaborador(
      empEse,
      { 3: { codigo: 'T8' }, 5: { codigo: 'COMP' } },
      diasNov,
      CATALOGO_TURNOS,
      {},
      2026,
      11,
      0,
      esDesc,
      esFest
    );
    expect(mEse.horasSemanalesAplicadas).toBe(44);
    expect(mEse.horasContratadasNominales).toBe(168.67); // 23 * 44 / 6
    expect(mEse.hod).toBe(3); // T8 15:00-18:00 diurno bajo Decreto 1042
    expect(mEse.hon).toBe(5); // T8 18:00-23:00 nocturno desde las 18:00
    expect(mEse.horasAmortizadasComp).toBe(7.33); // 44 / 6
    expect(mEse.recargos.dominical).toBe(1.0);
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
