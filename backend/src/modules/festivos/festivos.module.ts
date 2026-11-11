import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { FestivoDto, FestivosColombiaService } from './festivos-colombia.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  esFechaIsoValida,
  formatearPorcentaje,
  hoyColombiaIso,
  recargosVigentes,
} from '../../shared/liquidacion-horas';

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
    const anio = anioStr ? Number(anioStr) : Number(hoyColombiaIso().substring(0, 4));
    if (!Number.isInteger(anio) || anio < 1900 || anio > 2100) {
      throw new BadRequestException('El parámetro anio debe ser un año válido (1900–2100).');
    }
    const oficiales = this.festivosService.generarFestivosAlgoritmo(anio);

    const festivosDb = await this.prisma.festivoColombia.findMany({
      where: { anio },
    });

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
    if (!esFechaIsoValida(fechaIso)) {
      throw new BadRequestException(`Fecha ISO inválida: "${fechaIso}". Se requiere formato YYYY-MM-DD existente en calendario.`);
    }

    const anio = Number(fechaIso.substring(0, 4));
    await this.festivosService.asegurarAnios([anio, anio + 1]);
    const esEnCache = this.festivosService.esFestivo(fechaIso);

    const dateObj = new Date(`${fechaIso}T00:00:00.000Z`);
    const reg = await this.prisma.festivoColombia.findUnique({
      where: { fecha: dateObj },
    });
    const esFestivo = esEnCache || Boolean(reg);

    return {
      fecha: fechaIso,
      esFestivo,
      recargoLegalCst: esFestivo
        ? `${formatearPorcentaje(recargosVigentes(fechaIso).dominical)} Dominical/Festivo (Art. 179 CST, Ley 2466/2025)`
        : '0% Día Ordinario',
    };
  }

  @Post('dia-civico')
  async registrarDiaCivicoInstitucional(
    @Body() body: { fecha: string; nombre: string }
  ): Promise<{ mensaje: string; festivo: FestivoDto }> {
    const fecha = String(body?.fecha || '').trim();
    const nombre = String(body?.nombre || '').trim();

    if (!esFechaIsoValida(fecha)) {
      throw new BadRequestException(`La fecha "${fecha}" no es válida en calendario (YYYY-MM-DD).`);
    }
    if (!nombre) {
      throw new BadRequestException('El nombre o motivo del Día Cívico es obligatorio.');
    }

    const anio = Number(fecha.substring(0, 4));
    const esOficialAlgoritmo = this.festivosService
      .generarFestivosAlgoritmo(anio)
      .some((f) => f.fecha === fecha);
    const dateObj = new Date(`${fecha}T00:00:00.000Z`);
    const existenteDb = await this.prisma.festivoColombia.findUnique({
      where: { fecha: dateObj },
    });

    if (esOficialAlgoritmo || existenteDb?.esOficialLey) {
      throw new ConflictException(
        `La fecha ${fecha} corresponde a un festivo oficial de ley en Colombia y no puede sobrescribirse como Día Cívico.`
      );
    }

    const nuevo: FestivoDto = {
      fecha,
      anio,
      nombre,
      esOficialLey: false,
    };

    await this.prisma.festivoColombia.upsert({
      where: { fecha: dateObj },
      create: {
        fecha: dateObj,
        anio,
        nombre,
        esOficialLey: false,
        esIrrenunciable: true,
      },
      update: {
        nombre,
        esOficialLey: false,
      },
    });

    const todos = await this.obtenerFestivosPorAnio(String(anio));
    await this.festivosService.invalidarYRefrescarAnio(
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
    if (!esFechaIsoValida(fechaIso)) {
      throw new BadRequestException(`Fecha ISO inválida: "${fechaIso}". Se requiere YYYY-MM-DD.`);
    }

    const anio = Number(fechaIso.substring(0, 4));
    const esOficialAlgoritmo = this.festivosService
      .generarFestivosAlgoritmo(anio)
      .some((f) => f.fecha === fechaIso);
    const dateObj = new Date(`${fechaIso}T00:00:00.000Z`);
    const existenteDb = await this.prisma.festivoColombia.findUnique({
      where: { fecha: dateObj },
    });

    if (esOficialAlgoritmo || existenteDb?.esOficialLey) {
      throw new ConflictException(
        `La fecha ${fechaIso} es un festivo oficial de ley y no puede eliminarse.`
      );
    }

    await this.prisma.festivoColombia.deleteMany({
      where: { fecha: dateObj, esOficialLey: false },
    });

    const todos = await this.obtenerFestivosPorAnio(String(anio));
    await this.festivosService.invalidarYRefrescarAnio(
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
