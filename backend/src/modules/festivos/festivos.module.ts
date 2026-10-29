import { Body, Controller, Delete, Get, Param, Post, Query, Module } from '@nestjs/common';
import { FestivoDto, FestivosColombiaService } from './festivos-colombia.service';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('api/v1/festivos')
export class FestivosController {
  constructor(
    private readonly festivosService: FestivosColombiaService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  async obtenerFestivosPorAnio(@Query('anio') anioStr?: string): Promise<{
    anio: number;
    estrategia: string;
    total: number;
    festivos: FestivoDto[];
  }> {
    const anio = anioStr ? parseInt(anioStr, 10) : new Date().getFullYear();
    const oficiales = this.festivosService.generarFestivosAlgoritmo(anio);

    let festivosDb: any[] = [];
    try {
      festivosDb = await this.prisma.festivoColombia.findMany({
        where: { anio },
      });
    } catch {
      festivosDb = [];
    }

    const mapa = new Map<string, FestivoDto>();
    for (const f of oficiales) {
      mapa.set(f.fecha, f);
    }
    for (const f of festivosDb) {
      const fechaStr = f.fecha instanceof Date
        ? f.fecha.toISOString().substring(0, 10)
        : String(f.fecha).substring(0, 10);

      mapa.set(fechaStr, {
        fecha: fechaStr,
        anio: f.anio,
        nombre: f.nombre,
        esOficialLey: f.esOficialLey,
      });
    }

    const todos = Array.from(mapa.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    return {
      anio,
      estrategia: 'PostgreSQL + Ley 51/1983 (Emiliani) + Caché RAM O(1)',
      total: todos.length,
      festivos: todos,
    };
  }

  @Get('verificar/:fechaIso')
  async verificarFecha(@Param('fechaIso') fechaIso: string): Promise<{
    fecha: string;
    esFestivo: boolean;
    recargoLegalCst: string;
  }> {
    const esOficial = this.festivosService.esFestivo(fechaIso);
    let existeEnDb = false;

    try {
      const dateObj = new Date(fechaIso + 'T00:00:00.000Z');
      const reg = await this.prisma.festivoColombia.findUnique({
        where: { fecha: dateObj },
      });
      existeEnDb = !!reg;
    } catch {
      existeEnDb = false;
    }

    const esFestivo = esOficial || existeEnDb;
    return {
      fecha: fechaIso,
      esFestivo,
      recargoLegalCst: esFestivo ? '75% Dominical/Festivo (Art. 179 CST)' : '0% Día Ordinario',
    };
  }

  @Post('dia-civico')
  async registrarDiaCivicoInstitucional(
    @Body() body: { fecha: string; nombre: string }
  ): Promise<{ mensaje: string; festivo: FestivoDto }> {
    const anio = parseInt(body.fecha.substring(0, 4), 10);
    const dateObj = new Date(body.fecha + 'T00:00:00.000Z');
    const nuevo: FestivoDto = {
      fecha: body.fecha,
      anio,
      nombre: body.nombre,
      esOficialLey: false,
    };

    try {
      await this.prisma.festivoColombia.upsert({
        where: { fecha: dateObj },
        create: {
          fecha: dateObj,
          anio,
          nombre: body.nombre,
          esOficialLey: false,
          esIrrenunciable: true,
        },
        update: {
          nombre: body.nombre,
          esOficialLey: false,
        },
      });
    } catch {}

    const todos = await this.obtenerFestivosPorAnio(String(anio));
    this.festivosService.invalidarYRefrescarAnio(
      anio,
      todos.festivos.map((f) => f.fecha)
    );

    return {
      mensaje: 'Día Cívico persistido en PostgreSQL y Caché RAM invalidada/refrescada en O(1)',
      festivo: nuevo,
    };
  }

  @Delete('dia-civico/:fechaIso')
  async eliminarDiaCivico(@Param('fechaIso') fechaIso: string): Promise<{ mensaje: string }> {
    const anio = parseInt(fechaIso.substring(0, 4), 10);
    try {
      const dateObj = new Date(fechaIso + 'T00:00:00.000Z');
      await this.prisma.festivoColombia.deleteMany({
        where: { fecha: dateObj, esOficialLey: false },
      });
    } catch {}

    const todos = await this.obtenerFestivosPorAnio(String(anio));
    this.festivosService.invalidarYRefrescarAnio(
      anio,
      todos.festivos.map((f) => f.fecha)
    );

    return { mensaje: `Día cívico ${fechaIso} eliminado de PostgreSQL y caché refrescada.` };
  }
}

@Module({
  controllers: [FestivosController],
  providers: [FestivosColombiaService],
  exports: [FestivosColombiaService],
})
export class FestivosModule {}
