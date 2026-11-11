import {
  ModoAmortizacionBanco,
  ModoRecargoDominicalEmpresa,
  PlantillaNormativaEmpresa,
} from './shared/liquidacion-horas';

export type TipoAsistencia =
  | 'CUIDADOS_INTENSIVOS'
  | 'URGENCIAS'
  | 'QUIRURGICO'
  | 'HOSPITALIZACION'
  | 'APOYO_DIAGNOSTICO'
  | 'CONSULTA_EXTERNA'
  | 'ADMINISTRATIVO'
  | 'APOYO_OPERATIVO';

export interface MacroprocesoInfo {
  codigo: TipoAsistencia;
  nombre: string;
  nombreCorto: string;
  tipoProceso: 'MISIONAL_ASISTENCIAL' | 'APOYO_ADMINISTRATIVO' | 'APOYO_OPERATIVO';
  icono: string;
  orden: number;
  modalidadSugerida?: ModalidadDiasServicio;
  plantillaTurnosSugerida?: 'ROTATIVO_8H' | 'GUARDIAS_12_24' | 'ADMINISTRATIVO' | 'TODOS';
}

interface ServicioHermanoRef {
  id: string;
  codigo: string;
  nombre: string;
}

export type ModalidadDiasServicio =
  | 'TODOS_24_7'
  | 'TODOS_GUARDIA_FDS'
  | 'LUN_SAB_SIN_FESTIVOS'
  | 'LUN_VIE_HABILES';

export interface DiaColumna {
  dia: number;
  fechaIso: string;
  letraDia: string;
  esSabado: boolean;
  esDomingo: boolean;
  esHoy?: boolean;
  festivo?: FestivoEntry;
}

export interface ReglaCargoServicio {
  categoriaId?: string;
  categoriaNombre: string;
  empleadosCount?: number;
  reqDia: number;
  reqNoche: number;
  reqDiaDomFest?: number;
  reqNocheDomFest?: number;
  turnosHabilitados: string[];
}

export interface CategoriaProfesionalItem {
  id: string;
  nombre: string;
}

export interface CargoPermitidoRef {
  categoriaId: string;
  categoriaNombre: string;
  empleadosCount?: number;
}

export interface MetaTurnoServicio {
  id?: string;
  tipoTurnoId?: string;
  codigoTurno: string;
  nombreTurno?: string;
  colorHex?: string;
  horaInicio?: string;
  horaFin?: string;
  horasOrdinarias?: number;
  horasNocturnas?: number;
  esNocturnoPesado?: boolean;
  habilitado: boolean;
  minimoBase: number;
  esperadoBase: number;
  minimoDomFest: number;
  esperadoDomFest: number;
}

export type EstadoCoberturaTurno = 'ROJO' | 'AMARILLO' | 'VERDE';

export interface CoberturaTurnoDia {
  programados: number;
  minimo: number;
  esperado: number;
  estado: EstadoCoberturaTurno;
  exceso: number;
  cerrado: boolean;
}

export interface EmpresaContratante {
  id: string;
  codigo: string;
  nombre: string;
  nit?: string | null;
  aliasesCodigo?: string[];
  estadoConfiguracion: 'CONFIRMADA' | 'PENDIENTE_REGLAS' | string;
  plantillaNormativa: PlantillaNormativaEmpresa | string;
  horasSemanalesContrato: number;
  diasBaseSemana: number;
  horaInicioNocturnoMin: number;
  horaFinNocturnoMin: number;
  porcentajeRecargoNocturno: number;
  modoRecargoDominical: ModoRecargoDominicalEmpresa | string;
  porcentajeRecargoDominicalFijo?: number | null;
  aplicaTopeHorasExtrasSemanal: boolean;
  topeHorasExtrasSemanal: number;
  usaBancoHoras: boolean;
  activa: boolean;
  observaciones?: string | null;
  empleadosCount?: number;
}

