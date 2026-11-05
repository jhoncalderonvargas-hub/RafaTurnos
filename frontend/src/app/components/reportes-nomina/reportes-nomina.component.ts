import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServicioHospitalario } from '../../models';

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
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="view-container">
      <!-- Barra Superior de Filtros y Acciones -->
      <div class="reportes-header-bar">
        <div class="reportes-title-block">
          <h2>📊 Reportes y Analítica</h2>
          <span class="reportes-period-tag">Periodo: {{ nombreMesSeleccionado }} {{ anioSeleccionado }}</span>
        </div>

        <div class="reportes-controls-row">
          <div class="control-item">
            <label>Mes:</label>
            <select [ngModel]="mesSeleccionado" (ngModelChange)="cambiarMes.emit($event)">
              @for (m of mesesDisponibles; track m.valor) {
                <option [value]="m.valor">{{ m.nombre }}</option>
              }
            </select>
          </div>

          <div class="control-item">
            <label>Servicio:</label>
            <select [ngModel]="filtroReporteServicioId" (ngModelChange)="cambiarFiltroServicio.emit($event)">
              <option value="TODOS">🏥 Todos los Servicios del Hospital</option>
              @for (s of servicios; track s.id) {
                <option [value]="s.id">{{ s.nombre }} ({{ s.codigo }})</option>
              }
            </select>
          </div>

          <div class="control-item">
            <label>Buscar:</label>
            <input
              type="text"
              placeholder="Nombre, cédula o cargo..."
              [ngModel]="busquedaReporteTexto"
              (ngModelChange)="cambiarBusquedaTexto.emit($event)"
              class="report-search-input"
            />
          </div>

          <button class="btn-excel" (click)="exportarExcel.emit()">
            📥 Exportar Excel (CSV)
          </button>
        </div>
      </div>

      <!-- Sub-pestañas de los 4 Reportes Clave -->
      <div class="config-subtabs" style="margin-bottom: 16px;">
        <button
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'PRE_NOMINA'"
          (click)="cambiarSubVista.emit('PRE_NOMINA')">
          📥 Pre-Nómina Global
        </button>
        <button
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'EQUIDAD'"
          (click)="cambiarSubVista.emit('EQUIDAD')">
          ⚖️ Equidad y Fatiga
        </button>
        <button
          class="config-subtab-btn"
          [class.active]="subVistaReportes === 'BANCO_HORAS'"
          (click)="cambiarSubVista.emit('BANCO_HORAS')">
          🏦 Banco de Horas
        </button>
        <button
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
                  <th>Servicio Base</th>
                  <th>Categoría</th>
                  <th>Contrato</th>
                  <th title="Horas Ordinarias Diurnas (06:00-19:00 L-S)">HOD</th>
                  <th title="Horas Ordinarias Nocturnas (19:00-06:00 L-S) Recargo 35%">HON 35%</th>
                  <th title="Horas Dominicales/Festivas Diurnas (06:00-19:00) Recargo 75%">HDFD 75%</th>
                  <th title="Horas Dominicales/Festivas Nocturnas (19:00-06:00) Recargo 110%">HDFN 110%</th>
                  <th>Total Mes</th>
                  <th>Dom / Comp</th>
                  <th>VAC / INC</th>
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
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">{{ r.horasContratoMes }}h</td>
                    <td class="font-mono">{{ r.hod }}h</td>
                    <td class="font-mono">{{ r.hon }}h</td>
                    <td class="font-mono">{{ r.hdfd }}h</td>
                    <td class="font-mono">{{ r.hdfn }}h</td>
                    <td class="font-mono"><strong>{{ r.horasTrabajadas }}h</strong></td>
                    <td class="font-mono">
                      {{ r.conteoDomFest }} dom
                      @if (r.causaCompensatorioDominical) {
                        <span class="comp-dom-tag">+1 Comp</span>
                      }
                    </td>
                    <td class="font-mono">{{ r.diasVac }}d / {{ r.diasInc }}d</td>
                    <td class="font-mono">{{ formatearSigno(r.saldoBancoAnterior) }}h</td>
                    <td class="font-mono">{{ formatearSigno(r.diferenciaMes) }}h</td>
                    <td class="font-mono">
                      <strong [class.text-pos]="r.nuevoSaldoBanco > 0" [class.text-neg]="r.nuevoSaldoBanco < 0">
                        {{ formatearSigno(r.nuevoSaldoBanco) }}h
                      </strong>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="15" class="text-muted" style="text-align: center; padding: 20px;">
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
                  <th>Servicio Base</th>
                  <th>Categoría</th>
                  <th>Noches Realizadas</th>
                  <th>Dom. y Festivos</th>
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
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">🌙 <strong>{{ r.conteoNoches }}</strong> noches</td>
                    <td class="font-mono">☀️ <strong>{{ r.conteoDomFest }}</strong> dom-fest</td>
                    <td class="font-mono">{{ r.hon + r.hdfn }}h nocturnas</td>
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
                    <td colspan="9" class="text-muted" style="text-align: center; padding: 20px;">
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
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Saldo Inicial</th>
                  <th>Horas Programadas</th>
                  <th>Contrato Mes</th>
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
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono">{{ formatearSigno(r.saldoBancoAnterior) }}h</td>
                    <td class="font-mono">{{ r.horasTrabajadas }}h</td>
                    <td class="font-mono">{{ r.horasContratoMes }}h</td>
                    <td class="font-mono">
                      @if (r.horasAmortizadasComp > 0) {
                        <span class="comp-note">-{{ r.horasAmortizadasComp }}h COMP</span>
                      } @else {
                        0h
                      }
                    </td>
                    <td class="font-mono">{{ formatearSigno(r.diferenciaMes) }}h</td>
                    <td class="font-mono">
                      <strong>{{ formatearSigno(r.nuevoSaldoBanco) }}h</strong>
                    </td>
                    <td>
                      @if (r.estadoBanco === 'CRITICO') {
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
                    <td colspan="11" class="text-muted" style="text-align: center; padding: 20px;">
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
            <h3>🩺 Monitoreo de Ausentismo (Vacaciones e Incapacidades Médicas)</h3>
            <span class="badge-count">{{ filas.length }} Colaboradores</span>
          </div>
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Colaborador</th>
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Días Vacaciones (VAC)</th>
                  <th>Días Incapacidad (INC)</th>
                  <th>Total Días de Ausencia</th>
                  <th>Estado del Mes</th>
                </tr>
              </thead>
              <tbody>
                @for (r of filas; track r.emp.id) {
                  <tr>
                    <td class="font-mono">{{ r.emp.documento }}</td>
                    <td><strong>{{ r.emp.nombre }}</strong></td>
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
                      <strong>{{ r.diasVac + r.diasInc }} días</strong>
                    </td>
                    <td>
                      @if (r.diasVac + r.diasInc > 0) {
                        <span class="tag-hermano">Novedad Registrada</span>
                      } @else {
                        <span class="text-muted">Operación Normal</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="text-muted" style="text-align: center; padding: 20px;">
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
  @Input() anioSeleccionado = 2026;
  @Input() mesSeleccionado = 1;
  @Input() mesesDisponibles: Array<{ valor: number; nombre: string }> = [];
  @Input() filtroReporteServicioId = 'TODOS';
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() busquedaReporteTexto = '';
  @Input() subVistaReportes: SubVistaReportes = 'PRE_NOMINA';

  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarFiltroServicio = new EventEmitter<string>();
  @Output() cambiarBusquedaTexto = new EventEmitter<string>();
  @Output() cambiarSubVista = new EventEmitter<SubVistaReportes>();
  @Output() exportarExcel = new EventEmitter<void>();

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }
}
