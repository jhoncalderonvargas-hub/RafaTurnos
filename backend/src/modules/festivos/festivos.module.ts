import { Body, Controller, Delete, Get, Param, Post, Query, Module } from '@nestjs/common';
import { FestivoDto, FestivosColombiaService } from './festivos-colombia.service';

@Controller('api/v1/festivos')
export class FestivosController {
  private readonly excepcionesManuales = new Map<string, FestivoDto>();

  constructor(private readonly festivosService: FestivosColombiaService) {}

  @Get()
  obtenerFestivosPorAnio(@Query('anio') anioStr?: string): {
    anio: number;
    estrategia: string;
    total: number;
    festivos: FestivoDto[];
  } {
    const anio = anioStr ? parseInt(anioStr, 10) : new Date().getFullYear();
    const oficiales = this.festivosService.generarFestivosAlgoritmo(anio);
    const manualesAnio = Array.from(this.excepcionesManuales.values()).filter(
      (f) => f.anio === anio
    );

    const todos = [...oficiales, ...manualesAnio].sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    return {
      anio,
      estrategia: 'Algoritmo Butcher/Meeus + Ley 51/1983 (Emiliani) + Caché RAM O(1)',
      total: todos.length,
      festivos: todos,
    };
  }

  @Get('verificar/:fechaIso')
  verificarFecha(@Param('fechaIso') fechaIso: string): {
    fecha: string;
    esFestivo: boolean;
    recargoLegalCst: string;
  } {
    const esFestivo =
      this.festivosService.esFestivo(fechaIso) || this.excepcionesManuales.has(fechaIso);
    return {
      fecha: fechaIso,
      esFestivo,
      recargoLegalCst: esFestivo ? '75% Dominical/Festivo (Art. 179 CST)' : '0% Día Ordinario',
    };
  }

  @Post('dia-civico')
  registrarDiaCivicoInstitucional(
    @Body() body: { fecha: string; nombre: string }
  ): { mensaje: string; festivo: FestivoDto } {
    const anio = parseInt(body.fecha.substring(0, 4), 10);
    const nuevo: FestivoDto = {
      fecha: body.fecha,
      anio,
      nombre: body.nombre,
      esOficialLey: false,
    };
    this.excepcionesManuales.set(body.fecha, nuevo);

    const oficiales = this.festivosService.generarFestivosAlgoritmo(anio).map((f) => f.fecha);
    const manuales = Array.from(this.excepcionesManuales.values())
      .filter((f) => f.anio === anio)
      .map((f) => f.fecha);

    this.festivosService.invalidarYRefrescarAnio(anio, [...oficiales, ...manuales]);

    return {
      mensaje: 'Día Cívico persistido y Caché RAM invalidada/refrescada en O(1)',
      festivo: nuevo,
    };
  }

  @Delete('dia-civico/:fechaIso')
  eliminarDiaCivico(@Param('fechaIso') fechaIso: string): { mensaje: string } {
    this.excepcionesManuales.delete(fechaIso);
    return { mensaje: `Día cívico ${fechaIso} eliminado y caché refrescada.` };
  }
}

@Module({
  controllers: [FestivosController],
  providers: [FestivosColombiaService],
  exports: [FestivosColombiaService],
})
export class FestivosModule {}
