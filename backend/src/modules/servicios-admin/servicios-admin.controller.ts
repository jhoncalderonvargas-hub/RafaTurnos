import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function normalizarTipoAsistencia(tipo: any): any {
  if (!tipo) return 'URGENCIAS';
  const val = String(tipo).trim().toUpperCase();
  if (val === 'UCI' || val === 'CUIDADOS_INTENSIVOS') return 'CUIDADOS_INTENSIVOS';
  if (val === 'AMBULATORIO' || val === 'CONSULTA_EXTERNA') return 'CONSULTA_EXTERNA';
  if (val === 'QUIRURGICO') return 'QUIRURGICO';
  if (val === 'HOSPITALIZACION') return 'HOSPITALIZACION';
  if (val === 'APOYO_DIAGNOSTICO') return 'APOYO_DIAGNOSTICO';
  if (val === 'URGENCIAS') return 'URGENCIAS';
  return 'CONSULTA_EXTERNA';
}

@Controller('api/v1/servicios-admin')
export class ServiciosAdminController {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Listar todos los servicios con sus servicios hermanos enlazados
  @Get()
  async listarServicios() {
    const servicios = await this.prisma.servicio.findMany({
      include: {
        serviciosHermanosOrigen: {
          include: { servicioHermano: true },
        },
        _count: {
          select: { empleadosBase: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return servicios.map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      tipoAsistencia: s.tipoAsistencia,
      intranetId: s.intranetId,
      reqManana: 4,
      reqTarde: 4,
      reqNoche: 2,
      empleadosCount: s._count.empleadosBase,
      hermanos: s.serviciosHermanosOrigen.map((sh) => ({
        id: sh.servicioHermano.id,
        codigo: sh.servicioHermano.codigo,
        nombre: sh.servicioHermano.nombre,
      })),
    }));
  }

  // 1.1 Listar todos los empleados con sus categorías y saldos
  @Get('empleados')
  async listarEmpleados() {
    return this.prisma.empleado.findMany({
      include: {
        categoria: true,
        servicioBase: true,
        saldosBancoHoras: {
          orderBy: { actualizadoEn: 'desc' },
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  // 1.2 Listar el catálogo maestro de tipos de turno
  @Get('turnos')
  async listarTiposTurno() {
    return this.prisma.tipoTurno.findMany({
      orderBy: { codigo: 'asc' },
    });
  }

  // 1.3 Crear o actualizar un tipo de turno en el catálogo maestro (PostgreSQL)
  @Post('turnos')
  async guardarTipoTurno(
    @Body()
    data: {
      codigo: string;
      nombre: string;
      horaInicio: string;
      horaFin: string;
      horasOrdinarias: number;
      horasDiurnas: number;
      horasNocturnas: number;
      colorHex: string;
      descuentaBancoHoras?: boolean;
      esNocturnoPesado?: boolean;
    }
  ) {
    const cod = data.codigo.trim().toUpperCase();
    return this.prisma.tipoTurno.upsert({
      where: { codigo: cod },
      create: {
        codigo: cod,
        nombre: data.nombre.trim(),
        horaInicio: data.horaInicio,
        horaFin: data.horaFin,
        horasOrdinarias: Number(data.horasOrdinarias) || 0,
        horasDiurnas: Number(data.horasDiurnas) || 0,
        horasNocturnas: Number(data.horasNocturnas) || 0,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        esNocturnoPesado: !!data.esNocturnoPesado,
      },
      update: {
        nombre: data.nombre.trim(),
        horaInicio: data.horaInicio,
        horaFin: data.horaFin,
        horasOrdinarias: Number(data.horasOrdinarias) || 0,
        horasDiurnas: Number(data.horasDiurnas) || 0,
        horasNocturnas: Number(data.horasNocturnas) || 0,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        esNocturnoPesado: !!data.esNocturnoPesado,
      },
    });
  }

  // 2. Crear un servicio nuevo (autónomo en Rafa Turnos)
  @Post()
  async crearServicio(
    @Body()
    data: {
      codigo: string;
      nombre: string;
      tipoAsistencia: any;
      intranetId?: string;
    }
  ) {
    const cod = data.codigo?.trim().toUpperCase();
    const nom = data.nombre?.trim();

    if (!cod || !nom) {
      throw new BadRequestException('El código y el nombre del servicio son obligatorios.');
    }

    const existente = await this.prisma.servicio.findUnique({
      where: { codigo: cod },
    });
    if (existente) {
      throw new ConflictException(`El código de servicio '${cod}' ya se encuentra registrado por '${existente.nombre}'.`);
    }

    return this.prisma.servicio.create({
      data: {
        codigo: cod,
        nombre: nom,
        tipoAsistencia: normalizarTipoAsistencia(data.tipoAsistencia),
        intranetId: data.intranetId,
      },
    });
  }

  // 2.1 Actualizar datos de un servicio existente
  @Put(':id')
  async actualizarServicio(
    @Param('id') id: string,
    @Body()
    data: {
      codigo: string;
      nombre: string;
      tipoAsistencia: any;
    }
  ) {
    const cod = data.codigo?.trim().toUpperCase();
    const nom = data.nombre?.trim();

    if (!cod || !nom) {
      throw new BadRequestException('El código y el nombre del servicio son obligatorios.');
    }

    const enConflicto = await this.prisma.servicio.findFirst({
      where: {
        codigo: cod,
        NOT: { id },
      },
    });
    if (enConflicto) {
      throw new ConflictException(`El código '${cod}' ya está en uso por otro servicio (${enConflicto.nombre}).`);
    }

    return this.prisma.servicio.update({
      where: { id },
      data: {
        codigo: cod,
        nombre: nom,
        tipoAsistencia: normalizarTipoAsistencia(data.tipoAsistencia),
      },
    });
  }

  // 2.2 Eliminar un servicio si no tiene restricciones de integridad
  @Delete(':id')
  async eliminarServicio(@Param('id') id: string) {
    const servicio = await this.prisma.servicio.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            empleadosBase: true,
            cuadrantes: true,
            asignacionesEjecutadas: true,
          },
        },
      },
    });

    if (!servicio) {
      throw new NotFoundException('El servicio no existe o ya fue eliminado.');
    }

    if (servicio._count.empleadosBase > 0) {
      throw new ConflictException(
        `No es posible eliminar el servicio '${servicio.nombre}' porque tiene ${servicio._count.empleadosBase} colaborador(es) adscrito(s). Trasládelos antes de eliminar.`
      );
    }

    if (servicio._count.cuadrantes > 0 || servicio._count.asignacionesEjecutadas > 0) {
      throw new ConflictException(
        `No es posible eliminar el servicio '${servicio.nombre}' porque contiene historial de turnos o cuadrantes generados.`
      );
    }

    // Se eliminan los vínculos de hermanos
    await this.prisma.servicioHermano.deleteMany({
      where: {
        OR: [{ servicioId: id }, { servicioHermanoId: id }],
      },
    });

    await this.prisma.servicioTurnoHabilitado.deleteMany({
      where: { servicioId: id },
    });

    await this.prisma.servicio.delete({
      where: { id },
    });

    return { mensaje: "Servicio '" + servicio.nombre + "' eliminado correctamente." };
  }

  // 3. Enlazar dos "Servicios Hermanos" para habilitar rotación de personal homólogo
  @Post(':id/enlace-hermano/:hermanoId')
  async enlazarServiciosHermanos(
    @Param('id') servicioId: string,
    @Param('hermanoId') hermanoId: string
  ) {
    await this.prisma.servicioHermano.upsert({
      where: {
        servicioId_servicioHermanoId: { servicioId, servicioHermanoId: hermanoId },
      },
      create: { servicioId, servicioHermanoId: hermanoId },
      update: {},
    });

    await this.prisma.servicioHermano.upsert({
      where: {
        servicioId_servicioHermanoId: { servicioId: hermanoId, servicioHermanoId: servicioId },
      },
      create: { servicioId: hermanoId, servicioHermanoId: servicioId },
      update: {},
    });

    return { mensaje: 'Servicios enlazados exitosamente como Hermanos para rotación homóloga.' };
  }

  // 4. Desenlazar servicios hermanos
  @Delete(':id/enlace-hermano/:hermanoId')
  async desenlazarServiciosHermanos(
    @Param('id') servicioId: string,
    @Param('hermanoId') hermanoId: string
  ) {
    await this.prisma.servicioHermano.deleteMany({
      where: {
        OR: [
          { servicioId, servicioHermanoId: hermanoId },
          { servicioId: hermanoId, servicioHermanoId: servicioId },
        ],
      },
    });
    return { mensaje: 'Enlace de servicios hermanos eliminado.' };
  }

  // 5. Adscribir o trasladar un colaborador a un servicio base
  @Put('adscribir-empleado')
  async adscribirEmpleadoAServicio(
    @Body() body: { empleadoId: string; servicioBaseId: string }
  ) {
    return this.prisma.empleado.update({
      where: { id: body.empleadoId },
      data: { servicioBaseId: body.servicioBaseId },
    });
  }
}
