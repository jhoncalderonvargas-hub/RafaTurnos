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
        findUnique: jest.fn(async () => null),
        update: jest.fn(async ({ where, data }: any) => ({ codigo: where.codigo, ...data })),
        delete: jest.fn(async ({ where }: any) => ({ codigo: where.codigo })),
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
                cargosPermitidos: [{ categoriaId: 'cat-1', categoria: { id: 'cat-1', nombre: 'Enfermero(a)' } }],
              }
            : where.id === 'srv-2'
              ? {
                  id: 'srv-2',
                  codigo: 'MAT',
                  nombre: 'Maternidad',
                  macroprocesoId: 'mp-urg',
                  cargosPermitidos: [{ categoriaId: 'cat-1', categoria: { id: 'cat-1', nombre: 'Enfermero(a)' } }],
                }
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
        findFirst: jest.fn(async () => null),
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
      servicioCargoPermitido: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 1 })),
      },
      servicioTurnoMeta: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        upsert: jest.fn(async () => ({})),
      },
      servicioHermano: {
        upsert: jest.fn(async () => ({})),
      },
      empleado: {
        findUnique: jest.fn(async () => ({ id: 'emp-1', nombre: 'Juan', servicioBaseId: 'srv-1', categoriaId: 'cat-1' })),
        findMany: jest.fn(async () => []),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      asignacionTurno: {
        count: jest.fn(async () => 0),
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

  it('Turnos autónomos: admite almuerzo 45 min, prorrateaMetaContrato excluyente, protege obligatorios y valida cargos/metas de servicio', async () => {
    // 1. Almuerzo libre (45 min) en HORARIO
    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'ADM9',
        nombre: 'Admin con Almuerzo 45m',
        horaInicio: '08:00',
        horaFin: '17:00',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        minutosAlmuerzo: 45,
        colorHex: '#F3F4F6',
        modoJornada: 'HORARIO',
      })
      .expect(201);
    expect(prismaMock.tipoTurno.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ codigo: 'ADM9', minutosAlmuerzo: 45 }),
      })
    );

    // 2. Exclusión mutua prorrateaMetaContrato + descuentaBancoHoras -> 400
    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'BAD1',
        nombre: 'Excluyente',
        horaInicio: '00:00',
        horaFin: '00:00',
        horasOrdinarias: 0,
        horasDiurnas: 0,
        horasNocturnas: 0,
        colorHex: '#FFFFFF',
        modoJornada: 'DESCANSO',
        prorrateaMetaContrato: true,
        descuentaBancoHoras: true,
      })
      .expect(400);

    // 3. Turno Libre Remunerado (DESCANSO + prorrateaMetaContrato: true) -> 201
    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/turnos')
      .send({
        codigo: 'LIB_REM',
        nombre: 'Libre Remunerado',
        horaInicio: '00:00',
        horaFin: '00:00',
        horasOrdinarias: 0,
        horasDiurnas: 0,
        horasNocturnas: 0,
        colorHex: '#D1FAE5',
        modoJornada: 'DESCANSO',
        prorrateaMetaContrato: true,
        bloqueaPermutas: false,
      })
      .expect(201);

    // 4. Protección de turnos obligatorios del sistema (L, COMP) al archivar o eliminar -> 409
    prismaMock.tipoTurno.findUnique.mockResolvedValueOnce({
      id: 'tt-l',
      codigo: 'L',
      esSistemaObligatorio: true,
    });
    await request(app.getHttpServer()).delete('/api/v1/servicios-admin/turnos/L').expect(409);

    prismaMock.tipoTurno.findUnique.mockResolvedValueOnce({
      id: 'tt-comp',
      codigo: 'COMP',
      esSistemaObligatorio: true,
    });
    await request(app.getHttpServer())
      .patch('/api/v1/servicios-admin/turnos/COMP/archivar')
      .send({ activo: false })
      .expect(409);

    // 5. Turno custom sin asignaciones se puede eliminar (200); con asignaciones falla con 409
    prismaMock.tipoTurno.findUnique.mockResolvedValueOnce({
      id: 'tt-cust',
      codigo: 'LIB_REM',
      esSistemaObligatorio: false,
    });
    prismaMock.asignacionTurno.count.mockResolvedValueOnce(0);
    await request(app.getHttpServer()).delete('/api/v1/servicios-admin/turnos/LIB_REM').expect(200);

    // 6. Validación minimoBase > esperadoBase en metasPorTurno -> 400
    prismaMock.tipoTurno.findMany.mockResolvedValueOnce([{ id: 'tt-m8', codigo: 'M8', horasOrdinarias: 8, horasNocturnas: 0, horasDiurnas: 8 }]);
    await request(app.getHttpServer())
      .put('/api/v1/servicios-admin/srv-1')
      .send({
        codigo: 'URG',
        nombre: 'Urgencias',
        metasPorTurno: [{ codigoTurno: 'M8', minimoBase: 5, esperadoBase: 3 }],
      })
      .expect(400);

    // 7. Enlace hermano rechaza servicios sin cargos compatibles -> 409
    prismaMock.servicio.findUnique
      .mockResolvedValueOnce({
        id: 'srv-1',
        codigo: 'URG',
        nombre: 'Urgencias',
        cargosPermitidos: [{ categoriaId: 'cat-1' }],
      })
      .mockResolvedValueOnce({
        id: 'srv-3',
        codigo: 'CONT',
        nombre: 'Contabilidad',
        cargosPermitidos: [{ categoriaId: 'cat-cont' }],
      });
    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin/srv-1/enlace-hermano/srv-3')
      .expect(409);

    // 8. Ruta adscribir-lote funciona antes de @Put(':id') (200)
    prismaMock.empleado.findMany.mockResolvedValueOnce([
      { id: 'emp-1', nombre: 'Juan', categoriaId: 'cat-1', categoria: { nombre: 'Enfermero(a)' } },
      { id: 'emp-2', nombre: 'Ana', categoriaId: 'cat-1', categoria: { nombre: 'Enfermero(a)' } },
    ]);
    await request(app.getHttpServer())
      .put('/api/v1/servicios-admin/adscribir-lote')
      .send({ empleadoIds: ['emp-1', 'emp-2'], servicioBaseId: 'srv-1' })
      .expect(200);
  });
});
