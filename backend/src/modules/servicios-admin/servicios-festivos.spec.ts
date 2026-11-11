import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { ServiciosAdminController } from './servicios-admin.controller';
import { FestivosController } from '../festivos/festivos.module';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { LiquidacionService } from '../liquidacion/liquidacion.module';
import { PrismaService } from '../../prisma/prisma.service';

describe('ServiciosAdminController & FestivosController', () => {
  let app: INestApplication;
  let prismaMock: any;
  let liquidacionMock: any;

  beforeEach(async () => {
    prismaMock = {
      tipoTurno: {
        upsert: jest.fn(async ({ create }: any) => ({ id: 'tt-new', ...create })),
        findMany: jest.fn(async () => []),
      },
      servicio: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.id === 'srv-1'
            ? {
                id: 'srv-1',
                codigo: 'URG',
                nombre: 'Urgencias',
                macroprocesoId: 'mp-urg',
                turnosHabilitadosCodigos: ['M8', 'T8'],
              }
            : where.id === 'srv-2'
              ? { id: 'srv-2', codigo: 'MAT', nombre: 'Maternidad', macroprocesoId: 'mp-urg' }
              : null
        ),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ data }: any) => ({
          id: 'srv-1',
          ...data,
          turnosHabilitadosCodigos: data.turnosHabilitadosCodigos || ['M8', 'T8'],
        })),
      },
      categoriaProfesional: {
        findMany: jest.fn(async () => [{ id: 'cat-1', nombre: 'Enfermero(a)' }]),
        upsert: jest.fn(async ({ create }: any) => ({ id: 'cat-new', ...create })),
      },
      requerimientoCobertura: {
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      servicioTurnoHabilitado: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 1 })),
      },
      servicioHermano: {
        upsert: jest.fn(async () => ({})),
      },
      macroproceso: {
        findFirst: jest.fn(async () => ({ id: 'mp-urg', codigo: 'URGENCIAS' })),
        create: jest.fn(async ({ data }: any) => data),
      },
      festivoColombia: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => create),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg)
      ),
    };

    liquidacionMock = {
      recalcularPorTipoTurno: jest.fn(async () => ({ evaluadas: 0, actualizadas: 0 })),
      recalcularAnioYVispera: jest.fn(async () => ({ evaluadas: 0, actualizadas: 0 })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ServiciosAdminController, FestivosController],
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

  it('valida turnos en catálogo: DESCANSO 00:00/0h, rechaza HORARIO con inicio==fin y liquida GUARDIA_24H', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'D_ERR',
        nombre: 'Inválido',
        horaInicio: '14:00',
        horaFin: '14:00',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        colorHex: '#E0F2FE',
        modoJornada: 'HORARIO',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'PERM',
        nombre: 'Permiso Descanso',
        horaInicio: '08:00',
        horaFin: '16:00',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        colorHex: '#FFFFFF',
        modoJornada: 'DESCANSO',
      })
      .expect(201);

    expect(prismaMock.tipoTurno.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          codigo: 'PERM',
          horaInicio: '00:00',
          horaFin: '00:00',
          horasOrdinarias: 0,
        }),
      })
    );

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'G24X',
        nombre: 'Guardia 24h Custom',
        horaInicio: '07:00',
        horaFin: '07:00',
        horasOrdinarias: 24,
        horasDiurnas: 0,
        horasNocturnas: 0,
        colorHex: '#FEE2E2',
        modoJornada: 'GUARDIA_24H',
      })
      .expect(201);

    expect(prismaMock.tipoTurno.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          codigo: 'G24X',
          horasOrdinarias: 24,
          horasDiurnas: 13,
          horasNocturnas: 11,
        }),
      })
    );
    expect(liquidacionMock.recalcularPorTipoTurno).toHaveBeenCalledWith('tt-new');
  });

  it('PUT servicio inexistente 404, conserva macroprocesoId si se omite, limpia categorías quitadas y rechaza auto-hermano 400', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/servicios-admin/no-existe')
      .send({ codigo: 'X', nombre: 'X' })
      .expect(404);

    await request(app.getHttpServer())
      .put('/api/v1/servicios-admin/srv-1')
      .send({
        codigo: 'URG',
        nombre: 'Urgencias Editado',
        reglasPorCargo: [
          {
            categoriaId: 'cat-1',
            categoriaNombre: 'Enfermero(a)',
            reqDia: 2,
            reqNoche: 1,
          },
        ],
      })
      .expect(200);

    expect(prismaMock.servicio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ macroprocesoId: 'mp-urg' }),
      })
    );
    expect(prismaMock.requerimientoCobertura.deleteMany).toHaveBeenCalledWith({
      where: { servicioId: 'srv-1', categoriaId: { notIn: ['cat-1'] } },
    });

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/srv-1/enlace-hermano/srv-1')
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/srv-1/enlace-hermano/srv-2')
      .expect(201);
  });

  it('FestivosController protege festivos oficiales con 409, verifica fecha inválida con 400 y refresca días cívicos', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/festivos/verificar/2026-02-30')
      .expect(400);

    const verifOficial = await request(app.getHttpServer())
      .get('/api/v1/festivos/verificar/2026-07-20')
      .expect(200);
    expect(verifOficial.body.esFestivo).toBe(true);
    expect(verifOficial.body.recargoLegalCst).toContain('90%');

    // No permitir sobrescribir ni borrar festivo oficial de ley
    await request(app.getHttpServer())
      .post('/api/v1/festivos/dia-civico')
      .send({ fecha: '2026-07-20', nombre: 'Intento' })
      .expect(409);

    await request(app.getHttpServer())
      .delete('/api/v1/festivos/dia-civico/2026-07-20')
      .expect(409);

    // Crear y eliminar día cívico en fecha ordinaria
    await request(app.getHttpServer())
      .post('/api/v1/festivos/dia-civico')
      .send({ fecha: '2026-09-10', nombre: 'Aniversario Hospital' })
      .expect(201);

    await request(app.getHttpServer())
      .delete('/api/v1/festivos/dia-civico/2026-09-10')
      .expect(200);
  });
});
