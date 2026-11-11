import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import { ServicioHospitalario } from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { CatalogosSsoStore } from './catalogos-sso.store';

describe('CatalogosSsoStore', () => {
  let store: CatalogosSsoStore;
  let apiSpy: jasmine.SpyObj<TurnosApiService>;

  beforeEach(() => {
    FestivosColombiaHelper.limpiarFestivosManualesAnio(2026);
    apiSpy = jasmine.createSpyObj<TurnosApiService>('TurnosApiService', [
      'getFestivos',
      'agregarDiaCivico',
      'eliminarDiaCivico',
      'enlazarServiciosHermanos',
      'desenlazarServiciosHermanos',
      'guardarTipoTurno',
      'archivarTipoTurno',
      'eliminarTipoTurno',
      'getServicios',
      'crearServicio',
      'actualizarServicio',
      'eliminarServicio',
      'getEmpresas',
      'confirmarReglasEmpresa',
      'getEmpleados',
    ]);
    apiSpy.getEmpresas.and.returnValue(of([]));
    apiSpy.getEmpleados.and.returnValue(of([]));

    TestBed.configureTestingModule({
      providers: [{ provide: TurnosApiService, useValue: apiSpy }],
    });
    store = TestBed.inject(CatalogosSsoStore);
  });

  afterEach(() => {
    FestivosColombiaHelper.limpiarFestivosManualesAnio(2026);
  });

  it('calcula automaticamente horas ordinarias, diurnas y nocturnas segun modoJornada y almuerzo', () => {
    store.turnoFormModoJornada.set('HORARIO');
    store.turnoFormHoraInicio.set('08:00');
    store.turnoFormHoraFin.set('17:00');
    store.turnoFormMinutosAlmuerzo.set(60);

    const calcHorario = store.calculoAutomaticoHorasTurno();
    expect(calcHorario.ordinarias).toBe(8);
    expect(calcHorario.diurnas).toBe(8);
    expect(calcHorario.nocturnas).toBe(0);
    expect(calcHorario.horarioTexto).toBe('08:00 - 17:00');

    store.turnoFormModoJornada.set('GUARDIA_24H');
    store.turnoFormHoraInicio.set('07:00');
    const calc24 = store.calculoAutomaticoHorasTurno();
    expect(calc24.ordinarias).toBe(24);
    expect(calc24.diurnas).toBe(13);
    expect(calc24.nocturnas).toBe(11);
    expect(calc24.horarioTexto).toBe('07:00 - 07:00 (+1)');

    store.turnoFormModoJornada.set('DESCANSO');
    const calcDesc = store.calculoAutomaticoHorasTurno();
    expect(calcDesc.ordinarias).toBe(0);
    expect(calcDesc.diurnas).toBe(0);
    expect(calcDesc.nocturnas).toBe(0);
  });

  it('aplica catalogo desde DB ocultando alias M/T/N/G12 y BLANCO y respetando COMP configurable', () => {
    store.aplicarCatalogoTurnosDesdeDb([
      {
        codigo: 'COMP',
        nombre: 'Compensatorio 4h',
        horaInicio: '00:00',
        horaFin: '00:00',
        horasOrdinarias: 0,
        horasDiurnas: 0,
        horasNocturnas: 0,
        descuentaBancoHoras: true,
        horasAmortizacionBanco: 4,
      },
      {
        codigo: 'M',
        nombre: 'Alias M',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        visibleEnPaleta: true,
      },
      {
        codigo: 'BLANCO',
        nombre: 'Blanco',
        horasOrdinarias: 0,
        horasDiurnas: 0,
        horasNocturnas: 0,
      },
    ]);

    const mapa = store.catalogoTurnosMap();
    expect(mapa['COMP'].horasAmortizacionBanco).toBe(4);
    expect(mapa['M'].visibleEnPaleta).toBeFalse();
    expect(store.listaTurnosCatalogo().some((t) => t.codigo === 'M' || t.codigo === 'BLANCO')).toBeFalse();
  });

  it('revierte dia civico en cache y versionCacheFestivos si falla el backend y protege festivos oficiales', () => {
    const versionInicial = store.versionCacheFestivos();
    store.nuevoFestivoFecha.set('2026-07-20'); // Festivo oficial Colombia
    store.nuevoFestivoNombre.set('Intento Sobrescribir');
    store.agregarDiaCivico();
    expect(apiSpy.agregarDiaCivico).not.toHaveBeenCalled();

    store.nuevoFestivoFecha.set('2026-11-25');
    store.nuevoFestivoNombre.set('Aniversario Institucional');
    apiSpy.agregarDiaCivico.and.returnValue(throwError(() => ({ error: { message: 'Error BD' } })));

    store.agregarDiaCivico();
    expect(FestivosColombiaHelper.esFestivo('2026-11-25')).toBeUndefined();
    expect(store.versionCacheFestivos()).toBe(versionInicial + 2); // +1 optimista +1 rollback

    // Registro exitoso y rollback al fallar eliminacion
    apiSpy.agregarDiaCivico.and.returnValue(of({ ok: true }));
    store.agregarDiaCivico();
    expect(FestivosColombiaHelper.esFestivo('2026-11-25')?.nombre).toBe('Aniversario Institucional');

    apiSpy.eliminarDiaCivico.and.returnValue(throwError(() => ({ error: { message: 'Fallo delete' } })));
    store.eliminarDiaCivico('2026-11-25');
    expect(FestivosColombiaHelper.esFestivo('2026-11-25')?.nombre).toBe('Aniversario Institucional');
  });

  it('revierte enlace de servicios hermanos y turno nuevo al fallar API y valida HORARIO > 0h', () => {
    const srvs: ServicioHospitalario[] = [
      { id: 'srv-1', codigo: 'URG', nombre: 'Urgencias', tipoAsistencia: 'URGENCIAS', reqDia: 2, reqNoche: 1, hermanos: [] },
      { id: 'srv-2', codigo: 'MAT', nombre: 'Maternidad', tipoAsistencia: 'URGENCIAS', reqDia: 2, reqNoche: 1, hermanos: [] },
    ];
    store.aplicarServiciosDesdeDb(srvs);
    store.enlaceHermanoSrv1.set('srv-1');
    store.enlaceHermanoSrv2.set('srv-2');

    apiSpy.enlazarServiciosHermanos.and.returnValue(throwError(() => ({ error: { message: 'Fallo enlace' } })));
    store.guardarEnlaceHermanos();
    expect(store.servicios()[0].hermanos?.length).toBe(0);
    expect(store.enlaceHermanoSrv2()).toBe('srv-2');

    // Validacion 0h en modo HORARIO no llama API
    store.turnoFormCodigo.set('ZERO');
    store.turnoFormNombre.set('Invalido');
    store.turnoFormModoJornada.set('HORARIO');
    store.turnoFormHoraInicio.set('07:00');
    store.turnoFormHoraFin.set('07:00');
    store.guardarTurnoEnCatalogo();
    expect(apiSpy.guardarTipoTurno).not.toHaveBeenCalled();

    // Rollback cuando API falla guardando nuevo turno
    store.turnoFormCodigo.set('P10');
    store.turnoFormNombre.set('Parcial 10h');
    store.turnoFormHoraInicio.set('07:00');
    store.turnoFormHoraFin.set('17:00');
    store.turnoFormMinutosAlmuerzo.set(0);
    apiSpy.guardarTipoTurno.and.returnValue(throwError(() => ({ error: { message: 'Error BD' } })));

    store.guardarTurnoEnCatalogo();
    expect(apiSpy.guardarTipoTurno).toHaveBeenCalled();
    expect(store.catalogoTurnosMap()['P10']).toBeUndefined();
    expect(store.nuevoServicioTurnosHabilitados()).not.toContain('P10');
  });

  it('permite crear turno DLR prorrateable en DESCANSO, protege turnos obligatorios de archivo y confirma empresa pendiente', () => {
    // 1. DLR prorrateaMetaContrato y bloqueaPermutas
    store.turnoFormCodigo.set('DLR');
    store.turnoFormNombre.set('Día Libre Remunerado');
    store.cambiarTurnoModoJornadaForm('DESCANSO');
    store.cambiarTurnoProrrateaMetaForm(true);
    store.turnoFormBloqueaPermutas.set(true);
    apiSpy.guardarTipoTurno.and.returnValue(
      of({
        codigo: 'DLR',
        nombre: 'Día Libre Remunerado',
        horaInicio: '00:00',
        horaFin: '00:00',
        horasOrdinarias: 0,
        horasDiurnas: 0,
        horasNocturnas: 0,
        prorrateaMetaContrato: true,
        esAusencia: false,
        bloqueaPermutas: true,
        descuentaBancoHoras: false,
        activo: true,
      })
    );

    store.guardarTurnoEnCatalogo();
    expect(apiSpy.guardarTipoTurno).toHaveBeenCalledWith(
      jasmine.objectContaining({
        codigo: 'DLR',
        prorrateaMetaContrato: true,
        esAusencia: false,
        bloqueaPermutas: true,
      })
    );
    expect(store.catalogoTurnosMap()['DLR']?.prorrateaMetaContrato).toBeTrue();

    // 2. Sistema obligatorio (L) no permite archivar
    store.archivarTipoTurno('L');
    expect(apiSpy.archivarTipoTurno).not.toHaveBeenCalled();

    // 3. Turno personalizado DLR sí permite archivar
    apiSpy.archivarTipoTurno.and.returnValue(
      of({ ...store.catalogoTurnosMap()['DLR'], codigo: 'DLR', activo: false })
    );
    store.archivarTipoTurno('DLR');
    expect(apiSpy.archivarTipoTurno).toHaveBeenCalledWith('DLR', false);
    expect(store.catalogoTurnosMap()['DLR']?.activo).toBeFalse();

    // 4. Confirmar reglas de empresa pendiente actualiza señal y notifica empresasActualizadas$
    let notifCount = 0;
    store.empresasActualizadas$.subscribe(() => notifCount++);
    store.aplicarEmpresasDesdeDb([
      {
        id: 'emp-x',
        codigo: 'TEMP_X',
        nombre: 'Temporal X',
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
    expect(store.empresasPendientes().length).toBe(1);

    const empActualizada = { ...store.empresas()[0], estadoConfiguracion: 'CONFIRMADA' as const, horasSemanalesContrato: 44 };
    apiSpy.getEmpresas.and.returnValue(of([empActualizada]));
    apiSpy.confirmarReglasEmpresa.and.returnValue(of(empActualizada));
    store.confirmarReglasEmpresa('emp-x', { horasSemanalesContrato: 44 });
    expect(store.empresasPendientes().length).toBe(0);
    expect(store.empresas()[0].horasSemanalesContrato).toBe(44);
    expect(notifCount).toBeGreaterThanOrEqual(1);
  });
});
