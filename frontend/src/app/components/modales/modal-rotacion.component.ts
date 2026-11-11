import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmpleadoHospital } from '../../models';

@Component({
  selector: 'app-modal-rotacion',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (abierto) {
      <div class="modal-backdrop" (click)="cerrar.emit()">
        <div
          class="modal-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-rotacion-title"
          (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div class="rot-header-cluster">
              <span class="rot-header-icon" aria-hidden="true">🔄</span>
              <div>
                <h3 id="modal-rotacion-title">Rotación y Personal de Apoyo — {{ servicioNombre }}</h3>
                <div class="rot-header-sub">
                  Modelo de Propiedad por Día y Celda Espejo Inter-Servicio
                </div>
              </div>
            </div>
            <button type="button" aria-label="Cerrar ventana" (click)="cerrar.emit()" title="Cerrar ventana">✕</button>
          </div>

          <div class="modal-body">
            <!-- Servicios hermanos conectados -->
            <div class="connected-services-bar">
              <span class="connected-label">🔗 Servicios de apoyo conectados:</span>
              @if (hermanos && hermanos.length > 0) {
                <div class="connected-pills">
                  @for (h of hermanos; track h.id) {
                    <span class="srv-sister-pill">
                      <strong>{{ h.codigo }}</strong> · {{ h.nombre }}
                    </span>
                  }
                </div>
              } @else {
                <span class="no-sister-warn">Sin servicios hermanos vinculados aún</span>
              }
            </div>

            @if (candidatos.length > 0) {
              <div class="bulk-action-banner">
                <div class="bulk-action-text">
                  <strong>¿Rotación continua entre áreas?</strong>
                  <span>Puedes traer a un colaborador específico o vincular a todo el equipo hermano con un clic para alternar sus días libremente.</span>
                </div>
                @if (candidatos.length > 1) {
                  <button type="button" class="btn-bulk-link" (click)="vincularTodos.emit()">
                    ➕ Vincular Todo el Equipo ({{ candidatos.length }})
                  </button>
                }
              </div>

              <div class="rotacion-candidates">
                @for (cand of candidatos; track cand.id) {
                  <div class="candidate-row">
                    <div class="cand-info">
                      <div class="cand-title-line">
                        <strong>{{ cand.nombre }}</strong>
                        <span class="cand-cat-badge">{{ cand.categoria }}</span>
                      </div>
                      <div class="cand-meta-line">
                        <span class="cand-origin-tag" title="Servicio base del colaborador">
                          📍 Base: <b>{{ cand.servicioBaseCodigo || 'SRV' }}</b> ({{ cand.servicioBaseNombre || 'Servicio Hermano' }})
                        </span>
                        <span class="cand-hours-tag" title="Horas ya programadas en el mes actual (todos los servicios) vs contrato">
                          ⏱️ Mes: <b>{{ cand.horasProgramadasMes || 0 }}h</b> / {{ cand.horasContratoMes || 168 }}h
                        </span>
                        <span class="cand-bank-tag">
                          🏦 Banco: <b>{{ formatearSigno(cand.saldoBancoAnterior) }}h</b>
                        </span>
                      </div>
                    </div>
                    <button type="button" class="btn-primary" (click)="vincular.emit(cand)">
                      ➕ Vincular al Cuadro
                    </button>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-msg">
                @if (hermanos && hermanos.length > 0) {
                  <div class="rot-empty-icon" aria-hidden="true">✅</div>
                  <strong class="rot-empty-title">
                    Todo el personal de los servicios conectados ya está en este cuadrante
                  </strong>
                  <span>
                    Ya puedes asignarles turnos en sus días disponibles. Los días que laboren en su servicio base se verán como <b>Celdas Espejo (📍)</b> protegidas.
                  </span>
                } @else {
                  <div class="rot-empty-icon" aria-hidden="true">🔗</div>
                  <strong class="rot-empty-title-spaced">
                    Este servicio aún no tiene servicios hermanos vinculados
                  </strong>
                  <span class="rot-empty-desc">
                    Para rotar personal entre dos áreas (ej. <i>Facturación Central</i> y <i>Facturación Urgencias</i>), primero conéctalas como Servicios de Apoyo en Configuración.
                  </span>
                  @if (esAdminTh) {
                    <button type="button" class="btn-primary" (click)="configurarApoyo.emit()">
                      ⚙️ Ir a Vincular Servicios de Apoyo
                    </button>
                  }
                }
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
    }
    .rot-header-cluster {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .rot-header-icon {
      font-size: 20px;
    }
    .rot-header-sub {
      font-size: 11.5px;
      color: #94a3b8;
      font-weight: 500;
      margin-top: 2px;
    }
    .rot-empty-icon {
      font-size: 28px;
      margin-bottom: 8px;
    }
    .rot-empty-title {
      color: #1e293b;
      display: block;
      margin-bottom: 4px;
      font-style: normal;
    }
    .rot-empty-title-spaced {
      color: #1e293b;
      display: block;
      margin-bottom: 6px;
      font-style: normal;
    }
    .rot-empty-desc {
      display: block;
      margin-bottom: 14px;
    }
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 16px;
    }
    .modal-box {
      background: #ffffff;
      width: 100%;
      max-width: 660px;
      max-height: calc(100vh - 32px);
      display: flex;
      flex-direction: column;
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.08);
      animation: modalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      margin: auto;
    }
    .modal-header {
      padding: 13px 18px;
      background: linear-gradient(135deg, #1e1b4b 0%, #311068 100%);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .modal-header h3 {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .modal-header button {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #cbd5e1;
      font-size: 15px;
      cursor: pointer;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .modal-header button:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }
    .modal-body {
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .connected-services-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 12px;
      flex-shrink: 0;
    }
    .connected-label {
      font-weight: 700;
      color: #475569;
    }
    .connected-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .srv-sister-pill {
      background: #ede9fe;
      color: #5b21b6;
      border: 1px solid #ddd6fe;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .no-sister-warn {
      color: #b45309;
      background: #fffbeb;
      border: 1px solid #fde68a;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .bulk-action-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 10px;
      flex-shrink: 0;
    }
    .bulk-action-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 12px;
      color: #0c4a6e;
      line-height: 1.35;
    }
    .btn-bulk-link {
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid #0284c7;
      background: #0284c7;
      color: #ffffff;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: 0 2px 4px rgba(2, 132, 199, 0.2);
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .btn-bulk-link:hover {
      background: #0369a1;
    }
    .rotacion-candidates {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-height: 0;
      max-height: none;
      overflow-y: auto;
      padding-right: 6px;
      padding-bottom: 6px;
    }
    .candidate-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #ffffff;
      transition: border-color 0.15s, box-shadow 0.15s;
      flex-shrink: 0;
    }
    .candidate-row:hover {
      border-color: #cbd5e1;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
    }
    .cand-info {
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }
    .cand-title-line {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 14px;
      color: #0f172a;
    }
    .cand-cat-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .cand-meta-line {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #64748b;
    }
    .cand-origin-tag {
      color: #4338ca;
      background: #eef2ff;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 11.5px;
    }
    .cand-hours-tag, .cand-bank-tag {
      font-size: 11.5px;
    }
    .empty-msg {
      padding: 28px 20px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
      line-height: 1.5;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 10px;
    }
    .btn-primary {
      padding: 8px 14px;
      border-radius: 7px;
      border: none;
      background: #4f46e5;
      color: #ffffff;
      font-weight: 600;
      font-size: 12.5px;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .btn-primary:hover {
      background: #4338ca;
    }
    @keyframes modalScaleIn {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `]
})
export class ModalRotacionComponent {
  @Input() abierto = false;
  @Input() servicioNombre = '';
  @Input() hermanos: Array<{ id: string; codigo: string; nombre: string }> = [];
  @Input() esAdminTh = false;
  @Input() candidatos: any[] = [];
  @Output() cerrar = new EventEmitter<void>();
  @Output() vincular = new EventEmitter<EmpleadoHospital>();
  @Output() vincularTodos = new EventEmitter<void>();
  @Output() configurarApoyo = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.abierto) {
      this.cerrar.emit();
    }
  }

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }
}
