export interface EmpresaSeedDef {
  id: string;
  codigo: string;
  nombre: string;
  nit: string;
  aliasesCodigo: string[];
  estadoConfiguracion: 'CONFIRMADA' | 'PENDIENTE_REGLAS';
  plantillaNormativa: 'DECRETO_1042' | 'CST_LEY_2466' | 'PERSONALIZADA';
  horasSemanalesContrato: number;
  diasBaseSemana: number;
  horaInicioNocturnoMin: number;
  horaFinNocturnoMin: number;
  porcentajeRecargoNocturno: number;
  modoRecargoDominical: 'LEY_2466' | 'FIJO';
  porcentajeRecargoDominicalFijo: number | null;
  aplicaTopeHorasExtrasSemanal: boolean;
  topeHorasExtrasSemanal: number;
  usaBancoHoras: boolean;
  activa: boolean;
  observaciones: string;
}

export interface MetaTurnoSeedDef {
  codigoTurno: string;
  habilitado: boolean;
  minimoBase: number;
  esperadoBase: number;
  minimoDomFest: number;
  esperadoDomFest: number;
}

export interface ServicioSeedDef {
  id: string;
  codigo: string;
  nombre: string;
  macroprocesoId: string;
  modalidadDias: 'TODOS_24_7' | 'TODOS_GUARDIA_FDS' | 'LUN_SAB_SIN_FESTIVOS' | 'LUN_VIE_HABILES';
  permitePermutaEntreCargos: boolean;
  cargosPermitidos: string[];
  metasTurnos: MetaTurnoSeedDef[];
  descansosHabilitados?: string[];
  dotacionSeed: Array<{ cargo: string; cantidad: number }>;
}

export const EMPRESAS_SEED: EmpresaSeedDef[] = [
  {
    id: 'emp-ese-planta',
    codigo: 'ESE_PLANTA',
    nombre: 'Planta Pública ESE (Decreto 1042)',
    nit: '890900100-1',
    aliasesCodigo: ['ESE', 'PLANTA_ESE', 'PLANTA_PUBLICA', 'DECRETO_1042'],
    estadoConfiguracion: 'CONFIRMADA',
    plantillaNormativa: 'DECRETO_1042',
    horasSemanalesContrato: 44,
    diasBaseSemana: 6,
    horaInicioNocturnoMin: 1080, // 18:00
    horaFinNocturnoMin: 360,    // 06:00
    porcentajeRecargoNocturno: 0.35,
    modoRecargoDominical: 'FIJO',
    porcentajeRecargoDominicalFijo: 1.0,
    aplicaTopeHorasExtrasSemanal: true,
    topeHorasExtrasSemanal: 12,
    usaBancoHoras: true,
    activa: true,
    observaciones:
      'Régimen empleado público asistencial (44h/sem, recargo nocturno desde las 18:00 y dominical fijo 100%).',
  },
  {
    id: 'emp-temp-salud',
    codigo: 'TEMP_SALUD',
    nombre: 'TempSalud Operador Clínico SAS (CST Ley 2466)',
    nit: '900450200-3',
    aliasesCodigo: ['TEMPSALUD', 'TEMPORAL', 'OPERADOR_CST'],
    estadoConfiguracion: 'CONFIRMADA',
    plantillaNormativa: 'CST_LEY_2466',
    horasSemanalesContrato: 42,
    diasBaseSemana: 6,
    horaInicioNocturnoMin: 1140, // 19:00
    horaFinNocturnoMin: 360,    // 06:00
    porcentajeRecargoNocturno: 0.35,
    modoRecargoDominical: 'LEY_2466',
    porcentajeRecargoDominicalFijo: null,
    aplicaTopeHorasExtrasSemanal: true,
    topeHorasExtrasSemanal: 12,
    usaBancoHoras: true,
    activa: true,
    observaciones:
      'Operador privado bajo Código Sustantivo del Trabajo, Ley 2101 (42h/sem) y Ley 2466 (nocturno 19:00, dominical gradual).',
  },
  {
    id: 'emp-coop-serv',
    codigo: 'COOP_SERV',
    nombre: 'Agremiación CooSalud Servicios',
    nit: '901220300-7',
    aliasesCodigo: ['COOSALUD', 'COOPERATIVA', 'AGREMIACION'],
    estadoConfiguracion: 'CONFIRMADA',
    plantillaNormativa: 'PERSONALIZADA',
    horasSemanalesContrato: 42,
    diasBaseSemana: 6,
    horaInicioNocturnoMin: 1140, // 19:00
    horaFinNocturnoMin: 360,    // 06:00
    porcentajeRecargoNocturno: 0.35,
    modoRecargoDominical: 'LEY_2466',
    porcentajeRecargoDominicalFijo: null,
    aplicaTopeHorasExtrasSemanal: true,
    topeHorasExtrasSemanal: 12,
    usaBancoHoras: true,
    activa: true,
    observaciones:
      'Agremiación / contratación de apoyo con parámetros normativos editables desde Talento Humano.',
  },
];

