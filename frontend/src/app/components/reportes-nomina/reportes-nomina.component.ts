import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatearPorcentaje, hoyColombiaIso, r2, resumenNormativoPeriodo } from '../../shared/liquidacion-horas';
import { EmpresaContratante, ServicioHospitalario } from '../../models';

export interface KpisReportes {
  totalEmpleados: number;
  totalHoras: number;
  totalNoches: number;
  totalDomFest: number;
  totalCompensatorios: number;
  criticosBanco: number;
  totalAusentismoDias: number;
}

export type SubVistaReportes = 'PRE_NOMINA' | 'EQUIDAD' | 'BANCO_HORAS' | 'AUSENTISMO';

@Component({
  selector: 'app-reportes-nomina',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './reportes-nomina.component.css',
  template: `
    <div class="view-container">
      <!-- Barra Superior de Filtros y Acciones -->
      <div class="reportes-header-bar">
        <div class="reportes-title-block">
          <h2>📊 Reportes y Analítica</h2>
          <span class="reportes-period-tag">Periodo: {{ nombreMesSeleccionado }} {{ anioSeleccionado }}</span>
          <span
            class="badge-law report-norm-badge"
            [title]="tooltipRegimenes">
            ⚖️ {{ resumenRegimenes }}
          </span>
          @if (tieneEmpresasPendientesEnReporte) {
            <span class="badge-custom report-norm-badge" title="Al menos una empresa contratante fue auto-registrada desde Intranet y tiene reglas contractuales pendientes por confirmar en Configuración.">
              ⚠️ Reglas de empresa pendientes por confirmar
            </span>
          }
          @if (normativa.franjaCambiaEnElMes || normativa.recargoDominicalCambiaEnElMes || normativa.jornadaSemanalCambiaEnElMes) {
            <span class="badge-custom report-norm-badge">
              ⚠️ Transición normativa en este mes (se liquida por fecha real de cada tramo)
            </span>
          }
        </div>

        <div class="reportes-controls-row">
          <div class="control-item">
            <label for="rep-mes-select">Periodo:</label>
            <div class="month-stepper month-stepper-toolbar">
              <button
                type="button"
                class="btn-nav-month"
                aria-label="Ir al mes anterior"
                (click)="navegarMes.emit(-1)"
                title="Ir al mes anterior">
                ◀
              </button>
              <select
                id="rep-mes-select"
                class="select-context select-mes"
                aria-label="Mes del reporte"
                [ngModel]="mesSeleccionado"
                (ngModelChange)="cambiarMes.emit(+$event)">
                @for (m of mesesDisponibles; track m.valor) {
                  <option [value]="m.valor">{{ m.nombre }}</option>
                }
              </select>
              <select
                id="rep-anio-select"
                class="select-context select-year"
                aria-label="Año del reporte"
                [ngModel]="anioSeleccionado"
                (ngModelChange)="cambiarAnio.emit(+$event)">
                @for (a of aniosDisponibles; track a) {
                  <option [value]="a">{{ a }}</option>
                }
              </select>
              <button
                type="button"
                class="btn-nav-month"
                aria-label="Ir al mes siguiente"
                (click)="navegarMes.emit(1)"
                title="Ir al mes siguiente">
                ▶
              </button>
              <button
                type="button"
                class="btn-hoy-period"
                [class.is-current]="esPeriodoActual"
                [disabled]="esPeriodoActual"
                (click)="irAMesActual.emit()"
                [title]="esPeriodoActual ? 'Ya estás en el mes actual' : 'Volver al mes actual'">
                {{ esPeriodoActual ? '● Hoy' : 'Hoy' }}
              </button>
            </div>
          </div>

          <div class="control-item">
            <label for="rep-servicio-select">Servicio:</label>
            <select
              id="rep-servicio-select"
              [ngModel]="filtroReporteServicioId"
              (ngModelChange)="cambiarFiltroServicio.emit($event)">
              @if (servicios.length > 1) {
                <option value="TODOS">🏥 Todos los Servicios Autorizados</option>
              }
              @for (s of servicios; track s.id) {
                <option [value]="s.id">{{ s.nombre }} ({{ s.codigo }})</option>
              }
            </select>
          </div>

          @if (empresas.length > 0) {
            <div class="control-item">
              <label for="rep-empresa-select">Empresa:</label>
              <select
                id="rep-empresa-select"
                [ngModel]="filtroReporteEmpresaId"
                (ngModelChange)="cambiarFiltroEmpresa.emit($event)">
                @if (empresas.length > 1) {
                  <option value="TODOS">🏢 Todas las Empresas ({{ empresas.length }})</option>
                }
                @for (emp of empresas; track emp.id) {
                  <option [value]="emp.id">
                    {{ emp.codigo }} · {{ emp.nombre }} ({{ emp.horasSemanalesContrato }}h){{ emp.estadoConfiguracion === 'PENDIENTE_REGLAS' ? ' ⚠️' : '' }}
                  </option>
                }
              </select>
            </div>
          }

          <div class="control-item">
            <label for="rep-busqueda-input">Buscar:</label>
            <input
              id="rep-busqueda-input"
              type="text"
              placeholder="Nombre, cédula, cargo o empresa..."
              [ngModel]="busquedaReporteTexto"
              (ngModelChange)="cambiarBusquedaTexto.emit($event)"
              class="report-search-input"
            />
          </div>

          <button type="button" class="btn-excel" (click)="exportarExcel.emit()">
            📥 Exportar Excel (CSV)
          </button>
        </div>
      </div>

      <!-- Sub-pestañas de los 4 Reportes Clave -->
      <div class="config-subtabs report-subtabs">
        <button
          type="button"
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'PRE_NOMINA'"
          (click)="cambiarSubVista.emit('PRE_NOMINA')">
          📥 Pre-Nómina Global
        </button>
        <button
          type="button"
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'EQUIDAD'"
          (click)="cambiarSubVista.emit('EQUIDAD')">
          ⚖️ Equidad y Fatiga
        </button>
        <button
          type="button"
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'BANCO_HORAS'"
          (click)="cambiarSubVista.emit('BANCO_HORAS')">
          🏦 Banco de Horas
        </button>
        <button
          type="button"
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'AUSENTISMO'"
          (click)="cambiarSubVista.emit('AUSENTISMO')">
          🩺 Ausentismo y Novedades
        </button>
      </div>

      <!-- Métricas Resumen (KPIs Dinámicos) -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-num">{{ kpi.totalEmpleados }}</div>
          <div class="kpi-label">Colaboradores en Reporte</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">{{ kpi.totalHoras }}h</div>
          <div class="kpi-label">Horas Totales Programadas</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">🌙 {{ kpi.totalNoches }} / ☀️ {{ kpi.totalDomFest }}</div>
          <div class="kpi-label">Noches y Dom-Festivos</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">🏅 {{ kpi.totalCompensatorios }}</div>
          <div class="kpi-label">Compensatorios Legales CST</div>
        </div>
        <div class="kpi-card" [class.alert-card-kpi]="kpi.criticosBanco > 0">
          <div class="kpi-num">{{ kpi.criticosBanco }} / {{ kpi.totalAusentismoDias }}d</div>
          <div class="kpi-label">Bancos Críticos / Ausencias</div>
        </div>
      </div>

      <!-- TABLA 1: PRE-NÓMINA GLOBAL -->
      @if (subVistaReportes === 'PRE_NOMINA') {
        <div class="panel-card">
          <div class="panel-header">
            <h3>📥 Consolidado de Pre-Nómina y Recargos Legales</h3>
            <span class="badge-count">{{ filas.length }} Colaboradores</span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Colaborador</th>
                  <th>Empresa</th>
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th title="Meta contractual del mes calculada por días hábiles (!Dom && !Fest) × horas semanales empresa / 6">Meta Mes (D.H.)</th>
                  <th title="Horas Ordinarias Diurnas en días hábiles (según franja nocturna vigente de la empresa)">HOD</th>
                  <th title="Horas Ordinarias Nocturnas en días hábiles (según empresa)">HON {{ etiquetaRecargoColumna('nocturno') }}</th>
                  <th title="Horas Dominicales/Festivas Diurnas (según recargo de cada empresa)">HDFD {{ etiquetaRecargoColumna('dominical') }}</th>
                  <th title="Horas Dominicales/Festivas Nocturnas (según recargo dominical + nocturno de cada empresa)">HDFN {{ etiquetaRecargoColumna('nocturnoDominical') }}</th>
                  <th>Total Mes</th>
                  <th>Dom (D+F) / Comp</th>
                  <th>VAC / INC / LIC / FAM</th>
                  <th>Saldo Ant.</th>
                  <th>Mov. Mes</th>
                  <th>Nuevo Banco</th>
                </tr>
              </thead>
              <tbody>
                @for (r of filas; track r.emp.id) {
                  <tr>
                    <td class="font-mono">{{ r.emp.documento }}</td>
                    <td><strong>{{ r.emp.nombre }}</strong></td>
                    <td>
                      <span
                        class="rep-empresa-chip"
                        [class.is-pendiente]="r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                        [title]="(r.empresaNombre || 'Empresa') + ' · ' + (r.horasSemanalesAplicadas ?? 42) + 'h/sem' + (r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS' ? ' (Reglas pendientes)' : '')">
                        {{ r.empresaCodigo || 'CST' }} · {{ r.horasSemanalesAplicadas ?? 42 }}h
                      </span>
                    </td>
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono" [title]="construirTooltipMetaContrato(r)">
                      <strong>{{ r.horasContratadasEfectivas ?? r.horasContratoMes }}h</strong>
                      @if ((r.diasHabilesProrrateados ?? r.diasExonerados ?? 0) > 0) {
                        <small class="text-muted">({{ r.horasContratadasNominales ?? r.emp.horasContratoMes }}h nom)</small>
                      }
                    </td>
                    <td class="font-mono">{{ r.hod }}h</td>
                    <td class="font-mono" [title]="'Recargo nocturno aplicado: ' + pct(r.recargos?.nocturno ?? normativa.recargos.nocturno)">{{ r.hon }}h</td>
                    <td class="font-mono" [title]="'Recargo dominical/festivo aplicado: ' + pct(r.recargos?.dominical ?? normativa.recargos.dominical)">{{ r.hdfd }}h</td>
                    <td class="font-mono" [title]="'Recargo nocturno dom/fest aplicado: ' + pct(r.recargos?.nocturnoDominical ?? normativa.recargos.nocturnoDominical)">{{ r.hdfn }}h</td>
                    <td class="font-mono"><strong>{{ r.horasTrabajadas }}h</strong></td>
                    <td class="font-mono" [title]="'Domingos laborados: ' + (r.conteoDomingos ?? r.conteoDomFest) + ' (≥3 causa compensatorio Art. 179 Par. 1 CST) • Dom + Fest: ' + r.conteoDomFest">
                      {{ r.conteoDomingos ?? r.conteoDomFest }} dom@if (r.conteoDomingos !== undefined && r.conteoDomFest !== r.conteoDomingos) { <small class="text-muted">({{ r.conteoDomFest }} D+F)</small> }
                      @if (r.causaCompensatorioDominical) {
                        <span class="comp-dom-tag">+1 Comp</span>
                      }
                    </td>
                    <td class="font-mono">{{ r.diasVac }}d / {{ r.diasInc }}d / {{ r.diasLic || 0 }}d / {{ r.diasFam || 0 }}d</td>
                    <td class="font-mono">{{ formatearSigno(r.saldoBancoAnterior) }}h</td>
                    <td class="font-mono" [title]="r.usaBancoHoras === false ? 'Empresa sin Banco de Horas acumulativo' : (r.horasAmortizadasComp > 0 ? 'Incluye amortización COMP: -' + r.horasAmortizadasComp + 'h' : 'Trabajadas - Meta Neta')">
                      {{ formatearSigno(r.diferenciaMes) }}h
                      @if (r.usaBancoHoras === false) {
                        <small class="rep-nobanco-tag">N/A</small>
                      }
                    </td>
                    <td class="font-mono">
                      <strong [class.text-pos]="r.nuevoSaldoBanco > 0" [class.text-neg]="r.nuevoSaldoBanco < 0">
                        {{ formatearSigno(r.nuevoSaldoBanco) }}h
                      </strong>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="16" class="text-muted table-empty-cell">
                      No se encontraron colaboradores con los filtros seleccionados.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TABLA 2: EQUIDAD Y FATIGA ASISTENCIAL -->
      @if (subVistaReportes === 'EQUIDAD') {
        <div class="panel-card">
          <div class="panel-header">
            <h3>⚖️ Auditoría de Equidad en Cargas y Nivel de Fatiga</h3>
            <span class="badge-count">{{ filas.length }} Colaboradores</span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Colaborador</th>
                  <th>Empresa</th>
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Noches Realizadas</th>
                  <th>Domingos / D+F</th>
                  <th>Total Horas Nocturnas</th>
                  <th>Compensatorio CST</th>
                  <th>Índice de Carga / Fatiga</th>
                </tr>
              </thead>
              <tbody>
                @for (r of filas; track r.emp.id) {
                  <tr>
                    <td class="font-mono">{{ r.emp.documento }}</td>
                    <td><strong>{{ r.emp.nombre }}</strong></td>
                    <td>
                      <span
                        class="rep-empresa-chip"
                        [class.is-pendiente]="r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                        [title]="(r.empresaNombre || 'Empresa') + ' · ' + (r.horasSemanalesAplicadas ?? 42) + 'h/sem'">
                        {{ r.empresaCodigo || 'CST' }} · {{ r.horasSemanalesAplicadas ?? 42 }}h
                      </span>
                    </td>
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">🌙 <strong>{{ r.conteoNoches }}</strong> noches</td>
                    <td class="font-mono" [title]="'Domingos laborados: ' + (r.conteoDomingos ?? r.conteoDomFest) + ' • Total Dom + Fest: ' + r.conteoDomFest">
                      ☀️ <strong>{{ r.conteoDomFest }}</strong> D+F <small class="text-muted">({{ r.conteoDomingos ?? r.conteoDomFest }} dom)</small>
                    </td>
                    <td class="font-mono">{{ redondearHoras(r.hon + r.hdfn) }}h nocturnas</td>
                    <td>
                      @if (r.causaCompensatorioDominical) {
                        <span class="comp-dom-tag">🏅 Causa Compensatorio</span>
                      } @else {
                        <span class="text-muted">No Aplica</span>
                      }
                    </td>
                    <td>
                      @if (r.nivelFatiga === 'ALTO') {
                        <span class="badge-fatiga fatiga-alta">🔴 Alta Carga</span>
                      } @else if (r.nivelFatiga === 'MODERADO') {
                        <span class="badge-fatiga fatiga-moderada">🟡 Moderada</span>
                      } @else {
                        <span class="badge-fatiga fatiga-baja">🟢 Equilibrada</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="10" class="text-muted table-empty-cell">
                      No se encontraron colaboradores con los filtros seleccionados.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TABLA 3: BANCO DE HORAS -->
      @if (subVistaReportes === 'BANCO_HORAS') {
        <div class="panel-card">
          <div class="panel-header">
            <h3>🏦 Estado Continuo y Semáforo del Banco de Horas</h3>
            <span class="badge-count">{{ filas.length }} Colaboradores</span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Colaborador</th>
                  <th>Empresa</th>
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Saldo Inicial</th>
                  <th>Horas Programadas</th>
                  <th>Meta Neta Mes</th>
                  <th>Amortizadas (COMP)</th>
                  <th>Diferencia Mes</th>
                  <th>Nuevo Saldo Continuo</th>
                  <th>Semáforo de Riesgo</th>
                </tr>
              </thead>
              <tbody>
                @for (r of filas; track r.emp.id) {
                  <tr>
                    <td class="font-mono">{{ r.emp.documento }}</td>
                    <td><strong>{{ r.emp.nombre }}</strong></td>
                    <td>
                      <span
                        class="rep-empresa-chip"
                        [class.is-pendiente]="r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                        [title]="(r.empresaNombre || 'Empresa') + ' · ' + (r.horasSemanalesAplicadas ?? 42) + 'h/sem'">
                        {{ r.empresaCodigo || 'CST' }} · {{ r.horasSemanalesAplicadas ?? 42 }}h
                      </span>
                    </td>
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">{{ formatearSigno(r.saldoBancoAnterior) }}h</td>
                    <td class="font-mono">{{ r.horasTrabajadas }}h</td>
                    <td class="font-mono" [title]="construirTooltipMetaContrato(r)">
                      <strong>{{ r.horasContratadasEfectivas ?? r.horasContratoMes }}h</strong>
                      @if ((r.diasHabilesProrrateados ?? r.diasExonerados ?? 0) > 0) {
                        <small class="text-muted">(-{{ r.horasExoneradas }}h)</small>
                      }
                    </td>
                    <td class="font-mono" [title]="construirTooltipAmortizacionComp(r)">
                      @if (r.horasAmortizadasComp > 0) {
                        <span class="comp-note">-{{ r.horasAmortizadasComp }}h COMP</span>
                      } @else {
                        0h
                      }
                    </td>
                    <td class="font-mono">
                      {{ formatearSigno(r.diferenciaMes) }}h
                      @if (r.usaBancoHoras === false) {
                        <small class="rep-nobanco-tag">Sin Banco</small>
                      }
                    </td>
                    <td class="font-mono">
                      <strong>{{ formatearSigno(r.nuevoSaldoBanco) }}h</strong>
                    </td>
                    <td>
                      @if (r.usaBancoHoras === false) {
                        <span class="rep-nobanco-pill">Regla Sin Banco</span>
                      } @else if (r.estadoBanco === 'CRITICO') {
                        <span class="banco-badge-final status-danger">🔴 Crítico ({{ formatearSigno(r.nuevoSaldoBanco) }}h)</span>
                      } @else if (r.estadoBanco === 'ATENCION') {
                        <span class="banco-badge-final status-warn">🟡 Atención ({{ formatearSigno(r.nuevoSaldoBanco) }}h)</span>
                      } @else {
                        <span class="banco-badge-final status-ok">🟢 Equilibrado</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="12" class="text-muted table-empty-cell">
                      No se encontraron colaboradores con los filtros seleccionados.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- TABLA 4: AUSENTISMO Y NOVEDADES -->
      @if (subVistaReportes === 'AUSENTISMO') {
        <div class="panel-card">
          <div class="panel-header">
            <h3>🩺 Monitoreo de Ausentismo (Vacaciones, Incapacidades y Licencias)</h3>
            <span class="badge-count">{{ filas.length }} Colaboradores</span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Colaborador</th>
                  <th>Empresa</th>
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Días Vacaciones (VAC)</th>
                  <th>Días Incapacidad (INC)</th>
                  <th>Días Licencia (LIC)</th>
                  <th>Día Familia (FAM)</th>
                  <th>Total Días de Ausencia</th>
                  <th>Estado del Mes</th>
                </tr>
              </thead>
              <tbody>
                @for (r of filas; track r.emp.id) {
                  <tr>
                    <td class="font-mono">{{ r.emp.documento }}</td>
                    <td><strong>{{ r.emp.nombre }}</strong></td>
                    <td>
                      <span
                        class="rep-empresa-chip"
                        [class.is-pendiente]="r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                        [title]="(r.empresaNombre || 'Empresa') + ' · ' + (r.horasSemanalesAplicadas ?? 42) + 'h/sem'">
                        {{ r.empresaCodigo || 'CST' }} · {{ r.horasSemanalesAplicadas ?? 42 }}h
                      </span>
                    </td>
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">
                      @if (r.diasVac > 0) {
                        <span class="badge-nuevo">{{ r.diasVac }} días</span>
                      } @else {
                        <span class="text-muted">0</span>
                      }
                    </td>
                    <td class="font-mono">
                      @if (r.diasInc > 0) {
                        <span class="badge-custom">{{ r.diasInc }} días</span>
                      } @else {
                        <span class="text-muted">0</span>
                      }
                    </td>
                    <td class="font-mono">
                      @if ((r.diasLic || 0) > 0) {
                        <span class="badge-custom">{{ r.diasLic }} días</span>
                      } @else {
                        <span class="text-muted">0</span>
                      }
                    </td>
                    <td class="font-mono">
                      @if ((r.diasFam || 0) > 0) {
                        <span class="badge-custom">{{ r.diasFam }} días</span>
                      } @else {
                        <span class="text-muted">0</span>
                      }
                    </td>
                    <td class="font-mono">
                      <strong>{{ r.diasVac + r.diasInc + (r.diasLic || 0) + (r.diasFam || 0) }} días</strong>
                    </td>
                    <td>
                      @if (r.diasVac + r.diasInc + (r.diasLic || 0) + (r.diasFam || 0) > 0) {
                        <span class="tag-hermano">Novedad Registrada</span>
                      } @else {
                        <span class="text-muted">Operación Normal</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="11" class="text-muted table-empty-cell">
                      No se encontraron colaboradores con los filtros seleccionados.
                    </td>
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
export class ReportesNominaComponent {
  @Input({ required: true }) kpi!: KpisReportes;
  @Input() filas: any[] = [];
  @Input() nombreMesSeleccionado = '';
  @Input() anioSeleccionado = Number(hoyColombiaIso().substring(0, 4));
  @Input() aniosDisponibles: number[] = [];
  @Input() mesSeleccionado = 1;
  @Input() esPeriodoActual = true;
  @Input() mesesDisponibles: Array<{ valor: number; nombre: string }> = [];
  @Input() filtroReporteServicioId = 'TODOS';
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() empresas: EmpresaContratante[] = [];
  @Input() filtroReporteEmpresaId = 'TODOS';
  @Input() busquedaReporteTexto = '';
  @Input() subVistaReportes: SubVistaReportes = 'PRE_NOMINA';

  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarAnio = new EventEmitter<number>();
  @Output() navegarMes = new EventEmitter<-1 | 1>();
  @Output() irAMesActual = new EventEmitter<void>();
  @Output() cambiarFiltroServicio = new EventEmitter<string>();
  @Output() cambiarFiltroEmpresa = new EventEmitter<string>();
  @Output() cambiarBusquedaTexto = new EventEmitter<string>();
  @Output() cambiarSubVista = new EventEmitter<SubVistaReportes>();
  @Output() exportarExcel = new EventEmitter<void>();

  /** Franjas y recargos legales base vigentes del periodo (Art. 160/168/179 CST, Ley 2466/2025). */
  get normativa(): ReturnType<typeof resumenNormativoPeriodo> {
    return resumenNormativoPeriodo(this.anioSeleccionado, this.mesSeleccionado);
  }

  get resumenRegimenes(): string {
    const vistos = new Set<string>();
    for (const r of this.filas || []) {
      const cod = r.empresaCodigo || r.emp?.empresaContratante?.codigo;
      const h = r.horasSemanalesAplicadas ?? r.emp?.horasSemanalesAplicadas;
      if (cod && h) {
        vistos.add(`${cod} ${h}h`);
      }
    }
    if (vistos.size === 0 && (this.empresas || []).length > 0) {
      const fuente =
        this.filtroReporteEmpresaId !== 'TODOS'
          ? this.empresas.filter((e) => e.id === this.filtroReporteEmpresaId)
          : this.empresas;
      for (const e of fuente) {
        vistos.add(`${e.codigo} ${e.horasSemanalesContrato}h`);
      }
    }
    if (vistos.size === 0) {
      return `Base legal ${this.normativa.jornadaSemanalHoras}h/sem`;
    }
    const items = Array.from(vistos);
    return items.length === 1 ? `Régimen ${items[0]}/sem` : `Multi-empresa: ${items.join(' / ')}`;
  }

  get tooltipRegimenes(): string {
    const lineas: string[] = [];
    const seen = new Set<string>();
    for (const r of this.filas || []) {
      const cod = r.empresaCodigo || 'CST';
      if (seen.has(cod)) continue;
      seen.add(cod);
      const nom = r.empresaNombre || cod;
      const h = r.horasSemanalesAplicadas ?? 42;
      const dh = r.diasHabilesMes ?? '—';
      const noc = r.recargos?.nocturno !== undefined ? this.pct(r.recargos.nocturno) : this.pct(this.normativa.recargos.nocturno);
      const dom = r.recargos?.dominical !== undefined ? this.pct(r.recargos.dominical) : this.pct(this.normativa.recargos.dominical);
      lineas.push(`• ${nom} (${cod}): ${h}h/sem · ${dh} d.h. mes · Noc ${noc} · Dom/Fest ${dom}`);
    }
    if (lineas.length === 0) {
      return `Jornada por días hábiles según reglas de empresa contratante (Ref. CST: ${this.normativa.franjas.nocturna}, Noc ${this.pct(this.normativa.recargos.nocturno)}, Dom ${this.pct(this.normativa.recargos.dominical)})`;
    }
    return `Liquidación multi-empresa por días hábiles:\n${lineas.join('\n')}`;
  }

  get tieneEmpresasPendientesEnReporte(): boolean {
    if ((this.filas || []).some((r) => r.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS')) {
      return true;
    }
    return (this.empresas || []).some(
      (e) =>
        e.estadoConfiguracion === 'PENDIENTE_REGLAS' &&
        (this.filtroReporteEmpresaId === 'TODOS' || this.filtroReporteEmpresaId === e.id)
    );
  }

  etiquetaRecargoColumna(clave: 'nocturno' | 'dominical' | 'nocturnoDominical'): string {
    const vals = new Set<string>();
    for (const r of this.filas || []) {
      const v = r.recargos?.[clave];
      if (typeof v === 'number') {
        vals.add(this.pct(v));
      }
    }
    if (vals.size === 1) {
      return Array.from(vals)[0];
    }
    if (vals.size > 1) {
      return '(Var.)';
    }
    return this.pct(this.normativa.recargos[clave]);
  }

  construirTooltipMetaContrato(r: any): string {
    const hSem = r.horasSemanalesAplicadas ?? r.emp?.horasSemanalesAplicadas ?? 42;
    const dhMes = r.diasHabilesMes ?? '—';
    const nom = r.horasContratadasNominales ?? r.horasContratoMes ?? r.emp?.horasContratoMes ?? 0;
    const ef = r.horasContratadasEfectivas ?? nom;
    const dhPror = r.diasHabilesProrrateados ?? r.diasExonerados ?? 0;
    const exoneradas = r.horasExoneradas ?? 0;
    const base = `${r.empresaNombre || 'Empresa'} (${hSem}h/sem)\n${dhMes} días hábiles × ${hSem}h / 6 = ${nom}h nominales`;
    if (dhPror > 0) {
      return `${base}\nProrrateo: -${dhPror} d.h. (-${exoneradas}h) ➔ Meta neta: ${ef}h`;
    }
    return `${base}\nSin días hábiles prorrateados`;
  }

  construirTooltipAmortizacionComp(r: any): string {
    if (!r.horasAmortizadasComp || r.horasAmortizadasComp <= 0) {
      return 'Sin turnos COMP amortizados en el periodo';
    }
    const hSem = r.horasSemanalesAplicadas ?? 42;
    const valorDiaHabil = r2(hSem / 6);
    return `Amortización COMP: -${r.horasAmortizadasComp}h del Banco de Horas (Referencia 1 día hábil de ${hSem}h/sem = ${valorDiaHabil}h o valor fijo del turno).`;
  }

  pct(fraccion: number): string {
    return formatearPorcentaje(fraccion);
  }

  redondearHoras(n?: number): number {
    return r2(Number(n) || 0);
  }

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }
}
