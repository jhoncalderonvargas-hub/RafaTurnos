import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PermutaItem } from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { CatalogosSsoStore } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';
import { NotificacionStore } from './notificacion.store';
import { PermutasAuditoriaStore } from './permutas-auditoria.store';

describe('PermutasAuditoriaStore', () => {
  let store: PermutasAuditoriaStore;
  let catalogos: CatalogosSsoStore;
  let cuadrante: CuadranteStore;
  let notificacion: NotificacionStore;
  let apiSpy: jasmine.SpyObj<TurnosApiService>;

  const makePermuta = (overrides: Partial<PermutaItem> = {}): PermutaItem => ({
    id: 'perm-1',
    fechaSolicitud: '2026-11-10',
    solicitanteId: 'emp-1',
    solicitanteNombre: 'Ana',
    receptorId: 'emp-2',
    receptorNombre: 'Luis',
    categoria: 'Enfermero(a) Jefe',
    servicioId: 'srv-urg',
    anio: 2026,
    mes: 11,
    diaOrigen: 5,
    turnoOrigen: 'M8',
    diaDestino: 5,
    turnoDestino: 'N12',
    estado: 'PENDIENTE_PAR',
    validacionReglas: 'OK',
    ...overrides,
  });

  beforeEach(() => {
    apiSpy = jasmine.createSpyObj<TurnosApiService>('TurnosApiService', [
      'getPermutas',
      'crearPermuta',
      'aceptarPermutaPar',
      'rechazarPermutaPar',
      'aprobarPermuta',
      'rechazarPermuta',
      'obtenerAuditorias',
    ]);
    apiSpy.getPermutas.and.returnValue(of([]));
    apiSpy.obtenerAuditorias.and.returnValue(of([]));

    TestBed.configureTestingModule({
      providers: [{ provide: TurnosApiService, useValue: apiSpy }],
    });

    catalogos = TestBed.inject(CatalogosSsoStore);
    cuadrante = TestBed.inject(CuadranteStore);
    notificacion = TestBed.inject(NotificacionStore);
    store = TestBed.inject(PermutasAuditoriaStore);

    catalogos.aplicarServiciosDesdeDb([
      { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias', tipoAsistencia: 'URGENCIAS', reqDia: 1, reqNoche: 1 },
      { id: 'srv-uci', codigo: 'UCI', nombre: 'UCI', tipoAsistencia: 'CUIDADOS_INTENSIVOS', reqDia: 1, reqNoche: 1 },
    ]);
    catalogos.aplicarEmpleadosDesdeDb([
      { id: 'emp-1', documento: '101', nombre: 'Ana', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg' },
      { id: 'emp-2', documento: '102', nombre: 'Luis', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg' },
      { id: 'emp-3', documento: '103', nombre: 'Dr. Perez', categoria: { nombre: 'Médico General' }, servicioBaseId: 'srv-urg' },
    ]);
  });

  it('no muta listaPermutas en error al aceptar/rechazar y sincroniza desde backend; si tiene exito actualiza estado', () => {
    const inicial = [makePermuta()];
    store.listaPermutas.set(inicial);
    apiSpy.getPermutas.and.returnValue(of(inicial));

    apiSpy.aceptarPermutaPar.and.returnValue(throwError(() => ({ error: { message: 'Conflicto HTTP 409' } })));
    store.aceptarPropuestaPar('perm-1');
    expect(store.listaPermutas()[0].estado).toBe('PENDIENTE_PAR');
    expect(notificacion.mensajeToast()).toContain('Conflicto HTTP 409');
    expect(apiSpy.getPermutas).toHaveBeenCalledTimes(1);

    apiSpy.rechazarPermutaPar.and.returnValue(throwError(() => ({ error: { message: 'Fallo rechazo par' } })));
    store.rechazarPropuestaPar({ id: 'perm-1', motivo: 'No puedo' });
    expect(store.listaPermutas()[0].estado).toBe('PENDIENTE_PAR');
    expect(apiSpy.getPermutas).toHaveBeenCalledTimes(2);

    apiSpy.rechazarPermuta.and.returnValue(throwError(() => ({ error: { message: 'Fallo rechazo sup' } })));
    store.rechazarPermuta('perm-1');
    expect(store.listaPermutas()[0].estado).toBe('PENDIENTE_PAR');
    expect(apiSpy.getPermutas).toHaveBeenCalledTimes(3);

    // Flujo exitoso aceptarPar -> aprobarPermuta con actualizacion del cuadrante
    apiSpy.aceptarPermutaPar.and.returnValue(of({ ok: true }));
    store.aceptarPropuestaPar('perm-1');
    expect(store.listaPermutas()[0].estado).toBe('PENDIENTE_SUPERVISOR');

    cuadrante.asignacionesPorPeriodo.set({
      '2026-11': {
        'emp-1': { 5: { codigo: 'M8', previsto: 'M8', servicioEjecutorId: 'srv-urg' } },
        'emp-2': { 5: { codigo: 'N12', previsto: 'N12', servicioEjecutorId: 'srv-urg' } },
      },
    });
    apiSpy.aprobarPermuta.and.returnValue(
      of({
        cambiosAplicados: [
          { empleadoId: 'emp-1', anio: 2026, mes: 11, dia: 5, codigo: 'N12' },
          { empleadoId: 'emp-2', anio: 2026, mes: 11, dia: 5, codigo: 'M8' },
        ],
      })
    );

    store.aprobarPermuta('perm-1');
    expect(store.listaPermutas()[0].estado).toBe('APROBADA');
    expect(cuadrante.asignacionesPorPeriodo()['2026-11']['emp-1'][5].codigo).toBe('N12');
    expect(cuadrante.asignacionesPorPeriodo()['2026-11']['emp-2'][5].codigo).toBe('M8');
    expect(apiSpy.obtenerAuditorias).toHaveBeenCalled();
  });

  it('valida RN-05 mismo cargo, bloqueo novedades FAM/VAC y empalme del dia 1 con contexto explicito', () => {
    const resCargo = store.validarReglasPermuta('emp-1', 'emp-3', 5, 'M8', 'T8');
    expect(resCargo.valida).toBeFalse();
    expect(resCargo.motivo).toContain('RN-05');

    const resFam = store.validarReglasPermuta('emp-1', 'emp-2', 5, 'FAM', 'M8');
    expect(resFam.valida).toBeFalse();

    const resIguales = store.validarReglasPermuta('emp-1', 'emp-2', 5, 'M8', 'M8');
    expect(resIguales.valida).toBeFalse();

    // Contexto explicito en Diciembre 2026: emp-1 cerro Nov 30 en G24 -> bloquea recibir M8 el 1-dic
    cuadrante.asignacionesPorPeriodo.set({
      '2026-11': {
        'emp-1': { 30: { codigo: 'G24', servicioEjecutorId: 'srv-urg' } },
      },
    });
    const resDia1 = store.validarReglasPermuta('emp-1', 'emp-2', 1, 'S', 'M8', {
      anio: 2026,
      mes: 12,
      matriz: {
        'emp-1': { 1: { codigo: 'S' } },
        'emp-2': { 1: { codigo: 'M8' } },
      },
      totalDias: 31,
    });
    expect(resDia1.valida).toBeFalse();
    expect(resDia1.motivo).toContain('G24');

    // Caso valido en contexto explicito
    const resValida = store.validarReglasPermuta('emp-1', 'emp-2', 10, 'M8', 'T8', {
      anio: 2026,
      mes: 12,
      matriz: {
        'emp-1': { 10: { codigo: 'M8' } },
        'emp-2': { 10: { codigo: 'T8' } },
      },
      totalDias: 31,
    });
    expect(resValida.valida).toBeTrue();
  });

  it('filtra notificacionesSolicitudesCount y permutasVisiblesDashboard segun rol RBAC', () => {
    store.listaPermutas.set([
      makePermuta({ id: 'p1', estado: 'PENDIENTE_PAR', solicitanteId: 'emp-1', receptorId: 'emp-2', servicioId: 'srv-urg' }),
      makePermuta({ id: 'p2', estado: 'PENDIENTE_SUPERVISOR', solicitanteId: 'emp-1', receptorId: 'emp-3', servicioId: 'srv-urg' }),
      makePermuta({ id: 'p3', estado: 'PENDIENTE_SUPERVISOR', solicitanteId: 'emp-4', receptorId: 'emp-5', servicioId: 'srv-uci' }),
    ]);

    catalogos.establecerSesionBasicaSso({
      empleadoId: 'emp-2',
      documento: '102',
      nombre: 'Luis',
      categoria: 'Enfermero(a) Jefe',
      rol: 'COLABORADOR',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg'],
    });
    expect(store.notificacionesSolicitudesCount()).toBe(1); // Solo p1 donde emp-2 es receptor PENDIENTE_PAR

    catalogos.establecerSesionBasicaSso({
      empleadoId: 'emp-coord',
      documento: '200',
      nombre: 'Coord',
      categoria: 'Enfermero(a) Jefe',
      rol: 'COORDINADOR',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg'],
    });
    expect(store.permutasVisiblesDashboard().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(store.notificacionesSolicitudesCount()).toBe(1); // Solo p2 de srv-urg en PENDIENTE_SUPERVISOR
  });
});
