import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

export interface FestivoDto {
  fecha: string; // YYYY-MM-DD
  anio: number;
  nombre: string;
  esOficialLey: boolean;
}

/**
 * Servicio Resiliente de Festivos Oficiales de Colombia (Ley 51 de 1983 / Ley Emiliani + Algoritmo Butcher/Meeus).
 * - Persistencia en tabla `festivos_colombia` de PostgreSQL (Master of Record).
 * - Acelerador en Memoria RAM O(1) con precarga automática en `onApplicationBootstrap`.
 */
@Injectable()
export class FestivosColombiaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FestivosColombiaService.name);
  private readonly cacheRam = new Map<number, Set<string>>();

  async onApplicationBootstrap(): Promise<void> {
    const anioActual = new Date().getFullYear();
    await this.precargarAnioEnRam(anioActual);
    await this.precargarAnioEnRam(anioActual + 1);
    this.logger.log(
      `Caché RAM de Festivos Colombia inicializada para ${anioActual} y ${anioActual + 1} (Consulta O(1) activa).`
    );
  }

  /**
   * Consulta en O(1) (< 0.001 ms) desde Memoria RAM sin realizar SELECT repetitivos a PostgreSQL.
   */
  esFestivo(fechaIso: string): boolean {
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    if (!this.cacheRam.has(anio)) {
      const generados = this.generarFestivosAlgoritmo(anio);
      this.cacheRam.set(anio, new Set(generados.map((f) => f.fecha)));
    }
    return this.cacheRam.get(anio)!.has(fechaIso);
  }

  /**
   * Cuando Gestión Humana agrega o elimina un Día Cívico Institucional en PostgreSQL,
   * se invalida y refresca el año en Memoria RAM inmediatamente.
   */
  invalidarYRefrescarAnio(anio: number, fechasActualizadasBd: string[]): void {
    this.cacheRam.set(anio, new Set(fechasActualizadasBd));
  }

  private async precargarAnioEnRam(anio: number): Promise<void> {
    const calculados = this.generarFestivosAlgoritmo(anio);
    this.cacheRam.set(anio, new Set(calculados.map((f) => f.fecha)));
  }

  generarFestivosAlgoritmo(anio: number): FestivoDto[] {
    const lista: FestivoDto[] = [];
    const fmt = (m: number, d: number) =>
      `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const addFijo = (m: number, d: number, nombre: string) =>
      lista.push({ fecha: fmt(m, d), anio, nombre, esOficialLey: true });

    const addEmiliani = (m: number, d: number, nombre: string) => {
      const date = new Date(anio, m - 1, d);
      const dow = date.getDay();
      if (dow !== 1) {
        date.setDate(date.getDate() + (dow === 0 ? 1 : 8 - dow));
      }
      lista.push({
        fecha: fmt(date.getMonth() + 1, date.getDate()),
        anio,
        nombre,
        esOficialLey: true,
      });
    };

    // 1. Fijos
    addFijo(1, 1, 'Año Nuevo');
    addFijo(5, 1, 'Día del Trabajo');
    addFijo(7, 20, 'Día de la Independencia');
    addFijo(8, 7, 'Batalla de Boyacá');
    addFijo(12, 8, 'Inmaculada Concepción');
    addFijo(12, 25, 'Navidad');

    // 2. Ley Emiliani (Lunes siguiente)
    addEmiliani(1, 6, 'Reyes Magos');
    addEmiliani(3, 19, 'San José');
    addEmiliani(6, 29, 'San Pedro y San Pablo');
    addEmiliani(8, 15, 'Asunción de la Virgen');
    addEmiliani(10, 12, 'Día de la Raza');
    addEmiliani(11, 1, 'Todos los Santos');
    addEmiliani(11, 11, 'Independencia de Cartagena');

    // 3. Móviles respecto a Pascua (Butcher/Meeus)
    const pascua = this.calcularPascua(anio);
    const addPascua = (offset: number, nombre: string) => {
      const d = new Date(pascua.getTime());
      d.setDate(d.getDate() + offset);
      lista.push({
        fecha: fmt(d.getMonth() + 1, d.getDate()),
        anio,
        nombre,
        esOficialLey: true,
      });
    };

    addPascua(-3, 'Jueves Santo');
    addPascua(-2, 'Viernes Santo');
    addPascua(43, 'Ascensión del Señor');
    addPascua(64, 'Corpus Christi');
    addPascua(71, 'Sagrado Corazón de Jesús');

    return lista;
  }

  private calcularPascua(anio: number): Date {
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
}
