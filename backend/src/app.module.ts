import { Controller, Get, Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.service';
import { FestivosModule } from './modules/festivos/festivos.module';
import { BancoHorasNominaModule } from './modules/banco-horas/banco-horas.module';
import { CuadrantesModule } from './modules/cuadrantes/cuadrantes.module';
import { OperacionesHospitalModule } from './modules/operaciones/operaciones.module';

@Controller('api/v1')
export class HealthController {
  @Get('health')
  healthCheck() {
    return {
      servicio: 'Rafa Turnos Backend API (NestJS + Prisma)',
      estado: 'ONLINE',
      normativa: 'CST Colombia + Ley 2101 (42h/sem) + Ley Emiliani',
      modulosActivos: [
        'FestivosColombiaService (Caché RAM O(1) + Butcher/Meeus)',
        'BancoHorasNominaService (Continuo sin caducidad + Desacoplamiento Financiero)',
        'CuadrantesReglasService (Descanso 12h + Post-guardia + Rotación Homóloga)',
        'IntranetIntegration (SSO JWT + Sincronización REST)',
        'CalendarioIcalController (RFC 5545 webcal://)',
      ],
    };
  }
}

@Module({
  imports: [
    PrismaModule,
    FestivosModule,
    BancoHorasNominaModule,
    CuadrantesModule,
    OperacionesHospitalModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
