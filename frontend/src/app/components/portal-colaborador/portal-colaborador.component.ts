import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  PermutaItem,
  RolUsuarioSso,
  ServicioHospitalario,
  TipoTurnoConfig,
} from '../../models';

export interface DatosEmpleadoPortal {
  empleado: EmpleadoHospital;
  servicioBase?: ServicioHospitalario;
  celdas: Record<number, CeldaAsignacion>;
  horasTrabajadas: number;
  conteoNoches: number;
  conteoDomFest: number;
  nuevoSaldoBanco: number;
  diferenciaMes: number;
  [key: string]: any;
}

@Component({
  selector: 'app-portal-colaborador',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="nomina-container">
      <div class="nomina-banner">
        <div class="selectors-group">
          <div class="logo-badge">👩‍⚕️</div>
          <div>
            <h2>Mi Calendario Personal de Turnos</h2>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
              <span class="periodo-tag">📅 {{ nombreMesSeleccionado }} {{ anioSeleccionado }}</span>
              @if (estadoCuadrante === 'PUBLICADO') {
                <span class="periodo-tag" style="background: #ecfdf5; color: #047857; border-color: #a7f3d0;">🟢 Publicado Oficial</span>
              } @else if (estadoCuadrante === 'CERRADO_NOMINA') {
                <span class="periodo-tag" style="background: #f5f3ff; color: #6d28d9; border-color: #ddd6fe;">🔒 Cerrado Nómina</span>
              } @else if (estadoCuadrante === 'BORRADOR') {
                <span class="periodo-tag" style="background: #fffbeb; color: #b45309; border-color: #fde68a;">📝 En Borrador (No Oficial)</span>
              } @else {
                <span class="periodo-tag" style="background: #f1f5f9; color: #475569; border-color: #cbd5e1;">⚪ Sin Planificar</span>
              }
              <span style="font-size: 12px; color: #64748b;">Programación individual y gestión de permutas</span>
            </div>
          </div>
        </div>

        <div class="portal-header-controls">
          <div class="control-item">
            <label>Mes:</label>
            <div class="month-stepper">
              <button
                type="button"
                class="btn-nav-month"
                [disabled]="!puedeRetrocederMes"
                (click)="retrocederMes()"
                title="Ir al mes anterior">
                ◀
              </button>
              <select
                class="select-month-input"
                [disabled]="mesesDisponibles.length === 0"
                [ngModel]="mesSeleccionado"
                (ngModelChange)="cambiarMes.emit(+$event)">
                @for (m of mesesDisponibles; track m.valor) {
                  <option [value]="m.valor">{{ m.nombre }} {{ anioSeleccionado }}</option>
                } @empty {
                  <option [value]="mesSeleccionado">Sin meses publicados</option>
                }
              </select>
              <button
                type="button"
                class="btn-nav-month"
                [disabled]="!puedeAvanzarMes"
                (click)="avanzarMes()"
                title="Ir al mes siguiente">
                ▶
              </button>
            </div>
          </div>

          @if (esAdminTh || esCoordinador) {
            <div class="control-item">
              <label>{{ esAdminTh ? 'Ver calendario de:' : 'Supervisar colaborador:' }}</label>
              <select [ngModel]="empleadoPortalId" (ngModelChange)="cambiarEmpleadoPortal.emit($event)">
                @for (e of empleados; track e.id) {
                  <option [value]="e.id">{{ e.nombre }} ({{ e.categoria }})</option>
                }
              </select>
            </div>
          } @else {
            <div class="control-item">
              <span class="badge-personal" style="padding: 8px 14px; font-size: 13px;">
                🔐 Sesión Intranet: <strong>{{ portal.empleado.nombre }}</strong> ({{ etiquetaRol(rolActual) }})
              </span>
            </div>
          }
        </div>
      </div>

      <!-- Banner de Advertencia de Estado del Cuadrante -->
      @if (estadoCuadrante === 'BORRADOR') {
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #92400e;">
          <span style="font-size: 20px;">⚠️</span>
          <div>
            <strong>Cuadrante en Elaboración (Borrador):</strong> La programación de <strong>{{ nombreMesSeleccionado }} {{ anioSeleccionado }}</strong> para el servicio <strong>{{ portal.servicioBase?.nombre }}</strong> está en fase de diseño por la coordinación y aún no es oficial. Los turnos asignados son preliminares y no admiten permutas hasta su publicación oficial.
          </div>
        </div>
      } @else if (estadoCuadrante === 'SIN_PLANIFICAR') {
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #475569;">
          <span style="font-size: 20px;">⚪</span>
          <div>
            <strong>Periodo Sin Planificar:</strong> Aún no se ha iniciado la planificación del cuadrante de <strong>{{ nombreMesSeleccionado }} {{ anioSeleccionado }}</strong> para <strong>{{ portal.servicioBase?.nombre }}</strong>. No hay turnos asignados para este mes.
          </div>
        </div>
      }

      @if (mesesDisponibles.length === 0) {
        <div class="empty-portal-container">
          <div style="font-size: 48px; margin-bottom: 12px;">📅</div>
          <h3 style="font-size: 18px; font-weight: 800; color: #1e293b; margin-bottom: 8px;">Sin Cuadrantes Publicados</h3>
          <p style="font-size: 14px; color: #64748b; max-width: 540px; margin: 0 auto 12px; line-height: 1.5;">
            El servicio <strong>{{ portal.servicioBase?.nombre || 'asignado' }}</strong> no tiene programación de turnos publicada oficialmente para el año {{ anioSeleccionado }}.
          </p>
          <div style="font-size: 13px; color: #94a3b8;">
            Tan pronto como la coordinación publique el cuadrante oficial del mes, tus turnos, horarios y la gestión de permutas estarán disponibles aquí.
          </div>
        </div>
      } @else {
        <!-- Bloque 1: Tarjetas de Resumen Personal y Mi Banco de Horas -->
        <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Servicio y Cargo</div>
          <div class="kpi-value" style="font-size: 20px;">{{ portal.servicioBase?.nombre || 'Servicio Asistencial' }}</div>
          <div class="kpi-sub">{{ portal.empleado.categoria }} • C.C. {{ portal.empleado.documento }}</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Horas Programadas en {{ nombreMesSeleccionado }}</div>
          <div class="kpi-value">{{ portal.horasTrabajadas }}h <span style="font-size: 15px; color: #64748b;">/ {{ portal.empleado.horasContratoMes }}h</span></div>
          <div class="kpi-sub">🌙 {{ portal.conteoNoches }} Noches • ☀️ {{ portal.conteoDomFest }} Domingos/Festivos</div>
        </div>

        <div class="kpi-card" style="background: #f0f9ff; border-color: #bae6fd;">
          <div class="kpi-label">🏦 Mi Banco de Horas</div>
          <div class="kpi-value" [class.text-pos]="portal.nuevoSaldoBanco > 0" [class.text-neg]="portal.nuevoSaldoBanco < 0">
            {{ formatearSigno(portal.nuevoSaldoBanco) }}h
          </div>
          <div class="kpi-sub">
            Saldo ant: <b>{{ formatearSigno(portal.empleado.saldoBancoAnterior) }}h</b> • En {{ nombreMesSeleccionado }}: <b>{{ formatearSigno(portal.diferenciaMes) }}h</b>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-label">Calendario en el Celular</div>
          <div style="margin: 8px 0;">
            <button class="btn-primary" (click)="abrirModalIcal.emit()">📲 Vincular a Google / iPhone</button>
          </div>
          <div class="kpi-sub">Se actualiza automáticamente</div>
        </div>
      </div>

      <!-- Bloque 2: Mi Calendario Mensual Personal ( Cuadrícula Semanal Lunes a Domingo ) -->
      <div class="panel-card">
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <h3>📅 Turnos de {{ nombreMesSeleccionado }} {{ anioSeleccionado }}</h3>
            <div class="month-stepper">
              <button
                type="button"
                class="btn-month-pill"
                [disabled]="!puedeRetrocederMes"
                (click)="retrocederMes()"
                title="Ver mes anterior">
                ◀ {{ mesAnteriorNombre }}
              </button>
              <span class="pill-month-active">{{ nombreMesSeleccionado }}</span>
              <button
                type="button"
                class="btn-month-pill"
                [disabled]="!puedeAvanzarMes"
                (click)="avanzarMes()"
                title="Ver mes siguiente">
                {{ mesSiguienteNombre }} ▶
              </button>
            </div>
          </div>
          <span class="badge-info">Día {{ diaPermutaSeleccionado }} de {{ nombreMesSeleccionado }} Seleccionado</span>
        </div>

        <div class="weekly-calendar-grid">
          <!-- Cabecera de los 7 días de la semana -->
          <div class="weekday-header">Lunes</div>
          <div class="weekday-header">Martes</div>
          <div class="weekday-header">Miércoles</div>
          <div class="weekday-header">Jueves</div>
          <div class="weekday-header">Viernes</div>
          <div class="weekday-header sat-header">Sábado</div>
          <div class="weekday-header sun-header">Domingo</div>

          <!-- Celdas vacías previas al Día 1 para cuadrar la primera semana -->
          @for (slot of celdasOffsetInicioMes; track slot) {
            <div
              class="emp-day-card empty-slot"
              [class.sat-card]="slot === 5"
              [class.sun-card]="slot === 6">
            </div>
          }

          <!-- Días reales del mes en filas semanales de 7 columnas -->
          @for (d of diasDelMes; track d.dia) {
            @let celdaMia = portal.celdas[d.dia];
            @let cfgMio = obtenerConfigTurno(celdaMia?.codigo || '');
            @let srvDia = obtenerServicioDiaPortal(celdaMia, portal.empleado.servicioBaseId);
            <div
              class="emp-day-card"
              [class.selected-day]="diaPermutaSeleccionado === d.dia"
              [class.sat-card]="d.esSabado"
              [class.sun-card]="d.esDomingo"
              [class.holiday-card]="!!d.festivo"
              [class.support-card]="srvDia?.esRotacion"
              (click)="seleccionarDiaEnPortal.emit(d.dia)">
              <div class="emp-day-head">
                <span class="emp-day-num">{{ d.dia }}</span>
                @if (d.festivo) {
                  <span class="emp-festivo-tag" [title]="d.festivo.nombre">🇨🇴 Festivo</span>
                }
                @if (srvDia?.esRotacion) {
                  <span class="emp-rot-tag" title="Personal de apoyo en otro servicio">🔄 Apoyo</span>
                }
              </div>

              @if (celdaMia && celdaMia.codigo) {
                <div
                  class="emp-shift-pill"
                  [style.background-color]="cfgMio ? cfgMio.bgHex : '#f8fafc'"
                  [style.color]="cfgMio ? cfgMio.textHex : '#64748b'"
                  [style.border-color]="cfgMio ? cfgMio.borderHex : '#cbd5e1'">
                  <span class="emp-day-code">{{ celdaMia.codigo }}</span>
                  <span class="emp-day-name">{{ cfgMio ? cfgMio.nombre : celdaMia.codigo }}</span>
                </div>

                <div class="emp-day-hours">
                  {{ cfgMio ? cfgMio.horario : 'Turno asignado' }}
                </div>

                @if (srvDia) {
                  <div class="emp-day-service" [class.srv-rotado]="srvDia.esRotacion" [title]="'Servicio asignado: ' + srvDia.nombre">
                    <span class="srv-icon">{{ srvDia.esRotacion ? '🔄' : '📍' }}</span>
                    <span class="srv-text">{{ srvDia.nombre }}</span>
                  </div>
                }
              } @else {
                <div class="emp-shift-unassigned">
                  <span class="unassigned-dash">—</span>
                  <span class="unassigned-text">Sin turno</span>
                </div>
              }
            </div>
          }

          <!-- Celdas vacías al final del mes para cerrar la última fila semanal -->
          @for (slotFin of celdasOffsetFinMes; track slotFin; let idxFin = $index) {
            @let colIdx = (celdasOffsetInicioMes.length + diasDelMes.length + idxFin) % 7;
            <div
              class="emp-day-card empty-slot"
              [class.sat-card]="colIdx === 5"
              [class.sun-card]="colIdx === 6">
            </div>
          }
        </div>
      </div>

      <!-- Bloque 3 y 4: Solicitar Cambio de Turno y Ver Equipo de Guardia -->
      <div class="two-col-panels">
        <!-- Intercambio de turnos entre compañeros (Doc 09) -->
        <div class="panel-card">
          <div class="panel-header">
            <h3>🔄 Solicitar Cambio de Turno — Día {{ diaPermutaSeleccionado }}</h3>
            <span class="badge-law">{{ portal.empleado.categoria }}</span>
          </div>

          <!-- 1. BLOQUE DE PROPUESTAS RECIBIDAS (ACCIÓN REQUERIDA DEL COMPAÑERO RECEPTOR) -->
          @if (propuestasRecibidas.length > 0) {
            <div class="propuestas-recibidas-alert">
              <div class="alert-incoming-header">
                <strong>📬 Propuestas de Cambio Recibidas:</strong>
                <span class="badge-count-pending">{{ propuestasRecibidas.length }} por responder</span>
              </div>
              <div class="permutas-list" style="margin-top: 8px;">
                @for (pr of propuestasRecibidas; track pr.id) {
                  <div class="permuta-item permuta-item-incoming">
                    <div class="permuta-main">
                      <div class="permuta-title">
                        <strong>{{ pr.solicitanteNombre }}</strong> te propone intercambiar:
                      </div>
                      <div class="permuta-meta">
                        Día {{ pr.diaOrigen }}: Su turno <code>{{ pr.turnoOrigen }}</code> por tu turno <code>{{ pr.turnoDestino }}</code>
                      </div>
                      <div class="permuta-validation">
                        ✅ {{ pr.validacionReglas }}
                      </div>
                    </div>
                    <div class="permuta-actions">
                      <button class="btn-approve" (click)="aceptarPropuestaPar.emit(pr.id)">
                        ✅ Aceptar Propuesta
                      </button>
                      <button class="btn-reject" (click)="rechazarPropuestaPar.emit(pr.id)">
                        ❌ Declinar
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <p class="panel-desc" style="margin-top: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span>Tu turno el <strong>Día {{ diaPermutaSeleccionado }} de {{ nombreMesSeleccionado }}</strong>:</span>
            @if (portal.celdas[diaPermutaSeleccionado].codigo) {
              <span class="mini-shift">{{ portal.celdas[diaPermutaSeleccionado].codigo }}</span>
              <span class="badge-srv-panel" [class.badge-srv-rot]="servicioDiaSeleccionado.esRotacion" [title]="servicioDiaSeleccionado.esRotacion ? 'Servicio de apoyo rotado' : 'Servicio base asignado'">
                {{ servicioDiaSeleccionado.esRotacion ? '🔄 ' : '📍 ' }}{{ servicioDiaSeleccionado.nombre }}
              </span>
            } @else {
              <span class="badge-srv-panel" style="background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1;">Sin turno asignado</span>
            }
          </p>

          <div class="form-stack">
            <label>Proponer cambio de turno a un compañero el Día {{ diaPermutaSeleccionado }} de {{ nombreMesSeleccionado }}:</label>
            @if (estadoCuadrante !== 'PUBLICADO') {
              <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; font-size: 13px; color: #64748b; line-height: 1.5;">
                🔒 <strong>Permutas no disponibles:</strong> Solo se pueden tramitar solicitudes de intercambio de turnos cuando el cuadrante del mes se encuentra <strong>PUBLICADO</strong> oficialmente. Estado actual de {{ nombreMesSeleccionado }}: <em>{{ estadoCuadrante === 'BORRADOR' ? 'En Borrador' : (estadoCuadrante === 'CERRADO_NOMINA' ? 'Cerrado para Nómina' : 'Sin Planificar') }}</em>.
              </div>
            } @else if (!portal.celdas[diaPermutaSeleccionado].codigo) {
              <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; font-size: 13px; color: #64748b;">
                ℹ️ <strong>Día sin turno asignado:</strong> No tienes un turno programado en el Día {{ diaPermutaSeleccionado }}. Solo puedes permutar días en los que tengas un turno oficial asignado.
              </div>
            } @else if (companerosPares.length > 0) {
              <select [ngModel]="companeroPermutaId" (ngModelChange)="cambiarCompaneroPermuta.emit($event)" style="padding: 8px; border-radius: 6px; border: 1px solid #cbd5e1; font-weight: 600;">
                @for (par of companerosPares; track par.id) {
                  @let turnoPar = asignaciones[par.id][diaPermutaSeleccionado].codigo;
                  <option [value]="par.id">
                    {{ par.nombre }} — Turno {{ turnoPar ? '[' + turnoPar + ']' : '[Sin turno]' }} el Día {{ diaPermutaSeleccionado }}
                  </option>
                }
              </select>

              <button class="btn-primary" (click)="enviarSolicitudPermuta.emit()">
                📨 Enviar Propuesta a Compañero (Paso 1)
              </button>
            } @else {
              <div class="text-muted" style="padding: 8px; font-style: italic;">
                No hay otros compañeros con el mismo cargo en este servicio para realizar permutas.
              </div>
            }
          </div>

          <div style="margin-top: 20px;">
            <h4 style="margin-bottom: 8px; font-size: 12.5px; color: #334155;">Estado de Mis Solicitudes Enviadas:</h4>
            <div class="permutas-list">
              @for (mp of misSolicitudesEnviadas; track mp.id) {
                <div class="permuta-item">
                  <div>
                    <div class="permuta-title">
                      Día {{ mp.diaOrigen }}: Tu turno <code>{{ mp.turnoOrigen }}</code> ⇄ Turno <code>{{ mp.turnoDestino }}</code> con <strong>{{ mp.receptorNombre }}</strong>
                    </div>
                    <div class="permuta-validation">{{ mp.validacionReglas }}</div>
                    @if (mp.motivoRechazo) {
                      <div class="permuta-reject-reason">Motivo: {{ mp.motivoRechazo }}</div>
                    }
                  </div>
                  <div>
                    @if (mp.estado === 'PENDIENTE_PAR') {
                      <span class="status-tag status-tag-par" title="Esperando que tu compañero acepte la propuesta">⏳ Esperando a {{ mp.receptorNombre }}</span>
                    } @else if (mp.estado === 'PENDIENTE_SUPERVISOR') {
                      <span class="status-tag status-tag-sup" title="Aceptada por tu compañero; esperando aprobación de la Supervisora">📋 En revisión Jefatura</span>
                    } @else if (mp.estado === 'APROBADA') {
                      <span class="status-tag status-tag-ok" title="Aprobada y aplicada en el cuadrante">✅ Aprobada</span>
                    } @else {
                      <span class="status-tag status-tag-no" title="Rechazada">❌ Rechazada</span>
                    }
                  </div>
                </div>
              } @empty {
                <div class="text-muted">No has enviado propuestas de cambio en este periodo.</div>
              }
            </div>
          </div>
        </div>

        <!-- ¿Quién está de turno conmigo ese día? -->
        <div class="panel-card">
          <div class="panel-header">
            <h3>🏥 Compañeros de Turno — Día {{ diaPermutaSeleccionado }} ({{ servicioDiaSeleccionado.nombre }})</h3>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th>Compañero</th>
                <th>Cargo</th>
                <th>Turno</th>
                <th>Horario</th>
              </tr>
            </thead>
            <tbody>
              @for (eq of equipoDeGuardiaDia; track eq.empleado.id) {
                @let cfgEq = obtenerConfigTurno(eq.turno);
                <tr>
                  <td><strong>{{ eq.empleado.nombre }}</strong></td>
                  <td>{{ eq.empleado.categoria }}</td>
                  <td>
                    <span class="mini-shift" [style.background-color]="cfgEq?.bgHex" [style.color]="cfgEq?.textHex">
                      {{ eq.turno }} — {{ cfgEq?.nombre }}
                    </span>
                  </td>
                  <td class="font-mono">{{ cfgEq?.horario }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="text-muted">No hay otros compañeros en turno activo este día.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      }
    </div>
  `,
})
export class PortalColaboradorComponent {
  @Input({ required: true }) portal!: DatosEmpleadoPortal;
  @Input() esAdminTh = false;
  @Input() esCoordinador = false;
  @Input() estadoCuadrante: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | 'SIN_PLANIFICAR' = 'PUBLICADO';
  @Input() empleadoPortalId = '';
  @Input() empleados: EmpleadoHospital[] = [];
  @Input() rolActual: RolUsuarioSso = 'COLABORADOR';
  @Input() mesSeleccionado = 8;
  @Input() anioSeleccionado = 2026;
  @Input() mesesDisponibles: Array<{ valor: number; nombre: string }> = [];
  @Input() diaPermutaSeleccionado = 1;
  @Input() celdasOffsetInicioMes: number[] = [];
  @Input() celdasOffsetFinMes: number[] = [];
  @Input() diasDelMes: DiaColumna[] = [];
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() propuestasRecibidas: PermutaItem[] = [];
  @Input() servicioDiaSeleccionado: { id: string; nombre: string; esRotacion: boolean } = {
    id: '',
    nombre: 'Servicio Hospitalario',
    esRotacion: false,
  };
  @Input() companerosPares: EmpleadoHospital[] = [];
  @Input() companeroPermutaId = '';
  @Input() asignaciones: Record<string, Record<number, CeldaAsignacion>> = {};
  @Input() misSolicitudesEnviadas: PermutaItem[] = [];
  @Input() equipoDeGuardiaDia: Array<{ empleado: EmpleadoHospital; turno: string }> = [];

  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarEmpleadoPortal = new EventEmitter<string>();
  @Output() abrirModalIcal = new EventEmitter<void>();
  @Output() seleccionarDiaEnPortal = new EventEmitter<number>();
  @Output() aceptarPropuestaPar = new EventEmitter<string>();
  @Output() rechazarPropuestaPar = new EventEmitter<string>();
  @Output() cambiarCompaneroPermuta = new EventEmitter<string>();
  @Output() enviarSolicitudPermuta = new EventEmitter<void>();

  get nombreMesSeleccionado(): string {
    const mesObj = this.mesesDisponibles.find((m) => m.valor === this.mesSeleccionado);
    if (mesObj) return mesObj.nombre;
    const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return nombres[this.mesSeleccionado - 1] || `Mes ${this.mesSeleccionado}`;
  }

  get puedeRetrocederMes(): boolean {
    if (this.mesesDisponibles.length <= 1) return false;
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    return idx > 0;
  }

  get puedeAvanzarMes(): boolean {
    if (this.mesesDisponibles.length <= 1) return false;
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    return idx >= 0 && idx < this.mesesDisponibles.length - 1;
  }

  get mesAnteriorNombre(): string {
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    if (idx > 0) return this.mesesDisponibles[idx - 1].nombre;
    return 'Anterior';
  }

  get mesSiguienteNombre(): string {
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    if (idx >= 0 && idx < this.mesesDisponibles.length - 1) return this.mesesDisponibles[idx + 1].nombre;
    return 'Siguiente';
  }

  retrocederMes(): void {
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    if (idx > 0) {
      this.cambiarMes.emit(this.mesesDisponibles[idx - 1].valor);
    }
  }

  avanzarMes(): void {
    const idx = this.mesesDisponibles.findIndex((m) => m.valor === this.mesSeleccionado);
    if (idx >= 0 && idx < this.mesesDisponibles.length - 1) {
      this.cambiarMes.emit(this.mesesDisponibles[idx + 1].valor);
    }
  }

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }

  etiquetaRol(rol?: RolUsuarioSso): string {
    if (rol === 'ADMIN_TH') return 'Talento Humano / Admin';
    if (rol === 'COORDINADOR') return 'Coordinador de Servicio';
    return 'Colaborador Asistencial';
  }

  obtenerConfigTurno(codigo: string): TipoTurnoConfig | undefined {
    return this.catalogoTurnosMap[codigo];
  }

  obtenerServicioDiaPortal(celda?: CeldaAsignacion, srvBaseId?: string): {
    nombre: string;
    esRotacion: boolean;
  } | null {
    if (!celda || !celda.codigo || celda.codigo === 'L') return null;
    const cfg = this.catalogoTurnosMap[celda.codigo];
    if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia) return null;

    const srvEjeId = celda.servicioEjecutorId || srvBaseId;
    const servicio = this.servicios.find((s) => s.id === srvEjeId);
    const esRotacion = Boolean(
      celda.esRotacion || (celda.servicioEjecutorId && celda.servicioEjecutorId !== srvBaseId)
    );

    return {
      nombre: servicio?.nombre || 'Servicio Hospitalario',
      esRotacion,
    };
  }
}
