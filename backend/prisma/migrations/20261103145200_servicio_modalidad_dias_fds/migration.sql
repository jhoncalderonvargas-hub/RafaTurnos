-- AlterTable
ALTER TABLE "servicios"
ADD COLUMN "modalidadDias" TEXT NOT NULL DEFAULT 'TODOS_24_7',
ADD COLUMN "reqMananaFds" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "reqTardeFds" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "reqNocheFds" INTEGER NOT NULL DEFAULT 2;

-- Inicializar metas de fin de semana iguales a las metas base actuales de cada servicio
UPDATE "servicios"
SET "reqMananaFds" = "reqManana",
    "reqTardeFds" = "reqTarde",
    "reqNocheFds" = "reqNoche";
