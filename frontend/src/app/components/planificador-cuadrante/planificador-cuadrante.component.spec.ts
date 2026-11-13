import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlanificadorCuadranteComponent } from './planificador-cuadrante.component';
import { ServicioHospitalario, TipoTurnoConfig } from '../../models';

describe('PlanificadorCuadranteComponent (Switch Compacto / Nombres y Horarios)', () => {
  const STORAGE_KEY = 'rafa_turnos_paleta_detallada';

  const servicioMock: ServicioHospitalario = {
    id: 'srv-1',
    codigo: 'URG',
    nombre: 'Urgencias',
    tipoAsistencia: 'URGENCIAS',
    reqDia: 2,
    reqNoche: 1,
  };

  const turnosMock: TipoTurnoConfig[] = [
    {
      codigo: 'M8',
      nombre: 'Mañana Ordinario',
      horario: '07:00 - 15:00',
      horasOrdinarias: 8,
      horasDiurnas: 8,
      horasNocturnas: 0,
      bgHex: '#dbeafe',
      textHex: '#1e40af',
      borderHex: '#93c5fd',
      esAusencia: false,
      esNocturnoPesado: false,
      descuentaBancoHoras: false,
    },
    {
      codigo: 'COMP',
      nombre: 'Compensatorio Banco',
      horario: '00:00 - 00:00',
      horasOrdinarias: 0,
      horasDiurnas: 0,
      horasNocturnas: 0,
      bgHex: '#ecfdf5',
      textHex: '#047857',
      borderHex: '#6ee7b7',
      esAusencia: false,
      esNocturnoPesado: false,
      descuentaBancoHoras: true,
      horasAmortizacionBanco: 8,
    },
    {
      codigo: 'VAC',
      nombre: 'Vacaciones Legales',
      horario: '00:00 - 00:00',
      horasOrdinarias: 0,
      horasDiurnas: 0,
      horasNocturnas: 0,
      bgHex: '#fdf2f8',
      textHex: '#be185d',
      borderHex: '#f9a8d4',
      esAusencia: true,
      esNocturnoPesado: false,
      descuentaBancoHoras: false,
    },
  ];

  let fixture: ComponentFixture<PlanificadorCuadranteComponent>;
  let component: PlanificadorCuadranteComponent;

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await TestBed.configureTestingModule({
      imports: [PlanificadorCuadranteComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PlanificadorCuadranteComponent);
    component = fixture.componentInstance;
    component.servicioActual = servicioMock;
    component.servicioSeleccionadoId = 'srv-1';
    component.serviciosVisibles = [servicioMock];
    component.servicios = [servicioMock];
    component.listaTurnosPaleta = turnosMock;
    component.diasDelMes = [];
    component.filasCuadrante = [];
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('inicia en formato compacto de 1 fila sin panel detallado visible', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.palette-compact-row')).not.toBeNull();
    expect(el.querySelector('.palette-detail-panel')).toBeNull();
    expect(component.paletaDetallada).toBeFalse();
  });

  it('conmuta a vista detallada en flujo con nombres y horarios, persiste en localStorage y vuelve a compacta', () => {
    const emitSpy = spyOn(component.seleccionarPincel, 'emit');
    const el: HTMLElement = fixture.nativeElement;

    const btnToDetail = el.querySelector('.btn-palette-toggle') as HTMLButtonElement;
    expect(btnToDetail.textContent).toContain('Vista extendida');
    btnToDetail.click();
    fixture.detectChanges();

    expect(component.paletaDetallada).toBeTrue();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(el.querySelector('.palette-compact-row')).toBeNull();

    const panel = el.querySelector('.palette-detail-panel');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('.palette-detail-left-tools')).not.toBeNull();
    expect(panel!.querySelectorAll('.detail-tool-card').length).toBe(2);
    expect(panel!.querySelector('.detail-family-group.group-diurno')).not.toBeNull();
    expect(panel!.querySelector('.detail-family-group.group-descanso')).not.toBeNull();
    expect(panel!.querySelector('.detail-family-group.group-ausencia')).not.toBeNull();
    expect(panel!.textContent).toContain('Mañana Ordinario');
    expect(panel!.textContent).toContain('07:00 - 15:00 · 8h');

    // Al seleccionar un turno permanece abierta sin flotar ni cerrar el panel
    const cardM8 = el.querySelector('.shift-detail-card') as HTMLButtonElement;
    expect(cardM8.style.backgroundColor).toBe('rgb(238, 245, 255)');
    cardM8.click();
    fixture.detectChanges();
    expect(emitSpy).toHaveBeenCalledWith('M8');
    expect(component.paletaDetallada).toBeTrue();
    expect(el.querySelector('.palette-detail-panel')).not.toBeNull();

    // Al pulsar "Vista compacta" vuelve a 1 fila y persiste false
    const btnToCompact = el.querySelector('.btn-palette-toggle') as HTMLButtonElement;
    btnToCompact.click();
    fixture.detectChanges();
    expect(component.paletaDetallada).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
    expect(el.querySelector('.palette-compact-row')).not.toBeNull();
    expect(el.querySelector('.palette-detail-panel')).toBeNull();
  });

  it('formatea correctamente la franja horaria y subtexto para turnos ordinarios, banco y ausencias', () => {
    expect(component.obtenerSubtextoHorarioPaleta(turnosMock[0])).toBe('07:00 - 15:00 · 8h');
    expect(component.obtenerSubtextoHorarioPaleta(turnosMock[1])).toBe('Amortiza 8h banco');
    expect(component.obtenerSubtextoHorarioPaleta(turnosMock[2])).toBe('Novedad Intranet');
  });

  it('no renderiza filas separadoras de cargo ni texto de cargo en las filas del cuadrante y muestra solo la empresa sin horas', () => {
    component.filasCuadrante = [
      {
        empleado: {
          id: 'emp-1',
          nombre: 'Ana Pérez',
          categoria: 'Enfermería',
          horasContratoMes: 180,
          saldoBancoAnterior: 0,
          ultimoTurnoMesPrevio: 'L',
        },
        empresaCodigo: 'ESE',
        horasSemanalesAplicadas: 44,
        celdas: {},
        horasTrabajadas: 0,
        horasContratadasEfectivas: 180,
        horasOtrosServicios: 0,
        horasLocales: 0,
        hod: 0,
        hon: 0,
        hdfd: 0,
        hdfn: 0,
        diferenciaMes: 0,
        horasAmortizadasComp: 0,
        nuevoSaldoBanco: 0,
        conteoNoches: 0,
        conteoDomFest: 0,
        causaCompensatorioDominical: false,
      },
    ];
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('thead .col-sticky-emp')?.textContent?.trim()).toBe('Colaborador');
    expect(el.querySelectorAll('tbody tr.group-row').length).toBe(0);
    const empRowText = el.querySelector('tbody tr')?.textContent || '';
    expect(empRowText).toContain('Ana Pérez');
    expect(empRowText).not.toContain('Enfermería');
    const empresaChip = el.querySelector('.emp-empresa-chip')?.textContent?.trim() || '';
    expect(empresaChip).toBe('ESE');
    expect(empresaChip).not.toContain('44h');
  });

  it('ubica los botones de deshacer y rehacer en la paleta derecha (compacta y extendida) y no en la barra superior', () => {
    const undoSpy = spyOn(component.deshacerUltimaAccion, 'emit');
    const redoSpy = spyOn(component.rehacerUltimaAccion, 'emit');
    component.pilaDeshacer = [{}];
    component.pilaRehacer = [{}];
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.toolbar-controls .undo-redo-cluster')).toBeNull();

    const compactCluster = el.querySelector('.thurni-palette-bar .palette-mode-actions .undo-redo-cluster');
    expect(compactCluster).not.toBeNull();
    const btnsCompact = compactCluster!.querySelectorAll('.btn-undo-action');
    expect(btnsCompact.length).toBe(2);
    (btnsCompact[0] as HTMLButtonElement).click();
    (btnsCompact[1] as HTMLButtonElement).click();
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(redoSpy).toHaveBeenCalledTimes(1);

    (el.querySelector('.btn-palette-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    const detailCluster = el.querySelector('.thurni-palette-bar .palette-detail-actions .undo-redo-cluster');
    expect(detailCluster).not.toBeNull();
    expect(detailCluster!.querySelectorAll('.btn-undo-action').length).toBe(2);
  });

  it('oculta el botón Hoy cuando esPeriodoActual es true y lo muestra cuando es false', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(component.esPeriodoActual).toBeTrue();
    expect(el.querySelector('.btn-hoy-period')).toBeNull();

    component.esPeriodoActual = false;
    fixture.detectChanges();
    const btnHoy = el.querySelector('.btn-hoy-period') as HTMLButtonElement | null;
    expect(btnHoy).not.toBeNull();
    expect(btnHoy!.textContent?.trim()).toBe('Hoy');
  });

  it('no renderiza el botón ni las filas legacy de franjas Día/Noche en el footer', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.btn-toggle-legacy-cov')).toBeNull();
    expect(el.querySelectorAll('.coverage-legacy-row').length).toBe(0);
  });

  it('muestra el periodo compacto (Nov 2026) solo con flechas < > y colorea según estado sin píldora extra', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.estado-cuadrante-badge')).toBeNull();
    expect(el.querySelector('.btn-cta-primary')).not.toBeNull();
    expect(el.querySelector('select.select-mes')).toBeNull();
    expect(el.querySelector('select.select-year')).toBeNull();

    component.mesSeleccionado = 11;
    component.anioSeleccionado = 2026;
    fixture.detectChanges();

    const periodDisplay = el.querySelector('.period-compact-display') as HTMLElement;
    expect(periodDisplay).not.toBeNull();
    expect(periodDisplay.textContent?.trim()).toBe('Nov 2026');
    expect(periodDisplay.classList.contains('is-published')).toBeFalse();
    expect(periodDisplay.classList.contains('is-locked')).toBeFalse();

    component.estadoCuadrante = 'PUBLICADO';
    fixture.detectChanges();
    expect(periodDisplay.classList.contains('is-published')).toBeTrue();

    component.estadoCuadrante = 'CERRADO_NOMINA';
    fixture.detectChanges();
    expect(periodDisplay.classList.contains('is-locked')).toBeTrue();

    const navSpy = spyOn(component.navegarMes, 'emit');
    const navButtons = el.querySelectorAll('.month-stepper-toolbar .btn-nav-month');
    expect(navButtons.length).toBe(2);
    (navButtons[0] as HTMLButtonElement).click();
    (navButtons[1] as HTMLButtonElement).click();
    expect(navSpy).toHaveBeenCalledWith(-1);
    expect(navSpy).toHaveBeenCalledWith(1);
  });

  it('no renderiza el botón de Cambios en la barra superior', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.toggle-chip')).toBeNull();
    expect(el.querySelector('.toolbar-zone-tools')?.textContent || '').not.toContain('Cambios');
  });

  it('muestra el indicador compacto de Intranet sin texto largo y permite sincronizar al hacer clic', () => {
    const syncSpy = spyOn(component.sincronizarNovedadesIntranet, 'emit');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.intranet-label')).toBeNull();
    const pill = el.querySelector('.intranet-status-pill') as HTMLButtonElement | null;
    expect(pill).not.toBeNull();
    expect(pill!.querySelector('.live-dot')).not.toBeNull();
    pill!.click();
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('muestra el botón de Excel solo con ícono sin texto y emite exportarExcelNomina al pulsar', () => {
    const excelSpy = spyOn(component.exportarExcelNomina, 'emit');
    const el: HTMLElement = fixture.nativeElement;
    const btnExcel = el.querySelector('.btn-tool-excel') as HTMLButtonElement | null;
    expect(btnExcel).not.toBeNull();
    expect(btnExcel!.textContent?.trim()).toBe('');
    expect(btnExcel!.querySelector('svg.excel-icon-svg')).not.toBeNull();
    btnExcel!.click();
    expect(excelSpy).toHaveBeenCalledTimes(1);
  });
});
