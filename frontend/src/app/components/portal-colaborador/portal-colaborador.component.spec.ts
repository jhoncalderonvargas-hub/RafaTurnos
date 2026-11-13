import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PortalColaboradorComponent, DatosEmpleadoPortal } from './portal-colaborador.component';
import { DiaColumna, EmpleadoHospital } from '../../models';

describe('PortalColaboradorComponent (Selector de Vista y Modo Responsive)', () => {
  let component: PortalColaboradorComponent;
  let fixture: ComponentFixture<PortalColaboradorComponent>;

  const mockEmpleado: EmpleadoHospital = {
    id: 'emp-1',
    nombre: 'Dra. Elena Ramos',
    documento: '1098765432',
    categoria: 'Médico General',
    servicioBaseId: 'srv-urg',
    saldoBancoAnterior: 4,
    horasContratoMes: 168,
    ultimoTurnoMesPrevio: 'L',
  };

  const mockPortal: DatosEmpleadoPortal = {
    empleado: mockEmpleado,
    servicioBase: {
      id: 'srv-urg',
      codigo: 'URG',
      nombre: 'Urgencias Adultos',
      tipoAsistencia: 'URGENCIAS',
      reqDia: 2,
      reqNoche: 2,
      reqDiaDomFest: 2,
      reqNocheDomFest: 2,
      turnosHabilitados: ['M8', 'T8', 'N12', 'L'],
    },
    celdas: {
      1: { codigo: 'M8', esRotacion: false, fijada: false },
      2: { codigo: 'L', esRotacion: false, fijada: false },
    },
    horasTrabajadas: 8,
    conteoNoches: 0,
    conteoDomFest: 0,
    nuevoSaldoBanco: 4,
    diferenciaMes: 0,
  };

  const mockDias: DiaColumna[] = [
    { dia: 1, fechaIso: '2026-11-01', letraDia: 'L', esDomingo: false, esSabado: false, esHoy: true },
    { dia: 2, fechaIso: '2026-11-02', letraDia: 'M', esDomingo: false, esSabado: false, esHoy: false },
  ];

  beforeEach(async () => {
    localStorage.removeItem('rafa_portal_vista_modo');
    await TestBed.configureTestingModule({
      imports: [PortalColaboradorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PortalColaboradorComponent);
    component = fixture.componentInstance;
    component.portal = mockPortal;
    component.diasDelMes = mockDias;
    component.mesesDisponibles = [{ valor: 11, nombre: 'Noviembre' }];
    component.mesSeleccionado = 11;
    component.anioSeleccionado = 2026;
    component.catalogoTurnosMap = {
      M8: {
        codigo: 'M8',
        nombre: 'Mañana 8h',
        horaInicio: '07:00',
        horaFin: '15:00',
        horario: '07:00 - 15:00',
        horasOrdinarias: 8,
        horasDiurnas: 8,
        horasNocturnas: 0,
        minutosAlmuerzo: 0,
        bgHex: '#fef3c7',
        textHex: '#92400e',
        borderHex: '#fcd34d',
        esAusencia: false,
        esNocturnoPesado: false,
        descuentaBancoHoras: false,
        visibleEnPaleta: true,
      },
    };
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('rafa_portal_vista_modo');
  });

  it('renderiza el selector segmentado de vista con opciones Agenda y Mes', () => {
    const el: HTMLElement = fixture.nativeElement;
    const switcher = el.querySelector('.portal-view-switcher');
    expect(switcher).not.toBeNull();

    const buttons = el.querySelectorAll('.btn-view-tab');
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toContain('Agenda');
    expect(buttons[1].textContent).toContain('Mes');
  });

  it('permite alternar entre modo AGENDA y modo MES y persiste la preferencia', () => {
    component.cambiarModoVista('AGENDA');
    fixture.detectChanges();
    expect(component.modoVistaPortal()).toBe('AGENDA');
    expect(localStorage.getItem('rafa_portal_vista_modo')).toBe('AGENDA');

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.agenda-calendar-list')).not.toBeNull();
    expect(el.querySelector('.weekly-calendar-grid')).toBeNull();

    component.cambiarModoVista('MES');
    fixture.detectChanges();
    expect(component.modoVistaPortal()).toBe('MES');
    expect(localStorage.getItem('rafa_portal_vista_modo')).toBe('MES');

    expect(el.querySelector('.agenda-calendar-list')).toBeNull();
    expect(el.querySelector('.weekly-calendar-grid')).not.toBeNull();
    expect(el.querySelector('.dia-seleccionado-ficha')).not.toBeNull();
  });

  it('en modo AGENDA renderiza tarjetas diarias completas con turnos y descansos', () => {
    component.cambiarModoVista('AGENDA');
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const cards = el.querySelectorAll('.agenda-day-card');
    expect(cards.length).toBe(2);

    // Día 1: M8
    const card1 = cards[0];
    expect(card1.querySelector('.agenda-day-number')?.textContent?.trim()).toBe('1');
    expect(card1.querySelector('.agenda-shift-badge')?.textContent).toContain('M8');
    expect(card1.querySelector('.agenda-shift-hours')?.textContent).toContain('07:00 - 15:00');

    // Día 2: L (Libre)
    const card2 = cards[1];
    expect(card2.querySelector('.agenda-day-number')?.textContent?.trim()).toBe('2');
    expect(card2.querySelector('.agenda-free-badge')?.textContent).toContain('Descanso');
  });

  it('emite seleccionarDiaEnPortal al pulsar el botón Permutar en una tarjeta de agenda', () => {
    component.cambiarModoVista('AGENDA');
    fixture.detectChanges();

    const emitSpy = spyOn(component.seleccionarDiaEnPortal, 'emit');
    const el: HTMLElement = fixture.nativeElement;
    const btnPermuta = el.querySelector('.btn-permuta-trigger') as HTMLButtonElement;
    expect(btnPermuta).not.toBeNull();

    btnPermuta.click();
    expect(emitSpy).toHaveBeenCalledWith(1);
  });

  it('en modo MES la ficha inteligente refleja la información del día seleccionado', () => {
    component.cambiarModoVista('MES');
    component.diaPermutaSeleccionado = 1;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const ficha = el.querySelector('.dia-seleccionado-ficha');
    expect(ficha).not.toBeNull();
    expect(ficha?.textContent).toContain('Día 1');
    expect(ficha?.textContent).toContain('M8 · Mañana 8h');
    expect(ficha?.textContent).toContain('07:00 - 15:00');
  });
});
