const REGEX_DIACRITICOS = /[\u0300-\u036f]/g;
const REGEX_ESPACIOS = /\s+/g;

/**
 * Normaliza un texto para búsquedas tolerantes a tildes/diacríticos,
 * mayúsculas/minúsculas y espacios múltiples.
 * Ej: "  Mónica  Pérez  " -> "monica perez"
 */
export function normalizarTextoBusqueda(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .normalize('NFD')
    .replace(REGEX_DIACRITICOS, '')
    .toLowerCase()
    .replace(REGEX_ESPACIOS, ' ')
    .trim();
}

/**
 * Prepara la consulta de búsqueda una sola vez antes de filtrar listas.
 */
export function dividirTerminosBusqueda(query: unknown): string[] {
  const norm = normalizarTextoBusqueda(query);
  return norm ? norm.split(' ') : [];
}

/**
 * Evalúa si TODOS los términos de búsqueda coinciden en al menos uno de los campos.
 * Para un único término corta en el primer campo coincidente sin normalizar los restantes.
 */
export function coincideBusquedaCampos(terminos: string[], campos: Array<unknown>): boolean {
  if (terminos.length === 0) return true;
  if (terminos.length === 1) {
    const t0 = terminos[0];
    for (let i = 0; i < campos.length; i++) {
      if (normalizarTextoBusqueda(campos[i]).includes(t0)) {
        return true;
      }
    }
    return false;
  }

  const camposNorm = campos.map((c) => normalizarTextoBusqueda(c));
  return terminos.every((t) => camposNorm.some((c) => c.includes(t)));
}
