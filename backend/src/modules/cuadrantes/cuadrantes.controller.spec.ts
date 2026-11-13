import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { CuadrantesController, CuadrantesReglasService } from './cuadrantes.module';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { LiquidacionService } from '../liquidacion/liquidacion.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('CuadrantesController + CuadrantesReglasService', () => {
  let app: INestApplication;
  let controller: CuadrantesController;
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
    prismaMock.cuadrante.findMany.mockResolvedValue([]);
    prismaMock.bancoHorasSaldo.findMany.mockResolvedValue([]);
    prismaMock.asignacionTurno.findUnique.mockResolvedValue(null);
    prismaMock.asignacionTurno.findMany.mockResolvedValue([]);
    prismaMock.asignacionTurno.update.mockImplementation(async ({ where, data }: any) => ({
      id: where.id || 'asig-upd-1',
      ...data,
    }));
    prismaMock.asignacionTurno.create.mockImplementation(async ({ data }: any) => ({
      id: 'asig-new-1',
      ...data,
    }));
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
    prismaMock.auditoriaCambio.createMany.mockResolvedValue({ count: 1 });
    prismaMock.empleado.findFirst.mockResolvedValue(null);
    prismaMock.empleado.findUnique.mockResolvedValue({
      id: 'emp-1',
      nombre: 'Ana Solicitante',
      categoriaId: 'cat-enf',
      categoria: { nombre: 'Enfermero(a)' },
      servicioBaseId: 'srv-urg',
      servicioBase: { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias Generales' },
    });
    prismaMock.empleado.findMany.mockResolvedValue([]);
    prismaMock.servicio.findUnique.mockResolvedValue({
      id: 'srv-urg',
      nombre: 'Urgencias Generales',
      cargosPermitidos: [],
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
      cuadrante: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
      bancoHorasSaldo: { findMany: jest.fn() },
      novedadAusencia: { findFirst: jest.fn(), findMany: jest.fn() },
      asignacionTurno: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      tipoTurno: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
      auditoriaCambio: { create: jest.fn(), createMany: jest.fn() },
      empleado: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
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

    controller = moduleRef.get(CuadrantesController);
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

  it('audita cambios desde BORRADOR, bloquea celdas fijadas (409) y expone nota/fijada en estado-global', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 9,
        empleadoId: 'emp-1',
        codigo: 'M8',
        origenAccion: 'PANEL_CELDA',
        justificacion: 'Ajuste borrador solicitado',
      })
      .expect(200);

    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoAccion: 'EDICION_TURNO',
          faseCuadrante: 'BORRADOR',
          origenAccion: 'PANEL_CELDA',
          esDetalleLote: false,
          justificacion: 'Ajuste borrador solicitado',
        }),
      })
    );

    prismaMock.asignacionTurno.findUnique.mockResolvedValueOnce({
      id: 'asig-pin',
      fijada: true,
      nota: 'No mover',
      servicioEjecutorId: 'srv-urg',
      tipoTurno: { codigo: 'M8' },
    });

    const resFijada = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 9,
        empleadoId: 'emp-1',
        codigo: 'T8',
      })
      .expect(409);
    expect(resFijada.body.message).toContain('fijada');

    prismaMock.asignacionTurno.findMany.mockResolvedValueOnce([
      {
        empleadoId: 'emp-1',
        fecha: new Date('2026-11-09T00:00:00.000Z'),
        esRotacion: false,
        codigoPrevisto: 'M8',
        nota: 'Cubrir ambulancia',
        fijada: true,
        servicioEjecutorId: 'srv-urg',
        tipoTurno: { codigo: 'M8' },
        cuadrante: { anio: 2026 },
      },
    ]);

    const resGlobal = await request(app.getHttpServer())
      .get('/api/v1/cuadrantes/estado-global?anio=2026')
      .expect(200);
    expect(resGlobal.body.asignacionesPorPeriodo['2026-11']['emp-1']['9']).toEqual(
      expect.objectContaining({
        codigo: 'M8',
        nota: 'Cubrir ambulancia',
        fijada: true,
      })
    );
  });

  it('guardarLote omite celdas fijadas (📌) y desglosa por celda (esDetalleLote=true) desde BORRADOR', async () => {
    prismaMock.asignacionTurno.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'asig-pin-3',
          empleadoId: 'emp-1',
          fecha: new Date('2026-11-03T00:00:00.000Z'),
          fijada: true,
          tipoTurno: { codigo: 'M8' },
        },
      ]);

    const res = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/lote')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        origenAccion: 'AUTOCOMPLETAR',
        celdas: [
          { empleadoId: 'emp-1', dia: 3, codigo: 'T8' }, // omitida por fijada
          { empleadoId: 'emp-1', dia: 4, codigo: 'M8' }, // aplicada
        ],
      })
      .expect(200);

    expect(res.body.totalGuardadas).toBe(1);
    expect(res.body.omitidasFijadas).toBe(1);
    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipoAccion: 'ACCION_MASIVA',
          faseCuadrante: 'BORRADOR',
          origenAccion: 'AUTOCOMPLETAR',
          esDetalleLote: false,
        }),
      })
    );
    expect(prismaMock.auditoriaCambio.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            empleadoId: 'emp-1',
            turnoAnterior: 'L',
            turnoNuevo: 'M8',
            faseCuadrante: 'BORRADOR',
            origenAccion: 'AUTOCOMPLETAR',
            esDetalleLote: true,
          }),
        ],
      })
    );
  });

  it('PATCH /celda/nota y /celda/fijar persisten sobre días vacíos, auditan y bloquean ausencia/espejo', async () => {
    // Guardar nota en día vacío -> crea asignación BLANCO con nota y audita NOTA_CELDA
    const resNota = await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/nota')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 12,
        empleadoId: 'emp-1',
        nota: 'Salida anticipada autorizada',
      })
      .expect(200);
    expect(resNota.body.nota).toBe('Salida anticipada autorizada');
    expect(prismaMock.asignacionTurno.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nota: 'Salida anticipada autorizada' }),
      })
    );
    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipoAccion: 'NOTA_CELDA', origenAccion: 'NOTA' }),
      })
    );

    // Fijar día con novedad activa -> 409
    prismaMock.novedadAusencia.findFirst.mockResolvedValueOnce({ tipo: 'VAC' });
    await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/fijar')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 12,
        empleadoId: 'emp-1',
        fijada: true,
      })
      .expect(409);

    // Fijar día normal -> 200 y audita FIJACION_CELDA
    const resFij = await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/fijar')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 12,
        empleadoId: 'emp-1',
        fijada: true,
      })
      .expect(200);
    expect(resFij.body.fijada).toBe(true);
    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipoAccion: 'FIJACION_CELDA', origenAccion: 'FIJACION' }),
      })
    );
  });

  it('PATCH /celda/apoyo restringe servicioDestinoId para COORDINADOR y permite apoyo compatible', async () => {
    prismaMock.servicio.findUnique.mockResolvedValue({
      id: 'srv-uci',
      nombre: 'UCI Adultos',
      cargosPermitidos: [{ categoriaId: 'cat-enf' }],
    });

    // COORDINADOR intentando enviar apoyo a servicio que no coordina -> 403
    await expect(
      controller.asignarApoyoDiaCelda(
        {
          servicioId: 'srv-urg',
          anio: 2026,
          mes: 11,
          dia: 14,
          empleadoId: 'emp-1',
          servicioDestinoId: 'srv-uci',
          codigo: 'M8',
        },
        {
          usuarioSso: {
            rol: 'COORDINADOR',
            nombre: 'Coord Urgencias',
            serviciosCoordinados: ['srv-urg'],
          },
        }
      )
    ).rejects.toThrow(/no tienes permisos/i);

    // COORDINADOR con ambos servicios en serviciosCoordinados -> éxito y esRotacion=true
    const resOk = await controller.asignarApoyoDiaCelda(
      {
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 14,
        empleadoId: 'emp-1',
        servicioDestinoId: 'srv-uci',
        codigo: 'M8',
      },
      {
        usuarioSso: {
          rol: 'COORDINADOR',
          nombre: 'Coord Mixto',
          serviciosCoordinados: ['srv-urg', 'srv-uci'],
        },
      }
    );
    expect(resOk).toEqual(
      expect.objectContaining({
        ok: true,
        servicioEjecutorId: 'srv-uci',
        esRotacion: true,
        codigo: 'M8',
      })
    );
    expect(prismaMock.auditoriaCambio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorId: 'Coord Mixto (Coordinador)',
          tipoAccion: 'APOYO_SERVICIO',
          origenAccion: 'APOYO',
        }),
      })
    );
  });

  it('PATCH /celda/break actualiza tanda/franja de break, recalcula horas, protege CERRADO/Espejo y expone en estado-global', async () => {
    const tipoAdm = {
      id: 'tt-adm',
      codigo: 'ADM',
      nombre: 'Administrativo Tandas',
      horaInicio: '08:00',
      horaFin: '17:00',
      horasOrdinarias: 8,
      horasDiurnas: 8,
      horasNocturnas: 0,
      minutosAlmuerzo: 60,
      recesoHabilitado: true,
      recesoRemunerado: false,
      recesoMaxSimultaneos: 1,
      recesoTandasJson: [
        { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', duracionMin: 60 },
        { orden: 2, etiqueta: 'T2', inicio: '13:00', fin: '14:00', duracionMin: 60 },
      ],
    };

    prismaMock.asignacionTurno.findUnique.mockResolvedValueOnce({
      id: 'asig-adm-1',
      servicioEjecutorId: 'srv-urg',
      tipoTurno: tipoAdm,
      empleado: { id: 'emp-1', servicioBaseId: 'srv-urg', empresaContratante: null },
    });

    const resOk = await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/break')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 15,
        empleadoId: 'emp-1',
        breakTandaOrden: 2,
      })
      .expect(200);

    expect(resOk.body).toEqual(
      expect.objectContaining({
        ok: true,
        id: 'asig-adm-1',
        breakTandaOrden: 2,
        breakInicio: '13:00',
        breakFin: '14:00',
      })
    );
    expect(liquidacionMock.calcularHorasPorTipo).toHaveBeenCalledWith(
      tipoAdm,
      expect.any(Date),
      undefined,
      { breakTandaOrden: 2, breakInicio: '13:00', breakFin: '14:00' }
    );
    expect(prismaMock.asignacionTurno.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asig-adm-1' },
        data: expect.objectContaining({
          breakTandaOrden: 2,
          breakInicio: '13:00',
          breakFin: '14:00',
        }),
      })
    );

    // Bloqueo en CERRADO_NOMINA -> 409
    prismaMock.cuadrante.findUnique.mockResolvedValueOnce({ id: 'cuad-1', estado: 'CERRADO_NOMINA' });
    await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/break')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 15,
        empleadoId: 'emp-1',
        breakTandaOrden: 1,
      })
      .expect(409);

    // Bloqueo en Celda Espejo -> 409
    prismaMock.asignacionTurno.findUnique.mockResolvedValueOnce({
      id: 'asig-adm-espejo',
      servicioEjecutorId: 'srv-uci',
      servicioEjecutor: { nombre: 'UCI Adultos' },
      tipoTurno: tipoAdm,
    });
    await request(app.getHttpServer())
      .patch('/api/v1/cuadrantes/celda/break')
      .send({
        servicioId: 'srv-urg',
        anio: 2026,
        mes: 11,
        dia: 15,
        empleadoId: 'emp-1',
        breakTandaOrden: 1,
      })
      .expect(409);

    // estado-global expone breakTandaOrden, breakInicio y breakFin
    prismaMock.asignacionTurno.findMany.mockResolvedValueOnce([
      {
        empleadoId: 'emp-1',
        fecha: new Date('2026-11-15T00:00:00.000Z'),
        esRotacion: false,
        codigoPrevisto: 'ADM',
        nota: null,
        fijada: false,
        breakTandaOrden: 2,
        breakInicio: '13:00',
        breakFin: '14:00',
        servicioEjecutorId: 'srv-urg',
        tipoTurno: { codigo: 'ADM' },
        cuadrante: { anio: 2026 },
      },
    ]);
    const resGlobal = await request(app.getHttpServer())
      .get('/api/v1/cuadrantes/estado-global?anio=2026')
      .expect(200);
    expect(resGlobal.body.asignacionesPorPeriodo['2026-11']['emp-1']['15']).toEqual(
      expect.objectContaining({
        codigo: 'ADM',
        breakTandaOrden: 2,
        breakInicio: '13:00',
        breakFin: '14:00',
      })
    );
  });
});
