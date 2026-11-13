import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AuditoriaCeldaRespuesta,
  CategoriaProfesionalItem,
  EmpleadoHospital,
  EmpresaContratante,
  FestivoEntry,
  MetaTurnoServicio,
  PermutaItem,
  PlantillaEmpresaOption,
  RegistroAuditoria,
  ServicioHospitalario,
  SesionUsuarioSso,
  TipoTurnoConfig,
} from './models';
import { hoyColombiaIso, TandaBreakTurno } from './shared/liquidacion-horas';

@Injectable({
  providedIn: 'root',
})
export class TurnosApiService {
  /**
   * En desarrollo local con 'ng serve' apunta a http://localhost:3000/api/v1.
   * En contenedor Docker con Nginx o en producción utiliza la ruta relativa '/api/v1'
   * enrutada automáticamente mediante reverse-proxy interno.
   */
  private readonly baseUrl =
    typeof window !== 'undefined' &&
    window.location.port === '4200' &&
    window.location.hostname === 'localhost'
      ? 'http://localhost:3000/api/v1'
      : '/api/v1';

  constructor(private readonly http: HttpClient) {}

  // 0. Empresas Contratantes y Plantillas Normativas
  getEmpresas(): Observable<EmpresaContratante[]> {
    return this.http.get<EmpresaContratante[]>(`${this.baseUrl}/empresas`);
  }

  getPlantillasEmpresas(): Observable<PlantillaEmpresaOption[]> {
    return this.http.get<PlantillaEmpresaOption[]>(`${this.baseUrl}/empresas/plantillas`);
  }

  crearEmpresa(
    empresa: Partial<EmpresaContratante> & { confirmar?: boolean }
  ): Observable<EmpresaContratante> {
    return this.http.post<EmpresaContratante>(`${this.baseUrl}/empresas`, empresa);
  }

  actualizarEmpresa(
    id: string,
    empresa: Partial<EmpresaContratante> & { confirmar?: boolean }
  ): Observable<EmpresaContratante> {
    return this.http.put<EmpresaContratante>(`${this.baseUrl}/empresas/${id}`, empresa);
  }

  confirmarReglasEmpresa(
    id: string,
    empresa?: Partial<EmpresaContratante>
  ): Observable<EmpresaContratante> {
    return this.http.post<EmpresaContratante>(
      `${this.baseUrl}/empresas/${id}/confirmar-reglas`,
      empresa || {}
    );
  }

