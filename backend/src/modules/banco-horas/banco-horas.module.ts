import { Controller, Get, Injectable, Module, Post, Query, Body } from '@nestjs/common';

export interface CalculoBancoHorasInput {
  empleadoId: string;
  documento: string;
  nombre: string;
  anio: number;
  mes: number;
  saldoInicialMesAnterior: number;
  horasContratoMes: number;
  horasRealesTrabajadas: number;
  turnosCompensatoriosTomados: number; // Cada turno COMP amortiza 6h u 8h
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
    honRecargo35: number;
    hdfdRecargo75: number;
    hdfnRecargo110: number;
    domingosLaborados: number;
    diasCompensatoriosCausados: number;
  };
  // Trazabilidad continua del Banco de Horas (Sin periodicidad de caducidad - RN-BH02)
  bancoDeHoras: {
    saldoAnterior: number;
    horasContratadas: number;
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
    const horasAmortizadas = input.turnosCompensatoriosTomados * 6;
    const diferenciaMes =
      input.horasRealesTrabajadas - input.horasContratoMes - horasAmortizadas;
    const nuevoSaldo = input.saldoInicialMesAnterior + diferenciaMes;

    let estadoAlerta: 'EQUILIBRADO' | 'ATENCION_ACUMULACION' | 'CRITICO_SOBREACUMULACION' =
      'EQUILIBRADO';
    if (nuevoSaldo > 30 || nuevoSaldo < -20) {
      estadoAlerta = 'CRITICO_SOBREACUMULACION';
    } else if (nuevoSaldo > 18 || nuevoSaldo < -10) {
      estadoAlerta = 'ATENCION_ACUMULACION';
    }

    return {
      empleadoId: input.empleadoId,
      documento: input.documento,
      nombre: input.nombre,
      periodo: `${input.anio}-${String(input.mes).padStart(2, '0')}`,
      conceptosNominaMesCorriente: {
        hod: input.hod,
        honRecargo35: input.hon,
        hdfdRecargo75: input.hdfd,
        hdfnRecargo110: input.hdfn,
        domingosLaborados: input.domingosHabituales,
        diasCompensatoriosCausados: input.domingosHabituales >= 3 ? 1 : 0,
      },
      bancoDeHoras: {
        saldoAnterior: input.saldoInicialMesAnterior,
        horasContratadas: input.horasContratoMes,
        horasTrabajadas: input.horasRealesTrabajadas,
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
        'Cero valores monetarios ($). Los recargos nocturnos (35%) y festivos (75%) se liquidan en el mes corriente; el banco solo arrastra tiempo ordinario.',
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
