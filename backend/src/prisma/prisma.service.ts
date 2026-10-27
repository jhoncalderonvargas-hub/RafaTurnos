import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Conexión establecida exitosamente con PostgreSQL (Prisma ORM).');
    } catch (err) {
      this.logger.warn(
        'PostgreSQL aún no está conectado o configurado en DATABASE_URL. El backend operará con adaptador en memoria hasta ejecutar prisma migrate.'
      );
    }
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
