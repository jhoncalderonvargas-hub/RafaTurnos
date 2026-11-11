import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CategoriaProfesionalItem,
  EmpleadoHospital,
  MacroprocesoInfo,
  MetaTurnoServicio,
  ModalidadDiasServicio,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoAsistencia,
  TipoTurnoConfig,
} from '../../models';
import { FestivosColombiaHelper } from '../../festivos-colombia.helper';
import { hoyColombiaIso, r2 } from '../../shared/liquidacion-horas';

@Component({
  selector: 'app-configuracion-servicios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './configuracion-servicios.component.css',
  template: `
    <!-- Métricas Resumen de Servicios -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">{{ servicios.length }}</div>
        <div class="kpi-label">Servicios Configurados</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ empleados.length }}</div>
        <div class="kpi-label">Colaboradores Activos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalCategoriasUnicas }}</div>
        <div class="kpi-label">Categorías Profesionales</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalEnlacesApoyo }}</div>
        <div class="kpi-label">Vínculos de Servicios de Apoyo</div>
      </div>
    </div>

    <!-- Formularios de Administración -->
    <div class="admin-forms-grid">
      <!-- Tarjeta Crear / Editar Servicio -->
      <div class="panel-card" id="panel-edicion-servicio">
        <div class="panel-header">
          <h3>
            @if (servicioEditandoId) {
              ✏️ Editando Servicio: {{ nuevoServicioNombre }}
            } @else {
              ➕ Crear Nuevo Servicio
            }
          </h3>
          @if (servicioEditandoId) {
            <span class="badge-custom">Modo Edición</span>
          }
        </div>
        <div class="form-vertical">
          <div class="form-row">
            <label for="input-codigo-servicio">Código (3-6 letras):</label>
            <input
              id="input-codigo-servicio"
              type="text"
              placeholder="Ej: HEM, UCIP, NEO"
              [ngModel]="nuevoServicioCodigo"
              (ngModelChange)="cambiarNuevoServicioCodigo.emit($event)"
              maxlength="8"
            />
          </div>
          <div class="form-row">
            <label for="input-nombre-servicio">Nombre del Servicio:</label>
            <input
              id="input-nombre-servicio"
              type="text"
              placeholder="Ej: Hemodiálisis Ambulatoria"
              [ngModel]="nuevoServicioNombre"
              (ngModelChange)="cambiarNuevoServicioNombre.emit($event)"
            />
          </div>
          <div class="form-row">
            <label for="select-macroproceso-servicio">Macroproceso (Mapa de Procesos Intranet):</label>
            <select
              id="select-macroproceso-servicio"
              [ngModel]="nuevoServicioTipoAsistencia"
              (ngModelChange)="onSeleccionarMacroprocesoForm($event)"
            >
              @for (m of catalogoMacroprocesos; track m.codigo) {
                <option [value]="m.codigo">{{ m.icono }} {{ m.nombre }}</option>
              }
            </select>
          </div>
          <div class="form-row">
            <label for="select-modalidad-dias-servicio">Modalidad de Días Operativos del Servicio:</label>
            <select
              id="select-modalidad-dias-servicio"
              [ngModel]="nuevoServicioModalidadDias"
              (ngModelChange)="cambiarNuevoServicioModalidadDias.emit($event)"
            >
              <option value="TODOS_24_7">🕒 Todos los días 24/7 — Mismas metas de Lunes a Domingo y Festivos</option>
              <option value="TODOS_GUARDIA_FDS">🏥 24/7 Diferenciado — Lunes a Sábado base / Domingos y Festivos diferenciado</option>
              <option value="LUN_SAB_SIN_FESTIVOS">📅 Lunes a Sábado — Cierra Domingos y Festivos (0 / 0)</option>
              <option value="LUN_VIE_HABILES">🏢 Lunes a Viernes Hábiles — Cierra Sábados, Domingos y Festivos</option>
            </select>
          </div>
          <div class="form-row">
            <span class="meta-input-label">
              @if (nuevoServicioModalidadDias === 'TODOS_24_7') {
                Metas de Cobertura Mínima Diaria (Lunes a Domingo y Festivos):
              } @else if (nuevoServicioModalidadDias === 'LUN_VIE_HABILES') {
                Metas de Cobertura Mínima — Lunes a Viernes (Días Hábiles):
              } @else {
                📅 Metas de Cobertura Mínima — Lunes a Sábado:
              }
            </span>
            <div class="metas-two-col-grid">
              <div>
                <label for="input-req-dia-servicio" class="meta-input-label">☀️ Día</label>
                <input
                  id="input-req-dia-servicio"
                  type="number"
                  min="0"
                  max="50"
                  [disabled]="nuevoServicioReglasPorCargo.length > 0 || nuevoServicioMetasPorTurno.length > 0"
                  [title]="nuevoServicioMetasPorTurno.length > 0 ? 'Calculado automáticamente desde la Matriz de Metas por Turno' : (nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : '')"
                  [ngModel]="nuevoServicioReqDia"
                  (ngModelChange)="cambiarNuevoServicioReqDia.emit(+$event)"
                />
              </div>
              <div>
                <label for="input-req-noche-servicio" class="meta-input-label">🌙 Noche</label>
                <input
                  id="input-req-noche-servicio"
                  type="number"
                  min="0"
                  max="50"
                  [disabled]="nuevoServicioReglasPorCargo.length > 0 || nuevoServicioMetasPorTurno.length > 0"
                  [title]="nuevoServicioMetasPorTurno.length > 0 ? 'Calculado automáticamente desde la Matriz de Metas por Turno' : (nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : '')"
                  [ngModel]="nuevoServicioReqNoche"
                  (ngModelChange)="cambiarNuevoServicioReqNoche.emit(+$event)"
                />
              </div>
            </div>
          </div>
          @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS') {
            <div class="form-row dom-fest-box">
              <span class="meta-input-label dom-fest-label">
                🗓️ Metas Diferenciadas — Domingos y Festivos:
              </span>
              <div class="metas-two-col-grid">
                <div>
                  <label for="input-req-dia-df-servicio" class="meta-input-label">☀️ Día (Dom/Fest)</label>
                  <input
                    id="input-req-dia-df-servicio"
                    type="number"
                    min="0"
                    max="50"
                    [disabled]="nuevoServicioReglasPorCargo.length > 0 || nuevoServicioMetasPorTurno.length > 0"
                    [title]="nuevoServicioMetasPorTurno.length > 0 ? 'Calculado automáticamente desde la Matriz de Metas por Turno' : (nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : '')"
                    [ngModel]="nuevoServicioReqDiaDomFest"
                    (ngModelChange)="cambiarNuevoServicioReqDiaDomFest.emit(+$event)"
                  />
                </div>
                <div>
                  <label for="input-req-noche-df-servicio" class="meta-input-label">🌙 Noche (Dom/Fest)</label>
                  <input
                    id="input-req-noche-df-servicio"
                    type="number"
                    min="0"
                    max="50"
                    [disabled]="nuevoServicioReglasPorCargo.length > 0 || nuevoServicioMetasPorTurno.length > 0"
                    [title]="nuevoServicioMetasPorTurno.length > 0 ? 'Calculado automáticamente desde la Matriz de Metas por Turno' : (nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : '')"
                    [ngModel]="nuevoServicioReqNocheDomFest"
                    (ngModelChange)="cambiarNuevoServicioReqNocheDomFest.emit(+$event)"
                  />
                </div>
              </div>
            </div>
          }
          @if (nuevoServicioModalidadDias === 'LUN_SAB_SIN_FESTIVOS') {
            <div class="modalidad-info-banner">
              ✅ De Lunes a Sábado aplica la meta <strong>Día / Noche</strong>; en Domingos y Festivos la meta será <strong>0 / 0</strong> y el Autocompletado asignará <strong>Libre (L)</strong>.
            </div>
          }
          @if (nuevoServicioModalidadDias === 'LUN_VIE_HABILES') {
            <div class="modalidad-info-banner">
              ✅ En Sábados, Domingos y Festivos la meta requerida será <strong>0 / 0</strong> y el Autocompletado asignará automáticamente <strong>Libre (L)</strong>.
            </div>
          }
          <div class="form-row">
            <div class="turnos-servicio-header">
              <label class="turnos-servicio-title">Turnos Habilitados en este Servicio (Paleta y Autocompletar):</label>
              <div class="turnos-plantillas-row">
                <button type="button" class="btn-outline btn-plantilla-sm" (click)="aplicarPlantillaTurnosServicio.emit('ROTATIVO_8H')">
                  Rotativo 8h
                </button>
                <button type="button" class="btn-outline btn-plantilla-sm" (click)="aplicarPlantillaTurnosServicio.emit('GUARDIAS_12_24')">
                  Guardias 12h/24h
                </button>
                <button type="button" class="btn-outline btn-plantilla-sm" (click)="aplicarPlantillaTurnosServicio.emit('ADMINISTRATIVO')">
                  Administrativo
                </button>
                <button type="button" class="btn-outline btn-plantilla-sm" (click)="aplicarPlantillaTurnosServicio.emit('TODOS')">
                  Todos
                </button>
              </div>
            </div>
            <div class="turnos-chips-container">
              @for (t of turnosDisponiblesEnForm; track t.codigo) {
                @let activo = esTurnoHabilitadoEnServicioForm(t.codigo);
                <button
                  type="button"
                  class="turno-chip-toggle"
                  [class.is-inactive]="!activo"
                  [attr.aria-pressed]="activo"
                  (click)="alternarTurnoEnServicioForm.emit(t.codigo)"
                  [title]="t.nombre + ' (' + t.horario + ')'"
                  [style.background-color]="activo ? t.bgHex : '#ffffff'"
                  [style.color]="activo ? t.textHex : '#94a3b8'"
                  [style.border-color]="activo ? t.borderHex : '#cbd5e1'">
                  <span>{{ activo ? '✓' : '+' }}</span>
                  <span>{{ t.codigo }}</span>
                  <span class="turno-chip-nombre">{{ t.nombre }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Cargos Profesionales Permitidos & Regla de Permutas Multi-Cargo -->
          <div class="form-row cargos-permitidos-box">
            <div class="cargos-permitidos-header">
              <label class="cargos-permitidos-title">
                🎓 Cargos Profesionales Permitidos en este Servicio:
              </label>
              <small class="cargos-permitidos-hint">
                @if (nuevoServicioCargosPermitidosIds.length === 0) {
                  Sin restricción específica (admite rotación general compatible)
                } @else {
                  {{ nuevoServicioCargosPermitidosIds.length }} cargo(s) habilitado(s)
                }
              </small>
            </div>
            <div class="cargos-permitidos-chips">
              @for (cat of categoriasProfesionales; track cat.id) {
                @let cargoSel = esCargoPermitidoEnServicioForm(cat.id);
                <button
                  type="button"
                  class="cargo-permitido-chip"
                  [class.is-active]="cargoSel"
                  [attr.aria-pressed]="cargoSel"
                  (click)="alternarCargoPermitidoEnServicioForm.emit(cat.id)">
                  <span>{{ cargoSel ? '✓' : '+' }}</span>
                  <span>{{ cat.nombre }}</span>
                </button>
              } @empty {
                <span class="text-muted">Cargando catálogo de cargos profesionales...</span>
              }
            </div>
            <label class="check-row-servicio">
              <input
                type="checkbox"
                [ngModel]="nuevoServicioPermitePermutaEntreCargos"
                (ngModelChange)="cambiarNuevoServicioPermitePermutaEntreCargos.emit($event)"
              />
              <span>
                🔄 Permitir permutas entre distintos cargos permitidos de este servicio (ej. Auxiliares / Técnicos / Tecnólogos con funciones equivalentes)
              </span>
            </label>
          </div>

          <!-- Matriz de Metas por Turno Operativo (Esquema B) -->
          @if (nuevoServicioMetasPorTurno.length > 0) {
            @let balanceCap = resumenCapacidadServicioForm;
            <div class="form-row metas-turno-box">
              <div class="cargos-desglose-header">
                <label class="metas-turno-title">
                  🎯 Matriz de Metas Diarias por Turno Operativo (Cuadrante de Cobertura):
                </label>
                <small class="metas-turno-hint">
                  Verde ≥ Esperado · Amarillo Mínimo..&lt;Esperado · Rojo &lt; Mínimo
                </small>
              </div>
              <div class="table-responsive">
                <table class="metas-turno-table">
                  <thead>
                    <tr>
                      <th>Turno</th>
                      <th>{{ nuevoServicioModalidadDias === 'TODOS_24_7' ? 'Mín. (24/7)' : (nuevoServicioModalidadDias === 'LUN_VIE_HABILES' ? 'Mín. (Lun–Vie)' : 'Mín. (Lun–Sáb)') }}</th>
                      <th>{{ nuevoServicioModalidadDias === 'TODOS_24_7' ? 'Esp. (24/7)' : (nuevoServicioModalidadDias === 'LUN_VIE_HABILES' ? 'Esp. (Lun–Vie)' : 'Esp. (Lun–Sáb)') }}</th>
                      @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS') {
                        <th class="col-df">Mín. Dom/Fest</th>
                        <th class="col-df">Esp. Dom/Fest</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of nuevoServicioMetasPorTurno; track m.codigoTurno) {
                      <tr>
                        <td>
                          <div class="meta-turno-badge-cell">
                            <span
                              class="mini-shift"
                              [style.background-color]="m.colorHex || '#E0F2FE'"
                              [style.color]="obtenerCfgMeta(m.codigoTurno)?.textHex || '#0F172A'"
                              [style.border-color]="obtenerCfgMeta(m.codigoTurno)?.borderHex || '#94A3B8'">
                              {{ m.codigoTurno }}
                            </span>
                            <div class="meta-turno-meta">
                              <strong>{{ m.nombreTurno || m.codigoTurno }}</strong>
                              <small>{{ m.horasOrdinarias || 8 }}h · {{ m.horaInicio }}-{{ m.horaFin }}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="50"
                            class="cargo-meta-input"
                            [attr.aria-label]="'Mínimo base ' + m.codigoTurno"
                            [ngModel]="m.minimoBase"
                            (ngModelChange)="actualizarMetaTurnoEnServicioForm.emit({ codigoTurno: m.codigoTurno, campo: 'minimoBase', valor: +$event })"
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="50"
                            class="cargo-meta-input"
                            [attr.aria-label]="'Esperado base ' + m.codigoTurno"
                            [ngModel]="m.esperadoBase"
                            (ngModelChange)="actualizarMetaTurnoEnServicioForm.emit({ codigoTurno: m.codigoTurno, campo: 'esperadoBase', valor: +$event })"
                          />
                        </td>
                        @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS') {
                          <td>
                            <input
                              type="number"
                              min="0"
                              max="50"
                              class="cargo-meta-input"
                              [attr.aria-label]="'Mínimo dom/fest ' + m.codigoTurno"
                              [ngModel]="m.minimoDomFest"
                              (ngModelChange)="actualizarMetaTurnoEnServicioForm.emit({ codigoTurno: m.codigoTurno, campo: 'minimoDomFest', valor: +$event })"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              max="50"
                              class="cargo-meta-input"
                              [attr.aria-label]="'Esperado dom/fest ' + m.codigoTurno"
                              [ngModel]="m.esperadoDomFest"
                              (ngModelChange)="actualizarMetaTurnoEnServicioForm.emit({ codigoTurno: m.codigoTurno, campo: 'esperadoDomFest', valor: +$event })"
                            />
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <!-- Pre-check Capacidad vs Demanda Mensual -->
              <div
                class="capacidad-demanda-banner"
                [class.cap-deficit]="servicioEditandoId && balanceCap.diferencia < 0"
                [class.cap-ok]="servicioEditandoId && balanceCap.diferencia >= 0">
                <div class="cap-row">
                  <span>📊 Demanda esperada ({{ balanceCap.mesNombre }}): <strong>{{ balanceCap.demandaHoras }}h/mes</strong></span>
                  @if (servicioEditandoId) {
                    <span>
                      👥 Plantilla actual ({{ balanceCap.personas }} colab.): <strong>{{ balanceCap.capacidadHoras }}h/mes</strong>
                      ({{ balanceCap.diferencia >= 0 ? '+' : '' }}{{ balanceCap.diferencia }}h)
                    </span>
                  } @else {
                    <span>👥 Personal estimado requerido (~168h/mes): <strong>{{ balanceCap.personasEstimadas }} colab.</strong></span>
                  }
                </div>
                @if (servicioEditandoId && balanceCap.diferencia < 0) {
                  <small class="cap-alert-text">
                    ⚠️ La demanda esperada supera la capacidad nominal actual del servicio en {{ -balanceCap.diferencia }}h (requerirá horas extras o personal de apoyo).
                  </small>
                }
              </div>
            </div>
          } @else {
            <div class="modalidad-info-banner">
              💡 Selecciona una plantilla rápida o haz clic en un turno de la lista superior para configurar metas diarias individuales por cada código de turno.
            </div>
          }

          @if (nuevoServicioReglasPorCargo.length > 0) {
            <div class="form-row cargos-desglose-box">
              <div class="cargos-desglose-header">
                <label class="cargos-desglose-title">
                  👥 Desglose de Metas y Turnos por Cargo (Plantilla del Servicio):
                </label>
                <small class="cargos-desglose-hint">
                  La suma actualiza automáticamente el total del servicio
                </small>
              </div>
              <div class="cargos-list">
                @for (regla of nuevoServicioReglasPorCargo; track regla.categoriaNombre) {
                  <div class="cargo-card">
                    <div class="cargo-card-header">
                      <strong class="cargo-card-name">{{ regla.categoriaNombre }}</strong>
                      <span class="cargo-card-count">
                        {{ regla.empleadosCount || 0 }} en plantilla
                      </span>
                    </div>

                    <div class="cargo-metas-grid">
                      <div class="cargo-meta-field">
                        <span class="cargo-meta-label">☀️ Día:</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          class="cargo-meta-input"
                          [attr.aria-label]="'Meta día ' + regla.categoriaNombre"
                          [ngModel]="regla.reqDia"
                          (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqDia', valor: +$event })"
                        />
                      </div>
                      <div class="cargo-meta-field">
                        <span class="cargo-meta-label">🌙 Noche:</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          class="cargo-meta-input"
                          [attr.aria-label]="'Meta noche ' + regla.categoriaNombre"
                          [ngModel]="regla.reqNoche"
                          (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqNoche', valor: +$event })"
                        />
                      </div>
                    </div>

                    @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS') {
                      <div class="cargo-metas-df-grid">
                        <div class="cargo-meta-field">
                          <span class="cargo-meta-label is-df">🗓️ Día Dom/Fest:</span>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            class="cargo-meta-input"
                            [attr.aria-label]="'Meta día dom/fest ' + regla.categoriaNombre"
                            [ngModel]="regla.reqDiaDomFest"
                            (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqDiaDomFest', valor: +$event })"
                          />
                        </div>
                        <div class="cargo-meta-field">
                          <span class="cargo-meta-label is-df">🗓️ Noche Dom/Fest:</span>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            class="cargo-meta-input"
                            [attr.aria-label]="'Meta noche dom/fest ' + regla.categoriaNombre"
                            [ngModel]="regla.reqNocheDomFest"
                            (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqNocheDomFest', valor: +$event })"
                          />
                        </div>
                      </div>
                    }

                    <div class="cargo-turnos-row">
                      <span class="cargo-turnos-label">Turnos del cargo:</span>
                      @for (tOp of turnosOperativosHabilitadosEnForm; track tOp.codigo) {
                        @let actCargo = esTurnoHabilitadoEnCargoForm(regla.categoriaNombre, tOp.codigo);
                        <button
                          type="button"
                          class="cargo-turno-chip"
                          [attr.aria-pressed]="actCargo"
                          (click)="alternarTurnoEnCargoForm.emit({ categoriaNombre: regla.categoriaNombre, codigoTurno: tOp.codigo })"
                          [title]="tOp.nombre + ' (' + tOp.horario + ')'"
                          [style.background-color]="actCargo ? tOp.bgHex : '#f8fafc'"
                          [style.color]="actCargo ? tOp.textHex : '#94a3b8'"
                          [style.border-color]="actCargo ? tOp.borderHex : '#cbd5e1'">
                          {{ actCargo ? '✓ ' : '' }}{{ tOp.codigo }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
          <div class="form-actions form-actions-gap">
            <button type="button" class="btn-primary" (click)="guardarServicioAutonomo.emit()">
              💾 {{ servicioEditandoId ? 'Guardar Cambios' : 'Crear Servicio' }}
            </button>
            @if (servicioEditandoId) {
              <button type="button" class="btn-outline" (click)="cancelarEdicionServicio.emit()">
                ✕ Cancelar
              </button>
            }
          </div>
        </div>
      </div>

      <!-- Tarjeta Vincular Servicios de Apoyo -->
      <div class="panel-card">
        <div class="panel-header">
          <h3>🔗 Vincular Servicios de Apoyo</h3>
        </div>
        <div class="form-vertical">
          <div class="form-row">
            <label for="select-enlace-srv1">Servicio Principal:</label>
            <select
              id="select-enlace-srv1"
              [ngModel]="enlaceHermanoSrv1"
              (ngModelChange)="cambiarEnlaceHermanoSrv1.emit($event)"
            >
              @for (s of servicios; track s.id) {
                <option [value]="s.id">{{ s.nombre }} ({{ s.codigo }})</option>
              }
            </select>
          </div>
          <div class="form-row">
            <label for="select-enlace-srv2">Servicio de Apoyo (verificando compatibilidad de cargos):</label>
            <select
              id="select-enlace-srv2"
              [ngModel]="enlaceHermanoSrv2"
              (ngModelChange)="cambiarEnlaceHermanoSrv2.emit($event)"
            >
              <option value="" disabled>-- Seleccionar Servicio de Apoyo --</option>
              @for (s of servicios; track s.id) {
                @let comp = estadoCompatibilidadCargos(enlaceHermanoSrv1, s);
                <option [value]="s.id" [disabled]="s.id === enlaceHermanoSrv1">
                  {{ s.nombre }} ({{ s.codigo }})
                  @if (s.id !== enlaceHermanoSrv1) {
                    @if (comp === 'COMPATIBLE') { — ✅ Cargo compatible }
                    @else if (comp === 'INCOMPATIBLE') { — ⚠️ Cargos distintos }
                  }
                </option>
              }
            </select>
          </div>
          <div class="form-actions">
            <button type="button" class="btn-wizard" (click)="guardarEnlaceHermanos.emit()">
              🔗 Vincular Servicios de Apoyo
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Directorio de Servicios Configurados -->
    <div class="panel-card">
      <div class="panel-header directorio-panel-header">
        <div class="directorio-title-cluster">
          <h3>📋 Directorio de Servicios</h3>
          <span class="badge-count">{{ serviciosFiltradosPorMacroproceso.length }} de {{ servicios.length }} Servicios</span>
        </div>
        <div class="directorio-controls-cluster">
          <select
            class="directorio-macro-select"
            aria-label="Filtrar directorio por Macroproceso"
            [ngModel]="filtroMacroproceso()"
            (ngModelChange)="filtroMacroproceso.set($event)"
            title="Filtrar directorio por Macroproceso del Mapa de Procesos"
          >
            <option value="TODOS">🗺️ Todos los Macroprocesos ({{ servicios.length }})</option>
            @for (m of catalogoMacroprocesos; track m.codigo) {
              <option [value]="m.codigo">{{ m.icono }} {{ m.nombreCorto }} ({{ contarServiciosEnMacroproceso(m.codigo) }})</option>
            }
          </select>
          <button
            type="button"
            class="btn-sm-secondary"
            (click)="expandirTodosLosServicios()"
          >
            {{ serviciosExpandidos().size === servicios.length && servicios.length > 0 ? '▲ Colapsar Todo el Personal' : '👥 Desplegar Todo el Personal' }}
          </button>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre del Servicio</th>
              <th>Macroproceso (Mapa de Procesos)</th>
              <th>Metas (Día / Noche)</th>
              <th>Turnos Operativos</th>
              <th>Personal</th>
              <th>Servicios de Apoyo Vinculados</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            @for (srv of serviciosFiltradosPorMacroproceso; track srv.id) {
              <tr>
                <td><strong class="font-mono">{{ srv.codigo }}</strong></td>
                <td>
                  <strong>{{ srv.nombre }}</strong>
                  @if (srv.cargosPermitidos && srv.cargosPermitidos.length > 0) {
                    <div class="srv-cargos-chips">
                      @for (cp of srv.cargosPermitidos; track cp.categoriaId || cp.categoriaNombre) {
                        <span class="badge-cargo-srv">{{ cp.categoriaNombre }}</span>
                      }
                    </div>
                  }
                  @if (srv.permitePermutaEntreCargos) {
                    <div class="srv-permuta-note">🔄 Permuta multi-cargo habilitada</div>
                  }
                </td>
                <td>
                  @let macro = infoMacroproceso(srv.tipoAsistencia);
                  <span class="badge-tipo-asistencia" [title]="macro.nombre">
                    <span aria-hidden="true">{{ macro.icono }}</span>
                    <span>{{ macro.nombreCorto }}</span>
                  </span>
                </td>
                <td class="font-mono">
                  <div class="metas-cell-stack">
                    @if (srv.metasPorTurno && srv.metasPorTurno.length > 0) {
                      <div class="metas-turno-pills">
                        @for (mt of srv.metasPorTurno; track mt.codigoTurno) {
                          <span
                            class="meta-turno-pill"
                            [title]="'Mín: ' + mt.minimoBase + ' / Esp: ' + mt.esperadoBase + (srv.modalidadDias === 'TODOS_GUARDIA_FDS' ? ' | Dom/Fest: ' + mt.minimoDomFest + '–' + mt.esperadoDomFest : '')">
                            <strong>{{ mt.codigoTurno }}</strong>: {{ mt.minimoBase }}–{{ mt.esperadoBase }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="badge-personal" [title]="srv.modalidadDias === 'LUN_VIE_HABILES' ? 'Mínimo requerido Lunes a Viernes: Día / Noche' : 'Mínimo requerido Lunes a Sábado: Día / Noche'">
                        ☀️{{ srv.reqDia }} • 🌙{{ srv.reqNoche }}
                      </span>
                    }
                    <small class="modalidad-subtext">
                      {{ etiquetaModalidadDias(srv.modalidadDias) }}
                      @if (srv.modalidadDias === 'TODOS_GUARDIA_FDS' && (!srv.metasPorTurno || srv.metasPorTurno.length === 0)) {
                        (Dom/Fest: {{ srv.reqDiaDomFest ?? srv.reqDia }}/{{ srv.reqNocheDomFest ?? srv.reqNoche }})
                      }
                    </small>
                    @if (srv.reglasPorCargo && srv.reglasPorCargo.length > 0) {
                      <div class="reglas-cargo-mini-list">
                        @for (rc of srv.reglasPorCargo; track rc.categoriaNombre) {
                          <small class="regla-cargo-mini-item">
                            <strong>{{ rc.categoriaNombre }}:</strong> ☀️{{ rc.reqDia }} / 🌙{{ rc.reqNoche }}
                            @if (srv.modalidadDias === 'TODOS_GUARDIA_FDS') {
                              <span> • Dom/Fest {{ rc.reqDiaDomFest ?? rc.reqDia }}/{{ rc.reqNocheDomFest ?? rc.reqNoche }}</span>
                            }
                          </small>
                        }
                      </div>
                    }
                  </div>
                </td>
                <td>
                  <div class="turnos-operativos-wrap">
                    @for (tOp of obtenerTurnosOperativosServicio(srv); track tOp.codigo) {
                      <span
                        class="mini-shift mini-shift-servicio"
                        [style.background-color]="tOp.bgHex"
                        [style.color]="tOp.textHex"
                        [title]="tOp.nombre + ' (' + tOp.horario + ')'">
                        {{ tOp.codigo }}
                      </span>
                    }
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    (click)="alternarDesplieguePersonal(srv.id)"
                    class="btn-personal-toggle"
                    [class.is-expanded]="serviciosExpandidos().has(srv.id)"
                    [attr.aria-expanded]="serviciosExpandidos().has(srv.id)"
                    [title]="serviciosExpandidos().has(srv.id) ? 'Clic para ocultar el personal' : 'Clic para desplegar el personal de ' + srv.nombre"
                  >
                    <span>👥 {{ srv.empleadosCount || obtenerEmpleadosDelServicio(srv.id).length }}</span>
                    <span class="personal-toggle-arrow">{{ serviciosExpandidos().has(srv.id) ? '▲ Ocultar' : '▼ Ver personal' }}</span>
                  </button>
                </td>
                <td>
                  @if (srv.hermanos && srv.hermanos.length > 0) {
                    <div class="hermanos-tags-wrap">
                      @for (h of srv.hermanos; track h.id) {
                        <span class="tag-hermano">
                          🔗 {{ h.nombre }} ({{ h.codigo }})
                          <button
                            type="button"
                            class="btn-tag-remove"
                            [attr.aria-label]="'Quitar vínculo de apoyo ' + h.nombre"
                            (click)="desenlazarServicioHermano.emit({ srvId: srv.id, hermanoId: h.id })"
                            title="Quitar vínculo de apoyo"
                          >✕</button>
                        </span>
                      }
                    </div>
                  } @else {
                    <span class="text-muted">Sin servicios de apoyo</span>
                  }
                </td>
                <td>
                  <div class="table-actions-cluster">
                    <button
                      type="button"
                      class="btn-sm-primary"
                      (click)="abrirCuadroServicio.emit(srv.id)"
                      title="Abrir este servicio en el cuadro de turnos"
                    >
                      📅 Cuadro
                    </button>
                    <button
                      type="button"
                      class="btn-action-icon"
                      [attr.aria-label]="'Editar servicio ' + srv.nombre"
                      (click)="cargarServicioParaEdicion.emit(srv)"
                      title="Editar código, nombre o área asistencial"
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      class="btn-action-icon btn-action-danger"
                      [attr.aria-label]="'Eliminar servicio ' + srv.nombre"
                      (click)="eliminarServicioAutonomo.emit(srv)"
                      [disabled]="(srv.empleadosCount || 0) > 0"
                      [title]="(srv.empleadosCount || 0) > 0 ? 'No se puede eliminar: tiene ' + srv.empleadosCount + ' colaboradores adscritos' : 'Eliminar este servicio'"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
              @if (serviciosExpandidos().has(srv.id)) {
                <tr class="row-personal-desplegado">
                  <td colspan="8" class="row-personal-cell">
                    <div class="personal-drawer-card">
                      <div class="personal-drawer-header">
                        <div class="personal-drawer-title-group">
                          <span class="personal-drawer-icon" aria-hidden="true">👥</span>
                          <strong class="personal-drawer-title">
                            Personal Adscrito a {{ srv.nombre }} ({{ srv.codigo }})
                          </strong>
                          <span class="personal-drawer-count-pill">
                            {{ obtenerEmpleadosDelServicio(srv.id).length }} colaboradores
                          </span>
                        </div>
                        <div class="personal-drawer-actions">
                          @if (obtenerEmpleadosDelServicio(srv.id).length > 0) {
                            <button
                              type="button"
                              class="btn-outline btn-plantilla-sm"
                              (click)="alternarSeleccionTodosServicio(srv.id)">
                              {{ todosSeleccionadosEnServicio(srv.id) ? '☐ Desmarcar todos' : '☑️ Seleccionar todos' }}
                            </button>
                          }
                          <small class="personal-drawer-subtitle">
                            Adscripción Autónoma
                          </small>
                        </div>
                      </div>

                      @let selIds = obtenerSeleccionadosEnServicio(srv.id);
                      @if (selIds.length > 0) {
                        <div class="batch-transfer-bar">
                          <strong>🔄 {{ selIds.length }} seleccionado(s) para traslado masivo a:</strong>
                          <select
                            class="batch-transfer-select"
                            [attr.aria-label]="'Servicio destino para traslado desde ' + srv.nombre"
                            [ngModel]="destinoTrasladoPorServicio[srv.id] || ''"
                            (ngModelChange)="destinoTrasladoPorServicio[srv.id] = $event"
                          >
                            <option value="" disabled>-- Elegir servicio destino --</option>
                            @for (dest of servicios; track dest.id) {
                              @if (dest.id !== srv.id) {
                                <option [value]="dest.id">{{ dest.nombre }} ({{ dest.codigo }})</option>
                              }
                            }
                          </select>
                          <button
                            type="button"
                            class="btn-sm-primary"
                            [disabled]="!destinoTrasladoPorServicio[srv.id]"
                            (click)="ejecutarTrasladoLote(srv.id)">
                            🚚 Trasladar Lote
                          </button>
                          <button
                            type="button"
                            class="btn-outline btn-plantilla-sm"
                            (click)="limpiarSeleccionServicio(srv.id)">
                            Cancelar
                          </button>
                        </div>
                      }

                      @if (obtenerEmpleadosDelServicio(srv.id).length === 0) {
                        <div class="personal-drawer-empty">
                          ⚠️ Este servicio no cuenta con personal adscrito actualmente.
                        </div>
                      } @else {
                        <div class="personal-cargos-list">
                          @for (grupo of obtenerEmpleadosAgrupadosPorCargo(srv.id); track grupo.cargo) {
                            <div class="personal-cargo-group">
                              <div class="personal-cargo-header">
                                <strong class="personal-cargo-title">
                                  <span class="personal-cargo-pin" aria-hidden="true">🏷️</span> {{ grupo.cargo }}
                                </strong>
                                <span class="personal-cargo-count">
                                  {{ grupo.colaboradores.length }} {{ grupo.colaboradores.length === 1 ? 'colaborador' : 'colaboradores' }}
                                </span>
                              </div>

                              <div class="personal-cards-grid">
                                @for (colab of grupo.colaboradores; track colab.id) {
                                  @let regSem = colab.horasSemanalesAplicadas ?? colab.empresaContratante?.horasSemanalesContrato ?? colab.horasSemanalesLey ?? 42;
                                  <div
                                    class="colaborador-mini-card"
                                    [class.is-selected]="seleccionadosTraslado.has(colab.id)">
                                    <div class="colaborador-card-top">
                                      <label class="colab-select-label">
                                        <input
                                          type="checkbox"
                                          [checked]="seleccionadosTraslado.has(colab.id)"
                                          (change)="alternarSeleccionColaborador(colab.id)"
                                        />
                                        <div class="colaborador-mini-info">
                                          <span class="colaborador-mini-name" [title]="colab.nombre">
                                            {{ colab.nombre }}
                                          </span>
                                          <span class="colaborador-mini-doc">
                                            CC: {{ colab.documento }}
                                          </span>
                                        </div>
                                      </label>
                                      <div class="colaborador-mini-metrics">
                                        <span
                                          class="colaborador-empresa-badge"
                                          [class.is-pendiente]="colab.empresaContratante?.estadoConfiguracion === 'PENDIENTE_REGLAS'"
                                          [title]="(colab.empresaContratante?.nombre || 'Empresa por defecto') + ' (' + regSem + 'h/sem)'">
                                          {{ colab.empresaContratante?.codigo || 'CST' }} · {{ regSem }}h
                                        </span>
                                        <span class="colaborador-contrato-badge" title="Meta nominal de días hábiles del mes">
                                          ⏱️ {{ colab.horasContratoMes }}h/mes
                                        </span>
                                        <span
                                          class="colaborador-banco-badge"
                                          [class.banco-neg]="(colab.saldoBancoAnterior || 0) < 0"
                                          [class.banco-pos]="(colab.saldoBancoAnterior || 0) > 0"
                                          title="Saldo en Banco de Horas"
                                        >
                                          🏦 {{ (colab.saldoBancoAnterior || 0) > 0 ? '+' : '' }}{{ colab.saldoBancoAnterior || 0 }}h
                                        </span>
                                      </div>
                                    </div>
                                    <div class="colaborador-adscripcion-row">
                                      <span class="adscripcion-label">Servicio:</span>
                                      <select
                                        class="adscripcion-select"
                                        [attr.aria-label]="'Cambiar servicio de ' + colab.nombre"
                                        [ngModel]="colab.servicioBaseId"
                                        (ngModelChange)="cambiarServicioEmpleadoIndividual(colab.id, $event)"
                                      >
                                        @for (sDest of servicios; track sDest.id) {
                                          <option [value]="sDest.id">{{ sDest.codigo }} — {{ sDest.nombre }}</option>
                                        }
                                      </select>
                                    </div>
                                  </div>
                                }
                              </div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class ConfiguracionServiciosComponent {
  @Input() macroprocesos: MacroprocesoInfo[] = [];
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() empleados: EmpleadoHospital[] = [];
  @Input() categoriasProfesionales: CategoriaProfesionalItem[] = [];
  @Input() totalCategoriasUnicas = 0;
  @Input() totalEnlacesApoyo = 0;
  @Input() servicioEditandoId: string | null = null;
  @Input() nuevoServicioCodigo = '';
  @Input() nuevoServicioNombre = '';
  @Input() nuevoServicioTipoAsistencia: any = 'URGENCIAS';
  @Input() nuevoServicioModalidadDias: any = 'TODOS_24_7';
  @Input() nuevoServicioPermitePermutaEntreCargos = false;
  @Input() nuevoServicioCargosPermitidosIds: string[] = [];
  @Input() nuevoServicioMetasPorTurno: MetaTurnoServicio[] = [];
  @Input() nuevoServicioReqDia = 4;
  @Input() nuevoServicioReqNoche = 2;
  @Input() nuevoServicioReqDiaDomFest = 2;
  @Input() nuevoServicioReqNocheDomFest = 1;
  @Input() listaTurnosCatalogo: TipoTurnoConfig[] = [];
  @Input() nuevoServicioTurnosHabilitados: string[] = [];
  @Input() nuevoServicioReglasPorCargo: ReglaCargoServicio[] = [];
  @Input() turnosOperativosHabilitadosEnForm: TipoTurnoConfig[] = [];
  @Input() enlaceHermanoSrv1 = '';
  @Input() enlaceHermanoSrv2 = '';
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};

  @Output() cambiarNuevoServicioCodigo = new EventEmitter<string>();
  @Output() cambiarNuevoServicioNombre = new EventEmitter<string>();
  @Output() cambiarNuevoServicioTipoAsistencia = new EventEmitter<any>();
  @Output() cambiarNuevoServicioModalidadDias = new EventEmitter<any>();
  @Output() cambiarNuevoServicioPermitePermutaEntreCargos = new EventEmitter<boolean>();
  @Output() alternarCargoPermitidoEnServicioForm = new EventEmitter<string>();
  @Output() actualizarMetaTurnoEnServicioForm = new EventEmitter<{
    codigoTurno: string;
    campo: 'minimoBase' | 'esperadoBase' | 'minimoDomFest' | 'esperadoDomFest';
    valor: number;
  }>();
  @Output() cambiarNuevoServicioReqDia = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNoche = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqDiaDomFest = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNocheDomFest = new EventEmitter<number>();
  @Output() aplicarPlantillaTurnosServicio = new EventEmitter<'ROTATIVO_8H' | 'GUARDIAS_12_24' | 'ADMINISTRATIVO' | 'TODOS'>();
  @Output() alternarTurnoEnServicioForm = new EventEmitter<string>();
  @Output() actualizarMetaCargoForm = new EventEmitter<{ categoriaNombre: string; campo: 'reqDia' | 'reqNoche' | 'reqDiaDomFest' | 'reqNocheDomFest'; valor: number }>();
  @Output() alternarTurnoEnCargoForm = new EventEmitter<{ categoriaNombre: string; codigoTurno: string }>();
  @Output() guardarServicioAutonomo = new EventEmitter<void>();
  @Output() cancelarEdicionServicio = new EventEmitter<void>();
  @Output() cambiarEnlaceHermanoSrv1 = new EventEmitter<string>();
  @Output() cambiarEnlaceHermanoSrv2 = new EventEmitter<string>();
  @Output() guardarEnlaceHermanos = new EventEmitter<void>();
  @Output() desenlazarServicioHermano = new EventEmitter<{ srvId: string; hermanoId: string }>();
  @Output() abrirCuadroServicio = new EventEmitter<string>();
  @Output() cargarServicioParaEdicion = new EventEmitter<ServicioHospitalario>();
  @Output() eliminarServicioAutonomo = new EventEmitter<ServicioHospitalario>();
  @Output() adscribirEmpleadoAServicio = new EventEmitter<{ empleadoId: string; servicioBaseId: string }>();
  @Output() adscribirLoteAServicio = new EventEmitter<{ empleadoIds: string[]; servicioBaseId: string }>();

  serviciosExpandidos = signal<Set<string>>(new Set<string>());
  filtroMacroproceso = signal<string>('TODOS');
  seleccionadosTraslado = new Set<string>();
  destinoTrasladoPorServicio: Record<string, string> = {};

  get turnosDisponiblesEnForm(): TipoTurnoConfig[] {
    return (this.listaTurnosCatalogo || []).filter(
      (t) => t.activo !== false || this.esTurnoHabilitadoEnServicioForm(t.codigo)
    );
  }

  get resumenCapacidadServicioForm(): {
    demandaHoras: number;
    capacidadHoras: number;
    diferencia: number;
    personas: number;
    personasEstimadas: number;
    mesNombre: string;
  } {
    const hoyIso = hoyColombiaIso();
    const anio = Number(hoyIso.substring(0, 4)) || new Date().getFullYear();
    const mes = Number(hoyIso.substring(5, 7)) || new Date().getMonth() + 1;
    const totalDias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    let diasDomFest = 0;
    let diasNoDomFest = 0;
    let diasLunVieNoFest = 0;

    for (let d = 1; d <= totalDias; d++) {
      const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(Date.UTC(anio, mes - 1, d)).getUTCDay();
      const esDomOFest = dow === 0 || Boolean(FestivosColombiaHelper.esFestivo(iso));
      if (esDomOFest) {
        diasDomFest++;
      } else {
        diasNoDomFest++;
        if (dow >= 1 && dow <= 5) {
          diasLunVieNoFest++;
        }
      }
    }

    const mod = this.nuevoServicioModalidadDias;
    let demandaHoras = 0;
    for (const m of this.nuevoServicioMetasPorTurno) {
      const cfg = this.catalogoTurnosMap[m.codigoTurno.toUpperCase()];
      const hTurno = Number(cfg?.horasOrdinarias ?? m.horasOrdinarias ?? 8);
      if (hTurno <= 0) continue;
      if (mod === 'LUN_VIE_HABILES') {
        demandaHoras += m.esperadoBase * diasLunVieNoFest * hTurno;
      } else if (mod === 'LUN_SAB_SIN_FESTIVOS') {
        demandaHoras += m.esperadoBase * diasNoDomFest * hTurno;
      } else if (mod === 'TODOS_GUARDIA_FDS') {
        demandaHoras += (m.esperadoBase * diasNoDomFest + m.esperadoDomFest * diasDomFest) * hTurno;
      } else {
        demandaHoras += m.esperadoBase * totalDias * hTurno;
      }
    }

    const empsSrv = this.servicioEditandoId
      ? this.obtenerEmpleadosDelServicio(this.servicioEditandoId)
      : [];
    const capacidadHoras = r2(
      empsSrv.reduce((acc, e) => acc + (Number(e.horasContratoMes) || 0), 0)
    );
    const demandaRed = r2(demandaHoras);
    const diferencia = r2(capacidadHoras - demandaRed);
    const mesesNom = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    return {
      demandaHoras: demandaRed,
      capacidadHoras,
      diferencia,
      personas: empsSrv.length,
      personasEstimadas: Math.max(0, Math.ceil(demandaRed / 168)),
      mesNombre: `${mesesNom[mes] || mes} ${anio}`,
    };
  }

  get catalogoMacroprocesos(): MacroprocesoInfo[] {
    return this.macroprocesos || [];
  }

  get serviciosFiltradosPorMacroproceso(): ServicioHospitalario[] {
    const f = this.filtroMacroproceso();
    if (!f || f === 'TODOS') return this.servicios;
    return this.servicios.filter(
      (s) => (s.tipoAsistencia || 'URGENCIAS').toUpperCase() === f
    );
  }

  infoMacroproceso(codigo?: string): { codigo: string; nombre: string; nombreCorto: string; icono: string; modalidadSugerida?: any; plantillaTurnosSugerida?: any } {
    const cod = (codigo || 'URGENCIAS').toUpperCase();
    return (
      (this.macroprocesos || []).find((m) => m.codigo === cod) || {
        codigo: cod,
        nombre: cod,
        nombreCorto: cod,
        icono: '🏥',
      }
    );
  }

  contarServiciosEnMacroproceso(codigo: string): number {
    return (this.servicios || []).filter(
      (s) => (s.tipoAsistencia || 'URGENCIAS').toUpperCase() === codigo
    ).length;
  }

  onSeleccionarMacroprocesoForm(codigo: string): void {
    this.cambiarNuevoServicioTipoAsistencia.emit(codigo);
    if (!this.servicioEditandoId) {
      const info = this.infoMacroproceso(codigo);
      if (info.modalidadSugerida) {
        this.cambiarNuevoServicioModalidadDias.emit(info.modalidadSugerida);
      }
      if (info.plantillaTurnosSugerida) {
        this.aplicarPlantillaTurnosServicio.emit(info.plantillaTurnosSugerida);
      }
    }
  }

  alternarDesplieguePersonal(servicioId: string): void {
    this.serviciosExpandidos.update((set) => {
      const nuevo = new Set(set);
      if (nuevo.has(servicioId)) {
        nuevo.delete(servicioId);
      } else {
        nuevo.add(servicioId);
      }
      return nuevo;
    });
  }

  expandirTodosLosServicios(): void {
    if (this.serviciosExpandidos().size === this.servicios.length) {
      this.serviciosExpandidos.set(new Set());
    } else {
      this.serviciosExpandidos.set(new Set(this.servicios.map((s) => s.id)));
    }
  }

  obtenerEmpleadosDelServicio(servicioId: string): EmpleadoHospital[] {
    return (this.empleados || []).filter((e) => e.servicioBaseId === servicioId);
  }

  obtenerEmpleadosAgrupadosPorCargo(servicioId: string): { cargo: string; colaboradores: EmpleadoHospital[] }[] {
    const emps = this.obtenerEmpleadosDelServicio(servicioId);
    const grupos = new Map<string, EmpleadoHospital[]>();
    for (const emp of emps) {
      const cat = emp.categoria || 'Sin cargo asignado';
      const list = grupos.get(cat) || [];
      list.push(emp);
      grupos.set(cat, list);
    }
    return Array.from(grupos.entries())
      .map(([cargo, colaboradores]) => ({
        cargo,
        colaboradores: colaboradores.sort((a, b) => a.nombre.localeCompare(b.nombre)),
      }))
      .sort((a, b) => a.cargo.localeCompare(b.cargo));
  }

  esTurnoHabilitadoEnServicioForm(codigo: string): boolean {
    return this.nuevoServicioTurnosHabilitados.includes(codigo.toUpperCase());
  }

  esTurnoHabilitadoEnCargoForm(categoriaNombre: string, codigoTurno: string): boolean {
    const regla = this.nuevoServicioReglasPorCargo.find((r) => r.categoriaNombre === categoriaNombre);
    if (!regla) return true;
    return (regla.turnosHabilitados || []).map((c) => c.toUpperCase()).includes(codigoTurno.toUpperCase());
  }

  etiquetaModalidadDias(mod?: string): string {
    if (mod === 'TODOS_24_7') return 'Todos los días 24/7 (Metas continuas)';
    if (mod === 'TODOS_GUARDIA_FDS') return '24/7 (Lun–Sáb y Dom/Fest diferenciado)';
    if (mod === 'LUN_SAB_SIN_FESTIVOS') return 'Lunes a Sábado (Cierra Dom/Fest)';
    if (mod === 'LUN_VIE_HABILES') return 'Lunes a Viernes Hábiles';
    return 'Todos los días 24/7';
  }

  esCargoPermitidoEnServicioForm(categoriaId: string): boolean {
    return (this.nuevoServicioCargosPermitidosIds || []).includes(categoriaId);
  }

  estadoCompatibilidadCargos(
    srv1Id: string,
    srv2: ServicioHospitalario
  ): 'COMPATIBLE' | 'INCOMPATIBLE' | 'SIN_RESTRICCION' {
    const srv1 = (this.servicios || []).find((s) => s.id === srv1Id);
    if (!srv1 || !srv2 || srv1.id === srv2.id) return 'SIN_RESTRICCION';
    const ids1 = new Set(
      (srv1.cargosPermitidosIds?.length
        ? srv1.cargosPermitidosIds
        : (srv1.cargosPermitidos || []).map((c) => c.categoriaId)
      ).filter(Boolean)
    );
    const ids2 = new Set(
      (srv2.cargosPermitidosIds?.length
        ? srv2.cargosPermitidosIds
        : (srv2.cargosPermitidos || []).map((c) => c.categoriaId)
      ).filter(Boolean)
    );
    if (ids1.size === 0 || ids2.size === 0) return 'SIN_RESTRICCION';
    for (const id of ids1) {
      if (ids2.has(id)) return 'COMPATIBLE';
    }
    return 'INCOMPATIBLE';
  }

  alternarSeleccionColaborador(empleadoId: string): void {
    if (this.seleccionadosTraslado.has(empleadoId)) {
      this.seleccionadosTraslado.delete(empleadoId);
    } else {
      this.seleccionadosTraslado.add(empleadoId);
    }
  }

  obtenerSeleccionadosEnServicio(servicioId: string): string[] {
    const emps = this.obtenerEmpleadosDelServicio(servicioId);
    return emps.filter((e) => this.seleccionadosTraslado.has(e.id)).map((e) => e.id);
  }

  todosSeleccionadosEnServicio(servicioId: string): boolean {
    const emps = this.obtenerEmpleadosDelServicio(servicioId);
    return emps.length > 0 && emps.every((e) => this.seleccionadosTraslado.has(e.id));
  }

  alternarSeleccionTodosServicio(servicioId: string): void {
    const emps = this.obtenerEmpleadosDelServicio(servicioId);
    if (this.todosSeleccionadosEnServicio(servicioId)) {
      emps.forEach((e) => this.seleccionadosTraslado.delete(e.id));
    } else {
      emps.forEach((e) => this.seleccionadosTraslado.add(e.id));
    }
  }

  limpiarSeleccionServicio(servicioId: string): void {
    this.obtenerEmpleadosDelServicio(servicioId).forEach((e) =>
      this.seleccionadosTraslado.delete(e.id)
    );
  }

  cambiarServicioEmpleadoIndividual(empleadoId: string, servicioBaseId: string): void {
    if (!empleadoId || !servicioBaseId) return;
    this.seleccionadosTraslado.delete(empleadoId);
    this.adscribirEmpleadoAServicio.emit({ empleadoId, servicioBaseId });
  }

  ejecutarTrasladoLote(servicioOrigenId: string): void {
    const destino = this.destinoTrasladoPorServicio[servicioOrigenId];
    const ids = this.obtenerSeleccionadosEnServicio(servicioOrigenId);
    if (!destino || ids.length === 0) return;
    this.adscribirLoteAServicio.emit({ empleadoIds: ids, servicioBaseId: destino });
    ids.forEach((id) => this.seleccionadosTraslado.delete(id));
    this.destinoTrasladoPorServicio[servicioOrigenId] = '';
  }

  obtenerCfgMeta(codigo: string): TipoTurnoConfig | undefined {
    return this.catalogoTurnosMap[codigo];
  }

  obtenerTurnosOperativosServicio(srv: ServicioHospitalario): TipoTurnoConfig[] {
    const codigos =
      srv.turnosHabilitados && srv.turnosHabilitados.length > 0
        ? srv.turnosHabilitados
        : ['M8', 'T8', 'N8', 'D12', 'G24'];
    return codigos
      .map((c) => this.catalogoTurnosMap[c.toUpperCase()])
      .filter((t): t is TipoTurnoConfig => Boolean(t && t.horasOrdinarias > 0 && !t.esAusencia));
  }
}
