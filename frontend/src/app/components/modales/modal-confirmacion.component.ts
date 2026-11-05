import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalConfirmacionConfig } from '../../models';

@Component({
  selector: 'app-modal-confirmacion',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (config) {
      <div class="modal-backdrop" (click)="cancelar.emit()">
        <div class="modal-box modal-box-confirm" (click)="$event.stopPropagation()">
          <div class="modal-header" [class.modal-header-danger]="config.esPeligroso">
            <h3>{{ config.titulo }}</h3>
            <button (click)="cancelar.emit()">✕</button>
          </div>
          <div class="modal-body">
            <p class="confirm-message-text">{{ config.mensaje }}</p>
            <div class="modal-footer modal-footer-confirm">
              <button class="btn-outline" (click)="cancelar.emit()">Cancelar</button>
              <button
                [class.btn-danger]="config.esPeligroso"
                [class.btn-primary]="!config.esPeligroso"
                (click)="confirmar.emit()">
                {{ config.textoBotonConfirmar || 'Confirmar' }}
              </button>
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
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: modalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      margin: auto;
    }
    .modal-box-confirm {
      max-width: 480px;
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
    .modal-header-danger {
      background: #991b1b !important;
    }
    .modal-body {
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .confirm-message-text {
      font-size: 14px;
      line-height: 1.5;
      color: #334155;
      margin: 0;
    }
    .modal-footer-confirm {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      padding-top: 8px;
    }
    .btn-outline {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #475569;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-outline:hover {
      background: #f8fafc;
    }
    .btn-primary {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #ffffff;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary:hover {
      background: #0369a1;
    }
    .btn-danger {
      padding: 8px 16px;
      border-radius: 6px;
      border: none;
      background: #dc2626;
      color: #ffffff;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-danger:hover {
      background: #b91c1c;
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
export class ModalConfirmacionComponent {
  @Input() config: ModalConfirmacionConfig | null = null;
  @Output() cancelar = new EventEmitter<void>();
  @Output() confirmar = new EventEmitter<void>();
}
