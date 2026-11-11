import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TipoTurnoConfig } from '../../models';
import {
  CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS,
  hoyColombiaIso,
  ModoAmortizacionBanco,
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

            @if (turnoFormModoJornada === 'HORARIO') {
              <div class="form-row">
                <label for="turno-form-almuerzo">🍽️ Minutos de Almuerzo / Descanso Intermedio (No computable — Art. 167 CST):</label>
                <input
                  id="turno-form-almuerzo"
                  type="number"
                  min="0"
                  max="480"
                  step="5"
                  placeholder="Ej: 0, 45, 60"
                  [ngModel]="turnoFormMinutosAlmuerzo"
                  (ngModelChange)="cambiarTurnoFormMinutosAlmuerzo.emit(+$event)"
                />
                <small class="hint-campo">0 min = turno continuo sin descuento; ej. 60 min descuenta 1.0 h de la duración bruta.</small>
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
              <span class="calc-pill-day">☀️ Diurnas ref. ({{ franjasHoy.diurna }}): <strong>{{ calc.diurnas }}h</strong></span>
              <span class="calc-pill-night">🌙 Nocturnas ref. ({{ franjasHoy.nocturna }}): <strong>{{ calc.nocturnas }}h</strong></span>
            </div>
            <small class="calc-empresa-note">
              ℹ️ Vista previa calculada con referencia CST ({{ franjasHoy.nocturna }}). En el cuadrante y pre-nómina, cada colaborador liquida según la franja nocturna de su empresa contratante (ej. 18:00–06:00 Decreto 1042 o 19:00–06:00 CST).
            </small>
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
                      @if (t.minutosAlmuerzo && t.minutosAlmuerzo > 0) {
                        <span class="badge-custom-sm" title="Tiempo de almuerzo no computable descontado de la jornada (Art. 167 CST)">
                          🍽️ -{{ t.minutosAlmuerzo }}m Almuerzo
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
                      @if (!t.esNocturnoPesado && !t.descuentaBancoHoras && !t.esAusencia && !t.prorrateaMetaContrato && !t.bloqueaPermutas && (!t.minutosAlmuerzo || t.minutosAlmuerzo === 0)) {
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
                        (click)="cargarTurnoParaEdicion.emit(t)"
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
