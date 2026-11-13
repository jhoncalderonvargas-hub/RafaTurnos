import { Component, EventEmitter, Input, Output } from '@angular/core';
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
import {
  esCodigoExoneracionContrato,
  hoyColombiaIso,
} from '../../shared/liquidacion-horas';
import { obtenerTandasBreakDeTurno } from '../../calculo-turnos.helper';

export interface DatosEmpleadoPortal {
  empleado: EmpleadoHospital;
  servicioBase?: ServicioHospitalario;
  celdas: Record<number, CeldaAsignacion>;
  horasTrabajadas: number;
  conteoNoches: number;
  conteoDomFest: number;
  conteoDomingos?: number;
  horasContratadasNominales?: number;
  horasContratadasEfectivas?: number;
  horasExoneradas?: number;
  diasHabilesMes?: number;
  diasHabilesProrrateados?: number;
  diasExonerados?: number;
  horasSemanalesAplicadas?: number;
  empresaCodigo?: string;
  empresaNombre?: string;
  empresaEstadoConfiguracion?: string;
  nuevoSaldoBanco: number;
  diferenciaMes: number;
  [key: string]: any;
}

@Component({
  selector: 'app-portal-colaborador',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './portal-colaborador.component.css',
  template: `
    <div class="nomina-container">
      <div class="nomina-banner">
        <div class="selectors-group">
          <div class="logo-badge" aria-hidden="true">👩‍⚕️</div>
          <div>
            <h2>Mi Calendario Personal de Turnos</h2>
            <div class="portal-meta-row">
              <span class="periodo-tag">📅 {{ nombreMesSeleccionado }} {{ anioSeleccionado }}</span>
              @if (estadoCuadrante === 'PUBLICADO') {
                <span class="periodo-tag periodo-tag-pub">🟢 Publicado Oficial</span>
              } @else if (estadoCuadrante === 'CERRADO_NOMINA') {
                <span class="periodo-tag periodo-tag-cerrado">🔒 Cerrado Nómina</span>
              } @else if (estadoCuadrante === 'BORRADOR') {
                <span class="periodo-tag periodo-tag-borrador">📝 En Borrador (No Oficial)</span>
              } @else {
                <span class="periodo-tag periodo-tag-sin">⚪ Sin Planificar</span>
              }
              <span class="portal-subtitle">Programación individual y gestión de permutas</span>
            </div>
          </div>
        </div>

        <div class="portal-header-controls">
          <div class="control-item">
            <label for="portal-mes-select">Periodo:</label>
            <div class="month-stepper">
              <button
                type="button"
                class="btn-nav-month"
                aria-label="Ir al mes anterior"
                [disabled]="!puedeRetrocederMes"
                (click)="retrocederMes()"
                title="Ir al mes anterior">
                ◀
              </button>
              <select
                id="portal-mes-select"
                class="select-month-input"
                aria-label="Mes del calendario personal"
                [disabled]="mesesDisponibles.length === 0"
                [ngModel]="mesSeleccionado"
                (ngModelChange)="cambiarMes.emit(+$event)">
                @for (m of mesesDisponibles; track m.valor) {
                  <option [value]="m.valor">{{ m.nombre }}</option>
                } @empty {
                  <option [value]="mesSeleccionado">Sin meses publicados</option>
                }
              </select>
              <select
                id="portal-anio-select"
                class="select-month-input"
                aria-label="Año del calendario personal"
                [ngModel]="anioSeleccionado"
                (ngModelChange)="cambiarAnio.emit(+$event)"
                title="Año del calendario">
                @for (a of aniosDisponibles; track a) {
                  <option [value]="a">{{ a }}</option>
                }
              </select>
              <button
                type="button"
                class="btn-nav-month"
                aria-label="Ir al mes siguiente"
                [disabled]="!puedeAvanzarMes"
                (click)="avanzarMes()"
                title="Ir al mes siguiente">
                ▶
              </button>
              <button
                type="button"
                class="btn-hoy-period"
                [class.is-current]="esPeriodoActual"
                [disabled]="esPeriodoActual || !puedeIrAHoy"
                (click)="irAMesActual.emit()"
                [title]="esPeriodoActual ? 'Ya estás viendo el mes actual' : (!puedeIrAHoy ? 'El mes actual aún no tiene programación publicada' : 'Volver al mes actual')">
                {{ esPeriodoActual ? '● Hoy' : 'Hoy' }}
              </button>
            </div>
          </div>

          @if (esAdminTh || esCoordinador) {
            <div class="control-item">
              <label for="portal-emp-select">{{ esAdminTh ? 'Ver calendario de:' : 'Supervisar colaborador:' }}</label>
              <select
                id="portal-emp-select"
                [ngModel]="empleadoPortalId"
                (ngModelChange)="cambiarEmpleadoPortal.emit($event)">
                @for (e of empleados; track e.id) {
                  <option [value]="e.id">{{ e.nombre }} ({{ e.categoria }})</option>
                }
              </select>
            </div>
          } @else {
            <div class="control-item">
              <span class="badge-personal portal-session-pill">
                🔐 Sesión Intranet: <strong>{{ portal.empleado.nombre }}</strong> ({{ etiquetaRol(rolActual) }})
              </span>
            </div>
          }
        </div>
      </div>

      <!-- Banner de Advertencia de Estado del Cuadrante -->
      @if (mesesDisponibles.length > 0 && estadoCuadrante === 'BORRADOR') {
        <div class="portal-alert-banner portal-alert-borrador">
          <span class="portal-alert-icon" aria-hidden="true">⚠️</span>
          <div>
            <strong>Cuadrante en Elaboración (Borrador):</strong> La programación de <strong>{{ nombreMesSeleccionado }} {{ anioSeleccionado }}</strong> para el servicio <strong>{{ portal.servicioBase?.nombre }}</strong> está en fase de diseño por la coordinación y aún no es oficial. Los turnos asignados son preliminares y no admiten permutas hasta su publicación oficial.
          </div>
        </div>
      } @else if (mesesDisponibles.length > 0 && estadoCuadrante === 'SIN_PLANIFICAR') {
        <div class="portal-alert-banner portal-alert-sin">
          <span class="portal-alert-icon" aria-hidden="true">⚪</span>
          <div>
            <strong>Periodo Sin Planificar:</strong> Aún no se ha iniciado la planificación del cuadrante de <strong>{{ nombreMesSeleccionado }} {{ anioSeleccionado }}</strong> para <strong>{{ portal.servicioBase?.nombre }}</strong>. No hay turnos asignados para este mes.
          </div>
        </div>
      }

      @if (mesesDisponibles.length === 0) {
        <div class="empty-portal-container">
          <div class="empty-portal-icon" aria-hidden="true">📅</div>
          <h3 class="empty-portal-title">Sin Cuadrantes Publicados</h3>
          <p class="empty-portal-desc">
            El servicio <strong>{{ portal.servicioBase?.nombre || 'asignado' }}</strong> no tiene programación de turnos publicada oficialmente para el año {{ anioSeleccionado }}.
          </p>
          <div class="empty-portal-sub">
            Tan pronto como la coordinación publique el cuadrante oficial del mes, tus turnos, horarios y la gestión de permutas estarán disponibles aquí.
          </div>
        </div>
      } @else {
        <!-- Bloque 1: Tarjetas de Resumen Personal y Mi Banco de Horas -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Servicio y Cargo</div>
            <div class="kpi-value kpi-value-srv">{{ portal.servicioBase?.nombre || 'Servicio Asistencial' }}</div>
            <div class="kpi-sub">{{ portal.empleado.categoria }} • C.C. {{ portal.empleado.documento }}</div>
            @if (portal.empresaCodigo || portal.empleado.empresaContratante) {
              <div class="portal-empresa-row">
                <span
                  class="portal-empresa-pill"
                  [class.is-pendiente]="portal.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                  [title]="(portal.empresaNombre || portal.empleado.empresaContratante?.nombre || 'Empresa') + ' · Jornada ' + (portal.horasSemanalesAplicadas ?? portal.empleado.horasSemanalesAplicadas ?? 42) + 'h/sem'">
                  🏢 {{ portal.empresaNombre || portal.empleado.empresaContratante?.nombre || portal.empresaCodigo }} · {{ portal.horasSemanalesAplicadas ?? portal.empleado.horasSemanalesAplicadas ?? 42 }}h/sem
                </span>
              </div>
            }
          </div>

          <div class="kpi-card">
            <div class="kpi-label">Horas Programadas en {{ nombreMesSeleccionado }}</div>
            <div
              class="kpi-value"
              [title]="construirTooltipMetaPortal()">
              {{ portal.horasTrabajadas }}h <span class="kpi-contract-sub">/ {{ portal.horasContratadasEfectivas ?? portal.horasContratadasNominales ?? portal.empleado.horasContratoMes }}h</span>
            </div>
            <div class="kpi-sub">
              🌙 {{ portal.conteoNoches }} Noches • ☀️ {{ portal.conteoDomFest }} Dom/Fest ({{ portal.conteoDomingos || 0 }} dom)
              @if ((portal.diasHabilesProrrateados ?? portal.diasExonerados ?? 0) > 0) {
                <span> • 📉 -{{ portal.horasExoneradas || 0 }}h ({{ portal.diasHabilesProrrateados ?? portal.diasExonerados }} d.h.)</span>
              }
            </div>
          </div>

          <div class="kpi-card kpi-card-banco">
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
            <div class="portal-ical-cta">
              <button type="button" class="btn-primary" (click)="abrirModalIcal.emit()">
                📲 Vincular a Google / iPhone
              </button>
            </div>
            <div class="kpi-sub">Se actualiza automáticamente</div>
          </div>
        </div>

        <!-- Bloque 2: Mi Calendario Mensual Personal (Cuadrícula Semanal Lunes a Domingo) -->
        <div class="panel-card">
          <div class="panel-header portal-cal-header">
            <div class="portal-cal-title-cluster">
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
                [class.sun-card]="slot === 6"
                aria-hidden="true">
              </div>
            }

            <!-- Días reales del mes en filas semanales de 7 columnas -->
            @for (d of diasDelMes; track d.dia) {
              @let celdaMia = obtenerCeldaDia(d.dia);
              @let cfgMio = obtenerConfigTurno(celdaMia?.codigo || '');
              @let srvDia = obtenerServicioDiaPortal(celdaMia, portal.empleado.servicioBaseId);
              <div
                class="emp-day-card"
                role="button"
                tabindex="0"
                [attr.aria-pressed]="diaPermutaSeleccionado === d.dia"
                [attr.aria-label]="'Día ' + d.dia + ' de ' + nombreMesSeleccionado + (celdaMia?.codigo ? ', turno ' + celdaMia?.codigo : ', sin turno')"
                [class.selected-day]="diaPermutaSeleccionado === d.dia"
                [class.today-card]="!!d.esHoy"
                [class.sat-card]="d.esSabado"
                [class.sun-card]="d.esDomingo"
                [class.holiday-card]="!!d.festivo"
                [class.support-card]="srvDia?.esRotacion"
                [class.pinned-card]="!!celdaMia?.fijada"
                (click)="seleccionarDiaEnPortal.emit(d.dia)"
                (contextmenu)="onCardContextMenu($event, d.dia)"
                (keydown.f2)="$event.preventDefault(); $event.stopPropagation(); abrirInspectorDiaPortal.emit(d.dia)"
                (keydown.enter)="seleccionarDiaEnPortal.emit(d.dia)"
                (keydown.space)="$event.preventDefault(); seleccionarDiaEnPortal.emit(d.dia)">
                <div class="emp-day-head">
                  <span class="emp-day-num">
                    {{ d.dia }}
                    @if (d.esHoy) {
                      <span class="emp-hoy-tag">Hoy</span>
                    }
                  </span>
                  <div class="emp-day-head-tags">
                    @if (d.festivo) {
                      <span class="emp-festivo-tag" [title]="d.festivo.nombre">🇨🇴 Festivo</span>
                    }
                    @if (srvDia?.esRotacion) {
                      <span class="emp-rot-tag" title="Personal de apoyo en otro servicio">🔄 Apoyo</span>
                    }
                    @if (celdaMia?.fijada) {
                      <span class="emp-pin-tag" title="📌 Turno fijado por coordinación">📌</span>
                    }
                    <button
                      type="button"
                      class="btn-emp-day-info"
                      [attr.aria-label]="'Ver detalle e historial del día ' + d.dia"
                      title="Ver detalle e historial (F2 o clic derecho)"
                      (click)="onInfoDiaClick($event, d.dia)">
                      ℹ️
                    </button>
                  </div>
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

                  @let brkDia = obtenerBreakPortal(celdaMia, cfgMio);
                  @if (brkDia) {
                    <div
                      class="emp-day-break"
                      [class.is-paid]="brkDia.remunerado"
                      [title]="'Break ' + brkDia.etiqueta + ': ' + brkDia.inicio + '–' + brkDia.fin + ' (' + (brkDia.remunerado ? 'Pagado' : 'No computable Art. 167 CST') + ')'">
                      🍽️ {{ brkDia.etiqueta }} · {{ brkDia.inicio }}–{{ brkDia.fin }}@if (brkDia.remunerado) { · ☕}
                    </div>
                  }

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

                @if (celdaMia?.nota) {
                  <div class="emp-day-nota" [title]="celdaMia?.nota || ''">
                    💬 {{ celdaMia?.nota }}
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
                [class.sun-card]="colIdx === 6"
                aria-hidden="true">
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
                <div class="permutas-list portal-permutas-incoming-list">
                  @for (pr of propuestasRecibidas; track pr.id) {
                    <div class="permuta-item permuta-item-incoming">
                      <div class="permuta-main">
                        <div class="permuta-title">
                          <strong>{{ pr.solicitanteNombre }}</strong> te propone intercambiar:
                        </div>
                        <div class="permuta-meta">
                          Día {{ pr.diaOrigen }} ({{ formatearPeriodoPermuta(pr.mes, pr.anio) }}): Su turno <code>{{ pr.turnoOrigen }}</code> por tu turno <code>{{ pr.turnoDestino }}</code>
                        </div>
                        <div class="permuta-validation">
                          ✅ {{ pr.validacionReglas }}
                        </div>
                      </div>
                      <div class="permuta-actions">
                        <button type="button" class="btn-approve" (click)="aceptarPropuestaPar.emit(pr.id)">
                          ✅ Aceptar Propuesta
                        </button>
                        <button type="button" class="btn-reject" (click)="rechazarPropuestaPar.emit(pr.id)">
                          ❌ Declinar
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }

            @let celdaDiaPerm = obtenerCeldaDia(diaPermutaSeleccionado);
            @let cfgDiaPerm = obtenerConfigTurno(celdaDiaPerm?.codigo || '');
            @let esAusenciaDiaPerm = !!(cfgDiaPerm?.esAusencia || esAusenciaCodigo(celdaDiaPerm?.codigo));
            @let turnoBloqueadoPerm = !!(cfgDiaPerm?.bloqueaPermutas && !esAusenciaDiaPerm);
            <p class="panel-desc portal-turno-dia-desc">
              <span>Tu turno el <strong>Día {{ diaPermutaSeleccionado }} de {{ nombreMesSeleccionado }}</strong>:</span>
              @if (celdaDiaPerm?.codigo) {
                <span class="mini-shift">{{ celdaDiaPerm?.codigo }}</span>
                <span class="badge-srv-panel" [class.badge-srv-rot]="servicioDiaSeleccionado.esRotacion" [title]="servicioDiaSeleccionado.esRotacion ? 'Servicio de apoyo rotado' : 'Servicio base asignado'">
                  {{ servicioDiaSeleccionado.esRotacion ? '🔄 ' : '📍 ' }}{{ servicioDiaSeleccionado.nombre }}
                </span>
              } @else {
                <span class="badge-srv-panel badge-srv-unassigned">Sin turno asignado</span>
              }
            </p>

            <div class="form-stack">
              <label for="portal-companero-select">
                Proponer cambio de turno a un compañero el Día {{ diaPermutaSeleccionado }} de {{ nombreMesSeleccionado }}:
              </label>
              @if (estadoCuadrante !== 'PUBLICADO') {
                <div class="portal-notice-box">
                  🔒 <strong>Permutas no disponibles:</strong> Solo se pueden tramitar solicitudes de intercambio de turnos cuando el cuadrante del mes se encuentra <strong>PUBLICADO</strong> oficialmente. Estado actual de {{ nombreMesSeleccionado }}: <em>{{ estadoCuadrante === 'BORRADOR' ? 'En Borrador' : (estadoCuadrante === 'CERRADO_NOMINA' ? 'Cerrado para Nómina' : 'Sin Planificar') }}</em>.
                </div>
              } @else if (!celdaDiaPerm?.codigo) {
                <div class="portal-notice-box">
                  ℹ️ <strong>Día sin turno asignado:</strong> No tienes un turno programado en el Día {{ diaPermutaSeleccionado }}. Solo puedes permutar días en los que tengas un turno oficial asignado.
                </div>
              } @else if (esAusenciaDiaPerm) {
                <div class="portal-notice-danger">
                  🔒 <strong>Novedad Oficial Intranet ({{ celdaDiaPerm?.codigo }}):</strong> Los días con Vacaciones, Incapacidad, Licencia o Día de la Familia están bloqueados y no admiten permutas.
                </div>
              } @else if (turnoBloqueadoPerm) {
                <div class="portal-notice-danger">
                  🔒 <strong>Turno restringido para intercambio ({{ celdaDiaPerm?.codigo }}):</strong> Este tipo de turno está configurado en catálogo para bloquear permutas entre compañeros.
                </div>
              } @else if (celdaDiaPerm?.fijada) {
                <div class="portal-notice-danger">
                  📌 <strong>Celda fijada por coordinación ({{ celdaDiaPerm?.codigo }}):</strong> Este turno está protegido temporalmente por supervisión y no admite propuestas de permuta.
                </div>
              } @else if (companerosPares.length > 0) {
                <select
                  id="portal-companero-select"
                  class="portal-par-select"
                  [ngModel]="companeroPermutaId"
                  (ngModelChange)="cambiarCompaneroPermuta.emit($event)">
                  @for (par of companerosPares; track par.id) {
                    @let turnoPar = obtenerTurnoAsignadoEmpleado(par.id, diaPermutaSeleccionado);
                    <option [value]="par.id">
                      {{ par.nombre }} ({{ par.categoria }}) — Turno {{ turnoPar ? '[' + turnoPar + ']' : '[Sin turno]' }} el Día {{ diaPermutaSeleccionado }}
                    </option>
                  }
                </select>

                <button type="button" class="btn-primary" (click)="enviarSolicitudPermuta.emit()">
                  📨 Enviar Propuesta a Compañero (Paso 1)
                </button>
              } @else {
                <div class="text-muted portal-no-pares">
                  No hay compañeros habilitados con cargo compatible en este servicio para realizar permutas.
                </div>
              }
            </div>

            <div class="portal-sent-section">
              <h4 class="portal-sent-heading">Estado de Mis Solicitudes Enviadas:</h4>
              <div class="permutas-list">
                @for (mp of misSolicitudesEnviadas; track mp.id) {
                  <div class="permuta-item">
                    <div>
                      <div class="permuta-title">
                        Día {{ mp.diaOrigen }} ({{ formatearPeriodoPermuta(mp.mes, mp.anio) }}): Tu turno <code>{{ mp.turnoOrigen }}</code> ⇄ Turno <code>{{ mp.turnoDestino }}</code> con <strong>{{ mp.receptorNombre }}</strong>
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
              <h3>🏥 Compañeros de Turno — Día {{ diaPermutaSeleccionado }} ({{ servicioDiaSeleccionado.nombre || 'Servicio' }})</h3>
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th>Compañero</th>
                  <th>Cargo</th>
                  <th>Turno</th>
                  <th>Horario</th>
                  <th>Break</th>
                </tr>
              </thead>
              <tbody>
                @for (eq of equipoDeGuardiaDia; track eq.empleado.id) {
                  @let cfgEq = obtenerConfigTurno(eq.turno);
                  @let brkEq = obtenerBreakPortal(eq.celda, cfgEq);
                  <tr>
                    <td><strong>{{ eq.empleado.nombre }}</strong></td>
                    <td>{{ eq.empleado.categoria }}</td>
                    <td>
                      <span class="mini-shift" [style.background-color]="cfgEq?.bgHex" [style.color]="cfgEq?.textHex">
                        {{ eq.turno }} — {{ cfgEq?.nombre }}
                      </span>
                    </td>
                    <td class="font-mono">{{ cfgEq?.horario }}</td>
                    <td>
                      @if (brkEq) {
                        <span
                          class="portal-break-pill"
                          [class.is-paid]="brkEq.remunerado"
                          [title]="brkEq.remunerado ? 'Break pagado' : 'No computable Art. 167 CST'">
                          🍽️ {{ brkEq.etiqueta }} · {{ brkEq.inicio }}–{{ brkEq.fin }}
                        </span>
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="text-muted table-empty-cell">No hay otros compañeros en turno activo este día.</td>
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
  @Input() mesSeleccionado = Number(hoyColombiaIso().substring(5, 7));
  @Input() anioSeleccionado = Number(hoyColombiaIso().substring(0, 4));
  @Input() aniosDisponibles: number[] = [];
  @Input() esPeriodoActual = true;
  @Input() puedeIrAHoy = true;
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
  @Input() equipoDeGuardiaDia: Array<{ empleado: EmpleadoHospital; turno: string; celda?: CeldaAsignacion }> = [];

  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarAnio = new EventEmitter<number>();
  @Output() irAMesActual = new EventEmitter<void>();
  @Output() cambiarEmpleadoPortal = new EventEmitter<string>();
  @Output() abrirModalIcal = new EventEmitter<void>();
  @Output() seleccionarDiaEnPortal = new EventEmitter<number>();
  @Output() aceptarPropuestaPar = new EventEmitter<string>();
  @Output() rechazarPropuestaPar = new EventEmitter<string>();
  @Output() cambiarCompaneroPermuta = new EventEmitter<string>();
  @Output() enviarSolicitudPermuta = new EventEmitter<void>();
  @Output() abrirMenuContextualPortal = new EventEmitter<{
    dia: number;
    clientX: number;
    clientY: number;
  }>();
  @Output() abrirInspectorDiaPortal = new EventEmitter<number>();

  onCardContextMenu(event: MouseEvent, dia: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.seleccionarDiaEnPortal.emit(dia);
    this.abrirMenuContextualPortal.emit({
      dia,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }

  onInfoDiaClick(event: MouseEvent, dia: number): void {
    event.stopPropagation();
    this.seleccionarDiaEnPortal.emit(dia);
    this.abrirInspectorDiaPortal.emit(dia);
  }

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

  construirTooltipMetaPortal(): string {
    const p = this.portal as any;
    const empNom = p?.empresaNombre || p?.empleado?.empresaContratante?.nombre || 'Régimen Contractual';
    const hSem = p?.horasSemanalesAplicadas ?? p?.empleado?.horasSemanalesAplicadas ?? 42;
    const dhMes = p?.diasHabilesMes ?? '—';
    const nom = p?.horasContratadasNominales ?? p?.empleado?.horasContratoMes ?? 0;
    const ef = p?.horasContratadasEfectivas ?? nom;
    const dhPror = p?.diasHabilesProrrateados ?? p?.diasExonerados ?? 0;
    const exoneradas = p?.horasExoneradas ?? 0;
    const base = `${empNom} (${hSem}h/sem)\nDías hábiles mes: ${dhMes} d.h. → Meta nominal: ${nom}h`;
    if (dhPror > 0) {
      return `${base}\nProrrateo por días hábiles exonerados: -${dhPror} d.h. (-${exoneradas}h) → Meta efectiva: ${ef}h`;
    }
    return base;
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

  obtenerCeldaDia(dia: number): CeldaAsignacion | undefined {
    return this.portal?.celdas?.[dia];
  }

  obtenerTurnoAsignadoEmpleado(empId: string, dia: number): string | undefined {
    return this.asignaciones[empId]?.[dia]?.codigo;
  }

  esAusenciaCodigo(cod?: string): boolean {
    return esCodigoExoneracionContrato(cod);
  }

  formatearPeriodoPermuta(mes?: number | null, anio?: number | null): string {
    const m = Number(mes ?? this.mesSeleccionado);
    const a = Number(anio ?? this.anioSeleccionado);
    const nombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${nombres[m - 1] || `M${m}`} ${a}`;
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

  obtenerBreakPortal(
    celda?: CeldaAsignacion,
    cfg?: TipoTurnoConfig
  ): { etiqueta: string; inicio: string; fin: string; remunerado: boolean } | null {
    if (!celda?.codigo || !cfg || !cfg.recesoHabilitado || cfg.esAusencia) return null;
    const tandas = obtenerTandasBreakDeTurno(cfg);
    if (tandas.length === 0) return null;
    const orden = celda.breakTandaOrden ?? tandas[0].orden;
    const tMatch = tandas.find((t) => t.orden === orden) || tandas[0];
    return {
      etiqueta: tMatch.etiqueta || `T${tMatch.orden}`,
      inicio: celda.breakInicio || tMatch.inicio,
      fin: celda.breakFin || tMatch.fin,
      remunerado: Boolean(cfg.recesoRemunerado),
    };
  }
}
