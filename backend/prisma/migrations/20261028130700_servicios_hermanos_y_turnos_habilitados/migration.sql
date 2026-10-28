-- AlterTable
ALTER TABLE "tipos_turno" ADD COLUMN     "esNocturnoPesado" BOOLEAN NOT NULL DEFAULT false;

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

-- CreateIndex
CREATE UNIQUE INDEX "servicios_hermanos_servicioId_servicioHermanoId_key" ON "servicios_hermanos"("servicioId", "servicioHermanoId");

-- CreateIndex
CREATE UNIQUE INDEX "servicios_turnos_habilitados_servicioId_categoriaId_tipoTur_key" ON "servicios_turnos_habilitados"("servicioId", "categoriaId", "tipoTurnoId");

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
