export type TipoAsistencia =
  | 'CUIDADOS_INTENSIVOS'
  | 'URGENCIAS'
  | 'QUIRURGICO'
  | 'HOSPITALIZACION'
  | 'APOYO_DIAGNOSTICO';

export interface ServicioHospitalario {
  id: string;
  codigo: string;
  nombre: string;
  tipoAsistencia: TipoAsistencia;
  reqManana: number;
  reqTarde: number;
  reqNoche: number;
}

export type CodigoTurno =
  | 'M'
  | 'T'
  | 'N'
  | 'G12'
  | 'G24'
  | 'S'
  | 'L'
  | 'COMP'
  | 'VAC'
  | 'INC'
  | '';

export interface TipoTurnoConfig {
  codigo: CodigoTurno;
  nombre: string;
  horario: string;
  horasOrdinarias: number;
  horasDiurnas: number;
  horasNocturnas: number;
  bgHex: string;
  textHex: string;
  borderHex: string;
  esAusencia: boolean;
  esNocturnoPesado: boolean; // Requiere S o L al día siguiente
  descuentaBancoHoras: boolean; // Para turno COMP
}

export interface EmpleadoHospital {
  id: string;
  documento: string;
  nombre: string;
  categoria: 'Médico Especialista' | 'Enfermero Jefe' | 'Auxiliar de Enfermería';
  servicioBaseId: string;
  horasContratoMes: number;
  saldoBancoAnterior: number; // Saldo arrastrado del mes previo (+ a favor, - en contra)
  ultimoTurnoMesPrevio: CodigoTurno; // Empalme día 30/31 del mes anterior
}

export interface CeldaAsignacion {
  codigo: CodigoTurno;
  previsto?: CodigoTurno; // Para comparar Previsto vs Ejecutado
  esRotacion?: boolean;
  servicioEjecutorId?: string;
  nota?: string;
}

export interface PermutaItem {
  id: string;
  fechaSolicitud: string;
  solicitanteId: string;
  solicitanteNombre: string;
  receptorId: string;
  receptorNombre: string;
  categoria: string;
  servicioId: string;
  diaOrigen: number;
  turnoOrigen: CodigoTurno;
  diaDestino: number;
  turnoDestino: CodigoTurno;
  estado: 'PENDIENTE_SUPERVISOR' | 'APROBADA' | 'RECHAZADA';
  validacionReglas: string;
}

export interface RegistroAuditoria {
  id: string;
  timestamp: string;
  actor: string;
  empleadoNombre: string;
  servicioNombre: string;
  dia: number;
  turnoAnterior: CodigoTurno;
  turnoNuevo: CodigoTurno;
  motivo: string;
}

