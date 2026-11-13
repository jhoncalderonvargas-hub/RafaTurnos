import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmpresaContratante, PlantillaEmpresaOption } from '../../models';
import {
  formatearPorcentaje,
  ModoRecargoDominicalEmpresa,
  PLANTILLA_CST_LEY_2466,
  PLANTILLA_DECRETO_1042,
  PLANTILLA_PERSONALIZADA_DEFAULT,
  PlantillaNormativaEmpresa,
  r2,
} from '../../shared/liquidacion-horas';

@Component({
  selector: 'app-configuracion-empresas',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './configuracion-empresas.component.css',
  template: `
    <div class="module-hero-card">
      <div class="module-hero-brand">
        <div class="module-hero-icon" aria-hidden="true">🏢</div>
        <div class="module-hero-titles">
          <div class="module-hero-title-row">
            <h2>Gestión de Empresas</h2>
            <span class="module-hero-badge">{{ empresas.length }} empresas</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Alerta de Empresas Pendientes por Confirmar Reglas -->
    @if (empresasPendientes.length > 0) {
      <div class="emp-pending-banner" role="alert">
        <div class="emp-pending-icon" aria-hidden="true">⚠️</div>
        <div class="emp-pending-body">
          <strong>
            {{ empresasPendientes.length }} empresa(s) contratante(s) con reglas normativas pendientes de confirmar:
          </strong>
          <p class="emp-pending-desc">
            Fueron registradas automáticamente al sincronizar colaboradores desde la Intranet. Verifica si pertenecen a Planta Pública (Decreto 1042) o régimen privado (CST / Ley 2466) y confirma sus reglas para habilitar el cierre de nómina (<code>CERRADO_NOMINA</code>).
          </p>
          <div class="emp-pending-chips">
            @for (ep of empresasPendientes; track ep.id) {
              <button
                type="button"
                class="btn-pending-chip"
                (click)="cargarEmpresaParaEdicion(ep)">
                ✏️ Configurar {{ ep.nombre }} ({{ ep.codigo }})
              </button>
            }
          </div>
        </div>
      </div>
    }

    <!-- Métricas Resumen de Empresas -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">{{ empresas.length }}</div>
        <div class="kpi-label">Empresas Contratantes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalConfirmadas }}</div>
        <div class="kpi-label">Regímenes Confirmados</div>
      </div>
      <div class="kpi-card" [class.alert-card-kpi]="empresasPendientes.length > 0">
        <div class="kpi-num">{{ empresasPendientes.length }}</div>
        <div class="kpi-label">Pendientes de Reglas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">{{ totalColaboradoresVinculados }}</div>
        <div class="kpi-label">Colaboradores Vinculados</div>
      </div>
    </div>

    <div class="empresas-grid">
      <!-- Formulario Creación / Edición de Empresa Contratante -->
      <div class="panel-card empresas-form-card" id="panel-edicion-empresa">
        <div class="panel-header">
          <h3>
            @if (empresaEditandoId) {
              ✏️ Editando Empresa: {{ nombre || codigo }}
            } @else {
              🏢 Registrar Empresa Contratante
            }
          </h3>
          @if (empresaEditandoId) {
            <button type="button" class="btn-outline btn-sm-cancel" (click)="limpiarFormulario()">
              Cancelar
            </button>
          }
        </div>

        <div class="form-vertical">
          <!-- Plantillas rápidas normativas -->
          <div class="form-row">
            <label>Plantilla Normativa Rápida (Régimen Laboral):</label>
            <div class="plantillas-grid">
              <button
                type="button"
                class="plantilla-btn"
                [class.active]="plantillaNormativa === 'DECRETO_1042'"
                (click)="aplicarPlantilla('DECRETO_1042')">
                <strong>🏛️ Decreto 1042</strong>
                <small>44h/sem · 18:00–06:00 · Dom 100%</small>
              </button>
              <button
                type="button"
                class="plantilla-btn"
                [class.active]="plantillaNormativa === 'CST_LEY_2466'"
                (click)="aplicarPlantilla('CST_LEY_2466')">
                <strong>🏢 CST + Ley 2466</strong>
                <small>42h/sem · 19:00–06:00 · Dom Gradual</small>
              </button>
              <button
                type="button"
                class="plantilla-btn"
                [class.active]="plantillaNormativa === 'PERSONALIZADA'"
                (click)="aplicarPlantilla('PERSONALIZADA')">
                <strong>⚙️ Personalizada</strong>
                <small>Agremiación / Reglas libres</small>
              </button>
            </div>
          </div>

          <div class="two-col-inputs">
            <div class="form-row">
              <label for="emp-codigo">Código Único Intranet:</label>
              <input
                id="emp-codigo"
                type="text"
                placeholder="Ej: ESE_PLANTA"
                maxlength="40"
                [(ngModel)]="codigo"
              />
            </div>
            <div class="form-row">
              <label for="emp-nit">NIT (opcional):</label>
              <input
                id="emp-nit"
                type="text"
                placeholder="Ej: 890980123-1"
                maxlength="30"
                [(ngModel)]="nit"
              />
            </div>
          </div>

          <div class="form-row">
            <label for="emp-nombre">Razón Social / Nombre Completo:</label>
            <input
              id="emp-nombre"
              type="text"
              placeholder="Ej: ESE Hospital San Rafael de Yolombó (Planta)"
              maxlength="120"
              [(ngModel)]="nombre"
            />
          </div>

          <div class="form-row">
            <label for="emp-aliases">Aliases de Código en Intranet (separados por coma):</label>
            <input
              id="emp-aliases"
              type="text"
              placeholder="Ej: PLANTA, ESE_Yolombo, 890980123"
              [(ngModel)]="aliasesText"
            />
          </div>

          <div class="two-col-equal">
            <div class="form-row">
              <label for="emp-horas-sem">Jornada Semanal Contrato (h):</label>
              <input
                id="emp-horas-sem"
                type="number"
                min="1"
                max="72"
                step="0.5"
                [(ngModel)]="horasSemanalesContrato"
              />
            </div>
            <div class="form-row">
              <label for="emp-dias-base">Días Base Semana (1–7):</label>
              <input
                id="emp-dias-base"
                type="number"
                min="1"
                max="7"
                step="1"
                [(ngModel)]="diasBaseSemana"
              />
            </div>
          </div>

          <div class="dia-habil-preview">
            📐 Equivalente por <strong>Día Hábil</strong>:
            <code>{{ valorDiaHabil }} h/día</code>
            <span class="dia-habil-formula">
              ({{ horasSemanalesContrato || 42 }}h ÷ {{ diasBaseSemana || 6 }}d • Lun–Sáb no festivo)
            </span>
          </div>

          <div class="two-col-equal">
            <div class="form-row">
              <label for="emp-noc-ini">Inicio Nocturno (12:00–23:59):</label>
              <input
                id="emp-noc-ini"
                type="time"
                min="12:00"
                max="23:59"
                [(ngModel)]="horaInicioNocturnoStr"
              />
            </div>
            <div class="form-row">
              <label for="emp-noc-fin">Fin Nocturno (00:00–12:00):</label>
              <input
                id="emp-noc-fin"
                type="time"
                min="00:00"
                max="12:00"
                [(ngModel)]="horaFinNocturnoStr"
              />
            </div>
          </div>

          <div class="two-col-equal">
            <div class="form-row">
              <label for="emp-rec-noc">Recargo Nocturno (%):</label>
              <input
                id="emp-rec-noc"
                type="number"
                min="0"
                max="300"
                step="5"
                [(ngModel)]="porcentajeRecargoNocturnoPct"
              />
            </div>
            <div class="form-row">
              <label for="emp-modo-dom">Modo Recargo Dominical / Festivo:</label>
              <select id="emp-modo-dom" [(ngModel)]="modoRecargoDominical">
                <option value="LEY_2466">Gradual Ley 2466 (90% → 100%)</option>
                <option value="FIJO">Porcentaje Fijo (ej. 100% Dec. 1042)</option>
              </select>
            </div>
          </div>

          @if (modoRecargoDominical === 'FIJO') {
            <div class="form-row dom-fijo-box">
              <label for="emp-rec-dom-fijo">Recargo Dominical / Festivo Fijo (%):</label>
              <input
                id="emp-rec-dom-fijo"
                type="number"
                min="0"
                max="300"
                step="5"
                [(ngModel)]="porcentajeRecargoDominicalFijoPct"
              />
            </div>
          }

          <div class="form-checks">
            <label class="check-row">
              <input type="checkbox" [(ngModel)]="aplicaTopeHorasExtrasSemanal" />
              <span>⚖️ Aplica tope máximo semanal de horas extras</span>
            </label>

            @if (aplicaTopeHorasExtrasSemanal) {
              <div class="form-row tope-box">
                <label for="emp-tope-extras">Tope Máx. Extras Semanal (h, default 12h):</label>
                <input
                  id="emp-tope-extras"
                  type="number"
                  min="0"
                  max="48"
                  step="1"
                  [(ngModel)]="topeHorasExtrasSemanal"
                />
              </div>
            }

            <label class="check-row">
              <input type="checkbox" [(ngModel)]="usaBancoHoras" />
              <span>🏦 Acumula y amortiza en Banco de Horas continuo</span>
            </label>

            <label class="check-row">
              <input type="checkbox" [(ngModel)]="activa" />
              <span>🟢 Empresa contratante activa</span>
            </label>
          </div>

          <div class="form-row">
            <label for="emp-obs">Observaciones / Acto Administrativo (opcional):</label>
            <input
              id="emp-obs"
              type="text"
              placeholder="Ej: Convención sindical o resolución vigente"
              maxlength="240"
              [(ngModel)]="observaciones"
            />
          </div>

          @if (errorValidacion) {
            <div class="emp-form-error" role="alert">⛔ {{ errorValidacion }}</div>
          }

          <div class="form-actions emp-form-actions">
            @if (empresaEditandoId) {
              <button type="button" class="btn-outline" (click)="guardarFormulario(false)">
                💾 Guardar Cambios
              </button>
              <button type="button" class="btn-primary" (click)="guardarFormulario(true)">
                ✅ Guardar y Confirmar Reglas
              </button>
            } @else {
              <button type="button" class="btn-primary" (click)="guardarFormulario(true)">
                💾 Crear Empresa y Confirmar Reglas
              </button>
            }
          </div>
        </div>
      </div>

      <!-- Tabla de Empresas Contratantes -->
      <div class="panel-card empresas-table-card">
        <div class="panel-header">
          <h3>🏛️ Empresas y Regímenes Vigentes</h3>
          <span class="badge-count">{{ empresas.length }} Empresas</span>
        </div>

        <div class="table-responsive">
          <table class="data-table empresas-table">
            <thead>
              <tr>
                <th>Empresa / Códigos Intranet</th>
                <th>Estado</th>
                <th>Jornada y Día Hábil</th>
                <th>Franja y Recargos</th>
                <th>Tope / Banco</th>
                <th>Personal</th>
                <th>Gestión</th>
              </tr>
            </thead>
            <tbody>
              @for (e of empresas; track e.id) {
                <tr [class.row-pending]="e.estadoConfiguracion === 'PENDIENTE_REGLAS'">
                  <td>
                    <div class="emp-cell-main">
                      <strong>{{ e.nombre }}</strong>
                      <div class="emp-meta-tags">
                        <span class="badge-custom-code font-mono">{{ e.codigo }}</span>
                        @if (e.nit) {
                          <span class="emp-nit-text font-mono">NIT: {{ e.nit }}</span>
                        }
                        @if (e.aliasesCodigo && e.aliasesCodigo.length > 0) {
                          <span class="emp-alias-text" title="Aliases mapeados desde Intranet">
                            Aliases: {{ e.aliasesCodigo.join(', ') }}
                          </span>
                        }
                      </div>
                    </div>
                  </td>
                  <td>
                    @if (e.estadoConfiguracion === 'PENDIENTE_REGLAS') {
                      <span class="badge-estado-pendiente" title="Debe confirmarse antes de cerrar nómina">
                        ⚠️ PENDIENTE
                      </span>
                    } @else {
                      <span class="badge-estado-confirmada">✅ CONFIRMADA</span>
                    }
                    <div class="plantilla-mini-tag">{{ etiquetaPlantilla(e.plantillaNormativa) }}</div>
                  </td>
                  <td class="font-mono">
                    <strong>{{ e.horasSemanalesContrato }}h/sem</strong>
                    <div class="emp-sub-num">
                      {{ r2Local(e.horasSemanalesContrato / (e.diasBaseSemana || 6)) }}h / día hábil ({{ e.diasBaseSemana || 6 }}d)
                    </div>
                  </td>
                  <td class="font-mono">
                    <div>
                      🌙 {{ minutosAHoraStr(e.horaInicioNocturnoMin, '19:00') }}–{{ minutosAHoraStr(e.horaFinNocturnoMin, '06:00') }}
                      ({{ pct(e.porcentajeRecargoNocturno) }})
                    </div>
                    <div class="emp-sub-num">
                      ☀️ Dom/Fest:
                      @if (e.modoRecargoDominical === 'FIJO') {
                        <strong>{{ pct(e.porcentajeRecargoDominicalFijo ?? 1) }} Fijo</strong>
                      } @else {
                        <span>Gradual Ley 2466</span>
                      }
                    </div>
                  </td>
                  <td>
                    <div class="emp-rules-tags">
                      <span class="rule-mini-tag">
                        {{ e.aplicaTopeHorasExtrasSemanal ? 'Tope +' + e.topeHorasExtrasSemanal + 'h ext' : 'Sin tope extras' }}
                      </span>
                      <span class="rule-mini-tag" [class.rule-off]="!e.usaBancoHoras">
                        {{ e.usaBancoHoras ? '🏦 Banco Activo' : 'Sin Banco' }}
                      </span>
                    </div>
                  </td>
                  <td class="font-mono">
                    <span class="badge-personal">{{ e.empleadosCount || 0 }} colab.</span>
                  </td>
                  <td>
                    <div class="gestion-cluster">
                      @if (e.estadoConfiguracion === 'PENDIENTE_REGLAS') {
                        <button
                          type="button"
                          class="btn-confirmar-inline"
                          (click)="confirmarRapido(e)"
                          title="Confirmar las reglas vigentes de esta empresa y habilitar cierre de nómina">
                          ✅ Confirmar
                        </button>
                      }
                      <button
                        type="button"
                        class="btn-sm-primary"
                        (click)="cargarEmpresaParaEdicion(e)"
                        title="Editar parámetros normativos">
                        ✏️ Editar
                      </button>
                      <button
                        type="button"
                        class="btn-action-icon btn-action-danger"
                        [disabled]="(e.empleadosCount || 0) > 0"
                        (click)="eliminarEmpresa.emit(e)"
                        [title]="(e.empleadosCount || 0) > 0 ? 'Tiene ' + e.empleadosCount + ' colaborador(es) vinculados' : 'Eliminar empresa contratante'">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="text-muted empty-state-box">
                    No hay empresas contratantes registradas aún.
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
export class ConfiguracionEmpresasComponent {
  @Input() empresas: EmpresaContratante[] = [];
  @Input() plantillasEmpresa: PlantillaEmpresaOption[] = [];

  @Output() crearEmpresa = new EventEmitter<Partial<EmpresaContratante> & { confirmar?: boolean }>();
  @Output() actualizarEmpresa = new EventEmitter<{
    id: string;
    dto: Partial<EmpresaContratante> & { confirmar?: boolean };
  }>();
  @Output() confirmarReglasEmpresa = new EventEmitter<{
    id: string;
    dto?: Partial<EmpresaContratante>;
  }>();
  @Output() eliminarEmpresa = new EventEmitter<EmpresaContratante>();

  empresaEditandoId: string | null = null;
  codigo = '';
  nombre = '';
  nit = '';
  aliasesText = '';
  plantillaNormativa: PlantillaNormativaEmpresa = 'CST_LEY_2466';
  horasSemanalesContrato = 42;
  diasBaseSemana = 6;
  horaInicioNocturnoStr = '19:00';
  horaFinNocturnoStr = '06:00';
  porcentajeRecargoNocturnoPct = 35;
  modoRecargoDominical: ModoRecargoDominicalEmpresa = 'LEY_2466';
  porcentajeRecargoDominicalFijoPct = 100;
  aplicaTopeHorasExtrasSemanal = true;
  topeHorasExtrasSemanal = 12;
  usaBancoHoras = true;
  activa = true;
  observaciones = '';
  errorValidacion = '';

  get empresasPendientes(): EmpresaContratante[] {
    return (this.empresas || []).filter((e) => e.estadoConfiguracion === 'PENDIENTE_REGLAS');
  }

  get totalConfirmadas(): number {
    return (this.empresas || []).filter((e) => e.estadoConfiguracion !== 'PENDIENTE_REGLAS').length;
  }

  get totalColaboradoresVinculados(): number {
    return (this.empresas || []).reduce((acc, e) => acc + (Number(e.empleadosCount) || 0), 0);
  }

  get valorDiaHabil(): number {
    const h = Number(this.horasSemanalesContrato) || 0;
    const d = Math.max(1, Math.round(Number(this.diasBaseSemana) || 6));
    return r2(h / d);
  }

  r2Local(val: number): number {
    return r2(val);
  }

  pct(fraccion?: number | null): string {
    return formatearPorcentaje(Number(fraccion) || 0);
  }

  etiquetaPlantilla(plantilla?: string): string {
    if (plantilla === 'DECRETO_1042') return 'Decreto 1042';
    if (plantilla === 'PERSONALIZADA') return 'Personalizada';
    return 'CST / Ley 2466';
  }

  minutosAHoraStr(minutos?: number | null, fallback = '19:00'): string {
    if (minutos === undefined || minutos === null || !Number.isFinite(Number(minutos))) {
      return fallback;
    }
    const minVal = Math.max(0, Math.min(1440, Math.round(Number(minutos))));
    if (minVal === 1440) return '23:59';
    const hh = String(Math.floor(minVal / 60)).padStart(2, '0');
    const mm = String(minVal % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  private horaStrAMinutos(hhmm: string, minPermitido: number, maxPermitido: number, fallback: number): number {
    const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return fallback;
    let total = Number(m[1]) * 60 + Number(m[2]);
    if (minPermitido === 720 && total === 0) {
      total = 1440;
    }
    if (!Number.isFinite(total)) return fallback;
    return Math.max(minPermitido, Math.min(maxPermitido, total));
  }

  aplicarPlantilla(codigoPlantilla: PlantillaNormativaEmpresa): void {
    const desdeApi = (this.plantillasEmpresa || []).find(
      (p) => p.codigo.toUpperCase() === codigoPlantilla
    )?.parametros;
    const base =
      desdeApi ||
      (codigoPlantilla === 'DECRETO_1042'
        ? PLANTILLA_DECRETO_1042
        : codigoPlantilla === 'PERSONALIZADA'
          ? PLANTILLA_PERSONALIZADA_DEFAULT
          : PLANTILLA_CST_LEY_2466);

    this.plantillaNormativa = codigoPlantilla;
    this.horasSemanalesContrato = Number(base.horasSemanalesContrato) || 42;
    this.diasBaseSemana = Number(base.diasBaseSemana) || 6;
    this.horaInicioNocturnoStr = this.minutosAHoraStr(base.horaInicioNocturnoMin, '19:00');
    this.horaFinNocturnoStr = this.minutosAHoraStr(base.horaFinNocturnoMin, '06:00');
    this.porcentajeRecargoNocturnoPct = Math.round((Number(base.porcentajeRecargoNocturno) || 0.35) * 100);
    this.modoRecargoDominical =
      base.modoRecargoDominical === 'FIJO' ? 'FIJO' : 'LEY_2466';
    this.porcentajeRecargoDominicalFijoPct = Math.round(
      (Number(base.porcentajeRecargoDominicalFijo ?? 1.0)) * 100
    );
    this.aplicaTopeHorasExtrasSemanal = base.aplicaTopeHorasExtrasSemanal !== false;
    this.topeHorasExtrasSemanal = Number(base.topeHorasExtrasSemanal ?? 12);
    this.usaBancoHoras = base.usaBancoHoras !== false;
    this.errorValidacion = '';
  }

  cargarEmpresaParaEdicion(e: EmpresaContratante): void {
    this.empresaEditandoId = e.id;
    this.codigo = e.codigo || '';
    this.nombre = e.nombre || '';
    this.nit = e.nit || '';
    this.aliasesText = (e.aliasesCodigo || []).join(', ');
    this.plantillaNormativa =
      e.plantillaNormativa === 'DECRETO_1042' || e.plantillaNormativa === 'PERSONALIZADA'
        ? e.plantillaNormativa
        : 'CST_LEY_2466';
    this.horasSemanalesContrato = Number(e.horasSemanalesContrato) || 42;
    this.diasBaseSemana = Number(e.diasBaseSemana) || 6;
    this.horaInicioNocturnoStr = this.minutosAHoraStr(e.horaInicioNocturnoMin, '19:00');
    this.horaFinNocturnoStr = this.minutosAHoraStr(e.horaFinNocturnoMin, '06:00');
    this.porcentajeRecargoNocturnoPct = Math.round((Number(e.porcentajeRecargoNocturno) || 0.35) * 100);
    this.modoRecargoDominical = e.modoRecargoDominical === 'FIJO' ? 'FIJO' : 'LEY_2466';
    this.porcentajeRecargoDominicalFijoPct = Math.round(
      (Number(e.porcentajeRecargoDominicalFijo ?? 1.0)) * 100
    );
    this.aplicaTopeHorasExtrasSemanal = e.aplicaTopeHorasExtrasSemanal !== false;
    this.topeHorasExtrasSemanal = Number(e.topeHorasExtrasSemanal ?? 12);
    this.usaBancoHoras = e.usaBancoHoras !== false;
    this.activa = e.activa !== false;
    this.observaciones = e.observaciones || '';
    this.errorValidacion = '';

    setTimeout(() => {
      const panel = document.getElementById('panel-edicion-empresa');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 30);
  }

  limpiarFormulario(): void {
    this.empresaEditandoId = null;
    this.codigo = '';
    this.nombre = '';
    this.nit = '';
    this.aliasesText = '';
    this.observaciones = '';
    this.activa = true;
    this.aplicarPlantilla('CST_LEY_2466');
  }

  private construirDto(confirmar?: boolean): Partial<EmpresaContratante> & { confirmar?: boolean } {
    const aliasesCodigo = this.aliasesText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const modoDom = this.modoRecargoDominical === 'FIJO' ? 'FIJO' : 'LEY_2466';
    return {
      codigo: this.codigo.trim().toUpperCase(),
      nombre: this.nombre.trim(),
      nit: this.nit.trim() || null,
      aliasesCodigo: Array.from(new Set(aliasesCodigo)),
      plantillaNormativa: this.plantillaNormativa,
      horasSemanalesContrato: Number(this.horasSemanalesContrato) || 42,
      diasBaseSemana: Math.max(1, Math.min(7, Math.round(Number(this.diasBaseSemana) || 6))),
      horaInicioNocturnoMin: this.horaStrAMinutos(this.horaInicioNocturnoStr, 720, 1440, 1140),
      horaFinNocturnoMin: this.horaStrAMinutos(this.horaFinNocturnoStr, 0, 720, 360),
      porcentajeRecargoNocturno: Math.max(0, Math.min(3, (Number(this.porcentajeRecargoNocturnoPct) || 0) / 100)),
      modoRecargoDominical: modoDom,
      porcentajeRecargoDominicalFijo:
        modoDom === 'FIJO'
          ? Math.max(0, Math.min(3, (Number(this.porcentajeRecargoDominicalFijoPct) || 0) / 100))
          : null,
      aplicaTopeHorasExtrasSemanal: Boolean(this.aplicaTopeHorasExtrasSemanal),
      topeHorasExtrasSemanal: Math.max(0, Math.min(48, Number(this.topeHorasExtrasSemanal) || 0)),
      usaBancoHoras: Boolean(this.usaBancoHoras),
      activa: Boolean(this.activa),
      observaciones: this.observaciones.trim() || null,
      ...(confirmar ? { confirmar: true, estadoConfiguracion: 'CONFIRMADA' } : {}),
    };
  }

  guardarFormulario(confirmar: boolean): void {
    const cod = this.codigo.trim();
    const nom = this.nombre.trim();
    if (!cod || !nom) {
      this.errorValidacion = 'El código único y el nombre de la empresa son obligatorios.';
      return;
    }
    const hSem = Number(this.horasSemanalesContrato);
    if (!Number.isFinite(hSem) || hSem <= 0 || hSem > 72) {
      this.errorValidacion = 'La jornada semanal debe ser mayor a 0h y hasta 72h.';
      return;
    }
    this.errorValidacion = '';

    const dto = this.construirDto(confirmar);
    if (this.empresaEditandoId) {
      this.actualizarEmpresa.emit({ id: this.empresaEditandoId, dto });
      this.limpiarFormulario();
    } else {
      this.crearEmpresa.emit(dto);
      this.limpiarFormulario();
    }
  }

  confirmarRapido(e: EmpresaContratante): void {
    this.confirmarReglasEmpresa.emit({ id: e.id });
  }
}
