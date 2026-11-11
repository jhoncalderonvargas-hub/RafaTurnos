import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { PrismaService } from '../../prisma/prisma.service';
import { LiquidacionService } from '../liquidacion/liquidacion.module';
import {
  resolverEmpresaDesdeIntranet,
  resolverServicioPorMacroprocesoYCargo,
} from './empresas-matching.util';
import { EmpresasController } from './empresas.module';

describe('EmpresasController & Matching Intranet (Multi-empresa / SIN codigoAreaIntranet)', () => {
  let app: INestApplication;
  let prismaMock: any;
  let liquidacionMock: any;

  const empEse = {
    id: 'emp-ese',
    codigo: 'ESE_PLANTA',
    nombre: 'ESE Hospital Planta',
    nit: '890100100-1',
    aliasesCodigo: ['PLANTA_ESE'],
    estadoConfiguracion: 'CONFIRMADA',
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
    activa: true,
    _count: { empleados: 12 },
  };

  beforeEach(async () => {
    prismaMock = {
      empresaContratante: {
        findMany: jest.fn(async () => [empEse]),
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.id === 'emp-ese' || where.codigo === 'ESE_PLANTA') return empEse;
          if (where.id === 'emp-vacia') {
            return { ...empEse, id: 'emp-vacia', codigo: 'PEND_X', estadoConfiguracion: 'PENDIENTE_REGLAS', _count: { empleados: 0 } };
          }
          return null;
        }),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'emp-new', ...data, _count: { empleados: 0 } })),
        update: jest.fn(async ({ where, data }: any) => ({ ...empEse, id: where.id, ...data, _count: { empleados: 12 } })),
        delete: jest.fn(async () => ({ id: 'emp-vacia' })),
      },
      empleado: {
        updateMany: jest.fn(async () => ({ count: 10 })),
      },
    };
    liquidacionMock = {
      recalcularPorEmpresa: jest.fn(async () => ({ evaluadas: 20, actualizadas: 4 })),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [EmpresasController],
      providers: [
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

  it('lista empresas, expone 3 plantillas normativas, confirma PENDIENTE_REGLAS y recalcula empleados al actualizar', async () => {
    const resList = await request(app.getHttpServer()).get('/api/v1/empresas').expect(200);
    expect(resList.body).toHaveLength(1);
    expect(resList.body[0].empleadosCount).toBe(12);

    const resPlantillas = await request(app.getHttpServer())
      .get('/api/v1/empresas/plantillas')
      .expect(200);
    expect(resPlantillas.body.map((p: any) => p.codigo)).toEqual([
      'DECRETO_1042',
      'CST_LEY_2466',
      'PERSONALIZADA',
    ]);

    // Confirmar reglas de empresa pendiente cambia estadoConfiguracion a CONFIRMADA y recalcula
    const resConf = await request(app.getHttpServer())
      .post('/api/v1/empresas/emp-vacia/confirmar-reglas')
      .send({ horasSemanalesContrato: 42, plantillaNormativa: 'CST_LEY_2466' })
      .expect(201);
    expect(resConf.body.estadoConfiguracion).toBe('CONFIRMADA');
    expect(prismaMock.empleado.updateMany).toHaveBeenCalledWith({
      where: { empresaContratanteId: 'emp-vacia', horasSemanalesOverride: null },
      data: { horasSemanalesLey: 42 },
    });
    expect(liquidacionMock.recalcularPorEmpresa).toHaveBeenCalledWith('emp-vacia');

    // Bloquea eliminar empresa con colaboradores (409), permite cuando tiene 0 (200)
    await request(app.getHttpServer()).delete('/api/v1/empresas/emp-ese').expect(409);
    await request(app.getHttpServer()).delete('/api/v1/empresas/emp-vacia').expect(200);
  });

  it('resolverEmpresaDesdeIntranet auto-descubre empresa nueva como PENDIENTE_REGLAS y resolverServicioPorMacroprocesoYCargo cruza solo macroproceso+cargo', async () => {
    const dbMock = {
      empresaContratante: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 'emp-auto', ...data })),
      },
    };
    const resAuto = await resolverEmpresaDesdeIntranet(dbMock, {
      empresaCodigo: 'OUTSOURCING_UCI',
      empresaNombre: 'Outsourcing Crítico S.A.S.',
      empresaNit: '900888777-2',
      horasSemanalesContrato: 42,
    });
    expect(resAuto.recienCreada).toBe(true);
    expect(resAuto.empresa.estadoConfiguracion).toBe('PENDIENTE_REGLAS');

    // Servicio matching sin codigoAreaIntranet: elige el servicio del mismo macroproceso más específico que permite el cargo
    const servicios = [
      {
        id: 'srv-multi',
        codigo: 'FACT-URG',
        macroproceso: { codigo: 'ADMINISTRATIVO' },
        cargosPermitidos: [{ categoriaId: 'cat-aux-adm' }, { categoriaId: 'cat-tec-adm' }],
      },
      {
        id: 'srv-esp',
        codigo: 'MED-INT-ESP',
        macroproceso: { codigo: 'CUIDADOS_INTENSIVOS' },
        cargosPermitidos: [{ categoriaId: 'cat-esp' }],
      },
      {
        id: 'srv-gen',
        codigo: 'UCI-GEN',
        macroproceso: { codigo: 'CUIDADOS_INTENSIVOS' },
        cargosPermitidos: [{ categoriaId: 'cat-enf' }, { categoriaId: 'cat-esp' }],
      },
    ];
    const resolvedEsp = await resolverServicioPorMacroprocesoYCargo(
      {},
      { macroprocesoCodigo: 'CUIDADOS_INTENSIVOS', categoriaId: 'cat-esp' },
      servicios
    );
    expect(resolvedEsp).toBe('srv-esp'); // Prioriza el servicio homogéneo (cargosPermitidos.length = 1)
  });
});
