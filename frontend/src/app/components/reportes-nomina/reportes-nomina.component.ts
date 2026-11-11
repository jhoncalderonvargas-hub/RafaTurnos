import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatearPorcentaje, hoyColombiaIso, r2, resumenNormativoPeriodo } from '../../shared/liquidacion-horas';
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
            [title]="'Jornada máxima legal: ' + normativa.jornadaSemanalHoras + 'h/sem (Ley 2101) • Diurna: ' + normativa.franjas.diurna + ' • Nocturna: ' + normativa.franjas.nocturna">
            ⚖️ {{ normativa.jornadaSemanalHoras }}h/sem • Noc {{ normativa.franjas.nocturna }} ({{ pct(normativa.recargos.nocturno) }}) • Dom/Fest {{ pct(normativa.recargos.dominical) }}
          </span>
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

          <div class="control-item">
            <label for="rep-busqueda-input">Buscar:</label>
            <input
              id="rep-busqueda-input"
              type="text"
              placeholder="Nombre, cédula o cargo..."
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
                  <th>Servicio Base</th>
                  <th>Cargo</th>
                  <th>Contrato</th>
                  <th [title]="'Horas Ordinarias Diurnas hábiles ('+normativa.franjas.diurna+')'">HOD</th>
                  <th [title]="'Horas Ordinarias Nocturnas hábiles ('+normativa.franjas.nocturna+')'">HON {{ pct(normativa.recargos.nocturno) }}</th>
                  <th [title]="'Horas Dominicales/Festivas Diurnas ('+normativa.franjas.diurna+')'">HDFD {{ pct(normativa.recargos.dominical) }}</th>
                  <th [title]="'Horas Dominicales/Festivas Nocturnas ('+normativa.franjas.nocturna+') = dominical '+pct(normativa.recargos.dominical)+' + nocturno '+pct(normativa.recargos.nocturno)">HDFN {{ pct(normativa.recargos.nocturnoDominical) }}</th>
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
                    <td><span class="badge-personal">{{ r.servicioNombre }}</span></td>
                    <td>{{ r.emp.categoria }}</td>
                    <td class="font-mono" [title]="(r.diasExonerados || 0) > 0 ? 'Meta prorrateada por ' + r.diasExonerados + 'd de novedad oficial (-' + r.horasExoneradas + 'h sobre ' + r.emp.horasContratoMes + 'h nominales)' : 'Contrato mensual nominal'">
                      {{ r.horasContratadasEfectivas ?? r.horasContratoMes }}h
                      @if ((r.diasExonerados || 0) > 0) {
                        <small class="text-muted">({{ r.emp.horasContratoMes }}h)</small>
                      }
                    </td>
                    <td class="font-mono">{{ r.hod }}h</td>
                    <td class="font-mono">{{ r.hon }}h</td>
                    <td class="font-mono">{{ r.hdfd }}h</td>
                    <td class="font-mono">{{ r.hdfn }}h</td>
                    <td class="font-mono"><strong>{{ r.horasTrabajadas }}h</strong></td>
                    <td class="font-mono" [title]="'Domingos laborados: ' + (r.conteoDomingos ?? r.conteoDomFest) + ' (≥3 causa compensatorio Art. 179 Par. 1 CST) • Dom + Fest: ' + r.conteoDomFest">
                      {{ r.conteoDomingos ?? r.conteoDomFest }} dom@if (r.conteoDomingos !== undefined && r.conteoDomFest !== r.conteoDomingos) { <small class="text-muted">({{ r.conteoDomFest }} D+F)</small> }
                      @if (r.causaCompensatorioDominical) {
                        <span class="comp-dom-tag">+1 Comp</span>
                      }
                    </td>
                    <td class="font-mono">{{ r.diasVac }}d / {{ r.diasInc }}d / {{ r.diasLic || 0 }}d / {{ r.diasFam || 0 }}d</td>
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
                    <td colspan="15" class="text-muted table-empty-cell">
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
                    <td colspan="9" class="text-muted table-empty-cell">
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
                    <td class="font-mono" [title]="(r.diasExonerados || 0) > 0 ? 'Nominal: ' + r.emp.horasContratoMes + 'h (-' + r.horasExoneradas + 'h por novedad)' : ''">
                      {{ r.horasContratadasEfectivas ?? r.horasContratoMes }}h
                    </td>
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
  @Input() busquedaReporteTexto = '';
  @Input() subVistaReportes: SubVistaReportes = 'PRE_NOMINA';

  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarAnio = new EventEmitter<number>();
  @Output() navegarMes = new EventEmitter<-1 | 1>();
  @Output() irAMesActual = new EventEmitter<void>();
  @Output() cambiarFiltroServicio = new EventEmitter<string>();
  @Output() cambiarBusquedaTexto = new EventEmitter<string>();
  @Output() cambiarSubVista = new EventEmitter<SubVistaReportes>();
  @Output() exportarExcel = new EventEmitter<void>();

  /** Franjas y recargos legales vigentes del periodo (Art. 160/168/179 CST, Ley 2466/2025). */
  get normativa(): ReturnType<typeof resumenNormativoPeriodo> {
    return resumenNormativoPeriodo(this.anioSeleccionado, this.mesSeleccionado);
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
