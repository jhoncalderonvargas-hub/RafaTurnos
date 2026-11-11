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

  it('consolida saldo tomando último mes anterior con saltos, COMP personalizado (7h), prorrateo VAC y cascada M+1', async () => {
    prismaMock.empleado.findMany.mockResolvedValue([{ id: 'emp-1', horasContratoMes: 150 }]);

    // Mar 2026: 19 M8 = 152h, 1 COMP (7h), 10 días VAC sobre 31 días (150 - 150/31*10 = 150 - 48.39 = 101.61h)
    const asigsMarzo: any[] = [];
    for (let d = 1; d <= 19; d++) {
      asigsMarzo.push({
        empleadoId: 'emp-1',
        fecha: new Date(Date.UTC(2026, 2, d)),
        tipoTurno: turnoM8,
      });
    }
    asigsMarzo.push({ empleadoId: 'emp-1', fecha: new Date(Date.UTC(2026, 2, 20)), tipoTurno: turnoComp7 });
    for (let d = 21; d <= 30; d++) {
      asigsMarzo.push({
        empleadoId: 'emp-1',
        fecha: new Date(Date.UTC(2026, 2, d)),
        tipoTurno: turnoVac,
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
    // Enero ya tenía +10h (Febrero omitido)
    saldosGuardados.set('2026-1', 10);

    prismaMock.bancoHorasSaldo.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.distinct) {
        return [{ anio: 2026, mes: 4 }];
      }
      // Búsqueda del último saldo estrictamente previo
      return [{ empleadoId: 'emp-1', saldoFinalAcumulado: saldosGuardados.get('2026-1') ?? 0 }];
    });

    prismaMock.cuadrante.findMany.mockResolvedValue([{ anio: 2026, mes: 4 }]);
    prismaMock.bancoHorasSaldo.upsert.mockImplementation(async ({ create }: any) => {
      saldosGuardados.set(`${create.anio}-${create.mes}`, create.saldoFinalAcumulado);
      return create;
    });

    await liquidacionService.consolidarSaldosBancoServicio('srv-urg', 2026, 3, new Map(), true);

    const calls = prismaMock.bancoHorasSaldo.upsert.mock.calls.map((c: any[]) => c[0].create);
    const marzoCall = calls.find((c: any) => c.mes === 3);
    const abrilCall = calls.find((c: any) => c.mes === 4);

    // 152 - 101.61 - 7 = 43.39h diferencia; saldoInicial=10 -> saldoFinal=53.39
    expect(marzoCall.saldoInicial).toBe(10);
    expect(marzoCall.horasAmortizadasComp).toBe(7);
    expect(marzoCall.horasContratadas).toBe(101.61);
    expect(marzoCall.diferenciaMes).toBe(43.39);
    expect(marzoCall.saldoFinalAcumulado).toBe(53.39);

    // Abril recibió la cascada (saldoInicial = 10 desde mock actualizado -> comprobemos recalculo abril llamado)
    expect(abrilCall).toBeDefined();
    expect(abrilCall.mes).toBe(4);
  });

  it('invalidarSaldosMesYCascada elimina saldo de M y recalcula periodo posterior publicado', async () => {
    prismaMock.empleado.findMany.mockResolvedValue([{ id: 'emp-1', horasContratoMes: 160 }]);
    prismaMock.bancoHorasSaldo.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cuadrante.findMany.mockResolvedValue([{ anio: 2026, mes: 12 }]);
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

  it('recalcularAnioYVispera abarca desde 31-dic del año previo hasta 31-dic del año objetivo', async () => {
    prismaMock.asignacionTurno.findMany.mockResolvedValue([]);
    await liquidacionService.recalcularAnioYVispera(2026);
    expect(prismaMock.asignacionTurno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fecha: {
            gte: new Date('2025-12-31T00:00:00.000Z'),
            lte: new Date('2026-12-31T23:59:59.000Z'),
          },
        },
      })
    );
  });

  it('BancoHorasNominaService calcula cierre con prorrateo, COMP custom y semáforos sin valores monetarios', () => {
    const bancoService = new BancoHorasNominaService();
    const res = bancoService.calcularCierreMensualColaborador({
      empleadoId: 'e1',
      documento: '101',
      nombre: 'Laura',
      anio: 2026,
      mes: 11,
      saldoInicialMesAnterior: 20,
      horasContratoMes: 150,
      diasDelMes: 30,
      diasExonerados: 5, // 25h exoneradas -> meta 125h
      horasRealesTrabajadas: 150,
      turnosCompensatoriosTomados: 1,
      horasAmortizadasComp: 7,
      hod: 120,
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
    expect(res.bancoDeHoras.horasContratadas).toBe(125);
    expect(res.bancoDeHoras.diferenciaMesActual).toBe(18); // 150 - 125 - 7
    expect(res.bancoDeHoras.nuevoSaldoAcumuladoContinuo).toBe(38); // 20 + 18
    expect(res.bancoDeHoras.estadoAlerta).toBe('CRITICO_SOBREACUMULACION');
  });
});
