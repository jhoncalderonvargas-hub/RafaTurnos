import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EmpleadoHospital,
  ModalidadDiasServicio,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoAsistencia,
  TipoTurnoConfig,
} from '../../models';

@Component({
  selector: 'app-configuracion-servicios',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
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
            <label>Código (3-6 letras):</label>
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
            <label>Nombre del Servicio:</label>
            <input
              type="text"
              placeholder="Ej: Hemodiálisis Ambulatoria"
              [ngModel]="nuevoServicioNombre"
              (ngModelChange)="cambiarNuevoServicioNombre.emit($event)"
            />
          </div>
          <div class="form-row">
            <label>Área Asistencial:</label>
            <select
              [ngModel]="nuevoServicioTipoAsistencia"
              (ngModelChange)="cambiarNuevoServicioTipoAsistencia.emit($event)"
            >
              <option value="URGENCIAS">URGENCIAS (Turnos 24/7)</option>
              <option value="HOSPITALIZACION">HOSPITALIZACIÓN (Pisos y Salas)</option>
              <option value="CUIDADOS_INTENSIVOS">UCI (Cuidados Intensivos / Intermedios)</option>
              <option value="QUIRURGICO">QUIRÚRGICO (Quirófanos y Recuperación)</option>
              <option value="APOYO_DIAGNOSTICO">APOYO DIAGNÓSTICO (Laboratorio / Imágenes / Farmacia)</option>
              <option value="CONSULTA_EXTERNA">CONSULTA EXTERNA / AMBULATORIO</option>
            </select>
          </div>
          <div class="form-row">
            <label>Modalidad de Días Operativos del Servicio:</label>
            <select
              [ngModel]="nuevoServicioModalidadDias"
              (ngModelChange)="cambiarNuevoServicioModalidadDias.emit($event)"
            >
              <option value="TODOS_24_7">🕒 Todos los días 24/7 — Mismas metas de Lunes a Domingo y Festivos</option>
              <option value="TODOS_GUARDIA_FDS">🏥 Todos los días 24/7 — Con metas reducidas en Sábados, Domingos y Festivos</option>
              <option value="LUN_SAB_SIN_FESTIVOS">📅 Lunes a Sábado — Cierra Domingos y Festivos (permite meta distinta el Sábado)</option>
              <option value="LUN_VIE_HABILES">🏢 Lunes a Viernes Hábiles — Cierra Sábados, Domingos y Festivos</option>
            </select>
          </div>
          <div class="form-row">
            <label>
              @if (nuevoServicioModalidadDias === 'TODOS_24_7') {
                Metas de Cobertura Mínima Diaria (Lunes a Domingo y Festivos):
              } @else {
                Metas de Cobertura Mínima — Lunes a Viernes (Días Hábiles):
              }
            </label>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
              <div>
                <small class="text-muted">☀️ Mañana</small>
                <input
                  type="number"
                  min="0"
                  max="50"
                  [ngModel]="nuevoServicioReqManana"
                  (ngModelChange)="cambiarNuevoServicioReqManana.emit(+$event)"
                />
              </div>
              <div>
                <small class="text-muted">🌤️ Tarde</small>
                <input
                  type="number"
                  min="0"
                  max="50"
                  [ngModel]="nuevoServicioReqTarde"
                  (ngModelChange)="cambiarNuevoServicioReqTarde.emit(+$event)"
                />
              </div>
              <div>
                <small class="text-muted">🌙 Noche</small>
                <input
                  type="number"
                  min="0"
                  max="50"
                  [ngModel]="nuevoServicioReqNoche"
                  (ngModelChange)="cambiarNuevoServicioReqNoche.emit(+$event)"
                />
              </div>
            </div>
          </div>
          @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS' || nuevoServicioModalidadDias === 'LUN_SAB_SIN_FESTIVOS') {
            <div class="form-row" style="padding: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;">
              <label style="color: #92400e;">
                @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS') {
                  🌤️ Metas de Cobertura en Sábados, Domingos y Festivos (Guardia Fin de Semana):
                } @else {
                  🌤️ Metas de Cobertura el Día Sábado (Domingos y Festivos cierra en 0):
                }
              </label>
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
                <div>
                  <small class="text-muted">☀️ Mañana FDS</small>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    [ngModel]="nuevoServicioReqMananaFds"
                    (ngModelChange)="cambiarNuevoServicioReqMananaFds.emit(+$event)"
                  />
                </div>
                <div>
                  <small class="text-muted">🌤️ Tarde FDS</small>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    [ngModel]="nuevoServicioReqTardeFds"
                    (ngModelChange)="cambiarNuevoServicioReqTardeFds.emit(+$event)"
                  />
                </div>
                <div>
                  <small class="text-muted">🌙 Noche FDS</small>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    [ngModel]="nuevoServicioReqNocheFds"
                    (ngModelChange)="cambiarNuevoServicioReqNocheFds.emit(+$event)"
                  />
                </div>
              </div>
            </div>
          }
          @if (nuevoServicioModalidadDias === 'LUN_VIE_HABILES') {
            <div style="padding: 8px 10px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 12px; color: #166534;">
              ✅ En Sábados, Domingos y Festivos la meta requerida será <strong>0 / 0 / 0</strong> y el Autocompletado asignará automáticamente <strong>Libre (L)</strong>.
            </div>
          }
          <div class="form-row">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
              <label style="margin: 0;">Turnos Habilitados en este Servicio (Paleta y Autocompletar):</label>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button type="button" class="btn-outline" style="padding: 2px 7px; font-size: 11px;" (click)="aplicarPlantillaTurnosServicio.emit('ROTATIVO_8H')">
                  Rotativo 8h
                </button>
                <button type="button" class="btn-outline" style="padding: 2px 7px; font-size: 11px;" (click)="aplicarPlantillaTurnosServicio.emit('GUARDIAS_12_24')">
                  Guardias 12h/24h
                </button>
                <button type="button" class="btn-outline" style="padding: 2px 7px; font-size: 11px;" (click)="aplicarPlantillaTurnosServicio.emit('ADMINISTRATIVO')">
                  Administrativo
                </button>
                <button type="button" class="btn-outline" style="padding: 2px 7px; font-size: 11px;" (click)="aplicarPlantillaTurnosServicio.emit('TODOS')">
                  Todos
                </button>
              </div>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
              @for (t of listaTurnosCatalogo; track t.codigo) {
                @let activo = esTurnoHabilitadoEnServicioForm(t.codigo);
                <button
                  type="button"
                  (click)="alternarTurnoEnServicioForm.emit(t.codigo)"
                  [title]="t.nombre + ' (' + t.horario + ')'"
                  [style.background-color]="activo ? t.bgHex : '#ffffff'"
                  [style.color]="activo ? t.textHex : '#94a3b8'"
                  [style.border-color]="activo ? t.borderHex : '#cbd5e1'"
                  [style.opacity]="activo ? '1' : '0.6'"
                  style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; border: 1.5px solid; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease;">
                  <span>{{ activo ? '✓' : '+' }}</span>
                  <span>{{ t.codigo }}</span>
                  <span style="font-weight: 500; font-size: 10.5px;">{{ t.nombre }}</span>
                </button>
              }
            </div>
          </div>

          @if (nuevoServicioReglasPorCargo.length > 0) {
            <div class="form-row" style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 10px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0; color: #0369a1; font-weight: 700;">
                  👥 Desglose de Metas y Turnos por Cargo (Plantilla del Servicio):
                </label>
                <small style="color: #0284c7; font-size: 11px;">
                  La suma actualiza automáticamente el total del servicio
                </small>
              </div>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                @for (regla of nuevoServicioReglasPorCargo; track regla.categoriaNombre) {
                  <div style="background: #ffffff; border: 1px solid #e0f2fe; border-radius: 6px; padding: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                      <strong style="font-size: 12px; color: #0f172a;">{{ regla.categoriaNombre }}</strong>
                      <span style="font-size: 11px; color: #64748b; font-weight: 600;">
                        {{ regla.empleadosCount || 0 }} en plantilla
                      </span>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 6px;">
                      <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 10.5px; color: #64748b; min-width: 48px;">☀️ M:</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                          [ngModel]="regla.reqManana"
                          (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqManana', valor: +$event })"
                        />
                      </div>
                      <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 10.5px; color: #64748b; min-width: 48px;">🌤️ T:</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                          [ngModel]="regla.reqTarde"
                          (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqTarde', valor: +$event })"
                        />
                      </div>
                      <div style="display: flex; align-items: center; gap: 4px;">
                        <span style="font-size: 10.5px; color: #64748b; min-width: 48px;">🌙 N:</span>
                        <input
                          type="number"
                          min="0"
                          max="30"
                          style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                          [ngModel]="regla.reqNoche"
                          (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqNoche', valor: +$event })"
                        />
                      </div>
                    </div>

                    @if (nuevoServicioModalidadDias === 'TODOS_GUARDIA_FDS' || nuevoServicioModalidadDias === 'LUN_SAB_SIN_FESTIVOS') {
                      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 6px; padding-top: 4px; border-top: 1px dashed #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <span style="font-size: 10.5px; color: #0369a1; min-width: 56px;">📅 M FDS:</span>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                            [ngModel]="regla.reqMananaFds"
                            (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqMananaFds', valor: +$event })"
                          />
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <span style="font-size: 10.5px; color: #0369a1; min-width: 56px;">📅 T FDS:</span>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                            [ngModel]="regla.reqTardeFds"
                            (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqTardeFds', valor: +$event })"
                          />
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                          <span style="font-size: 10.5px; color: #0369a1; min-width: 56px;">📅 N FDS:</span>
                          <input
                            type="number"
                            min="0"
                            max="30"
                            style="padding: 2px 6px; font-size: 11.5px; width: 100%;"
                            [ngModel]="regla.reqNocheFds"
                            (ngModelChange)="actualizarMetaCargoForm.emit({ categoriaNombre: regla.categoriaNombre, campo: 'reqNocheFds', valor: +$event })"
                          />
                        </div>
                      </div>
                    }

                    <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px; padding-top: 4px;">
                      <span style="font-size: 10.5px; color: #64748b; margin-right: 4px;">Turnos del cargo:</span>
                      @for (tOp of turnosOperativosHabilitadosEnForm; track tOp.codigo) {
                        @let actCargo = esTurnoHabilitadoEnCargoForm(regla.categoriaNombre, tOp.codigo);
                        <button
                          type="button"
                          (click)="alternarTurnoEnCargoForm.emit({ categoriaNombre: regla.categoriaNombre, codigoTurno: tOp.codigo })"
                          [title]="tOp.nombre + ' (' + tOp.horario + ')'"
                          [style.background-color]="actCargo ? tOp.bgHex : '#f8fafc'"
                          [style.color]="actCargo ? tOp.textHex : '#94a3b8'"
                          [style.border-color]="actCargo ? tOp.borderHex : '#cbd5e1'"
                          style="padding: 1px 6px; border-radius: 4px; border: 1px solid; font-size: 10.5px; font-weight: 700; cursor: pointer;">
                          {{ actCargo ? '✓ ' : '' }}{{ tOp.codigo }}
                        </button>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
          <div class="form-actions" style="display: flex; gap: 8px;">
            <button class="btn-primary" (click)="guardarServicioAutonomo.emit()">
              💾 {{ servicioEditandoId ? 'Guardar Cambios' : 'Crear Servicio' }}
            </button>
            @if (servicioEditandoId) {
              <button class="btn-outline" (click)="cancelarEdicionServicio.emit()">
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
            <label>Servicio Principal:</label>
            <select
              [ngModel]="enlaceHermanoSrv1"
              (ngModelChange)="cambiarEnlaceHermanoSrv1.emit($event)"
            >
              @for (s of servicios; track s.id) {
                <option [value]="s.id">{{ s.nombre }} ({{ s.codigo }})</option>
              }
            </select>
          </div>
          <div class="form-row">
            <label>Servicio de Apoyo:</label>
            <select
              [ngModel]="enlaceHermanoSrv2"
              (ngModelChange)="cambiarEnlaceHermanoSrv2.emit($event)"
            >
              @for (s of servicios; track s.id) {
                <option [value]="s.id">{{ s.nombre }} ({{ s.codigo }})</option>
              }
            </select>
          </div>
          <div class="form-actions">
            <button class="btn-wizard" (click)="guardarEnlaceHermanos.emit()">
              🔗 Vincular Servicios de Apoyo
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Directorio de Servicios Configurados -->
    <div class="panel-card">
      <div class="panel-header">
        <h3>📋 Directorio de Servicios</h3>
        <span class="badge-count">{{ servicios.length }} Servicios</span>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre del Servicio</th>
              <th>Área</th>
              <th>Metas (M / T / N)</th>
              <th>Turnos Operativos</th>
              <th>Personal</th>
              <th>Servicios de Apoyo Vinculados</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            @for (srv of servicios; track srv.id) {
              <tr>
                <td><strong class="font-mono">{{ srv.codigo }}</strong></td>
                <td>
                  <strong>{{ srv.nombre }}</strong>
                </td>
                <td>
                  <span class="badge-tipo-asistencia">{{ srv.tipoAsistencia }}</span>
                </td>
                <td class="font-mono">
                  <div style="display: flex; flex-direction: column; gap: 3px;">
                    <span class="badge-personal" title="Mínimo requerido Lunes a Viernes: Mañana / Tarde / Noche">
                      ☀️{{ srv.reqManana }} • 🌤️{{ srv.reqTarde }} • 🌙{{ srv.reqNoche }}
                    </span>
                    <small style="font-size: 10.5px; color: #64748b; font-weight: 600;">
                      {{ etiquetaModalidadDias(srv.modalidadDias) }}
                      @if (srv.modalidadDias === 'TODOS_GUARDIA_FDS' || srv.modalidadDias === 'LUN_SAB_SIN_FESTIVOS') {
                        ({{ srv.reqMananaFds ?? srv.reqManana }}/{{ srv.reqTardeFds ?? srv.reqTarde }}/{{ srv.reqNocheFds ?? srv.reqNoche }})
                      }
                    </small>
                    @if (srv.reglasPorCargo && srv.reglasPorCargo.length > 0) {
                      <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 2px; border-top: 1px dashed #e2e8f0; padding-top: 2px;">
                        @for (rc of srv.reglasPorCargo; track rc.categoriaNombre) {
                          <small style="font-size: 10px; color: #475569;">
                            <strong>{{ rc.categoriaNombre }}:</strong> {{ rc.reqManana }}/{{ rc.reqTarde }}/{{ rc.reqNoche }}
                          </small>
                        }
                      </div>
                    }
                  </div>
                </td>
                <td>
                  <div style="display: flex; flex-wrap: wrap; gap: 4px; max-width: 240px;">
                    @for (tOp of obtenerTurnosOperativosServicio(srv); track tOp.codigo) {
                      <span
                        class="mini-shift"
                        [style.background-color]="tOp.bgHex"
                        [style.color]="tOp.textHex"
                        [title]="tOp.nombre + ' (' + tOp.horario + ')'"
                        style="padding: 1px 6px; font-size: 10.5px;">
                        {{ tOp.codigo }}
                      </span>
                    }
                  </div>
                </td>
                <td>
                  <span class="badge-personal">{{ srv.empleadosCount || 0 }} colaboradores</span>
                </td>
                <td>
                  @if (srv.hermanos && srv.hermanos.length > 0) {
                    <div class="hermanos-tags-wrap">
                      @for (h of srv.hermanos; track h.id) {
                        <span class="tag-hermano">
                          🔗 {{ h.nombre }} ({{ h.codigo }})
                          <button
                            class="btn-tag-remove"
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
                      class="btn-sm-primary"
                      (click)="abrirCuadroServicio.emit(srv.id)"
                      title="Abrir este servicio en el cuadro de turnos"
                    >
                      📅 Cuadro
                    </button>
                    <button
                      class="btn-action-icon"
                      (click)="cargarServicioParaEdicion.emit(srv)"
                      title="Editar código, nombre o área asistencial"
                    >
                      ✏️
                    </button>
                    <button
                      class="btn-action-icon btn-action-danger"
                      (click)="eliminarServicioAutonomo.emit(srv)"
                      [disabled]="(srv.empleadosCount || 0) > 0"
                      [title]="(srv.empleadosCount || 0) > 0 ? 'No se puede eliminar: tiene ' + srv.empleadosCount + ' colaboradores adscritos' : 'Eliminar este servicio'"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class ConfiguracionServiciosComponent {
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() empleados: EmpleadoHospital[] = [];
  @Input() totalCategoriasUnicas = 0;
  @Input() totalEnlacesApoyo = 0;
  @Input() servicioEditandoId: string | null = null;
  @Input() nuevoServicioCodigo = '';
  @Input() nuevoServicioNombre = '';
  @Input() nuevoServicioTipoAsistencia: any = 'URGENCIAS';
  @Input() nuevoServicioModalidadDias: any = 'TODOS_24_7';
  @Input() nuevoServicioReqManana = 4;
  @Input() nuevoServicioReqTarde = 4;
  @Input() nuevoServicioReqNoche = 2;
  @Input() nuevoServicioReqMananaFds = 4;
  @Input() nuevoServicioReqTardeFds = 4;
  @Input() nuevoServicioReqNocheFds = 2;
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
  @Output() cambiarNuevoServicioReqManana = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqTarde = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNoche = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqMananaFds = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqTardeFds = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNocheFds = new EventEmitter<number>();
  @Output() aplicarPlantillaTurnosServicio = new EventEmitter<'ROTATIVO_8H' | 'GUARDIAS_12_24' | 'ADMINISTRATIVO' | 'TODOS'>();
  @Output() alternarTurnoEnServicioForm = new EventEmitter<string>();
  @Output() actualizarMetaCargoForm = new EventEmitter<{ categoriaNombre: string; campo: 'reqManana' | 'reqTarde' | 'reqNoche' | 'reqMananaFds' | 'reqTardeFds' | 'reqNocheFds'; valor: number }>();
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
    if (mod === 'TODOS_GUARDIA_FDS') return '24/7 con guardia FDS/Festivos';
    if (mod === 'LUN_SAB_SIN_FESTIVOS') return 'Lunes a Sábado (Cierra Dom/Fest)';
    if (mod === 'LUN_VIE_HABILES') return 'Lunes a Viernes Hábiles';
    return 'Todos los días 24/7';
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
