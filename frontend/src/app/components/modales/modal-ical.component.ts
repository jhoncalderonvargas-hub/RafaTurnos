import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-modal-ical',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (abierto) {
      <div class="modal-backdrop" (click)="cerrar.emit()">
        <div
          class="modal-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-ical-title"
          (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3 id="modal-ical-title">📅 Vincular Calendario — {{ empleadoNombre }}</h3>
            <button type="button" aria-label="Cerrar diálogo" (click)="cerrar.emit()">✕</button>
          </div>
          <div class="modal-body">
            <p>
              Copia tu enlace personal único en tu aplicación de calendario (<strong>Google Calendar → Añadir desde URL</strong>, <strong>iPhone</strong> o <strong>Outlook</strong>):
            </p>
            <div class="ical-box">
              <code>{{ enlaceHttp || 'Generando enlace único en PostgreSQL...' }}</code>
            </div>
            <ul class="ical-features">
              <li>✔ Sincroniza automáticamente todos los meses en estado <strong>PUBLICADO</strong> o <strong>CERRADO</strong> (oculta borradores en construcción).</li>
              <li>✔ Se actualiza solo cuando se publica un mes nuevo o se aprueba una permuta.</li>
              <li>✔ Incluye horarios exactos de entrada y salida (y novedades VAC / INC / COMP).</li>
            </ul>
            <div class="modal-footer">
              <button type="button" class="btn-outline" (click)="descargar.emit()">📥 Descargar archivo .ics</button>
              <button type="button" class="btn-primary" (click)="copiar.emit()">📋 Copiar Enlace al Portapapeles</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: contents;
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
      max-width: 540px;
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
    .ical-box {
      background: #f1f5f9;
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px dashed #94a3b8;
      word-break: break-all;
      font-size: 12px;
      color: #0f172a;
    }
    .ical-features {
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: #64748b;
      font-size: 12px;
      line-height: 1.45;
      margin: 0;
    }
    .modal-footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      padding-top: 6px;
    }
    .btn-outline {
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #475569;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-outline:hover {
      background: #f8fafc;
    }
    .btn-primary {
      padding: 8px 14px;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #ffffff;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
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
export class ModalIcalComponent {
  @Input() abierto = false;
  @Input() empleadoNombre = '';
  @Input() enlaceHttp = '';
  @Output() cerrar = new EventEmitter<void>();
  @Output() copiar = new EventEmitter<void>();
  @Output() descargar = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.abierto) {
      this.cerrar.emit();
    }
  }
}
