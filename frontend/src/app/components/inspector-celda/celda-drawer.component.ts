import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, Subject, switchMap } from 'rxjs';
import {
  AuditoriaCeldaItem,
  AuditoriaCeldaRespuesta,
  CeldaAsignacion,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  InfraccionNormativa,
  NOMBRES_MESES,
  ServicioHospitalario,
  TargetCeldaInspector,
  TipoTurnoConfig,
} from '../../models';
import {
  obtenerTandasBreakDeTurno,
  predicadoDescansoObligatorio,
  reglasEmpresaDeEmpleado,
} from '../../calculo-turnos.helper';
import {
  calcularDescansoEntreTurnosMin,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  HorasLiquidadas,
  liquidarTurno,
  obtenerHorasAmortizacionTurno,
} from '../../shared/liquidacion-horas';
import { TurnosApiService } from '../../turnos-api.service';
import { CuadranteStore, ResumenTandasBreakDia } from '../../stores/cuadrante.store';

@Component({
  selector: 'app-celda-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './celda-drawer.component.css',
  template: `
    @if (target) {
      <div
        class="drawer-backdrop"
        (click)="cerrar.emit()"
        aria-hidden="true">
      </div>

      <aside
        #drawerPanel
        class="celda-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Inspector detallado de celda">
        <!-- CABECERA STICKY CON NAVEGACIÓN ◀ / ▶ -->
        <header class="drawer-header">
          <div class="drawer-header-top">
            <div class="drawer-day-nav">
              <button
                type="button"
                class="btn-day-nav"
                aria-label="Día anterior"
                [disabled]="target.dia <= 1"
                (click)="navegarDia.emit(target.dia - 1)"
                title="Día anterior">
                ◀
              </button>
              <span class="drawer-date-badge">
                {{ diaSemanaLargo }} {{ target.dia }} de {{ nombreMes }} {{ anio }}
              </span>
              <button
                type="button"
                class="btn-day-nav"
                aria-label="Día siguiente"
                [disabled]="target.dia >= diasDelMes.length"
                (click)="navegarDia.emit(target.dia + 1)"
                title="Día siguiente">
                ▶
              </button>
            </div>
            <button
              type="button"
              class="btn-drawer-close"
              aria-label="Cerrar inspector (Esc)"
              (click)="cerrar.emit()"
              title="Cerrar (Esc)">
              ✕
            </button>
          </div>

          <div class="drawer-emp-title-row">
            <h3 class="drawer-emp-name" [title]="empleado?.nombre || 'Colaborador'">
              {{ empleado?.nombre || 'Colaborador' }}
            </h3>
            @if (empleado?.empresaContratante?.codigo || empleado?.horasSemanalesAplicadas) {
              <span class="drawer-regimen-chip">
                {{ empleado?.empresaContratante?.codigo || 'CST' }} ·
                {{ empleado?.horasSemanalesAplicadas ?? empleado?.empresaContratante?.horasSemanalesContrato ?? 42 }}h/sem
              </span>
            }
          </div>

          <div class="drawer-meta-chips">
            <span class="drawer-submeta">{{ empleado?.categoria || 'Asistencial' }}</span>
            <span class="drawer-dot">•</span>
            <span class="drawer-estado-pill" [attr.data-estado]="estadoEfectivoCuadrante">
              {{ etiquetaEstado(estadoEfectivoCuadrante) }}
            </span>
            @if (diaColumna?.festivo) {
              <span class="drawer-chip chip-holiday" [title]="diaColumna?.festivo?.nombre || ''">
                🇨🇴 {{ diaColumna?.festivo?.nombre }}
              </span>
            } @else if (diaColumna?.esDomingo) {
              <span class="drawer-chip chip-sunday">☀️ Domingo</span>
            }
            @if (esFijada) {
              <span class="drawer-chip chip-pin" title="Protegida contra lotes, autocompletar y permutas">
                📌 Fijada
              </span>
            }
            @if (notaEfectiva) {
              <span class="drawer-chip chip-note">💬 Nota</span>
            }
          </div>
        </header>

        <div class="drawer-body">
          <!-- =============================================================== -->
          <!-- BLOQUE 1: RESUMEN OPERATIVO Y NORMATIVO (COMPACTO)              -->
          <!-- =============================================================== -->
          <section class="drawer-block">
            <div class="block-title-row">
              <h4>1. Resumen operativo y normativo</h4>
              @if (codigoPrevistoEfectivo !== undefined && codigoPrevistoEfectivo !== codigoActual) {
                <span class="previsto-diff-pill" title="Turno programado originalmente antes de ajustes publicados">
                  Previsto: {{ codigoPrevistoEfectivo || 'Vacío' }}
                </span>
              }
            </div>

            <div class="shift-summary-card">
              <div class="shift-main-badge-row">
                <span
                  class="drawer-shift-badge"
                  [style.background-color]="cfgActual?.bgHex || '#f1f5f9'"
                  [style.color]="cfgActual?.textHex || '#334155'"
                  [style.border-color]="cfgActual?.borderHex || '#cbd5e1'">
                  {{ codigoActual || '—' }}
                </span>
                <div class="shift-info-text">
                  <div class="shift-name">{{ cfgActual?.nombre || 'Sin turno asignado' }}</div>
                  <div class="shift-hours-range">
                    {{ cfgActual?.horario || 'Libre / sin asignación operativa' }}
                    @if (infoBreakActual; as brk) {
                      · Break {{ brk.etiqueta }} ({{ brk.inicio }}–{{ brk.fin }}) · {{ brk.remunerado ? 'Pagado' : 'Art. 167 CST' }}
                    } @else if (cfgActual?.minutosAlmuerzo) {
                      · -{{ cfgActual?.minutosAlmuerzo }}m almuerzo
                    }
                  </div>
                </div>
                <div class="shift-total-pill font-mono">
                  <strong>{{ liquidacionDia.total }}h</strong>
                  <span>liq.</span>
                </div>
              </div>

              <div class="liq-breakdown-grid font-mono">
                <div class="liq-item" [class.has-val]="liquidacionDia.hod > 0">
                  <span class="liq-lbl">HOD</span>
                  <span class="liq-val">{{ liquidacionDia.hod }}h</span>
                </div>
                <div class="liq-item" [class.has-val]="liquidacionDia.hon > 0">
                  <span class="liq-lbl">HON</span>
                  <span class="liq-val">{{ liquidacionDia.hon }}h</span>
                </div>
                <div class="liq-item" [class.has-val]="liquidacionDia.hdfd > 0">
                  <span class="liq-lbl">HDFD</span>
                  <span class="liq-val">{{ liquidacionDia.hdfd }}h</span>
                </div>
                <div class="liq-item" [class.has-val]="liquidacionDia.hdfn > 0">
                  <span class="liq-lbl">HDFN</span>
                  <span class="liq-val">{{ liquidacionDia.hdfn }}h</span>
                </div>
              </div>

              @if (horasAmortizacionComp > 0) {
                <div class="drawer-comp-amort">
                  🏦 Compensatorio: amortiza <strong>-{{ horasAmortizacionComp }}h</strong> del Banco de Horas.
                </div>
              }
            </div>

            @if (infoBreakActual; as brk) {
              <div class="drawer-break-card" [class.has-overlap]="resumenTandasBreakDia?.tieneAlerta">
                <div class="drawer-break-head">
                  <span class="drawer-break-title">🍽️ Break / Almuerzo asignado</span>
                  <span class="drawer-break-mode-badge" [class.is-paid]="brk.remunerado">
                    {{ brk.remunerado ? '☕ Pagado (0h desc.)' : '⏱️ No computable Art. 167 CST' }}
                  </span>
                </div>
                <div class="drawer-break-current font-mono">
                  <strong>{{ brk.etiqueta }}</strong> · {{ brk.inicio }} – {{ brk.fin }}
                </div>

                @if (!esSoloLectura && !esCeldaEspejo && resumenTandasBreakDia) {
                  <div class="drawer-tandas-pills">
                    @for (t of resumenTandasBreakDia.tandas; track t.orden) {
                      <button
                        type="button"
                        class="drawer-tanda-btn"
                        [class.is-active]="t.orden === brk.orden"
                        [class.is-overlap]="t.enAlerta"
                        [disabled]="!puedeEditarTurno"
                        (click)="onSeleccionarTandaBreak(t.orden)"
                        [title]="t.etiqueta + ': ' + t.inicio + '–' + t.fin + ' (' + t.asignados + ' de máx. ' + t.maxSimultaneos + ' simultáneos)'">
                        <span class="dt-ord">{{ t.etiqueta }}</span>
                        <span class="dt-time font-mono">{{ t.inicio }}–{{ t.fin }}</span>
                        <span class="dt-occ" [class.is-over]="t.enAlerta">{{ t.asignados }}/{{ t.maxSimultaneos }}</span>
                      </button>
                    }
                  </div>

                  @if (resumenTandasBreakDia.tandas.length > 1 || resumenTandasBreakDia.tieneAlerta) {
                    <div class="drawer-break-actions">
                      <button
                        type="button"
                        class="btn-drawer-secondary btn-balance-breaks"
                        [disabled]="esCerrado"
                        (click)="onRebalancearBreaksDia()"
                        title="Redistribuir automáticamente las tandas de break del servicio en este día respetando celdas fijadas">
                        ⚖️ Balancear tandas del día
                      </button>
                    </div>
                  }
                }
              </div>
            }

            <!-- Secuencia Ayer -> Hoy -> Mañana con cálculo exacto de descanso -->
            <div class="sequence-strip">
              <div class="seq-day">
                <span class="seq-lbl">{{ target.dia === 1 ? 'Cierre prev.' : 'Ayer (' + (target.dia - 1) + ')' }}</span>
                <span class="seq-code">{{ codigoDiaAnterior || '—' }}</span>
              </div>
              <div class="seq-gap" [class.seq-danger]="descansoEntrada.infraccion" [title]="descansoEntrada.detalle">
                <span class="seq-arrow">→</span>
                <span class="seq-rest">{{ descansoEntrada.etiqueta }}</span>
              </div>
              <div class="seq-day seq-today">
                <span class="seq-lbl">Hoy ({{ target.dia }})</span>
                <span class="seq-code">{{ codigoActual || '—' }}</span>
              </div>
              <div class="seq-gap" [class.seq-danger]="descansoSalida.infraccion" [title]="descansoSalida.detalle">
                <span class="seq-arrow">→</span>
                <span class="seq-rest">{{ descansoSalida.etiqueta }}</span>
              </div>
              <div class="seq-day">
                <span class="seq-lbl">
                  {{ target.dia >= diasDelMes.length ? 'Fin mes' : 'Mañana (' + (target.dia + 1) + ')' }}
                </span>
                <span class="seq-code">
                  {{ target.dia >= diasDelMes.length ? '—' : (celdaDiaSiguiente?.codigo || '—') }}
                </span>
              </div>
            </div>

            @if (infraccionesCelda.length > 0) {
              <div class="drawer-alerts-box">
                @for (inf of infraccionesCelda; track inf.mensaje) {
                  <div class="drawer-alert-line">⚠️ {{ inf.mensaje }}</div>
                }
              </div>
            }

            @if (esCeldaEspejo) {
              <div class="drawer-banner banner-mirror">
                📍 <strong>Celda Espejo:</strong> ejecutado en <strong>{{ nombreServicio(srvEjecutorEfectivo) }}</strong>. Suma a las horas contractuales, no a la cobertura local de {{ servicioActual?.codigo || 'este servicio' }}.
              </div>
            } @else if (esApoyoEnEsteServicio) {
              <div class="drawer-banner banner-support">
                🔄 <strong>Personal de apoyo:</strong> proviene de <strong>{{ nombreServicio(empleado?.servicioBaseId) }}</strong> y ejecuta hoy en <strong>{{ nombreServicio(srvEjecutorEfectivo) }}</strong>.
              </div>
            }

            @if (apiData?.ausencia) {
              <div class="drawer-absence-card">
                <div class="abs-head">
                  <strong>🔒 Novedad Oficial RRHH: {{ apiData?.ausencia?.tipo }}</strong>
                  <span>{{ apiData?.ausencia?.fechaInicio }} → {{ apiData?.ausencia?.fechaFin }}</span>
                </div>
                @if (esAdminTh && apiData?.ausencia?.codigoCie10) {
                  <div class="abs-cie10">
                    🩺 CIE-10 (solo Talento Humano): <code>{{ apiData?.ausencia?.codigoCie10 }}</code>
                  </div>
                }
              </div>
            }
          </section>

          <!-- =============================================================== -->
          <!-- BLOQUE 2: CAMBIOS REALIZADOS (HISTORIAL CHRONOLÓGICO + PERMUTAS) -->
          <!-- =============================================================== -->
          <section class="drawer-block">
            <div class="block-title-row">
              <h4>2. Cambios realizados</h4>
              @if (!esSoloLectura) {
                <div class="timeline-filter-pills">
                  <button
                    type="button"
                    class="tl-pill"
                    [class.active]="filtroFaseTimeline === 'TODOS'"
                    (click)="filtroFaseTimeline = 'TODOS'">
                    Todos
                  </button>
                  <button
                    type="button"
                    class="tl-pill"
                    [class.active]="filtroFaseTimeline === 'PUBLICADO'"
                    (click)="filtroFaseTimeline = 'PUBLICADO'">
                    Solo Publicado
                  </button>
                </div>
              }
            </div>

            @if (cargandoHistorial) {
              <div class="timeline-status">Cargando historial desde PostgreSQL...</div>
            } @else if (errorHistorial) {
              <div class="timeline-error">
                <span>{{ errorHistorial }}</span>
                <button type="button" class="btn-retry-tl" (click)="recargarHistorial()">Reintentar</button>
              </div>
            } @else {
              @if (historialVisible.length === 0) {
                <div class="timeline-empty">
                  @if (esSoloLectura) {
                    Sin modificaciones registradas desde la publicación del cuadrante para este día.
                  } @else {
                    Sin movimientos de auditoría registrados en esta celda aún.
                  }
                </div>
              } @else {
                <ul class="timeline-list">
                  @for (ev of historialVisible; track ev.id) {
                    <li class="timeline-item" [class.is-draft]="ev.faseCuadrante === 'BORRADOR'">
                      <div class="tl-meta-top">
                        <span class="tl-phase" [attr.data-fase]="ev.faseCuadrante">
                          {{ ev.faseCuadrante === 'BORRADOR' ? 'Borrador' : (ev.faseCuadrante === 'CERRADO_NOMINA' ? 'Cerrado' : 'Publicado') }}
                        </span>
                        <span class="tl-origin">{{ formatearOrigen(ev.origenAccion) }}</span>
                        @if (ev.esDetalleLote) {
                          <span class="tl-batch-tag" title="Parte de operación en bloque">Lote</span>
                        }
                        <span class="tl-time font-mono">{{ ev.timestamp }}</span>
                      </div>

                      <div class="tl-transition-row">
                        <span class="tl-actor">{{ ev.actor }}</span>
                        <span class="tl-trans-pill font-mono">
                          {{ ev.turnoAnterior || '—' }} → <strong>{{ ev.turnoNuevo || '—' }}</strong>
                        </span>
                      </div>

                      <div class="tl-justification">{{ ev.justificacion }}</div>
                    </li>
                  }
                </ul>
              }

              @if ((apiData?.permutas?.length || 0) > 0) {
                <div class="drawer-permutas-sub">
                  <div class="sub-permutas-title">🔄 Permutas asociadas a este día</div>
                  @for (p of apiData?.permutas || []; track p.id) {
                    <div class="sub-permuta-row">
                      <div>
                        <strong>{{ p.solicitanteNombre }}</strong> ({{ p.turnoOrigen }}) ⇄
                        <strong>{{ p.receptorNombre }}</strong> ({{ p.turnoDestino }})
                      </div>
                      <div class="sub-permuta-meta">
                        <span>{{ p.fechaSolicitud }}</span>
                        <span class="sub-perm-state" [attr.data-state]="p.estado">{{ p.estado }}</span>
                      </div>
                      @if (p.motivoRechazo) {
                        <div class="sub-perm-reject">Motivo: {{ p.motivoRechazo }}</div>
                      }
                    </div>
                  }
                </div>
              }
            }
          </section>

          <!-- =============================================================== -->
          <!-- BLOQUE 3: EDICIÓN RÁPIDA Y NOTA / MODO PORTAL LECTURA           -->
          <!-- =============================================================== -->
          @if (!esSoloLectura) {
            <section class="drawer-block" id="inspector-sec-edicion">
              <div class="block-title-row">
                <h4>3. Edición rápida y nota de celda</h4>
              </div>

              @if (esCerrado) {
                <div class="drawer-banner banner-locked">
                  🔒 Cuadrante <strong>Cerrado para Nómina</strong>. Reábrelo para editar turnos o notas.
                </div>
              } @else if (esAusencia) {
                <div class="drawer-banner banner-locked">
                  🔒 Celda bloqueada por novedad oficial de <strong>Gestión Humana</strong>.
                </div>
              } @else if (esCeldaEspejo) {
                <div class="drawer-banner banner-mirror">
                  📍 Celda Espejo: abre el servicio <strong>{{ nombreServicio(srvEjecutorEfectivo) }}</strong> para editar el turno o su nota.
                </div>
              } @else {
                @if (esFijada) {
                  <div class="drawer-banner banner-pinned">
                    <span>📌 Celda protegida frente a ediciones rápidas.</span>
                    <button
                      type="button"
                      class="btn-inline-unlock"
                      (click)="onAlternarFijacion()">
                      🔓 Desfijar ahora
                    </button>
                  </div>
                }

                <div class="drawer-form-stack">
                  <label class="drawer-field-label" for="drawer-select-turno">Asignar turno:</label>
                  <select
                    id="drawer-select-turno"
                    #selectTurnoInput
                    class="drawer-select"
                    [disabled]="!puedeEditarTurno"
                    [(ngModel)]="turnoSeleccionado">
                    <option value="">— Vacío (Limpiar) —</option>
                    @for (t of turnosDisponiblesEdicion; track t.codigo) {
                      <option [value]="t.codigo">
                        {{ t.codigo }} — {{ t.nombre }} ({{ t.horario }})
                      </option>
                    }
                  </select>

                  <label class="drawer-field-label" for="drawer-justificacion-input">
                    Justificación (opcional):
                  </label>
                  <input
                    id="drawer-justificacion-input"
                    type="text"
                    class="drawer-input"
                    maxlength="240"
                    [disabled]="!puedeEditarTurno"
                    [(ngModel)]="justificacionEdit"
                    placeholder="Motivo del ajuste..." />
                  <div class="drawer-transparency-note">
                    👁️ Transparencia (Opción B): si el cuadrante está <strong>Publicado</strong>, la justificación será visible en auditoría y para el colaborador.
                  </div>

                  <div class="drawer-btn-row">
                    <button
                      type="button"
                      class="btn-drawer-primary"
                      [disabled]="!puedeEditarTurno || turnoSeleccionado === codigoActual"
                      (click)="onAplicarCambioTurno()">
                      ✅ Aplicar cambio
                    </button>
                    @if (mostrarRevertirPrevisto) {
                      <button
                        type="button"
                        class="btn-drawer-secondary"
                        [disabled]="!puedeEditarTurno"
                        (click)="onRevertirPrevisto()"
                        [title]="'Restaurar previsto: ' + (codigoPrevistoEfectivo || 'Vacío')">
                        ↩️ Revertir a {{ codigoPrevistoEfectivo || 'Vacío' }}
                      </button>
                    }
                    @if (codigoActual) {
                      <button
                        type="button"
                        class="btn-drawer-ghost"
                        [disabled]="!puedeEditarTurno"
                        (click)="onLimpiarTurno()"
                        title="Dejar celda sin turno asignado">
                        🧹 Limpiar
                      </button>
                    }
                  </div>
                </div>
              }

              <!-- Subsección Nota persistente de celda -->
              <div class="drawer-subsection" id="inspector-sec-nota">
                <div class="subsection-head">
                  <label class="drawer-field-label" for="drawer-nota-textarea">
                    💬 Nota de celda (colaborador + .ics)
                  </label>
                  <span class="char-counter font-mono">{{ notaDraft.length }}/500</span>
                </div>
                <textarea
                  id="drawer-nota-textarea"
                  #notaTextarea
                  rows="3"
                  maxlength="500"
                  class="drawer-textarea"
                  [disabled]="esCerrado || esCeldaEspejo"
                  [(ngModel)]="notaDraft"
                  placeholder="Indicaciones operativas de la celda (ej. Inicia en piso 2, cubre triage 10-12h)..."></textarea>
                <div class="drawer-btn-row">
                  <button
                    type="button"
                    class="btn-drawer-secondary"
                    [disabled]="esCerrado || esCeldaEspejo || notaDraft.trim() === notaActualLim"
                    (click)="onGuardarNota()">
                    💾 Guardar nota
                  </button>
                  @if (notaActualLim) {
                    <button
                      type="button"
                      class="btn-drawer-ghost"
                      [disabled]="esCerrado || esCeldaEspejo"
                      (click)="onQuitarNota()">
                      🗑️ Quitar nota
                    </button>
                  }
                </div>
              </div>
            </section>
          } @else {
            <!-- BLOQUE 3 PARA COLABORADOR / PORTAL (SOLO LECTURA + PERMUTA) -->
            <section class="drawer-block" id="inspector-sec-nota">
              <div class="block-title-row">
                <h4>3. Nota y acciones de colaborador</h4>
              </div>

              @if (notaEfectiva) {
                <div class="portal-nota-card">
                  <div class="portal-nota-label">💬 Nota operativa de coordinación</div>
                  <div class="portal-nota-text">{{ notaEfectiva }}</div>
                </div>
              } @else {
                <div class="timeline-empty">No hay notas operativas en este día.</div>
              }

              <div class="drawer-portal-actions">
                <button
                  type="button"
                  class="btn-drawer-primary"
                  [disabled]="!puedePermutarPortal"
                  (click)="onProponerPermutaPortal()">
                  🔄 Proponer Permuta este día
                </button>
                @if (!puedePermutarPortal && motivoNoPermutaPortal) {
                  <div class="portal-permuta-hint">{{ motivoNoPermutaPortal }}</div>
                }
              </div>
            </section>
          }

          <!-- =============================================================== -->
          <!-- BLOQUE 4: CONTROLES AVANZADOS (SOLO COORDINADOR / ADMIN_TH)     -->
          <!-- =============================================================== -->
          @if (!esSoloLectura) {
            <section class="drawer-block">
              <div class="block-title-row">
                <h4>4. Controles avanzados</h4>
              </div>

              <div class="adv-control-card">
                <div class="adv-text">
                  <strong>{{ esFijada ? '📌 Celda Fijada' : '🔓 Celda Desbloqueada' }}</strong>
                  <span>
                    Impide cambios por Autocompletar, Limpiar cuadrante, pintado/arrastre accidental, Ctrl+Z/Ctrl+Y y permutas.
                  </span>
                </div>
                <button
                  type="button"
                  [class]="esFijada ? 'btn-drawer-warning' : 'btn-drawer-secondary'"
                  [disabled]="!puedeAlternarFijacion"
                  (click)="onAlternarFijacion()">
                  {{ esFijada ? '🔓 Desfijar' : '📌 Fijar celda' }}
                </button>
              </div>

              <!-- Apoyo puntual 1 día -->
              <div class="drawer-subsection" id="inspector-sec-apoyo">
                <div class="subsection-head">
                  <span class="drawer-field-label">🔄 Apoyo puntual 1 día (otro servicio)</span>
                </div>

                @if (esCerrado || esAusencia) {
                  <div class="drawer-readonly-hint">
                    No disponible porque el periodo está cerrado o tiene una novedad oficial.
                  </div>
                } @else if (esFijada) {
                  <div class="drawer-readonly-hint">
                    📌 Desfija la celda primero para mover o liberar apoyo puntual.
                  </div>
                } @else {
                  @if (enServicioDistintoABase) {
                    <div class="apoyo-active-box">
                      <span>
                        Ejecución actual en <strong>{{ nombreServicio(srvEjecutorEfectivo) }}</strong>
                        (base: {{ nombreServicio(empleado?.servicioBaseId) }}).
                      </span>
                      @if (puedeLiberarApoyoABase) {
                        <button
                          type="button"
                          class="btn-drawer-secondary"
                          (click)="onLiberarApoyo()">
                          🏠 Liberar apoyo y retornar a base
                        </button>
                      } @else {
                        <span class="drawer-readonly-hint">
                          Requiere permisos de coordinación sobre ambos servicios o perfil Talento Humano.
                        </span>
                      }
                    </div>
                  }

                  @if (serviciosCompatiblesApoyo.length > 0 && puedeMoverDesdeVistaActual) {
                    <div class="drawer-form-stack">
                      <label class="drawer-field-label" for="drawer-apoyo-servicio">
                        Enviar apoyo este día a:
                      </label>
                      <select
                        id="drawer-apoyo-servicio"
                        #apoyoSelect
                        class="drawer-select"
                        [(ngModel)]="apoyoDestinoId">
                        <option value="">Selecciona servicio compatible...</option>
                        @for (srv of serviciosCompatiblesApoyo; track srv.id) {
                          <option [value]="srv.id">{{ srv.nombre }} ({{ srv.codigo }})</option>
                        }
                      </select>

                      <label class="drawer-field-label" for="drawer-apoyo-turno">
                        Turno operativo de apoyo:
                      </label>
                      <select
                        id="drawer-apoyo-turno"
                        class="drawer-select"
                        [(ngModel)]="turnoApoyoCodigo">
                        @for (t of turnosOperativosApoyo; track t.codigo) {
                          <option [value]="t.codigo">
                            {{ t.codigo }} — {{ t.nombre }} ({{ t.horario }})
                          </option>
                        }
                      </select>

                      <button
                        type="button"
                        class="btn-drawer-primary"
                        [disabled]="!apoyoDestinoId || !turnoApoyoCodigo"
                        (click)="onEnviarApoyo()">
                        🔄 Asignar apoyo puntual
                      </button>
                    </div>
                  } @else if (!enServicioDistintoABase) {
                    <div class="drawer-readonly-hint">
                      @if (esCoordinador && !esAdminTh) {
                        No hay otros servicios bajo tu coordinación compatibles con el cargo "{{ empleado?.categoria }}".
                      } @else {
                        No hay otros servicios compatibles con el cargo "{{ empleado?.categoria }}".
                      }
                    </div>
                  }
                }
              </div>
            </section>
          }
        </div>
      </aside>
    }
  `,
})
export class CeldaDrawerComponent implements OnInit, OnChanges {
  private readonly api = inject(TurnosApiService);
  private readonly cuadrante = inject(CuadranteStore);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('drawerPanel') drawerPanelRef?: ElementRef<HTMLElement>;
  @ViewChild('notaTextarea') notaTextareaRef?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('apoyoSelect') apoyoSelectRef?: ElementRef<HTMLSelectElement>;
  @ViewChild('selectTurnoInput') selectTurnoRef?: ElementRef<HTMLSelectElement>;

