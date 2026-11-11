import { TestBed } from '@angular/core/testing';
import { defer, of, Subject, throwError } from 'rxjs';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import { EmpleadoHospital, ServicioHospitalario } from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { CatalogosSsoStore } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';

describe('CuadranteStore', () => {
  let store: CuadranteStore;
  let catalogos: CatalogosSsoStore;
  let apiSpy: jasmine.SpyObj<TurnosApiService>;

  const emp1: EmpleadoHospital = {
    id: 'e1',
    documento: '101',
    nombre: 'Ana Lopez',
    categoria: 'Enfermero(a) Jefe',
    servicioBaseId: 'srv-urg',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'L',
  };

  const srvUrg: ServicioHospitalario = {
    id: 'srv-urg',
    codigo: 'URG',
    nombre: 'Urgencias',
    tipoAsistencia: 'URGENCIAS',
    reqDia: 1,
    reqNoche: 1,
    modalidadDias: 'TODOS_24_7',
    turnosHabilitados: ['M8', 'T8', 'N12', 'G24', 'S', 'L', 'VAC', 'FAM'],
  };

  const srvMat: ServicioHospitalario = {
    id: 'srv-mat',
    codigo: 'MAT',
    nombre: 'Maternidad',
    tipoAsistencia: 'URGENCIAS',
    reqDia: 1,
    reqNoche: 0,
    modalidadDias: 'TODOS_24_7',
    turnosHabilitados: ['M8', 'L'],
  };

  beforeEach(() => {
    localStorage.removeItem('rafa_turnos_rotados_servicio');
    FestivosColombiaHelper.limpiarFestivosManualesAnio(2026);
    apiSpy = jasmine.createSpyObj<TurnosApiService>('TurnosApiService', [
      'actualizarEstadoCuadrante',
      'guardarCeldaCuadrante',
      'guardarLoteCuadrante',
      'getEstadoGlobalCuadrantes',
    ]);
    apiSpy.actualizarEstadoCuadrante.and.returnValue(of({ ok: true }));
    apiSpy.guardarCeldaCuadrante.and.returnValue(of({ ok: true }));
    apiSpy.guardarLoteCuadrante.and.returnValue(of({ ok: true }));

    TestBed.configureTestingModule({
      providers: [{ provide: TurnosApiService, useValue: apiSpy }],
    });

    catalogos = TestBed.inject(CatalogosSsoStore);
    store = TestBed.inject(CuadranteStore);

    catalogos.anioSeleccionado.set(2026);
    catalogos.mesSeleccionado.set(11);
    catalogos.establecerSesionBasicaSso({
      empleadoId: emp1.id,
      documento: emp1.documento,
      nombre: emp1.nombre,
      categoria: emp1.categoria,
      rol: 'COORDINADOR',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg', 'srv-mat'],
    });
    catalogos.aplicarServiciosDesdeDb([srvUrg, srvMat]);
    catalogos.servicioSeleccionadoId.set('srv-urg');
    catalogos.aplicarEmpleadosDesdeDb([
      {
        id: emp1.id,
        documento: emp1.documento,
        nombre: emp1.nombre,
        categoria: { nombre: emp1.categoria },
        servicioBaseId: emp1.servicioBaseId,
        horasContratoMes: emp1.horasContratoMes,
      },
    ]);
  });

  afterEach(() => {
    localStorage.removeItem('rafa_turnos_rotados_servicio');
    FestivosColombiaHelper.limpiarFestivosManualesAnio(2026);
  });

  it('transiciona SIN_PLANIFICAR -> BORRADOR en orden via concatMap, autoasigna S tras G24 y revierte si falla', () => {
    const estado$ = new Subject<any>();
    const celda$ = new Subject<any>();
    const ordenSuscripcion: string[] = [];
    apiSpy.actualizarEstadoCuadrante.and.returnValue(
      defer(() => {
        ordenSuscripcion.push('estado');
        return estado$.asObservable();
      })
    );
    apiSpy.guardarCeldaCuadrante.and.returnValue(
      defer(() => {
        ordenSuscripcion.push('celda');
        return celda$.asObservable();
      })
    );

    expect(store.estadoCuadrante()).toBe('SIN_PLANIFICAR');
    store.aplicarTurnoEnCelda('e1', 5, 'G24', 'Manual');

    expect(store.estadoCuadrante()).toBe('BORRADOR');
    expect(store.asignaciones()['e1'][5].codigo).toBe('G24');
    expect(store.asignaciones()['e1'][6].codigo).toBe('S');
    expect(apiSpy.actualizarEstadoCuadrante).toHaveBeenCalledTimes(1);
    // concatMap: aun no se ha suscrito a guardarCeldaCuadrante hasta que estado$ complete
    expect(ordenSuscripcion).toEqual(['estado']);

    estado$.next({ ok: true });
    estado$.complete();
    expect(ordenSuscripcion).toEqual(['estado', 'celda', 'celda']);

    // Si falla el guardado de celda se revierten asignaciones, estado y pila de deshacer
    celda$.error({ error: { message: 'Error de red' } });
    expect(store.estadoCuadrante()).toBe('SIN_PLANIFICAR');
    expect(store.asignaciones()['e1'][5]).toBeUndefined();
    expect(store.pilaDeshacer().length).toBe(0);
  });

  it('protege novedades oficiales y Celdas Espejo de otro servicio', () => {
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          1: { codigo: 'FAM', servicioEjecutorId: 'srv-urg' },
          2: { codigo: 'M8', servicioEjecutorId: 'srv-mat', esRotacion: true },
        },
      },
    });

    store.aplicarTurnoEnCelda('e1', 1, 'M8', 'Intento');
    expect(store.asignaciones()['e1'][1].codigo).toBe('FAM');

    store.aplicarTurnoEnCelda('e1', 2, 'T8', 'Intento');
    expect(store.asignaciones()['e1'][2].codigo).toBe('M8');
    expect(apiSpy.guardarCeldaCuadrante).not.toHaveBeenCalled();
  });

  it('deshacerUltimaAccion y rehacerUltimaAccion respetan alcance de servicio/periodo y conservan previstoAnterior', () => {
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'PUBLICADO' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: { 10: { codigo: 'M8', previsto: 'M8', servicioEjecutorId: 'srv-urg' } },
      },
    });

    store.aplicarTurnoEnCelda('e1', 10, 'T8', 'Cambio publicado');
    expect(store.asignaciones()['e1'][10].codigo).toBe('T8');
    expect(store.asignaciones()['e1'][10].previsto).toBe('M8');
    expect(store.pilaDeshacer().length).toBe(1);

    // Cambiar de mes bloquea undo porque pertenece a otro periodo
    catalogos.mesSeleccionado.set(12);
    store.deshacerUltimaAccion();
    expect(store.asignacionesPorPeriodo()['2026-11']['e1'][10].codigo).toBe('T8');

    // Al regresar a nov-2026 deshace y luego rehace restaurando previstoAnterior
    catalogos.mesSeleccionado.set(11);
    store.deshacerUltimaAccion();
    expect(store.asignaciones()['e1'][10].codigo).toBe('M8');
    expect(store.asignaciones()['e1'][10].previsto).toBe('M8');
    expect(store.pilaRehacer().length).toBe(1);

    store.rehacerUltimaAccion();
    expect(store.asignaciones()['e1'][10].codigo).toBe('T8');
    expect(store.asignaciones()['e1'][10].previsto).toBe('M8');
    expect(store.pilaDeshacer().length).toBe(1);
  });

  it('detecta infracciones en frontera entre meses (>6 dias continuos) y tope semanal Art. 22 / Art. 165', () => {
    catalogos.anioSeleccionado.set(2026);
    catalogos.mesSeleccionado.set(12); // Diciembre 2026

    // Noviembre 27, 28, 29, 30 trabajados + Diciembre 1, 2, 3 trabajados = 7 dias seguidos
    // + Semana dic 7..13 con 5 x D12 = 60h (> 54h tope semanal)
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          27: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          28: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          29: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          30: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
        },
      },
      '2026-12': {
        e1: {
          1: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          2: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          3: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
          7: { codigo: 'D12', servicioEjecutorId: 'srv-urg' },
          8: { codigo: 'D12', servicioEjecutorId: 'srv-urg' },
          9: { codigo: 'D12', servicioEjecutorId: 'srv-urg' },
          10: { codigo: 'D12', servicioEjecutorId: 'srv-urg' },
          11: { codigo: 'D12', servicioEjecutorId: 'srv-urg' },
        },
      },
    });

    const alertas = store.infraccionesActivas();
    expect(alertas.some((a) => a.dia === 3 && a.mensaje.includes('7 días consecutivos'))).toBeTrue();
    expect(alertas.some((a) => a.mensaje.includes('Excede tope legal de 54h/sem'))).toBeTrue();
  });

  it('propaga saldos continuos entre meses publicados y recalcula HDFD reactivamente con versionCacheFestivos', () => {
    store.estadosPorCuadrante.set({
      'srv-urg::2026-11': 'PUBLICADO',
      'srv-urg::2026-12': 'BORRADOR',
    });
    // Nov: 22 x M8 = 176h vs 168h contrato => diferencia +8h => saldoFinal nov = +8h
    const celdasNov: Record<number, any> = {};
    for (let d = 1; d <= 22; d++) {
      celdasNov[d] = { codigo: 'M8', servicioEjecutorId: 'srv-urg' };
    }
    store.asignacionesPorPeriodo.set({
      '2026-11': { e1: celdasNov },
      '2026-12': { e1: { 18: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } } },
    });

    const mapa = store.mapaSaldosContinuos();
    expect(mapa['e1::2026-11'].saldoFinal).toBe(8);
    expect(mapa['e1::2026-12'].saldoInicial).toBe(8);

    // En nov-2026 hay 6 dom/fest entre 1..22 (1,2,8,15,16,22 => 48h) y 18-nov no es festivo
    catalogos.mesSeleccionado.set(11);
    const hdfdAntes = store.filasServicioCompletas()[0].hdfd;
    expect(hdfdAntes).toBe(48);

    FestivosColombiaHelper.agregarFestivoManual('2026-11-18', 'Aniversario Hospital');
    catalogos.versionCacheFestivos.update((v) => v + 1);

    expect(store.diasDelMes()[17].festivo?.nombre).toBe('Aniversario Hospital');
    expect(store.filasServicioCompletas()[0].hdfd).toBe(hdfdAntes + 8);
  });

  it('revierte estado y saldos consolidados si cambiarEstadoCuadrante falla al persistir', () => {
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    apiSpy.actualizarEstadoCuadrante.and.returnValue(throwError(() => ({ error: { message: 'Fallo BD' } })));

    store.cambiarEstadoCuadrante();
    expect(store.estadoCuadrante()).toBe('BORRADOR');
    expect(Object.keys(store.saldosConsolidadosMap()).length).toBe(0);
  });
});
