import { TestBed } from '@angular/core/testing';
import { defer, of, Subject, throwError } from 'rxjs';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import { CATALOGO_TURNOS, EmpleadoHospital, ServicioHospitalario } from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { CatalogosSsoStore } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';
import { NotificacionStore } from './notificacion.store';

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
      'guardarNotaCelda',
      'alternarFijacionCelda',
      'asignarApoyoDiaCelda',
      'guardarBreakCelda',
    ]);
    apiSpy.actualizarEstadoCuadrante.and.returnValue(of({ ok: true }));
    apiSpy.guardarCeldaCuadrante.and.returnValue(of({ ok: true }));
    apiSpy.guardarLoteCuadrante.and.returnValue(of({ ok: true }));
    apiSpy.guardarNotaCelda.and.returnValue(of({ ok: true, id: 'asig-1', nota: null }));
    apiSpy.alternarFijacionCelda.and.returnValue(of({ ok: true, id: 'asig-1', fijada: true }));
    apiSpy.guardarBreakCelda.and.returnValue(
      of({ ok: true, id: 'asig-1', breakTandaOrden: 1, breakInicio: '12:00', breakFin: '13:00' })
    );
    apiSpy.asignarApoyoDiaCelda.and.returnValue(
      of({ ok: true, id: 'asig-1', servicioEjecutorId: 'srv-mat', esRotacion: true, codigo: 'M8' })
    );
    apiSpy.getEstadoGlobalCuadrantes.and.returnValue(
      of({ anio: 2026, estados: {}, asignacionesPorPeriodo: {}, saldosConsolidados: {} })
    );

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

  it('propaga saldos continuos por días hábiles entre meses publicados y recalcula HDFD y meta con festivos', () => {
    store.estadosPorCuadrante.set({
      'srv-urg::2026-11': 'PUBLICADO',
      'srv-urg::2026-12': 'BORRADOR',
    });
    // Nov 2026: 23 días hábiles * 42h / 6 = 161h meta nominal. 22 x M8 = 176h => diferencia +15h
    const celdasNov: Record<number, any> = {};
    for (let d = 1; d <= 22; d++) {
      celdasNov[d] = { codigo: 'M8', servicioEjecutorId: 'srv-urg' };
    }
    store.asignacionesPorPeriodo.set({
      '2026-11': { e1: celdasNov },
      '2026-12': { e1: { 18: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } } },
    });

    const mapa = store.mapaSaldosContinuos();
    expect(mapa['e1::2026-11'].saldoFinal).toBe(15);
    expect(mapa['e1::2026-12'].saldoInicial).toBe(15);

    // En nov-2026 hay 6 dom/fest entre 1..22 (1,2,8,15,16,22 => 48h) y 18-nov no es festivo
    catalogos.mesSeleccionado.set(11);
    const filaAntes = store.filasServicioCompletas()[0];
    const hdfdAntes = filaAntes.hdfd;
    expect(hdfdAntes).toBe(48);
    expect(filaAntes.diasHabilesMes).toBe(23);

    FestivosColombiaHelper.agregarFestivoManual('2026-11-18', 'Aniversario Hospital');
    catalogos.versionCacheFestivos.update((v) => v + 1);

    const filaDespues = store.filasServicioCompletas()[0];
    expect(store.diasDelMes()[17].festivo?.nombre).toBe('Aniversario Hospital');
    expect(filaDespues.hdfd).toBe(hdfdAntes + 8);
    expect(filaDespues.diasHabilesMes).toBe(22);
    expect(filaDespues.horasContratadasNominales).toBe(154);
  });

  it('calcula Esquema B de cobertura por turno (ROJO, AMARILLO, VERDE y exceso) y detecta empresas PENDIENTE_REGLAS', () => {
    catalogos.aplicarServiciosDesdeDb([
      {
        ...srvUrg,
        metasPorTurno: [
          {
            codigoTurno: 'M8',
            nombreTurno: 'Mañana 8h',
            habilitado: true,
            minimoBase: 2,
            esperadoBase: 3,
            minimoDomFest: 1,
            esperadoDomFest: 2,
          },
        ],
      },
      srvMat,
    ]);
    catalogos.aplicarEmpresasDesdeDb([
      {
        id: 'emp-pend',
        codigo: 'NUEVA_SAS',
        nombre: 'Operador Pendiente',
        estadoConfiguracion: 'PENDIENTE_REGLAS',
        plantillaNormativa: 'CST_LEY_2466',
        horasSemanalesContrato: 42,
        diasBaseSemana: 6,
        horaInicioNocturnoMin: 1140,
        horaFinNocturnoMin: 360,
        porcentajeRecargoNocturno: 0.35,
        modoRecargoDominical: 'LEY_2466',
        aplicaTopeHorasExtrasSemanal: true,
        topeHorasExtrasSemanal: 12,
        usaBancoHoras: true,
        activa: true,
      },
    ]);
    catalogos.aplicarEmpleadosDesdeDb([
      {
        id: 'e1',
        documento: '101',
        nombre: 'Ana',
        categoria: { nombre: 'Enfermero(a) Jefe' },
        servicioBaseId: 'srv-urg',
        empresaContratanteId: 'emp-pend',
        horasContratoMes: 161,
      },
      { id: 'e2', documento: '102', nombre: 'Luis', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg', horasContratoMes: 161 },
      { id: 'e3', documento: '103', nombre: 'Rosa', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg', horasContratoMes: 161 },
      { id: 'e4', documento: '104', nombre: 'Juan', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg', horasContratoMes: 161 },
    ]);

    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: { 3: { codigo: 'M8', servicioEjecutorId: 'srv-urg' }, 4: { codigo: 'M8', servicioEjecutorId: 'srv-urg' }, 5: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } },
        e2: { 4: { codigo: 'M8', servicioEjecutorId: 'srv-urg' }, 5: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } },
        e3: { 5: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } },
        e4: { 5: { codigo: 'M8', servicioEjecutorId: 'srv-urg' } },
      },
    });

    const resCob = store.resumenCoberturaPorTurnoYDia();
    const filaM8 = resCob.filasTurnos.find((f) => f.codigoTurno === 'M8')!;
    expect(filaM8.dias[3].estado).toBe('ROJO');     // 1 < min 2
    expect(filaM8.dias[4].estado).toBe('AMARILLO'); // min 2 <= 2 < esp 3
    expect(filaM8.dias[5].estado).toBe('VERDE');    // 4 >= esp 3
    expect(filaM8.dias[5].exceso).toBe(1);          // +1 adicional

    expect(store.empresasPendientesEnCuadrante().map((e) => e.codigo)).toEqual(['NUEVA_SAS']);
  });

  it('revierte estado y saldos consolidados si cambiarEstadoCuadrante falla al persistir', () => {
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    apiSpy.actualizarEstadoCuadrante.and.returnValue(throwError(() => ({ error: { message: 'Fallo BD' } })));

    store.cambiarEstadoCuadrante();
    expect(store.estadoCuadrante()).toBe('BORRADOR');
    expect(Object.keys(store.saldosConsolidadosMap()).length).toBe(0);
  });

  it('protege celdas fijadas 📌 ante edición manual, limpieza completa y Ctrl+Z / Ctrl+Y', () => {
    const notificacion = TestBed.inject(NotificacionStore);
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          5: { codigo: 'M8', previsto: 'M8', servicioEjecutorId: 'srv-urg' },
          6: { codigo: 'T8', previsto: 'T8', servicioEjecutorId: 'srv-urg', fijada: true },
        },
      },
    });

    // Intentar modificar una celda fijada no llama al API y mantiene T8
    store.aplicarTurnoEnCelda('e1', 6, 'N12', 'Edicion accidental');
    expect(store.asignaciones()['e1'][6].codigo).toBe('T8');
    expect(apiSpy.guardarCeldaCuadrante).not.toHaveBeenCalled();

    // Editar celda 5 -> N12, luego fijarla -> Ctrl+Z no debe tocar celda 5 mientras siga fijada
    store.aplicarTurnoEnCelda('e1', 5, 'N12', 'Cambio normal');
    expect(store.asignaciones()['e1'][5].codigo).toBe('N12');
    apiSpy.alternarFijacionCelda.and.returnValue(of({ ok: true, id: 'c5', fijada: true }));
    store.alternarFijacionCelda('e1', 5, true, 'Bloqueo jefe');
    expect(store.asignaciones()['e1'][5].fijada).toBeTrue();

    store.deshacerUltimaAccion();
    expect(store.asignaciones()['e1'][5].codigo).toBe('N12');
    expect(store.pilaDeshacer().length).toBe(1);

    // Limpiar cuadrante omite las celdas fijadas 5 y 6 y no invoca guardarLoteCuadrante
    store.limpiarCuadranteCompleto();
    notificacion.ejecutarConfirmacion();
    expect(store.asignaciones()['e1'][5].codigo).toBe('N12');
    expect(store.asignaciones()['e1'][6].codigo).toBe('T8');
    expect(apiSpy.guardarLoteCuadrante).not.toHaveBeenCalled();
  });

  it('gestiona nota de celda (con rollback si falla API), fijación y apoyo puntual inter-servicios', () => {
    const eventosHistorial: Array<{ empId?: string; dia?: number }> = [];
    const sub = store.celdaHistorialActualizada$.subscribe((ev) => eventosHistorial.push(ev));

    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'PUBLICADO' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          8: { codigo: 'M8', previsto: 'M8', servicioEjecutorId: 'srv-urg' },
          9: { codigo: 'T8', previsto: 'M8', servicioEjecutorId: 'srv-urg' },
        },
      },
    });

    // 1. Guardar nota preserva turno y emite celdaHistorialActualizada$
    apiSpy.guardarNotaCelda.and.returnValue(of({ ok: true, id: 'asig-8', nota: 'Relevo 10:00 AM' }));
    store.guardarNotaCelda('e1', 8, '  Relevo 10:00 AM  ');
    expect(store.asignaciones()['e1'][8].codigo).toBe('M8');
    expect(store.asignaciones()['e1'][8].nota).toBe('Relevo 10:00 AM');
    expect(eventosHistorial).toContain(jasmine.objectContaining({ empId: 'e1', dia: 8 }));

    // 2. Rollback de nota si falla el API
    apiSpy.guardarNotaCelda.and.returnValue(throwError(() => ({ error: { message: 'Fallo guardar nota' } })));
    store.guardarNotaCelda('e1', 8, 'Nueva nota fallida');
    expect(store.asignaciones()['e1'][8].nota).toBe('Relevo 10:00 AM');

    // 3. Toggle de fijación alterna correctamente y emite historial
    apiSpy.alternarFijacionCelda.and.returnValue(of({ ok: true, id: 'asig-8', fijada: true }));
    store.alternarFijacionCelda('e1', 8, undefined, 'Turno fijo confirmado');
    expect(store.asignaciones()['e1'][8].fijada).toBeTrue();

    // 4. Apoyo puntual inter-servicio actualiza servicioEjecutorId, esRotacion y rotados del servicio destino
    apiSpy.asignarApoyoDiaCelda.and.returnValue(
      of({
        ok: true,
        id: 'asig-8',
        servicioEjecutorId: 'srv-mat',
        esRotacion: true,
        codigo: 'M8',
      })
    );
    store.asignarApoyoDiaCelda('e1', 8, 'srv-mat', 'M8', 'Refuerzo partos');
    expect(store.asignaciones()['e1'][8].servicioEjecutorId).toBe('srv-mat');
    expect(store.asignaciones()['e1'][8].esRotacion).toBeTrue();
    expect(store.empleadosRotadosPorServicio()['srv-mat']).toContain('e1');

    // 5. Revertir a previsto envía origenAccion: 'INSPECTOR'
    store.revertirCeldaAPrevisto('e1', 9, 'Regresar a programación inicial');
    expect(store.asignaciones()['e1'][9].codigo).toBe('M8');
    expect(apiSpy.guardarCeldaCuadrante).toHaveBeenCalledWith(
      jasmine.objectContaining({
        empleadoId: 'e1',
        dia: 9,
        codigo: 'M8',
        origenAccion: 'INSPECTOR',
        justificacion: 'Regresar a programación inicial',
      })
    );

    sub.unsubscribe();
  });

  it('expone horasContratadasEfectivas y horasExoneradasMes en empleadosConSaldoActualizado segun prorrateo de ausencias', () => {
    // Noviembre 2026: dia 3 es martes habil
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          3: { codigo: 'VAC', servicioEjecutorId: 'srv-urg' },
        },
      },
    });

    const empActualizado = store.empleadosConSaldoActualizado().find((e) => e.id === 'e1');
    expect(empActualizado).toBeDefined();
    expect(empActualizado!.horasContratoMes).toBeGreaterThan(0);
    expect(empActualizado!.diasProrrateadosMes).toBe(1);
    expect(empActualizado!.horasExoneradasMes).toBeGreaterThan(0);
    expect(empActualizado!.horasContratadasEfectivas).toBe(
      Number((empActualizado!.horasContratoMes - empActualizado!.horasExoneradasMes!).toFixed(2))
    );
  });

  it('expone saldoBancoAnterior y saldoBancoActual diferenciado segun actividad y estado del cuadrante', () => {
    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          2: { codigo: 'M8', servicioEjecutorId: 'srv-urg' },
        },
      },
    });

    let emp = store.empleadosConSaldoActualizado().find((e) => e.id === 'e1')!;
    expect(emp.saldoBancoAnterior).toBe(0);
    expect(emp.tieneActividadMes).toBeTrue();
    expect(emp.cuadranteMesConsolidado).toBeFalse();
    expect(emp.saldoBancoActual).toBeLessThan(0);
    expect(emp.saldoBancoDiferenciaMes).toBe(emp.saldoBancoActual);

    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'PUBLICADO' });
    emp = store.empleadosConSaldoActualizado().find((e) => e.id === 'e1')!;
    expect(emp.cuadranteMesConsolidado).toBeTrue();
  });

  it('cambia tanda de break (con rollback y proteccion fijada), detecta traslapes de simultaneidad y rebalancea el dia', () => {
    const turnoTandas = {
      ...CATALOGO_TURNOS['ADM'],
      codigo: 'ADM_B',
      nombre: 'Admin Tandas',
      recesoHabilitado: true,
      recesoRemunerado: false,
      recesoMaxSimultaneos: 1,
      recesoTandasJson: [
        { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', duracionMin: 60 },
        { orden: 2, etiqueta: 'T2', inicio: '13:00', fin: '14:00', duracionMin: 60 },
      ],
    };
    catalogos.aplicarCatalogoTurnosDesdeDb([
      ...Object.values(CATALOGO_TURNOS),
      turnoTandas,
    ]);
    catalogos.aplicarServiciosDesdeDb([
      { ...srvUrg, turnosHabilitados: ['M8', 'T8', 'ADM_B', 'L'] },
      srvMat,
    ]);
    catalogos.aplicarEmpleadosDesdeDb([
      { id: 'e1', documento: '101', nombre: 'Ana', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg', horasContratoMes: 168 },
      { id: 'e2', documento: '102', nombre: 'Luis', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg', horasContratoMes: 168 },
    ]);

    store.estadosPorCuadrante.set({ 'srv-urg::2026-11': 'BORRADOR' });
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          10: { codigo: 'ADM_B', previsto: 'ADM_B', servicioEjecutorId: 'srv-urg', breakTandaOrden: 1, breakInicio: '12:00', breakFin: '13:00' },
        },
        e2: {
          10: { codigo: 'ADM_B', previsto: 'ADM_B', servicioEjecutorId: 'srv-urg', breakTandaOrden: 1, breakInicio: '12:00', breakFin: '13:00', fijada: true },
        },
      },
    });

    // Ambos en T1 cuando maxSimultaneos=1 -> alerta de simultaneidad en servicio y dia 10
    const sim = store.resumenSimultaneidadBreaks();
    expect(sim.totalAlertas).toBe(1);
    expect(sim.alertasPorDia[10].length).toBe(1);
    expect(sim.alertasPorDia[10][0].asignados).toBe(2);

    // e2 fijada no se puede cambiar manualmente
    store.cambiarBreakCelda('e2', 10, 2);
    expect(apiSpy.guardarBreakCelda).not.toHaveBeenCalled();

    // Si falla API en e1 -> revierte breakTandaOrden a 1
    apiSpy.guardarBreakCelda.and.returnValue(throwError(() => ({ error: { message: 'Fallo break' } })));
    store.cambiarBreakCelda('e1', 10, 2);
    expect(store.asignaciones()['e1'][10].breakTandaOrden).toBe(1);

    // Si API responde OK en e1 -> pasa a T2 y desaparece la alerta
    apiSpy.guardarBreakCelda.and.returnValue(
      of({ ok: true, id: 'asig-1', breakTandaOrden: 2, breakInicio: '13:00', breakFin: '14:00' })
    );
    store.cambiarBreakCelda('e1', 10, 2);
    expect(store.asignaciones()['e1'][10].breakTandaOrden).toBe(2);
    expect(store.asignaciones()['e1'][10].breakInicio).toBe('13:00');
    expect(store.resumenSimultaneidadBreaks().totalAlertas).toBe(0);

    // Rebalancear dia cuando ambos vuelven a T1 (con e2 fijada en T1) -> mueve e1 a T2 via guardarLoteCuadrante
    store.asignacionesPorPeriodo.set({
      '2026-11': {
        e1: {
          10: { codigo: 'ADM_B', previsto: 'ADM_B', servicioEjecutorId: 'srv-urg', breakTandaOrden: 1, breakInicio: '12:00', breakFin: '13:00' },
        },
        e2: {
          10: { codigo: 'ADM_B', previsto: 'ADM_B', servicioEjecutorId: 'srv-urg', breakTandaOrden: 1, breakInicio: '12:00', breakFin: '13:00', fijada: true },
        },
      },
    });
    store.rebalancearBreaksDia(10, 'ADM_B');
    expect(store.asignaciones()['e2'][10].breakTandaOrden).toBe(1);
    expect(store.asignaciones()['e1'][10].breakTandaOrden).toBe(2);
    expect(apiSpy.guardarLoteCuadrante).toHaveBeenCalledWith(
      jasmine.objectContaining({
        origenAccion: 'BALANCEAR_BREAKS',
        celdas: [
          jasmine.objectContaining({
            empleadoId: 'e1',
            dia: 10,
            breakTandaOrden: 2,
            breakInicio: '13:00',
            breakFin: '14:00',
          }),
        ],
      })
    );
  });
});
