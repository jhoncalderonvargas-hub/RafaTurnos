import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { NotificacionStore } from './notificacion.store';

describe('NotificacionStore', () => {
  let store: NotificacionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(NotificacionStore);
  });

  it('muestra toast, reinicia temporizador de 4500ms al superponer mensajes y limpia al vencer', fakeAsync(() => {
    store.mostrar('Primer aviso');
    expect(store.mensajeToast()).toBe('Primer aviso');

    tick(3000);
    expect(store.mensajeToast()).toBe('Primer aviso');

    // Al emitir un segundo toast se cancela el timer anterior
    store.mostrar('Segundo aviso');
    expect(store.mensajeToast()).toBe('Segundo aviso');

    tick(2000); // 5000ms desde el primero, 2000ms desde el segundo
    expect(store.mensajeToast()).toBe('Segundo aviso');

    tick(2500); // 4500ms exactos desde el segundo
    expect(store.mensajeToast()).toBe('');
  }));

  it('limpiar() borra el mensaje inmediatamente y cancela el temporizador pendiente', fakeAsync(() => {
    store.mostrar('Temporal');
    expect(store.mensajeToast()).toBe('Temporal');

    store.limpiar();
    expect(store.mensajeToast()).toBe('');

    store.mostrar('Nuevo tras limpiar');
    tick(4499);
    expect(store.mensajeToast()).toBe('Nuevo tras limpiar');
    tick(1);
    expect(store.mensajeToast()).toBe('');
  }));

  it('gestiona abrirConfirmacion, cerrarConfirmacion y ejecutarConfirmacion una sola vez', () => {
    const callback = jasmine.createSpy('onConfirmar');
    store.abrirConfirmacion({
      titulo: 'Confirmar',
      mensaje: '¿Continuar?',
      onConfirmar: callback,
    });
    expect(store.modalConfirmacion()?.titulo).toBe('Confirmar');

    store.cerrarConfirmacion();
    expect(store.modalConfirmacion()).toBeNull();
    store.ejecutarConfirmacion();
    expect(callback).not.toHaveBeenCalled();

    store.abrirConfirmacion({
      titulo: 'Eliminar',
      mensaje: 'Seguro',
      onConfirmar: callback,
    });
    store.ejecutarConfirmacion();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(store.modalConfirmacion()).toBeNull();
  });
});
