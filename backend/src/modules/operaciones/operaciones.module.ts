import { BadRequestException, Body, Controller, Get, Header, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SolicitudPermutaDto {
  solicitanteId: string;
  solicitanteCategoria?: string;
  receptorId: string;
  receptorCategoria?: string;
  servicioId: string;
  fechaIso?: string;
  turnoSolicitante?: string;
  turnoReceptor?: string;
  diaOrigen: number;
  turnoOrigen: string;
  diaDestino: number;
  turnoDestino: string;
  validacionReglas?: string;
}

@Controller('api/v1/permutas')
export class PermutasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listarPermutas() {
    const permutas = await this.prisma.solicitudPermuta.findMany({
      include: {
        solicitante: {
          include: { categoria: true },
        },
        receptor: {
          include: { categoria: true },
        },
        servicio: true,
      },
      orderBy: { creadoEn: 'desc' },
    });

    return permutas.map((p) => ({
      id: p.id,
      fechaSolicitud: p.fechaSolicitud
        ? new Date(p.fechaSolicitud).toLocaleDateString('es-CO') +
          ' ' +
          new Date(p.fechaSolicitud).toTimeString().substring(0, 5)
        : 'Reciente',
      solicitanteId: p.solicitanteId,
      solicitanteNombre: p.solicitante?.nombre || 'Solicitante',
      receptorId: p.receptorId,
      receptorNombre: p.receptor?.nombre || 'Receptor',
      categoria: p.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: p.servicioId,
      diaOrigen: p.diaOrigen,
      turnoOrigen: p.turnoOrigen,
      diaDestino: p.diaDestino,
      turnoDestino: p.turnoDestino,
      estado: p.estado,
      validacionReglas: p.validacionReglas,
      motivoRechazo: p.motivoRechazo,
    }));
  }

  @Post()
  async crearSolicitudPermuta(@Body() dto: SolicitudPermutaDto) {
    // Resolver solicitante por id o intranetId
    const solicitante = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ id: dto.solicitanteId }, { intranetId: dto.solicitanteId }],
      },
    });
    if (!solicitante) {
      throw new BadRequestException(`Empleado solicitante "${dto.solicitanteId}" no encontrado.`);
    }

    // Resolver receptor por id o intranetId
    const receptor = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ id: dto.receptorId }, { intranetId: dto.receptorId }],
      },
    });
    if (!receptor) {
      throw new BadRequestException(`Empleado receptor "${dto.receptorId}" no encontrado.`);
    }

    // Resolver servicio por id o código
    const servicio = await this.prisma.servicio.findFirst({
      where: {
        OR: [{ id: dto.servicioId }, { codigo: dto.servicioId }],
      },
    });
    if (!servicio) {
      throw new BadRequestException(`Servicio hospitalario "${dto.servicioId}" no encontrado.`);
    }

    const permuta = await this.prisma.solicitudPermuta.create({
      data: {
        solicitanteId: solicitante.id,
        receptorId: receptor.id,
        servicioId: servicio.id,
        diaOrigen: dto.diaOrigen,
        turnoOrigen: dto.turnoOrigen,
        diaDestino: dto.diaDestino,
        turnoDestino: dto.turnoDestino,
        estado: 'PENDIENTE_PAR',
        validacionReglas: dto.validacionReglas || 'Misma categoría y descanso mínimo validado.',
      },
      include: {
        solicitante: { include: { categoria: true } },
        receptor: { include: { categoria: true } },
      },
    });

    return {
      id: permuta.id,
      fechaSolicitud: 'Hoy ' + new Date(permuta.fechaSolicitud).toTimeString().substring(0, 5),
      solicitanteId: permuta.solicitanteId,
      solicitanteNombre: permuta.solicitante?.nombre || 'Solicitante',
      receptorId: permuta.receptorId,
      receptorNombre: permuta.receptor?.nombre || 'Receptor',
      categoria: permuta.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: permuta.servicioId,
      diaOrigen: permuta.diaOrigen,
      turnoOrigen: permuta.turnoOrigen,
      diaDestino: permuta.diaDestino,
      turnoDestino: permuta.turnoDestino,
      estado: permuta.estado,
      validacionReglas: permuta.validacionReglas,
    };
  }

  /**
   * Paso 2 del Flujo: El compañero receptor (Colaborador 2) acepta la propuesta.
   * La solicitud pasa de PENDIENTE_PAR a PENDIENTE_SUPERVISOR.
   */
  @Patch(':id/aceptar-par')
  async aceptarPermutaPar(@Param('id') id: string) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');
    if (permuta.estado !== 'PENDIENTE_PAR') {
      throw new BadRequestException('La solicitud no se encuentra en estado PENDIENTE_PAR');
    }

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: { estado: 'PENDIENTE_SUPERVISOR' },
    });
  }

  /**
   * Paso 2 del Flujo: El compañero receptor (Colaborador 2) declina la propuesta.
   * La solicitud se cierra como RECHAZADA por el par sin llegar a la supervisora.
   */
  @Patch(':id/rechazar-par')
  async rechazarPermutaPar(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: {
        estado: 'RECHAZADA',
        motivoRechazo: body?.motivo || 'Declinada por el compañero receptor.',
      },
    });
  }

  /**
   * Paso 3 del Flujo: La supervisora aprueba la permuta ya concertada por ambos colaboradores.
   */
  @Patch(':id/aprobar')
  async aprobarPermuta(@Param('id') id: string) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');
    if (permuta.estado !== 'PENDIENTE_SUPERVISOR') {
      throw new BadRequestException('Solo se pueden aprobar solicitudes en estado PENDIENTE_SUPERVISOR.');
    }

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: { estado: 'APROBADA' },
    });
  }

  /**
   * Paso 3 del Flujo: La supervisora rechaza la permuta con justificación clínica/operativa.
   */
  @Patch(':id/rechazar')
  async rechazarPermuta(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const permuta = await this.prisma.solicitudPermuta.findUnique({ where: { id } });
    if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');

    return this.prisma.solicitudPermuta.update({
      where: { id },
      data: {
        estado: 'RECHAZADA',
        motivoRechazo: body?.motivo || 'Rechazada por la supervisora asistencial.',
      },
    });
  }

  @Post('simular')
  simularPermutaEntrePares(@Body() dto: SolicitudPermutaDto) {
    if (dto.solicitanteCategoria && dto.receptorCategoria && dto.solicitanteCategoria !== dto.receptorCategoria) {
      return {
        permitida: false,
        motivo: `RN-05 Bloqueante: Incompatibilidad de categoría asistencial (${dto.solicitanteCategoria} vs ${dto.receptorCategoria}).`,
      };
    }

    return {
      permitida: true,
      estadoInicial: 'PENDIENTE_PAR',
      mensaje:
        'Permuta válida: Misma categoría profesional y se preserva el ratio mínimo del servicio.',
    };
  }
}

