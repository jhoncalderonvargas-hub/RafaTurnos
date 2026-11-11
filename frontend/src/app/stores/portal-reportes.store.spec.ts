import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TurnosApiService } from '../turnos-api.service';
import { CatalogosSsoStore } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';
import { PortalReportesStore } from './portal-reportes.store';

describe('PortalReportesStore', () => {
  let store: PortalReportesStore;
  let catalogos: CatalogosSsoStore;
  let cuadrante: CuadranteStore;
  let apiSpy: jasmine.SpyObj<TurnosApiService>;

  beforeEach(() => {
    apiSpy = jasmine.createSpyObj<TurnosApiService>('TurnosApiService', [
      'crearPermuta',
      'obtenerEnlaceCalendarioIcal',
    ]);
    apiSpy.crearPermuta.and.returnValue(
      of({
        id: 'perm-new',
        fechaSolicitud: '2026-11-10',
        solicitanteId: 'emp-1',
        solicitanteNombre: 'Ana',
        receptorId: 'emp-mat',
        receptorNombre: 'Elena',
        categoria: 'Enfermero(a) Jefe',
        servicioId: 'srv-mat',
        anio: 2026,
        mes: 10,
        diaOrigen: 5,
        turnoOrigen: 'M8',
        diaDestino: 5,
        turnoDestino: 'T8',
        estado: 'PENDIENTE_PAR',
        validacionReglas: 'OK',
      })
    );

    TestBed.configureTestingModule({
      providers: [{ provide: TurnosApiService, useValue: apiSpy }],
    });

    catalogos = TestBed.inject(CatalogosSsoStore);
    cuadrante = TestBed.inject(CuadranteStore);
    store = TestBed.inject(PortalReportesStore);

    catalogos.anioSeleccionado.set(2026);
    catalogos.mesSeleccionado.set(11);
    catalogos.aplicarServiciosDesdeDb([
      { id: 'srv-urg', codigo: 'URG', nombre: 'Urgencias', tipoAsistencia: 'URGENCIAS', reqDia: 1, reqNoche: 1 },
      { id: 'srv-mat', codigo: 'MAT', nombre: 'Maternidad', tipoAsistencia: 'URGENCIAS', reqDia: 1, reqNoche: 0 },
    ]);
    catalogos.aplicarEmpleadosDesdeDb([
      { id: 'emp-1', documento: '101', nombre: 'Ana', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg' },
      { id: 'emp-2', documento: '102', nombre: 'Carlos', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-urg' },
      { id: 'emp-mat', documento: '103', nombre: 'Elena', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-mat' },
      { id: 'emp-mat-vac', documento: '104', nombre: 'Sofia', categoria: { nombre: 'Enfermero(a) Jefe' }, servicioBaseId: 'srv-mat' },
    ]);
  });

  it('usa el ultimo mes PUBLICADO/CERRADO en mesSeleccionadoPortal cuando el mes activo esta en BORRADOR', () => {
    store.empleadoPortalId.set('emp-1');
    cuadrante.estadosPorCuadrante.set({
      'srv-urg::2026-9': 'CERRADO_NOMINA',
      'srv-urg::2026-10': 'PUBLICADO',
      'srv-urg::2026-11': 'BORRADOR',
    });

    expect(store.mesesDisponiblesPortal().map((m) => m.valor)).toEqual([9, 10]);
    expect(store.mesSeleccionadoPortal()).toBe(10);

    cuadrante.estadosPorCuadrante.set({
      'srv-urg::2026-10': 'PUBLICADO',
      'srv-urg::2026-11': 'PUBLICADO',
    });
    expect(store.mesSeleccionadoPortal()).toBe(11);
  });

  it('sigue servicioEjecutorId en rotaciones, filtra pares disponibles y envia permuta con periodo del portal', () => {
    store.empleadoPortalId.set('emp-1');
    store.diaPermutaSeleccionado.set(5);
    cuadrante.estadosPorCuadrante.set({
      'srv-urg::2026-10': 'PUBLICADO',
      'srv-urg::2026-11': 'BORRADOR',
    });
    cuadrante.asignacionesPorPeriodo.set({
      '2026-10': {
        'emp-1': { 5: { codigo: 'M8', servicioEjecutorId: 'srv-mat', esRotacion: true } },
        'emp-mat': { 5: { codigo: 'T8', servicioEjecutorId: 'srv-mat' } },
        'emp-mat-vac': { 5: { codigo: 'VAC', servicioEjecutorId: 'srv-mat' } },
      },
    });

    const srvDia = store.servicioDiaSeleccionadoPortal();
    expect(srvDia.id).toBe('srv-mat');
    expect(srvDia.esRotacion).toBeTrue();

    const pares = store.companerosParesPortal();
    expect(pares.map((p) => p.id)).toEqual(['emp-mat']); // emp-mat-vac excluida por VAC, emp-2 por no ser de srv-mat

    store.companeroPermutaId.set('emp-mat');
    store.enviarSolicitudPermutaDesdePortal();

    expect(apiSpy.crearPermuta).toHaveBeenCalledWith(
      jasmine.objectContaining({
        solicitanteId: 'emp-1',
        receptorId: 'emp-mat',
        servicioId: 'srv-mat',
        anio: 2026,
        mes: 10,
        diaOrigen: 5,
        turnoOrigen: 'M8',
        turnoDestino: 'T8',
      })
    );
  });

  it('restringe datosReporteCalculados segun rol SSO (COLABORADOR vacio, COORDINADOR por alcance, ADMIN_TH global)', () => {
    catalogos.establecerSesionBasicaSso({
      empleadoId: 'emp-1',
      documento: '101',
      nombre: 'Ana',
      categoria: 'Enfermero(a) Jefe',
      rol: 'COLABORADOR',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg'],
    });
    expect(store.datosReporteCalculados()).toEqual([]);

    catalogos.establecerSesionBasicaSso({
      empleadoId: 'emp-1',
      documento: '101',
      nombre: 'Ana',
      categoria: 'Enfermero(a) Jefe',
      rol: 'COORDINADOR',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg'],
    });
    store.filtroReporteServicioId.set('TODOS');
    expect(store.datosReporteCalculados().every((f) => f.emp.servicioBaseId === 'srv-urg')).toBeTrue();
    expect(store.datosReporteCalculados().length).toBe(2);

    catalogos.establecerSesionBasicaSso({
      empleadoId: 'emp-th',
      documento: '999',
      nombre: 'TH',
      categoria: 'Enfermero(a) Jefe',
      rol: 'ADMIN_TH',
      servicioBaseId: 'srv-urg',
      servicioBaseNombre: 'Urgencias',
      serviciosPermitidosIds: ['srv-urg', 'srv-mat'],
    });
    expect(store.datosReporteCalculados().length).toBe(4);
  });

  it('habilita companerosParesPortal multi-cargo en servicios equivalentes y filtra reportes por empresa contratante', () => {
    catalogos.aplicarEmpresasDesdeDb([
      {
        id: 'emp-ese',
        codigo: 'ESE_PLANTA',
        nombre: 'Planta ESE',
        estadoConfiguracion: 'CONFIRMADA',
        plantillaNormativa: 'DECRETO_1042',
        horasSemanalesContrato: 44,
        diasBaseSemana: 6,
        horaInicioNocturnoMin: 1080,
        horaFinNocturnoMin: 360,
        porcentajeRecargoNocturno: 0.35,
        modoRecargoDominical: 'FIJO',
        porcentajeRecargoDominicalFijo: 1.0,
        aplicaTopeHorasExtrasSemanal: true,
        topeHorasExtrasSemanal: 12,
        usaBancoHoras: true,
        activa: true,
      },
      {
        id: 'emp-temp',
        codigo: 'TEMP_SALUD',
        nombre: 'Temporal Salud',
        estadoConfiguracion: 'CONFIRMADA',
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
    catalogos.aplicarServiciosDesdeDb([
      {
        id: 'srv-fact',
        codigo: 'FACT',
        nombre: 'Facturación',
        tipoAsistencia: 'ADMINISTRATIVO',
        permitePermutaEntreCargos: true,
        cargosPermitidosIds: ['cat-aux', 'cat-tec'],
        cargosPermitidos: [
          { categoriaId: 'cat-aux', categoriaNombre: 'Auxiliar' },
          { categoriaId: 'cat-tec', categoriaNombre: 'Técnico' },
        ],
        reqDia: 2,
        reqNoche: 0,
      },
    ]);
    catalogos.aplicarEmpleadosDesdeDb([
      {
        id: 'e-ese',
        documento: '401',
        nombre: 'Camila ESE',
        categoriaId: 'cat-aux',
        categoria: { id: 'cat-aux', nombre: 'Auxiliar' },
        servicioBaseId: 'srv-fact',
        empresaContratanteId: 'emp-ese',
      },
      {
        id: 'e-temp',
        documento: '402',
        nombre: 'Diego Temporal',
        categoriaId: 'cat-tec',
        categoria: { id: 'cat-tec', nombre: 'Técnico' },
        servicioBaseId: 'srv-fact',
        empresaContratanteId: 'emp-temp',
      },
      {
        id: 'e-ajeno',
        documento: '403',
        nombre: 'Otro Cargo',
        categoriaId: 'cat-med',
        categoria: { id: 'cat-med', nombre: 'Médico' },
        servicioBaseId: 'srv-fact',
        empresaContratanteId: 'emp-temp',
      },
    ]);

    store.empleadoPortalId.set('e-ese');
    store.diaPermutaSeleccionado.set(4);
    cuadrante.estadosPorCuadrante.set({ 'srv-fact::2026-11': 'PUBLICADO' });
    cuadrante.asignacionesPorPeriodo.set({
      '2026-11': {
        'e-ese': { 4: { codigo: 'M8', servicioEjecutorId: 'srv-fact' } },
        'e-temp': { 4: { codigo: 'T8', servicioEjecutorId: 'srv-fact' } },
        'e-ajeno': { 4: { codigo: 'M8', servicioEjecutorId: 'srv-fact' } },
      },
    });

    expect(store.companerosParesPortal().map((p) => p.id)).toEqual(['e-temp']);

    catalogos.establecerSesionBasicaSso({
      empleadoId: 'th',
      documento: '999',
      nombre: 'TH',
      categoria: 'Talento Humano',
      rol: 'ADMIN_TH',
      servicioBaseId: 'srv-fact',
      servicioBaseNombre: 'Facturación',
      serviciosPermitidosIds: ['srv-fact'],
    });
    store.filtroReporteServicioId.set('TODOS');
    store.filtroReporteEmpresaId.set('TODOS');
    const todasFilas = store.datosReporteCalculados();
    const filaEse = todasFilas.find((f) => f.emp.id === 'e-ese')!;
    const filaTemp = todasFilas.find((f) => f.emp.id === 'e-temp')!;
    expect(filaEse.horasSemanalesAplicadas).toBe(44);
    expect(filaEse.recargos.dominical).toBe(1.0);
    expect(filaTemp.horasSemanalesAplicadas).toBe(42);
    expect(filaTemp.recargos.dominical).toBe(0.9);

    store.filtroReporteEmpresaId.set('emp-ese');
    expect(store.datosReporteCalculados().map((f) => f.emp.id)).toEqual(['e-ese']);
  });
});