  @Input() target: TargetCeldaInspector | null = null;
  @Input() anio = 2026;
  @Input() mes = 1;
  @Input() diasDelMes: DiaColumna[] = [];
  @Input() empleado?: EmpleadoHospital;
  @Input() celda?: CeldaAsignacion;
  @Input() codigoDiaAnterior: CodigoTurno = 'L';
  @Input() celdaDiaSiguiente?: CeldaAsignacion;
  @Input() infraccionesActivas: InfraccionNormativa[] = [];
  @Input() servicioActual?: ServicioHospitalario;
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() serviciosVisibles: ServicioHospitalario[] = [];
  @Input() turnosPaleta: TipoTurnoConfig[] = [];
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};
  @Input() estadoCuadrante: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | 'SIN_PLANIFICAR' = 'BORRADOR';
  @Input() esAdminTh = false;
  @Input() esCoordinador = false;
  @Input() esColaborador = false;
  @Input() resumenTandasBreakDia: ResumenTandasBreakDia | null = null;

  @Output() cerrar = new EventEmitter<void>();
  @Output() navegarDia = new EventEmitter<number>();
  @Output() aplicarTurno = new EventEmitter<{
    empId: string;
    dia: number;
    codigo: CodigoTurno;
    justificacion?: string;
  }>();
  @Output() revertirAPrevisto = new EventEmitter<{
    empId: string;
    dia: number;
    justificacion?: string;
  }>();
  @Output() guardarNota = new EventEmitter<{ empId: string; dia: number; nota: string }>();
  @Output() alternarFijacion = new EventEmitter<{ empId: string; dia: number }>();
  @Output() cambiarBreakTanda = new EventEmitter<{ empId: string; dia: number; tandaOrden: number }>();
  @Output() rebalancearBreaksDia = new EventEmitter<{ dia: number; codigoTurno?: string }>();
  @Output() asignarApoyo = new EventEmitter<{
    empId: string;
    dia: number;
    servicioDestinoId: string | null;
    codigoTurno?: CodigoTurno;
    justificacion?: string;
  }>();
  @Output() irAPermutaDia = new EventEmitter<number>();

  apiData: AuditoriaCeldaRespuesta | null = null;
  cargandoHistorial = false;
  errorHistorial = '';
  filtroFaseTimeline: 'TODOS' | 'PUBLICADO' = 'TODOS';

  turnoSeleccionado: CodigoTurno = '';
  justificacionEdit = '';
  notaDraft = '';
  apoyoDestinoId = '';
  turnoApoyoCodigo: CodigoTurno = '';

  private readonly reloadTrigger$ = new Subject<{ empId: string; fechaIso: string }>();

  ngOnInit(): void {
    this.reloadTrigger$
      .pipe(
        switchMap((req) => {
          this.cargandoHistorial = true;
          this.errorHistorial = '';
          return this.api.obtenerAuditoriaCelda(req.empId, req.fechaIso).pipe(
            catchError((err) => {
              this.errorHistorial =
                err?.error?.message || 'No se pudo cargar la trazabilidad de esta celda.';
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.cargandoHistorial = false;
        if (res) {
          this.apiData = res;
          if (res.celda?.nota !== undefined && res.celda?.nota !== null && !this.notaDraft) {
            this.notaDraft = res.celda.nota;
          }
        }
      });

    this.cuadrante.celdaHistorialActualizada$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ev) => {
        if (!this.target) return;
        const coincide =
          !ev.empId ||
          (ev.empId === this.target.empId && (!ev.dia || ev.dia === this.target.dia));
        if (coincide) {
          this.recargarHistorial();
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.target) {
      this.apiData = null;
      this.errorHistorial = '';
      return;
    }

    const cambioTarget = Boolean(changes['target']);
    const cambioPeriodo = Boolean(changes['anio'] || changes['mes']);

    if (cambioTarget || cambioPeriodo || changes['celda']) {
      this.sincronizarFormularioLocal();
    }

    if (cambioTarget || cambioPeriodo) {
      this.apiData = null;
      this.recargarHistorial();
      if (this.target.focoSeccion) {
        setTimeout(() => this.enfocarSeccionSolicitada(this.target?.focoSeccion), 40);
      }
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (!this.target) return;
    event.preventDefault();
    event.stopPropagation();
    this.cerrar.emit();
  }

  recargarHistorial(): void {
    if (!this.target) return;
    const fechaIso = this.fechaIsoActual;
    if (!fechaIso) return;
    this.reloadTrigger$.next({ empId: this.target.empId, fechaIso });
  }

  private sincronizarFormularioLocal(): void {
    this.turnoSeleccionado = this.celda?.codigo || '';
    this.notaDraft = this.celda?.nota || '';
    this.justificacionEdit = '';
    this.apoyoDestinoId = '';

    const cfgAct = this.cfgActual;
    if (cfgAct && !cfgAct.esAusencia && cfgAct.horasOrdinarias > 0) {
      this.turnoApoyoCodigo = cfgAct.codigo;
    } else {
      this.turnoApoyoCodigo = this.turnosOperativosApoyo[0]?.codigo || 'M8';
    }
  }

  private enfocarSeccionSolicitada(seccion?: 'NOTA' | 'APOYO' | 'EDICION'): void {
    if (!seccion) return;
    const idMap: Record<string, string> = {
      NOTA: 'inspector-sec-nota',
      APOYO: 'inspector-sec-apoyo',
      EDICION: 'inspector-sec-edicion',
    };
    const secEl = document.getElementById(idMap[seccion]);
    if (secEl) {
      secEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (seccion === 'NOTA' && this.notaTextareaRef?.nativeElement && !this.notaTextareaRef.nativeElement.disabled) {
      this.notaTextareaRef.nativeElement.focus();
    } else if (seccion === 'APOYO' && this.apoyoSelectRef?.nativeElement) {
      this.apoyoSelectRef.nativeElement.focus();
    } else if (seccion === 'EDICION' && this.selectTurnoRef?.nativeElement && !this.selectTurnoRef.nativeElement.disabled) {
      this.selectTurnoRef.nativeElement.focus();
    }
  }

  get nombreMes(): string {
    return NOMBRES_MESES[this.mes] || `Mes ${this.mes}`;
  }

  get diaColumna(): DiaColumna | undefined {
    if (!this.target) return undefined;
    return this.diasDelMes.find((d) => d.dia === this.target!.dia);
  }

  get fechaIsoActual(): string {
    if (this.diaColumna?.fechaIso) return this.diaColumna.fechaIso;
    if (!this.target) return '';
    return `${this.anio}-${String(this.mes).padStart(2, '0')}-${String(this.target.dia).padStart(2, '0')}`;
  }

  get diaSemanaLargo(): string {
    if (!this.fechaIsoActual) return '';
    const dt = new Date(`${this.fechaIsoActual}T00:00:00.000Z`);
    const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return dias[dt.getUTCDay()] || '';
  }

  get esSoloLectura(): boolean {
    return this.esColaborador || this.target?.origenVista === 'PORTAL';
  }

  get estadoEfectivoCuadrante(): string {
    if (this.estadoCuadrante && this.estadoCuadrante !== 'SIN_PLANIFICAR') {
      return this.estadoCuadrante;
    }
    return this.apiData?.celda?.estadoCuadrante || this.estadoCuadrante || 'SIN_PLANIFICAR';
  }

  get codigoActual(): CodigoTurno {
    return (this.celda?.codigo || '') as CodigoTurno;
  }

  get codigoPrevistoEfectivo(): CodigoTurno | undefined {
    if (this.celda?.previsto !== undefined) return this.celda.previsto;
    if (this.apiData?.celda?.codigoPrevisto !== undefined && this.apiData.celda.codigoPrevisto !== null) {
      return this.apiData.celda.codigoPrevisto as CodigoTurno;
    }
    return undefined;
  }

  get cfgActual(): TipoTurnoConfig | undefined {
    return this.codigoActual ? this.catalogoTurnosMap[this.codigoActual] : undefined;
  }

  get esAusencia(): boolean {
    return Boolean(
      this.cfgActual?.esAusencia ||
        esCodigoExoneracionContrato(this.codigoActual) ||
        this.apiData?.ausencia
    );
  }

  get esCerrado(): boolean {
    return this.estadoCuadrante === 'CERRADO_NOMINA';
  }

  get esFijada(): boolean {
    return Boolean(this.celda?.fijada ?? this.apiData?.celda?.fijada);
  }

  get notaEfectiva(): string {
    return (this.celda?.nota ?? this.apiData?.celda?.nota ?? '').trim();
  }

  get notaActualLim(): string {
    return (this.celda?.nota || '').trim();
  }

  get srvEjecutorEfectivo(): string {
    if (this.celda?.servicioEjecutorId) return this.celda.servicioEjecutorId;
    return this.empleado?.servicioBaseId || this.servicioActual?.id || '';
  }

  get esCeldaEspejo(): boolean {
    if (this.target?.origenVista !== 'PLANIFICADOR') return false;
    const cod = this.codigoActual.trim().toUpperCase();
    if (!cod || cod === 'L' || this.esAusencia) return false;
    return Boolean(
      this.celda?.servicioEjecutorId &&
        this.servicioActual?.id &&
        this.celda.servicioEjecutorId !== this.servicioActual.id
    );
  }

  get esApoyoEnEsteServicio(): boolean {
    const cod = this.codigoActual.trim().toUpperCase();
    if (!cod || cod === 'L' || this.esAusencia) return false;
    return Boolean(
      this.empleado?.servicioBaseId &&
        this.srvEjecutorEfectivo &&
        this.srvEjecutorEfectivo !== this.empleado.servicioBaseId &&
        (!this.servicioActual?.id || this.srvEjecutorEfectivo === this.servicioActual.id)
    );
  }

  get enServicioDistintoABase(): boolean {
    const cod = this.codigoActual.trim().toUpperCase();
    if (!cod || cod === 'L' || this.esAusencia) return false;
    return Boolean(
      this.empleado?.servicioBaseId &&
        this.srvEjecutorEfectivo &&
        this.srvEjecutorEfectivo !== this.empleado.servicioBaseId
    );
  }

  get liquidacionDia(): HorasLiquidadas {
    const fechaIso = this.fechaIsoActual;
    if (!this.cfgActual || !fechaIso) {
      return { hod: 0, hon: 0, hdfd: 0, hdfn: 0, total: 0 };
    }
    const reglas = reglasEmpresaDeEmpleado(this.empleado);
    const turnoEff =
      this.celda?.breakInicio || this.celda?.breakFin
        ? {
            ...this.cfgActual,
            breakInicio: this.celda.breakInicio ?? null,
            breakFin: this.celda.breakFin ?? null,
          }
        : this.cfgActual;
    return liquidarTurno(
      turnoEff,
      fechaIso,
      predicadoDescansoObligatorio(),
      reglas
    );
  }

  get infoBreakActual(): {
    orden: number;
    etiqueta: string;
    inicio: string;
    fin: string;
    remunerado: boolean;
  } | null {
    if (!this.cfgActual || !this.cfgActual.recesoHabilitado || this.esAusencia) {
      return null;
    }
    const tandas = obtenerTandasBreakDeTurno(this.cfgActual);
    if (tandas.length === 0) return null;
    const orden = this.celda?.breakTandaOrden ?? tandas[0].orden;
    const tMatch = tandas.find((t) => t.orden === orden) || tandas[0];
    return {
      orden: tMatch.orden,
      etiqueta: tMatch.etiqueta || `T${tMatch.orden}`,
      inicio: this.celda?.breakInicio || tMatch.inicio,
      fin: this.celda?.breakFin || tMatch.fin,
      remunerado: Boolean(this.cfgActual.recesoRemunerado),
    };
  }

  get horasAmortizacionComp(): number {
    if (!this.cfgActual?.descuentaBancoHoras) return 0;
    const reglas = reglasEmpresaDeEmpleado(this.empleado);
    return obtenerHorasAmortizacionTurno(
      this.cfgActual,
      reglas.horasSemanalesContrato,
      reglas.diasBaseSemana
    );
  }

  private evaluarTransicionDescanso(
    codPrev: string | undefined,
    codSig: string | undefined
  ): { etiqueta: string; infraccion: boolean; detalle: string } {
    const cP = (codPrev || '').trim().toUpperCase();
    const cS = (codSig || '').trim().toUpperCase();
    if (!cP || !cS) {
      return { etiqueta: '—', infraccion: false, detalle: 'Sin transición calculable' };
    }
    const cfgP = this.catalogoTurnosMap[cP];
    const cfgS = this.catalogoTurnosMap[cS];
    if (
      cfgP?.esNocturnoPesado &&
      cfgS &&
      cfgS.horasOrdinarias > 0 &&
      !cfgS.esAusencia &&
      cS !== 'S' &&
      cS !== 'L'
    ) {
      return {
        etiqueta: '⚠️ Post-N',
        infraccion: true,
        detalle: `Tras ${cP} requiere Saliente (S) o Libre (L).`,
      };
    }
    const min = calcularDescansoEntreTurnosMin(cfgP, cfgS);
    if (min === null) {
      return { etiqueta: 'Desc.', infraccion: false, detalle: 'Incluye día no operativo/ausencia' };
    }
    const horas = Math.round((min / 60) * 10) / 10;
    const inf = min < DESCANSO_MINIMO_ENTRE_TURNOS_MIN;
    return {
      etiqueta: inf ? `⚠️ ${horas}h` : `${horas}h`,
      infraccion: inf,
      detalle: inf
        ? `Solo ${horas}h entre turnos (mínimo recomendado: 12h)`
        : `${horas}h de descanso entre turnos`,
    };
  }

  get descansoEntrada(): { etiqueta: string; infraccion: boolean; detalle: string } {
    return this.evaluarTransicionDescanso(this.codigoDiaAnterior, this.codigoActual);
  }

  get descansoSalida(): { etiqueta: string; infraccion: boolean; detalle: string } {
    if (!this.target || this.target.dia >= this.diasDelMes.length) {
      return { etiqueta: '—', infraccion: false, detalle: 'Último día del mes' };
    }
    return this.evaluarTransicionDescanso(this.codigoActual, this.celdaDiaSiguiente?.codigo);
  }

  get infraccionesCelda(): InfraccionNormativa[] {
    if (!this.target) return [];
    return this.infraccionesActivas.filter(
      (i) => i.empleadoId === this.target!.empId && i.dia === this.target!.dia
    );
  }

  get historialVisible(): AuditoriaCeldaItem[] {
    const raw = this.apiData?.historial || [];
    if (this.esSoloLectura) {
      return raw.filter((h) => h.faseCuadrante !== 'BORRADOR');
    }
    if (this.filtroFaseTimeline === 'PUBLICADO') {
      return raw.filter((h) => h.faseCuadrante !== 'BORRADOR');
    }
    return raw;
  }

  get puedeAlternarFijacion(): boolean {
    return !this.esSoloLectura && !this.esCerrado && !this.esAusencia && !this.esCeldaEspejo;
  }

  get puedeEditarTurno(): boolean {
    return this.puedeAlternarFijacion && !this.esFijada;
  }

  get mostrarRevertirPrevisto(): boolean {
    return (
      this.puedeEditarTurno &&
      this.codigoPrevistoEfectivo !== undefined &&
      this.codigoActual !== this.codigoPrevistoEfectivo
    );
  }

  get turnosDisponiblesEdicion(): TipoTurnoConfig[] {
    const mapa = new Map<string, TipoTurnoConfig>();
    for (const t of this.turnosPaleta) {
      if (t.activo !== false && !t.esAusencia && !esCodigoExoneracionContrato(t.codigo) && t.codigo !== 'BLANCO') {
        mapa.set(t.codigo, t);
      }
    }
    for (const t of Object.values(this.catalogoTurnosMap)) {
      if (t.activo !== false && !t.esAusencia && !esCodigoExoneracionContrato(t.codigo) && t.codigo !== 'BLANCO') {
        if (!mapa.has(t.codigo) && t.visibleEnPaleta !== false) {
          mapa.set(t.codigo, t);
        }
      }
    }
    if (this.codigoActual && this.catalogoTurnosMap[this.codigoActual] && !mapa.has(this.codigoActual)) {
      mapa.set(this.codigoActual, this.catalogoTurnosMap[this.codigoActual]);
    }
    return Array.from(mapa.values());
  }

  get turnosOperativosApoyo(): TipoTurnoConfig[] {
    const mapa = new Map<string, TipoTurnoConfig>();
    for (const t of Object.values(this.catalogoTurnosMap)) {
      if (
        t.activo !== false &&
        !t.esAusencia &&
        !esCodigoExoneracionContrato(t.codigo) &&
        t.horasOrdinarias > 0 &&
        t.visibleEnPaleta !== false
      ) {
        mapa.set(t.codigo, t);
      }
    }
    return Array.from(mapa.values());
  }

  private get serviciosVisiblesIds(): Set<string> {
    return new Set((this.serviciosVisibles || []).map((s) => s.id));
  }

  private servicioCompatibleConCargo(srv: ServicioHospitalario, emp?: EmpleadoHospital): boolean {
    if (!emp) return true;
    const ids =
      srv.cargosPermitidosIds && srv.cargosPermitidosIds.length > 0
        ? srv.cargosPermitidosIds
        : (srv.cargosPermitidos || []).map((c) => c.categoriaId).filter(Boolean);
    const nombres = (srv.cargosPermitidos || [])
      .map((c) => c.categoriaNombre?.trim().toLowerCase())
      .filter(Boolean);

    if (ids.length === 0 && nombres.length === 0) return true;
    if (emp.categoriaId && ids.includes(emp.categoriaId)) return true;
    if (emp.categoria && nombres.includes(emp.categoria.trim().toLowerCase())) return true;
    return false;
  }

  get serviciosCompatiblesApoyo(): ServicioHospitalario[] {
    const emp = this.empleado;
    if (!emp) return [];
    const poolBase = this.esAdminTh ? this.servicios : this.serviciosVisibles;
    return (poolBase || []).filter(
      (s) =>
        s.id !== emp.servicioBaseId &&
        s.id !== this.srvEjecutorEfectivo &&
        this.servicioCompatibleConCargo(s, emp)
    );
  }

  get puedeMoverDesdeVistaActual(): boolean {
    if (this.esAdminTh) return true;
    return this.serviciosVisiblesIds.has(this.srvEjecutorEfectivo);
  }

  get puedeLiberarApoyoABase(): boolean {
    if (!this.empleado || !this.enServicioDistintoABase) return false;
    if (this.esAdminTh) return true;
    const vis = this.serviciosVisiblesIds;
    return vis.has(this.srvEjecutorEfectivo) && vis.has(this.empleado.servicioBaseId);
  }

  get puedePermutarPortal(): boolean {
    return (
      this.estadoEfectivoCuadrante === 'PUBLICADO' &&
      Boolean(this.codigoActual) &&
      !this.esAusencia &&
      !this.cfgActual?.bloqueaPermutas &&
      !this.esFijada
    );
  }

  get motivoNoPermutaPortal(): string {
    if (this.estadoEfectivoCuadrante !== 'PUBLICADO') {
      return 'Las permutas están disponibles cuando el cuadrante esté Publicado.';
    }
    if (!this.codigoActual) return 'No hay turno asignado en este día.';
    if (this.esAusencia) return 'Bloqueado por novedad oficial de Gestión Humana.';
    if (this.cfgActual?.bloqueaPermutas) return 'Este tipo de turno restringe intercambios.';
    if (this.esFijada) return '📌 Celda fijada por coordinación; no admite permutas.';
    return '';
  }

  nombreServicio(servicioId?: string): string {
    if (!servicioId) return 'Servicio';
    const srv =
      this.servicios.find((s) => s.id === servicioId) ||
      this.serviciosVisibles.find((s) => s.id === servicioId);
    return srv?.nombre || servicioId;
  }

  etiquetaEstado(estado: string): string {
    switch (estado) {
      case 'PUBLICADO':
        return '🟢 Publicado';
      case 'CERRADO_NOMINA':
        return '🔒 Cerrado Nómina';
      case 'BORRADOR':
        return '📝 Borrador';
      default:
        return '⚪ Sin Planificar';
    }
  }

  formatearOrigen(origen?: string): string {
    switch ((origen || '').toUpperCase()) {
      case 'INSPECTOR':
      case 'PANEL_CELDA':
        return 'Inspector';
      case 'AUTOCOMPLETAR':
        return 'Autocompletar';
      case 'LIMPIAR':
        return 'Limpiar';
      case 'DESHACER':
        return 'Ctrl+Z';
      case 'REHACER':
        return 'Ctrl+Y';
      case 'PERMUTA':
        return 'Permuta';
      case 'INTRANET':
        return 'Intranet';
      case 'APOYO':
        return 'Apoyo';
      case 'NOTA':
        return 'Nota';
      case 'FIJACION':
        return 'Fijación';
      case 'BREAK':
        return 'Break';
      case 'BALANCEAR_BREAKS':
        return 'Balanceo Breaks';
      default:
        return 'Manual';
    }
  }

  onAplicarCambioTurno(): void {
    if (!this.target || !this.puedeEditarTurno) return;
    this.aplicarTurno.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      codigo: this.turnoSeleccionado,
      justificacion: this.justificacionEdit.trim() || undefined,
    });
    this.justificacionEdit = '';
  }

  onRevertirPrevisto(): void {
    if (!this.target || !this.puedeEditarTurno) return;
    this.revertirAPrevisto.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      justificacion: this.justificacionEdit.trim() || undefined,
    });
    this.justificacionEdit = '';
  }

  onLimpiarTurno(): void {
    if (!this.target || !this.puedeEditarTurno) return;
    this.aplicarTurno.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      codigo: '',
      justificacion: this.justificacionEdit.trim() || 'Limpieza de celda desde Inspector',
    });
    this.justificacionEdit = '';
  }

  onGuardarNota(): void {
    if (!this.target || this.esCerrado || this.esCeldaEspejo) return;
    this.guardarNota.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      nota: this.notaDraft,
    });
  }

  onQuitarNota(): void {
    if (!this.target || this.esCerrado || this.esCeldaEspejo) return;
    this.notaDraft = '';
    this.guardarNota.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      nota: '',
    });
  }

  onAlternarFijacion(): void {
    if (!this.target || !this.puedeAlternarFijacion) return;
    this.alternarFijacion.emit({
      empId: this.target.empId,
      dia: this.target.dia,
    });
  }

  onEnviarApoyo(): void {
    if (!this.target || !this.apoyoDestinoId || !this.turnoApoyoCodigo) return;
    this.asignarApoyo.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      servicioDestinoId: this.apoyoDestinoId,
      codigoTurno: this.turnoApoyoCodigo,
      justificacion: this.justificacionEdit.trim() || undefined,
    });
    this.apoyoDestinoId = '';
    this.justificacionEdit = '';
  }

  onLiberarApoyo(): void {
    if (!this.target || !this.puedeLiberarApoyoABase) return;
    this.asignarApoyo.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      servicioDestinoId: null,
      justificacion: this.justificacionEdit.trim() || undefined,
    });
    this.justificacionEdit = '';
  }

  onProponerPermutaPortal(): void {
    if (!this.target || !this.puedePermutarPortal) return;
    this.irAPermutaDia.emit(this.target.dia);
    this.cerrar.emit();
  }

  onSeleccionarTandaBreak(tandaOrden: number): void {
    if (!this.target || !this.puedeEditarTurno) return;
    this.cambiarBreakTanda.emit({
      empId: this.target.empId,
      dia: this.target.dia,
      tandaOrden,
    });
  }

  onRebalancearBreaksDia(): void {
    if (!this.target || this.esCerrado) return;
    this.rebalancearBreaksDia.emit({
      dia: this.target.dia,
      codigoTurno: this.codigoActual || undefined,
    });
  }
}
