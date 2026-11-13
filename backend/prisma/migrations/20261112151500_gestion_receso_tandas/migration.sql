-- AlterTable: Configuración visual de Break/Almuerzo por Tandas en TipoTurno
ALTER TABLE "tipos_turno"
ADD COLUMN "recesoHabilitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recesoRemunerado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recesoMaxSimultaneos" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "recesoTandasJson" JSONB;

-- Backfill automático para turnos existentes con almuerzo no computable configurado
UPDATE "tipos_turno"
SET
  "recesoHabilitado" = true,
  "recesoRemunerado" = false,
  "recesoMaxSimultaneos" = 1,
  "recesoTandasJson" = CASE
    WHEN "codigo" = 'ADM' AND "minutosAlmuerzo" = 60 THEN
      '[{"orden":1,"etiqueta":"T1","inicio":"12:00","fin":"13:00","duracionMin":60}]'::jsonb
    ELSE
      jsonb_build_array(
        jsonb_build_object(
          'orden', 1,
          'etiqueta', 'T1',
          'inicio', '12:00',
          'fin', to_char((TIME '12:00' + ("minutosAlmuerzo" * INTERVAL '1 minute')), 'HH24:MI'),
          'duracionMin', "minutosAlmuerzo"
        )
      )
  END
WHERE "minutosAlmuerzo" > 0;

-- AlterTable: Tanda y horario asignado de break por celda en AsignacionTurno
ALTER TABLE "asignaciones_turno"
ADD COLUMN "breakTandaOrden" INTEGER,
ADD COLUMN "breakInicio" TEXT,
ADD COLUMN "breakFin" TEXT;
