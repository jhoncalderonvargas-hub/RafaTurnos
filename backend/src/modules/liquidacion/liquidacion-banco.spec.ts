import { BancoHorasNominaService } from '../banco-horas/banco-horas.module';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { LiquidacionService } from './liquidacion.module';

describe('LiquidacionService + BancoHorasNominaService (Cascada, Prorrateo, COMP, Rotación)', () => {
  const turnoM8 = {
    id: 'tt-m8',
    codigo: 'M8',
    nombre: 'Mañana 8h',
    horaInicio: '07:00',
    horaFin: '15:00',
    horasOrdinarias: 8,
    horasDiurnas: 8,
    horasNocturnas: 0,
    minutosAlmuerzo: 0,
    descuentaBancoHoras: false,
    horasAmortizacionBanco: 8,
    esNocturnoPesado: false,
  };
  const turnoComp7 = {
    id: 'tt-comp',
    codigo: 'COMP',
    nombre: 'Compensatorio 7h',
    horaInicio: '00:00',
    horaFin: '00:00',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    minutosAlmuerzo: 0,
    descuentaBancoHoras: true,
    horasAmortizacionBanco: 7,
    esNocturnoPesado: false,
  };
  const turnoVac = {
    id: 'tt-vac',
    codigo: 'VAC',
    nombre: 'Vacaciones',
    horaInicio: '00:00',
    horaFin: '00:00',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    minutosAlmuerzo: 0,
    descuentaBancoHoras: false,
    horasAmortizacionBanco: 8,
    esNocturnoPesado: false,
  };

  let prismaMock: any;
  let festivosService: FestivosColombiaService;
  let liquidacionService: LiquidacionService;

  beforeEach(() => {
    prismaMock = {
      festivoColombia: { findMany: jest.fn().mockResolvedValue([]) },
      empleado: { findMany: jest.fn() },
      asignacionTurno: { findMany: jest.fn(), update: jest.fn() },
      bancoHorasSaldo: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      cuadrante: { findMany: jest.fn() },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    festivosService = new FestivosColombiaService(prismaMock);
    liquidacionService = new LiquidacionService(prismaMock, festivosService);
  });

  it('consolida saldo tomando último mes anterior con saltos, COMP, prorrateo selectivo por días hábiles y cascada M+1 (sin prorratear dom/fest)', async () => {
    prismaMock.empleado.findMany.mockResolvedValue([
      {
        id: 'emp-1',
        horasContratoMes: 168,
        horasSemanalesLey: 42,
        empresaContratante: {
          codigo: 'TEMP_SALUD',
          nombre: 'Temp Salud S.A.S.',
          plantillaNormativa: 'CST_LEY_2466',
          horasSemanalesContrato: 42,
          diasBaseSemana: 6,
          horaInicioNocturnoMin: 19 * 60,
          horaFinNocturnoMin: 6 * 60,
          porcentajeRecargoNocturno: 0.35,
          modoRecargoDominical: 'LEY_2466',
          aplicaTopeHorasExtrasSemanal: true,
          topeHorasExtrasSemanal: 12,
          usaBancoHoras: true,
        },
      },
    ]);

    // Mar 2026: 31 días, 5 domingos (1,8,15,22,29) y 1 festivo (lun 23 San José) => 25 días hábiles (175h nominales a 7h/día)
    // 19 M8 = 152h, 1 COMP (7h), VAC días 21..30 (10 días calendario: 2 dom + 1 fest = 7 días hábiles prorrateados = 49h exoneradas -> 126h meta)
    const asigsMarzo: any[] = [];
    for (let d = 1; d <= 19; d++) {
      asigsMarzo.push({
        empleadoId: 'emp-1',
        fecha: new Date(Date.UTC(2026, 2, d)),
        tipoTurno: turnoM8,
      });
    }
    asigsMarzo.push({
      empleadoId: 'emp-1',
      fecha: new Date(Date.UTC(2026, 2, 20)),
      tipoTurno: { ...turnoComp7, modoAmortizacionBanco: 'HORAS_FIJAS' },
    });
    for (let d = 21; d <= 30; d++) {
      asigsMarzo.push({
        empleadoId: 'emp-1',
        fecha: new Date(Date.UTC(2026, 2, d)),
        tipoTurno: { ...turnoVac, prorrateaMetaContrato: true, esAusencia: true },
      });
    }

    // Abril 2026 publicado: 1 M8 (8h), sin vacaciones
    const asigsAbril = [
      { empleadoId: 'emp-1', fecha: new Date(Date.UTC(2026, 3, 2)), tipoTurno: turnoM8 },
    ];

    prismaMock.asignacionTurno.findMany.mockImplementation(async ({ where }: any) => {
      const mes0 = new Date(where.fecha.gte).getUTCMonth();
      return mes0 === 2 ? asigsMarzo : asigsAbril;
    });

    const saldosGuardados = new Map<string, number>();
    saldosGuardados.set('2026-1', 10);

    prismaMock.bancoHorasSaldo.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.distinct) {
        return [{ anio: 2026, mes: 4 }];
      }
      return [{ empleadoId: 'emp-1', saldoFinalAcumulado: saldosGuardados.get('2026-1') ?? 0 }];
    });

    prismaMock.cuadrante.findMany.mockResolvedValue([{ anio: 2026, mes: 4, estado: 'PUBLICADO' }]);
    prismaMock.bancoHorasSaldo.upsert.mockImplementation(async ({ create }: any) => {
      saldosGuardados.set(`${create.anio}-${create.mes}`, create.saldoFinalAcumulado);
      return create;
    });

    await liquidacionService.consolidarSaldosBancoServicio('srv-urg', 2026, 3, new Map(), true);

    const calls = prismaMock.bancoHorasSaldo.upsert.mock.calls.map((c: any[]) => c[0].create);
    const marzoCall = calls.find((c: any) => c.mes === 3);
    const abrilCall = calls.find((c: any) => c.mes === 4);

    // 175h nominales - 49h exoneradas = 126h efectivas; 152 - 126 - 7 = +19h; saldoInicial 10 -> saldoFinal 29h
    expect(marzoCall.saldoInicial).toBe(10);
    expect(marzoCall.diasHabilesMes).toBe(25);
    expect(marzoCall.diasHabilesProrrateados).toBe(7);
    expect(marzoCall.horasContratadasNominales).toBe(175);
    expect(marzoCall.horasExoneradas).toBe(49);
    expect(marzoCall.horasContratadas).toBe(126);
    expect(marzoCall.horasAmortizadasComp).toBe(7);
    expect(marzoCall.diferenciaMes).toBe(19);
    expect(marzoCall.saldoFinalAcumulado).toBe(29);
    expect(marzoCall.empresaCodigoSnapshot).toBe('TEMP_SALUD');

    expect(abrilCall).toBeDefined();
    expect(abrilCall.mes).toBe(4);
  });

  it('invalidarSaldosMesYCascada elimina saldo de M, recalcula PUBLICADO posterior y protege CERRADO_NOMINA', async () => {
    prismaMock.empleado.findMany.mockResolvedValue([{ id: 'emp-1', horasContratoMes: 168, horasSemanalesLey: 42 }]);
    prismaMock.bancoHorasSaldo.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cuadrante.findMany.mockResolvedValue([
      { anio: 2026, mes: 12, estado: 'PUBLICADO' },
    ]);
    prismaMock.bancoHorasSaldo.findMany
      .mockResolvedValueOnce([]) // distinct posts
      .mockResolvedValueOnce([]); // saldo previo en cascada
    prismaMock.asignacionTurno.findMany.mockResolvedValue([]);
    prismaMock.bancoHorasSaldo.upsert.mockImplementation(async ({ create }: any) => create);

    await liquidacionService.invalidarSaldosMesYCascada('srv-urg', 2026, 11);

    expect(prismaMock.bancoHorasSaldo.deleteMany).toHaveBeenCalledWith({
      where: { empleadoId: { in: ['emp-1'] }, anio: 2026, mes: 11 },
    });
    expect(prismaMock.bancoHorasSaldo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ anio: 2026, mes: 12 }),
      })
    );

    // Ahora si Diciembre está CERRADO_NOMINA, NO debe tocarse ni aunque existan saldos previos
    prismaMock.bancoHorasSaldo.upsert.mockClear();
    prismaMock.cuadrante.findMany.mockResolvedValue([
      { anio: 2026, mes: 12, estado: 'CERRADO_NOMINA' },
    ]);
    prismaMock.bancoHorasSaldo.findMany.mockResolvedValueOnce([{ anio: 2026, mes: 12 }]);

    await liquidacionService.invalidarSaldosMesYCascada('srv-urg', 2026, 11);
    expect(prismaMock.bancoHorasSaldo.upsert).not.toHaveBeenCalled();
  });

  it('liquidarPeriodoConsulta incluye rotado externo filtrando solo turnos ejecutados en el servicio y calcula compensatorio por 3+ domingos', async () => {
    prismaMock.empleado.findMany.mockResolvedValue([
      {
        id: 'emp-propio',
        documento: '10',
        nombre: 'Propio',
        horasContratoMes: 168,
        servicioBaseId: 'srv-urg',
        servicioBase: { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias' },
        categoria: { nombre: 'Enfermero(a)' },
      },
      {
        id: 'emp-rot',
        documento: '20',
        nombre: 'Rotado UCI',
        horasContratoMes: 168,
        servicioBaseId: 'srv-uci',
        servicioBase: { id: 'srv-uci', codigo: 'UCI', nombre: 'UCI' },
        categoria: { nombre: 'Enfermero(a)' },
      },
    ]);

    // Nov 2026 tiene domingos: 1, 8, 15, 22, 29
    prismaMock.asignacionTurno.findMany.mockResolvedValue([
      // Emp propio trabaja 3 domingos (1, 8, 15) + 1 COMP
      { empleadoId: 'emp-propio', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-01T00:00:00.000Z'), hod: 0, hon: 0, hdfd: 8, hdfn: 0, tipoTurno: turnoM8 },
      { empleadoId: 'emp-propio', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-08T00:00:00.000Z'), hod: 0, hon: 0, hdfd: 8, hdfn: 0, tipoTurno: turnoM8 },
      { empleadoId: 'emp-propio', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-15T00:00:00.000Z'), hod: 0, hon: 0, hdfd: 8, hdfn: 0, tipoTurno: turnoM8 },
      { empleadoId: 'emp-propio', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-16T00:00:00.000Z'), hod: 0, hon: 0, hdfd: 0, hdfn: 0, tipoTurno: turnoComp7 },
      // Emp rotado: 1 turno en UCI (no cuenta aquí), 1 turno ejecutado en URG (sí cuenta)
      { empleadoId: 'emp-rot', servicioEjecutorId: 'srv-uci', fecha: new Date('2026-11-10T00:00:00.000Z'), hod: 8, hon: 0, hdfd: 0, hdfn: 0, tipoTurno: turnoM8 },
      { empleadoId: 'emp-rot', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-11T00:00:00.000Z'), hod: 8, hon: 0, hdfd: 0, hdfn: 0, tipoTurno: turnoM8 },
    ]);

    const res = await liquidacionService.liquidarPeriodoConsulta(2026, 11, 'srv-urg');
    expect(res.totalColaboradores).toBe(2);

    const propio = res.colaboradores.find((c) => c.empleadoId === 'emp-propio')!;
    expect(propio.esRotacionExterna).toBe(false);
    expect(propio.domingosLaborados).toBe(3);
    expect(propio.causaCompensatorioDominical).toBe(true);
    expect(propio.diasCompensatoriosCausados).toBe(3);
    expect(propio.horasAmortizadasComp).toBe(7);

    const rotado = res.colaboradores.find((c) => c.empleadoId === 'emp-rot')!;
    expect(rotado.esRotacionExterna).toBe(true);
    expect(rotado.horasTrabajadas).toBe(8); // Solo el día 11 en srv-urg
  });

  it('recalcularAnioYVispera abarca desde 31-dic del año previo hasta 31-dic del año objetivo y excluye CERRADO_NOMINA', async () => {
    prismaMock.asignacionTurno.findMany.mockResolvedValue([]);
    prismaMock.cuadrante.findMany.mockResolvedValue([]);
    await liquidacionService.recalcularAnioYVispera(2026);
    expect(prismaMock.asignacionTurno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fecha: {
            gte: new Date('2025-12-31T00:00:00.000Z'),
            lte: new Date('2026-12-31T23:59:59.000Z'),
          },
          cuadrante: { estado: { not: 'CERRADO_NOMINA' } },
        },
      })
    );
  });

  it('diferencia reglas por EmpresaContratante: ESE_PLANTA (44h, 18:00, dom 100%, COMP=7.33h) vs TEMP_SALUD (42h, 19:00, dom 90%, COMP=7h) vs COOP (sin banco)', async () => {
    const empresaEse = {
      codigo: 'ESE_PLANTA',
      nombre: 'ESE Hospital Planta',
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
    const empresaTemp = {
      codigo: 'TEMP_SALUD',
      nombre: 'Temp Salud S.A.S.',
      plantillaNormativa: 'CST_LEY_2466',
      horasSemanalesContrato: 42,
      diasBaseSemana: 6,
      horaInicioNocturnoMin: 19 * 60,
      horaFinNocturnoMin: 6 * 60,
      porcentajeRecargoNocturno: 0.35,
      modoRecargoDominical: 'LEY_2466',
      aplicaTopeHorasExtrasSemanal: true,
      topeHorasExtrasSemanal: 12,
      usaBancoHoras: true,
    };
    const empresaCoop = {
      ...empresaTemp,
      codigo: 'COOP_SERV',
      nombre: 'Cooperativa Servicios',
      plantillaNormativa: 'PERSONALIZADA',
      usaBancoHoras: false,
    };

    const turnoT8 = {
      id: 'tt-t8',
      codigo: 'T8',
      nombre: 'Tarde 8h',
      horaInicio: '15:00',
      horaFin: '23:00',
      horasOrdinarias: 8,
      horasDiurnas: 4,
      horasNocturnas: 4,
      minutosAlmuerzo: 0,
      descuentaBancoHoras: false,
      esNocturnoPesado: false,
    };
    const compDinamico = {
      ...turnoComp7,
      modoAmortizacionBanco: 'DIA_HABIL_EMPRESA',
      horasAmortizacionBanco: null,
    };

    // Comparar liquidación nocturna de T8 (15:00-23:00) el martes 2026-11-10 según empresa
    const horasEse = await liquidacionService.calcularHorasPorTipo(
      turnoT8,
      new Date('2026-11-10T00:00:00.000Z'),
      liquidacionService.resolverReglasEmpleado({ empresaContratante: empresaEse } as any)
    );
    const horasTemp = await liquidacionService.calcularHorasPorTipo(
      turnoT8,
      new Date('2026-11-10T00:00:00.000Z'),
      liquidacionService.resolverReglasEmpleado({ empresaContratante: empresaTemp } as any)
    );
    expect(horasEse).toEqual({ hod: 3, hon: 5, hdfd: 0, hdfn: 0, hed: 0, hen: 0 });
    expect(horasTemp).toEqual({ hod: 4, hon: 4, hdfd: 0, hdfn: 0, hed: 0, hen: 0 });

    prismaMock.empleado.findMany.mockResolvedValue([
      { id: 'e-ese', documento: '1', nombre: 'Planta ESE', horasSemanalesLey: 44, servicioBaseId: 'srv-urg', empresaContratante: empresaEse },
      { id: 'e-temp', documento: '2', nombre: 'Temp CST', horasSemanalesLey: 42, servicioBaseId: 'srv-urg', empresaContratante: empresaTemp },
      { id: 'e-coop', documento: '3', nombre: 'Coop Sin Banco', horasSemanalesLey: 42, servicioBaseId: 'srv-urg', empresaContratante: empresaCoop },
    ]);

    prismaMock.asignacionTurno.findMany.mockResolvedValue([
      { empleadoId: 'e-ese', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-10T00:00:00.000Z'), tipoTurno: turnoT8 },
      { empleadoId: 'e-ese', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-11T00:00:00.000Z'), tipoTurno: compDinamico },
      { empleadoId: 'e-temp', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-10T00:00:00.000Z'), tipoTurno: turnoT8 },
      { empleadoId: 'e-temp', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-11T00:00:00.000Z'), tipoTurno: compDinamico },
      { empleadoId: 'e-coop', servicioEjecutorId: 'srv-urg', fecha: new Date('2026-11-10T00:00:00.000Z'), tipoTurno: turnoT8 },
    ]);
    prismaMock.bancoHorasSaldo.findMany.mockResolvedValue([]);
    prismaMock.cuadrante.findMany.mockResolvedValue([]);
    const saldos: any[] = [];
    prismaMock.bancoHorasSaldo.upsert.mockImplementation(async ({ create }: any) => {
      saldos.push(create);
      return create;
    });

    await liquidacionService.consolidarSaldosBancoServicio('srv-urg', 2026, 11, new Map(), false);

    const sEse = saldos.find((s) => s.empleadoId === 'e-ese')!;
    const sTemp = saldos.find((s) => s.empleadoId === 'e-temp')!;
    const sCoop = saldos.find((s) => s.empleadoId === 'e-coop')!;

    // Nov 2026 = 23 días hábiles (30 - 5 dom - Nov 2 - Nov 16)
    expect(sEse.diasHabilesMes).toBe(23);
    expect(sEse.horasContratadas).toBe(168.67);
    expect(sEse.horasAmortizadasComp).toBe(7.33);
    expect(sTemp.horasContratadas).toBe(161);
    expect(sTemp.horasAmortizadasComp).toBe(7);
    expect(sCoop.diferenciaMes).toBe(0);

    // liquidarPeriodoConsulta expone recargos diferenciados por empleado (ESE 100% dom vs CST 90%)
    const cons = await liquidacionService.liquidarPeriodoConsulta(2026, 11, 'srv-urg');
    const cEse = cons.colaboradores.find((c) => c.empleadoId === 'e-ese')!;
    const cTemp = cons.colaboradores.find((c) => c.empleadoId === 'e-temp')!;
    expect(cEse.normativaColaborador.recargos.dominical).toBe(1);
    expect(cTemp.normativaColaborador.recargos.dominical).toBe(0.9);
  });

  it('BancoHorasNominaService calcula cierre con días hábiles, prorrateo selectivo, COMP custom y semáforos sin valores monetarios', () => {
    const bancoService = new BancoHorasNominaService();
    const res = bancoService.calcularCierreMensualColaborador({
      empleadoId: 'e1',
      documento: '101',
      nombre: 'Laura',
      anio: 2026,
      mes: 11,
      saldoInicialMesAnterior: 20,
      horasContratoMes: 161,
      diasHabilesMes: 23,
      diasHabilesProrrateados: 3, // 20 * 7 = 140h
      horasSemanalesContrato: 42,
      diasBaseSemana: 6,
      horasRealesTrabajadas: 165,
      turnosCompensatoriosTomados: 1,
      horasAmortizadasComp: 7,
      hod: 135,
      hon: 30,
      hdfd: 0,
      hdfn: 0,
      domingosHabituales: 4,
    });

    expect(res.conceptosNominaMesCorriente.recargos).toEqual({
      nocturno: 0.35,
      dominical: 0.9,
      nocturnoDominical: 1.25,
    });
    expect(res.conceptosNominaMesCorriente.diasCompensatoriosCausados).toBe(4);
    expect(res.bancoDeHoras.diasHabilesMes).toBe(23);
    expect(res.bancoDeHoras.diasHabilesProrrateados).toBe(3);
    expect(res.bancoDeHoras.horasContratadas).toBe(140);
    expect(res.bancoDeHoras.diferenciaMesActual).toBe(18); // 165 - 140 - 7
    expect(res.bancoDeHoras.nuevoSaldoAcumuladoContinuo).toBe(38); // 20 + 18
    expect(res.bancoDeHoras.estadoAlerta).toBe('CRITICO_SOBREACUMULACION');
  });
});
