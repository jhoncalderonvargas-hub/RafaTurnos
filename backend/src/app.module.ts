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
import { EmpresasModule } from './modules/empresas/empresas.module';

@Controller('api/v1')
export class HealthController {
  @Get('health')
  healthCheck() {
    return {
      servicio: 'Rafa Turnos Backend API (NestJS + Prisma)',
      estado: 'ONLINE',
      normativa: 'Multi-Empresa (Decreto 1042 44h/18:00 + CST Ley 2466/2025 42h/19:00 + Régimen Editable) + Ley Emiliani',
      modulosActivos: [
        'EmpresasModule (Gestión Multi-Empresa y Auto-descubrimiento Intranet)',
        'FestivosColombiaService (Caché RAM O(1) + Butcher/Meeus)',
        'LiquidacionService (Motor Único HOD/HON/HDFD/HDFN + Días Hábiles Universales)',
        'BancoHorasNominaService (Continuo sin caducidad + Desacoplamiento Financiero)',
        'CuadrantesReglasService (Descanso 12h + Post-guardia + Rotación Homóloga)',
        'ServiciosAdminController (Servicios Homogéneos/Multi-cargo, Metas por Turno, Turnos Obligatorios)',
        'IntranetIntegration (SSO JWT + Sincronización Macroproceso × Cargo × Empresa)',
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
    EmpresasModule,
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
