import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Conexión establecida exitosamente con PostgreSQL (Prisma ORM).');
      await this.asegurarMacroprocesosEnDb();
    } catch (err) {
      this.logger.warn(
        'PostgreSQL aún no está conectado o configurado en DATABASE_URL. El backend operará con adaptador en memoria hasta ejecutar prisma migrate.'
      );
    }
  }

  private async asegurarMacroprocesosEnDb(): Promise<void> {
    try {
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "macroprocesos" (
          "id" TEXT NOT NULL,
          "codigo" TEXT NOT NULL,
          "nombre" TEXT NOT NULL,
          "nombreCorto" TEXT NOT NULL,
          "tipoProceso" TEXT NOT NULL DEFAULT 'MISIONAL_ASISTENCIAL',
          "icono" TEXT NOT NULL DEFAULT '🏥',
          "orden" INTEGER NOT NULL DEFAULT 1,
          "modalidadSugerida" TEXT NOT NULL DEFAULT 'TODOS_24_7',
          "plantillaTurnosSugerida" TEXT NOT NULL DEFAULT 'ROTATIVO_8H',
          CONSTRAINT "macroprocesos_pkey" PRIMARY KEY ("id")
        );
      `);
      await this.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "macroprocesos_codigo_key" ON "macroprocesos"("codigo");
      `);

      // Sincronizar catálogo inicial desde Intranet si está disponible
      const intranetUrl = process.env.INTRANET_API_URL || 'http://localhost:4300';
      const intranetApiKey = process.env.INTRANET_API_KEY || '';
      let listaIntranet: any[] = [];
      try {
        const resp = await fetch(`${intranetUrl}/api/intranet/macroprocesos`, {
          headers: intranetApiKey ? { 'x-api-key': intranetApiKey } : {},
        });
        if (resp.ok) {
          listaIntranet = await resp.json();
        }
      } catch {}

      if (Array.isArray(listaIntranet) && listaIntranet.length > 0) {
        for (const m of listaIntranet) {
          const cod = String(m.codigo || '').trim().toUpperCase();
          if (!cod) continue;
          await (this as any).macroproceso.upsert({
            where: { codigo: cod },
            update: {
              nombre: m.nombre || cod,
              nombreCorto: m.nombreCorto || m.nombre || cod,
              tipoProceso: m.tipoProceso || 'MISIONAL_ASISTENCIAL',
              icono: m.icono || '🏥',
              orden: Number(m.orden) || 1,
              modalidadSugerida: m.modalidadSugerida || 'TODOS_24_7',
              plantillaTurnosSugerida: m.plantillaTurnosSugerida || 'ROTATIVO_8H',
            },
            create: {
              id: `mp-${cod.toLowerCase().replace(/_/g, '-')}`,
              codigo: cod,
              nombre: m.nombre || cod,
              nombreCorto: m.nombreCorto || m.nombre || cod,
              tipoProceso: m.tipoProceso || 'MISIONAL_ASISTENCIAL',
              icono: m.icono || '🏥',
              orden: Number(m.orden) || 1,
              modalidadSugerida: m.modalidadSugerida || 'TODOS_24_7',
              plantillaTurnosSugerida: m.plantillaTurnosSugerida || 'ROTATIVO_8H',
            },
          });
        }
      }

      // Migrar columna macroprocesoId en tabla servicios y eliminar el antiguo tipoAsistencia si aún existe
      await this.$executeRawUnsafe(`
        ALTER TABLE "servicios" ADD COLUMN IF NOT EXISTS "macroprocesoId" TEXT;
      `);

      // Si aún existe la columna antigua tipoAsistencia, migrar sus valores hacia macroprocesoId y reclasificar servicios
      await this.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'servicios' AND column_name = 'tipoAsistencia'
          ) THEN
            UPDATE "servicios" s
            SET "macroprocesoId" = m."id"
            FROM "macroprocesos" m
            WHERE s."macroprocesoId" IS NULL AND m."codigo" = s."tipoAsistencia"::text;

            ALTER TABLE "servicios" DROP COLUMN "tipoAsistencia";
          END IF;
        END $$;
      `);

      // Asegurar que servicios sin macroprocesoId reciban su macroproceso cuando falte (sin pisar servicios ya clasificados)
      const mapaReclasificacion: Record<string, string> = {
        'MED-INT': 'CUIDADOS_INTENSIVOS',
        'MED-INT-ESP': 'CUIDADOS_INTENSIVOS',
        'MED-INT-ENF': 'CUIDADOS_INTENSIVOS',
        'MED-INT-AUX': 'CUIDADOS_INTENSIVOS',
        'MED-GRAL': 'CONSULTA_EXTERNA',
        'FACT-URG': 'ADMINISTRATIVO',
        'FACT-CEN': 'ADMINISTRATIVO',
        'COND': 'APOYO_OPERATIVO',
        'OF-VAR': 'APOYO_OPERATIVO',
        'MANT': 'APOYO_OPERATIVO',
      };
      for (const [srvCod, mpCod] of Object.entries(mapaReclasificacion)) {
        await this.$executeRawUnsafe(`
          UPDATE "servicios" s
          SET "macroprocesoId" = m."id"
          FROM "macroprocesos" m
          WHERE s."macroprocesoId" IS NULL AND s."codigo" = '${srvCod}' AND m."codigo" = '${mpCod}';
        `);
      }

      // Cualquier servicio sin macroprocesoId queda en URGENCIAS por seguridad de llave foránea
      await this.$executeRawUnsafe(`
        UPDATE "servicios" s
        SET "macroprocesoId" = (SELECT "id" FROM "macroprocesos" WHERE "codigo" = 'URGENCIAS' LIMIT 1)
        WHERE s."macroprocesoId" IS NULL;
      `);
    } catch {}
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
