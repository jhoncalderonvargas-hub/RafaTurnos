import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { CalendarioIcalController, PermutasController } from './operaciones.module';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { LiquidacionService } from '../liquidacion/liquidacion.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('PermutasController (Máquina de estados + Concurrencia) & CalendarioIcalController', () => {
  let app: INestApplication;
  let prismaMock: any;
  let liquidacionMock: any;
  let permutasStore: Map<string, any>;

  const emp1 = {
    id: 'emp-1',
    documento: '1001',
    nombre: 'Ana Solicitante',
    categoriaId: 'cat-enf',
    categoria: { id: 'cat-enf', nombre: 'Enfermero(a)' },
    servicioBaseId: 'srv-urg',
    servicioBase: { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias' },
  };
  const emp2 = {
    id: 'emp-2',
    documento: '1002',
    nombre: 'Carlos Receptor',
    categoriaId: 'cat-enf',
    categoria: { id: 'cat-enf', nombre: 'Enfermero(a)' },
    servicioBaseId: 'srv-urg',
    servicioBase: { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias' },
  };
  const empMed = {
    id: 'emp-med',
    documento: '1003',
    nombre: 'Dra. Medico',
    categoriaId: 'cat-med',
    categoria: { id: 'cat-med', nombre: 'Médico' },
    servicioBaseId: 'srv-urg',
  };

  const tiposTurno = [
    {
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
      esNocturnoPesado: false,
    },
    {
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
    },
    {
      id: 'tt-n8',
      codigo: 'N8',
      nombre: 'Noche 8h',
      horaInicio: '23:00',
      horaFin: '07:00',
      horasOrdinarias: 8,
      horasDiurnas: 1,
      horasNocturnas: 7,
      minutosAlmuerzo: 0,
      descuentaBancoHoras: false,
      esNocturnoPesado: false,
    },
    {
      id: 'tt-g24',
      codigo: 'G24',
      nombre: 'Guardia 24h',
      horaInicio: '07:00',
      horaFin: '07:00',
      horasOrdinarias: 24,
      horasDiurnas: 13,
      horasNocturnas: 11,
      minutosAlmuerzo: 0,
      descuentaBancoHoras: false,
      esNocturnoPesado: true,
    },
  ];

  let cuadranteEstadoActual = 'PUBLICADO';
  let snapshotOri = 'M8';
  let snapshotDes = 'N8';
  let vecinasActuales: any[] = [];
  let novedadesActivas: any[] = [];

  beforeEach(async () => {
    permutasStore = new Map();
    cuadranteEstadoActual = 'PUBLICADO';
    snapshotOri = 'M8';
    snapshotDes = 'N8';
    vecinasActuales = [];
    novedadesActivas = [];

    prismaMock = {
      festivoColombia: { findMany: jest.fn().mockResolvedValue([]) },
      empleado: {
        findFirst: jest.fn(async ({ where }: any) => {
          const ors: any[] = where?.OR || [];
          const keys = ors.flatMap((o) => Object.values(o));
          const pool = [emp1, emp2, empMed];
          return pool.find((e) => keys.includes(e.id) || keys.includes(e.documento)) || null;
        }),
      },
      servicio: {
        findFirst: jest.fn(async () => ({ id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias' })),
      },
      cuadrante: {
        findUnique: jest.fn(async () => ({ id: 'cuad-1', estado: cuadranteEstadoActual })),
      },
      novedadAusencia: {
        findFirst: jest.fn(async () => novedadesActivas[0] || null),
      },
      asignacionTurno: {
        findUnique: jest.fn(async ({ where }: any) => {
          const eid = where?.empleadoId_fecha?.empleadoId;
          const cod = eid === emp1.id || eid === 'emp-aux' ? snapshotOri : snapshotDes;
          return {
            id: `asig-${eid}`,
            empleadoId: eid,
            servicioEjecutorId: eid === 'emp-aux' || eid === 'emp-tec' ? 'srv-fact' : 'srv-urg',
            tipoTurno: tiposTurno.find((t) => t.codigo === cod),
          };
        }),
        findMany: jest.fn(async ({ where }: any) => {
          if (where?.cuadrante) {
            return [
              {
                id: 'asig-ical-1',
                fecha: new Date('2026-11-20T00:00:00.000Z'),
                tipoTurno: tiposTurno.find((t) => t.codigo === 'N8'),
                servicioEjecutor: { nombre: 'Urgencias' },
              },
            ];
          }
          return vecinasActuales;
        }),
        upsert: jest.fn(async ({ create, update }: any) => ({
          id: `asig-up-${create?.empleadoId || 'x'}`,
          ...create,
          ...update,
        })),
      },
      tipoTurno: {
        findMany: jest.fn(async () => tiposTurno),
        findUnique: jest.fn(async ({ where }: any) =>
          tiposTurno.find((t) => t.codigo === where.codigo) || null
        ),
      },
      solicitudPermuta: {
        create: jest.fn(async ({ data }: any) => {
          const rec = {
            id: `perm-${permutasStore.size + 1}`,
            fechaSolicitud: new Date('2026-11-10T12:00:00.000Z'),
            creadoEn: new Date('2026-11-10T12:00:00.000Z'),
            motivoRechazo: null,
            ...data,
            solicitante: emp1,
            receptor: emp2,
          };
          permutasStore.set(rec.id, rec);
          return rec;
        }),
        findUnique: jest.fn(async ({ where }: any) => permutasStore.get(where.id) || null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const rec = permutasStore.get(where.id);
          if (!rec) return { count: 0 };
          const allowed = Array.isArray(where.estado?.in)
            ? where.estado.in
            : [where.estado];
          if (!allowed.includes(rec.estado)) {
            return { count: 0 };
          }
          permutasStore.set(where.id, { ...rec, ...data });
          return { count: 1 };
        }),
      },
      tokenCalendario: {
        findFirst: jest.fn(async () => ({
          id: 'tok-1',
          empleadoId: emp1.id,
          tokenHash: 'cal_1001_abc123',
          activo: true,
        })),
        findUnique: jest.fn(async () => ({
          id: 'tok-1',
          empleadoId: emp1.id,
          tokenHash: 'cal_1001_abc123',
          activo: true,
          empleado: emp1,
        })),
        create: jest.fn(),
      },
      auditoriaCambio: {
        createMany: jest.fn(async () => ({ count: 2 })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };

    liquidacionMock = {
      calcularHorasPorTipo: jest.fn(async () => ({
        hod: 8,
        hon: 0,
        hdfd: 0,
        hdfn: 0,
        hed: 0,
        hen: 0,
      })),
      consolidarSaldosBancoServicio: jest.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PermutasController, CalendarioIcalController],
      providers: [
        FestivosColombiaService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: LiquidacionService, useValue: liquidacionMock },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const payloadBase = {
    solicitanteId: 'emp-1',
    receptorId: 'emp-2',
    servicioId: 'srv-urg',
    anio: 2026,
    mes: 11,
    diaOrigen: 20,
    turnoOrigen: 'M8',
    diaDestino: 22,
    turnoDestino: 'N8',
  };

  it('rechaza auto-permuta (400), incompatibilidad de categoría (409), BORRADOR/CERRADO_NOMINA (409), VAC/INC (409) y desajuste DB (409)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({ ...payloadBase, receptorId: 'emp-1' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({ ...payloadBase, receptorId: 'emp-med' })
      .expect(409);

    cuadranteEstadoActual = 'BORRADOR';
    await request(app.getHttpServer()).post('/api/v1/permutas').send(payloadBase).expect(409);

    cuadranteEstadoActual = 'CERRADO_NOMINA';
    await request(app.getHttpServer()).post('/api/v1/permutas').send(payloadBase).expect(409);
    cuadranteEstadoActual = 'PUBLICADO';

    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({ ...payloadBase, turnoOrigen: 'VAC' })
      .expect(409);

    snapshotOri = 'T8'; // diferente al 'M8' solicitado
    await request(app.getHttpServer()).post('/api/v1/permutas').send(payloadBase).expect(409);
    snapshotOri = 'M8';

    // Vecino con G24 el día previo al origen -> RN-01 bloqueante al intentar recibir N8
    vecinasActuales = [
      {
        empleadoId: emp1.id,
        fecha: new Date('2026-11-19T00:00:00.000Z'),
        tipoTurno: tiposTurno.find((t) => t.codigo === 'G24'),
      },
    ];
    await request(app.getHttpServer()).post('/api/v1/permutas').send(payloadBase).expect(409);
  });

  it('ejecuta máquina de estados estricta y resiste race condition en doble aprobarPermuta simultáneo', async () => {
    const creada = await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send(payloadBase)
      .expect(201);
    expect(creada.body.estado).toBe('PENDIENTE_PAR');
    const permId = creada.body.id;

    // Aprobación prematura antes de aceptar par -> 409
    await request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/aprobar`).expect(409);

    // Par acepta -> PENDIENTE_SUPERVISOR
    const aceptada = await request(app.getHttpServer())
      .patch(`/api/v1/permutas/${permId}/aceptar-par`)
      .expect(200);
    expect(aceptada.body.estado).toBe('PENDIENTE_SUPERVISOR');

    // Segundo aceptar-par o rechazar-par sobre PENDIENTE_SUPERVISOR -> 409
    await request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/aceptar-par`).expect(409);
    await request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/rechazar-par`).expect(409);

    // Concurrencia simultánea en aprobarPermuta: exactamente 1 gana (200) y 1 falla (409)
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/aprobar`),
      request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/aprobar`),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const ganadora = r1.status === 200 ? r1.body : r2.body;
    expect(ganadora.estado).toBe('APROBADA');
    expect(ganadora.cambiosAplicados).toHaveLength(2);
    // Verificar preservación de codigoPrevisto al realizar el swap en update
    const upsertCalls = prismaMock.asignacionTurno.upsert.mock.calls;
    expect(upsertCalls[0][0].update.codigoPrevisto).toBeUndefined();
    expect(prismaMock.auditoriaCambio.createMany).toHaveBeenCalledTimes(1);
    expect(liquidacionMock.consolidarSaldosBancoServicio).toHaveBeenCalledWith(
      'srv-urg',
      2026,
      11,
      expect.any(Map),
      true,
      prismaMock
    );

    // Rechazar permuta ya APROBADA -> 409
    await request(app.getHttpServer()).patch(`/api/v1/permutas/${permId}/rechazar`).expect(409);
  });

  it('respeta x-forwarded-proto y x-forwarded-host en /calendario/mi-enlace y genera feed RFC 5545', async () => {
    const resEnlace = await request(app.getHttpServer())
      .get('/api/v1/calendario/mi-enlace?empleadoId=emp-1')
      .set('x-forwarded-proto', 'https, http')
      .set('x-forwarded-host', 'turnos.hospital.gov.co, proxy.local')
      .expect(200);

    expect(resEnlace.body.httpUrl).toBe(
      'https://turnos.hospital.gov.co/api/v1/calendario/feed/cal_1001_abc123.ics'
    );
    expect(resEnlace.body.webcalUrl).toBe(
      'webcal://turnos.hospital.gov.co/api/v1/calendario/feed/cal_1001_abc123.ics'
    );

    const resIcs = await request(app.getHttpServer())
      .get('/api/v1/calendario/feed/cal_1001_abc123.ics')
      .expect(200);
    expect(resIcs.headers['content-type']).toContain('text/calendar');
    expect(resIcs.text).toContain('BEGIN:VCALENDAR');
    expect(resIcs.text).toContain('VERSION:2.0');
    expect(resIcs.text).toContain('X-WR-TIMEZONE:America/Bogota');
    expect(resIcs.text).toContain('DTSTART;TZID=America/Bogota:20261120T230000');
    expect(resIcs.text).toContain('DTEND;TZID=America/Bogota:20261121T070000');
    expect(resIcs.text).toContain('END:VCALENDAR');
  });

  it('permite permuta multi-cargo cuando permitePermutaEntreCargos=true, bloquea si false, y respeta bloqueaPermutas en TipoTurno', async () => {
    const empAux = {
      id: 'emp-aux',
      documento: '2001',
      nombre: 'Auxiliar Facturación',
      categoriaId: 'cat-aux',
      categoria: { id: 'cat-aux', nombre: 'Auxiliar de Facturación' },
      servicioBaseId: 'srv-fact',
    };
    const empTec = {
      id: 'emp-tec',
      documento: '2002',
      nombre: 'Técnico Facturación',
      categoriaId: 'cat-tec',
      categoria: { id: 'cat-tec', nombre: 'Técnico Administrativo' },
      servicioBaseId: 'srv-fact',
    };

    prismaMock.empleado.findFirst.mockImplementation(async ({ where }: any) => {
      const keys = (where?.OR || []).flatMap((o: any) => Object.values(o));
      const pool = [emp1, emp2, empMed, empAux, empTec];
      return pool.find((e) => keys.includes(e.id) || keys.includes(e.documento)) || null;
    });

    // Caso 1: servicio multi-cargo habilitado -> permite intercambio entre cargos equivalentes
    prismaMock.servicio.findFirst.mockResolvedValue({
      id: 'srv-fact',
      codigo: 'FACT-URG',
      nombre: 'Facturación Urgencias',
      permitePermutaEntreCargos: true,
      cargosPermitidos: [{ categoriaId: 'cat-aux' }, { categoriaId: 'cat-tec' }],
    });

    const simOk = await request(app.getHttpServer())
      .post('/api/v1/permutas/simular')
      .send({
        solicitanteId: 'emp-aux',
        solicitanteCategoria: 'Auxiliar de Facturación',
        receptorId: 'emp-tec',
        receptorCategoria: 'Técnico Administrativo',
        servicioId: 'srv-fact',
        anio: 2026,
        mes: 11,
        diaOrigen: 20,
        turnoOrigen: 'M8',
        diaDestino: 22,
        turnoDestino: 'N8',
      })
      .expect(201);
    expect(simOk.body.permitida).toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({
        solicitanteId: 'emp-aux',
        receptorId: 'emp-tec',
        servicioId: 'srv-fact',
        anio: 2026,
        mes: 11,
        diaOrigen: 20,
        turnoOrigen: 'M8',
        diaDestino: 22,
        turnoDestino: 'N8',
      })
      .expect(201);

    // Caso 2: mismo servicio pero permitePermutaEntreCargos = false -> rechaza 409
    prismaMock.servicio.findFirst.mockResolvedValueOnce({
      id: 'srv-fact',
      codigo: 'FACT-URG',
      nombre: 'Facturación Urgencias',
      permitePermutaEntreCargos: false,
      cargosPermitidos: [{ categoriaId: 'cat-aux' }, { categoriaId: 'cat-tec' }],
    });
    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({
        solicitanteId: 'emp-aux',
        receptorId: 'emp-tec',
        servicioId: 'srv-fact',
        anio: 2026,
        mes: 11,
        diaOrigen: 20,
        turnoOrigen: 'M8',
        diaDestino: 22,
        turnoDestino: 'N8',
      })
      .expect(409);

    // Caso 3: Turno custom con bloqueaPermutas=true rechaza intercambio (409)
    prismaMock.tipoTurno.findMany.mockResolvedValueOnce([
      ...tiposTurno,
      { codigo: 'CAP_BLQ', nombre: 'Capacitación Obligatoria', horasOrdinarias: 8, bloqueaPermutas: true, esAusencia: false },
    ]);
    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .send({
        ...payloadBase,
        turnoOrigen: 'CAP_BLQ',
      })
      .expect(409);
  });
});
