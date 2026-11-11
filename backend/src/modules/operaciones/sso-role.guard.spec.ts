import {
  Controller,
  Get,
  INestApplication,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { SsoRoleGuard } from './sso-role.guard';
import { firmarJwtHmac, verificarJwtHmac } from './jwt-sso.util';

@Controller('api/v1')
class StubGuardRoutesController {
  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('intranet/sso-login')
  ssoLogin() {
    return { ok: true };
  }

  @Get('cuadrantes/estado-global')
  estadoGlobal() {
    return { ok: true };
  }

  @Post('cuadrantes/validar-celda')
  validarCelda() {
    return { esValido: true };
  }

  @Post('banco-horas-nomina/simular-cierre')
  simularCierre() {
    return { ok: true };
  }

  @Post('permutas/simular')
  simularPermuta() {
    return { permitida: true };
  }

  @Put('cuadrantes/celda')
  guardarCelda() {
    return { ok: true };
  }

  @Put('cuadrantes/estado')
  actualizarEstado() {
    return { ok: true };
  }

  @Post('permutas')
  crearPermuta() {
    return { id: 'p1' };
  }

  @Patch('permutas/:id/aceptar-par')
  aceptarPar(@Param('id') id: string) {
    return { id, estado: 'PENDIENTE_SUPERVISOR' };
  }

  @Patch('permutas/:id/rechazar-par')
  rechazarPar(@Param('id') id: string) {
    return { id, estado: 'RECHAZADA' };
  }

  @Patch('permutas/:id/aprobar')
  aprobar(@Param('id') id: string) {
    return { id, estado: 'APROBADA' };
  }

  @Post('servicios-admin')
  crearServicio() {
    return { ok: true };
  }

  @Post('festivos/dia-civico')
  agregarDiaCivico() {
    return { ok: true };
  }

  @Post('liquidacion/recalcular')
  recalcular() {
    return { ok: true };
  }
}

describe('SsoRoleGuard (RBAC + Sliding Session)', () => {
  const SECRET = 'test_secret_sso_guard';
  let prevSecret: string | undefined;
  let app: INestApplication;

  beforeAll(async () => {
    prevSecret = process.env.INTRANET_JWT_SECRET;
    process.env.INTRANET_JWT_SECRET = SECRET;

    const moduleRef = await Test.createTestingModule({
      controllers: [StubGuardRoutesController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: SsoRoleGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (prevSecret === undefined) {
      delete process.env.INTRANET_JWT_SECRET;
    } else {
      process.env.INTRANET_JWT_SECRET = prevSecret;
    }
    await app.close();
  });

  const signRole = (
    rol: 'ADMIN_TH' | 'COORDINADOR' | 'COLABORADOR',
    opts?: { serviciosCoordinados?: string[]; expiresIn?: number }
  ) =>
    firmarJwtHmac(
      {
        documento: '101010',
        empleadoId: 'emp-1',
        rol,
        serviciosCoordinados: opts?.serviciosCoordinados ?? ['srv-urg'],
      },
      SECRET,
      opts?.expiresIn ?? 28800
    );

  it('permite rutas públicas y simulaciones sin token', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).post('/api/v1/intranet/sso-login').send({}).expect(201);
    await request(app.getHttpServer()).post('/api/v1/cuadrantes/validar-celda').send({}).expect(201);
    await request(app.getHttpServer()).post('/api/v1/banco-horas-nomina/simular-cierre').send({}).expect(201);
    await request(app.getHttpServer()).post('/api/v1/permutas/simular').send({}).expect(201);
  });

  it('rechaza escrituras sin token o con token expirado/manipulado con 401', async () => {
    await request(app.getHttpServer()).put('/api/v1/cuadrantes/celda').send({}).expect(401);

    const expired = signRole('ADMIN_TH', { expiresIn: -60 });
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${expired}`)
      .send({})
      .expect(401);

    const forged = firmarJwtHmac({ documento: '1', rol: 'ADMIN_TH' }, 'otro_secreto', 3600);
    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${forged}`)
      .send({})
      .expect(401);
  });

  it('restringe COLABORADOR únicamente a consultas GET y permutas entre pares', async () => {
    const tokenColab = signRole('COLABORADOR');

    await request(app.getHttpServer())
      .get('/api/v1/cuadrantes/estado-global')
      .set('Authorization', `Bearer ${tokenColab}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/permutas')
      .set('Authorization', `Bearer ${tokenColab}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .patch('/api/v1/permutas/perm-1/aceptar-par')
      .set('Authorization', `Bearer ${tokenColab}`)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/permutas/perm-1/rechazar-par')
      .set('Authorization', `Bearer ${tokenColab}`)
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${tokenColab}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .patch('/api/v1/permutas/perm-1/aprobar')
      .set('Authorization', `Bearer ${tokenColab}`)
      .send({})
      .expect(403);
  });

  it('limita COORDINADOR por endpoint global, estados reservados y serviciosCoordinados', async () => {
    const tokenCoord = signRole('COORDINADOR', { serviciosCoordinados: ['srv-urg'] });

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/festivos/dia-civico')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/v1/liquidacion/recalcular')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({ servicioId: 'srv-urg', estado: 'CERRADO_NOMINA' })
      .expect(403);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({ servicioId: 'srv-urg', estado: 'BORRADOR' })
      .expect(403);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({ servicioId: 'srv-uci' })
      .expect(403);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({ servicioId: 'srv-urg', estado: 'PUBLICADO' })
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${tokenCoord}`)
      .send({ servicioId: 'srv-urg' })
      .expect(200);
  });

  it('permite a ADMIN_TH cerrar/reabrir nómina y configurar servicios/festivos/liquidación', async () => {
    const tokenTh = signRole('ADMIN_TH');

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .set('Authorization', `Bearer ${tokenTh}`)
      .send({ servicioId: 'srv-uci', estado: 'CERRADO_NOMINA' })
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/estado')
      .set('Authorization', `Bearer ${tokenTh}`)
      .send({ servicioId: 'srv-uci', estado: 'BORRADOR' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/servicios-admin')
      .set('Authorization', `Bearer ${tokenTh}`)
      .send({})
      .expect(201);
  });

  it('emite header x-renewed-token en sliding session cuando restan < 2h', async () => {
    const porVencer = signRole('COORDINADOR', { expiresIn: 1800 });
    const resRenovado = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${porVencer}`)
      .send({ servicioId: 'srv-urg' })
      .expect(200);

    const renewed = resRenovado.headers['x-renewed-token'];
    expect(typeof renewed).toBe('string');
    const decoded = verificarJwtHmac(renewed, SECRET);
    expect(decoded.rol).toBe('COORDINADOR');

    const fresco = signRole('COORDINADOR', { expiresIn: 25000 });
    const resFresco = await request(app.getHttpServer())
      .put('/api/v1/cuadrantes/celda')
      .set('Authorization', `Bearer ${fresco}`)
      .send({ servicioId: 'srv-urg' })
      .expect(200);

    expect(resFresco.headers['x-renewed-token']).toBeUndefined();
  });
});
