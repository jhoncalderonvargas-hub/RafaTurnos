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

  // 4. Validación de Reglas Clínicas
  validarCeldaReglas(dto: ValidacionTurnoDto): Observable<any> {
    return this.http.post(`${this.baseUrl}/cuadrantes/validar-celda`, dto);
  }

  // 5. Permutas 1-a-1
  simularPermuta(dto: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/permutas/simular`, dto);
  }
}
