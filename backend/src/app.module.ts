import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.service';
import { FestivosModule } from './modules/festivos/festivos.module';
import { BancoHorasNominaModule } from './modules/banco-horas/banco-horas.module';
import { CuadrantesModule } from './modules/cuadrantes/cuadrantes.module';
import { OperacionesHospitalModule } from './modules/operaciones/operaciones.module';
import { SsoRoleGuard } from './modules/operaciones/sso-role.guard';
import { ServiciosAdminModule } from './modules/servicios-admin/servicios-admin.module';
import { LiquidacionModule } from './modules/liquidacion/liquidacion.module';

@Controller('api/v1')
export class HealthController {
  @Get('health')
  healthCheck() {
    return {
      servicio: 'Rafa Turnos Backend API (NestJS + Prisma)',
      estado: 'ONLINE',
      normativa: 'CST Colombia + Ley 2466/2025 (19:00–06:00, Dom 90%→100%) + Ley 2101 (42h/sem) + Ley Emiliani',
      modulosActivos: [
        'FestivosColombiaService (Caché RAM O(1) + Butcher/Meeus)',
        'LiquidacionService (Motor Único HOD/HON/HDFD/HDFN + Vigencias + Art. 165 CST)',
        'BancoHorasNominaService (Continuo sin caducidad + Desacoplamiento Financiero)',
        'CuadrantesReglasService (Descanso 12h + Post-guardia + Rotación Homóloga)',
        'ServiciosAdminController (Gobierno de Servicios, Enlace de Hermanos y Adscripción)',
        'IntranetIntegration (SSO JWT + Webhooks en Tiempo Real + Sincronización REST)',
        'CalendarioIcalController (RFC 5545 webcal://)',
      ],
    };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    FestivosModule,
    LiquidacionModule,
    BancoHorasNominaModule,
    CuadrantesModule,
    OperacionesHospitalModule,
    ServiciosAdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SsoRoleGuard,
    },
  ],
})
export class AppModule {}
