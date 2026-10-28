export type TipoAsistencia =
  | 'CUIDADOS_INTENSIVOS'
  | 'URGENCIAS'
  | 'QUIRURGICO'
  | 'HOSPITALIZACION'
  | 'APOYO_DIAGNOSTICO'
  | 'CONSULTA_EXTERNA';

export interface ServicioHermanoRef {
  id: string;
  codigo: string;
  nombre: string;
}

export interface ServicioHospitalario {
  id: string;
  codigo: string;
  nombre: string;
  tipoAsistencia: TipoAsistencia;
  intranetId?: string;
  reqManana: number;
  reqTarde: number;
  reqNoche: number;
  empleadosCount?: number;
  hermanos?: ServicioHermanoRef[];
}

export type CodigoTurno = string;

export interface TipoTurnoConfig {
  codigo: CodigoTurno;
  nombre: string;
  horario: string;
  horaInicio?: string;
  horaFin?: string;
  horasOrdinarias: number;
  horasDiurnas: number;
  horasNocturnas: number;
  bgHex: string;
  textHex: string;
  borderHex: string;
  esAusencia: boolean;
  esNocturnoPesado: boolean;
  descuentaBancoHoras: boolean;
  visibleEnPaleta?: boolean;
}

export interface EmpleadoHospital {
  id: string;
  documento: string;
  nombre: string;
  categoria: string;
  servicioBaseId: string;
  horasContratoMes: number;
  saldoBancoAnterior: number;
  ultimoTurnoMesPrevio: CodigoTurno;
}

