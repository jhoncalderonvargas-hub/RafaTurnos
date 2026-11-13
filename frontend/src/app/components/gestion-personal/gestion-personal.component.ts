import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CategoriaProfesionalItem,
  EmpleadoHospital,
  EmpresaContratante,
  ServicioHospitalario,
} from '../../models';
import { coincideBusquedaCampos, dividirTerminosBusqueda } from '../../utils/busqueda-texto';

@Component({
  selector: 'app-gestion-personal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './gestion-personal.component.css',
  template: `
    <div class="module-hero-card">
      <div class="module-hero-brand">
        <div class="module-hero-icon" aria-hidden="true">🧑‍⚕️</div>
        <div class="module-hero-titles">
          <div class="module-hero-title-row">
            <h2>Gestión de Personal</h2>
            <span class="module-hero-badge">{{ empleados.length }} colaboradores</span>
            @if (nombreMes && anioSeleccionado) {
              <span class="periodo-tag">📅 {{ nombreMes }} {{ anioSeleccionado }}</span>
            }
          </div>
        </div>
      </div>

      <div class="module-hero-actions">
        <button
          type="button"
          class="btn-primary"
          [disabled]="sincronizandoNominaIntranet"
          (click)="sincronizarNominaIntranet.emit()">
          @if (sincronizandoNominaIntranet) {
            ⏳ Sincronizando nómina...
          } @else {
            🔄 Sincronizar Nómina desde Intranet
          }
        </button>
      </div>
    </div>

    <!-- Métricas de Nómina -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">{{ empleados.length }}</div>
        <div class="kpi-label">Colaboradores Activos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalCargosDistintos }}</div>
        <div class="kpi-label">Cargos Profesionales</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalConJornadaEspecial }}</div>
        <div class="kpi-label">Con Jornada Especial</div>
      </div>
      <div class="kpi-card" [class.alert-card-kpi]="totalAlertasCompatibilidad > 0">
        <div class="kpi-num">{{ totalAlertasCompatibilidad }}</div>
        <div class="kpi-label">Cargo Distinto al Servicio</div>
      </div>
    </div>

    <div class="panel-card">
      <!-- Barra de filtros transversales -->
      <div class="personal-filtros-bar">
        <input
          type="search"
          class="personal-search-input"
          aria-label="Buscar colaborador por nombre o documento"
          placeholder="🔍 Buscar por nombre o documento (CC)..."
          [ngModel]="busquedaTexto()"
          (ngModelChange)="busquedaTexto.set($event)"
        />
        <select
          class="personal-filter-select"
          aria-label="Filtrar por servicio base"
          [ngModel]="filtroServicioId()"
          (ngModelChange)="filtroServicioId.set($event)">
          <option value="TODOS">Todos los servicios ({{ servicios.length }})</option>
          @for (srv of servicios; track srv.id) {
            <option [value]="srv.id">{{ srv.codigo }} — {{ srv.nombre }}</option>
          }
        </select>
        <select
          class="personal-filter-select"
          aria-label="Filtrar por cargo profesional"
          [ngModel]="filtroCargo()"
          (ngModelChange)="filtroCargo.set($event)">
          <option value="TODOS">Todos los cargos</option>
          @for (cat of listaCargosOrdenados; track cat) {
            <option [value]="cat">{{ cat }}</option>
          }
        </select>
        <select
          class="personal-filter-select"
          aria-label="Filtrar por empresa contratante"
          [ngModel]="filtroEmpresaId()"
          (ngModelChange)="filtroEmpresaId.set($event)">
          <option value="TODOS">Todas las empresas</option>
          @for (empCorp of empresas; track empCorp.id) {
            <option [value]="empCorp.id">
              {{ empCorp.codigo }} — {{ empCorp.nombre }}{{ empCorp.estadoConfiguracion === 'PENDIENTE_REGLAS' ? ' ⚠️' : '' }}
            </option>
          }
        </select>
        <label class="personal-check-filter">
          <input
            type="checkbox"
            [ngModel]="soloConNovedadCondicion()"
            (ngModelChange)="soloConNovedadCondicion.set($event)"
          />
          <span>Solo alertas / jornada esp.</span>
        </label>
        @if (hayFiltrosActivos) {
          <button type="button" class="btn-outline btn-xs" (click)="limpiarFiltros()">
            Limpiar filtros
          </button>
        }
      </div>

      @let listaFiltrada = empleadosFiltrados;
      <!-- Barra de acciones en lote -->
      <div class="personal-lote-bar">
        <div class="personal-lote-left">
          <label class="personal-check-all">
            <input
              type="checkbox"
              [checked]="sonTodosVisiblesSeleccionados(listaFiltrada)"
              [disabled]="listaFiltrada.length === 0"
              (change)="alternarSeleccionTodosVisibles()"
            />
            <span>
              Visibles: <strong>{{ listaFiltrada.length }}</strong> ·
              Seleccionados: <strong>{{ seleccionadosIds.size }}</strong>
            </span>
          </label>
          @if (seleccionadosIds.size > 0) {
            <button type="button" class="btn-outline btn-xs" (click)="seleccionadosIds.clear()">
              Deseleccionar
            </button>
          }
        </div>

        <div class="personal-lote-actions">
          <select
            class="personal-lote-select"
            aria-label="Servicio destino para traslado en lote"
            [(ngModel)]="destinoLoteServicioId">
            <option value="">-- Trasladar seleccionados al servicio --</option>
            @for (srvDest of servicios; track srvDest.id) {
              <option [value]="srvDest.id">{{ srvDest.codigo }} — {{ srvDest.nombre }}</option>
            }
          </select>
          <button
            type="button"
            class="btn-primary btn-sm"
            [disabled]="seleccionadosIds.size === 0 || !destinoLoteServicioId"
            (click)="ejecutarTrasladoLote()">
            📦 Trasladar ({{ seleccionadosIds.size }})
          </button>
        </div>
      </div>

      <!-- Tabla Maestra de Personal -->
      <div class="personal-table-wrap">
        <table class="data-table personal-table">
          <thead>
            <tr>
              <th class="col-check"></th>
              <th>Colaborador</th>
              <th>Cargo Profesional</th>
              <th>Servicio Base</th>
              <th>Empresa Contratante</th>
              <th>Jornada Semanal</th>
              <th>Metas & Banco</th>
              <th>Accesos</th>
            </tr>
          </thead>
          <tbody>
            @for (emp of listaFiltrada; track emp.id) {
              @let compatible = esCargoCompatibleConServicio(emp);
              @let tieneOverride = emp.horasSemanalesOverride !== null && emp.horasSemanalesOverride !== undefined;
              @let saldoBanco = emp.saldoBancoAnterior || 0;
              <tr [class.row-selected]="seleccionadosIds.has(emp.id)">
                <td class="col-check">
                  <input
                    type="checkbox"
                    [attr.aria-label]="'Seleccionar a ' + emp.nombre"
                    [checked]="seleccionadosIds.has(emp.id)"
                    (change)="alternarSeleccion(emp.id)"
                  />
                </td>
                <td>
                  <div class="personal-name-cell">
                    <strong>{{ emp.nombre }}</strong>
                    <span class="personal-doc">CC: {{ emp.documento }}</span>
                  </div>
                </td>
                <td>
                  <div class="personal-cargo-cell">
                    <span class="badge-cargo-table">{{ emp.categoria }}</span>
                    @if (!compatible) {
                      <span
                        class="badge-compat-warn"
                        title="Este cargo no figura entre los cargos permitidos del servicio base asignado">
                        ⚠️ Cargo fuera de permitidos
                      </span>
                    }
                  </div>
                </td>
                <td>
                  <select
                    class="table-inline-select"
                    [attr.aria-label]="'Servicio base de ' + emp.nombre"
                    [ngModel]="emp.servicioBaseId"
                    (ngModelChange)="cambiarServicioEmpleado(emp.id, $event)">
                    @for (srv of servicios; track srv.id) {
                      <option [value]="srv.id">{{ srv.codigo }} — {{ srv.nombre }}</option>
                    }
                  </select>
                </td>
                <td>
                  <select
                    class="table-inline-select"
                    [class.select-pendiente]="emp.empresaContratante?.estadoConfiguracion === 'PENDIENTE_REGLAS'"
                    [attr.aria-label]="'Empresa contratante de ' + emp.nombre"
                    [ngModel]="emp.empresaContratanteId || ''"
                    (ngModelChange)="cambiarEmpresaEmpleado(emp.id, $event)">
                    @if (!emp.empresaContratanteId) {
                      <option value="">-- Sin empresa --</option>
                    }
                    @for (ec of empresas; track ec.id) {
                      <option [value]="ec.id">
                        {{ ec.codigo }} — {{ ec.nombre }}{{ ec.estadoConfiguracion === 'PENDIENTE_REGLAS' ? ' (Pend.)' : '' }}
                      </option>
                    }
                  </select>
                </td>
                <td>
                  @if (editandoJornadaEmpId === emp.id) {
                    <div class="jornada-editor-inline">
                      <input
                        type="number"
                        min="1"
                        max="72"
                        step="1"
                        class="jornada-input-sm"
                        [attr.aria-label]="'Horas semanales para ' + emp.nombre"
                        [(ngModel)]="horasOverrideDraft"
                      />
                      <button
                        type="button"
                        class="btn-xs-ok"
                        title="Guardar jornada individual"
                        (click)="guardarJornadaOverride(emp.id)">
                        ✓
                      </button>
                      <button
                        type="button"
                        class="btn-xs-reset"
                        title="Restaurar jornada de la empresa contratante"
                        (click)="restaurarJornadaEmpresa(emp.id)">
                        ↺
                      </button>
                      <button
                        type="button"
                        class="btn-xs-cancel"
                        title="Cancelar edición"
                        (click)="cancelarEdicionJornada()">
                        ✕
                      </button>
                    </div>
                  } @else {
                    <div class="jornada-view-inline">
                      <span
                        class="badge-jornada"
                        [class.is-override]="tieneOverride"
                        [title]="tieneOverride ? 'Jornada especial individual aplicada' : 'Heredada del régimen de la empresa contratante'">
                        {{ emp.horasSemanalesAplicadas ?? emp.horasSemanalesLey ?? 42 }}h/sem
                        @if (tieneOverride) {
                          <small>(Esp.)</small>
                        }
                      </span>
                      <button
                        type="button"
                        class="btn-edit-inline"
                        title="Configurar jornada especial semanal o restaurar a empresa"
                        (click)="iniciarEdicionJornada(emp)">
                        ✏️
                      </button>
                    </div>
                  }
                </td>
                <td>
                  @let metaEfectiva = emp.horasContratadasEfectivas ?? emp.horasContratoMes;
                  @let exoneradas = emp.horasExoneradasMes || 0;
                  @let saldoBancoAct = emp.saldoBancoActual ?? saldoBanco;
                  @let difMes = emp.saldoBancoDiferenciaMes ?? 0;
                  <div class="personal-metrics-cell">
                    <span class="badge-meta-mes" title="Meta nominal de días hábiles del periodo">
                      ⏱️ Nominal: {{ emp.horasContratoMes }}h
                    </span>
                    <span
                      class="badge-meta-efectiva"
                      [class.has-prorrateo]="exoneradas > 0"
                      [title]="exoneradas > 0 ? ('Meta efectiva prorrateada (' + (emp.diasProrrateadosMes || 0) + ' día(s) hábil(es) exonerado(s), -' + exoneradas + 'h)') : 'Meta efectiva vigente del mes activo'">
                      🎯 Efectiva: {{ metaEfectiva }}h
                      @if (exoneradas > 0) {
                        <small>(-{{ exoneradas }}h)</small>
                      }
                    </span>
                    <div class="banco-badges-row">
                      <span
                        class="badge-banco-mes"
                        [class.is-neg]="saldoBanco < 0"
                        [class.is-pos]="saldoBanco > 0"
                        title="Saldo consolidado acumulado con el que inicia el periodo">
                        🏦 Ant: {{ saldoBanco > 0 ? '+' : '' }}{{ saldoBanco }}h
                      </span>
                      <span
                        class="badge-banco-mes"
                        [class.is-neg]="saldoBancoAct < 0"
                        [class.is-pos]="saldoBancoAct > 0"
                        [class.is-draft-empty]="!emp.tieneActividadMes && !emp.cuadranteMesConsolidado"
                        [title]="
                          (emp.cuadranteMesConsolidado
                            ? 'Saldo de cierre consolidado del periodo'
                            : emp.tieneActividadMes
                              ? 'Saldo proyectado del mes en curso según turnos asignados'
                              : 'Sin turnos asignados aún en el periodo (mantiene saldo anterior)') +
                          ' (Variación del mes: ' + (difMes > 0 ? '+' : '') + difMes + 'h)'
                        ">
                        📊 {{ emp.cuadranteMesConsolidado ? 'Cierre' : 'Proy' }}: {{ saldoBancoAct > 0 ? '+' : '' }}{{ saldoBancoAct }}h
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="personal-actions-cell">
                    <button
                      type="button"
                      class="btn-outline btn-xs"
                      title="Abrir Cuadro de Turnos de su servicio base"
                      (click)="abrirCuadroServicio.emit(emp.servicioBaseId)">
                      📅 Cuadro
                    </button>
                    <button
                      type="button"
                      class="btn-outline btn-xs"
                      title="Inspeccionar calendario individual del colaborador"
                      (click)="abrirCalendarioColaborador.emit(emp.id)">
                      👩‍⚕️ Calendario
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" class="personal-empty-row">
                  No se encontraron colaboradores con los filtros seleccionados.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
})
export class GestionPersonalComponent {
  @Input() empleados: EmpleadoHospital[] = [];
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() empresas: EmpresaContratante[] = [];
  @Input() categoriasProfesionales: CategoriaProfesionalItem[] = [];
  @Input() nombreMes = '';
  @Input() anioSeleccionado = 0;
  @Input() sincronizandoNominaIntranet = false;

  @Output() sincronizarNominaIntranet = new EventEmitter<void>();
  @Output() adscribirEmpleadoAServicio = new EventEmitter<{
    empleadoId: string;
    servicioBaseId: string;
  }>();
  @Output() adscribirLoteAServicio = new EventEmitter<{
    empleadoIds: string[];
    servicioBaseId: string;
  }>();
  @Output() actualizarCondicionesEmpleado = new EventEmitter<{
    empleadoId: string;
    dto: {
      servicioBaseId?: string;
      empresaContratanteId?: string;
      horasSemanalesOverride?: number | null;
    };
  }>();
  @Output() abrirCuadroServicio = new EventEmitter<string>();
  @Output() abrirCalendarioColaborador = new EventEmitter<string>();

  busquedaTexto = signal<string>('');
  filtroServicioId = signal<string>('TODOS');
  filtroCargo = signal<string>('TODOS');
  filtroEmpresaId = signal<string>('TODOS');
  soloConNovedadCondicion = signal<boolean>(false);

  seleccionadosIds = new Set<string>();
  destinoLoteServicioId = '';

  editandoJornadaEmpId: string | null = null;
  horasOverrideDraft = 42;

  get listaCargosOrdenados(): string[] {
    const set = new Set<string>();
    for (const e of this.empleados || []) {
      if (e.categoria) set.add(e.categoria);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  get totalCargosDistintos(): number {
    return this.listaCargosOrdenados.length;
  }

  get totalConJornadaEspecial(): number {
    return (this.empleados || []).filter(
      (e) => e.horasSemanalesOverride !== null && e.horasSemanalesOverride !== undefined
    ).length;
  }

  get totalAlertasCompatibilidad(): number {
    return (this.empleados || []).filter((e) => !this.esCargoCompatibleConServicio(e)).length;
  }

  get hayFiltrosActivos(): boolean {
    return (
      Boolean(this.busquedaTexto().trim()) ||
      this.filtroServicioId() !== 'TODOS' ||
      this.filtroCargo() !== 'TODOS' ||
      this.filtroEmpresaId() !== 'TODOS' ||
      this.soloConNovedadCondicion()
    );
  }

  get empleadosFiltrados(): EmpleadoHospital[] {
    const terminos = dividirTerminosBusqueda(this.busquedaTexto());
    const srvId = this.filtroServicioId();
    const cargo = this.filtroCargo();
    const empCorpId = this.filtroEmpresaId();
    const soloNovedad = this.soloConNovedadCondicion();

    return (this.empleados || [])
      .filter((e) => {
        if (srvId !== 'TODOS' && e.servicioBaseId !== srvId) return false;
        if (cargo !== 'TODOS' && e.categoria !== cargo) return false;
        if (empCorpId !== 'TODOS' && (e.empresaContratanteId || '') !== empCorpId) return false;
        if (soloNovedad) {
          const tieneOv = e.horasSemanalesOverride !== null && e.horasSemanalesOverride !== undefined;
          const esIncompat = !this.esCargoCompatibleConServicio(e);
          if (!tieneOv && !esIncompat) return false;
        }
        if (terminos.length > 0 && !coincideBusquedaCampos(terminos, [e.nombre, e.documento, e.categoria])) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  sonTodosVisiblesSeleccionados(lista: EmpleadoHospital[]): boolean {
    return lista.length > 0 && lista.every((e) => this.seleccionadosIds.has(e.id));
  }

  get todosVisiblesSeleccionados(): boolean {
    return this.sonTodosVisiblesSeleccionados(this.empleadosFiltrados);
  }

  limpiarFiltros(): void {
    this.busquedaTexto.set('');
    this.filtroServicioId.set('TODOS');
    this.filtroCargo.set('TODOS');
    this.filtroEmpresaId.set('TODOS');
    this.soloConNovedadCondicion.set(false);
  }

  esCargoCompatibleConServicio(emp: EmpleadoHospital): boolean {
    const srv = (this.servicios || []).find((s) => s.id === emp.servicioBaseId);
    if (!srv) return true;
    const permitidosIds = (
      srv.cargosPermitidosIds?.length
        ? srv.cargosPermitidosIds
        : (srv.cargosPermitidos || []).map((c) => c.categoriaId)
    ).filter(Boolean);
    if (permitidosIds.length === 0) return true;
    if (emp.categoriaId && permitidosIds.includes(emp.categoriaId)) return true;

    const nombresPermitidos = new Set(
      (srv.cargosPermitidos || []).map((c) => c.categoriaNombre.trim().toLowerCase())
    );
    return nombresPermitidos.has((emp.categoria || '').trim().toLowerCase());
  }

  alternarSeleccion(empId: string): void {
    if (this.seleccionadosIds.has(empId)) {
      this.seleccionadosIds.delete(empId);
    } else {
      this.seleccionadosIds.add(empId);
    }
  }

  alternarSeleccionTodosVisibles(): void {
    const lista = this.empleadosFiltrados;
    if (this.todosVisiblesSeleccionados) {
      lista.forEach((e) => this.seleccionadosIds.delete(e.id));
    } else {
      lista.forEach((e) => this.seleccionadosIds.add(e.id));
    }
  }

  ejecutarTrasladoLote(): void {
    const ids = Array.from(this.seleccionadosIds);
    if (!this.destinoLoteServicioId || ids.length === 0) return;
    this.adscribirLoteAServicio.emit({
      empleadoIds: ids,
      servicioBaseId: this.destinoLoteServicioId,
    });
    this.seleccionadosIds.clear();
    this.destinoLoteServicioId = '';
  }

  cambiarServicioEmpleado(empleadoId: string, servicioBaseId: string): void {
    if (!empleadoId || !servicioBaseId) return;
    this.adscribirEmpleadoAServicio.emit({ empleadoId, servicioBaseId });
  }

  cambiarEmpresaEmpleado(empleadoId: string, empresaContratanteId: string): void {
    if (!empleadoId || !empresaContratanteId) return;
    this.actualizarCondicionesEmpleado.emit({
      empleadoId,
      dto: { empresaContratanteId },
    });
  }

  iniciarEdicionJornada(emp: EmpleadoHospital): void {
    this.editandoJornadaEmpId = emp.id;
    this.horasOverrideDraft = Number(
      emp.horasSemanalesOverride ?? emp.horasSemanalesAplicadas ?? emp.horasSemanalesLey ?? 42
    );
  }

  cancelarEdicionJornada(): void {
    this.editandoJornadaEmpId = null;
  }

  guardarJornadaOverride(empleadoId: string): void {
    const horas = Number(this.horasOverrideDraft);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 72) return;
    this.actualizarCondicionesEmpleado.emit({
      empleadoId,
      dto: { horasSemanalesOverride: horas },
    });
    this.editandoJornadaEmpId = null;
  }

  restaurarJornadaEmpresa(empleadoId: string): void {
    this.actualizarCondicionesEmpleado.emit({
      empleadoId,
      dto: { horasSemanalesOverride: null },
    });
    this.editandoJornadaEmpId = null;
  }
}
