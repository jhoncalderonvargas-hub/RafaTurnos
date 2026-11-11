import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EmpleadoHospital,
  MacroprocesoInfo,
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
                  [disabled]="nuevoServicioReglasPorCargo.length > 0"
                  [title]="nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : ''"
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
                  [disabled]="nuevoServicioReglasPorCargo.length > 0"
                  [title]="nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : ''"
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
                    [disabled]="nuevoServicioReglasPorCargo.length > 0"
                    [title]="nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : ''"
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
                    [disabled]="nuevoServicioReglasPorCargo.length > 0"
                    [title]="nuevoServicioReglasPorCargo.length > 0 ? 'Calculado automáticamente desde el desglose por cargo' : ''"
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
              @for (t of listaTurnosCatalogo; track t.codigo) {
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
            <label for="select-enlace-srv2">Servicio de Apoyo:</label>
            <select
              id="select-enlace-srv2"
              [ngModel]="enlaceHermanoSrv2"
              (ngModelChange)="cambiarEnlaceHermanoSrv2.emit($event)"
            >
              <option value="" disabled>-- Seleccionar Servicio de Apoyo --</option>
              @for (s of servicios; track s.id) {
                <option [value]="s.id" [disabled]="s.id === enlaceHermanoSrv1">
                  {{ s.nombre }} ({{ s.codigo }})
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
                    <span class="badge-personal" [title]="srv.modalidadDias === 'LUN_VIE_HABILES' ? 'Mínimo requerido Lunes a Viernes: Día / Noche' : 'Mínimo requerido Lunes a Sábado: Día / Noche'">
                      ☀️{{ srv.reqDia }} • 🌙{{ srv.reqNoche }}
                    </span>
                    <small class="modalidad-subtext">
                      {{ etiquetaModalidadDias(srv.modalidadDias) }}
                      @if (srv.modalidadDias === 'TODOS_GUARDIA_FDS') {
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
                        <small class="personal-drawer-subtitle">
                          Censo Oficial de Personal
                        </small>
                      </div>

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
                                  <div class="colaborador-mini-card">
                                    <div class="colaborador-mini-info">
                                      <span class="colaborador-mini-name" [title]="colab.nombre">
                                        {{ colab.nombre }}
                                      </span>
                                      <span class="colaborador-mini-doc">
                                        CC: {{ colab.documento }}
                                      </span>
                                    </div>
                                    <div class="colaborador-mini-metrics">
                                      <span class="colaborador-contrato-badge" title="Horas de contrato mensual">
                                        ⏱️ {{ colab.horasContratoMes || 168 }}h/mes
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
  @Input() totalCategoriasUnicas = 0;
  @Input() totalEnlacesApoyo = 0;
  @Input() servicioEditandoId: string | null = null;
  @Input() nuevoServicioCodigo = '';
  @Input() nuevoServicioNombre = '';
  @Input() nuevoServicioTipoAsistencia: any = 'URGENCIAS';
  @Input() nuevoServicioModalidadDias: any = 'TODOS_24_7';
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

  serviciosExpandidos = signal<Set<string>>(new Set<string>());
  filtroMacroproceso = signal<string>('TODOS');

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