export interface CeldaAsignacion {
  codigo: CodigoTurno;
  previsto?: CodigoTurno;
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

export interface FestivoEntry {
  fecha: string;
  nombre: string;
  esOficialLey: boolean;
}

export interface CalculoBancoHorasInput {
  empleadoId: string;
  documento: string;
  nombre: string;
  anio: number;
  mes: number;
  saldoInicialMesAnterior: number;
  horasContratoMes: number;
  horasRealesTrabajadas: number;
  turnosCompensatoriosTomados: number;
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  domingosHabituales: number;
}

export interface ResultadoBancoYNominaDto {
  empleadoId: string;
  documento: string;
  nombre: string;
  periodo: string;
  conceptosNominaMesCorriente: {
    hod: number;
    honRecargo35: number;
    hdfdRecargo75: number;
    hdfnRecargo110: number;
    domingosLaborados: number;
    diasCompensatoriosCausados: number;
  };
  bancoDeHoras: {
    saldoAnterior: number;
    horasContratadas: number;
    horasTrabajadas: number;
    horasAmortizadasPorTurnoComp: number;
    diferenciaMesActual: number;
    nuevoSaldoAcumuladoContinuo: number;
    estadoAlerta: 'EQUILIBRADO' | 'ATENCION_ACUMULACION' | 'CRITICO_SOBREACUMULACION';
  };
}

export interface ValidacionTurnoDto {
  empleadoId: string;
  fechaIso: string;
  turnoPrevioDiaAnterior: string;
  turnoPropuesto: string;
  tieneAusenciaActiva: boolean;
}

export const CATALOGO_TURNOS: Record<string, TipoTurnoConfig> = {
  M8: { codigo: 'M8', nombre: 'Mañana 8h', horario: '07:00 - 15:00', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  T8: { codigo: 'T8', nombre: 'Tarde 8h', horario: '15:00 - 23:00', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 6, horasNocturnas: 2, bgHex: '#FEF3C7', textHex: '#B45309', borderHex: '#FCD34D', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  N8: { codigo: 'N8', nombre: 'Noche 8h', horario: '23:00 - 07:00', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, bgHex: '#EDE9FE', textHex: '#6D28D9', borderHex: '#C4B5FD', esAusencia: false, esNocturnoPesado: true, descuentaBancoHoras: false, visibleEnPaleta: true },

  // Alias históricos ocultos en la paleta para evitar duplicados visuales
  M: { codigo: 'M', nombre: 'Mañana 8h', horario: '07:00 - 15:00', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },
  T: { codigo: 'T', nombre: 'Tarde 8h', horario: '15:00 - 23:00', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 6, horasNocturnas: 2, bgHex: '#FEF3C7', textHex: '#B45309', borderHex: '#FCD34D', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },
  N: { codigo: 'N', nombre: 'Noche 8h', horario: '23:00 - 07:00', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, bgHex: '#EDE9FE', textHex: '#6D28D9', borderHex: '#C4B5FD', esAusencia: false, esNocturnoPesado: true, descuentaBancoHoras: false, visibleEnPaleta: false },
  G12: { codigo: 'G12', nombre: 'Guardia Diurna 12h', horario: '07:00 - 19:00', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, bgHex: '#FFEDD5', textHex: '#C2410C', borderHex: '#FDBA74', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },

  M6: { codigo: 'M6', nombre: 'Mañana 6h', horario: '07:00 - 13:00', horaInicio: '07:00', horaFin: '13:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, bgHex: '#BAE6FD', textHex: '#0284C7', borderHex: '#38BDF8', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  T6: { codigo: 'T6', nombre: 'Tarde 6h', horario: '13:00 - 19:00', horaInicio: '13:00', horaFin: '19:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, bgHex: '#FDE68A', textHex: '#D97706', borderHex: '#FBBF24', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  N12: { codigo: 'N12', nombre: 'Noche 12h', horario: '19:00 - 07:00', horaInicio: '19:00', horaFin: '07:00', horasOrdinarias: 12, horasDiurnas: 3, horasNocturnas: 9, bgHex: '#DDD6FE', textHex: '#7C3AED', borderHex: '#A78BFA', esAusencia: false, esNocturnoPesado: true, descuentaBancoHoras: false, visibleEnPaleta: true },

  D12: { codigo: 'D12', nombre: 'Guardia Diurna 12h', horario: '07:00 - 19:00', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, bgHex: '#FFEDD5', textHex: '#C2410C', borderHex: '#FDBA74', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  G24: { codigo: 'G24', nombre: 'Guardia Médica 24h', horario: '07:00 - 07:00 (+1)', horaInicio: '07:00', horaFin: '07:00', horasOrdinarias: 24, horasDiurnas: 15, horasNocturnas: 9, bgHex: '#FEE2E2', textHex: '#B91C1C', borderHex: '#FCA5A5', esAusencia: false, esNocturnoPesado: true, descuentaBancoHoras: false, visibleEnPaleta: true },

  ADM: { codigo: 'ADM', nombre: 'Administrativo 8h', horario: '08:00 - 17:00', horaInicio: '08:00', horaFin: '17:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#F3F4F6', textHex: '#374151', borderHex: '#D1D5DB', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  MD: { codigo: 'MD', nombre: 'Madrugada / Aseo', horario: '06:00 - 14:00', horaInicio: '06:00', horaFin: '14:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E2E8F0', textHex: '#1E293B', borderHex: '#94A3B8', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  AP: { codigo: 'AP', nombre: 'Refuerzo Horas Pico', horario: '10:00 - 18:00', horaInicio: '10:00', horaFin: '18:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#CFFAFE', textHex: '#0891B2', borderHex: '#67E8F9', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  DISP: { codigo: 'DISP', nombre: 'Disponibilidad / Retén', horario: 'Al llamado', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FEF9C3', textHex: '#854D0E', borderHex: '#FDE047', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },

  S: { codigo: 'S', nombre: 'Saliente Guardia', horario: 'Descanso Post-Noche', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#ECFEFF', textHex: '#0E7490', borderHex: '#67E8F9', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  L: { codigo: 'L', nombre: 'Libre Programado', horario: 'Descanso Legal', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#F8FAFC', textHex: '#475569', borderHex: '#CBD5E1', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  COMP: { codigo: 'COMP', nombre: 'Compensatorio Banco', horario: 'Amortiza 8h Banco', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#CCFBF1', textHex: '#0F766E', borderHex: '#5EEAD4', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: true, visibleEnPaleta: true },
  VAC: { codigo: 'VAC', nombre: 'Vacaciones RRHH', horario: 'Bloqueo Intranet', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#D1FAE5', textHex: '#047857', borderHex: '#6EE7B7', esAusencia: true, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  INC: { codigo: 'INC', nombre: 'Incapacidad Médica', horario: 'Habeas Data', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FCE7F3', textHex: '#BE185D', borderHex: '#F9A8D4', esAusencia: true, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
};
