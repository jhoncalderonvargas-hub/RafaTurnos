import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SidebarNavegacionComponent } from './sidebar-navegacion.component';
import { SesionUsuarioSso } from '../../models';

describe('SidebarNavegacionComponent (Barra Inferior Móvil y Cajón Más)', () => {
  let component: SidebarNavegacionComponent;
  let fixture: ComponentFixture<SidebarNavegacionComponent>;

  const mockSesionColaborador: SesionUsuarioSso = {
    empleadoId: 'usr-1',
    documento: '1098765432',
    nombre: 'Bernardo Castro Zapata',
    categoria: 'Auxiliar de Enfermería',
    rol: 'COLABORADOR',
    servicioBaseId: 'srv-urg',
    servicioBaseNombre: 'Urgencias Adultos',
    serviciosPermitidosIds: ['srv-urg'],
  };

  const mockSesionAdmin: SesionUsuarioSso = {
    empleadoId: 'usr-admin',
    documento: '12345678',
    nombre: 'Dra. Claudia Gómez',
    categoria: 'Jefe Talento Humano',
    rol: 'ADMIN_TH',
    servicioBaseId: '',
    servicioBaseNombre: '',
    serviciosPermitidosIds: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SidebarNavegacionComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarNavegacionComponent);
    component = fixture.componentInstance;
    component.sesionActual = mockSesionColaborador;
    component.esColaborador = true;
    component.esAdminTh = false;
    component.vistaActual = 'PORTAL_EMPLEADO';
    fixture.detectChanges();
  });

  it('renderiza la barra de navegación inferior (bottom-nav-bar) con 4 botones para colaborador', () => {
    const el: HTMLElement = fixture.nativeElement;
    const bottomNav = el.querySelector('.bottom-nav-bar');
    expect(bottomNav).not.toBeNull();

    const items = bottomNav?.querySelectorAll('.bottom-nav-item');
    expect(items?.length).toBe(4);

    expect(items?.[0].textContent).toContain('Mi Turno');
    expect(items?.[1].textContent).toContain('Permutas');
    expect(items?.[2].textContent).toContain('Celular');
    expect(items?.[3].textContent).toContain('Más');
  });

  it('marca activo el botón correspondiente a la vistaActual del colaborador', () => {
    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.bottom-nav-bar .bottom-nav-item');
    expect(items[0].classList.contains('active')).toBeTrue();
    expect(items[1].classList.contains('active')).toBeFalse();

    component.vistaActual = 'DASHBOARD';
    fixture.detectChanges();
    expect(items[0].classList.contains('active')).toBeFalse();
    expect(items[1].classList.contains('active')).toBeTrue();
  });

  it('muestra badges numéricos de solicitudes pendientes en la barra inferior', () => {
    component.propuestasRecibidasCount = 2;
    component.notificacionesSolicitudesCount = 3;
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const badges = el.querySelectorAll('.bottom-nav-bar .bottom-badge');
    expect(badges.length).toBe(2);
    expect(badges[0].textContent?.trim()).toBe('2');
    expect(badges[1].textContent?.trim()).toBe('3');
  });

  it('al pulsar Más abre el cajón deslizante inferior (bottom sheet) con datos de usuario y menú ampliado', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(component.mostrarDrawerMas()).toBeFalse();
    expect(el.querySelector('.mobile-more-sheet')).toBeNull();

    const btnMas = el.querySelectorAll('.bottom-nav-bar .bottom-nav-item')[3] as HTMLButtonElement;
    btnMas.click();
    fixture.detectChanges();

    expect(component.mostrarDrawerMas()).toBeTrue();
    const sheet = el.querySelector('.mobile-more-sheet');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain('Bernardo Castro Zapata');
    expect(sheet?.textContent).toContain('Colaborador Asistencial');
    expect(sheet?.textContent).toContain('Volver a la Intranet Hospitalaria');

    // Cerrar al pulsar el backdrop
    const backdrop = el.querySelector('.mobile-more-backdrop') as HTMLElement;
    expect(backdrop).not.toBeNull();
    backdrop.click();
    fixture.detectChanges();

    expect(component.mostrarDrawerMas()).toBeFalse();
    expect(el.querySelector('.mobile-more-sheet')).toBeNull();
  });

  it('emite itemNavegacionClick al tocar un botón en la barra inferior y cierra el cajón si estaba abierto', () => {
    const emitSpy = spyOn(component.itemNavegacionClick, 'emit');
    component.mostrarDrawerMas.set(true);
    fixture.detectChanges();

    component.navegarEnMovil('DASHBOARD');
    expect(component.mostrarDrawerMas()).toBeFalse();
    expect(emitSpy).toHaveBeenCalledWith('DASHBOARD');
  });

  it('renderiza opciones de administración en la barra inferior para Admin TH', () => {
    component.esColaborador = false;
    component.esAdminTh = true;
    component.sesionActual = mockSesionAdmin;
    component.vistaActual = 'PLANIFICADOR';
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const items = el.querySelectorAll('.bottom-nav-bar .bottom-nav-item');
    expect(items.length).toBe(4);
    expect(items[0].textContent).toContain('Turnos');
    expect(items[1].textContent).toContain('Permutas');
    expect(items[2].textContent).toContain('Nómina');
    expect(items[3].textContent).toContain('Más');
  });
});
