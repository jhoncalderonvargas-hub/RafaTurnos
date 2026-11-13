import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TandaBreakTurno, TipoTurnoConfig } from '../../models';
import {
  CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS,
  duracionHorarioMin,
  esMinutoNocturno,
  hoyColombiaIso,
  MINUTOS_DIA,
  ModoAmortizacionBanco,
  obtenerHorasAmortizacionTurno,
  parseHoraMin,
  textoFranjasVigentes,
} from '../../shared/liquidacion-horas';
import { coincideBusquedaCampos, dividirTerminosBusqueda } from '../../utils/busqueda-texto';
import { resolverTemaColor, TemaColorTurno } from '../../utils/color-tema';
export type { TemaColorTurno };

export interface CalculoAutomaticoHorasTurno {
  ordinarias: number;
  horarioTexto: string;
  minutosAlmuerzo: number;
  recesoHabilitado?: boolean;
  recesoRemunerado?: boolean;
  duracionBreakMin?: number;
  tandasBreakCount?: number;
  diurnas: number;
  nocturnas: number;
}

@Component({
  selector: 'app-configuracion-catalogo-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './configuracion-catalogo-turnos.component.css',
  template: `
    <div class="module-hero-card">
      <div class="module-hero-brand">
        <div class="module-hero-icon" aria-hidden="true">🎨</div>
        <div class="module-hero-titles">
          <div class="module-hero-title-row">
            <h2>Gestión de Turnos</h2>
            <span class="module-hero-badge">{{ listaTurnosCatalogo.length }} turnos</span>
          </div>
        </div>
      </div>
    </div>

    <div class="catalogo-turnos-grid">
      <!-- Formulario de Creación / Edición de Turno -->
      <div #formCard class="panel-card catalogo-form-card">
        <div class="panel-header">
          <h3>
            @if (turnoEditandoCodigo) {
              ✏️ Editando Turno: {{ turnoEditandoCodigo }}
            } @else {
              ➕ Crear o Configurar Turno
            }
          </h3>
          @if (turnoEditandoCodigo) {
            <button type="button" class="btn-clear-grid" (click)="limpiarFormularioTurno.emit()">Cancelar</button>
          }
        </div>

        <div class="form-vertical">
          <div class="two-col-inputs">
            <div class="form-row">
              <label for="turno-form-codigo">Código (ej. M8, N12, T10):</label>
              <input
                id="turno-form-codigo"
                type="text"
                maxlength="6"
                placeholder="Ej: M10"
                [disabled]="!!turnoEditandoCodigo"
                [title]="turnoEditandoCodigo ? 'El código del turno no se puede modificar en modo edición' : 'Código identificador único'"
                [ngModel]="turnoFormCodigo"
                (ngModelChange)="cambiarTurnoFormCodigo.emit($event)"
              />
            </div>
            <div class="form-row">
              <label for="turno-form-nombre">Nombre del Turno:</label>
              <input
                id="turno-form-nombre"
                type="text"
                placeholder="Ej: Mañana Extendida 10h"
                [ngModel]="turnoFormNombre"
                (ngModelChange)="cambiarTurnoFormNombre.emit($event)"
              />
            </div>
          </div>

          <div class="form-row">
            <label for="turno-form-modo">Tipo de Jornada:</label>
            <select
              id="turno-form-modo"
              [disabled]="esTurnoSistemaObligatorioForm"
              [ngModel]="turnoFormModoJornada"
              (ngModelChange)="cambiarTurnoFormModoJornada.emit($event)"
            >
              <option value="HORARIO">Turno con Horario (Calcula horas automáticamente)</option>
              <option value="GUARDIA_24H">Guardia 24 Horas (desglose Diurnas/Nocturnas automático según hora de inicio)</option>
              <option value="DESCANSO">Descanso / Novedad (0 horas laboradas)</option>
            </select>
            @if (esTurnoSistemaObligatorioForm) {
              <small class="hint-sistema-obligatorio">
                🔒 Turno obligatorio del sistema ({{ turnoFormCodigo.toUpperCase() }}): permanece en modo Descanso / Novedad (0 h) y no puede archivarse ni eliminarse.
              </small>
            }
          </div>

          @if (turnoFormModoJornada !== 'DESCANSO') {
            <div class="two-col-inputs two-col-equal">
              <div class="form-row">
                <label for="turno-form-inicio">Hora de Inicio:</label>
                <input
                  id="turno-form-inicio"
                  type="time"
                  [ngModel]="turnoFormHoraInicio"
                  (ngModelChange)="cambiarTurnoFormHoraInicio.emit($event)"
                />
              </div>
              @if (turnoFormModoJornada === 'HORARIO') {
                <div class="form-row">
                  <label for="turno-form-fin">Hora de Fin:</label>
                  <input
                    id="turno-form-fin"
                    type="time"
                    [ngModel]="turnoFormHoraFin"
                    (ngModelChange)="cambiarTurnoFormHoraFin.emit($event)"
                  />
                </div>
              }
            </div>

            @if (turnoFormModoJornada === 'HORARIO' || turnoFormModoJornada === 'GUARDIA_24H') {
              <div class="break-config-card">
                <label class="check-row break-toggle-row">
                  <input
                    id="turno-form-receso-check"
                    type="checkbox"
                    [ngModel]="turnoFormRecesoHabilitado"
                    (ngModelChange)="cambiarTurnoRecesoHabilitado.emit($event)"
                  />
                  <span>🍽️ Agregar break / almuerzo (1 por turno)</span>
                </label>

                @if (turnoFormRecesoHabilitado) {
                  <div class="break-collapsible-body">
                    <div class="break-payroll-toggle" role="group" aria-label="Cómputo del break en jornada">
                      <button
                        type="button"
                        class="break-mode-btn"
                        [class.active]="!turnoFormRecesoRemunerado"
                        (click)="cambiarTurnoRecesoRemunerado.emit(false)"
                        title="Descuenta el tiempo de almuerzo/break de la jornada laborada (Art. 167 CST)">
                        ⚖️ Descuenta de jornada
                      </button>
                      <button
                        type="button"
                        class="break-mode-btn"
                        [class.active]="turnoFormRecesoRemunerado"
                        (click)="cambiarTurnoRecesoRemunerado.emit(true)"
                        title="Receso operativo incluido dentro de la jornada continua; no descuenta horas (0h desc.)">
                        ☕ Incluido (pagado)
                      </button>
                    </div>

                    <div class="break-params-row">
                      <div class="break-param-col">
                        <span class="break-param-label">Duración del break:</span>
                        <div class="break-duration-cluster">
                          @for (preset of duracionesPreset; track preset) {
                            <button
                              type="button"
                              class="break-dur-pill"
                              [class.active]="turnoFormDuracionBreakMin === preset"
                              (click)="cambiarTurnoDuracionBreak.emit(preset)">
                              {{ preset }}m
                            </button>
                          }
                          <input
                            id="turno-form-duracion-break"
                            type="number"
                            min="5"
                            max="240"
                            step="5"
                            aria-label="Duración personalizada en minutos"
                            class="break-dur-input"
                            [ngModel]="turnoFormDuracionBreakMin"
                            (ngModelChange)="cambiarTurnoDuracionBreak.emit(+$event)"
                          />
                        </div>
                      </div>
                      <div class="break-param-col break-max-col">
                        <label for="turno-form-max-sim" class="break-param-label">Máx. simultáneos:</label>
                        <input
                          id="turno-form-max-sim"
                          type="number"
                          min="1"
                          max="99"
                          step="1"
                          class="break-max-input"
                          [ngModel]="turnoFormRecesoMaxSimultaneos"
                          (ngModelChange)="cambiarTurnoRecesoMaxSimultaneos.emit(+$event)"
                        />
                      </div>
                    </div>

                    <!-- Línea Temporal Interactiva (Inicio -> Fin del Turno) -->
                    <div class="break-timeline-section">
                      <div class="break-timeline-header">
                        <span class="break-timeline-range">
                          🕒 {{ turnoFormHoraInicio || '07:00' }} → {{ turnoFormModoJornada === 'GUARDIA_24H' ? (turnoFormHoraInicio || '07:00') + ' (+1)' : (turnoFormHoraFin || '15:00') }}
                        </span>
                        <span class="break-timeline-hint">Arrastra cada tanda sobre la línea temporal</span>
                      </div>

                      <div #timelineTrack class="break-timeline-track">
                        <div class="break-timeline-bg" aria-hidden="true">
                          @for (seg of segmentosFondoTimeline; track $index) {
                            <div
                              class="break-bg-slice"
                              [class.nocturno]="seg.esNocturno"
                              [style.left.%]="seg.leftPct"
                              [style.width.%]="seg.widthPct">
                            </div>
                          }
                          @for (tick of marcasHorariasTimeline; track tick.label) {
                            <div class="break-grid-line" [style.left.%]="tick.leftPct"></div>
                          }
                        </div>

                        <div class="break-lanes">
                          @for (tanda of turnoFormRecesoTandas; track tanda.orden) {
                            @let pos = posicionTandaTimeline(tanda);
                            @let activa = draggingOrden === tanda.orden || focusedOrden === tanda.orden;
                            <div class="break-lane-row">
                              <div
                                class="break-tanda-bar"
                                [class.dragging]="draggingOrden === tanda.orden"
                                [class.is-selected]="activa"
                                [class.tanda-color-1]="(tanda.orden - 1) % 4 === 0"
                                [class.tanda-color-2]="(tanda.orden - 1) % 4 === 1"
                                [class.tanda-color-3]="(tanda.orden - 1) % 4 === 2"
                                [class.tanda-color-4]="(tanda.orden - 1) % 4 === 3"
                                [style.left.%]="pos.leftPct"
                                [style.width.%]="pos.widthPct"
                                [attr.data-tanda-orden]="tanda.orden"
                                tabindex="0"
                                role="slider"
                                [attr.aria-label]="'Tanda ' + tanda.etiqueta + ' de ' + tanda.inicio + ' a ' + tanda.fin"
                                [attr.aria-valuemin]="0"
                                [attr.aria-valuemax]="pos.maxRelMin"
                                [attr.aria-valuenow]="pos.relStartMin"
                                [attr.aria-valuetext]="tanda.inicio + ' a ' + tanda.fin"
                                (focus)="focusedOrden = tanda.orden"
                                (blur)="focusedOrden = focusedOrden === tanda.orden ? null : focusedOrden"
                                (pointerdown)="onTandaPointerDown($event, tanda)"
                                (keydown)="onTandaKeydown($event, tanda, pos.relStartMin)"
                                [title]="tanda.etiqueta + ': ' + tanda.inicio + ' - ' + tanda.fin + ' (' + tanda.duracionMin + ' min). Arrastra o usa ← →.'">
                                @if (activa) {
                                  <span
                                    class="break-live-callout"
                                    [class.align-left]="pos.leftPct < 14"
                                    [class.align-right]="pos.leftPct + pos.widthPct > 86"
                                    aria-hidden="true">
                                    {{ tanda.etiqueta }}: {{ tanda.inicio }}–{{ tanda.fin }}
                                  </span>
                                }
                                <span class="break-tanda-label">
                                  <strong>{{ tanda.etiqueta }}</strong>
                                  @if (pos.widthPct >= 26) {
                                    <span> {{ tanda.inicio }}–{{ tanda.fin }}</span>
                                  }
                                </span>
                              </div>
                              @if (turnoFormRecesoTandas.length > 1) {
                                <button
                                  type="button"
                                  class="break-tanda-del-btn"
                                  [attr.aria-label]="'Eliminar tanda ' + tanda.etiqueta"
                                  [title]="'Eliminar tanda ' + tanda.etiqueta"
                                  (click)="eliminarTandaBreak.emit(tanda.orden)">
                                  ✕
                                </button>
                              }
                            </div>
                          }
                        </div>

                        <div class="break-timeline-ticks" aria-hidden="true">
                          @for (tick of marcasHorariasTimeline; track tick.label) {
                            <span class="break-tick" [style.left.%]="tick.leftPct">{{ tick.label }}</span>
                          }
                        </div>
                      </div>

                      <!-- Lectura exacta siempre visible de horarios de cada tanda -->
                      <div class="break-tandas-readout" aria-live="polite">
                        @for (tanda of turnoFormRecesoTandas; track tanda.orden) {
                          <button
                            type="button"
                            class="break-readout-chip"
                            [class.is-active]="draggingOrden === tanda.orden || focusedOrden === tanda.orden"
                            [class.tanda-color-1]="(tanda.orden - 1) % 4 === 0"
                            [class.tanda-color-2]="(tanda.orden - 1) % 4 === 1"
                            [class.tanda-color-3]="(tanda.orden - 1) % 4 === 2"
                            [class.tanda-color-4]="(tanda.orden - 1) % 4 === 3"
                            (click)="enfocarBarraTanda(tanda.orden)"
                            title="Clic para seleccionar en la línea temporal y ajustar con ← →">
                            <strong>{{ tanda.etiqueta }}</strong>
                            <span class="break-readout-time">{{ tanda.inicio }} – {{ tanda.fin }}</span>
                            <span class="break-readout-dur">({{ tanda.duracionMin }}m)</span>
                          </button>
                        }
                      </div>

                      <div class="break-timeline-actions">
                        <button
                          type="button"
                          class="btn-break-secondary"
                          [disabled]="turnoFormRecesoTandas.length >= 6"
                          (click)="agregarTandaBreak.emit()">
                          + Agregar tanda
                        </button>
                        <button
                          type="button"
                          class="btn-break-secondary"
                          (click)="escalonarTandasBreakAutomatico.emit()">
                          ⚡ Escalonar automático
                        </button>
                      </div>

                      @if (hayTraslapeTandas) {
                        <div class="break-overlap-warning">
                          ⚠️ Dos o más tandas se superponen en horario. Arrastra una barra o usa <strong>Escalonar automático</strong> para evitar servicio descubierto.
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          }

          <!-- Resumen del cálculo automático de horas -->
          <div class="auto-calc-banner">
            <div>
              <strong>⏱️ Total Computable: {{ calc.ordinarias }}h</strong>
              <span class="calc-sub">
                ({{ calc.horarioTexto }}
                @if (calc.recesoHabilitado && calc.recesoRemunerado) {
                  • ☕ Break {{ calc.duracionBreakMin }}m pagado
                } @else if (calc.minutosAlmuerzo > 0) {
                  • 🍽️ -{{ calc.minutosAlmuerzo }} min break CST
                }
                @if (calc.tandasBreakCount && calc.tandasBreakCount > 1) {
                  • 🔄 {{ calc.tandasBreakCount }} tandas
                })
              </span>
            </div>
            <div class="calc-pills">
              <span class="calc-pill-day">☀️ Diurnas ref. ({{ franjasHoy.diurna }}): <strong>{{ calc.diurnas }}h</strong></span>
              <span class="calc-pill-night">🌙 Nocturnas ref. ({{ franjasHoy.nocturna }}): <strong>{{ calc.nocturnas }}h</strong></span>
            </div>
          </div>

          <div class="form-row">
            <label id="label-color-turno">Color del Turno:</label>
            <div class="color-themes-grid" role="radiogroup" aria-labelledby="label-color-turno">
              @for (tm of temasColorTurno; track tm.key) {
                <button
                  type="button"
                  class="color-theme-swatch"
                  [class.selected]="esTemaSeleccionado(tm)"
                  [attr.aria-pressed]="esTemaSeleccionado(tm)"
                  [attr.aria-label]="'Color ' + tm.nombre"
                  [style.background-color]="tm.bgHex"
                  [style.color]="tm.textHex"
                  [style.border-color]="tm.borderHex"
                  (click)="cambiarTurnoFormColorKey.emit(tm.key)"
                  [title]="tm.nombre + ' (' + tm.bgHex + ')'">
                  {{ turnoFormCodigo || 'T' }}
                </button>
              }

              <!-- Pastilla activa cuando es un color personalizado del espectro -->
              @if (esColorPersonalizado) {
                <button
                  type="button"
                  class="color-theme-swatch custom-swatch selected"
                  [style.background-color]="temaActualForm.bgHex"
                  [style.color]="temaActualForm.textHex"
                  [style.border-color]="temaActualForm.borderHex"
                  (click)="abrirSelectorNativo()"
                  [title]="'Color personalizado actual: ' + temaActualForm.bgHex + '. Clic para cambiar en el espectro'">
                  {{ turnoFormCodigo || 'T' }}
                </button>
              }

              <!-- Botón disparador del espectro nativo (Distribución 2: [ 🎨 + ]) -->
              <label
                class="color-theme-swatch color-spectrum-trigger"
                title="Abrir espectro de colores completo para elegir cualquier tono">
                <span class="spectrum-icon" aria-hidden="true">🎨</span>
                <span class="spectrum-plus" aria-hidden="true">+</span>
                <input
                  #nativeColorInput
                  type="color"
                  class="color-native-input"
                  [ngModel]="temaActualForm.bgHex"
                  (ngModelChange)="onColorSpectrumChange($event)"
                  aria-label="Selector de espectro de color"
                />
              </label>
            </div>
          </div>

          <div class="form-checks">
            <label class="check-row" [class.check-disabled]="turnoFormModoJornada === 'DESCANSO'">
              <input
                type="checkbox"
                [disabled]="turnoFormModoJornada === 'DESCANSO'"
                [ngModel]="turnoFormNocturnoPesado"
                (ngModelChange)="cambiarTurnoFormNocturnoPesado.emit($event)"
              />
              <span>🌙 Exige descanso al día siguiente (Saliente <code>S</code> o Libre <code>L</code>)</span>
            </label>

            <label class="check-row" [class.check-disabled]="turnoFormDescuentaBanco">
              <input
                type="checkbox"
                [disabled]="turnoFormDescuentaBanco"
                [ngModel]="turnoFormProrrateaMeta"
                (ngModelChange)="cambiarTurnoFormProrrateaMeta.emit($event)"
              />
              <span>📉 Prorratea la meta mensual de días hábiles (ej. Día Libre Remunerado, Vacaciones, Incapacidad)</span>
            </label>

            <label class="check-row" [class.check-disabled]="turnoFormModoJornada !== 'DESCANSO'">
              <input
                type="checkbox"
                [disabled]="turnoFormModoJornada !== 'DESCANSO'"
                [ngModel]="turnoFormEsAusencia"
                (ngModelChange)="cambiarTurnoFormEsAusencia.emit($event)"
              />
              <span>🩹 Novedad de Ausentismo RRHH (se contabiliza en Reporte de Ausentismo)</span>
            </label>

            <label class="check-row">
              <input
                type="checkbox"
                [ngModel]="turnoFormBloqueaPermutas"
                (ngModelChange)="cambiarTurnoFormBloqueaPermutas.emit($event)"
              />
              <span>🔒 Bloquea permutas desde el Portal del Colaborador</span>
            </label>

            <label class="check-row" [class.check-disabled]="turnoFormProrrateaMeta">
              <input
                type="checkbox"
                [disabled]="turnoFormProrrateaMeta"
                [ngModel]="turnoFormDescuentaBanco"
                (ngModelChange)="cambiarTurnoFormDescuentaBanco.emit($event)"
              />
              <span>🏦 Descuenta horas del Banco de Horas (Compensatorio — incompatible con Prorrateo)</span>
            </label>

            @if (turnoFormDescuentaBanco) {
              <div class="amortizacion-banco-box">
                <div class="form-row">
                  <label for="turno-form-modo-amortizacion" class="amortizacion-banco-label">Modo de Amortización en Banco de Horas:</label>
                  <select
                    id="turno-form-modo-amortizacion"
                    [ngModel]="turnoFormModoAmortizacion"
                    (ngModelChange)="cambiarTurnoFormModoAmortizacion.emit($event)"
                  >
                    <option value="DIA_HABIL_EMPRESA">⏱️ 1 día hábil según empresa del colaborador (44h→7.33h · 42h→7.00h)</option>
                    <option value="HORAS_FIJAS">🔢 Cantidad fija de horas configurables</option>
                  </select>
                </div>

                @if (turnoFormModoAmortizacion === 'HORAS_FIJAS') {
                  <div class="form-row">
                    <label for="turno-form-amortizacion" class="amortizacion-banco-label">Horas fijas que amortiza en Banco de Horas:</label>
                    <input
                      id="turno-form-amortizacion"
                      type="number"
                      min="0.5"
                      max="24"
                      step="0.5"
                      [ngModel]="turnoFormHorasAmortizacion"
                      (ngModelChange)="cambiarTurnoFormHorasAmortizacion.emit(+$event)"
                    />
                  </div>
                }
              </div>
            }
          </div>

          <div class="form-actions">
            <button type="button" class="btn-primary" (click)="guardarTurnoEnCatalogo.emit()">
              💾 Guardar Turno en Catálogo
            </button>
          </div>
        </div>
      </div>

      <!-- Tabla del Catálogo Maestro de Turnos Optimizado -->
      <div class="panel-card catalogo-table-card">
        <div class="panel-header">
          <h3>🎨 Turnos Configurados</h3>
          <span class="badge-count">{{ turnosFiltrados.length }} de {{ listaTurnosCatalogo.length }} Turnos</span>
        </div>

        <!-- Filtros y Búsqueda en Catálogo -->
        <div class="panel-filter-bar">
          <div class="filter-tabs">
            <button
              type="button"
              class="filter-tab"
              [class.active]="filtroFamiliaTurno === 'TODOS'"
              (click)="filtroFamiliaTurno = 'TODOS'">
              Todos ({{ listaTurnosCatalogo.length }})
            </button>
            <button
              type="button"
              class="filter-tab"
              [class.active]="filtroFamiliaTurno === 'ORDINARIOS'"
              (click)="filtroFamiliaTurno = 'ORDINARIOS'">
              ☀️ Ordinarios
            </button>
            <button
              type="button"
              class="filter-tab"
              [class.active]="filtroFamiliaTurno === 'GUARDIAS'"
              (click)="filtroFamiliaTurno = 'GUARDIAS'">
              🌙 Guardias
            </button>
            <button
              type="button"
              class="filter-tab"
              [class.active]="filtroFamiliaTurno === 'DESCANSOS'"
              (click)="filtroFamiliaTurno = 'DESCANSOS'">
              🛌 Descansos
            </button>
          </div>
          <div class="search-input-wrap catalogo-search-wrap">
            <input
              type="text"
              [(ngModel)]="busquedaTurno"
              placeholder="🔍 Buscar turno..."
              aria-label="Buscar turno en el catálogo"
              class="filter-search-input" />
            @if (busquedaTurno) {
              <button type="button" class="btn-clear-search" aria-label="Limpiar búsqueda" (click)="busquedaTurno = ''">✕</button>
            }
          </div>
        </div>

        <div class="table-responsive">
          <table class="data-table catalogo-table">
            <thead>
              <tr>
                <th class="col-turno">Turno</th>
                <th class="col-horario">Horario</th>
                <th class="col-horas">Horas</th>
                <th class="col-reglas">Reglas</th>
                <th class="col-gestion">Gestión</th>
              </tr>
            </thead>
            <tbody>
              @for (t of turnosFiltrados; track t.codigo) {
                <tr [class.row-archivado]="t.activo === false">
                  <td class="col-turno">
                    <div class="turno-cell-cluster">
                      <span
                        class="mini-shift catalogo-mini-shift"
                        [style.background-color]="t.bgHex"
                        [style.color]="t.textHex"
                        [style.border-color]="t.borderHex">
                        {{ t.codigo }}
                      </span>
                      <div class="turno-info-block">
                        <span class="turno-title">{{ t.nombre }}</span>
                        <div class="turno-sub-badges">
                          @if (t.esSistemaObligatorio) {
                            <span class="badge-sistema-sm" title="Turno obligatorio del sistema (protegido)">🔒 Sistema</span>
                          }
                          @if (t.activo === false) {
                            <span class="badge-archivado-sm" title="Turno archivado (no disponible en paleta)">📦 Archivado</span>
                          }
                          @if (t.esAusencia) {
                            <span class="badge-custom-sm">Novedad</span>
                          }
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="col-horario font-mono">
                    {{ t.horario }}
                  </td>
                  <td class="col-horas">
                    <div class="horas-metric-cluster">
                      <strong class="horas-total-num">{{ t.horasOrdinarias }}h</strong>
                      @if (t.horasOrdinarias > 0) {
                        <div class="horas-pill-row">
                          <span class="badge-sub-day" title="Horas diurnas">{{ t.horasDiurnas }}D</span>
                          <span class="badge-sub-night" title="Horas nocturnas">{{ t.horasNocturnas }}N</span>
                        </div>
                      }
                    </div>
                  </td>
                  <td class="col-reglas">
                    <div class="reglas-tags-wrap">
                      @let cantTandas = t.recesoTandasJson?.length || 0;
                      @if (t.recesoHabilitado && t.recesoRemunerado) {
                        <span class="badge-break-pagado-sm" [title]="'Receso operativo pagado (0h descuento)' + (cantTandas ? ' · ' + cantTandas + ' tanda(s)' : '')">
                          ☕ Break {{ t.recesoTandasJson?.[0]?.duracionMin || 30 }}m Pagado
                        </span>
                      } @else if (t.minutosAlmuerzo && t.minutosAlmuerzo > 0) {
                        <span class="badge-custom-sm" title="Tiempo de break/almuerzo no computable descontado de la jornada (Art. 167 CST)">
                          🍽️ -{{ t.minutosAlmuerzo }}m Break CST
                        </span>
                      }
                      @if (t.recesoHabilitado && t.recesoTandasJson && t.recesoTandasJson.length > 0) {
                        <span class="badge-tandas-sm" [title]="'Tandas configuradas: ' + textoTandasBadge(t)">
                          🔄 {{ t.recesoTandasJson.length }} {{ t.recesoTandasJson.length === 1 ? 'tanda' : 'tandas' }} · máx {{ t.recesoMaxSimultaneos || 1 }}
                        </span>
                      }
                      @if (t.esNocturnoPesado) {
                        <span class="badge-nuevo" title="Exige descanso Saliente o Libre al día siguiente">🌙 Post-Turno</span>
                      }
                      @if (t.prorrateaMetaContrato) {
                        <span class="badge-prorrateo-sm" title="Reduce la meta mensual en 1 día hábil cuando se programa en día hábil">📉 Prorratea D.H.</span>
                      }
                      @if (t.bloqueaPermutas) {
                        <span class="badge-bloqueo-sm" title="Bloquea solicitudes de permuta en el Portal">🔒 No Permutas</span>
                      }
                      @if (t.descuentaBancoHoras) {
                        @if (t.modoAmortizacionBanco === 'DIA_HABIL_EMPRESA') {
                          <span class="badge-banco-mini" title="Amortiza 1 día hábil de la empresa del colaborador (44h→7.33h / 42h→7h)">
                            🏦 -1 D.H. Empresa
                          </span>
                        } @else {
                          @let horasAmort = horasAmortizacionTurno(t);
                          <span class="badge-banco-mini" [title]="'Amortiza ' + horasAmort + 'h fijas del Banco de Horas'">🏦 -{{ horasAmort }}h Banco</span>
                        }
                      }
                      @if (!t.esNocturnoPesado && !t.descuentaBancoHoras && !t.esAusencia && !t.prorrateaMetaContrato && !t.bloqueaPermutas && !t.recesoHabilitado && (!t.minutosAlmuerzo || t.minutosAlmuerzo === 0)) {
                        <span class="text-muted-sm">Continuo</span>
                      }
                    </div>
                  </td>
                  <td class="col-gestion">
                    <div class="gestion-cluster">
                      <button
                        type="button"
                        class="btn-palette-toggle"
                        [disabled]="t.activo === false"
                        [class.active]="t.visibleEnPaleta !== false && t.activo !== false"
                        [attr.aria-pressed]="t.visibleEnPaleta !== false"
                        (click)="alternarVisibilidadTurnoPaleta.emit(t.codigo)"
                        [title]="t.activo === false ? 'Reactiva el turno para mostrarlo en paleta' : (t.visibleEnPaleta !== false ? 'Visible en paleta rápida del cuadrante' : 'Oculto en paleta')">
                        {{ t.visibleEnPaleta !== false && t.activo !== false ? '✅ Paleta' : '👁️ Oculto' }}
                      </button>
                      <button
                        type="button"
                        class="btn-sm-primary"
                        (click)="onEditarTurno(t)"
                        title="Editar este turno en el formulario">
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        class="btn-action-icon"
                        [disabled]="t.esSistemaObligatorio"
                        (click)="archivarTipoTurno.emit(t.codigo)"
                        [title]="t.esSistemaObligatorio ? 'Turno obligatorio del sistema: no puede archivarse' : (t.activo === false ? 'Reactivar este turno' : 'Archivar turno (mantiene historial)')">
                        {{ t.activo === false ? '♻️' : '📦' }}
                      </button>
                      <button
                        type="button"
                        class="btn-action-icon btn-action-danger"
                        [disabled]="t.esSistemaObligatorio"
                        (click)="eliminarTipoTurno.emit(t)"
                        [title]="t.esSistemaObligatorio ? 'Turno obligatorio del sistema: no puede eliminarse' : 'Eliminar turno (solo sin asignaciones)'">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="text-muted empty-state-box catalogo-empty-cell">
                    🔍 No se encontraron turnos que coincidan con la búsqueda "{{ busquedaTurno }}".
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class ConfiguracionCatalogoTurnosComponent implements OnDestroy {
  readonly franjasHoy = textoFranjasVigentes(hoyColombiaIso());
  readonly duracionesPreset = [15, 30, 45, 60];
  busquedaTurno = '';
  filtroFamiliaTurno: 'TODOS' | 'ORDINARIOS' | 'GUARDIAS' | 'DESCANSOS' = 'TODOS';

  @ViewChild('timelineTrack') timelineTrackRef?: ElementRef<HTMLElement>;
  @ViewChild('formCard') formCardRef?: ElementRef<HTMLElement>;
  @ViewChild('nativeColorInput') nativeColorInputRef?: ElementRef<HTMLInputElement>;
  draggingOrden: number | null = null;
  focusedOrden: number | null = null;
  private dragStartX = 0;
  private dragInitialRelMin = 0;
  private dragTrackWidth = 300;
  private dragBoundMove?: (ev: PointerEvent) => void;
  private dragBoundUp?: () => void;

  get temaActualForm(): TemaColorTurno {
    return resolverTemaColor(this.turnoFormColorKey, this.temasColorTurno);
  }

  get esColorPersonalizado(): boolean {
    const key = (this.turnoFormColorKey || '').toUpperCase();
    const actualBg = this.temaActualForm.bgHex.toLowerCase();
    const esPreset = this.temasColorTurno.some(
      (tm) => tm.key.toUpperCase() === key || tm.bgHex.toLowerCase() === actualBg
    );
    return !esPreset;
  }

  esTemaSeleccionado(tm: TemaColorTurno): boolean {
    const actualBg = this.temaActualForm.bgHex.toLowerCase();
    return (
      actualBg === tm.bgHex.toLowerCase() ||
      this.turnoFormColorKey.toUpperCase() === tm.key.toUpperCase()
    );
  }

  onColorSpectrumChange(colorHex: string): void {
    if (colorHex) {
      this.cambiarTurnoFormColorKey.emit(colorHex.toUpperCase());
    }
  }

  abrirSelectorNativo(): void {
    const el = this.nativeColorInputRef?.nativeElement;
    if (el) {
      if (typeof (el as any).showPicker === 'function') {
        try {
          (el as any).showPicker();
          return;
        } catch {}
      }
      el.click();
    }
  }

  ngOnDestroy(): void {
    this.limpiarDragListeners();
  }

  private limpiarDragListeners(): void {
    if (typeof window !== 'undefined') {
      if (this.dragBoundMove) {
        window.removeEventListener('pointermove', this.dragBoundMove);
      }
      if (this.dragBoundUp) {
        window.removeEventListener('pointerup', this.dragBoundUp);
        window.removeEventListener('pointercancel', this.dragBoundUp);
      }
    }
    this.dragBoundMove = undefined;
    this.dragBoundUp = undefined;
    this.draggingOrden = null;
  }

  get duracionTurnoTimelineMin(): number {
    const es24 = this.turnoFormModoJornada === 'GUARDIA_24H';
    const ini = this.turnoFormHoraInicio || '07:00';
    const fin = es24 ? ini : this.turnoFormHoraFin || '15:00';
    return duracionHorarioMin(ini, fin, es24) ?? 480;
  }

  get inicioTurnoTimelineAbsMin(): number {
    return parseHoraMin(this.turnoFormHoraInicio || '07:00') ?? 420;
  }

  get segmentosFondoTimeline(): Array<{ leftPct: number; widthPct: number; esNocturno: boolean }> {
    const s = this.inicioTurnoTimelineAbsMin;
    const dur = Math.max(30, this.duracionTurnoTimelineMin);
    const fechaRef = hoyColombiaIso();
    const slice = 30;
    const out: Array<{ leftPct: number; widthPct: number; esNocturno: boolean }> = [];
    for (let rel = 0; rel < dur; rel += slice) {
      const len = Math.min(slice, dur - rel);
      const minDia = ((s + rel) % MINUTOS_DIA + MINUTOS_DIA) % MINUTOS_DIA;
      const esNocturno = esMinutoNocturno(minDia, fechaRef);
      const prev = out[out.length - 1];
      if (prev && prev.esNocturno === esNocturno) {
        prev.widthPct += (len / dur) * 100;
      } else {
        out.push({
          leftPct: (rel / dur) * 100,
          widthPct: (len / dur) * 100,
          esNocturno,
        });
      }
    }
    return out;
  }

  get marcasHorariasTimeline(): Array<{ label: string; leftPct: number }> {
    const s = this.inicioTurnoTimelineAbsMin;
    const dur = Math.max(30, this.duracionTurnoTimelineMin);
    const stepMin = dur <= 360 ? 60 : dur <= 720 ? 120 : 240;
    const ticks: Array<{ label: string; leftPct: number }> = [];
    for (let rel = 0; rel <= dur; rel += stepMin) {
      const absMin = ((s + rel) % MINUTOS_DIA + MINUTOS_DIA) % MINUTOS_DIA;
      const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
      const mm = String(absMin % 60).padStart(2, '0');
      ticks.push({ label: `${hh}:${mm}`, leftPct: (rel / dur) * 100 });
    }
    if (dur % stepMin !== 0) {
      const absFin = ((s + dur) % MINUTOS_DIA + MINUTOS_DIA) % MINUTOS_DIA;
      const hh = String(Math.floor(absFin / 60)).padStart(2, '0');
      const mm = String(absFin % 60).padStart(2, '0');
      ticks.push({ label: `${hh}:${mm}`, leftPct: 100 });
    }
    return ticks;
  }

  posicionTandaTimeline(tanda: TandaBreakTurno): {
    leftPct: number;
    widthPct: number;
    relStartMin: number;
    maxRelMin: number;
  } {
    const s = this.inicioTurnoTimelineAbsMin;
    const dur = Math.max(30, this.duracionTurnoTimelineMin);
    const iniRaw = parseHoraMin(tanda.inicio);
    let relStartMin = iniRaw !== null ? iniRaw - s : 0;
    if (relStartMin < 0) relStartMin += MINUTOS_DIA;
    const durTanda = Math.max(5, Math.min(dur, tanda.duracionMin || 30));
    const maxRelMin = Math.max(0, dur - durTanda);
    relStartMin = Math.max(0, Math.min(maxRelMin, relStartMin));
    const leftPct = (relStartMin / dur) * 100;
    const widthPct = Math.max(8, (durTanda / dur) * 100);
    return {
      leftPct: Math.min(100 - widthPct, leftPct),
      widthPct,
      relStartMin,
      maxRelMin,
    };
  }

  get hayTraslapeTandas(): boolean {
    const tandas = this.turnoFormRecesoTandas;
    if (tandas.length < 2) return false;
    const s = this.inicioTurnoTimelineAbsMin;
    const rangos = tandas.map((t) => {
      const iRaw = parseHoraMin(t.inicio) ?? s;
      let start = iRaw - s;
      if (start < 0) start += MINUTOS_DIA;
      return { start, end: start + (t.duracionMin || 30) };
    });
    rangos.sort((a, b) => a.start - b.start);
    for (let i = 1; i < rangos.length; i++) {
      if (rangos[i].start < rangos[i - 1].end) return true;
    }
    return false;
  }

  onTandaPointerDown(event: PointerEvent, tanda: TandaBreakTurno): void {
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement | null)?.focus({ preventScroll: true });
    const trackEl = this.timelineTrackRef?.nativeElement;
    if (!trackEl) return;
    this.limpiarDragListeners();
    this.draggingOrden = tanda.orden;
    this.dragStartX = event.clientX;
    this.dragTrackWidth = Math.max(120, trackEl.getBoundingClientRect().width);
    this.dragInitialRelMin = this.posicionTandaTimeline(tanda).relStartMin;
    const durTotal = this.duracionTurnoTimelineMin;
    const ordenObjetivo = tanda.orden;

    this.dragBoundMove = (ev: PointerEvent) => {
      const deltaPx = ev.clientX - this.dragStartX;
      const deltaMin = (deltaPx / this.dragTrackWidth) * durTotal;
      this.moverTandaBreak.emit({
        orden: ordenObjetivo,
        nuevoInicioRelMin: this.dragInitialRelMin + deltaMin,
      });
    };

    this.dragBoundUp = () => {
      this.limpiarDragListeners();
    };

    window.addEventListener('pointermove', this.dragBoundMove);
    window.addEventListener('pointerup', this.dragBoundUp);
    window.addEventListener('pointercancel', this.dragBoundUp);
  }

  onEditarTurno(turno: TipoTurnoConfig): void {
    this.cargarTurnoParaEdicion.emit(turno);
    const card = this.formCardRef?.nativeElement;
    if (card && card.getBoundingClientRect().top < 12) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  enfocarBarraTanda(orden: number): void {
    const trackEl = this.timelineTrackRef?.nativeElement;
    const bar = trackEl?.querySelector<HTMLElement>(`.break-tanda-bar[data-tanda-orden="${orden}"]`);
    bar?.focus({ preventScroll: true });
    this.focusedOrden = orden;
  }

  onTandaKeydown(event: KeyboardEvent, tanda: TandaBreakTurno, relStartMin: number): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.moverTandaBreak.emit({ orden: tanda.orden, nuevoInicioRelMin: relStartMin - 15 });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.moverTandaBreak.emit({ orden: tanda.orden, nuevoInicioRelMin: relStartMin + 15 });
    }
  }

  textoTandasBadge(t: TipoTurnoConfig): string {
    return (t.recesoTandasJson || [])
      .map((x) => `${x.etiqueta}: ${x.inicio}-${x.fin}`)
      .join(' | ');
  }

  get turnosFiltrados(): TipoTurnoConfig[] {
    const terminos = dividirTerminosBusqueda(this.busquedaTurno);
    const f = this.filtroFamiliaTurno;
    return this.listaTurnosCatalogo.filter((t) => {
      if (f === 'ORDINARIOS') {
        if (t.horasOrdinarias <= 0 || t.esAusencia || t.horasOrdinarias > 10) return false;
      } else if (f === 'GUARDIAS') {
        if (t.horasOrdinarias <= 10 || t.esAusencia) return false;
      } else if (f === 'DESCANSOS') {
        if (t.horasOrdinarias > 0 && !t.esAusencia) return false;
      }
      if (terminos.length > 0 && !coincideBusquedaCampos(terminos, [t.codigo, t.nombre, t.horario])) {
        return false;
      }
      return true;
    });
  }

  @Input() turnoEditandoCodigo: string | null = null;
  @Input() turnoFormCodigo = '';
  @Input() turnoFormNombre = '';
  @Input() turnoFormModoJornada: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO' = 'HORARIO';
  @Input() turnoFormHoraInicio = '07:00';
  @Input() turnoFormHoraFin = '15:00';
  @Input() turnoFormMinutosAlmuerzo = 0;
  @Input() turnoFormRecesoHabilitado = false;
  @Input() turnoFormRecesoRemunerado = false;
  @Input() turnoFormRecesoMaxSimultaneos = 1;
  @Input() turnoFormDuracionBreakMin = 30;
  @Input() turnoFormRecesoTandas: TandaBreakTurno[] = [];
  @Input({ required: true }) calc!: CalculoAutomaticoHorasTurno;
  @Input() temasColorTurno: TemaColorTurno[] = [];
  @Input() turnoFormColorKey = 'AZUL_CIELO';
  @Input() turnoFormNocturnoPesado = false;
  @Input() turnoFormProrrateaMeta = false;
  @Input() turnoFormEsAusencia = false;
  @Input() turnoFormBloqueaPermutas = false;
  @Input() turnoFormDescuentaBanco = false;
  @Input() turnoFormModoAmortizacion: ModoAmortizacionBanco = 'HORAS_FIJAS';
  @Input() turnoFormHorasAmortizacion = 8;
  @Input() listaTurnosCatalogo: TipoTurnoConfig[] = [];

  @Output() limpiarFormularioTurno = new EventEmitter<void>();
  @Output() cambiarTurnoFormCodigo = new EventEmitter<string>();
  @Output() cambiarTurnoFormNombre = new EventEmitter<string>();
  @Output() cambiarTurnoFormModoJornada = new EventEmitter<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>();
  @Output() cambiarTurnoFormHoraInicio = new EventEmitter<string>();
  @Output() cambiarTurnoFormHoraFin = new EventEmitter<string>();
  @Output() cambiarTurnoFormMinutosAlmuerzo = new EventEmitter<number>();
  @Output() cambiarTurnoRecesoHabilitado = new EventEmitter<boolean>();
  @Output() cambiarTurnoRecesoRemunerado = new EventEmitter<boolean>();
  @Output() cambiarTurnoRecesoMaxSimultaneos = new EventEmitter<number>();
  @Output() cambiarTurnoDuracionBreak = new EventEmitter<number>();
  @Output() agregarTandaBreak = new EventEmitter<void>();
  @Output() escalonarTandasBreakAutomatico = new EventEmitter<void>();
  @Output() eliminarTandaBreak = new EventEmitter<number>();
  @Output() moverTandaBreak = new EventEmitter<{ orden: number; nuevoInicioRelMin: number }>();
  @Output() cambiarTurnoFormColorKey = new EventEmitter<string>();
  @Output() cambiarTurnoFormNocturnoPesado = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormProrrateaMeta = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormEsAusencia = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormBloqueaPermutas = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormDescuentaBanco = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormModoAmortizacion = new EventEmitter<ModoAmortizacionBanco>();
  @Output() cambiarTurnoFormHorasAmortizacion = new EventEmitter<number>();
  @Output() guardarTurnoEnCatalogo = new EventEmitter<void>();
  @Output() alternarVisibilidadTurnoPaleta = new EventEmitter<string>();
  @Output() cargarTurnoParaEdicion = new EventEmitter<TipoTurnoConfig>();
  @Output() archivarTipoTurno = new EventEmitter<string>();
  @Output() eliminarTipoTurno = new EventEmitter<TipoTurnoConfig>();

  get esTurnoSistemaObligatorioForm(): boolean {
    const cod = (this.turnoEditandoCodigo || this.turnoFormCodigo || '').trim().toUpperCase();
    if (CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod)) return true;
    const item = this.listaTurnosCatalogo.find((t) => t.codigo.toUpperCase() === cod);
    return Boolean(item?.esSistemaObligatorio);
  }

  horasAmortizacionTurno(t: TipoTurnoConfig): number {
    return obtenerHorasAmortizacionTurno(t);
  }
}
