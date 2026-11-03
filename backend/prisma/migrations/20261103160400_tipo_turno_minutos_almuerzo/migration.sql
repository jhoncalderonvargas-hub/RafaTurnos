-- AlterTable tipos_turno
ALTER TABLE "tipos_turno"
ADD COLUMN "minutosAlmuerzo" INTEGER NOT NULL DEFAULT 0;

-- Configurar 60 minutos de almuerzo no computable por defecto en el turno Administrativo (ADM: 08:00 - 17:00 = 8h efectivas)
UPDATE "tipos_turno"
SET
  "minutosAlmuerzo" = 60,
  "horaInicio" = '08:00',
  "horaFin" = '17:00',
  "horasOrdinarias" = 8,
  "horasDiurnas" = 8,
  "horasNocturnas" = 0
WHERE "codigo" = 'ADM';
