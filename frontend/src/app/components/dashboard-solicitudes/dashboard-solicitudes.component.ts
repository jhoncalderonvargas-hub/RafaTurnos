import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PermutaItem, RegistroAuditoria, SesionUsuarioSso } from '../../models';

@Component({
  selector: 'app-dashboard-solicitudes',
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="dashboard-layout">
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Cobertura del Servicio</div>
          <div class="kpi-value">{{ porcentajeCobertura }}%</div>
          <div class="kpi-sub">{{ servicioNombre }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Alertas de Descanso</div>
          <div class="kpi-value" [class.text-neg]="infraccionesCount > 0">{{ infraccionesCount }}</div>
          <div class="kpi-sub">Descanso mínimo: 12 horas</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Balance Banco de Horas</div>
          <div class="kpi-value">{{ formatearSigno(balanceBancoHoras) }}h</div>
          <div class="kpi-sub">Total acumulado del servicio</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Cambios de Turno Pendientes</div>
          <div class="kpi-value">{{ notificacionesCount }}</div>
          <div class="kpi-sub">{{ esColaborador ? 'Por responder' : 'Por revisar' }}</div>
        </div>
      </div>

      <div class="two-col-panels">
        <!-- Panel de Cambios de Turno entre compañeros -->
        <div class="panel-card">
          <div class="panel-header">
            <h3>🔄 Solicitudes de Cambio de Turno (Permutas)</h3>
          </div>
          <div class="permutas-list">
            @for (p of permutas; track p.id) {
              <div class="permuta-item" [class.permuta-ready]="p.estado === 'PENDIENTE_SUPERVISOR'">
                <div class="permuta-main">
                  <div class="permuta-title">
                    <strong>{{ p.solicitanteNombre }}</strong> (Día {{ p.diaOrigen }}: <code>{{ p.turnoOrigen }}</code>)
                    ⇄ <strong>{{ p.receptorNombre }}</strong> (Día {{ p.diaDestino }}: <code>{{ p.turnoDestino }}</code>)
                  </div>
                  <div class="permuta-meta">
                    Categoría: <b>{{ p.categoria }}</b> • Solicitud: {{ p.fechaSolicitud }}
                  </div>
                  <div class="permuta-validation">
                    ✅ {{ p.validacionReglas }}
                  </div>
                  @if (p.motivoRechazo) {
                    <div class="permuta-reject-reason">⚠️ {{ p.motivoRechazo }}</div>
                  }
                </div>
                <div class="permuta-actions">
                  @if (p.estado === 'PENDIENTE_SUPERVISOR') {
                    @if (!esColaborador) {
                      <div class="supervisor-approval-group">
                        <span class="badge-concertada">🤝 Acuerdo mutuo confirmado</span>
                        <div class="btn-group-h">
                          <button class="btn-approve" (click)="aprobarPermuta.emit(p.id)">✔ Aprobar Cambio</button>
                          <button class="btn-reject" (click)="rechazarPermuta.emit(p.id)">✕ Rechazar</button>
                        </div>
                      </div>
                    } @else {
                      <span class="status-tag status-tag-par">⏳ En revisión por Coordinador de Servicio</span>
                    }
                  } @else if (p.estado === 'PENDIENTE_PAR') {
                    @if (sesionActual?.empleadoId === p.receptorId) {
                      <div class="supervisor-approval-group">
                        <span class="badge-incoming-par">📬 Propuesta dirigida a ti</span>
                        <div class="btn-group-h">
                          <button class="btn-approve" (click)="aceptarPropuestaPar.emit(p.id)">
                            ✅ Aceptar Propuesta
                          </button>
                          <button class="btn-reject" (click)="rechazarPropuestaPar.emit(p.id)">
                            ❌ Declinar
                          </button>
                        </div>
                      </div>
                    } @else {
                      <span class="status-tag status-tag-par">⏳ Esperando respuesta de {{ p.receptorNombre }}</span>
                    }
                  } @else if (p.estado === 'APROBADA') {
                    <span class="status-tag status-tag-ok">✅ Aprobada en Cuadrante</span>
                  } @else {
                    <span class="status-tag status-tag-no">❌ Rechazada</span>
                  }
                </div>
              </div>
            } @empty {
              <div class="text-muted" style="padding: 16px;">No hay solicitudes de permuta registradas.</div>
            }
          </div>
        </div>

        <!-- Historial de Cambios del Cuadro de Turnos -->
        <div class="panel-card">
          <div class="panel-header">
            <h3>📋 Historial de Cambios del Cuadro de Turnos</h3>
          </div>
          <div class="audit-table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Fecha / Hora</th>
                  <th>Realizado por</th>
                  <th>Colaborador</th>
                  <th>Día</th>
                  <th>Cambio</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                @for (log of bitacoraAuditoria; track log.id) {
                  <tr>
                    <td class="font-mono">{{ log.timestamp }}</td>
                    <td>{{ log.actor }}</td>
                    <td><strong>{{ log.empleadoNombre }}</strong></td>
                    <td>{{ log.dia > 0 ? 'Día ' + log.dia : 'Mes completo' }}</td>
                    <td>
                      <span class="mini-shift">{{ log.turnoAnterior || 'Vacío' }}</span>
                      →
                      <span class="mini-shift">{{ log.turnoNuevo || 'Vacío' }}</span>
                    </td>
                    <td>{{ log.motivo }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="text-muted" style="text-align: center; padding: 22px;">
                      🛡️ No hay movimientos de auditoría registrados para este servicio.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardSolicitudesComponent {
  @Input() porcentajeCobertura = 0;
  @Input() servicioNombre = '';
  @Input() infraccionesCount = 0;
  @Input() balanceBancoHoras = 0;
  @Input() notificacionesCount = 0;
  @Input() esColaborador = false;
  @Input() permutas: PermutaItem[] = [];
  @Input() bitacoraAuditoria: RegistroAuditoria[] = [];
  @Input() sesionActual: SesionUsuarioSso | null = null;

  @Output() aprobarPermuta = new EventEmitter<string>();
  @Output() rechazarPermuta = new EventEmitter<string>();
  @Output() aceptarPropuestaPar = new EventEmitter<string>();
  @Output() rechazarPropuestaPar = new EventEmitter<string>();

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }
}