export interface PlantillaEmpresaOption {
  codigo: PlantillaNormativaEmpresa | string;
  nombre: string;
  descripcion: string;
  parametros: {
    plantillaNormativa: string;
    horasSemanalesContrato: number;
    diasBaseSemana: number;
    horaInicioNocturnoMin: number;
    horaFinNocturnoMin: number;
    porcentajeRecargoNocturno: number;
    modoRecargoDominical: string;
    porcentajeRecargoDominicalFijo?: number | null;
    aplicaTopeHorasExtrasSemanal: boolean;
    topeHorasExtrasSemanal: number;
    usaBancoHoras: boolean;
  };
}

export interface PendienteReglasEmpresaInfo {
  id: string;
  codigo: string;
  nombre: string;
  empleadosCount?: number;
}

export interface ServicioHospitalario {
  id: string;
  codigo: string;
  nombre: string;
  tipoAsistencia: TipoAsistencia;
  intranetId?: string;
  permitePermutaEntreCargos?: boolean;
  reqDia: number;
  reqNoche: number;
  modalidadDias?: ModalidadDiasServicio;
  reqDiaDomFest?: number;
  reqNocheDomFest?: number;
  turnosHabilitados?: string[];
  cargosPermitidos?: CargoPermitidoRef[];
  cargosPermitidosIds?: string[];
  metasPorTurno?: MetaTurnoServicio[];
  reglasPorCargo?: ReglaCargoServicio[];
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
  minutosAlmuerzo?: number;
  bgHex: string;
  textHex: string;
  borderHex: string;
  esAusencia: boolean;
  prorrateaMetaContrato?: boolean;
  bloqueaPermutas?: boolean;
  esNocturnoPesado: boolean;
  descuentaBancoHoras: boolean;
  modoAmortizacionBanco?: ModoAmortizacionBanco | string;
  horasAmortizacionBanco?: number | null;
  esSistemaObligatorio?: boolean;
  activo?: boolean;
  modoJornada?: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO';
  visibleEnPaleta?: boolean;
}

export interface EmpleadoHospital {
  id: string;
  documento: string;
  nombre: string;
  categoria: string;
  categoriaId?: string;
  servicioBaseId: string;
  empresaContratanteId?: string;
  empresaContratante?: Partial<EmpresaContratante> | null;
  horasSemanalesOverride?: number | null;
  horasSemanalesLey?: number;
  horasSemanalesAplicadas?: number;
  horasContratoMes: number;
  saldoBancoAnterior: number;
  saldoBancoOrigen?: { anio: number; mes: number; saldo: number };
  ultimoTurnoMesPrevio: CodigoTurno;
}

export interface CeldaAsignacion {
  codigo: CodigoTurno;
  previsto?: CodigoTurno;
  esRotacion?: boolean;
  servicioEjecutorId?: string;
  nota?: string;
  fijada?: boolean;
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
  anio?: number | null;
  mes?: number | null;
  diaOrigen: number;
  turnoOrigen: CodigoTurno;
  diaDestino: number;
  turnoDestino: CodigoTurno;
  estado: 'PENDIENTE_PAR' | 'PENDIENTE_SUPERVISOR' | 'APROBADA' | 'RECHAZADA';
  validacionReglas: string;
  motivoRechazo?: string;
}

export interface RegistroAuditoria {
  id: string;
  timestamp: string;
  timestampIso?: string;
  actor: string;
  tipoAccion?:
    | 'EDICION_TURNO'
    | 'PERMUTA'
    | 'ESTADO_CUADRANTE'
    | 'ACCION_MASIVA'
    | 'NOTA_CELDA'
    | 'FIJACION_CELDA'
    | 'APOYO_SERVICIO'
    | 'NOVEDAD_INTRANET'
    | string;
  origenAccion?: string;
  faseCuadrante?: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | string;
  esDetalleLote?: boolean;
  empleadoId?: string;
  empleadoNombre: string;
  empleadoDocumento?: string;
  servicioId?: string;
  servicioNombre: string;
  dia: number;
  fechaIso?: string;
  turnoAnterior: CodigoTurno | string;
  turnoNuevo: CodigoTurno | string;
  motivo: string;
}

