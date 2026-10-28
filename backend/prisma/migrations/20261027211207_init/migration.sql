-- CreateEnum
CREATE TYPE "TipoAsistencia" AS ENUM ('CUIDADOS_INTENSIVOS', 'URGENCIAS', 'QUIRURGICO', 'HOSPITALIZACION', 'APOYO_DIAGNOSTICO', 'CONSULTA_EXTERNA');

-- CreateEnum
CREATE TYPE "EstadoCuadrante" AS ENUM ('BORRADOR', 'VALIDADO', 'PUBLICADO', 'CERRADO_NOMINA');

-- CreateEnum
CREATE TYPE "EstadoPermuta" AS ENUM ('PENDIENTE_PAR', 'PENDIENTE_SUPERVISOR', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "servicios" (
    "id" TEXT NOT NULL,
    "intranetId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoAsistencia" "TipoAsistencia" NOT NULL,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_profesionales" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "categorias_profesionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empleados" (
    "id" TEXT NOT NULL,
    "intranetId" TEXT,
    "documento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "horasSemanalesLey" INTEGER NOT NULL DEFAULT 42,
    "horasContratoMes" INTEGER NOT NULL DEFAULT 168,
    "servicioBaseId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,

    CONSTRAINT "empleados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_turno" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "horasOrdinarias" DOUBLE PRECISION NOT NULL,
    "horasDiurnas" DOUBLE PRECISION NOT NULL,
    "horasNocturnas" DOUBLE PRECISION NOT NULL,
    "colorHex" TEXT NOT NULL,
    "descuentaBancoHoras" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tipos_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requerimientos_cobertura" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "tipoTurnoId" TEXT NOT NULL,
    "cantidadMinima" INTEGER NOT NULL,
    "aplicaFestivoDom" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "requerimientos_cobertura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuadrantes" (
    "id" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "servicioId" TEXT NOT NULL,
    "estado" "EstadoCuadrante" NOT NULL DEFAULT 'BORRADOR',

    CONSTRAINT "cuadrantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asignaciones_turno" (
    "id" TEXT NOT NULL,
    "cuadranteId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "tipoTurnoId" TEXT NOT NULL,
    "servicioEjecutorId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "esRotacion" BOOLEAN NOT NULL DEFAULT false,
    "codigoPrevisto" TEXT,
    "hod" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hon" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hdfd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hdfn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hen" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "asignaciones_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banco_horas_saldos" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horasTrabajadas" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "horasContratadas" DOUBLE PRECISION NOT NULL DEFAULT 168,
    "horasAmortizadasComp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diferenciaMes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saldoFinalAcumulado" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banco_horas_saldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "festivos_colombia" (
    "id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "anio" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "esIrrenunciable" BOOLEAN NOT NULL DEFAULT true,
    "esOficialLey" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "festivos_colombia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "novedades_ausencia" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE NOT NULL,
    "codigoCie10" TEXT,

    CONSTRAINT "novedades_ausencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditorias_cambio" (
    "id" TEXT NOT NULL,
    "asignacionTurnoId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "turnoAnterior" TEXT NOT NULL,
    "turnoNuevo" TEXT NOT NULL,
    "justificacion" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditorias_cambio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_calendario" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_calendario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "servicios_intranetId_key" ON "servicios"("intranetId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_codigo_key" ON "servicios"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_profesionales_nombre_key" ON "categorias_profesionales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_intranetId_key" ON "empleados"("intranetId");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_documento_key" ON "empleados"("documento");

-- CreateIndex
CREATE INDEX "empleados_servicioBaseId_idx" ON "empleados"("servicioBaseId");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_turno_codigo_key" ON "tipos_turno"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cuadrantes_anio_mes_servicioId_key" ON "cuadrantes"("anio", "mes", "servicioId");

-- CreateIndex
CREATE INDEX "asignaciones_turno_cuadranteId_fecha_idx" ON "asignaciones_turno"("cuadranteId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "asignaciones_turno_empleadoId_fecha_key" ON "asignaciones_turno"("empleadoId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "banco_horas_saldos_empleadoId_anio_mes_key" ON "banco_horas_saldos"("empleadoId", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "festivos_colombia_fecha_key" ON "festivos_colombia"("fecha");

-- CreateIndex
CREATE INDEX "festivos_colombia_anio_idx" ON "festivos_colombia"("anio");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_calendario_tokenHash_key" ON "tokens_calendario"("tokenHash");

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_servicioBaseId_fkey" FOREIGN KEY ("servicioBaseId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos_cobertura" ADD CONSTRAINT "requerimientos_cobertura_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos_cobertura" ADD CONSTRAINT "requerimientos_cobertura_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos_cobertura" ADD CONSTRAINT "requerimientos_cobertura_tipoTurnoId_fkey" FOREIGN KEY ("tipoTurnoId") REFERENCES "tipos_turno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuadrantes" ADD CONSTRAINT "cuadrantes_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_turno" ADD CONSTRAINT "asignaciones_turno_cuadranteId_fkey" FOREIGN KEY ("cuadranteId") REFERENCES "cuadrantes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_turno" ADD CONSTRAINT "asignaciones_turno_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_turno" ADD CONSTRAINT "asignaciones_turno_tipoTurnoId_fkey" FOREIGN KEY ("tipoTurnoId") REFERENCES "tipos_turno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asignaciones_turno" ADD CONSTRAINT "asignaciones_turno_servicioEjecutorId_fkey" FOREIGN KEY ("servicioEjecutorId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banco_horas_saldos" ADD CONSTRAINT "banco_horas_saldos_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "novedades_ausencia" ADD CONSTRAINT "novedades_ausencia_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias_cambio" ADD CONSTRAINT "auditorias_cambio_asignacionTurnoId_fkey" FOREIGN KEY ("asignacionTurnoId") REFERENCES "asignaciones_turno"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_calendario" ADD CONSTRAINT "tokens_calendario_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