  eliminarEmpresa(id: string): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(`${this.baseUrl}/empresas/${id}`);
  }

  // 1. Servicios Asistenciales, Cargos, Macroprocesos y Hermanos
  getMacroprocesos(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/servicios-admin/macroprocesos`);
  }

  getCategorias(): Observable<CategoriaProfesionalItem[]> {
    return this.http.get<CategoriaProfesionalItem[]>(`${this.baseUrl}/servicios-admin/categorias`);
  }

  getServicios(): Observable<ServicioHospitalario[]> {
    return this.http.get<ServicioHospitalario[]>(`${this.baseUrl}/servicios-admin`);
  }

  crearServicio(servicio: {
    codigo: string;
    nombre: string;
    tipoAsistencia: string;
    intranetId?: string;
    permitePermutaEntreCargos?: boolean;
    cargosPermitidosIds?: string[];
    cargosPermitidos?: Array<{ categoriaId?: string; categoriaNombre?: string }>;
    metasPorTurno?: MetaTurnoServicio[];
    reqDia?: number;
    reqNoche?: number;
    modalidadDias?: string;
    reqDiaDomFest?: number;
    reqNocheDomFest?: number;
    turnosHabilitados?: string[];
    reglasPorCargo?: any[];
    empleadosIds?: string[];
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/servicios-admin`, servicio);
  }

  actualizarServicio(
    id: string,
    servicio: {
      codigo: string;
      nombre: string;
      tipoAsistencia: string;
      permitePermutaEntreCargos?: boolean;
      cargosPermitidosIds?: string[];
      cargosPermitidos?: Array<{ categoriaId?: string; categoriaNombre?: string }>;
      metasPorTurno?: MetaTurnoServicio[];
      reqDia?: number;
      reqNoche?: number;
      modalidadDias?: string;
      reqDiaDomFest?: number;
      reqNocheDomFest?: number;
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
      empleadosIds?: string[];
    }
  ): Observable<any> {
    return this.http.put(`${this.baseUrl}/servicios-admin/${id}`, servicio);
  }

  adscribirEmpleado(
    empleadoId: string,
    servicioBaseId: string
  ): Observable<{ id: string; servicioBaseId: string; advertenciaCargoCompatible?: string | null }> {
    return this.http.put<any>(`${this.baseUrl}/servicios-admin/adscribir-empleado`, {
      empleadoId,
      servicioBaseId,
    });
  }

  adscribirLote(
    empleadoIds: string[],
    servicioBaseId: string
  ): Observable<{
    ok: boolean;
    servicioBaseId: string;
    servicioNombre: string;
    trasladados: number;
    advertenciasCargo: string[];
  }> {
    return this.http.put<any>(`${this.baseUrl}/servicios-admin/adscribir-lote`, {
      empleadoIds,
      servicioBaseId,
    });
  }

  actualizarCondicionesEmpleado(
    empleadoId: string,
    dto: {
      servicioBaseId?: string;
      empresaContratanteId?: string;
      horasSemanalesOverride?: number | null;
    }
  ): Observable<any> {
    return this.http.put<any>(
      `${this.baseUrl}/servicios-admin/empleados/${encodeURIComponent(empleadoId)}/condiciones`,
      dto
    );
  }

  eliminarServicio(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/servicios-admin/${id}`);
  }

  enlazarServiciosHermanos(servicioId: string, hermanoId: string): Observable<any> {
    return this.http.post(
      `${this.baseUrl}/servicios-admin/${servicioId}/enlace-hermano/${hermanoId}`,
      {}
    );
  }

  desenlazarServiciosHermanos(servicioId: string, hermanoId: string): Observable<any> {
    return this.http.delete(
      `${this.baseUrl}/servicios-admin/${servicioId}/enlace-hermano/${hermanoId}`
    );
  }

  // 1.2 Listado Maestro de Empleados Asistenciales (PostgreSQL)
  getEmpleados(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/servicios-admin/empleados`);
  }

  sincronizarEmpleadosIntranet(): Observable<{
    ok: boolean;
    mensaje: string;
    total: number;
    creados: number;
    actualizados: number;
    empresasPendientes?: Array<{
      id: string;
      codigo: string;
      nombre: string;
      horasSemanalesContrato: number;
      recienCreada?: boolean;
    }>;
  }> {
    return this.http.post<any>(`${this.baseUrl}/servicios-admin/sincronizar-empleados-intranet`, {});
  }

  // 1.5 Catálogo Maestro de Tipos de Turno (PostgreSQL)
  getTiposTurno(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/servicios-admin/turnos`);
  }

  guardarTipoTurno(turno: {
    codigo: string;
    nombre: string;
    horaInicio: string;
    horaFin: string;
    horasOrdinarias: number;
    horasDiurnas: number;
    horasNocturnas: number;
    minutosAlmuerzo?: number;
    recesoHabilitado?: boolean;
    recesoRemunerado?: boolean;
    recesoMaxSimultaneos?: number;
    recesoTandasJson?: TandaBreakTurno[] | null;
    colorHex: string;
    descuentaBancoHoras: boolean;
    modoAmortizacionBanco?: string;
    horasAmortizacionBanco?: number | null;
    prorrateaMetaContrato?: boolean;
    esAusencia?: boolean;
    bloqueaPermutas?: boolean;
    activo?: boolean;
    modoJornada?: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO';
    esNocturnoPesado: boolean;
    visibleEnPaleta?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/servicios-admin/turnos`, turno);
  }

  archivarTipoTurno(codigo: string, activo?: boolean): Observable<any> {
    return this.http.patch(
      `${this.baseUrl}/servicios-admin/turnos/${encodeURIComponent(codigo)}/archivar`,
      activo !== undefined ? { activo } : {}
    );
  }

  eliminarTipoTurno(codigo: string): Observable<{ ok: boolean; mensaje: string }> {
    return this.http.delete<{ ok: boolean; mensaje: string }>(
      `${this.baseUrl}/servicios-admin/turnos/${encodeURIComponent(codigo)}`
    );
  }

  recalcularLiquidacion(body?: {
    anio?: number;
    mes?: number;
    servicioId?: string;
    incluirCerrados?: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/liquidacion/recalcular`, body || {});
  }

  // 2. Festivos Oficiales y Días Cívicos (Caché RAM en NestJS)
  getFestivos(anio: number): Observable<{ festivos: FestivoEntry[] }> {
    return this.http.get<{ festivos: FestivoEntry[] }>(
      `${this.baseUrl}/festivos?anio=${anio}`
    );
  }

  agregarDiaCivico(fecha: string, nombre: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/festivos/dia-civico`, { fecha, nombre });
  }

  eliminarDiaCivico(fechaIso: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/festivos/dia-civico/${fechaIso}`);
  }

  // 3. Persistencia y Validación de Cuadrantes en PostgreSQL
  getEstadoGlobalCuadrantes(anio: number): Observable<{
    anio: number;
    estados: Record<string, 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'>;
    asignacionesPorPeriodo: Record<
      string,
      Record<
        string,
        Record<
          number,
          {
            codigo: string;
            previsto?: string;
            esRotacion?: boolean;
            servicioEjecutorId?: string;
            nota?: string;
            fijada?: boolean;
            breakTandaOrden?: number;
            breakInicio?: string;
            breakFin?: string;
          }
        >
      >
    >;
    saldosConsolidados: Record<string, number>;
  }> {
    return this.http.get<any>(`${this.baseUrl}/cuadrantes/estado-global?anio=${anio}`);
  }

  actualizarEstadoCuadrante(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    estado: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA';
    saldosConsolidados?: {
      empleadoId: string;
      saldoInicial: number;
      horasTrabajadas: number;
      horasContratadas: number;
      horasAmortizadasComp: number;
      diferenciaMes: number;
      saldoFinalAcumulado: number;
    }[];
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/cuadrantes/estado`, payload);
  }

  guardarCeldaCuadrante(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    dia: number;
    empleadoId: string;
    codigo: string;
    previsto?: string;
    esRotacion?: boolean;
    breakTandaOrden?: number | null;
    breakInicio?: string | null;
    breakFin?: string | null;
    justificacion?: string;
    origenAccion?: string;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/cuadrantes/celda`, payload);
  }

  guardarBreakCelda(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    dia: number;
    empleadoId: string;
    breakTandaOrden?: number | null;
    breakInicio?: string | null;
    breakFin?: string | null;
  }): Observable<{
    ok: boolean;
    id: string;
    breakTandaOrden: number | null;
    breakInicio: string | null;
    breakFin: string | null;
    horas?: { hod: number; hon: number; hdfd: number; hdfn: number };
  }> {
    return this.http.patch<{
      ok: boolean;
      id: string;
      breakTandaOrden: number | null;
      breakInicio: string | null;
      breakFin: string | null;
      horas?: { hod: number; hon: number; hdfd: number; hdfn: number };
    }>(`${this.baseUrl}/cuadrantes/celda/break`, payload);
  }

  guardarNotaCelda(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    dia: number;
    empleadoId: string;
    nota: string | null;
  }): Observable<{ ok: boolean; id: string | null; nota: string | null }> {
    return this.http.patch<{ ok: boolean; id: string | null; nota: string | null }>(
      `${this.baseUrl}/cuadrantes/celda/nota`,
      payload
    );
  }

  alternarFijacionCelda(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    dia: number;
    empleadoId: string;
    fijada: boolean;
    justificacion?: string;
  }): Observable<{ ok: boolean; id: string | null; fijada: boolean }> {
    return this.http.patch<{ ok: boolean; id: string | null; fijada: boolean }>(
      `${this.baseUrl}/cuadrantes/celda/fijar`,
      payload
    );
  }

  asignarApoyoDiaCelda(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    dia: number;
    empleadoId: string;
    servicioDestinoId?: string | null;
    codigo?: string;
    justificacion?: string;
  }): Observable<{
    ok: boolean;
    id: string;
    servicioEjecutorId: string;
    esRotacion: boolean;
    codigo: string;
    breakTandaOrden?: number | null;
    breakInicio?: string | null;
    breakFin?: string | null;
  }> {
    return this.http.patch<{
      ok: boolean;
      id: string;
      servicioEjecutorId: string;
      esRotacion: boolean;
      codigo: string;
      breakTandaOrden?: number | null;
      breakInicio?: string | null;
      breakFin?: string | null;
    }>(`${this.baseUrl}/cuadrantes/celda/apoyo`, payload);
  }

  guardarLoteCuadrante(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    origenAccion?: string;
    justificacion?: string;
    celdas: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
      breakTandaOrden?: number | null;
      breakInicio?: string | null;
      breakFin?: string | null;
    }[];
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/cuadrantes/lote`, payload);
  }

  // 4. Permutas 1-a-1 en PostgreSQL
  getPermutas(): Observable<PermutaItem[]> {
    return this.http.get<PermutaItem[]>(`${this.baseUrl}/permutas`);
  }

  crearPermuta(dto: {
    solicitanteId: string;
    receptorId: string;
    servicioId: string;
    anio: number;
    mes: number;
    diaOrigen: number;
    turnoOrigen: string;
    diaDestino: number;
    turnoDestino: string;
    validacionReglas?: string;
  }): Observable<PermutaItem> {
    return this.http.post<PermutaItem>(`${this.baseUrl}/permutas`, dto);
  }

  aceptarPermutaPar(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/permutas/${id}/aceptar-par`, {});
  }

  rechazarPermutaPar(id: string, motivo?: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/permutas/${id}/rechazar-par`, { motivo });
  }

  aprobarPermuta(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/permutas/${id}/aprobar`, {});
  }

  rechazarPermuta(id: string, motivo?: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/permutas/${id}/rechazar`, { motivo });
  }

  // 5. Novedades y Ausencias Oficiales (Intranet Hospitalaria)
  getNovedades(anio?: number, mes?: number): Observable<any[]> {
    const [anioHoy, mesHoy] = hoyColombiaIso().split('-').map(Number);
    const a = anio || anioHoy;
    const m = mes || mesHoy;
    return this.http.get<any[]>(`${this.baseUrl}/cuadrantes/novedades?anio=${a}&mes=${m}`);
  }

  sincronizarNovedadesIntranet(anio: number, mes: number): Observable<{
    ok: boolean;
    mensaje: string;
    totalSincronizadas: number;
    celdasBloqueadas: number;
    novedades: any[];
  }> {
    return this.http.post<any>(`${this.baseUrl}/cuadrantes/sincronizar-novedades`, { anio, mes });
  }

  // 6. Autenticación Satélite SSO con Intranet Hospitalaria
  intercambiarTokenSso(ssoToken: string): Observable<{
    sessionToken: string;
    usuario: SesionUsuarioSso;
    intranetReturnUrl: string;
  }> {
    return this.http.post<{
      sessionToken: string;
      usuario: SesionUsuarioSso;
      intranetReturnUrl: string;
    }>(`${this.baseUrl}/intranet/sso-login`, { ssoToken });
  }

  obtenerSesionSso(sessionToken: string): Observable<{
    usuario: SesionUsuarioSso;
    intranetReturnUrl: string;
  }> {
    return this.http.get<{
      usuario: SesionUsuarioSso;
      intranetReturnUrl: string;
    }>(`${this.baseUrl}/intranet/sesion`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  }

  // 7. Enlace personal y feed dinámico de Calendario iCal (.ics)
  obtenerEnlaceCalendarioIcal(empleadoId: string): Observable<{
    empleadoId: string;
    empleadoNombre: string;
    documento: string;
    servicioNombre: string;
    token: string;
    httpUrl: string;
    webcalUrl: string;
  }> {
    return this.http.get<{
      empleadoId: string;
      empleadoNombre: string;
      documento: string;
      servicioNombre: string;
      token: string;
      httpUrl: string;
      webcalUrl: string;
    }>(`${this.baseUrl}/calendario/mi-enlace?empleadoId=${encodeURIComponent(empleadoId)}`);
  }

  // 8. Bitácora forense de auditoría médico-legal (PostgreSQL)
  obtenerAuditorias(
    servicioId?: string,
    limite = 150,
    tipoAccion?: string,
    fechaInicio?: string,
    fechaFin?: string,
    empleadoId?: string,
    incluirBorrador = false,
  ): Observable<RegistroAuditoria[]> {
    let url = `${this.baseUrl}/auditorias?limite=${limite}`;
    if (servicioId && servicioId !== 'TODOS') {
      url += `&servicioId=${encodeURIComponent(servicioId)}`;
    }
    if (tipoAccion && tipoAccion !== 'TODAS') {
      url += `&tipoAccion=${encodeURIComponent(tipoAccion)}`;
    }
    if (fechaInicio) {
      url += `&fechaInicio=${encodeURIComponent(fechaInicio)}`;
    }
    if (fechaFin) {
      url += `&fechaFin=${encodeURIComponent(fechaFin)}`;
    }
    if (empleadoId && empleadoId !== 'TODOS') {
      url += `&empleadoId=${encodeURIComponent(empleadoId)}`;
    }
    if (incluirBorrador) {
      url += '&incluirBorrador=true';
    }
    return this.http.get<RegistroAuditoria[]>(url);
  }

  obtenerAuditoriaCelda(empleadoId: string, fechaIso: string): Observable<AuditoriaCeldaRespuesta> {
    return this.http.get<AuditoriaCeldaRespuesta>(
      `${this.baseUrl}/auditorias/celda?empleadoId=${encodeURIComponent(empleadoId)}&fecha=${encodeURIComponent(fechaIso)}`
    );
  }
}