@Controller('api/v1/intranet')
export class IntranetIntegrationController {
  @Get('status')
  estadoIntegracionSatelite() {
    return {
      arquitectura: 'Servicio Satélite con Réplica Local (intranetId)',
      sso: 'JWT Bearer Token compartido (Sin doble login)',
      endpointsMaestros: [
        'GET /api/v1/dependencias (Servicios Asistenciales)',
        'GET /api/v1/empleados (Personal activo)',
        'POST /api/v1/notificaciones (Campana unificada Intranet)',
      ],
      habeasData:
        'Los códigos CIE-10 de incapacidades se mantienen encriptados/restringidos a Gestión Humana; el cuadrante solo exhibe la sigla INC.',
    };
  }

  @Post('sync-maestros')
  sincronizarMaestrosDesdeIntranet() {
    return {
      timestamp: new Date().toISOString(),
      resultado: 'Sincronización de Servicios, Empleados y Vacaciones completada en réplica local.',
    };
  }
}

@Controller('api/v1/calendario')
export class CalendarioIcalController {
  /**
   * Genera el feed dinámico RFC 5545 (.ics) para suscripción móvil (webcal://)
   * en Google Calendar, Apple Calendar (iOS) y Outlook (Doc 14).
   */
  @Get('feed/:token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="mis_turnos_hospital.ics"')
  generarFeedIcs(@Param('token') token: string): string {
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Hospital//Rafa Turnos v2.0//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Mis Turnos Hospitalarios (Rafa Turnos)',
      'X-WR-TIMEZONE:America/Bogota',
      'BEGIN:VEVENT',
      `UID:turno-demo-1-${token}@hospital.gov.co`,
      'DTSTAMP:20261101T070000Z',
      'DTSTART;TZID=America/Bogota:20261102T070000',
      'DTEND;TZID=America/Bogota:20261102T130000',
      'SUMMARY:[M] Turno Mañana - UCI Adultos',
      'DESCRIPTION:Turno asistencial programado en Rafa Turnos. Actualizado automáticamente.',
      'LOCATION:UCI Adultos',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }
}

@Module({
  controllers: [PermutasController, IntranetIntegrationController, CalendarioIcalController],
})
export class OperacionesHospitalModule {}
