import { Module } from '@nestjs/common';
import { ServiciosAdminController } from './servicios-admin.controller';

@Module({
  controllers: [ServiciosAdminController],
})
export class ServiciosAdminModule {}
