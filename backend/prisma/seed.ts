import { PrismaClient } from '@prisma/client';
import {
  CATEGORIAS_SEED,
  DESCANSOS_ESTANDAR,
  EMPRESAS_SEED,
  MACROPROCESOS_SEED,
  PARES_HERMANOS_SEED,
  SERVICIOS_RECLASIFICADOS_SEED,
  TURNOS_SEED,
  asignarEmpresaCodigoDeterministico,
  calcularResumenDerivadoServicio,
  esTurnoNocturnoPorCodigo,
} from './catalogo-base';

const prisma = new PrismaClient();

async function main() {
  console.log('🏥 Iniciando siembra (Seed) de Rafa Turnos (Multi-Empresa + Servicios Homogéneos/Multi-Cargo)...');

  // 1. Limpieza ordenada respetando llaves foráneas
  await prisma.auditoriaCambio.deleteMany();
  await prisma.solicitudPermuta.deleteMany();
  await prisma.asignacionTurno.deleteMany();
  await prisma.bancoHorasSaldo.deleteMany();
  await prisma.novedadAusencia.deleteMany();
  await prisma.tokenCalendario.deleteMany();
  await prisma.servicioTurnoMeta.deleteMany();
  await prisma.servicioCargoPermitido.deleteMany();
  await prisma.servicioTurnoHabilitado.deleteMany();
  await prisma.requerimientoCobertura.deleteMany();
  await prisma.servicioHermano.deleteMany();
  await prisma.cuadrante.deleteMany();
  await prisma.empleado.deleteMany();
  await prisma.tipoTurno.deleteMany();
  await prisma.categoriaProfesional.deleteMany();
  await prisma.servicio.deleteMany();
  await prisma.macroproceso.deleteMany();
  await prisma.festivoColombia.deleteMany();
  await prisma.empresaContratante.deleteMany();

  console.log('🧹 Base de datos reseteada.');

  // 1.1 Empresas Contratantes (3 regímenes piloto)
  const mapEmpresas = new Map<string, (typeof EMPRESAS_SEED)[number]>();
  for (const empDef of EMPRESAS_SEED) {
    await prisma.empresaContratante.create({ data: empDef });
    mapEmpresas.set(empDef.codigo, empDef);
  }
  console.log(`✅ ${EMPRESAS_SEED.length} Empresas Contratantes sembradas (ESE_PLANTA, TEMP_SALUD, COOP_SERV).`);

  // 1.5 Macroprocesos del Mapa de Procesos (Intranet -> PostgreSQL)
  for (const m of MACROPROCESOS_SEED) {
    await prisma.macroproceso.create({ data: m });
  }
  console.log(`✅ ${MACROPROCESOS_SEED.length} Macroprocesos del Mapa de Procesos creados.`);

  // 2. Categorías Profesionales (Cargos)
  const mapCategorias: Record<string, string> = {};
  for (const nombre of CATEGORIAS_SEED) {
    const cat = await prisma.categoriaProfesional.create({ data: { nombre } });
    mapCategorias[nombre] = cat.id;
  }
  console.log(`✅ ${CATEGORIAS_SEED.length} Categorías Profesionales creadas.`);

  // 3. Catálogo Maestro de Turnos (incluye 8 obligatorios protegidos)
  const mapTiposTurno: Record<string, string> = {};
  for (const t of TURNOS_SEED) {
    const creado = await prisma.tipoTurno.create({ data: t });
    mapTiposTurno[t.codigo] = creado.id;
  }
  console.log(`✅ ${TURNOS_SEED.length} Tipos de Turno registrados.`);

  // 4. Servicios Reclasificados (Homogéneos y Multi-Cargo Equivalentes) + Cargos Permitidos + Metas por Turno
  for (const srvDef of SERVICIOS_RECLASIFICADOS_SEED) {
    const resumen = calcularResumenDerivadoServicio(srvDef.metasTurnos);
    const turnosCodigos = Array.from(
      new Set([
        ...srvDef.metasTurnos.filter((m) => m.habilitado).map((m) => m.codigoTurno),
        ...(srvDef.descansosHabilitados || DESCANSOS_ESTANDAR),
      ])
    );

    await prisma.servicio.create({
      data: {
        id: srvDef.id,
        codigo: srvDef.codigo,
        nombre: srvDef.nombre,
        macroprocesoId: srvDef.macroprocesoId,
        modalidadDias: srvDef.modalidadDias,
        permitePermutaEntreCargos: srvDef.permitePermutaEntreCargos,
        reqDia: resumen.reqDia,
        reqNoche: resumen.reqNoche,
        reqDiaDomFest: resumen.reqDiaDomFest,
        reqNocheDomFest: resumen.reqNocheDomFest,
        turnosHabilitadosCodigos: turnosCodigos,
      },
    });

    for (const cargoNombre of srvDef.cargosPermitidos) {
      const catId = mapCategorias[cargoNombre];
      if (!catId) continue;
      await prisma.servicioCargoPermitido.create({
        data: { servicioId: srvDef.id, categoriaId: catId },
      });

      // Compatibilidad legacy temporal mientras se migra frontend/backend en Fases 3 y 4
      await prisma.requerimientoCobertura.create({
        data: {
          servicioId: srvDef.id,
          categoriaId: catId,
          reqDia: resumen.reqDia,
          reqNoche: resumen.reqNoche,
          reqDiaDomFest: resumen.reqDiaDomFest,
          reqNocheDomFest: resumen.reqNocheDomFest,
        },
      });
      const filasLegacy = turnosCodigos
        .filter((cod) => mapTiposTurno[cod])
        .map((cod) => ({
          servicioId: srvDef.id,
          categoriaId: catId,
          tipoTurnoId: mapTiposTurno[cod],
          habilitado: true,
        }));
      if (filasLegacy.length > 0) {
        await prisma.servicioTurnoHabilitado.createMany({ data: filasLegacy, skipDuplicates: true });
      }
    }

    for (const meta of srvDef.metasTurnos) {
      const tipoTurnoId = mapTiposTurno[meta.codigoTurno];
      if (!tipoTurnoId) continue;
      await prisma.servicioTurnoMeta.create({
        data: {
          servicioId: srvDef.id,
          tipoTurnoId,
          habilitado: meta.habilitado,
          minimoBase: Math.min(meta.minimoBase, meta.esperadoBase),
          esperadoBase: Math.max(meta.minimoBase, meta.esperadoBase),
          minimoDomFest: Math.min(meta.minimoDomFest, meta.esperadoDomFest),
          esperadoDomFest: Math.max(meta.minimoDomFest, meta.esperadoDomFest),
        },
      });
    }
  }
  console.log(`✅ ${SERVICIOS_RECLASIFICADOS_SEED.length} Servicios homogéneos/equivalentes creados con metas por turno.`);

  // 5. Festivos de Colombia 2026
  const festivos2026 = [
    { fecha: new Date('2026-01-01'), anio: 2026, nombre: 'Año Nuevo' },
    { fecha: new Date('2026-01-12'), anio: 2026, nombre: 'Día de los Reyes Magos' },
    { fecha: new Date('2026-03-23'), anio: 2026, nombre: 'Día de San José' },
    { fecha: new Date('2026-04-02'), anio: 2026, nombre: 'Jueves Santo' },
    { fecha: new Date('2026-04-03'), anio: 2026, nombre: 'Viernes Santo' },
    { fecha: new Date('2026-05-01'), anio: 2026, nombre: 'Día del Trabajo' },
    { fecha: new Date('2026-05-18'), anio: 2026, nombre: 'Ascensión del Señor' },
    { fecha: new Date('2026-06-08'), anio: 2026, nombre: 'Corpus Christi' },
    { fecha: new Date('2026-06-15'), anio: 2026, nombre: 'Sagrado Corazón de Jesús' },
    { fecha: new Date('2026-06-29'), anio: 2026, nombre: 'San Pedro y San Pablo' },
    { fecha: new Date('2026-07-20'), anio: 2026, nombre: 'Día de la Independencia' },
    { fecha: new Date('2026-08-07'), anio: 2026, nombre: 'Batalla de Boyacá' },
    { fecha: new Date('2026-08-17'), anio: 2026, nombre: 'Asunción de la Virgen' },
    { fecha: new Date('2026-10-12'), anio: 2026, nombre: 'Día de la Raza' },
    { fecha: new Date('2026-11-02'), anio: 2026, nombre: 'Todos los Santos' },
    { fecha: new Date('2026-11-16'), anio: 2026, nombre: 'Independencia de Cartagena' },
    { fecha: new Date('2026-12-08'), anio: 2026, nombre: 'Inmaculada Concepción' },
    { fecha: new Date('2026-12-25'), anio: 2026, nombre: 'Navidad' },
  ];
  for (const f of festivos2026) {
    await prisma.festivoColombia.create({ data: { ...f, esIrrenunciable: true, esOficialLey: true } });
  }
  console.log(`✅ 18 Festivos Oficiales de Colombia 2026 grabados en PostgreSQL.`);

  // 6. Plantilla de colaboradores repartida entre ESE_PLANTA, TEMP_SALUD y COOP_SERV
  const nombresHombres = [
    'Carlos', 'Andrés', 'Jorge', 'Mateo', 'Alejandro', 'Julián', 'Felipe', 'Santiago',
    'David', 'Gabriel', 'Daniel', 'Camilo', 'Mauricio', 'Fernando', 'Ricardo', 'Esteban',
    'Sebastián', 'Nicolás', 'Diego', 'Álvaro', 'Rodrigo', 'Gustavo', 'Héctor', 'Iván',
    'Javier', 'Leonardo', 'Manuel', 'Óscar', 'Pablo', 'Raúl', 'Alfonso', 'Bernardo',
    'César', 'Edgar', 'Fabio', 'Germán', 'Hugo', 'Jaime', 'Mario', 'Orlando',
  ];
  const nombresMujeres = [
    'Diana', 'Laura', 'Paola', 'Valentina', 'Sofía', 'Natalia', 'Marcela', 'Carolina',
    'Daniela', 'Mariana', 'Claudia', 'Sandra', 'Adriana', 'Lucía', 'Patricia', 'Andrea',
    'Camila', 'Esperanza', 'Gloria', 'Helena', 'Isabel', 'Juana', 'Lina', 'Mónica',
    'Olga', 'Pilar', 'Rosa', 'Silvia', 'Teresa', 'Yolanda', 'Beatriz', 'Carmen',
    'Clara', 'Consuelo', 'Elena', 'Inés', 'Ligia', 'Luz', 'Mercedes', 'Rocío',
  ];
  const apellidos = [
    'Mora', 'López', 'Ruiz', 'Vargas', 'Gómez', 'Pineda', 'Castro', 'Mejía', 'Ríos',
    'Aristizábal', 'Jiménez', 'Salazar', 'Mendoza', 'Patiño', 'Restrepo', 'Ospina',
    'Cardona', 'Montoya', 'Giraldo', 'Zapata', 'Herrera', 'Gutiérrez', 'Cárdenas',
    'Duque', 'Flórez', 'Valencia', 'Botero', 'Muñoz', 'Guerrero', 'Navarro', 'Aguilar',
    'Bedoya', 'Buitrago', 'Castillo', 'Echeverri', 'Franco', 'Henao', 'Londoño', 'Marín',
    'Ocampo', 'Quintero', 'Ramírez', 'Sánchez', 'Torres', 'Uribe', 'Vélez', 'Villegas',
  ];

  let cedulaBase = 1010001001;
  let contadorTotal = 0;
  const nombresUsados = new Set<string>();
  let mIdx = 0;
  let hIdx = 0;
  let a1Idx = 0;
  let a2Idx = 1;

  for (const srvDef of SERVICIOS_RECLASIFICADOS_SEED) {
    for (const dot of srvDef.dotacionSeed) {
      const catId = mapCategorias[dot.cargo];
      for (let i = 0; i < dot.cantidad; i++) {
        contadorTotal++;
        const esMujer = contadorTotal % 2 === 0;
        let nombreCompleto = '';
        let nombrePila = '';
        let apellido1 = '';

        while (true) {
          nombrePila = esMujer
            ? nombresMujeres[mIdx % nombresMujeres.length]
            : nombresHombres[hIdx % nombresHombres.length];
          apellido1 = apellidos[a1Idx % apellidos.length];
          const apellido2 = apellidos[a2Idx % apellidos.length];

          if (esMujer) mIdx++;
          else hIdx++;
          a1Idx = (a1Idx + 3) % apellidos.length;
          a2Idx = (a2Idx + 7) % apellidos.length;
          if (a1Idx === a2Idx) a2Idx = (a2Idx + 1) % apellidos.length;

          const prefijo = dot.cargo.includes('Médico') ? (esMujer ? 'Dra. ' : 'Dr. ') : dot.cargo.includes('Jefe') ? 'Enf. ' : '';
          nombreCompleto = `${prefijo}${nombrePila} ${apellido1} ${apellido2}`;

          if (!nombresUsados.has(nombreCompleto)) {
            nombresUsados.add(nombreCompleto);
            break;
          }
        }

        const doc = String(cedulaBase++);
        const empCod = asignarEmpresaCodigoDeterministico(doc, contadorTotal);
        const empCfg = mapEmpresas.get(empCod) || EMPRESAS_SEED[1];
        const horasSem = empCfg.horasSemanalesContrato;
        // Octubre 2026 tiene 26 días hábiles (!domingo && !festivo; 4 domingos + 1 festivo 12-oct)
        const diasHabilesOct2026 = 26;
        const metaNominalOct = Math.round(((diasHabilesOct2026 * horasSem) / 6) * 100) / 100;

        const slugPila = nombrePila.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const slugAp = apellido1.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const emp = await prisma.empleado.create({
          data: {
            documento: doc,
            nombre: nombreCompleto,
            correo: `${slugPila}.${slugAp}${contadorTotal}@hospital.gov.co`,
            empresaContratanteId: empCfg.id,
            horasSemanalesLey: Math.round(horasSem),
            horasContratoMes: Math.round(metaNominalOct),
            servicioBaseId: srvDef.id,
            categoriaId: catId,
          },
        });

        await prisma.bancoHorasSaldo.create({
          data: {
            empleadoId: emp.id,
            anio: 2026,
            mes: 10,
            saldoInicial: 0,
            horasTrabajadas: metaNominalOct,
            horasContratadasNominales: metaNominalOct,
            horasExoneradas: 0,
            horasContratadas: metaNominalOct,
            diasHabilesMes: diasHabilesOct2026,
            diasHabilesProrrateados: 0,
            horasSemanalesAplicadas: horasSem,
            empresaCodigoSnapshot: empCfg.codigo,
            horasAmortizadasComp: 0,
            diferenciaMes: 0,
            saldoFinalAcumulado: 0,
          },
        });
      }
    }
  }

  // 7. Enlaces de Servicios Hermanos entre unidades con cargos compatibles
  for (const [a, b] of PARES_HERMANOS_SEED) {
    await prisma.servicioHermano.createMany({
      data: [
        { servicioId: a, servicioHermanoId: b },
        { servicioId: b, servicioHermanoId: a },
      ],
      skipDuplicates: true,
    });
  }

  // Nota informativa de turnos nocturnos para verificaciones
  void esTurnoNocturnoPorCodigo;

  console.log(`🎉 ¡ÉXITO! ${contadorTotal} colaboradores creados across 3 empresas, con cargos permitidos y metas por turno.`);
}

main()
  .catch((e) => {
    console.error('❌ Error en el Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
