import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { CuadrantesController, CuadrantesReglasService } from './cuadrantes.module';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { LiquidacionService } from '../liquidacion/liquidacion.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('CuadrantesController + CuadrantesReglasService', () => {
  let app: INestApplication;
  let prismaMock: any;
  let liquidacionMock: any;

  const tiposTurnosSeed = [
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
      colorHex: '#E0F2FE',
      descuentaBancoHoras: false,
      horasAmortizacionBanco: 8,
      esNocturnoPesado: false,
      visibleEnPaleta: true,
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
      colorHex: '#FEF08A',
      descuentaBancoHoras: false,
      horasAmortizacionBanco: 8,
      esNocturnoPesado: false,
      visibleEnPaleta: true,
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
      colorHex: '#FEE2E2',
      descuentaBancoHoras: false,
      horasAmortizacionBanco: 8,
      esNocturnoPesado: true,
      visibleEnPaleta: true,
    },
    {
      id: 'tt-s',
      codigo: 'S',
      nombre: 'Saliente',
      horaInicio: '00:00',
      horaFin: '00:00',
      horasOrdinarias: 0,
      horasDiurnas: 0,
      horasNocturnas: 0,
      minutosAlmuerzo: 0,
      colorHex: '#ECFEFF',
      descuentaBancoHoras: false,
      horasAmortizacionBanco: 8,
      esNocturnoPesado: false,
      visibleEnPaleta: true,
    },
  ];

  const resetMocks = () => {
    prismaMock.cuadrante.upsert.mockResolvedValue({
      id: 'cuad-1',
      anio: 2026,
      mes: 11,
      servicioId: 'srv-urg',
      estado: 'BORRADOR',
    });
    prismaMock.cuadrante.findUnique.mockResolvedValue({
      id: 'cuad-1',
      estado: 'BORRADOR',
    });
    prismaMock.novedadAusencia.findFirst.mockResolvedValue(null);
    prismaMock.novedadAusencia.findMany.mockResolvedValue([]);
    prismaMock.asignacionTurno.findUnique.mockResolvedValue(null);
    prismaMock.asignacionTurno.findMany.mockResolvedValue([]);
    prismaMock.asignacionTurno.upsert.mockImplementation(async ({ create }: any) => ({
      id: 'asig-1',
      ...create,
    }));
    prismaMock.tipoTurno.findUnique.mockImplementation(async ({ where }: any) =>
      tiposTurnosSeed.find((t) => t.codigo === where.codigo) || null
    );
    prismaMock.tipoTurno.findMany.mockImplementation(async ({ where }: any) => {
      if (where?.codigo?.in) {
        return tiposTurnosSeed.filter((t) => where.codigo.in.includes(t.codigo));
      }
      return tiposTurnosSeed;
    });
    prismaMock.tipoTurno.upsert.mockImplementation(async ({ create }: any) => ({
      id: 'tt-blanco',
      ...create,
    }));
    prismaMock.auditoriaCambio.create.mockResolvedValue({ id: 'aud-1' });
    prismaMock.empleado.findUnique.mockResolvedValue({
      id: 'emp-1',
      servicioBaseId: 'srv-urg',
    });
    prismaMock.empleado.findMany.mockResolvedValue([]);
    prismaMock.servicio.findUnique.mockResolvedValue({
      id: 'srv-urg',
      nombre: 'Urgencias Generales',
    });
    prismaMock.festivoColombia.findMany.mockResolvedValue([]);
    prismaMock.$executeRaw.mockResolvedValue(1);
    liquidacionMock.calcularHorasPorTipo.mockResolvedValue({
      hod: 8,
      hon: 0,
      hdfd: 0,
      hdfn: 0,
      hed: 0,
      hen: 0,
    });
    liquidacionMock.recalcularAsignaciones.mockResolvedValue({ evaluadas: 0, actualizadas: 0 });
    liquidacionMock.consolidarSaldosBancoServicio.mockResolvedValue(undefined);
    liquidacionMock.invalidarSaldosMesYCascada.mockResolvedValue(undefined);
  };

  beforeEach(async () => {
    prismaMock = {
      cuadrante: { upsert: jest.fn(), findUnique: jest.fn() },
      novedadAusencia: { findFirst: jest.fn(), findMany: jest.fn() },
      asignacionTurno: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      tipoTurno: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      auditoriaCambio: { create: jest.fn() },
      empleado: { findUnique: jest.fn(), findMany: jest.fn() },
      servicio: { findUnique: jest.fn() },
      festivoColombia: { findMany: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    };
    liquidacionMock = {
      calcularHorasPorTipo: jest.fn(),
      recalcularAsignaciones: jest.fn(),
      consolidarSaldosBancoServicio: jest.fn(),
      invalidarSaldosMesYCascada: jest.fn(),
    };
    resetMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [CuadrantesController],
      providers: [
        CuadrantesReglasService,
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

  it('rechaza fechas fuera de calendario con 400 (ej. 31 de febrero o mes 13) pero permite 29-feb bisiesto', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 2,
        dia: 31,
        empleadoId: 'emp-1',
        codigo: 'M8',
      })
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 2,
        dia: 29,
        empleadoId: 'emp-1',
        codigo: 'M8',
      })
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/lote')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 2,
        celdas: [{ empleadoId: 'emp-1', dia: 30, codigo: 'M8' }],
      })
      .expect(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2024,
        mes: 2,
        dia: 29,
        empleadoId: 'emp-1',
        codigo: 'M8',
      })
      .expect(200);
  });

  it('rechaza códigos de turno desconocidos con 400 y registra BLANCO con visibleEnPaleta=false', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 5,
        empleadoId: 'emp-1',
        codigo: 'NO_EXISTE',
      })
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 5,
        empleadoId: 'emp-1',
        codigo: '',
      })
      .expect(200);

    expect(prismaMock.tipoTurno.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { codigo: 'BLANCO' },
        update: { visibleEnPaleta: false },
        create: expect.objectContaining({ codigo: 'BLANCO', visibleEnPaleta: false }),
      })
    );
  });

  it('valida reglas RN-01 post-guardia, RN-02 descanso <12h, RN-03 novedad y fecha ISO inválida', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/cuadrantes/validar-celda')
      .send({
        empleadoId: 'emp-1',
        fechaIso: '2026-02-30',
        turnoPrevioDiaAnterior: 'L',
        turnoPropuesto: 'M8',
        tieneAusenciaActiva: false,
      })
      .expect(400);

    const resRn01 = await request(app.getHttpServer())
      .post('/api/v1/cuadrantes/validar-celda')
      .send({
        empleadoId: 'emp-1',
        fechaIso: '2026-11-10',
        turnoPrevioDiaAnterior: 'G24',
        turnoPropuesto: 'M8',
        tieneAusenciaActiva: false,
      })
      .expect(201);
    expect(resRn01.body.esValido).toBe(false);
    expect(resRn01.body.alertas.some((a: string) => a.includes('RN-01'))).toBe(true);

    const resRn02 = await request(app.getHttpServer())
      .post('/api/v1/cuadrantes/validar-celda')
      .send({
        empleadoId: 'emp-1',
        fechaIso: '2026-11-10',
        turnoPrevioDiaAnterior: 'T8',
        turnoPropuesto: 'M8',
        tieneAusenciaActiva: false,
      })
      .expect(201);
    expect(resRn02.body.esValido).toBe(false);
    expect(resRn02.body.alertas.some((a: string) => a.includes('RN-02'))).toBe(true);

    prismaMock.novedadAusencia.findFirst.mockResolvedValueOnce({ tipo: 'VAC' });
    const resRn03 = await request(app.getHttpServer())
      .post('/api/v1/cuadrantes/validar-celda')
      .send({
        empleadoId: 'emp-1',
        fechaIso: '2026-11-10',
        turnoPrevioDiaAnterior: 'L',
        turnoPropuesto: 'M8',
        tieneAusenciaActiva: false,
      })
      .expect(201);
    expect(resRn03.body.esValido).toBe(false);
    expect(resRn03.body.alertas.some((a: string) => a.includes('RN-03'))).toBe(true);
  });

  it('bloquea edición en CERRADO_NOMINA y Celda Espejo de otro servicio con 409', async () => {
    prismaMock.cuadrante.upsert.mockResolvedValueOnce({
      id: 'cuad-1',
      anio: 2026,
      mes: 11,
      servicioId: 'srv-urg',
      estado: 'CERRADO_NOMINA',
    });

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 4,
        empleadoId: 'emp-1',
        codigo: 'M8',
      })
      .expect(409);

    prismaMock.asignacionTurno.findUnique.mockResolvedValueOnce({
      id: 'asig-otro',
      servicioEjecutorId: 'srv-uci',
      servicioEjecutor: { codigo: 'UCI', nombre: 'UCI Adultos' },
      tipoTurno: { codigo: 'M8' },
    });

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 4,
        empleadoId: 'emp-1',
        codigo: 'T8',
      })
      .expect(409);
  });

  it('audita con normalización a L y reconsolida servicio ejecutado y servicioBase de rotados en PUBLICADO', async () => {
    prismaMock.cuadrante.upsert.mockResolvedValueOnce({
      id: 'cuad-pub',
      anio: 2026,
      mes: 11,
      servicioId: 'srv-urg',
      estado: 'PUBLICADO',
    });
    prismaMock.asignacionTurno.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.empleado.findUnique.mockResolvedValueOnce({
      id: 'emp-rot',
      servicioBaseId: 'srv-uci',
    });
    prismaMock.cuadrante.findUnique.mockResolvedValueOnce({ estado: 'PUBLICADO' });

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 8,
        empleadoId: 'emp-rot',
        codigo: 'M8',
      })
      .expect(200);

    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoAccion: 'EDICION_TURNO',
          turnoAnterior: 'L',
          turnoNuevo: 'M8',
        }),
      })
    );
    expect(liquidacionMock.consolidarSaldosBancoServicio).toHaveBeenCalledWith(
      'srv-urg',
      2026,
      11,
      expect.any(Map),
      true,
      prismaMock
    );
    expect(liquidacionMock.consolidarSaldosBancoServicio).toHaveBeenCalledWith(
      'srv-uci',
      2026,
      11,
      expect.any(Map),
      true,
      prismaMock
    );
  });

  it('guardarLote protege novedades/Celda Espejo y audita cambios reales en ACCION_MASIVA sin LOTE->LOTE', async () => {
    prismaMock.cuadrante.upsert.mockResolvedValueOnce({
      id: 'cuad-pub',
      anio: 2026,
      mes: 11,
      servicioId: 'srv-urg',
      estado: 'PUBLICADO',
    });
    prismaMock.novedadAusencia.findMany.mockResolvedValueOnce([
      {
        empleadoId: 'emp-1',
        tipo: 'VAC',
        fechaInicio: new Date('2026-11-05T00:00:00.000Z'),
        fechaFin: new Date('2026-11-05T23:59:59.000Z'),
      },
    ]);
    prismaMock.asignacionTurno.findMany
      .mockResolvedValueOnce([
        {
          empleadoId: 'emp-2',
          fecha: new Date('2026-11-06T00:00:00.000Z'),
          tipoTurno: { codigo: 'M8' },
        },
      ])
      .mockResolvedValueOnce([]);

    const res = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/lote')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        celdas: [
          { empleadoId: 'emp-1', dia: 5, codigo: 'M8' }, // bloqueado por VAC
          { empleadoId: 'emp-2', dia: 6, codigo: 'T8' }, // bloqueado por Celda Espejo otro servicio
          { empleadoId: 'emp-1', dia: 7, codigo: 'M8' }, // válido
        ],
      })
      .expect(200);

    expect(res.body.totalGuardadas).toBe(1);
    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoAccion: 'ACCION_MASIVA',
          turnoAnterior: 'L',
          turnoNuevo: 'M8',
        }),
      })
    );
  });

  it('actualizarEstadoCuadrante consolida Banco al publicar e invalida en cascada al reabrir a BORRADOR', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .send({ servicioId: 'srv-urg', anio: 2026, mes: 11, estado: 'PUBLICADO' })
      .expect(200);
    expect(liquidacionMock.consolidarSaldosBancoServicio).toHaveBeenCalledWith(
      'srv-urg',
      2026,
      11,
      expect.any(Map),
      true,
      prismaMock
    );

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .send({ servicioId: 'srv-urg', anio: 2026, mes: 11, estado: 'BORRADOR' })
      .expect(200);
    expect(liquidacionMock.invalidarSaldosMesYCascada).toHaveBeenCalledWith(
      'srv-urg',
      2026,
      11,
      prismaMock
    );
  });

  it('bloquea el cierre CERRADO_NOMINA (409) si hay colaboradores con empresa PENDIENTE_REGLAS', async () => {
    prismaMock.empleado.findMany.mockResolvedValueOnce([
      {
        id: 'emp-pend',
        nombre: 'Nuevo Intranet',
        empresaContratante: { codigo: 'EMP_NUEVA', nombre: 'Temporal Nueva S.A.S.' },
      },
    ]);

    const res = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .send({ servicioId: 'srv-urg', anio: 2026, mes: 11, estado: 'CERRADO_NOMINA' })
      .expect(409);

    expect(res.body.message).toContain('PENDIENTE_REGLAS');
    expect(prismaMock.cuadrante.upsert).not.toHaveBeenCalled();

    // Si todas las empresas están confirmadas -> 200
    prismaMock.empleado.findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .send({ servicioId: 'srv-urg', anio: 2026, mes: 11, estado: 'CERRADO_NOMINA' })
      .expect(200);
  });
});