export interface AuditoriaCeldaItem {
  id: string;
  timestamp: string;
  timestampIso: string;
  actor: string;
  tipoAccion: string;
  origenAccion: string;
  faseCuadrante: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | string;
  esDetalleLote: boolean;
  servicioNombre: string;
  turnoAnterior: string;
  turnoNuevo: string;
  justificacion: string;
}

export interface PermutaCeldaItem {
  id: string;
  fechaSolicitud: string;
  solicitanteId: string;
  solicitanteNombre: string;
  receptorId: string;
  receptorNombre: string;
  servicioNombre: string;
  diaOrigen: number;
  turnoOrigen: string;
  diaDestino: number;
  turnoDestino: string;
  estado: 'PENDIENTE_PAR' | 'PENDIENTE_SUPERVISOR' | 'APROBADA' | 'RECHAZADA' | string;
  motivoRechazo?: string | null;
}

export interface AusenciaCeldaInfo {
  id: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  codigoCie10?: string | null;
}

export interface AuditoriaCeldaRespuesta {
  empleadoId: string;
  fecha: string;
  celda: {
    nota: string | null;
    fijada: boolean;
    codigoPrevisto: string | null;
    estadoCuadrante: 'SIN_PLANIFICAR' | 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | string;
  };
  historial: AuditoriaCeldaItem[];
  permutas: PermutaCeldaItem[];
  ausencia: AusenciaCeldaInfo | null;
}

export interface TargetCeldaInspector {
  empId: string;
  dia: number;
  origenVista: 'PLANIFICADOR' | 'PORTAL';
  focoSeccion?: 'NOTA' | 'APOYO' | 'EDICION';
}

export interface MenuContextualCeldaState {
  empId: string;
  dia: number;
  clientX: number;
  clientY: number;
  origenVista: 'PLANIFICADOR' | 'PORTAL';
}

export interface FestivoEntry {
  fecha: string;
  nombre: string;
  esOficialLey: boolean;
}

export const NOMBRES_MESES: Record<number, string> = {
  1: 'Enero',
  2: 'Febrero',
  3: 'Marzo',
  4: 'Abril',
  5: 'Mayo',
  6: 'Junio',
  7: 'Julio',
  8: 'Agosto',
  9: 'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre',
};

export const TODOS_LOS_MESES: Array<{ valor: number; nombre: string }> = [
  { valor: 1, nombre: 'Enero' },
  { valor: 2, nombre: 'Febrero' },
  { valor: 3, nombre: 'Marzo' },
  { valor: 4, nombre: 'Abril' },
  { valor: 5, nombre: 'Mayo' },
  { valor: 6, nombre: 'Junio' },
  { valor: 7, nombre: 'Julio' },
  { valor: 8, nombre: 'Agosto' },
  { valor: 9, nombre: 'Septiembre' },
  { valor: 10, nombre: 'Octubre' },
  { valor: 11, nombre: 'Noviembre' },
  { valor: 12, nombre: 'Diciembre' },
];

