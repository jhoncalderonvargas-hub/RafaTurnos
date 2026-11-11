import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  combinarReglasEmpresa,
  PLANTILLA_CST_LEY_2466,
  PLANTILLA_DECRETO_1042,
  PLANTILLA_PERSONALIZADA_DEFAULT,
} from '../../shared/liquidacion-horas';
import { LiquidacionModule, LiquidacionService } from '../liquidacion/liquidacion.module';

export interface EmpresaContratanteDto {
  codigo: string;
  nombre: string;
  nit?: string | null;
  aliasesCodigo?: string[];
  estadoConfiguracion?: 'CONFIRMADA' | 'PENDIENTE_REGLAS';
  plantillaNormativa?: 'DECRETO_1042' | 'CST_LEY_2466' | 'PERSONALIZADA';
  horasSemanalesContrato?: number;
  diasBaseSemana?: number;
  horaInicioNocturnoMin?: number;
  horaFinNocturnoMin?: number;
  porcentajeRecargoNocturno?: number;
  modoRecargoDominical?: 'LEY_2466' | 'FIJO';
  porcentajeRecargoDominicalFijo?: number | null;
  aplicaTopeHorasExtrasSemanal?: boolean;
  topeHorasExtrasSemanal?: number;
  usaBancoHoras?: boolean;
  activa?: boolean;
  observaciones?: string | null;
  confirmar?: boolean;
}

