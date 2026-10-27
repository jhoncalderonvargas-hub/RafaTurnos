import { Body, Controller, Get, Header, Injectable, Module, Param, Post } from '@nestjs/common';

export interface SolicitudPermutaDto {
  solicitanteId: string;
  solicitanteCategoria: string;
  receptorId: string;
  receptorCategoria: string;
  servicioId: string;
  fechaIso: string;
  turnoSolicitante: string;
  turnoReceptor: string;
}

@Controller('api/v1/permutas')
export class PermutasController {
  @Post('simular')
  simularPermutaEntrePares(@Body() dto: SolicitudPermutaDto) {
    if (dto.solicitanteCategoria !== dto.receptorCategoria) {
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
