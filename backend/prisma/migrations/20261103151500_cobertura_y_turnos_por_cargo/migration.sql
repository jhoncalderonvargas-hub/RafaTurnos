-- AlterTable requerimientos_cobertura
DELETE FROM "requerimientos_cobertura";

ALTER TABLE "requerimientos_cobertura"
ALTER COLUMN "tipoTurnoId" DROP NOT NULL,
ALTER COLUMN "cantidadMinima" SET DEFAULT 1,
ADD COLUMN "reqManana" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reqTarde" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reqNoche" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reqMananaFds" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reqTardeFds" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "reqNocheFds" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "requerimientos_cobertura_servicioId_categoriaId_key" ON "requerimientos_cobertura"("servicioId", "categoriaId");

-- Poblar requerimientos_cobertura iniciales para cada Servicio x Categoría con personal adscrito
INSERT INTO "requerimientos_cobertura" (
  "id",
  "servicioId",
  "categoriaId",
  "cantidadMinima",
  "aplicaFestivoDom",
  "reqManana",
  "reqTarde",
  "reqNoche",
  "reqMananaFds",
  "reqTardeFds",
  "reqNocheFds"
)
SELECT
  md5(e."servicioBaseId" || '::' || e."categoriaId"),
  e."servicioBaseId",
  e."categoriaId",
  GREATEST(1, LEAST(COUNT(*)::int / 2, 2)),
  true,
  GREATEST(1, LEAST(COUNT(*)::int / 2, 2)),
  GREATEST(1, LEAST(COUNT(*)::int / 2, 2)),
  CASE WHEN COUNT(*) >= 3 THEN 1 ELSE 0 END,
  GREATEST(1, LEAST(COUNT(*)::int / 2, 2)),
  GREATEST(1, LEAST(COUNT(*)::int / 2, 2)),
  CASE WHEN COUNT(*) >= 3 THEN 1 ELSE 0 END
FROM "empleados" e
GROUP BY e."servicioBaseId", e."categoriaId"
ON CONFLICT ("servicioId", "categoriaId") DO NOTHING;

-- Actualizar las metas globales de cada servicio para que coincidan con la suma de sus cargos cuando tengan personal
UPDATE "servicios" s
SET
  "reqManana" = sub.sum_m,
  "reqTarde" = sub.sum_t,
  "reqNoche" = sub.sum_n,
  "reqMananaFds" = sub.sum_m_fds,
  "reqTardeFds" = sub.sum_t_fds,
  "reqNocheFds" = sub.sum_n_fds
FROM (
  SELECT
    "servicioId",
    SUM("reqManana")::int AS sum_m,
    SUM("reqTarde")::int AS sum_t,
    SUM("reqNoche")::int AS sum_n,
    SUM("reqMananaFds")::int AS sum_m_fds,
    SUM("reqTardeFds")::int AS sum_t_fds,
    SUM("reqNocheFds")::int AS sum_n_fds
  FROM "requerimientos_cobertura"
  GROUP BY "servicioId"
) sub
WHERE s."id" = sub."servicioId";

-- Poblar servicios_turnos_habilitados para cada Servicio x Categoría x TipoTurno habilitado
INSERT INTO "servicios_turnos_habilitados" (
  "id",
  "servicioId",
  "categoriaId",
  "tipoTurnoId",
  "habilitado"
)
SELECT
  md5(rc."servicioId" || '::' || rc."categoriaId" || '::' || tt."id"),
  rc."servicioId",
  rc."categoriaId",
  tt."id",
  true
FROM "requerimientos_cobertura" rc
JOIN "servicios" s ON s."id" = rc."servicioId"
JOIN "tipos_turno" tt ON tt."codigo" = ANY(s."turnosHabilitadosCodigos")
WHERE tt."codigo" NOT IN ('M', 'T', 'N', 'G12', 'BLANCO')
ON CONFLICT ("servicioId", "categoriaId", "tipoTurnoId") DO NOTHING;
