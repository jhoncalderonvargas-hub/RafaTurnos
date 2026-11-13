import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfiguracionCatalogoTurnosComponent } from './configuracion-catalogo-turnos.component';

describe('ConfiguracionCatalogoTurnosComponent (Timeline Interactiva de Breaks)', () => {
  let fixture: ComponentFixture<ConfiguracionCatalogoTurnosComponent>;
  let component: ConfiguracionCatalogoTurnosComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfiguracionCatalogoTurnosComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfiguracionCatalogoTurnosComponent);
    component = fixture.componentInstance;
    component.calc = {
      ordinarias: 8,
      horarioTexto: '07:00 - 16:00',
      minutosAlmuerzo: 60,
      diurnas: 8,
      nocturnas: 0,
    };
    component.turnoFormModoJornada = 'HORARIO';
    component.turnoFormHoraInicio = '07:00';
    component.turnoFormHoraFin = '16:00';
    fixture.detectChanges();
  });

  it('oculta el bloque desplegable cuando recesoHabilitado=false y muestra barras arrastrables sin botones -5m/+5m al habilitarlo', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.break-collapsible-body')).toBeNull();

    component.turnoFormRecesoHabilitado = true;
    component.turnoFormRecesoRemunerado = false;
    component.turnoFormDuracionBreakMin = 60;
    component.turnoFormRecesoMaxSimultaneos = 1;
    component.turnoFormRecesoTandas = [
      { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', duracionMin: 60 },
      { orden: 2, etiqueta: 'T2', inicio: '13:00', fin: '14:00', duracionMin: 60 },
    ];
    fixture.detectChanges();

    const body = el.querySelector('.break-collapsible-body') as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body!.querySelector('.break-timeline-track')).not.toBeNull();
    const bars = body!.querySelectorAll('.break-tanda-bar');
    expect(bars.length).toBe(2);
    expect(bars[0].textContent).toContain('T1');
    expect(bars[1].textContent).toContain('T2');

    const readoutChips = body!.querySelectorAll('.break-readout-chip');
    expect(readoutChips.length).toBe(2);
    expect(readoutChips[0].textContent).toContain('T1');
    expect(readoutChips[0].textContent).toContain('12:00 – 13:00');
    expect(readoutChips[1].textContent).toContain('13:00 – 14:00');

    // Presets de duración: 15m, 30m, 45m, 60m (sin 90m) y nunca botones -5m / +5m
    const botonesTexto = Array.from(body!.querySelectorAll('button')).map(
      (b) => b.textContent?.trim() || ''
    );
    expect(botonesTexto).toContain('15m');
    expect(botonesTexto).toContain('60m');
    expect(botonesTexto).not.toContain('90m');
    expect(botonesTexto.some((t) => t.includes('-5m') || t.includes('+5m'))).toBeFalse();
  });

  it('muestra indicador flotante en vivo y emite moverTandaBreak al enfocar con clic y usar ArrowRight', () => {
    const moveSpy = spyOn(component.moverTandaBreak, 'emit');
    component.turnoFormRecesoHabilitado = true;
    component.turnoFormRecesoTandas = [
      { orden: 1, etiqueta: 'T1', inicio: '12:00', fin: '13:00', duracionMin: 60 },
    ];
    fixture.detectChanges();

    const bar = fixture.nativeElement.querySelector('.break-tanda-bar') as HTMLElement;
    bar.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, bubbles: true }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(bar);
    const callout = bar.querySelector('.break-live-callout');
    expect(callout).not.toBeNull();
    expect(callout!.textContent).toContain('T1: 12:00–13:00');

    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(moveSpy).toHaveBeenCalledWith({ orden: 1, nuevoInicioRelMin: 315 });
  });

  it('soporta selector nativo de espectro dentro de la paleta (Distribución 2)', () => {
    const colorSpy = spyOn(component.cambiarTurnoFormColorKey, 'emit');
    component.turnoFormCodigo = 'M8';
    component.turnoFormColorKey = 'AZUL_CIELO';
    component.temasColorTurno = [
      { key: 'AZUL_CIELO', nombre: 'Azul Mañana', bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC' },
      { key: 'AMBAR_TARDE', nombre: 'Ámbar Tarde', bgHex: '#FEF08A', textHex: '#854D0E', borderHex: '#FACC15' },
    ];
    fixture.detectChanges();

    const swatches = fixture.nativeElement.querySelectorAll('.color-theme-swatch:not(.color-spectrum-trigger)');
    expect(swatches.length).toBe(2);
    swatches[1].click();
    expect(colorSpy).toHaveBeenCalledWith('AMBAR_TARDE');

    // Botón disparador dentro de la misma grilla
    const trigger = fixture.nativeElement.querySelector('.color-spectrum-trigger');
    expect(trigger).not.toBeNull();
    const nativeInput = fixture.nativeElement.querySelector('.color-native-input') as HTMLInputElement;
    expect(nativeInput).not.toBeNull();

    // Emisión por espectro
    component.onColorSpectrumChange('#10B981');
    expect(colorSpy).toHaveBeenCalledWith('#10B981');
  });

  it('muestra pastilla activa personalizada cuando el color seleccionado es un hex externo', () => {
    component.turnoFormCodigo = 'M8';
    component.turnoFormColorKey = '#FF5733';
    component.temasColorTurno = [
      { key: 'AZUL_CIELO', nombre: 'Azul Mañana', bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC' },
    ];
    fixture.detectChanges();

    expect(component.esColorPersonalizado).toBeTrue();
    const customSwatch = fixture.nativeElement.querySelector('.custom-swatch');
    expect(customSwatch).not.toBeNull();
  });
});
