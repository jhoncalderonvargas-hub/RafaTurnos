import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🏥 Iniciando siembra (Seed) de Rafa Turnos para Hospital Nivel II / III...');

  // 1. Limpieza ordenada (respetando llaves foráneas) para no duplicar datos
  await prisma.auditoriaCambio.deleteMany();
  await prisma.solicitudPermuta.deleteMany();
  await prisma.asignacionTurno.deleteMany();
  await prisma.bancoHorasSaldo.deleteMany();
  await prisma.novedadAusencia.deleteMany();
  await prisma.tokenCalendario.deleteMany();
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

  console.log('🧹 Base de datos reseteada.');

  // 1.5 Macroprocesos del Mapa de Procesos (Intranet -> PostgreSQL)
  const macroprocesosData = [
    { id: 'mp-urgencias', codigo: 'URGENCIAS', nombre: 'Atención de Urgencias y Emergencias', nombreCorto: 'Urgencias y Emergencias', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🚨', orden: 1, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'ROTATIVO_8H' },
    { id: 'mp-cuidados-intensivos', codigo: 'CUIDADOS_INTENSIVOS', nombre: 'Cuidado Crítico e Intensivo (UCI / UCIM)', nombreCorto: 'Cuidado Crítico (UCI)', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '💓', orden: 2, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'GUARDIAS_12_24' },
    { id: 'mp-hospitalizacion', codigo: 'HOSPITALIZACION', nombre: 'Hospitalización e Internación', nombreCorto: 'Hospitalización', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🛏️', orden: 3, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'ROTATIVO_8H' },
    { id: 'mp-quirurgico', codigo: 'QUIRURGICO', nombre: 'Atención Quirúrgica y Esterilización', nombreCorto: 'Quirúrgico y Cirugía', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🔪', orden: 4, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'GUARDIAS_12_24' },
    { id: 'mp-apoyo-diagnostico', codigo: 'APOYO_DIAGNOSTICO', nombre: 'Apoyo Diagnóstico y Terapéutico', nombreCorto: 'Apoyo Diagnóstico', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🔬', orden: 5, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'ROTATIVO_8H' },
    { id: 'mp-consulta-externa', codigo: 'CONSULTA_EXTERNA', nombre: 'Consulta Externa y Ambulatoria', nombreCorto: 'Consulta Externa', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🩺', orden: 6, modalidadSugerida: 'LUN_SAB_SIN_FESTIVOS', plantillaTurnosSugerida: 'ADMINISTRATIVO' },
    { id: 'mp-administrativo', codigo: 'ADMINISTRATIVO', nombre: 'Gestión Financiera, Facturación y Admisiones', nombreCorto: 'Administrativo y Admisiones', tipoProceso: 'APOYO_ADMINISTRATIVO', icono: '🏛️', orden: 7, modalidadSugerida: 'LUN_VIE_HABILES', plantillaTurnosSugerida: 'ADMINISTRATIVO' },
    { id: 'mp-apoyo-operativo', codigo: 'APOYO_OPERATIVO', nombre: 'Apoyo Operativo, Logística y Mantenimiento', nombreCorto: 'Apoyo Operativo y Logística', tipoProceso: 'APOYO_OPERATIVO', icono: '🛠️', orden: 8, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'ROTATIVO_8H' },
  ];

  for (const m of macroprocesosData) {
    await prisma.macroproceso.create({ data: m });
  }
  console.log(`✅ ${macroprocesosData.length} Macroprocesos del Mapa de Procesos creados.`);

  // 2. Servicios Hospitalarios (14 Servicios agrupados por Macroproceso)
  const TURNOS_BASE_TODOS = ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'];
  const serviciosData = [
    // Bloque Urgencias y Críticos
    { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias Generales y Reanimación', macroprocesoId: 'mp-urgencias', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },
    { id: 'srv-mat', codigo: 'MAT', nombre: 'Maternidad y Salas de Parto', macroprocesoId: 'mp-urgencias', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },
    { id: 'srv-ped', codigo: 'PED', nombre: 'Pediatría y Observación Pediátrica', macroprocesoId: 'mp-urgencias', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },

    // Bloque Quirúrgico
    { id: 'srv-cir', codigo: 'CIR', nombre: 'Cirugía / Quirófanos y Recuperación', macroprocesoId: 'mp-quirurgico', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },

    // Bloque Hospitalización, Cuidado Crítico y Consulta Externa
    { id: 'srv-hosp', codigo: 'HOSP', nombre: 'Hospitalización Pisos', macroprocesoId: 'mp-hospitalizacion', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },
    { id: 'srv-med-int', codigo: 'MED-INT', nombre: 'Medicina Interna (Cuidados Intermedios)', macroprocesoId: 'mp-cuidados-intensivos', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },
    { id: 'srv-med-gral', codigo: 'MED-GRAL', nombre: 'Medicina General y Consulta Externa', macroprocesoId: 'mp-consulta-externa', modalidadDias: 'LUN_SAB_SIN_FESTIVOS', turnosHabilitadosCodigos: ['M8', 'T8', 'M6', 'T6', 'ADM', 'MD', 'AP', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },

    // Bloque Apoyo Diagnóstico
    { id: 'srv-lab-img', codigo: 'LAB-IMG', nombre: 'Laboratorio Clínico e Imágenes Diagnósticas', macroprocesoId: 'mp-apoyo-diagnostico', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },

    // Bloque Farmacia
    { id: 'srv-farm', codigo: 'FARM', nombre: 'Servicio Farmacéutico Hospitalario', macroprocesoId: 'mp-apoyo-diagnostico', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: TURNOS_BASE_TODOS },

    // Bloque Facturación y Admisiones
    { id: 'srv-fact-urg', codigo: 'FACT-URG', nombre: 'Facturación y Admisiones Urgencias (24/7)', macroprocesoId: 'mp-administrativo', modalidadDias: 'TODOS_24_7', turnosHabilitadosCodigos: ['M8', 'T8', 'N8', 'N12', 'D12', 'ADM', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },
    { id: 'srv-fact-cen', codigo: 'FACT-CEN', nombre: 'Facturación Central y Cartera', macroprocesoId: 'mp-administrativo', modalidadDias: 'LUN_VIE_HABILES', turnosHabilitadosCodigos: ['ADM', 'M8', 'T8', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },

    // Bloque Operaciones y Logística
    { id: 'srv-cond', codigo: 'COND', nombre: 'Conductores de Ambulancia y Traslados', macroprocesoId: 'mp-apoyo-operativo', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: ['M8', 'T8', 'N8', 'D12', 'N12', 'DISP', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },
    { id: 'srv-of-var', codigo: 'OF-VAR', nombre: 'Oficios Varios y Desinfección Hospitalaria', macroprocesoId: 'mp-apoyo-operativo', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: ['M8', 'T8', 'N8', 'M6', 'T6', 'ADM', 'MD', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },
    { id: 'srv-mant', codigo: 'MANT', nombre: 'Mantenimiento Hospitalario y Biomédica', macroprocesoId: 'mp-apoyo-operativo', modalidadDias: 'TODOS_GUARDIA_FDS', turnosHabilitadosCodigos: ['M8', 'T8', 'N8', 'M6', 'T6', 'ADM', 'MD', 'DISP', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'] },
  ];

  for (const s of serviciosData) {
    await prisma.servicio.create({ data: s });
  }
  console.log(`✅ ${serviciosData.length} Servicios Hospitalarios creados.`);

  // 3. Categorías Profesionales (14 Cargos Hospitalarios)
  const categoriasNombres = [
    'Médico Cirujano (Especialista)',
    'Médico Anestesiólogo',
    'Médico Especialista (Pediatra/Ginecólogo/Internista)',
    'Médico General',
    'Enfermero(a) Jefe',
    'Auxiliar de Enfermería',
    'Instrumentador(a) Quirúrgico(a)',
    'Bacteriólogo(a)',
    'Auxiliar de Laboratorio Clínico',
    'Tecnólogo(a) en Imágenes Diagnósticas',
    'Químico Farmacéutico / Regente de Farmacia',
    'Auxiliar de Farmacia',
    'Auxiliar de Facturación y Admisiones',
    'Conductor de Ambulancia',
    'Operario de Oficios Varios / Aseo',
    'Técnico de Mantenimiento',
  ];

  const mapCategorias: Record<string, string> = {};
  for (const nombre of categoriasNombres) {
    const cat = await prisma.categoriaProfesional.create({ data: { nombre } });
    mapCategorias[nombre] = cat.id;
  }
  console.log(`✅ ${categoriasNombres.length} Categorías Profesionales creadas.`);

  // 4. Catálogo Maestro Ampliado de Turnos (16 tipos de turno)
  const turnosData = [
    // Rotativo 8h
    { codigo: 'M8', nombre: 'Mañana 8h', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#E0F2FE', descuentaBancoHoras: false },
    { codigo: 'T8', nombre: 'Tarde 8h', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 4, horasNocturnas: 4, colorHex: '#FEF3C7', descuentaBancoHoras: false },
    { codigo: 'N8', nombre: 'Noche 8h', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, colorHex: '#EDE9FE', descuentaBancoHoras: false, esNocturnoPesado: false },

    // Rotativo 6h / 12h
    { codigo: 'M6', nombre: 'Mañana 6h', horaInicio: '07:00', horaFin: '13:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, colorHex: '#BAE6FD', descuentaBancoHoras: false },
    { codigo: 'T6', nombre: 'Tarde 6h', horaInicio: '13:00', horaFin: '19:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, colorHex: '#FDE68A', descuentaBancoHoras: false },
    { codigo: 'N12', nombre: 'Noche 12h', horaInicio: '19:00', horaFin: '07:00', horasOrdinarias: 12, horasDiurnas: 1, horasNocturnas: 11, colorHex: '#DDD6FE', descuentaBancoHoras: false, esNocturnoPesado: false },

    // Guardias y Corridos
    { codigo: 'D12', nombre: 'Guardia Diurna 12h', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, colorHex: '#FFEDD5', descuentaBancoHoras: false },
    { codigo: 'G24', nombre: 'Guardia Médica 24h', horaInicio: '07:00', horaFin: '07:00', horasOrdinarias: 24, horasDiurnas: 13, horasNocturnas: 11, colorHex: '#FEE2E2', descuentaBancoHoras: false, esNocturnoPesado: true },

    // Administrativos y Horas Pico (ADM: 08:00-17:00 con 60 min almuerzo Art. 167 CST = 8h netas)
    { codigo: 'ADM', nombre: 'Administrativo Oficina 8h', horaInicio: '08:00', horaFin: '17:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 60, colorHex: '#F3F4F6', descuentaBancoHoras: false },
    { codigo: 'MD', nombre: 'Madrugada / Apertura 8h', horaInicio: '06:00', horaFin: '14:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#E2E8F0', descuentaBancoHoras: false },
    { codigo: 'AP', nombre: 'Refuerzo Horas Pico 8h', horaInicio: '10:00', horaFin: '18:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#CFFAFE', descuentaBancoHoras: false },
    { codigo: 'DISP', nombre: 'Disponibilidad / Retén', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FEF9C3', descuentaBancoHoras: false, visibleEnPaleta: false },

    // Descansos, Banco y Novedades
    { codigo: 'S', nombre: 'Saliente de Guardia', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#ECFEFF', descuentaBancoHoras: false },
    { codigo: 'L', nombre: 'Libre Programado', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#F8FAFC', descuentaBancoHoras: false },
    { codigo: 'BLANCO', nombre: 'Celda en Blanco (Sin asignar)', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FFFFFF', descuentaBancoHoras: false, visibleEnPaleta: false },
    { codigo: 'COMP', nombre: 'Compensatorio Banco de Horas', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#CCFBF1', descuentaBancoHoras: true, horasAmortizacionBanco: 8 },
    { codigo: 'FAM', nombre: 'Día de la Familia (Ley 1857 / Exonerado a 42h)', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FCE7F3', descuentaBancoHoras: false },
    { codigo: 'VAC', nombre: 'Vacaciones RRHH', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#D1FAE5', descuentaBancoHoras: false },
    { codigo: 'INC', nombre: 'Incapacidad Médica', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FCE7F3', descuentaBancoHoras: false },
    { codigo: 'LIC', nombre: 'Licencia Remunerada / Luto / Maternidad', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#E0E7FF', descuentaBancoHoras: false },
  ];

  const mapTiposTurno: Record<string, string> = {};
  for (const t of turnosData) {
    const creado = await prisma.tipoTurno.create({ data: t });
    mapTiposTurno[t.codigo] = creado.id;
  }
  console.log(`✅ ${turnosData.length} Tipos de Turno registrados con recargos CST.`);

  // 5. Festivos de Colombia 2026 (Algoritmo Oficial)
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

  // 6. Generación de Plantilla Solvente (~150 Empleados reales con Banco de Horas)
  console.log('👥 Generando plantilla solvente de ~150 colaboradores hospitalarios...');

  const nombresHombres = [
    'Carlos', 'Andrés', 'Jorge', 'Mateo', 'Alejandro', 'Julián', 'Felipe', 'Santiago', 
    'David', 'Gabriel', 'Daniel', 'Camilo', 'Mauricio', 'Fernando', 'Ricardo', 'Esteban',
    'Sebastián', 'Nicolás', 'Diego', 'Álvaro', 'Rodrigo', 'Gustavo', 'Héctor', 'Iván',
    'Javier', 'Leonardo', 'Manuel', 'Óscar', 'Pablo', 'Raúl', 'Alfonso', 'Bernardo',
    'César', 'Edgar', 'Fabio', 'Germán', 'Hugo', 'Jaime', 'Mario', 'Orlando'
  ];
  const nombresMujeres = [
    'Diana', 'Laura', 'Paola', 'Valentina', 'Sofía', 'Natalia', 'Marcela', 'Carolina', 
    'Daniela', 'Mariana', 'Claudia', 'Sandra', 'Adriana', 'Lucía', 'Patricia', 'Andrea',
    'Camila', 'Esperanza', 'Gloria', 'Helena', 'Isabel', 'Juana', 'Lina', 'Mónica',
    'Olga', 'Pilar', 'Rosa', 'Silvia', 'Teresa', 'Yolanda', 'Beatriz', 'Carmen',
    'Clara', 'Consuelo', 'Elena', 'Inés', 'Ligia', 'Luz', 'Mercedes', 'Rocío'
  ];
  const apellidos = [
    'Mora', 'López', 'Ruiz', 'Vargas', 'Gómez', 'Pineda', 'Castro', 'Mejía', 'Ríos', 
    'Aristizábal', 'Jiménez', 'Salazar', 'Mendoza', 'Patiño', 'Restrepo', 'Ospina', 
    'Cardona', 'Montoya', 'Giraldo', 'Zapata', 'Herrera', 'Gutiérrez', 'Cárdenas', 
    'Duque', 'Flórez', 'Valencia', 'Botero', 'Muñoz', 'Guerrero', 'Navarro', 'Aguilar',
    'Bedoya', 'Buitrago', 'Castillo', 'Echeverri', 'Franco', 'Henao', 'Londoño', 'Marín',
    'Ocampo', 'Quintero', 'Ramírez', 'Sánchez', 'Torres', 'Uribe', 'Vélez', 'Villegas'
  ];

  let cedulaBase = 1010001001;
  let contadorTotal = 0;
  const nombresUsados = new Set<string>();
  let mIdx = 0;
  let hIdx = 0;
  let a1Idx = 0;
  let a2Idx = 1;

  // Plan de dotación solvente por servicio
  const dotaciones = [
    { srvId: 'srv-urg', cargo: 'Médico General', cantidad: 4 },
    { srvId: 'srv-urg', cargo: 'Enfermero(a) Jefe', cantidad: 4 },
    { srvId: 'srv-urg', cargo: 'Auxiliar de Enfermería', cantidad: 14 },

    { srvId: 'srv-cir', cargo: 'Médico Cirujano (Especialista)', cantidad: 3 },
    { srvId: 'srv-cir', cargo: 'Médico Anestesiólogo', cantidad: 3 },
    { srvId: 'srv-cir', cargo: 'Instrumentador(a) Quirúrgico(a)', cantidad: 4 },
    { srvId: 'srv-cir', cargo: 'Enfermero(a) Jefe', cantidad: 2 },
    { srvId: 'srv-cir', cargo: 'Auxiliar de Enfermería', cantidad: 4 },

    { srvId: 'srv-hosp', cargo: 'Médico General', cantidad: 3 },
    { srvId: 'srv-hosp', cargo: 'Enfermero(a) Jefe', cantidad: 4 },
    { srvId: 'srv-hosp', cargo: 'Auxiliar de Enfermería', cantidad: 11 },

    { srvId: 'srv-mat', cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 3 },
    { srvId: 'srv-mat', cargo: 'Enfermero(a) Jefe', cantidad: 3 },
    { srvId: 'srv-mat', cargo: 'Auxiliar de Enfermería', cantidad: 6 },

    { srvId: 'srv-ped', cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 3 },
    { srvId: 'srv-ped', cargo: 'Enfermero(a) Jefe', cantidad: 2 },
    { srvId: 'srv-ped', cargo: 'Auxiliar de Enfermería', cantidad: 5 },

    { srvId: 'srv-med-int', cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 2 },
    { srvId: 'srv-med-int', cargo: 'Enfermero(a) Jefe', cantidad: 2 },
    { srvId: 'srv-med-int', cargo: 'Auxiliar de Enfermería', cantidad: 6 },

    { srvId: 'srv-med-gral', cargo: 'Médico General', cantidad: 6 },

    { srvId: 'srv-lab-img', cargo: 'Bacteriólogo(a)', cantidad: 4 },
    { srvId: 'srv-lab-img', cargo: 'Auxiliar de Laboratorio Clínico', cantidad: 5 },
    { srvId: 'srv-lab-img', cargo: 'Tecnólogo(a) en Imágenes Diagnósticas', cantidad: 3 },

    { srvId: 'srv-farm', cargo: 'Químico Farmacéutico / Regente de Farmacia', cantidad: 3 },
    { srvId: 'srv-farm', cargo: 'Auxiliar de Farmacia', cantidad: 5 },

    { srvId: 'srv-fact-urg', cargo: 'Auxiliar de Facturación y Admisiones', cantidad: 5 },
    { srvId: 'srv-fact-cen', cargo: 'Auxiliar de Facturación y Admisiones', cantidad: 4 },

    { srvId: 'srv-cond', cargo: 'Conductor de Ambulancia', cantidad: 8 },

    { srvId: 'srv-of-var', cargo: 'Operario de Oficios Varios / Aseo', cantidad: 12 },

    { srvId: 'srv-mant', cargo: 'Técnico de Mantenimiento', cantidad: 4 },
  ];

  for (const dot of dotaciones) {
    const catId = mapCategorias[dot.cargo];
    for (let i = 0; i < dot.cantidad; i++) {
      contadorTotal++;
      const esMujer = (contadorTotal % 2 === 0);
      let nombreCompleto = '';
      let nombrePila = '';
      let apellido1 = '';

      while (true) {
        nombrePila = esMujer
          ? nombresMujeres[mIdx % nombresMujeres.length]
          : nombresHombres[hIdx % nombresHombres.length];
        apellido1 = apellidos[a1Idx % apellidos.length];
        const apellido2 = apellidos[a2Idx % apellidos.length];

        if (esMujer) mIdx++; else hIdx++;
        a1Idx = (a1Idx + 3) % apellidos.length;
        a2Idx = (a2Idx + 7) % apellidos.length;
        if (a1Idx === a2Idx) a2Idx = (a2Idx + 1) % apellidos.length;

        const prefijo = dot.cargo.includes('Médico') ? (esMujer ? 'Dra. ' : 'Dr. ') : (dot.cargo.includes('Jefe') ? 'Enf. ' : '');
        nombreCompleto = `${prefijo}${nombrePila} ${apellido1} ${apellido2}`;

        if (!nombresUsados.has(nombreCompleto)) {
          nombresUsados.add(nombreCompleto);
          break;
        }
      }

      const doc = String(cedulaBase++);
      const slugPila = nombrePila.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const slugAp = apellido1.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      const emp = await prisma.empleado.create({
        data: {
          documento: doc,
          nombre: nombreCompleto,
          correo: `${slugPila}.${slugAp}${contadorTotal}@hospital.gov.co`,
          horasSemanalesLey: 42,
          horasContratoMes: 168,
          servicioBaseId: dot.srvId,
          categoriaId: catId,
        },
      });

      // Crear saldo inicial del Banco de Horas arrastrado del mes previo (Doc 18)
      await prisma.bancoHorasSaldo.create({
        data: {
          empleadoId: emp.id,
          anio: 2026,
          mes: 10, // Cierre del mes anterior
          saldoInicial: 0,
          horasTrabajadas: 168,
          horasContratadas: 168,
          horasAmortizadasComp: 0,
          diferenciaMes: 0,
          saldoFinalAcumulado: 0,
        },
      });
    }
  }

  // 7. Reglas de Cobertura (Día / Noche Lun-Sáb y Dom/Fest) y Turnos Habilitados por Servicio × Cargo
  const totalesPorServicio = new Map<string, { reqDia: number; reqNoche: number; reqDiaDomFest: number; reqNocheDomFest: number }>();
  const mapaServiciosSeed = new Map(serviciosData.map((s) => [s.id, s]));

  for (const dot of dotaciones) {
    const srvCfg = mapaServiciosSeed.get(dot.srvId)!;
    const catId = mapCategorias[dot.cargo];
    const reqDia = Math.max(1, Math.min(Math.floor(dot.cantidad / 2), 2));
    const reqNoche =
      srvCfg.modalidadDias === 'LUN_VIE_HABILES' || srvCfg.modalidadDias === 'LUN_SAB_SIN_FESTIVOS'
        ? 0
        : dot.cantidad >= 3
          ? 1
          : 0;
    const reqDiaDomFest =
      srvCfg.modalidadDias === 'LUN_VIE_HABILES' || srvCfg.modalidadDias === 'LUN_SAB_SIN_FESTIVOS'
        ? 0
        : srvCfg.modalidadDias === 'TODOS_GUARDIA_FDS'
          ? Math.max(1, reqDia - 1)
          : reqDia;
    const reqNocheDomFest = reqNoche;

    await prisma.requerimientoCobertura.create({
      data: {
        servicioId: dot.srvId,
        categoriaId: catId,
        reqDia,
        reqNoche,
        reqDiaDomFest,
        reqNocheDomFest,
      },
    });

    const acc = totalesPorServicio.get(dot.srvId) || { reqDia: 0, reqNoche: 0, reqDiaDomFest: 0, reqNocheDomFest: 0 };
    acc.reqDia += reqDia;
    acc.reqNoche += reqNoche;
    acc.reqDiaDomFest += reqDiaDomFest;
    acc.reqNocheDomFest += reqNocheDomFest;
    totalesPorServicio.set(dot.srvId, acc);

    const filasTurnos = srvCfg.turnosHabilitadosCodigos
      .filter((cod) => cod !== 'BLANCO' && mapTiposTurno[cod])
      .map((cod) => ({
        servicioId: dot.srvId,
        categoriaId: catId,
        tipoTurnoId: mapTiposTurno[cod],
        habilitado: true,
      }));
    if (filasTurnos.length > 0) {
      await prisma.servicioTurnoHabilitado.createMany({ data: filasTurnos, skipDuplicates: true });
    }
  }

  for (const [srvId, tot] of totalesPorServicio.entries()) {
    await prisma.servicio.update({
      where: { id: srvId },
      data: tot,
    });
  }

  // 8. Enlaces iniciales de Servicios Hermanos para rotación homóloga
  const paresHermanos: Array<[string, string]> = [
    ['srv-urg', 'srv-mat'],
    ['srv-urg', 'srv-ped'],
    ['srv-fact-urg', 'srv-fact-cen'],
  ];
  for (const [a, b] of paresHermanos) {
    await prisma.servicioHermano.createMany({
      data: [
        { servicioId: a, servicioHermanoId: b },
        { servicioId: b, servicioHermanoId: a },
      ],
      skipDuplicates: true,
    });
  }

  console.log(`🎉 ¡ÉXITO TOTAL! ${contadorTotal} colaboradores creados con cobertura, hermanos y Banco de Horas.`);
  console.log('🏥 Rafa Turnos sembrado con éxito en tu base de datos PostgreSQL.');
}

main()
  .catch((e) => {
    console.error('❌ Error en el Seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
