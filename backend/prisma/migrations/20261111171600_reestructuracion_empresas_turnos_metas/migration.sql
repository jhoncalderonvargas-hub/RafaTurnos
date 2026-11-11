-- CreateTable
CREATE TABLE "empresas_contratantes" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "nit" TEXT,
    "aliasesCodigo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "estadoConfiguracion" TEXT NOT NULL DEFAULT 'CONFIRMADA',
    "plantillaNormativa" TEXT NOT NULL DEFAULT 'CST_LEY_2466',
    "horasSemanalesContrato" DOUBLE PRECISION NOT NULL DEFAULT 42,
    "diasBaseSemana" INTEGER NOT NULL DEFAULT 6,
    "horaInicioNocturnoMin" INTEGER NOT NULL DEFAULT 1140,
    "horaFinNocturnoMin" INTEGER NOT NULL DEFAULT 360,
    "porcentajeRecargoNocturno" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "modoRecargoDominical" TEXT NOT NULL DEFAULT 'LEY_2466',
    "porcentajeRecargoDominicalFijo" DOUBLE PRECISION,
    "aplicaTopeHorasExtrasSemanal" BOOLEAN NOT NULL DEFAULT true,
    "topeHorasExtrasSemanal" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "usaBancoHoras" BOOLEAN NOT NULL DEFAULT true,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_contratantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_cargos_permitidos" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,

    CONSTRAINT "servicios_cargos_permitidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_turnos_metas" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "tipoTurnoId" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "minimoBase" INTEGER NOT NULL DEFAULT 1,
    "esperadoBase" INTEGER NOT NULL DEFAULT 1,
    "minimoDomFest" INTEGER NOT NULL DEFAULT 1,
    "esperadoDomFest" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "servicios_turnos_metas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_contratantes_codigo_key" ON "empresas_contratantes"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_contratantes_nit_key" ON "empresas_contratantes"("nit");

-- CreateIndex
CREATE INDEX "servicios_cargos_permitidos_categoriaId_idx" ON "servicios_cargos_permitidos"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_cargos_permitidos_servicioId_categoriaId_key" ON "servicios_cargos_permitidos"("servicioId", "categoriaId");

