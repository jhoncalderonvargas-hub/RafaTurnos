import { PrismaClient, TipoAsistencia } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🏥 Iniciando siembra (Seed) de Rafa Turnos para Hospital Nivel II / III...');

  // 1. Limpieza ordenada para no duplicar datos
  await prisma.auditoriaCambio.deleteMany();
  await prisma.asignacionTurno.deleteMany();
  await prisma.bancoHorasSaldo.deleteMany();
  await prisma.novedadAusencia.deleteMany();
  await prisma.tokenCalendario.deleteMany();
  await prisma.requerimientoCobertura.deleteMany();
  await prisma.cuadrante.deleteMany();
  await prisma.empleado.deleteMany();
  await prisma.tipoTurno.deleteMany();
  await prisma.categoriaProfesional.deleteMany();
  await prisma.servicio.deleteMany();
  await prisma.festivoColombia.deleteMany();

  console.log('🧹 Base de datos reseteada.');

  // 2. Servicios Hospitalarios (14 Servicios agrupados en bloques de afinidad)
  const serviciosData = [
    // Bloque Urgencias y Críticos
    { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias Generales y Reanimación', tipoAsistencia: TipoAsistencia.URGENCIAS },
    { id: 'srv-mat', codigo: 'MAT', nombre: 'Maternidad y Salas de Parto', tipoAsistencia: TipoAsistencia.URGENCIAS },
    { id: 'srv-ped', codigo: 'PED', nombre: 'Pediatría y Observación Pediátrica', tipoAsistencia: TipoAsistencia.URGENCIAS },

    // Bloque Quirúrgico
    { id: 'srv-cir', codigo: 'CIR', nombre: 'Cirugía / Quirófanos y Recuperación', tipoAsistencia: TipoAsistencia.QUIRURGICO },

    // Bloque Hospitalización Clínica (Rotan entre sí)
    { id: 'srv-hosp', codigo: 'HOSP', nombre: 'Hospitalización Pisos', tipoAsistencia: TipoAsistencia.HOSPITALIZACION },
    { id: 'srv-med-int', codigo: 'MED-INT', nombre: 'Medicina Interna (Cuidados Intermedios)', tipoAsistencia: TipoAsistencia.HOSPITALIZACION },
    { id: 'srv-med-gral', codigo: 'MED-GRAL', nombre: 'Medicina General y Consulta Externa', tipoAsistencia: TipoAsistencia.HOSPITALIZACION },

    // Bloque Apoyo Diagnóstico
    { id: 'srv-lab-img', codigo: 'LAB-IMG', nombre: 'Laboratorio Clínico e Imágenes Diagnósticas', tipoAsistencia: TipoAsistencia.APOYO_DIAGNOSTICO },

    // Bloque Farmacia
    { id: 'srv-farm', codigo: 'FARM', nombre: 'Servicio Farmacéutico Hospitalario', tipoAsistencia: TipoAsistencia.APOYO_DIAGNOSTICO },

    // Bloque Facturación y Admisiones
    { id: 'srv-fact-urg', codigo: 'FACT-URG', nombre: 'Facturación y Admisiones Urgencias (24/7)', tipoAsistencia: TipoAsistencia.CONSULTA_EXTERNA },
    { id: 'srv-fact-cen', codigo: 'FACT-CEN', nombre: 'Facturación Central y Cartera', tipoAsistencia: TipoAsistencia.CONSULTA_EXTERNA },

    // Bloque Operaciones y Logística
    { id: 'srv-cond', codigo: 'COND', nombre: 'Conductores de Ambulancia y Traslados', tipoAsistencia: TipoAsistencia.URGENCIAS },
    { id: 'srv-of-var', codigo: 'OF-VAR', nombre: 'Oficios Varios y Desinfección Hospitalaria', tipoAsistencia: TipoAsistencia.CONSULTA_EXTERNA },
    { id: 'srv-mant', codigo: 'MANT', nombre: 'Mantenimiento Hospitalario y Biomédica', tipoAsistencia: TipoAsistencia.CONSULTA_EXTERNA },
  ];

  for (const s of serviciosData) {
    await prisma.servicio.create({ data: s });
  }
  console.log(`✅ ${serviciosData.length} Servicios Asistenciales creados.`);

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
    { codigo: 'N8', nombre: 'Noche 8h', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, colorHex: '#EDE9FE', descuentaBancoHoras: false },

    // Rotativo 6h / 12h
    { codigo: 'M6', nombre: 'Mañana 6h', horaInicio: '07:00', horaFin: '13:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, colorHex: '#BAE6FD', descuentaBancoHoras: false },
    { codigo: 'T6', nombre: 'Tarde 6h', horaInicio: '13:00', horaFin: '19:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, colorHex: '#FDE68A', descuentaBancoHoras: false },
    { codigo: 'N12', nombre: 'Noche 12h', horaInicio: '19:00', horaFin: '07:00', horasOrdinarias: 12, horasDiurnas: 1, horasNocturnas: 11, colorHex: '#DDD6FE', descuentaBancoHoras: false },

    // Guardias y Corridos
    { codigo: 'D12', nombre: 'Guardia Diurna 12h', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, colorHex: '#FFEDD5', descuentaBancoHoras: false },
    { codigo: 'G24', nombre: 'Guardia Médica 24h', horaInicio: '07:00', horaFin: '07:00', horasOrdinarias: 24, horasDiurnas: 13, horasNocturnas: 11, colorHex: '#FEE2E2', descuentaBancoHoras: false },

    // Administrativos y Horas Pico
    { codigo: 'ADM', nombre: 'Administrativo Oficina 8h', horaInicio: '08:00', horaFin: '17:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#F3F4F6', descuentaBancoHoras: false },
    { codigo: 'MD', nombre: 'Madrugada / Apertura 8h', horaInicio: '06:00', horaFin: '14:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#E2E8F0', descuentaBancoHoras: false },
    { codigo: 'AP', nombre: 'Refuerzo Horas Pico 8h', horaInicio: '10:00', horaFin: '18:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, colorHex: '#CFFAFE', descuentaBancoHoras: false },
    { codigo: 'DISP', nombre: 'Disponibilidad / Retén', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FEF9C3', descuentaBancoHoras: false },

    // Descansos, Banco y Novedades
    { codigo: 'S', nombre: 'Saliente de Guardia', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#ECFEFF', descuentaBancoHoras: false },
    { codigo: 'L', nombre: 'Libre Programado', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#F8FAFC', descuentaBancoHoras: false },
    { codigo: 'COMP', nombre: 'Compensatorio Banco de Horas', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#CCFBF1', descuentaBancoHoras: true },
    { codigo: 'VAC', nombre: 'Vacaciones RRHH', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#D1FAE5', descuentaBancoHoras: false },
    { codigo: 'INC', nombre: 'Incapacidad Médica', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, colorHex: '#FCE7F3', descuentaBancoHoras: false },
  ];

  for (const t of turnosData) {
    await prisma.tipoTurno.create({ data: t });
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

  const nombresHombres = ['Carlos', 'Andrés', 'Jorge', 'Mateo', 'Alejandro', 'Julián', 'Felipe', 'Santiago', 'David', 'Gabriel', 'Daniel', 'Camilo', 'Mauricio', 'Fernando', 'Ricardo'];
  const nombresMujeres = ['Diana', 'Laura', 'Paola', 'Valentina', 'Sofía', 'Natalia', 'Marcela', 'Carolina', 'Daniela', 'Mariana', 'Claudia', 'Sandra', 'Adriana', 'Lucía', 'Patricia'];
  const apellidos = ['Mora', 'López', 'Ruiz', 'Vargas', 'Gómez', 'Pineda', 'Castro', 'Mejía', 'Ríos', 'Aristizábal', 'Jiménez', 'Salazar', 'Mendoza', 'Patiño', 'Restrepo', 'Ospina', 'Cardona', 'Montoya', 'Giraldo', 'Zapata'];

  let cedulaBase = 1010001001;
  let contadorTotal = 0;

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

  // Saldos variados del Banco de Horas (múltiplos de 8h: a favor +24h/+16h/+8h, en cero 0h, o en contra -8h/-16h)
  const saldosBancoVariados = [24, 16, 8, 0, 0, -8, -16, 8, 0, 16, -8, 24];

  for (const dot of dotaciones) {
    const catId = mapCategorias[dot.cargo];
    for (let i = 0; i < dot.cantidad; i++) {
      contadorTotal++;
      const esMujer = (contadorTotal % 2 === 0);
      const nombrePila = esMujer
        ? nombresMujeres[(contadorTotal * 3) % nombresMujeres.length]
        : nombresHombres[(contadorTotal * 7) % nombresHombres.length];
      const apellido1 = apellidos[(contadorTotal * 5) % apellidos.length];
      const apellido2 = apellidos[(contadorTotal * 11) % apellidos.length];
      const prefijo = dot.cargo.includes('Médico') ? (esMujer ? 'Dra. ' : 'Dr. ') : (dot.cargo.includes('Jefe') ? 'Enf. ' : '');

      const nombreCompleto = `${prefijo}${nombrePila} ${apellido1} ${apellido2}`;
      const doc = String(cedulaBase++);
      const saldoBanco = saldosBancoVariados[contadorTotal % saldosBancoVariados.length];

      const emp = await prisma.empleado.create({
        data: {
          documento: doc,
          nombre: nombreCompleto,
          correo: `${nombrePila.toLowerCase()}.${apellido1.toLowerCase()}${contadorTotal}@hospital.gov.co`,
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
          horasTrabajadas: 168 + saldoBanco,
          horasContratadas: 168,
          horasAmortizadasComp: 0,
          diferenciaMes: saldoBanco,
          saldoFinalAcumulado: saldoBanco, // Pasa como saldo anterior a Noviembre
        },
      });
    }
  }

  console.log(`🎉 ¡ÉXITO TOTAL! ${contadorTotal} colaboradores creados con sus saldos de Banco de Horas.`);
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
