/**
 * Servicio puro de cálculo de Festivos de Colombia (Algoritmo de Butcher/Meeus + Ley 51 de 1983 / Ley Emiliani).
 * Incluye Caché en Memoria (Map/Set) O(1) y soporte de excepciones/días cívicos institucionales.
 */

export interface FestivoEntry {
  fecha: string; // YYYY-MM-DD
  nombre: string;
  esOficialLey: boolean;
}

export class FestivosColombiaHelper {
  private static cachePorAnio = new Map<number, Map<string, FestivoEntry>>();

  /**
   * Obtiene el mapa de festivos de un año (con caché en RAM O(1))
   */
  static getFestivosAnio(anio: number): Map<string, FestivoEntry> {
    if (this.cachePorAnio.has(anio)) {
      return this.cachePorAnio.get(anio)!;
    }

    const lista = this.calcularFestivos(anio);
    const mapa = new Map<string, FestivoEntry>();
    for (const f of lista) {
      mapa.set(f.fecha, f);
    }
    this.cachePorAnio.set(anio, mapa);
    return mapa;
  }

  /**
   * Consulta en O(1) si una fecha YYYY-MM-DD es festivo en Colombia
   */
  static esFestivo(fechaIso: string): FestivoEntry | undefined {
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    return this.getFestivosAnio(anio).get(fechaIso);
  }

  /**
   * Permite a Gestión Humana agregar un Día Cívico o Festivo Institucional y refrescar la caché RAM
   */
  static agregarFestivoManual(fechaIso: string, nombre: string): void {
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    const mapa = this.getFestivosAnio(anio);
    mapa.set(fechaIso, {
      fecha: fechaIso,
      nombre,
      esOficialLey: false,
    });
  }

  static eliminarFestivoManual(fechaIso: string): void {
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    const mapa = this.getFestivosAnio(anio);
    const actual = mapa.get(fechaIso);
    if (actual && !actual.esOficialLey) {
      mapa.delete(fechaIso);
    }
  }

  private static calcularFestivos(anio: number): FestivoEntry[] {
    const festivos: FestivoEntry[] = [];

    const addFixed = (mes: number, dia: number, nombre: string) => {
      festivos.push({
        fecha: this.formatIso(anio, mes, dia),
        nombre,
        esOficialLey: true,
      });
    };

    const addEmiliani = (mes: number, dia: number, nombre: string) => {
      const d = new Date(anio, mes - 1, dia);
      const dayOfWeek = d.getDay(); // 0 = Domingo, 1 = Lunes ...
      if (dayOfWeek !== 1) {
        const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
        d.setDate(d.getDate() + daysToAdd);
      }
      festivos.push({
        fecha: this.formatDate(d),
        nombre,
        esOficialLey: true,
      });
    };

    // 1. Festivos Fijos Inamovibles
    addFixed(1, 1, 'Año Nuevo');
    addFixed(5, 1, 'Día del Trabajo');
    addFixed(7, 20, 'Día de la Independencia');
    addFixed(8, 7, 'Batalla de Boyacá');
    addFixed(12, 8, 'Inmaculada Concepción');
    addFixed(12, 25, 'Navidad');

    // 2. Festivos trasladables por Ley Emiliani
    addEmiliani(1, 6, 'Día de los Reyes Magos');
    addEmiliani(3, 19, 'Día de San José');
    addEmiliani(6, 29, 'San Pedro y San Pablo');
    addEmiliani(8, 15, 'Asunción de la Virgen');
    addEmiliani(10, 12, 'Día de la Raza');
    addEmiliani(11, 1, 'Todos los Santos');
    addEmiliani(11, 11, 'Independencia de Cartagena');

    // 3. Festivos calculados respecto al Domingo de Pascua (Algoritmo Butcher/Meeus)
    const pascua = this.calcularDomingoPascua(anio);

    const addOffsetPascua = (diasOffset: number, nombre: string) => {
      const d = new Date(pascua.getTime());
      d.setDate(d.getDate() + diasOffset);
      festivos.push({
        fecha: this.formatDate(d),
        nombre,
        esOficialLey: true,
      });
    };

    addOffsetPascua(-3, 'Jueves Santo');
    addOffsetPascua(-2, 'Viernes Santo');
    addOffsetPascua(43, 'Ascensión del Señor');
    addOffsetPascua(64, 'Corpus Christi');
    addOffsetPascua(71, 'Sagrado Corazón de Jesús');

    return festivos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  private static calcularDomingoPascua(anio: number): Date {
    const a = anio % 19;
    const b = Math.floor(anio / 100);
    const c = anio % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(anio, mes - 1, dia);
  }

  private static formatIso(anio: number, mes: number, dia: number): string {
    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    return `${anio}-${mm}-${dd}`;
  }

  private static formatDate(d: Date): string {
    return this.formatIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
}