export const CATALOGO_TURNOS: Record<string, TipoTurnoConfig> = {
  M8: { codigo: 'M8', nombre: 'Mañana 8h', horario: '07:00 - 15:00', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  T8: { codigo: 'T8', nombre: 'Tarde 8h', horario: '15:00 - 23:00', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 4, horasNocturnas: 4, bgHex: '#FEF08A', textHex: '#854D0E', borderHex: '#FACC15', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  N8: { codigo: 'N8', nombre: 'Noche 8h', horario: '23:00 - 07:00', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, bgHex: '#EDE9FE', textHex: '#5B21B6', borderHex: '#C4B5FD', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },

  // Alias históricos ocultos en la paleta para evitar duplicados visuales
  M: { codigo: 'M', nombre: 'Mañana 8h', horario: '07:00 - 15:00', horaInicio: '07:00', horaFin: '15:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },
  T: { codigo: 'T', nombre: 'Tarde 8h', horario: '15:00 - 23:00', horaInicio: '15:00', horaFin: '23:00', horasOrdinarias: 8, horasDiurnas: 4, horasNocturnas: 4, bgHex: '#FEF08A', textHex: '#854D0E', borderHex: '#FACC15', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },
  N: { codigo: 'N', nombre: 'Noche 8h', horario: '23:00 - 07:00', horaInicio: '23:00', horaFin: '07:00', horasOrdinarias: 8, horasDiurnas: 1, horasNocturnas: 7, bgHex: '#EDE9FE', textHex: '#5B21B6', borderHex: '#C4B5FD', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },
  G12: { codigo: 'G12', nombre: 'Guardia Diurna 12h', horario: '07:00 - 19:00', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, bgHex: '#FED7AA', textHex: '#9A3412', borderHex: '#FB923C', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: false },

  M6: { codigo: 'M6', nombre: 'Mañana 6h', horario: '07:00 - 13:00', horaInicio: '07:00', horaFin: '13:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, bgHex: '#BAE6FD', textHex: '#0284C7', borderHex: '#38BDF8', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  T6: { codigo: 'T6', nombre: 'Tarde 6h', horario: '13:00 - 19:00', horaInicio: '13:00', horaFin: '19:00', horasOrdinarias: 6, horasDiurnas: 6, horasNocturnas: 0, bgHex: '#FDE047', textHex: '#713F12', borderHex: '#EAB308', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  N12: { codigo: 'N12', nombre: 'Noche 12h', horario: '19:00 - 07:00', horaInicio: '19:00', horaFin: '07:00', horasOrdinarias: 12, horasDiurnas: 1, horasNocturnas: 11, bgHex: '#DDD6FE', textHex: '#4C1D95', borderHex: '#A78BFA', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },

  D12: { codigo: 'D12', nombre: 'Guardia Diurna 12h', horario: '07:00 - 19:00', horaInicio: '07:00', horaFin: '19:00', horasOrdinarias: 12, horasDiurnas: 12, horasNocturnas: 0, bgHex: '#FED7AA', textHex: '#9A3412', borderHex: '#FB923C', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  G24: { codigo: 'G24', nombre: 'Guardia Médica 24h', horario: '07:00 - 07:00 (+1)', horaInicio: '07:00', horaFin: '07:00', horasOrdinarias: 24, horasDiurnas: 13, horasNocturnas: 11, bgHex: '#FEE2E2', textHex: '#991B1B', borderHex: '#FCA5A5', esAusencia: false, esNocturnoPesado: true, descuentaBancoHoras: false, visibleEnPaleta: true },

  ADM: { codigo: 'ADM', nombre: 'Administrativo 8h', horario: '08:00 - 17:00', horaInicio: '08:00', horaFin: '17:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, minutosAlmuerzo: 60, bgHex: '#F3F4F6', textHex: '#374151', borderHex: '#D1D5DB', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  MD: { codigo: 'MD', nombre: 'Madrugada / Aseo', horario: '06:00 - 14:00', horaInicio: '06:00', horaFin: '14:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#E2E8F0', textHex: '#1E293B', borderHex: '#94A3B8', esAusencia: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  AP: { codigo: 'AP', nombre: 'Refuerzo Horas Pico', horario: '10:00 - 18:00', horaInicio: '10:00', horaFin: '18:00', horasOrdinarias: 8, horasDiurnas: 8, horasNocturnas: 0, bgHex: '#CFFAFE', textHex: '#0891B2', borderHex: '#67E8F9', esAusencia: false, prorrateaMetaContrato: false, bloqueaPermutas: false, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },
  DISP: { codigo: 'DISP', nombre: 'Disponibilidad / Retén', horario: 'Al llamado', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FEF9C3', textHex: '#713F12', borderHex: '#FDE047', esAusencia: false, prorrateaMetaContrato: false, bloqueaPermutas: true, esNocturnoPesado: false, descuentaBancoHoras: false, visibleEnPaleta: true },

  S: { codigo: 'S', nombre: 'Saliente Guardia', horario: 'Descanso Post-Noche', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#ECFEFF', textHex: '#0E7490', borderHex: '#67E8F9', esAusencia: false, prorrateaMetaContrato: false, bloqueaPermutas: false, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  L: { codigo: 'L', nombre: 'Libre Programado', horario: 'Descanso Legal', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FFFFFF', textHex: '#64748B', borderHex: '#E2E8F0', esAusencia: false, prorrateaMetaContrato: false, bloqueaPermutas: false, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  COMP: { codigo: 'COMP', nombre: 'Compensatorio Banco', horario: 'Amortiza 1 día hábil contrato', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#CCFBF1', textHex: '#0F766E', borderHex: '#5EEAD4', esAusencia: false, prorrateaMetaContrato: false, bloqueaPermutas: false, esNocturnoPesado: false, descuentaBancoHoras: true, modoAmortizacionBanco: 'DIA_HABIL_EMPRESA', horasAmortizacionBanco: 8, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  VAC: { codigo: 'VAC', nombre: 'Vacaciones RRHH', horario: 'Bloqueo Intranet', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#D1FAE5', textHex: '#047857', borderHex: '#6EE7B7', esAusencia: true, prorrateaMetaContrato: true, bloqueaPermutas: true, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  INC: { codigo: 'INC', nombre: 'Incapacidad Médica', horario: 'Habeas Data', horaInicio: '00:00', horaFin: '00:00', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FCE7F3', textHex: '#BE185D', borderHex: '#F9A8D4', esAusencia: true, prorrateaMetaContrato: true, bloqueaPermutas: true, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  LIC: { codigo: 'LIC', nombre: 'Licencia Remunerada / Calamidad / Luto', horario: 'Bloqueo Intranet', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#E0E7FF', textHex: '#3730A3', borderHex: '#C7D2FE', esAusencia: true, prorrateaMetaContrato: true, bloqueaPermutas: true, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
  FAM: { codigo: 'FAM', nombre: 'Día de la Familia', horario: 'Ley 1857 / Exonerado', horaInicio: '00:00', horaFin: '23:59', horasOrdinarias: 0, horasDiurnas: 0, horasNocturnas: 0, bgHex: '#FCE7F3', textHex: '#BE185D', borderHex: '#F9A8D4', esAusencia: true, prorrateaMetaContrato: true, bloqueaPermutas: true, esNocturnoPesado: false, descuentaBancoHoras: false, esSistemaObligatorio: true, activo: true, visibleEnPaleta: true },
};

export interface ModalConfirmacionConfig {
  titulo: string;
  mensaje: string;
  textoBotonConfirmar?: string;
  esPeligroso?: boolean;
  onConfirmar: () => void;
}

export type RolUsuarioSso = 'ADMIN_TH' | 'COORDINADOR' | 'COLABORADOR';

export interface SesionUsuarioSso {
  empleadoId: string;
  documento: string;
  nombre: string;
  correo?: string;
  categoria: string;
  rol: RolUsuarioSso;
  servicioBaseId: string;
  servicioBaseNombre: string;
  serviciosPermitidosIds: string[];
  empresaContratanteId?: string | null;
  empresaCodigo?: string | null;
  empresaNombre?: string | null;
  empresaEstadoConfiguracion?: string | null;
  horasSemanalesAplicadas?: number;
  intranetReturnUrl?: string;
}

export interface CambioCeldaHistorial {
  empId: string;
  dia: number;
  turnoAnterior: CodigoTurno;
  turnoNuevo: CodigoTurno;
  previstoAnterior?: string;
  esRotacion?: boolean;
}

export interface PasoHistorialEdicion {
  descripcion: string;
  servicioId: string;
  anio: number;
  mes: number;
  cambios: CambioCeldaHistorial[];
}

export interface InfraccionNormativa {
  empleadoId: string;
  empleadoNombre: string;
  dia: number;
  mensaje: string;
}