export const MACROPROCESOS_SEED = [
  { id: 'mp-urgencias', codigo: 'URGENCIAS', nombre: 'Atención de Urgencias y Emergencias', nombreCorto: 'Urgencias y Emergencias', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🚨', orden: 1, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'ROTATIVO_8H' },
  { id: 'mp-cuidados-intensivos', codigo: 'CUIDADOS_INTENSIVOS', nombre: 'Cuidado Crítico e Intensivo (UCI / UCIM)', nombreCorto: 'Cuidado Crítico (UCI)', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '💓', orden: 2, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'GUARDIAS_12_24' },
  { id: 'mp-hospitalizacion', codigo: 'HOSPITALIZACION', nombre: 'Hospitalización e Internación', nombreCorto: 'Hospitalización', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🛏️', orden: 3, modalidadSugerida: 'TODOS_24_7', plantillaTurnosSugerida: 'ROTATIVO_8H' },
  { id: 'mp-quirurgico', codigo: 'QUIRURGICO', nombre: 'Atención Quirúrgica y Esterilización', nombreCorto: 'Quirúrgico y Cirugía', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🔪', orden: 4, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'GUARDIAS_12_24' },
  { id: 'mp-apoyo-diagnostico', codigo: 'APOYO_DIAGNOSTICO', nombre: 'Apoyo Diagnóstico y Terapéutico', nombreCorto: 'Apoyo Diagnóstico', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🔬', orden: 5, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'ROTATIVO_8H' },
  { id: 'mp-consulta-externa', codigo: 'CONSULTA_EXTERNA', nombre: 'Consulta Externa y Ambulatoria', nombreCorto: 'Consulta Externa', tipoProceso: 'MISIONAL_ASISTENCIAL', icono: '🩺', orden: 6, modalidadSugerida: 'LUN_SAB_SIN_FESTIVOS', plantillaTurnosSugerida: 'ADMINISTRATIVO' },
  { id: 'mp-administrativo', codigo: 'ADMINISTRATIVO', nombre: 'Gestión Financiera, Facturación y Admisiones', nombreCorto: 'Administrativo y Admisiones', tipoProceso: 'APOYO_ADMINISTRATIVO', icono: '🏛️', orden: 7, modalidadSugerida: 'LUN_VIE_HABILES', plantillaTurnosSugerida: 'ADMINISTRATIVO' },
  { id: 'mp-apoyo-operativo', codigo: 'APOYO_OPERATIVO', nombre: 'Apoyo Operativo, Logística y Mantenimiento', nombreCorto: 'Apoyo Operativo y Logística', tipoProceso: 'APOYO_OPERATIVO', icono: '🛠️', orden: 8, modalidadSugerida: 'TODOS_GUARDIA_FDS', plantillaTurnosSugerida: 'ROTATIVO_8H' },
];

export const CATEGORIAS_SEED: string[] = [
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
  'Técnico Administrativo en Salud',
  'Conductor de Ambulancia',
  'Operario de Oficios Varios / Aseo',
  'Auxiliar de Mantenimiento',
  'Técnico de Mantenimiento',
  'Tecnólogo Biomédico',
];

export const DESCANSOS_ESTANDAR = ['S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'];

export const CODIGOS_SISTEMA_OBLIGATORIOS = ['BLANCO', 'L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM'];

export const TURNOS_SEED = [
  // Rotativo 8h
  { codigo: 'M8', nombre: 'Mañana 8h', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#E0F2FE', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'T8', nombre: 'Tarde 8h', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 4, horasNocturnas: 4, minutosAlmuerzo: 0, colorHex: '#FEF3C7', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'N8', nombre: 'Noche 8h', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, minutosAlmuerzo: 0, colorHex: '#EDE9FE', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },

  // Rotativo 6h / 12h
  { codigo: 'M6', nombre: 'Mañana 6h', horaInicio: '07:00', horaFin: '13:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#BAE6FD', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 6, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'T6', nombre: 'Tarde 6h', horaInicio: '13:00', horaFin: '19:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FDE68A', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 6, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'N12', nombre: 'Noche 12h', horaInicio: '19:00', horaFin: '07:00', horasOrdinarias: 12, horasDiurnas: 1, horasNocturnas: 11, minutosAlmuerzo: 0, colorHex: '#DDD6FE', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 12, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },

  // Guardias y Corridos
  { codigo: 'D12', nombre: 'Guardia Diurna 12h', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FFEDD5', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 12, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'G24', nombre: 'Guardia Médica 24h', horaInicio: '07:00', horaFin: '07:00', horasOrdinarias: 24, horasDiurnas: 13, horasNocturnas: 11, minutosAlmuerzo: 0, colorHex: '#FEE2E2', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 24, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: true, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },

  // Administrativos y Horas Pico (ADM: 08:00-17:00 con 60 min almuerzo Art. 167 CST = 8h netas)
  { codigo: 'ADM', nombre: 'Administrativo Oficina 8h', horaInicio: '08:00', horaFin: '17:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 60, colorHex: '#F3F4F6', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'MD', nombre: 'Madrugada / Apertura 8h', horaInicio: '06:00', horaFin: '14:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#E2E8F0', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'AP', nombre: 'Refuerzo Horas Pico 8h', horaInicio: '10:00', horaFin: '18:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#CFFAFE', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 8, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: true, activo: true },
  { codigo: 'DISP', nombre: 'Disponibilidad / Retén', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FEF9C3', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: false, visibleEnPaleta: false, activo: true },

  // 8 Turnos Estructurales Obligatorios del Sistema
  { codigo: 'S', nombre: 'Saliente de Guardia', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#ECFEFF', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'L', nombre: 'Libre Programado', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#F8FAFC', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'BLANCO', nombre: 'Celda en Blanco (Sin asignar)', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FFFFFF', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: false, activo: true },
  { codigo: 'COMP', nombre: 'Compensatorio Banco de Horas', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#CCFBF1', descuentaBancoHoras: true, modoAmortizacionBanco: 'DIA_HABIL_EMPRESA', horasAmortizacionBanco: 7, prorrateaMetaContrato: false, esAusencia: false, bloqueaPermutas: false, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'FAM', nombre: 'Día de la Familia (Ley 1857)', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FCE7F3', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: true, esAusencia: true, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'VAC', nombre: 'Vacaciones RRHH', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#D1FAE5', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: true, esAusencia: true, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'INC', nombre: 'Incapacidad Médica', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#FCE7F3', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: true, esAusencia: true, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
  { codigo: 'LIC', nombre: 'Licencia Remunerada / Luto / Maternidad', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, minutosAlmuerzo: 0, colorHex: '#E0E7FF', descuentaBancoHoras: false, modoAmortizacionBanco: 'HORAS_FIJAS', horasAmortizacionBanco: 0, prorrateaMetaContrato: true, esAusencia: true, bloqueaPermutas: true, esNocturnoPesado: false, esSistemaObligatorio: true, visibleEnPaleta: true, activo: true },
];

export const SERVICIOS_RECLASIFICADOS_SEED: ServicioSeedDef[] = [
  // URGENCIAS (Homogéneos)
  {
    id: 'srv-urg-med',
    codigo: 'URG-MED',
    nombre: 'Urgencias — Médicos Generales',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico General'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico General', cantidad: 5 }],
  },
  {
    id: 'srv-urg-enf',
    codigo: 'URG-ENF',
    nombre: 'Urgencias — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 4 }],
  },
  {
    id: 'srv-urg-aux',
    codigo: 'URG-AUX',
    nombre: 'Urgencias — Auxiliares de Enfermería',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 3, esperadoBase: 4, minimoDomFest: 2, esperadoDomFest: 3 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 2, esperadoDomFest: 2 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 2, esperadoDomFest: 2 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 14 }],
  },

  // MATERNIDAD (Homogéneos)
  {
    id: 'srv-mat-esp',
    codigo: 'MAT-ESP',
    nombre: 'Maternidad — Médicos Especialistas',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico Especialista (Pediatra/Ginecólogo/Internista)'],
    metasTurnos: [
      { codigoTurno: 'D12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 3 }],
  },
  {
    id: 'srv-mat-enf',
    codigo: 'MAT-ENF',
    nombre: 'Maternidad — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 3 }],
  },
  {
    id: 'srv-mat-aux',
    codigo: 'MAT-AUX',
    nombre: 'Maternidad — Auxiliares de Enfermería',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 6 }],
  },

  // PEDIATRÍA (Homogéneos)
  {
    id: 'srv-ped-esp',
    codigo: 'PED-ESP',
    nombre: 'Pediatría — Médicos Especialistas',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico Especialista (Pediatra/Ginecólogo/Internista)'],
    metasTurnos: [
      { codigoTurno: 'D12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 3 }],
  },
  {
    id: 'srv-ped-enf',
    codigo: 'PED-ENF',
    nombre: 'Pediatría — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 2 }],
  },
  {
    id: 'srv-ped-aux',
    codigo: 'PED-AUX',
    nombre: 'Pediatría — Auxiliares de Enfermería',
    macroprocesoId: 'mp-urgencias',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 5 }],
  },

  // QUIRÚRGICO (Homogéneos)
  {
    id: 'srv-cir-cir',
    codigo: 'CIR-CIR',
    nombre: 'Cirugía — Médicos Cirujanos',
    macroprocesoId: 'mp-quirurgico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico Cirujano (Especialista)'],
    metasTurnos: [
      { codigoTurno: 'D12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'G24', habilitado: true, minimoBase: 0, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico Cirujano (Especialista)', cantidad: 3 }],
  },
  {
    id: 'srv-cir-ane',
    codigo: 'CIR-ANE',
    nombre: 'Cirugía — Anestesiólogos',
    macroprocesoId: 'mp-quirurgico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico Anestesiólogo'],
    metasTurnos: [
      { codigoTurno: 'D12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'G24', habilitado: true, minimoBase: 0, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico Anestesiólogo', cantidad: 3 }],
  },
  {
    id: 'srv-cir-inst',
    codigo: 'CIR-INST',
    nombre: 'Cirugía — Instrumentadores Quirúrgicos',
    macroprocesoId: 'mp-quirurgico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Instrumentador(a) Quirúrgico(a)'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Instrumentador(a) Quirúrgico(a)', cantidad: 4 }],
  },
  {
    id: 'srv-cir-enf',
    codigo: 'CIR-ENF',
    nombre: 'Cirugía — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-quirurgico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 2 }],
  },
  {
    id: 'srv-cir-aux',
    codigo: 'CIR-AUX',
    nombre: 'Cirugía — Auxiliares de Enfermería',
    macroprocesoId: 'mp-quirurgico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 4 }],
  },

  // HOSPITALIZACIÓN (Homogéneos)
  {
    id: 'srv-hosp-med',
    codigo: 'HOSP-MED',
    nombre: 'Hospitalización — Médicos Generales',
    macroprocesoId: 'mp-hospitalizacion',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico General'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico General', cantidad: 3 }],
  },
  {
    id: 'srv-hosp-enf',
    codigo: 'HOSP-ENF',
    nombre: 'Hospitalización — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-hospitalizacion',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 4 }],
  },
  {
    id: 'srv-hosp-aux',
    codigo: 'HOSP-AUX',
    nombre: 'Hospitalización — Auxiliares de Enfermería',
    macroprocesoId: 'mp-hospitalizacion',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 2, esperadoDomFest: 2 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 2, esperadoDomFest: 2 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 2, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 11 }],
  },

  // CUIDADOS INTENSIVOS / MEDICINA INTERNA (Homogéneos)
  {
    id: 'srv-med-int-esp',
    codigo: 'MED-INT-ESP',
    nombre: 'Medicina Interna — Médicos Especialistas',
    macroprocesoId: 'mp-cuidados-intensivos',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico Especialista (Pediatra/Ginecólogo/Internista)'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Médico Especialista (Pediatra/Ginecólogo/Internista)', cantidad: 3 }],
  },
  {
    id: 'srv-med-int-enf',
    codigo: 'MED-INT-ENF',
    nombre: 'Medicina Interna — Enfermeros(as) Jefe',
    macroprocesoId: 'mp-cuidados-intensivos',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Enfermero(a) Jefe'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N12', habilitado: true, minimoBase: 0, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Enfermero(a) Jefe', cantidad: 2 }],
  },
  {
    id: 'srv-med-int-aux',
    codigo: 'MED-INT-AUX',
    nombre: 'Medicina Interna — Auxiliares de Enfermería',
    macroprocesoId: 'mp-cuidados-intensivos',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Enfermería'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
      { codigoTurno: 'N12', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Enfermería', cantidad: 6 }],
  },

  // CONSULTA EXTERNA (Homogéneo)
  {
    id: 'srv-med-gral',
    codigo: 'MED-GRAL',
    nombre: 'Consulta Externa — Medicina General',
    macroprocesoId: 'mp-consulta-externa',
    modalidadDias: 'LUN_SAB_SIN_FESTIVOS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Médico General'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 0, esperadoDomFest: 0 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 0, esperadoDomFest: 0 },
      { codigoTurno: 'ADM', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 0 },
    ],
    dotacionSeed: [{ cargo: 'Médico General', cantidad: 6 }],
  },

  // APOYO DIAGNÓSTICO Y FARMACIA (Homogéneos)
  {
    id: 'srv-lab-bac',
    codigo: 'LAB-BAC',
    nombre: 'Laboratorio Clínico — Bacteriólogos',
    macroprocesoId: 'mp-apoyo-diagnostico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Bacteriólogo(a)'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Bacteriólogo(a)', cantidad: 4 }],
  },
  {
    id: 'srv-lab-aux',
    codigo: 'LAB-AUX',
    nombre: 'Laboratorio Clínico — Auxiliares',
    macroprocesoId: 'mp-apoyo-diagnostico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Laboratorio Clínico'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 0, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Laboratorio Clínico', cantidad: 5 }],
  },
  {
    id: 'srv-img-tec',
    codigo: 'IMG-TEC',
    nombre: 'Imágenes Diagnósticas — Tecnólogos',
    macroprocesoId: 'mp-apoyo-diagnostico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Tecnólogo(a) en Imágenes Diagnósticas'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Tecnólogo(a) en Imágenes Diagnósticas', cantidad: 4 }],
  },
  {
    id: 'srv-farm-qf',
    codigo: 'FARM-QF',
    nombre: 'Servicio Farmacéutico — Químicos y Regentes',
    macroprocesoId: 'mp-apoyo-diagnostico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Químico Farmacéutico / Regente de Farmacia'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Químico Farmacéutico / Regente de Farmacia', cantidad: 3 }],
  },
  {
    id: 'srv-farm-aux',
    codigo: 'FARM-AUX',
    nombre: 'Servicio Farmacéutico — Auxiliares',
    macroprocesoId: 'mp-apoyo-diagnostico',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Auxiliar de Farmacia'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Auxiliar de Farmacia', cantidad: 5 }],
  },

  // ADMINISTRATIVO (Multi-cargo Equivalente con Permuta Habilitada)
  {
    id: 'srv-fact-urg',
    codigo: 'FACT-URG',
    nombre: 'Facturación y Admisiones Urgencias (24/7)',
    macroprocesoId: 'mp-administrativo',
    modalidadDias: 'TODOS_24_7',
    permitePermutaEntreCargos: true,
    cargosPermitidos: ['Auxiliar de Facturación y Admisiones', 'Técnico Administrativo en Salud'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [
      { cargo: 'Auxiliar de Facturación y Admisiones', cantidad: 3 },
      { cargo: 'Técnico Administrativo en Salud', cantidad: 2 },
    ],
  },
  {
    id: 'srv-fact-cen',
    codigo: 'FACT-CEN',
    nombre: 'Facturación Central y Cartera',
    macroprocesoId: 'mp-administrativo',
    modalidadDias: 'LUN_VIE_HABILES',
    permitePermutaEntreCargos: true,
    cargosPermitidos: ['Auxiliar de Facturación y Admisiones', 'Técnico Administrativo en Salud'],
    metasTurnos: [
      { codigoTurno: 'ADM', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 0, esperadoDomFest: 0 },
    ],
    dotacionSeed: [
      { cargo: 'Auxiliar de Facturación y Admisiones', cantidad: 3 },
      { cargo: 'Técnico Administrativo en Salud', cantidad: 1 },
    ],
  },

  // APOYO OPERATIVO (Cond/Oficios Homogéneos + Mant Multi-cargo Equivalente)
  {
    id: 'srv-cond',
    codigo: 'COND',
    nombre: 'Conductores de Ambulancia y Traslados',
    macroprocesoId: 'mp-apoyo-operativo',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Conductor de Ambulancia'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 2, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 2, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
    ],
    dotacionSeed: [{ cargo: 'Conductor de Ambulancia', cantidad: 8 }],
  },
  {
    id: 'srv-of-var',
    codigo: 'OF-VAR',
    nombre: 'Oficios Varios y Desinfección Hospitalaria',
    macroprocesoId: 'mp-apoyo-operativo',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: false,
    cargosPermitidos: ['Operario de Oficios Varios / Aseo'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 3, esperadoBase: 4, minimoDomFest: 2, esperadoDomFest: 3 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 2, esperadoBase: 3, minimoDomFest: 2, esperadoDomFest: 2 },
      { codigoTurno: 'N8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 2 },
    ],
    dotacionSeed: [{ cargo: 'Operario de Oficios Varios / Aseo', cantidad: 12 }],
  },
  {
    id: 'srv-mant',
    codigo: 'MANT',
    nombre: 'Mantenimiento Hospitalario y Biomédica',
    macroprocesoId: 'mp-apoyo-operativo',
    modalidadDias: 'TODOS_GUARDIA_FDS',
    permitePermutaEntreCargos: true,
    cargosPermitidos: ['Auxiliar de Mantenimiento', 'Técnico de Mantenimiento', 'Tecnólogo Biomédico'],
    metasTurnos: [
      { codigoTurno: 'M8', habilitado: true, minimoBase: 1, esperadoBase: 2, minimoDomFest: 1, esperadoDomFest: 1 },
      { codigoTurno: 'T8', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 1 },
      { codigoTurno: 'ADM', habilitado: true, minimoBase: 1, esperadoBase: 1, minimoDomFest: 0, esperadoDomFest: 0 },
    ],
    dotacionSeed: [
      { cargo: 'Auxiliar de Mantenimiento', cantidad: 1 },
      { cargo: 'Técnico de Mantenimiento', cantidad: 3 },
      { cargo: 'Tecnólogo Biomédico', cantidad: 1 },
    ],
  },
];

