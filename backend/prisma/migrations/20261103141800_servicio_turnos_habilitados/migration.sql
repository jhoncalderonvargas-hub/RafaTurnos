-- AlterTable
ALTER TABLE "servicios"
ADD COLUMN IF NOT EXISTS "turnosHabilitadosCodigos" TEXT[] DEFAULT ARRAY['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'VAC', 'INC']::TEXT[];

-- AlterTable
ALTER TABLE "tipos_turno"
ADD COLUMN IF NOT EXISTS "visibleEnPaleta" BOOLEAN NOT NULL DEFAULT true;
