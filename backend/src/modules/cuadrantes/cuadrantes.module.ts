import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';

export interface ValidacionTurnoDto {
  empleadoId: string;
  fechaIso: string;
  turnoPrevioDiaAnterior: string;
  turnoPropuesto: string;
  tieneAusenciaActiva: boolean;
}

@Injectable()
export class CuadrantesReglasService {
  constructor(private readonly festivosService: FestivosColombiaService) {}

  /**
   * Valida las Reglas de Negocio Clínicas y Normativas CST (Doc 02 y Doc 04):
   * - RN-01: Descanso mínimo de 12 horas entre turnos.
   * - RN-02: Protección obligatoria Post-Guardia (tras N o G24 debe ir S o L).
   * - RN-03: Bloqueo por Novedad (VAC / INC).
   */
  validarAsignacionCelda(dto: ValidacionTurnoDto): {
    esValido: boolean;
    esFestivoColombia: boolean;
    alertas: string[];
  } {
    const alertas: string[] = [];

    if (dto.tieneAusenciaActiva) {
      alertas.push(
        'RN-03 Bloqueante: El colaborador presenta vacaciones (VAC) o incapacidad médica (INC) activa en la fecha.'
      );
    }

    if (
      (dto.turnoPrevioDiaAnterior === 'N' || dto.turnoPrevioDiaAnterior === 'G24') &&
      ['M', 'T', 'N', 'G12', 'G24'].includes(dto.turnoPropuesto)
    ) {
      alertas.push(
        `RN-01 / RN-02 Bloqueante: Infracción Post-Guardia y descanso < 12h. El día previo finalizó en ${dto.turnoPrevioDiaAnterior}, requiere Saliente (S) o Libre (L).`
      );
    }

    return {
      esValido: alertas.length === 0,
      esFestivoColombia: this.festivosService.esFestivo(dto.fechaIso),
      alertas,
    };
  }
}

@Controller('api/v1/cuadrantes')
export class CuadrantesController {
  constructor(private readonly reglasService: CuadrantesReglasService) {}

  @Post('validar-celda')
  validarCelda(@Body() body: ValidacionTurnoDto) {
    return this.reglasService.validarAsignacionCelda(body);
  }

  @Get('rotacion-homologos')
  consultarReglaRotacion(@Query('tipoAsistencia') tipoAsistencia = 'CUIDADOS_INTENSIVOS') {
    return {
      tipoAsistencia,
      regla:
        'Un colaborador solo puede rotar hacia servicios que compartan exactamente el mismo tipoAsistencia y manteniendo unicidad global @@unique([empleadoId, fecha]).',
    };
  }
}

@Module({
  imports: [FestivosModule],
  controllers: [CuadrantesController],
  providers: [CuadrantesReglasService],
})
export class CuadrantesModule {}
