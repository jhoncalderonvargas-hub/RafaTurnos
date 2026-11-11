import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { esFechaIsoValida, hoyColombiaIso } from '../../shared/liquidacion-horas';

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
  private readonly listenersCambio: Array<(anio: number) => void | Promise<void>> = [];
  private readonly colaRecalculosPorAnio = new Map<number, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const anioActual = Number(hoyColombiaIso().substring(0, 4));
    await this.precargarAnioEnRam(anioActual - 1);
    await this.precargarAnioEnRam(anioActual);
    await this.precargarAnioEnRam(anioActual + 1);
    this.logger.log(
      `Caché RAM de Festivos Colombia (algoritmo + Días Cívicos de PostgreSQL) inicializada para ${anioActual - 1}–${anioActual + 1} (Consulta O(1) activa).`
    );
  }

  /**
   * Consulta en O(1) (< 0.001 ms) desde Memoria RAM sin realizar SELECT repetitivos a PostgreSQL.
   * Para años no precargados usa solo el algoritmo; usar `asegurarAnios` antes de liquidar para incluir Días Cívicos de BD.
   */
  esFestivo(fechaIso: string): boolean {
    if (!esFechaIsoValida(fechaIso)) return false;
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    if (!this.cacheRam.has(anio)) {
      const generados = this.generarFestivosAlgoritmo(anio);
      this.cacheRam.set(anio, new Set(generados.map((f) => f.fecha)));
    }
    return this.cacheRam.get(anio)!.has(fechaIso);
  }

  /** Garantiza que los años indicados estén en RAM incluyendo los Días Cívicos persistidos en PostgreSQL. */
  async asegurarAnios(anios: number[]): Promise<void> {
    for (const anio of new Set(anios)) {
      if (!Number.isInteger(anio) || anio < 1900 || anio > 2100) continue;
      if (!this.cacheRam.has(anio)) {
        await this.precargarAnioEnRam(anio);
      }
    }
  }

  /** Permite a otros módulos (p. ej. liquidación) reaccionar cuando cambian los festivos de un año. */
  registrarListenerCambio(fn: (anio: number) => void | Promise<void>): void {
    this.listenersCambio.push(fn);
  }

  /**
   * Cuando Gestión Humana agrega o elimina un Día Cívico Institucional en PostgreSQL,
   * se invalida y refresca el año en Memoria RAM inmediatamente y se serializa la notificación a los listeners
   * por año para evitar condiciones de carrera (TOCTOU) si llegan múltiples cambios consecutivos.
   */
  invalidarYRefrescarAnio(anio: number, fechasActualizadasBd: string[]): Promise<void> {
    this.cacheRam.set(anio, new Set(fechasActualizadasBd));
    const previa = this.colaRecalculosPorAnio.get(anio) || Promise.resolve();
    const siguiente = previa
      .catch(() => undefined)
      .then(async () => {
        for (const fn of this.listenersCambio) {
          try {
            await fn(anio);
          } catch (e: any) {
            this.logger.error(
              `Error recalculando liquidación tras cambio de festivos ${anio}: ${e?.message || e}`
            );
          }
        }
      });
    this.colaRecalculosPorAnio.set(anio, siguiente);
    return siguiente;
  }

  private async precargarAnioEnRam(anio: number): Promise<void> {
    const fechas = new Set(this.generarFestivosAlgoritmo(anio).map((f) => f.fecha));
    try {
      const enBd = await this.prisma.festivoColombia.findMany({ where: { anio }, select: { fecha: true } });
      for (const f of enBd) fechas.add(f.fecha.toISOString().substring(0, 10));
    } catch (e: any) {
      this.logger.warn(`No se pudieron leer festivos ${anio} de PostgreSQL (se usa solo el algoritmo): ${e?.message || e}`);
    }
    this.cacheRam.set(anio, fechas);
  }

  generarFestivosAlgoritmo(anio: number): FestivoDto[] {
    const lista: FestivoDto[] = [];
    const fmt = (m: number, d: number) =>
      `${anio}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    const addFijo = (m: number, d: number, nombre: string) =>
      lista.push({ fecha: fmt(m, d), anio, nombre, esOficialLey: true });

    const addEmiliani = (m: number, d: number, nombre: string) => {
      const date = new Date(Date.UTC(anio, m - 1, d));
      const dow = date.getUTCDay();
      if (dow !== 1) {
        date.setUTCDate(date.getUTCDate() + (dow === 0 ? 1 : 8 - dow));
      }
      lista.push({
        fecha: fmt(date.getUTCMonth() + 1, date.getUTCDate()),
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

    // 3. Móviles respecto a Pascua (Butcher/Meeus en UTC)
    const pascua = this.calcularPascua(anio);
    const addPascua = (offset: number, nombre: string) => {
      const d = new Date(pascua.getTime());
      d.setUTCDate(d.getUTCDate() + offset);
      lista.push({
        fecha: fmt(d.getUTCMonth() + 1, d.getUTCDate()),
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
    return new Date(Date.UTC(anio, mes - 1, dia));
  }
}
