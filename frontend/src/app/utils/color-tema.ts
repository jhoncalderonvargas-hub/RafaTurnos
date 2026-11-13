export interface TemaColorTurno {
  key: string;
  nombre: string;
  bgHex: string;
  textHex: string;
  borderHex: string;
}

export function normalizarHex(hexInput: string | null | undefined, fallback = '#E0F2FE'): string {
  if (!hexInput) return fallback;
  let clean = hexInput.trim().replace(/^#/, '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    return fallback;
  }
  return `#${clean.toUpperCase()}`;
}

export function hexToRgb(hexInput: string): { r: number; g: number; b: number } {
  const hex = normalizarHex(hexInput).replace('#', '');
  const num = parseInt(hex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hNorm = (((h % 360) + 360) % 360) / 360;
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const lNorm = Math.max(0, Math.min(100, l)) / 100;

  if (sNorm === 0) {
    const v = Math.round(lNorm * 255);
    return rgbToHex(v, v, v);
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return rgbToHex(r, g, b);
}

export function calcularTemaDesdeHex(
  bgHexInput: string,
  nombreCustom = 'Color Personalizado'
): TemaColorTurno {
  const bgHex = normalizarHex(bgHexInput);
  const { r, g, b } = hexToRgb(bgHex);
  const { h, s, l } = rgbToHsl(r, g, b);

  // Luminancia perceptual YIQ (fórmula estándar WCAG para legibilidad)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  const esFondoClaro = yiq >= 140;

  let textHex: string;
  let borderHex: string;

  if (esFondoClaro) {
    textHex =
      s >= 18
        ? hslToHex(h, Math.min(100, Math.round(s * 1.15)), Math.max(12, Math.round(l * 0.28)))
        : '#0F172A';
    borderHex = hslToHex(h, s, Math.max(15, Math.round(l - 18)));
  } else {
    textHex = '#FFFFFF';
    borderHex = hslToHex(h, s, Math.min(85, Math.round(l + 20)));
  }

  return {
    key: `HEX_${bgHex.replace('#', '')}`,
    nombre: nombreCustom,
    bgHex,
    textHex,
    borderHex,
  };
}

export function resolverTemaColor(
  colorKeyOHex: string | null | undefined,
  temasPreset: TemaColorTurno[] = []
): TemaColorTurno {
  const val = (colorKeyOHex || '').trim();
  if (!val) {
    return temasPreset[0] || calcularTemaDesdeHex('#E0F2FE', 'Azul Mañana');
  }

  // 1. Coincidencia exacta por key del preset (ej: 'AZUL_CIELO')
  const porKey = temasPreset.find((t) => t.key.toUpperCase() === val.toUpperCase());
  if (porKey) return porKey;

  // 2. Coincidencia exacta por color de fondo con un preset existente
  const porBg = temasPreset.find((t) => t.bgHex.toLowerCase() === val.toLowerCase());
  if (porBg) return porBg;

  // 3. Es un código hexadecimal válido (con o sin #, de 3 o 6 dígitos)
  const limpio = val.replace('#', '');
  if (/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(limpio)) {
    const normalizado = normalizarHex(val);
    const presetMismoHex = temasPreset.find(
      (t) => t.bgHex.toLowerCase() === normalizado.toLowerCase()
    );
    if (presetMismoHex) return presetMismoHex;
    return calcularTemaDesdeHex(normalizado, `Color ${normalizado}`);
  }

  // 4. Fallback al primer preset o default
  return temasPreset[0] || calcularTemaDesdeHex('#E0F2FE', 'Azul Mañana');
}