@Controller('api/v1/empresas')
export class EmpresasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liquidacionService: LiquidacionService
  ) {}

  private normalizarPayloadEmpresa(dto: Partial<EmpresaContratanteDto>, existente?: any) {
    const base = {
      ...(existente || {}),
      ...dto,
    };

    const codigo = String(dto.codigo ?? existente?.codigo ?? '')
      .trim()
      .toUpperCase();
    const nombre = String(dto.nombre ?? existente?.nombre ?? '').trim();
    if (!codigo || !nombre) {
      throw new BadRequestException('El código y el nombre de la empresa contratante son obligatorios.');
    }

    const plantilla = String(base.plantillaNormativa || 'CST_LEY_2466')
      .trim()
      .toUpperCase();
    if (!['DECRETO_1042', 'CST_LEY_2466', 'PERSONALIZADA'].includes(plantilla)) {
      throw new BadRequestException(`Plantilla normativa inválida: "${plantilla}".`);
    }

    const horasSem = Number(base.horasSemanalesContrato ?? 42);
    if (!Number.isFinite(horasSem) || horasSem <= 0 || horasSem > 72) {
      throw new BadRequestException(
        'horasSemanalesContrato debe ser un valor numérico válido mayor a 0 y <= 72.'
      );
    }

    const diasBase = Math.round(Number(base.diasBaseSemana ?? 6));
    if (!Number.isInteger(diasBase) || diasBase < 1 || diasBase > 7) {
      throw new BadRequestException('diasBaseSemana debe estar entre 1 y 7 días.');
    }

    const horaInicioNocturnoMin = Math.round(Number(base.horaInicioNocturnoMin ?? 1140));
    if (
      !Number.isFinite(horaInicioNocturnoMin) ||
      horaInicioNocturnoMin < 720 ||
      horaInicioNocturnoMin > 1440
    ) {
      throw new BadRequestException(
        'horaInicioNocturnoMin debe expresarse en minutos del día entre 720 (12:00) y 1440 (24:00).'
      );
    }

    const horaFinNocturnoMin = Math.round(Number(base.horaFinNocturnoMin ?? 360));
    if (
      !Number.isFinite(horaFinNocturnoMin) ||
      horaFinNocturnoMin < 0 ||
      horaFinNocturnoMin > 720
    ) {
      throw new BadRequestException(
        'horaFinNocturnoMin debe expresarse en minutos del día entre 0 (00:00) y 720 (12:00).'
      );
    }

    const pctNocturno = Number(base.porcentajeRecargoNocturno ?? 0.35);
    if (!Number.isFinite(pctNocturno) || pctNocturno < 0 || pctNocturno > 3) {
      throw new BadRequestException('porcentajeRecargoNocturno inválido.');
    }

    const modoDominical = String(base.modoRecargoDominical || 'LEY_2466')
      .trim()
      .toUpperCase();
    if (!['LEY_2466', 'FIJO'].includes(modoDominical)) {
      throw new BadRequestException('modoRecargoDominical debe ser LEY_2466 o FIJO.');
    }

    let pctDomFijo: number | null = null;
    if (modoDominical === 'FIJO') {
      const parsedDom = Number(base.porcentajeRecargoDominicalFijo ?? 1.0);
      if (!Number.isFinite(parsedDom) || parsedDom < 0 || parsedDom > 3) {
        throw new BadRequestException(
          'porcentajeRecargoDominicalFijo es obligatorio cuando modoRecargoDominical = FIJO.'
        );
      }
      pctDomFijo = parsedDom;
    }

    const topeExtras = Number(base.topeHorasExtrasSemanal ?? 12);
    if (!Number.isFinite(topeExtras) || topeExtras < 0 || topeExtras > 48) {
      throw new BadRequestException('topeHorasExtrasSemanal debe estar entre 0 y 48 horas.');
    }

    const aliasesCodigo: string[] = Array.isArray(base.aliasesCodigo)
      ? Array.from(
          new Set<string>(
            base.aliasesCodigo
              .map((a: any) => String(a || '').trim().toUpperCase())
              .filter(Boolean)
          )
        )
      : [];

    const estadoConfiguracion =
      dto.confirmar === true
        ? 'CONFIRMADA'
        : String(base.estadoConfiguracion || 'CONFIRMADA').toUpperCase() === 'PENDIENTE_REGLAS'
          ? 'PENDIENTE_REGLAS'
          : 'CONFIRMADA';

    const nit = base.nit !== undefined && base.nit !== null && String(base.nit).trim()
      ? String(base.nit).trim()
      : null;

    return {
      codigo,
      nombre,
      nit,
      aliasesCodigo,
      estadoConfiguracion,
      plantillaNormativa: plantilla,
      horasSemanalesContrato: horasSem,
      diasBaseSemana: diasBase,
      horaInicioNocturnoMin,
      horaFinNocturnoMin,
      porcentajeRecargoNocturno: pctNocturno,
      modoRecargoDominical: modoDominical,
      porcentajeRecargoDominicalFijo: pctDomFijo,
      aplicaTopeHorasExtrasSemanal: base.aplicaTopeHorasExtrasSemanal !== false,
      topeHorasExtrasSemanal: topeExtras,
      usaBancoHoras: base.usaBancoHoras !== false,
      activa: base.activa !== false,
      observaciones: base.observaciones !== undefined ? base.observaciones : null,
    };
  }

  @Get()
  async listarEmpresas() {
    const empresas = await this.prisma.empresaContratante.findMany({
      include: {
        _count: {
          select: { empleados: true },
        },
      },
      orderBy: [{ estadoConfiguracion: 'desc' }, { nombre: 'asc' }],
    });

    return empresas.map((e) => ({
      ...e,
      empleadosCount: e._count?.empleados || 0,
      reglasEfectivas: combinarReglasEmpresa(e),
    }));
  }

  @Get('plantillas')
  obtenerPlantillasNormativas() {
    return [
      {
        codigo: 'DECRETO_1042',
        nombre: 'Planta Pública ESE (Decreto 1042)',
        descripcion: '44 h/sem (o configurable), nocturno 18:00–06:00, dominical y festivo 100% fijo.',
        parametros: PLANTILLA_DECRETO_1042,
      },
      {
        codigo: 'CST_LEY_2466',
        nombre: 'Operador Privado / Temporal (CST + Ley 2466)',
        descripcion: '42 h/sem Ley 2101, nocturno 19:00–06:00 y dominical gradual (90% jul-2026 -> 100% jul-2027).',
        parametros: PLANTILLA_CST_LEY_2466,
      },
      {
        codigo: 'PERSONALIZADA',
        nombre: 'Agremiación / Régimen Editable',
        descripcion: 'Parámetros libres de jornada semanal, franja nocturna, recargos y Banco de Horas.',
        parametros: PLANTILLA_PERSONALIZADA_DEFAULT,
      },
    ];
  }

  @Post()
  async crearEmpresa(@Body() body: EmpresaContratanteDto) {
    const data = this.normalizarPayloadEmpresa(body);

    const dupCod = await this.prisma.empresaContratante.findUnique({
      where: { codigo: data.codigo },
    });
    if (dupCod) {
      throw new ConflictException(`Ya existe una empresa con el código "${data.codigo}".`);
    }
    if (data.nit) {
      const dupNit = await this.prisma.empresaContratante.findUnique({
        where: { nit: data.nit },
      });
      if (dupNit) {
        throw new ConflictException(`Ya existe una empresa registrada con el NIT "${data.nit}".`);
      }
    }

    const creada: any = await this.prisma.empresaContratante.create({
      data,
      include: { _count: { select: { empleados: true } } },
    });
    return {
      ...creada,
      empleadosCount: creada._count?.empleados || 0,
    };
  }

  @Put(':id')
  async actualizarEmpresa(
    @Param('id') id: string,
    @Body() body: Partial<EmpresaContratanteDto>
  ) {
    const existente = await this.prisma.empresaContratante.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundException(`No se encontró la empresa contratante "${id}".`);
    }

    const data = this.normalizarPayloadEmpresa(body, existente);

    if (data.codigo !== existente.codigo) {
      const dupCod = await this.prisma.empresaContratante.findFirst({
        where: { codigo: data.codigo, NOT: { id } },
      });
      if (dupCod) {
        throw new ConflictException(`El código "${data.codigo}" ya pertenece a otra empresa.`);
      }
    }
    if (data.nit && data.nit !== existente.nit) {
      const dupNit = await this.prisma.empresaContratante.findFirst({
        where: { nit: data.nit, NOT: { id } },
      });
      if (dupNit) {
        throw new ConflictException(`El NIT "${data.nit}" ya pertenece a otra empresa.`);
      }
    }

    const actualizada: any = await this.prisma.empresaContratante.update({
      where: { id },
      data,
      include: { _count: { select: { empleados: true } } },
    });

    await this.prisma.empleado.updateMany({
      where: { empresaContratanteId: id, horasSemanalesOverride: null },
      data: { horasSemanalesLey: Math.round(actualizada.horasSemanalesContrato) },
    });

    const recalculo = await this.liquidacionService.recalcularPorEmpresa(id);

    return {
      ...actualizada,
      empleadosCount: actualizada._count?.empleados || 0,
      recalculo,
    };
  }

  @Post(':id/confirmar-reglas')
  async confirmarReglasEmpresa(
    @Param('id') id: string,
    @Body() body?: Partial<EmpresaContratanteDto>
  ) {
    return this.actualizarEmpresa(id, {
      ...(body || {}),
      confirmar: true,
      estadoConfiguracion: 'CONFIRMADA',
    });
  }

  @Delete(':id')
  async eliminarEmpresa(@Param('id') id: string) {
    const existente = await this.prisma.empresaContratante.findUnique({
      where: { id },
      include: { _count: { select: { empleados: true } } },
    });
    if (!existente) {
      throw new NotFoundException(`No se encontró la empresa contratante "${id}".`);
    }
    if ((existente._count?.empleados || 0) > 0) {
      throw new ConflictException(
        `No es posible eliminar la empresa "${existente.nombre}" porque tiene ${existente._count.empleados} colaborador(es) vinculado(s).`
      );
    }

    await this.prisma.empresaContratante.delete({ where: { id } });
    return { ok: true, mensaje: `Empresa "${existente.nombre}" eliminada.` };
  }
}

@Module({
  imports: [LiquidacionModule],
  controllers: [EmpresasController],
})
export class EmpresasModule {}
