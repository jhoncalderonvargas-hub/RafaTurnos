import { Injectable, signal } from '@angular/core';
import { ModalConfirmacionConfig } from '../models';

@Injectable({ providedIn: 'root' })
export class NotificacionStore {
  readonly mensajeToast = signal<string>('');
  readonly modalConfirmacion = signal<ModalConfirmacionConfig | null>(null);
  private toastTimerId: ReturnType<typeof setTimeout> | null = null;

  mostrar(msg: string): void {
    if (this.toastTimerId !== null) {
      clearTimeout(this.toastTimerId);
      this.toastTimerId = null;
    }
    this.mensajeToast.set(msg);
    this.toastTimerId = setTimeout(() => {
      this.toastTimerId = null;
      if (this.mensajeToast() === msg) {
        this.mensajeToast.set('');
      }
    }, 4500);
  }

  limpiar(): void {
    if (this.toastTimerId !== null) {
      clearTimeout(this.toastTimerId);
      this.toastTimerId = null;
    }
    this.mensajeToast.set('');
  }

  abrirConfirmacion(config: ModalConfirmacionConfig): void {
    this.modalConfirmacion.set(config);
  }

  cerrarConfirmacion(): void {
    this.modalConfirmacion.set(null);
  }

  ejecutarConfirmacion(): void {
    const conf = this.modalConfirmacion();
    if (conf) {
      this.modalConfirmacion.set(null);
      conf.onConfirmar();
    }
  }
}
