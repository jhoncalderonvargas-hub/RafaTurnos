import { Module } from '@nestjs/common';
import { LiquidacionModule } from '../liquidacion/liquidacion.module';
import { ServiciosAdminController } from './servicios-admin.controller';

@Module({
  imports: [LiquidacionModule],
  controllers: [ServiciosAdminController],
})
export class ServiciosAdminModule {}