-- CreateIndex
CREATE INDEX "servicios_turnos_metas_tipoTurnoId_idx" ON "servicios_turnos_metas"("tipoTurnoId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_turnos_metas_servicioId_tipoTurnoId_key" ON "servicios_turnos_metas"("servicioId", "tipoTurnoId");

-- Semilla inicial de las 3 Empresas Contratantes piloto antes de enlazar empleados existentes
INSERT INTO "empresas_contratantes" (
    "id",
    "codigo",
    "nombre",
    "nit",
    "aliasesCodigo",
    "estadoConfiguracion",
    "plantillaNormativa",
    "horasSemanalesContrato",
    "diasBaseSemana",
    "horaInicioNocturnoMin",
    "horaFinNocturnoMin",
    "porcentajeRecargoNocturno",
    "modoRecargoDominical",
    "porcentajeRecargoDominicalFijo",
    "aplicaTopeHorasExtrasSemanal",
    "topeHorasExtrasSemanal",
    "usaBancoHoras",
    "activa",
    "observaciones",
    "creadoEn",
    "actualizadoEn"
) VALUES
(
    'emp-ese-planta',
    'ESE_PLANTA',
    'Planta Pública ESE (Decreto 1042)',
    '890900100-1',
    ARRAY['ESE', 'PLANTA_ESE', 'PLANTA_PUBLICA', 'DECRETO_1042']::TEXT[],
    'CONFIRMADA',
    'DECRETO_1042',
    44,
    6,
    1080,
    360,
    0.35,
    'FIJO',
    1.0,
    true,
    12,
    true,
    true,
    'Régimen empleado público asistencial (44h/sem, recargo nocturno desde las 18:00 y dominical fijo 100%).',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'emp-temp-salud',
    'TEMP_SALUD',
    'TempSalud Operador Clínico SAS (CST Ley 2466)',
    '900450200-3',
    ARRAY['TEMPSALUD', 'TEMPORAL', 'OPERADOR_CST']::TEXT[],
    'CONFIRMADA',
    'CST_LEY_2466',
    42,
    6,
    1140,
    360,
    0.35,
    'LEY_2466',
    NULL,
    true,
    12,
    true,
    true,
    'Operador privado bajo Código Sustantivo del Trabajo, Ley 2101 (42h/sem) y Ley 2466 (nocturno 19:00, dominical gradual).',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
),
(
    'emp-coop-serv',
    'COOP_SERV',
    'Agremiación CooSalud Servicios',
    '901220300-7',
    ARRAY['COOSALUD', 'COOPERATIVA', 'AGREMIACION']::TEXT[],
    'CONFIRMADA',
    'PERSONALIZADA',
    42,
    6,
    1140,
    360,
    0.35,
    'LEY_2466',
    NULL,
    true,
    12,
    true,
    true,
    'Agremiación / contratación de apoyo con parámetros normativos editables desde Talento Humano.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("codigo") DO NOTHING;

-- AlterTable banco_horas_saldos
ALTER TABLE "banco_horas_saldos"
ADD COLUMN     "diasHabilesMes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "diasHabilesProrrateados" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "empresaCodigoSnapshot" TEXT,
ADD COLUMN     "horasContratadasNominales" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "horasExoneradas" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "horasSemanalesAplicadas" DOUBLE PRECISION NOT NULL DEFAULT 42;

-- AlterTable empleados (nullable primero para backfill seguro)
ALTER TABLE "empleados"
ADD COLUMN     "empresaContratanteId" TEXT,
ADD COLUMN     "horasSemanalesOverride" DOUBLE PRECISION;

UPDATE "empleados"
SET "empresaContratanteId" = (SELECT "id" FROM "empresas_contratantes" WHERE "codigo" = 'TEMP_SALUD' LIMIT 1)
WHERE "empresaContratanteId" IS NULL;

ALTER TABLE "empleados"
ALTER COLUMN "empresaContratanteId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "empleados_empresaContratanteId_idx" ON "empleados"("empresaContratanteId");

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_empresaContratanteId_fkey" FOREIGN KEY ("empresaContratanteId") REFERENCES "empresas_contratantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable servicios
ALTER TABLE "servicios" ADD COLUMN "permitePermutaEntreCargos" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable tipos_turno
ALTER TABLE "tipos_turno"
ADD COLUMN     "activo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bloqueaPermutas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "esAusencia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "esSistemaObligatorio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modoAmortizacionBanco" TEXT NOT NULL DEFAULT 'HORAS_FIJAS',
ADD COLUMN     "prorrateaMetaContrato" BOOLEAN NOT NULL DEFAULT false;

-- Inicializar banderas de tipos_turno existentes
UPDATE "tipos_turno"
SET "esSistemaObligatorio" = true
WHERE UPPER("codigo") IN ('BLANCO', 'L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM');

UPDATE "tipos_turno"
SET "prorrateaMetaContrato" = true,
    "esAusencia" = true,
    "bloqueaPermutas" = true
WHERE UPPER("codigo") IN ('VAC', 'INC', 'LIC', 'FAM');

UPDATE "tipos_turno"
SET "bloqueaPermutas" = true
WHERE UPPER("codigo") IN ('BLANCO', 'DISP');

UPDATE "tipos_turno"
SET "modoAmortizacionBanco" = 'DIA_HABIL_EMPRESA'
WHERE UPPER("codigo") = 'COMP';

-- AddForeignKey servicios_cargos_permitidos / servicios_turnos_metas
ALTER TABLE "servicios_cargos_permitidos" ADD CONSTRAINT "servicios_cargos_permitidos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "servicios_cargos_permitidos" ADD CONSTRAINT "servicios_cargos_permitidos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "servicios_turnos_metas" ADD CONSTRAINT "servicios_turnos_metas_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "servicios_turnos_metas" ADD CONSTRAINT "servicios_turnos_metas_tipoTurnoId_fkey" FOREIGN KEY ("tipoTurnoId") REFERENCES "tipos_turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;