export const PARES_HERMANOS_SEED: Array<[string, string]> = [
  // Auxiliares de Enfermería entre áreas asistenciales
  ['srv-urg-aux', 'srv-mat-aux'],
  ['srv-urg-aux', 'srv-ped-aux'],
  ['srv-urg-aux', 'srv-hosp-aux'],
  ['srv-urg-aux', 'srv-med-int-aux'],
  ['srv-urg-aux', 'srv-cir-aux'],
  // Enfermeros Jefe
  ['srv-urg-enf', 'srv-mat-enf'],
  ['srv-urg-enf', 'srv-ped-enf'],
  ['srv-urg-enf', 'srv-hosp-enf'],
  ['srv-urg-enf', 'srv-med-int-enf'],
  ['srv-urg-enf', 'srv-cir-enf'],
  // Médicos Generales
  ['srv-urg-med', 'srv-hosp-med'],
  ['srv-urg-med', 'srv-med-gral'],
  // Médicos Especialistas
  ['srv-mat-esp', 'srv-ped-esp'],
  ['srv-mat-esp', 'srv-med-int-esp'],
  // Facturación Multi-Cargo
  ['srv-fact-urg', 'srv-fact-cen'],
];

export const DOCS_EMPRESA_EXPLICITA: Record<string, 'ESE_PLANTA' | 'TEMP_SALUD' | 'COOP_SERV'> = {
  '1010001022': 'ESE_PLANTA', // Alfonso Mora Pineda (Coordinador Urgencias Auxiliar -> 44h Decreto 1042)
  '1010001018': 'TEMP_SALUD', // Bernardo Castro Zapata (Colaborador Urgencias Auxiliar -> 42h CST Ley 2466)
  '1010001144': 'COOP_SERV',  // Jaime Londoño (Colaborador Mantenimiento -> 42h CooSalud)
  '1037645182': 'ESE_PLANTA', // Jhon Alexander Calderon (Coordinador Mantenimiento -> 44h)
  '1037645181': 'ESE_PLANTA', // Dra. Beatriz Ocampo Villegas
  '1099887766': 'ESE_PLANTA', // Dra. Valentina Castro Mendoza
  '1037645123': 'TEMP_SALUD', // Tomas grajales frias
};

