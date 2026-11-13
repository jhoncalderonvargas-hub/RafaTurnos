import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CeldaDrawerComponent } from './celda-drawer.component';
import { CATALOGO_TURNOS, DiaColumna, EmpleadoHospital, ServicioHospitalario, TipoTurnoConfig } from '../../models';
import { TurnosApiService } from '../../turnos-api.service';

describe('CeldaDrawerComponent (Gestión de Break en Inspector F2)', () => {
  let fixture: ComponentFixture<CeldaDrawerComponent>;
  let component: CeldaDrawerComponent;
  let apiSpy: jasmine.SpyObj<TurnosApiService>;

  const turnoTandas: TipoTurnoConfig = {
    ...CATALOGO_TURNOS['ADM'],
    codigo: 'ADM_B',
    nombre: 'Admin Tandas',
    horaInicio: '08:00',
    horaFin: '17:00',
    horasOrdinarias: 8,
    horasDiurnas: 8,
    horasNocturnas: 0,
    minutosAlmuerzo: 60,
    recesoHabilitado: true,
    recesoRemunerado: false,
    recesoMaxSimultaneos: 1,
    recesoTandasJson: [
      { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', duracionMin: 60 },
      { orden: 2, etiqueta: 'T2', inicio: '13:00', fin: '14:00', duracionMin: 60 },
    ],
  };

  const empleadoMock: EmpleadoHospital = {
    id: 'e1',
    documento: '101',
    nombre: 'Ana López',
    categoria: 'Enfermero(a)',
    servicioBaseId: 'srv-1',
    horasContratoMes: 168,
    saldoBancoAnterior: 0,
    ultimoTurnoMesPrevio: 'L',
  };

  const srvMock: ServicioHospitalario = {
    id: 'srv-1',
    codigo: 'URG',
    nombre: 'Urgencias',
    tipoAsistencia: 'URGENCIAS',
    reqDia: 2,
    reqNoche: 1,
  };

  const diaMock: DiaColumna = {
    dia: 10,
    fechaIso: '2026-11-10',
    letraDia: 'M',
    esSabado: false,
    esDomingo: false,
  };

  beforeEach(async () => {
    apiSpy = jasmine.createSpyObj<TurnosApiService>('TurnosApiService', ['obtenerAuditoriaCelda']);
    apiSpy.obtenerAuditoriaCelda.and.returnValue(
      of({
        empleadoId: 'e1',
        fecha: '2026-11-10',
        celda: { nota: null, fijada: false, codigoPrevisto: 'ADM_B', estadoCuadrante: 'BORRADOR' },
        ausencia: null,
        historial: [],
        permutas: [],
      })
    );

    await TestBed.configureTestingModule({
      imports: [CeldaDrawerComponent],
      providers: [{ provide: TurnosApiService, useValue: apiSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(CeldaDrawerComponent);
    component = fixture.componentInstance;
    component.anio = 2026;
    component.mes = 11;
    component.diasDelMes = [diaMock];
    component.empleado = empleadoMock;
    component.servicioActual = srvMock;
    component.servicios = [srvMock];
    component.serviciosVisibles = [srvMock];
    component.catalogoTurnosMap = { ...CATALOGO_TURNOS, ADM_B: turnoTandas };
    component.turnosPaleta = [turnoTandas];
    component.estadoCuadrante = 'BORRADOR';
    component.celda = {
      codigo: 'ADM_B',
      previsto: 'ADM_B',
      servicioEjecutorId: 'srv-1',
      breakTandaOrden: 1,
      breakInicio: '12:00',
      breakFin: '13:00',
    };
    component.resumenTandasBreakDia = {
      dia: 10,
      codigoTurno: 'ADM_B',
      recesoHabilitado: true,
      recesoRemunerado: false,
      maxSimultaneos: 1,
      totalColaboradoresTurno: 2,
      tieneAlerta: true,
      tandas: [
        { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', asignados: 2, maxSimultaneos: 1, enAlerta: true, empleadosIds: ['e1', 'e2'] },
        { orden: 2, etiqueta: 'T2', inicio: '13:00', fin: '14:00', asignados: 0, maxSimultaneos: 1, enAlerta: false, empleadosIds: [] },
      ],
    };
    component.target = { empId: 'e1', dia: 10, origenVista: 'PLANIFICADOR' };
    fixture.detectChanges();
  });

  it('muestra tarjeta de break, liquida descontando la franja asignada y emite eventos de cambio y balanceo', () => {
    const changeSpy = spyOn(component.cambiarBreakTanda, 'emit');
    const balanceSpy = spyOn(component.rebalancearBreaksDia, 'emit');
    const el: HTMLElement = fixture.nativeElement;

    expect(component.liquidacionDia.total).toBe(8);
    expect(component.liquidacionDia.hod).toBe(8);

    const breakCard = el.querySelector('.drawer-break-card') as HTMLElement | null;
    expect(breakCard).not.toBeNull();
    expect(breakCard!.classList.contains('has-overlap')).toBeTrue();
    expect(breakCard!.textContent).toContain('Art. 167 CST');
    expect(breakCard!.textContent).toContain('12:00 – 13:00');

    const pills = breakCard!.querySelectorAll('.drawer-tanda-btn');
    expect(pills.length).toBe(2);
    expect(pills[0].textContent).toContain('2/1');
    (pills[1] as HTMLButtonElement).click();
    expect(changeSpy).toHaveBeenCalledWith({ empId: 'e1', dia: 10, tandaOrden: 2 });

    const btnBalance = breakCard!.querySelector('.btn-balance-breaks') as HTMLButtonElement;
    btnBalance.click();
    expect(balanceSpy).toHaveBeenCalledWith({ dia: 10, codigoTurno: 'ADM_B' });
  });
});
