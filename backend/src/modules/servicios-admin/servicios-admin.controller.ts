import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    return this.prisma.servicio.create({
      data: {
        codigo: data.codigo.toUpperCase(),
        nombre: data.nombre,
        tipoAsistencia: data.tipoAsistencia,
        intranetId: data.intranetId,
      },
    });
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
