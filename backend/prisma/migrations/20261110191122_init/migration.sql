-- CreateEnum
CREATE TYPE "EstadoCuadrante" AS ENUM ('BORRADOR', 'VALIDADO', 'PUBLICADO', 'CERRADO_NOMINA');

-- CreateEnum
CREATE TYPE "EstadoPermuta" AS ENUM ('PENDIENTE_PAR', 'PENDIENTE_SUPERVISOR', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "macroprocesos" (
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

-- CreateTable
CREATE TABLE "servicios" (
    "id" TEXT NOT NULL,
    "intranetId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "macroprocesoId" TEXT NOT NULL,
    "reqDia" INTEGER NOT NULL DEFAULT 4,
    "reqNoche" INTEGER NOT NULL DEFAULT 2,
    "modalidadDias" TEXT NOT NULL DEFAULT 'TODOS_24_7',
    "reqDiaDomFest" INTEGER NOT NULL DEFAULT 2,
    "reqNocheDomFest" INTEGER NOT NULL DEFAULT 1,
    "turnosHabilitadosCodigos" TEXT[] DEFAULT ARRAY['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC']::TEXT[],

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_hermanos" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "servicioHermanoId" TEXT NOT NULL,

    CONSTRAINT "servicios_hermanos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_turnos_habilitados" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "tipoTurnoId" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "servicios_turnos_habilitados_pkey" PRIMARY KEY ("id")
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
    "minutosAlmuerzo" INTEGER NOT NULL DEFAULT 0,
    "colorHex" TEXT NOT NULL,
    "descuentaBancoHoras" BOOLEAN NOT NULL DEFAULT false,
    "horasAmortizacionBanco" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "esNocturnoPesado" BOOLEAN NOT NULL DEFAULT false,
    "visibleEnPaleta" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tipos_turno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requerimientos_cobertura" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "categoriaId" TEXT NOT NULL,
    "reqDia" INTEGER NOT NULL DEFAULT 1,
    "reqNoche" INTEGER NOT NULL DEFAULT 0,
    "reqDiaDomFest" INTEGER NOT NULL DEFAULT 1,
    "reqNocheDomFest" INTEGER NOT NULL DEFAULT 0,

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
    "asignacionTurnoId" TEXT,
    "servicioId" TEXT,
    "empleadoId" TEXT,
    "actorId" TEXT NOT NULL,
    "tipoAccion" TEXT NOT NULL DEFAULT 'EDICION_TURNO',
    "turnoAnterior" TEXT,
    "turnoNuevo" TEXT,
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

-- CreateTable
CREATE TABLE "solicitudes_permuta" (
    "id" TEXT NOT NULL,
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "solicitanteId" TEXT NOT NULL,
    "receptorId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "diaOrigen" INTEGER NOT NULL,
    "turnoOrigen" TEXT NOT NULL,
    "diaDestino" INTEGER NOT NULL,
    "turnoDestino" TEXT NOT NULL,
    "estado" "EstadoPermuta" NOT NULL DEFAULT 'PENDIENTE_SUPERVISOR',
    "validacionReglas" TEXT NOT NULL,
    "motivoRechazo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitudes_permuta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "macroprocesos_codigo_key" ON "macroprocesos"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_intranetId_key" ON "servicios"("intranetId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_codigo_key" ON "servicios"("codigo");

-- CreateIndex
CREATE INDEX "servicios_macroprocesoId_idx" ON "servicios"("macroprocesoId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_hermanos_servicioId_servicioHermanoId_key" ON "servicios_hermanos"("servicioId", "servicioHermanoId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_turnos_habilitados_servicioId_categoriaId_tipoTur_key" ON "servicios_turnos_habilitados"("servicioId", "categoriaId", "tipoTurnoId");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_profesionales_nombre_key" ON "categorias_profesionales"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_intranetId_key" ON "empleados"("intranetId");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_documento_key" ON "empleados"("documento");

-- CreateIndex
CREATE INDEX "empleados_servicioBaseId_idx" ON "empleados"("servicioBaseId");

-- CreateIndex
CREATE INDEX "empleados_categoriaId_idx" ON "empleados"("categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_turno_codigo_key" ON "tipos_turno"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "requerimientos_cobertura_servicioId_categoriaId_key" ON "requerimientos_cobertura"("servicioId", "categoriaId");

-- CreateIndex
CREATE UNIQUE INDEX "cuadrantes_anio_mes_servicioId_key" ON "cuadrantes"("anio", "mes", "servicioId");

-- CreateIndex
CREATE INDEX "asignaciones_turno_cuadranteId_fecha_idx" ON "asignaciones_turno"("cuadranteId", "fecha");

-- CreateIndex
CREATE INDEX "asignaciones_turno_servicioEjecutorId_idx" ON "asignaciones_turno"("servicioEjecutorId");

-- CreateIndex
CREATE INDEX "asignaciones_turno_tipoTurnoId_idx" ON "asignaciones_turno"("tipoTurnoId");

-- CreateIndex
CREATE INDEX "asignaciones_turno_fecha_idx" ON "asignaciones_turno"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "asignaciones_turno_empleadoId_fecha_key" ON "asignaciones_turno"("empleadoId", "fecha");

-- CreateIndex
CREATE INDEX "banco_horas_saldos_anio_mes_idx" ON "banco_horas_saldos"("anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "banco_horas_saldos_empleadoId_anio_mes_key" ON "banco_horas_saldos"("empleadoId", "anio", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "festivos_colombia_fecha_key" ON "festivos_colombia"("fecha");

-- CreateIndex
CREATE INDEX "festivos_colombia_anio_idx" ON "festivos_colombia"("anio");

-- CreateIndex
CREATE INDEX "novedades_ausencia_empleadoId_idx" ON "novedades_ausencia"("empleadoId");

-- CreateIndex
CREATE INDEX "novedades_ausencia_fechaInicio_fechaFin_idx" ON "novedades_ausencia"("fechaInicio", "fechaFin");

-- CreateIndex
CREATE INDEX "novedades_ausencia_empleadoId_fechaInicio_fechaFin_idx" ON "novedades_ausencia"("empleadoId", "fechaInicio", "fechaFin");

-- CreateIndex
CREATE INDEX "auditorias_cambio_asignacionTurnoId_idx" ON "auditorias_cambio"("asignacionTurnoId");

-- CreateIndex
CREATE INDEX "auditorias_cambio_servicioId_idx" ON "auditorias_cambio"("servicioId");

-- CreateIndex
CREATE INDEX "auditorias_cambio_empleadoId_idx" ON "auditorias_cambio"("empleadoId");

-- CreateIndex
CREATE INDEX "auditorias_cambio_tipoAccion_idx" ON "auditorias_cambio"("tipoAccion");

-- CreateIndex
CREATE INDEX "auditorias_cambio_timestamp_idx" ON "auditorias_cambio"("timestamp");

-- CreateIndex
CREATE INDEX "auditorias_cambio_servicioId_timestamp_idx" ON "auditorias_cambio"("servicioId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_calendario_tokenHash_key" ON "tokens_calendario"("tokenHash");

-- CreateIndex
CREATE INDEX "tokens_calendario_empleadoId_activo_idx" ON "tokens_calendario"("empleadoId", "activo");

-- CreateIndex
CREATE INDEX "solicitudes_permuta_servicioId_idx" ON "solicitudes_permuta"("servicioId");

-- CreateIndex
CREATE INDEX "solicitudes_permuta_solicitanteId_idx" ON "solicitudes_permuta"("solicitanteId");

-- CreateIndex
CREATE INDEX "solicitudes_permuta_receptorId_idx" ON "solicitudes_permuta"("receptorId");

-- CreateIndex
CREATE INDEX "solicitudes_permuta_estado_idx" ON "solicitudes_permuta"("estado");

-- CreateIndex
CREATE INDEX "solicitudes_permuta_anio_mes_idx" ON "solicitudes_permuta"("anio", "mes");

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_macroprocesoId_fkey" FOREIGN KEY ("macroprocesoId") REFERENCES "macroprocesos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_hermanos" ADD CONSTRAINT "servicios_hermanos_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_hermanos" ADD CONSTRAINT "servicios_hermanos_servicioHermanoId_fkey" FOREIGN KEY ("servicioHermanoId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_turnos_habilitados" ADD CONSTRAINT "servicios_turnos_habilitados_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_turnos_habilitados" ADD CONSTRAINT "servicios_turnos_habilitados_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_turnos_habilitados" ADD CONSTRAINT "servicios_turnos_habilitados_tipoTurnoId_fkey" FOREIGN KEY ("tipoTurnoId") REFERENCES "tipos_turno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_servicioBaseId_fkey" FOREIGN KEY ("servicioBaseId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos_cobertura" ADD CONSTRAINT "requerimientos_cobertura_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requerimientos_cobertura" ADD CONSTRAINT "requerimientos_cobertura_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_profesionales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "auditorias_cambio" ADD CONSTRAINT "auditorias_cambio_asignacionTurnoId_fkey" FOREIGN KEY ("asignacionTurnoId") REFERENCES "asignaciones_turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias_cambio" ADD CONSTRAINT "auditorias_cambio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditorias_cambio" ADD CONSTRAINT "auditorias_cambio_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_calendario" ADD CONSTRAINT "tokens_calendario_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_permuta" ADD CONSTRAINT "solicitudes_permuta_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_permuta" ADD CONSTRAINT "solicitudes_permuta_receptorId_fkey" FOREIGN KEY ("receptorId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitudes_permuta" ADD CONSTRAINT "solicitudes_permuta_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
