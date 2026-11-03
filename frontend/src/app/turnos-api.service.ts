import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CalculoBancoHorasInput,
  EmpleadoHospital,
  FestivoEntry,
  PermutaItem,
  ResultadoBancoYNominaDto,
  ServicioHospitalario,
  TipoTurnoConfig,
  ValidacionTurnoDto,
} from './models';

@Injectable({
  providedIn: 'root',
})
export class TurnosApiService {
  private readonly baseUrl = 'http://localhost:3000/api/v1';

  constructor(private readonly http: HttpClient) {}

  // 1. Servicios Asistenciales y Hermanos
  getServicios(): Observable<ServicioHospitalario[]> {
    return this.http.get<ServicioHospitalario[]>(`${this.baseUrl}/servicios-admin`);
  }

  crearServicio(servicio: {
    codigo: string;
    nombre: string;
    tipoAsistencia: string;
    intranetId?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/servicios-admin`, servicio);
  }

  actualizarServicio(id: string, servicio: {
    codigo: string;
    nombre: string;
    tipoAsistencia: string;
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/servicios-admin/${id}`, servicio);
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

  adscribirEmpleadoAServicio(empleadoId: string, servicioBaseId: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/servicios-admin/adscribir-empleado`, {
      empleadoId,
      servicioBaseId,
    });
  }

  // 1.2 Listado Maestro de Empleados Asistenciales (PostgreSQL)
  getEmpleados(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/servicios-admin/empleados`);
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
    colorHex: string;
    descuentaBancoHoras: boolean;
    esNocturnoPesado: boolean;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/servicios-admin/turnos`, turno);
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

  // 3. Simulación de Cierre y Banco de Horas Continuo
  simularCierreBancoHoras(input: CalculoBancoHorasInput): Observable<ResultadoBancoYNominaDto> {
    return this.http.post<ResultadoBancoYNominaDto>(
      `${this.baseUrl}/banco-horas-nomina/simular-cierre`,
      input
    );
  }

  // 4. Persistencia y Validación de Cuadrantes en PostgreSQL
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
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/cuadrantes/celda`, payload);
  }

  guardarLoteCuadrante(payload: {
    servicioId: string;
    anio: number;
    mes: number;
    celdas: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[];
  }): Observable<any> {
    return this.http.put(`${this.baseUrl}/cuadrantes/lote`, payload);
  }

  validarCeldaReglas(dto: ValidacionTurnoDto): Observable<any> {
    return this.http.post(`${this.baseUrl}/cuadrantes/validar-celda`, dto);
  }

  // 5. Permutas 1-a-1 en PostgreSQL
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

  simularPermuta(dto: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/permutas/simular`, dto);
  }
}
