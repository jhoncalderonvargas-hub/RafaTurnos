import { Controller, Get, Injectable, Module, Post, Body } from '@nestjs/common';
import {
  calcularDiasCompensatoriosDominicales,
  calcularMetaContractualProrrateada,
  evaluarEstadoBancoHoras,
  HORAS_AMORTIZACION_COMP_DEFAULT,
  r2,
  recargosVigentes,
} from '../../shared/liquidacion-horas';

export interface CalculoBancoHorasInput {
  empleadoId: string;
  documento: string;
  nombre: string;
  anio: number;
  mes: number;
  saldoInicialMesAnterior: number;
  horasContratoMes: number;
  horasRealesTrabajadas: number;
  turnosCompensatoriosTomados: number;
  horasAmortizadasComp?: number;
  diasExonerados?: number;
  diasDelMes?: number;
  hod: number;
  hon: number;
  hdfd: number;
  hdfn: number;
  domingosHabituales: number;
}

export interface ResultadoBancoYNominaDto {
  empleadoId: string;
  documento: string;
  nombre: string;
  periodo: string;
  // Conceptos CST que se pagan en la nómina del mes en curso (RN-BH01)
  conceptosNominaMesCorriente: {
    hod: number;
    hon: number;
    hdfd: number;
    hdfn: number;
    domingosLaborados: number;
    diasCompensatoriosCausados: number;
    /** Porcentajes de recargo vigentes en el periodo (fracción: 0.9 = 90%). Ley 2466/2025 Art. 14. */
    recargos: {
      nocturno: number;
      dominical: number;
      nocturnoDominical: number;
    };
  };
  // Trazabilidad continua del Banco de Horas (Sin periodicidad de caducidad - RN-BH02)
  bancoDeHoras: {
    saldoAnterior: number;
    horasContratadas: number;
    horasContratadasNominales: number;
    horasExoneradas: number;
    horasTrabajadas: number;
    horasAmortizadasPorTurnoComp: number;
    diferenciaMesActual: number;
    nuevoSaldoAcumuladoContinuo: number;
    estadoAlerta: 'EQUILIBRADO' | 'ATENCION_ACUMULACION' | 'CRITICO_SOBREACUMULACION';
  };
}

@Injectable()
export class BancoHorasNominaService {
  /**
   * Calcula el balance mensual continuo del Banco de Horas y separa estrictamente
   * los recargos económicos de ley (CST) para el reporte de Nómina (Doc 10 y Doc 18).
   */
  calcularCierreMensualColaborador(
    input: CalculoBancoHorasInput
  ): ResultadoBancoYNominaDto {
    const diasMes =
      input.diasDelMes && input.diasDelMes > 0
        ? Math.round(input.diasDelMes)
        : new Date(Date.UTC(Number(input.anio), Number(input.mes), 0)).getUTCDate() || 30;
    const meta = calcularMetaContractualProrrateada(
      input.horasContratoMes,
      diasMes,
      input.diasExonerados || 0
    );

    const horasAmortizadas =
      input.horasAmortizadasComp !== undefined
        ? r2(Math.max(0, Number(input.horasAmortizadasComp) || 0))
        : r2(
            (Number(input.turnosCompensatoriosTomados) || 0) *
              HORAS_AMORTIZACION_COMP_DEFAULT
          );

    const diferenciaMes = r2(
      input.horasRealesTrabajadas - meta.horasContratadasEfectivas - horasAmortizadas
    );
    const nuevoSaldo = r2(input.saldoInicialMesAnterior + diferenciaMes);
    const recargos = recargosVigentes(
      `${input.anio}-${String(input.mes).padStart(2, '0')}-01`
    );

    const estadoBase = evaluarEstadoBancoHoras(nuevoSaldo);
    const estadoAlerta: 'EQUILIBRADO' | 'ATENCION_ACUMULACION' | 'CRITICO_SOBREACUMULACION' =
      estadoBase === 'CRITICO'
        ? 'CRITICO_SOBREACUMULACION'
        : estadoBase === 'ATENCION'
          ? 'ATENCION_ACUMULACION'
          : 'EQUILIBRADO';

    return {
      empleadoId: input.empleadoId,
      documento: input.documento,
      nombre: input.nombre,
      periodo: `${input.anio}-${String(input.mes).padStart(2, '0')}`,
      conceptosNominaMesCorriente: {
        hod: r2(input.hod),
        hon: r2(input.hon),
        hdfd: r2(input.hdfd),
        hdfn: r2(input.hdfn),
        domingosLaborados: input.domingosHabituales,
        diasCompensatoriosCausados: calcularDiasCompensatoriosDominicales(
          input.domingosHabituales
        ),
        recargos: {
          nocturno: recargos.nocturno,
          dominical: recargos.dominical,
          nocturnoDominical: recargos.nocturnoDominical,
        },
      },
      bancoDeHoras: {
        saldoAnterior: r2(input.saldoInicialMesAnterior),
        horasContratadas: meta.horasContratadasEfectivas,
        horasContratadasNominales: meta.horasContratadasNominales,
        horasExoneradas: meta.horasExoneradas,
        horasTrabajadas: r2(input.horasRealesTrabajadas),
        horasAmortizadasPorTurnoComp: horasAmortizadas,
        diferenciaMesActual: diferenciaMes,
        nuevoSaldoAcumuladoContinuo: nuevoSaldo,
        estadoAlerta,
      },
    };
  }
}

@Controller('api/v1/banco-horas-nomina')
export class BancoHorasNominaController {
  constructor(private readonly service: BancoHorasNominaService) {}

  @Post('simular-cierre')
  simularCierreEmpleado(
    @Body() body: CalculoBancoHorasInput
  ): ResultadoBancoYNominaDto {
    return this.service.calcularCierreMensualColaborador(body);
  }

  @Get('politica')
  obtenerPoliticaBancoHoras() {
    return {
      modelo: 'Banco de Horas Acumulativo Continuo',
      periodicidadCaducidad: 'NINGUNA (Sin corte semestral ni anual; arrastre perpetuo mes a mes)',
      desacoplamientoFinanciero:
        'Cero valores monetarios ($). Los recargos (nocturno 35%; dominical/festivo gradual Ley 2466/2025: 90% desde jul-2026, 100% desde jul-2027) se liquidan en el mes corriente; el banco solo arrastra tiempo ordinario. Ver GET /api/v1/liquidacion/vigencias.',
      codigoTurnoAmortizacion: 'COMP',
    };
  }
}

@Module({
  controllers: [BancoHorasNominaController],
  providers: [BancoHorasNominaService],
  exports: [BancoHorasNominaService],
})
export class BancoHorasNominaModule {}