export function asignarEmpresaCodigoDeterministico(documento: string, indexFallback = 0): 'ESE_PLANTA' | 'TEMP_SALUD' | 'COOP_SERV' {
  const explicita = DOCS_EMPRESA_EXPLICITA[String(documento).trim()];
  if (explicita) return explicita;
  const numeric = Number(String(documento).replace(/\D/g, '')) || indexFallback;
  const mod = numeric % 5;
  if (mod === 0 || mod === 1) return 'ESE_PLANTA';
  if (mod === 2 || mod === 3) return 'TEMP_SALUD';
  return 'COOP_SERV';
}

export function esTurnoNocturnoPorCodigo(codigo: string): boolean {
  const c = String(codigo || '').trim().toUpperCase();
  return c === 'N8' || c === 'N12' || c === 'G24';
}

export function calcularResumenDerivadoServicio(metas: MetaTurnoSeedDef[]) {
  let reqDia = 0;
  let reqNoche = 0;
  let reqDiaDomFest = 0;
  let reqNocheDomFest = 0;
  for (const m of metas) {
    if (!m.habilitado) continue;
    const cod = m.codigoTurno.toUpperCase();
    if (cod === 'G24') {
      reqDia += m.esperadoBase;
      reqNoche += m.esperadoBase;
      reqDiaDomFest += m.esperadoDomFest;
      reqNocheDomFest += m.esperadoDomFest;
    } else if (esTurnoNocturnoPorCodigo(cod)) {
      reqNoche += m.esperadoBase;
      reqNocheDomFest += m.esperadoDomFest;
    } else {
      reqDia += m.esperadoBase;
      reqDiaDomFest += m.esperadoDomFest;
    }
  }
  return {
    reqDia: Math.max(0, reqDia),
    reqNoche: Math.max(0, reqNoche),
    reqDiaDomFest: Math.max(0, reqDiaDomFest),
    reqNocheDomFest: Math.max(0, reqNocheDomFest),
  };
}
