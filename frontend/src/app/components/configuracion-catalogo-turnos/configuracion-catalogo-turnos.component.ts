import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TipoTurnoConfig } from '../../models';
import {
  hoyColombiaIso,
  obtenerHorasAmortizacionTurno,
  textoFranjasVigentes,
} from '../../shared/liquidacion-horas';

export interface CalculoAutomaticoHorasTurno {
  ordinarias: number;
  horarioTexto: string;
  minutosAlmuerzo: number;
  diurnas: number;
  nocturnas: number;
}

export interface TemaColorTurno {
  key: string;
  nombre: string;
  bgHex: string;
  textHex: string;
  borderHex: string;
}

@Component({
  selector: 'app-configuracion-catalogo-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './configuracion-catalogo-turnos.component.css',
  template: `
    <div class="catalogo-turnos-grid">
      <!-- Formulario de Creación / Edición de Turno -->
      <div class="panel-card catalogo-form-card">
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
              [ngModel]="turnoFormModoJornada"
              (ngModelChange)="cambiarTurnoFormModoJornada.emit($event)"
            >
              <option value="HORARIO">Turno con Horario (Calcula horas automáticamente)</option>
              <option value="GUARDIA_24H">Guardia 24 Horas (desglose Diurnas/Nocturnas automático según hora de inicio)</option>
              <option value="DESCANSO">Descanso / Novedad (0 horas laboradas)</option>
            </select>
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

            @if (turnoFormModoJornada === 'HORARIO') {
              <div class="form-row">
                <label for="turno-form-almuerzo">🍽️ Tiempo de Almuerzo / Descanso Intermedio (No computable - Art. 167 CST):</label>
                <select
                  id="turno-form-almuerzo"
                  [ngModel]="turnoFormMinutosAlmuerzo"
                  (ngModelChange)="cambiarTurnoFormMinutosAlmuerzo.emit(+$event)"
                >
                  <option [ngValue]="0">0 min — Sin descuento (Turno asistencial continuo / Relevo interno)</option>
                  <option [ngValue]="30">30 min (0.5 h descontadas de la jornada)</option>
                  <option [ngValue]="60">60 min (1.0 h descontada — Jornada partida / Administrativo)</option>
                  <option [ngValue]="90">90 min (1.5 h descontadas de la jornada)</option>
                  <option [ngValue]="120">120 min (2.0 h descontadas de la jornada)</option>
                </select>
              </div>
            }
          }

          <!-- Resumen del cálculo automático de horas -->
          <div class="auto-calc-banner">
            <div>
              <strong>⏱️ Total Computable: {{ calc.ordinarias }}h</strong>
              <span class="calc-sub">({{ calc.horarioTexto }}@if (calc.minutosAlmuerzo > 0) { • 🍽️ -{{ calc.minutosAlmuerzo }} min almuerzo })</span>
            </div>
            <div class="calc-pills">
              <span class="calc-pill-day">☀️ Diurnas ({{ franjasHoy.diurna }}): <strong>{{ calc.diurnas }}h</strong></span>
              <span class="calc-pill-night">🌙 Nocturnas ({{ franjasHoy.nocturna }}): <strong>{{ calc.nocturnas }}h</strong></span>
            </div>
          </div>

          <div class="form-row">
            <label>Color del Turno:</label>
            <div class="color-themes-grid">
              @for (tm of temasColorTurno; track tm.key) {
                <button
                  type="button"
                  class="color-theme-swatch"
                  [class.selected]="turnoFormColorKey === tm.key"
                  [attr.aria-pressed]="turnoFormColorKey === tm.key"
                  [attr.aria-label]="'Color ' + tm.nombre"
                  [style.background-color]="tm.bgHex"
                  [style.color]="tm.textHex"
                  [style.border-color]="tm.borderHex"
                  (click)="cambiarTurnoFormColorKey.emit(tm.key)"
                  [title]="tm.nombre">
                  {{ turnoFormCodigo || 'T' }}
                </button>
              }
            </div>
          </div>

          <div class="form-checks">
            <label class="check-row">
              <input
                type="checkbox"
                [ngModel]="turnoFormNocturnoPesado"
                (ngModelChange)="cambiarTurnoFormNocturnoPesado.emit($event)"
              />
              <span>🌙 Exige descanso al día siguiente (Saliente <code>S</code> o Libre <code>L</code>)</span>
            </label>

            <label class="check-row">
              <input
                type="checkbox"
                [ngModel]="turnoFormDescuentaBanco"
                (ngModelChange)="cambiarTurnoFormDescuentaBanco.emit($event)"
              />
              <span>🏦 Descuenta {{ turnoFormDescuentaBanco ? turnoFormHorasAmortizacion : 8 }} horas del Banco de Horas (Compensatorio)</span>
            </label>

            @if (turnoFormDescuentaBanco) {
              <div class="form-row amortizacion-banco-box">
                <label for="turno-form-amortizacion" class="amortizacion-banco-label">Horas que amortiza en Banco de Horas (por defecto 8h; ej. 7h bajo 42h/sem):</label>
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
                <tr>
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
                        @if (t.esAusencia) {
                          <span class="badge-custom-sm">Novedad</span>
                        }
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
                      @if (t.minutosAlmuerzo && t.minutosAlmuerzo > 0) {
                        <span class="badge-custom-sm" title="Tiempo de almuerzo no computable descontado de la jornada (Art. 167 CST)">
                          🍽️ -{{ t.minutosAlmuerzo }}m Almuerzo
                        </span>
                      }
                      @if (t.esNocturnoPesado) {
                        <span class="badge-nuevo" title="Exige descanso Saliente o Libre al día siguiente">🌙 Post-Turno</span>
                      }
                      @if (t.descuentaBancoHoras) {
                        @let horasAmort = horasAmortizacionTurno(t);
                        <span class="badge-banco-mini" [title]="'Amortiza ' + horasAmort + 'h del Banco de Horas'">🏦 -{{ horasAmort }}h Banco</span>
                      }
                      @if (!t.esNocturnoPesado && !t.descuentaBancoHoras && !t.esAusencia && (!t.minutosAlmuerzo || t.minutosAlmuerzo === 0)) {
                        <span class="text-muted-sm">Continuo</span>
                      }
                    </div>
                  </td>
                  <td class="col-gestion">
                    <div class="gestion-cluster">
                      <button
                        type="button"
                        class="btn-palette-toggle"
                        [class.active]="t.visibleEnPaleta !== false"
                        [attr.aria-pressed]="t.visibleEnPaleta !== false"
                        (click)="alternarVisibilidadTurnoPaleta.emit(t.codigo)"
                        [title]="t.visibleEnPaleta !== false ? 'Visible en paleta rápida del cuadrante' : 'Oculto en paleta'">
                        {{ t.visibleEnPaleta !== false ? '✅ Paleta' : '👁️ Oculto' }}
                      </button>
                      <button
                        type="button"
                        class="btn-sm-primary"
                        (click)="cargarTurnoParaEdicion.emit(t)"
                        title="Editar este turno en el formulario">
                        ✏️ Editar
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
export class ConfiguracionCatalogoTurnosComponent {
  readonly franjasHoy = textoFranjasVigentes(hoyColombiaIso());
  busquedaTurno = '';
  filtroFamiliaTurno: 'TODOS' | 'ORDINARIOS' | 'GUARDIAS' | 'DESCANSOS' = 'TODOS';

  get turnosFiltrados(): TipoTurnoConfig[] {
    const q = this.busquedaTurno.trim().toLowerCase();
    const f = this.filtroFamiliaTurno;
    return this.listaTurnosCatalogo.filter((t) => {
      if (f === 'ORDINARIOS') {
        if (t.horasOrdinarias <= 0 || t.esAusencia || t.horasOrdinarias > 10) return false;
      } else if (f === 'GUARDIAS') {
        if (t.horasOrdinarias <= 10 || t.esAusencia) return false;
      } else if (f === 'DESCANSOS') {
        if (t.horasOrdinarias > 0 && !t.esAusencia) return false;
      }
      if (q) {
        const match =
          t.codigo.toLowerCase().includes(q) ||
          t.nombre.toLowerCase().includes(q) ||
          (t.horario || '').toLowerCase().includes(q);
        if (!match) return false;
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
  @Input({ required: true }) calc!: CalculoAutomaticoHorasTurno;
  @Input() temasColorTurno: TemaColorTurno[] = [];
  @Input() turnoFormColorKey = 'AZUL_CIELO';
  @Input() turnoFormNocturnoPesado = false;
  @Input() turnoFormDescuentaBanco = false;
  @Input() turnoFormHorasAmortizacion = 8;
  @Input() listaTurnosCatalogo: TipoTurnoConfig[] = [];

  @Output() limpiarFormularioTurno = new EventEmitter<void>();
  @Output() cambiarTurnoFormCodigo = new EventEmitter<string>();
  @Output() cambiarTurnoFormNombre = new EventEmitter<string>();
  @Output() cambiarTurnoFormModoJornada = new EventEmitter<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>();
  @Output() cambiarTurnoFormHoraInicio = new EventEmitter<string>();
  @Output() cambiarTurnoFormHoraFin = new EventEmitter<string>();
  @Output() cambiarTurnoFormMinutosAlmuerzo = new EventEmitter<number>();
  @Output() cambiarTurnoFormColorKey = new EventEmitter<string>();
  @Output() cambiarTurnoFormNocturnoPesado = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormDescuentaBanco = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormHorasAmortizacion = new EventEmitter<number>();
  @Output() guardarTurnoEnCatalogo = new EventEmitter<void>();
  @Output() alternarVisibilidadTurnoPaleta = new EventEmitter<string>();
  @Output() cargarTurnoParaEdicion = new EventEmitter<TipoTurnoConfig>();

  horasAmortizacionTurno(t: TipoTurnoConfig): number {
    return obtenerHorasAmortizacionTurno(t);
  }
}