export const CATALOGO_TURNOS: Record<string, TipoTurnoConfig> = {
  M: {
    codigo: 'M',
    nombre: 'Mañana',
    horario: '07:00 - 13:00',
    horasOrdinarias: 6,
    horasDiurnas: 6,
    horasNocturnas: 0,
    bgHex: '#E0F2FE',
    textHex: '#0369A1',
    borderHex: '#7DD3FC',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  T: {
    codigo: 'T',
    nombre: 'Tarde',
    horario: '13:00 - 19:00',
    horasOrdinarias: 6,
    horasDiurnas: 6,
    horasNocturnas: 0,
    bgHex: '#FEF3C7',
    textHex: '#B45309',
    borderHex: '#FCD34D',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  N: {
    codigo: 'N',
    nombre: 'Noche (12h)',
    horario: '19:00 - 07:00',
    horasOrdinarias: 12,
    horasDiurnas: 3, // 19:00-21:00 (2h) + 06:00-07:00 (1h)
    horasNocturnas: 9, // 21:00-06:00 (9h recargo nocturno CST)
    bgHex: '#EDE9FE',
    textHex: '#6D28D9',
    borderHex: '#C4B5FD',
    esAusencia: false,
    esNocturnoPesado: true,
    descuentaBancoHoras: false,
  },
  G12: {
    codigo: 'G12',
    nombre: 'Guardia Diurna 12h',
    horario: '07:00 - 19:00',
    horasOrdinarias: 12,
    horasDiurnas: 12,
    horasNocturnas: 0,
    bgHex: '#FFEDD5',
    textHex: '#C2410C',
    borderHex: '#FDBA74',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  G24: {
    codigo: 'G24',
    nombre: 'Guardia Médica 24h',
    horario: '07:00 - 07:00 (+1)',
    horasOrdinarias: 24,
    horasDiurnas: 15,
    horasNocturnas: 9,
    bgHex: '#FEE2E2',
    textHex: '#B91C1C',
    borderHex: '#FCA5A5',
    esAusencia: false,
    esNocturnoPesado: true,
    descuentaBancoHoras: false,
  },
  S: {
    codigo: 'S',
    nombre: 'Saliente Guardia',
    horario: 'Descanso Post-Noche',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    bgHex: '#ECFEFF',
    textHex: '#0E7490',
    borderHex: '#67E8F9',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  L: {
    codigo: 'L',
    nombre: 'Libre Programado',
    horario: 'Todo el día',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    bgHex: '#F1F5F9',
    textHex: '#475569',
    borderHex: '#CBD5E1',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  COMP: {
    codigo: 'COMP',
    nombre: 'Compensatorio Banco',
    horario: 'Amortiza 6h Banco',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    bgHex: '#CCFBF1',
    textHex: '#0F766E',
    borderHex: '#5EEAD4',
    esAusencia: false,
    esNocturnoPesado: false,
    descuentaBancoHoras: true,
  },
  VAC: {
    codigo: 'VAC',
    nombre: 'Vacaciones',
    horario: 'Bloqueo Intranet RRHH',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    bgHex: '#D1FAE5',
    textHex: '#047857',
    borderHex: '#6EE7B7',
    esAusencia: true,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
  INC: {
    codigo: 'INC',
    nombre: 'Incapacidad Médica',
    horario: 'Protegido Habeas Data',
    horasOrdinarias: 0,
    horasDiurnas: 0,
    horasNocturnas: 0,
    bgHex: '#FCE7F3',
    textHex: '#BE185D',
    borderHex: '#F9A8D4',
    esAusencia: true,
    esNocturnoPesado: false,
    descuentaBancoHoras: false,
  },
};

export const SERVICIOS_INICIALES: ServicioHospitalario[] = [
  {
    id: 'srv-uci-ad',
    codigo: 'UCI-AD',
    nombre: 'UCI Adultos',
    tipoAsistencia: 'CUIDADOS_INTENSIVOS',
    reqManana: 3,
    reqTarde: 3,
    reqNoche: 2,
  },
  {
    id: 'srv-uci-ped',
    codigo: 'UCI-PED',
    nombre: 'UCI Pediátrica',
    tipoAsistencia: 'CUIDADOS_INTENSIVOS',
    reqManana: 2,
    reqTarde: 2,
    reqNoche: 2,
  },
  {
    id: 'srv-urg',
    codigo: 'URG-GEN',
    nombre: 'Urgencias Generales',
    tipoAsistencia: 'URGENCIAS',
    reqManana: 3,
    reqTarde: 3,
    reqNoche: 3,
  },
  {
    id: 'srv-cir',
    codigo: 'CIR-GRAL',
    nombre: 'Cirugía y Quirófanos',
    tipoAsistencia: 'QUIRURGICO',
    reqManana: 2,
    reqTarde: 2,
    reqNoche: 1,
  },
];

export const EMPLEADOS_INICIALES: EmpleadoHospital[] = [
  // UCI Adultos (8 colaboradores)
  {
    id: 'emp-01',
    documento: '1098765432',
    nombre: 'Diana Carolina Mora',
    categoria: 'Enfermero Jefe',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: 12,
    ultimoTurnoMesPrevio: 'N',
  },
  {
    id: 'emp-02',
    documento: '1012345678',
    nombre: 'Camilo Andrés López',
    categoria: 'Enfermero Jefe',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: -12,
    ultimoTurnoMesPrevio: 'L',
  },
  {
    id: 'emp-03',
    documento: '1087654321',
    nombre: 'Dr. Carlos Arturo Ruiz',
    categoria: 'Médico Especialista',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: 6,
    ultimoTurnoMesPrevio: 'M',
  },
  {
    id: 'emp-04',
    documento: '1022998877',
    nombre: 'Dra. Sofía Elena Vargas',
    categoria: 'Médico Especialista',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'G24',
  },
  {
    id: 'emp-05',
    documento: '1033445566',
    nombre: 'Laura Marcela Gómez',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: 18,
    ultimoTurnoMesPrevio: 'T',
  },
  {
    id: 'emp-06',
    documento: '1044556677',
    nombre: 'Jorge Eliécer Pineda',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: -6,
    ultimoTurnoMesPrevio: 'N',
  },
  {
    id: 'emp-07',
    documento: '1055667788',
    nombre: 'Paola Andrea Castro',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'L',
  },
  {
    id: 'emp-08',
    documento: '1066778899',
    nombre: 'Andrés Felipe Mejía',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ad',
    horasContratoMes: 168,
    saldoBancoAnterior: -18,
    ultimoTurnoMesPrevio: 'M',
  },

  // UCI Pediátrica (Homólogo CUIDADOS_INTENSIVOS para probar rotación inter-servicios)
  {
    id: 'emp-09',
    documento: '1077889900',
    nombre: 'Valentina Ríos (UCI Ped)',
    categoria: 'Enfermero Jefe',
    servicioBaseId: 'srv-uci-ped',
    horasContratoMes: 168,
    saldoBancoAnterior: 6,
    ultimoTurnoMesPrevio: 'L',
  },
  {
    id: 'emp-10',
    documento: '1088990011',
    nombre: 'Dr. Mateo Aristizábal',
    categoria: 'Médico Especialista',
    servicioBaseId: 'srv-uci-ped',
    horasContratoMes: 168,
    saldoBancoAnterior: -6,
    ultimoTurnoMesPrevio: 'T',
  },
  {
    id: 'emp-11',
    documento: '1099001122',
    nombre: 'Natalia Jiménez',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ped',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'M',
  },
  {
    id: 'emp-12',
    documento: '1011223344',
    nombre: 'Sebastián Salazar',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-uci-ped',
    horasContratoMes: 168,
    saldoBancoAnterior: 12,
    ultimoTurnoMesPrevio: 'N',
  },

  // Urgencias Generales
  {
    id: 'emp-13',
    documento: '1020304050',
    nombre: 'Dr. Alejandro Mendoza',
    categoria: 'Médico Especialista',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 168,
    saldoBancoAnterior: 24,
    ultimoTurnoMesPrevio: 'L',
  },
  {
    id: 'emp-14',
    documento: '1030405060',
    nombre: 'Enf. Marcela Patiño',
    categoria: 'Enfermero Jefe',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 168,
    saldoBancoAnterior: -12,
    ultimoTurnoMesPrevio: 'N',
  },
  {
    id: 'emp-15',
    documento: '1040506070',
    nombre: 'Julián David Restrepo',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'M',
  },
  {
    id: 'emp-16',
    documento: '1050607080',
    nombre: 'Luisa Fernanda Ospina',
    categoria: 'Auxiliar de Enfermería',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 168,
    saldoBancoAnterior: 6,
    ultimoTurnoMesPrevio: 'T',
  },
];
