import {
  calcularTemaDesdeHex,
  hexToRgb,
  hslToHex,
  normalizarHex,
  resolverTemaColor,
  rgbToHex,
  rgbToHsl,
  TemaColorTurno,
} from './color-tema';

describe('color-tema utils', () => {
  const temasTest: TemaColorTurno[] = [
    { key: 'AZUL_CIELO', nombre: 'Azul Mañana', bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC' },
    { key: 'AMBAR_TARDE', nombre: 'Ámbar Tarde', bgHex: '#FEF08A', textHex: '#854D0E', borderHex: '#FACC15' },
    { key: 'ROJO_CORAL', nombre: 'Rojo Guardia', bgHex: '#FEE2E2', textHex: '#991B1B', borderHex: '#FCA5A5' },
  ];

  it('normaliza códigos hexadecimales de 3 y 6 dígitos y aplica fallback en entradas inválidas', () => {
    expect(normalizarHex('#abc')).toBe('#AABBCC');
    expect(normalizarHex('3b82f6')).toBe('#3B82F6');
    expect(normalizarHex('#3B82F6')).toBe('#3B82F6');
    expect(normalizarHex('invalido')).toBe('#E0F2FE');
    expect(normalizarHex(null)).toBe('#E0F2FE');
  });

  it('convierte bidireccionalmente entre RGB y HEX', () => {
    const rgb = hexToRgb('#3B82F6');
    expect(rgb).toEqual({ r: 59, g: 130, b: 246 });
    expect(rgbToHex(rgb.r, rgb.g, rgb.b)).toBe('#3B82F6');
  });

  it('convierte RGB a HSL y genera HEX preservando tonos básicos', () => {
    const { h, s, l } = rgbToHsl(255, 0, 0); // Rojo puro
    expect(h).toBe(0);
    expect(s).toBe(100);
    expect(l).toBe(50);
    expect(hslToHex(0, 100, 50)).toBe('#FF0000');
  });

  it('calcula contraste WCAG claro con texto legible y borde para fondos claros', () => {
    const temaClaro = calcularTemaDesdeHex('#E0F2FE');
    expect(temaClaro.bgHex).toBe('#E0F2FE');
    expect(temaClaro.textHex).not.toBe('#FFFFFF');
    expect(temaClaro.borderHex.startsWith('#')).toBeTrue();
  });

  it('calcula texto blanco #FFFFFF para colores de fondo oscuros', () => {
    const temaOscuro = calcularTemaDesdeHex('#1E3A8A');
    expect(temaOscuro.textHex).toBe('#FFFFFF');
    expect(temaOscuro.borderHex.startsWith('#')).toBeTrue();

    const temaNegro = calcularTemaDesdeHex('#111827');
    expect(temaNegro.textHex).toBe('#FFFFFF');
  });

  it('resuelve temas existentes por clave o por color exacto de fondo', () => {
    const resKey = resolverTemaColor('AMBAR_TARDE', temasTest);
    expect(resKey.key).toBe('AMBAR_TARDE');
    expect(resKey.bgHex).toBe('#FEF08A');

    const resHexPreset = resolverTemaColor('#fef08a', temasTest);
    expect(resHexPreset.key).toBe('AMBAR_TARDE');
  });

  it('genera un tema dinámico con contraste cuando se pasa un color hexadecimal nuevo del espectro', () => {
    const resCustom = resolverTemaColor('#10B981', temasTest);
    expect(resCustom.bgHex).toBe('#10B981');
    expect(resCustom.textHex).toBe('#FFFFFF');
    expect(resCustom.borderHex.startsWith('#')).toBeTrue();
  });
});
