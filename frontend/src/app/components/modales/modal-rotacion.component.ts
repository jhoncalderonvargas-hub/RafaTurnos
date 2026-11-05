import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EmpleadoHospital } from '../../models';

@Component({
  selector: 'app-modal-rotacion',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (abierto) {
      <div class="modal-backdrop" (click)="cerrar.emit()">
        <div class="modal-box" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>🔄 Traer Personal de Apoyo a {{ servicioNombre }}</h3>
            <button (click)="cerrar.emit()">✕</button>
          </div>
          <div class="modal-body">
            <p>
              Selecciona un colaborador de un servicio de apoyo para incluirlo en el cuadro de turnos de <strong>{{ servicioNombre }}</strong>:
            </p>
            <div class="rotacion-candidates">
              @for (cand of candidatos; track cand.id) {
                <div class="candidate-row">
                  <div>
                    <strong>{{ cand.nombre }}</strong> ({{ cand.categoria }})
                    <div class="text-muted">Banco de horas: {{ formatearSigno(cand.saldoBancoAnterior) }}h</div>
                  </div>
                  <button class="btn-primary" (click)="vincular.emit(cand)">
                    ➕ Agregar al Cuadro de Turnos
                  </button>
                </div>
              } @empty {
                <div class="empty-msg">No hay personal de apoyo adicional disponible en este momento.</div>
              }
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
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
      max-width: 600px;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: modalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      margin: auto;
    }
    .modal-header {
      padding: 14px 18px;
      background: #0f172a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-header h3 {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .modal-header button {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 16px;
      cursor: pointer;
      padding: 4px;
    }
    .modal-header button:hover {
      color: #ffffff;
    }
    .modal-body {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .modal-body p {
      font-size: 13.5px;
      color: #334155;
      line-height: 1.5;
      margin: 0;
    }
    .rotacion-candidates {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 380px;
      overflow-y: auto;
    }
    .candidate-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #f8fafc;
    }
    .text-muted {
      color: #64748b;
      font-size: 12px;
      margin-top: 2px;
    }
    .empty-msg {
      padding: 24px;
      text-align: center;
      color: #94a3b8;
      font-style: italic;
      font-size: 13.5px;
    }
    .btn-primary {
      padding: 8px 14px;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #ffffff;
      font-weight: 600;
      font-size: 12.5px;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-primary:hover {
      background: #0369a1;
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
  @Input() candidatos: EmpleadoHospital[] = [];
  @Output() cerrar = new EventEmitter<void>();
  @Output() vincular = new EventEmitter<EmpleadoHospital>();

  formatearSigno(n?: number): string {
    const val = Number(n) || 0;
    return (val > 0 ? '+' : '') + val;
  }
}
