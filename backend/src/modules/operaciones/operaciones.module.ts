import { BadRequestException, Body, ConflictException, Controller, Get, Header, Headers, Injectable, Module, NotFoundException, Optional, Param, Patch, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { FestivosColombiaService } from '../festivos/festivos-colombia.service';
import { FestivosModule } from '../festivos/festivos.module';
import {
  resolverEmpresaDesdeIntranet,
  resolverServicioPorMacroprocesoYCargo,
} from '../empresas/empresas-matching.util';
import { LiquidacionModule, LiquidacionService, TipoTurnoLiquidableDb, toTurnoLiquidable } from '../liquidacion/liquidacion.module';
import {
  calcularDescansoEntreTurnosMin,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  r2,
  sumarDiasIso,
  turnoEsLaborado,
} from '../../shared/liquidacion-horas';
import { firmarJwtHmac, PayloadTokenSsoIntranet, RolUsuarioSso, verificarJwtHmac } from './jwt-sso.util';

/** Marcador usado en tipos_turno para una celda explícitamente en blanco (ver CuadrantesController). */
const CODIGO_CELDA_VACIA_DB = 'BLANCO';

/** Normaliza un código de turno para comparar: vacío / BLANCO / null se tratan como Libre (L), igual que el frontend. */
const normalizarCodigo = (cod?: string | null): string => {
  const u = (cod || '').trim().toUpperCase();
  return !u || u === CODIGO_CELDA_VACIA_DB ? 'L' : u;
};

const formatearFechaHoraBogota = (fecha?: Date | string | null): string => {
  if (!fecha) return 'Reciente';
  const d = new Date(fecha);
  return (
    d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) +
    ' ' +
    d.toLocaleTimeString('es-CO', {
      timeZone: 'America/Bogota',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  );
};

export interface SolicitudPermutaDto {
  solicitanteId: string;
  solicitanteCategoria?: string;
  receptorId: string;
  receptorCategoria?: string;
  servicioId: string;
  anio?: number;
  mes?: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly liquidacionService: LiquidacionService,
    private readonly festivosService: FestivosColombiaService
  ) {}

  private async validarPermutaEnServidor(
    params: {
      solicitanteId: string;
      receptorId: string;
      servicioId: string;
      anio: number;
      mes: number;
      diaOrigen: number;
      turnoOrigen: string;
      diaDestino: number;
      turnoDestino: string;
    },
    tx?: Prisma.TransactionClient
  ) {
    const db = tx || this.prisma;
    if (!Number.isInteger(params.anio) || !Number.isInteger(params.mes) || params.mes < 1 || params.mes > 12) {
      throw new BadRequestException(`Periodo de permuta inválido (${params.anio}-${params.mes}).`);
    }
    const ultimoDiaMes = new Date(Date.UTC(params.anio, params.mes, 0)).getUTCDate();
    if (
      !Number.isInteger(params.diaOrigen) ||
      params.diaOrigen < 1 ||
      params.diaOrigen > ultimoDiaMes ||
      !Number.isInteger(params.diaDestino) ||
      params.diaDestino < 1 ||
      params.diaDestino > ultimoDiaMes
    ) {
      throw new BadRequestException(
        `Los días de permuta (${params.diaOrigen}, ${params.diaDestino}) están fuera del periodo ${params.anio}-${params.mes}.`
      );
    }

    const [solicitante, receptor, servicio] = await Promise.all([
      db.empleado.findFirst({
        where: { OR: [{ id: params.solicitanteId }, { intranetId: params.solicitanteId }] },
        include: { categoria: true },
      }),
      db.empleado.findFirst({
        where: { OR: [{ id: params.receptorId }, { intranetId: params.receptorId }] },
        include: { categoria: true },
      }),
      db.servicio.findFirst({
        where: { OR: [{ id: params.servicioId }, { codigo: params.servicioId }] },
        include: {
          cargosPermitidos: { select: { categoriaId: true } },
        },
      }),
    ]);

    if (!solicitante) {
      throw new BadRequestException(`Empleado solicitante "${params.solicitanteId}" no encontrado.`);
    }
    if (!receptor) {
      throw new BadRequestException(`Empleado receptor "${params.receptorId}" no encontrado.`);
    }
    if (!servicio) {
      throw new BadRequestException(`Servicio hospitalario "${params.servicioId}" no encontrado.`);
    }
    if (solicitante.id === receptor.id) {
      throw new BadRequestException('No es posible crear o aprobar una auto-permuta con el mismo colaborador.');
    }

    const cargosPermIds = new Set<string>(
      Array.isArray((servicio as any).cargosPermitidos)
        ? (servicio as any).cargosPermitidos.map((cp: any) => cp.categoriaId)
        : []
    );
    const permiteMultiCargo =
      Boolean((servicio as any).permitePermutaEntreCargos) &&
      cargosPermIds.has(solicitante.categoriaId) &&
      cargosPermIds.has(receptor.categoriaId);

    if (solicitante.categoriaId !== receptor.categoriaId && !permiteMultiCargo) {
      const detalleMulti = (servicio as any).permitePermutaEntreCargos
        ? ' Además, uno o ambos cargos no están habilitados conjuntamente en este servicio.'
        : '';
      throw new ConflictException(
        `RN-05 Bloqueante: Incompatibilidad de cargo profesional (${solicitante.categoria?.nombre || solicitante.categoriaId} vs ${receptor.categoria?.nombre || receptor.categoriaId}).${detalleMulti}`
      );
    }

    const cuadrante = await db.cuadrante.findUnique({
      where: {
        anio_mes_servicioId: {
          anio: params.anio,
          mes: params.mes,
          servicioId: servicio.id,
        },
      },
      select: { id: true, estado: true },
    });
    if (!cuadrante || cuadrante.estado === 'BORRADOR') {
      throw new ConflictException(
        'Solo se permiten permutas sobre cuadrantes en estado PUBLICADO.'
      );
    }
    if (cuadrante.estado === 'CERRADO_NOMINA') {
      throw new ConflictException(
        'El cuadrante de este periodo se encuentra CERRADO para nómina. Reábrelo para tramitar permutas.'
      );
    }

    const tiposCatalogo = await db.tipoTurno.findMany();
    const mapaTipos = new Map<string, TipoTurnoLiquidableDb>(
      (Array.isArray(tiposCatalogo) ? tiposCatalogo : []).map((t: any) => [
        String(t.codigo || '').toUpperCase(),
        t,
      ])
    );

    const codOri = normalizarCodigo(params.turnoOrigen);
    const codDes = normalizarCodigo(params.turnoDestino);
    const esTurnoBloqueadoPermuta = (cod: string): boolean => {
      const cfg = mapaTipos.get(cod.toUpperCase()) as any;
      if (cfg && typeof cfg.bloqueaPermutas === 'boolean') {
        return Boolean(cfg.bloqueaPermutas || cfg.esAusencia);
      }
      if (cfg && typeof cfg.esAusencia === 'boolean' && cfg.esAusencia) {
        return true;
      }
      return esCodigoExoneracionContrato(cod);
    };
    if (esTurnoBloqueadoPermuta(codOri) || esTurnoBloqueadoPermuta(codDes)) {
      throw new ConflictException(
        'RN-03 Bloqueante: El tipo de turno seleccionado bloquea permutas o corresponde a una novedad oficial de RRHH.'
      );
    }

    const isoOri = `${params.anio}-${String(params.mes).padStart(2, '0')}-${String(params.diaOrigen).padStart(2, '0')}`;
    const isoDes = `${params.anio}-${String(params.mes).padStart(2, '0')}-${String(params.diaDestino).padStart(2, '0')}`;
    const fechaOriUtc = new Date(`${isoOri}T00:00:00.000Z`);
    const fechaDesUtc = new Date(`${isoDes}T00:00:00.000Z`);

    const [novSol, novRec, asigOri, asigDes] = await Promise.all([
      db.novedadAusencia.findFirst({
        where: { empleadoId: solicitante.id, fechaInicio: { lte: fechaOriUtc }, fechaFin: { gte: fechaOriUtc } },
      }),
      db.novedadAusencia.findFirst({
        where: { empleadoId: receptor.id, fechaInicio: { lte: fechaDesUtc }, fechaFin: { gte: fechaDesUtc } },
      }),
      db.asignacionTurno.findUnique({
        where: { empleadoId_fecha: { empleadoId: solicitante.id, fecha: fechaOriUtc } },
        include: { tipoTurno: true, servicioEjecutor: { select: { nombre: true } } },
      }),
      db.asignacionTurno.findUnique({
        where: { empleadoId_fecha: { empleadoId: receptor.id, fecha: fechaDesUtc } },
        include: { tipoTurno: true, servicioEjecutor: { select: { nombre: true } } },
      }),
    ]);

    if (novSol || novRec) {
      throw new ConflictException(
        `RN-03 Bloqueante: Novedad oficial activa (${(novSol || novRec)?.tipo}) bloquea el intercambio en esa fecha.`
      );
    }

    const esCeldaEspejoAjena = (asig: any) => {
      if (!asig || !asig.servicioEjecutorId || asig.servicioEjecutorId === servicio.id) {
        return false;
      }
      const cod = String(asig.tipoTurno?.codigo || '').trim().toUpperCase();
      if (!cod || cod === CODIGO_CELDA_VACIA_DB) return false;
      if (typeof asig.tipoTurno?.horasOrdinarias === 'number') {
        return turnoEsLaborado(toTurnoLiquidable(asig.tipoTurno, cod));
      }
      return !['L', 'S', CODIGO_CELDA_VACIA_DB, ''].includes(cod) && !esCodigoExoneracionContrato(cod);
    };

    if (esCeldaEspejoAjena(asigOri) || esCeldaEspejoAjena(asigDes)) {
      const ajena = esCeldaEspejoAjena(asigOri) ? asigOri : asigDes;
      throw new ConflictException(
        `Celda Espejo bloqueada: El turno "${ajena?.tipoTurno?.codigo}" pertenece a "${ajena?.servicioEjecutor?.nombre || ajena?.servicioEjecutorId}".`
      );
    }

    // Verificar que los turnos enviados coincidan con la foto actual en PostgreSQL
    const actualOriDb = normalizarCodigo(asigOri?.tipoTurno?.codigo);
    const actualDesDb = normalizarCodigo(asigDes?.tipoTurno?.codigo);
    if (actualOriDb !== codOri || actualDesDb !== codDes) {
      throw new ConflictException(
        `Los turnos solicitados no coinciden con el cuadrante actual en PostgreSQL (${solicitante.nombre} día ${params.diaOrigen}: actual ${actualOriDb} vs ${codOri}; ${receptor.nombre} día ${params.diaDestino}: actual ${actualDesDb} vs ${codDes}).`
      );
    }

    // Validar descanso mínimo (>= 12h) y regla Post-Guardia Pesada contra día anterior y día siguiente (incluye cruce de mes)
    const fechasVecinas = [
      new Date(`${sumarDiasIso(isoOri, -1)}T00:00:00.000Z`),
      new Date(`${sumarDiasIso(isoOri, 1)}T00:00:00.000Z`),
      new Date(`${sumarDiasIso(isoDes, -1)}T00:00:00.000Z`),
      new Date(`${sumarDiasIso(isoDes, 1)}T00:00:00.000Z`),
    ];

    const vecinasDb = await db.asignacionTurno.findMany({
      where: {
        empleadoId: { in: [solicitante.id, receptor.id] },
        fecha: { in: fechasVecinas },
      },
      include: { tipoTurno: true },
    });

    const mapaVecinas = new Map<string, TipoTurnoLiquidableDb>();
    for (const v of vecinasDb) {
      mapaVecinas.set(`${v.empleadoId}::${new Date(v.fecha).toISOString().substring(0, 10)}`, v.tipoTurno);
    }

    const validarEmpEnDia = (
      empNombre: string,
      empId: string,
      fechaIso: string,
      nuevoCod: string
    ) => {
      const cfgNuevo = mapaTipos.get(nuevoCod.toUpperCase());
      const codPrev = normalizarCodigo(mapaVecinas.get(`${empId}::${sumarDiasIso(fechaIso, -1)}`)?.codigo);
      const cfgPrev = mapaTipos.get(codPrev.toUpperCase());
      const codSig = normalizarCodigo(mapaVecinas.get(`${empId}::${sumarDiasIso(fechaIso, 1)}`)?.codigo);
      const cfgSig = mapaTipos.get(codSig.toUpperCase());

      const nuevoLaborado = turnoEsLaborado(toTurnoLiquidable(cfgNuevo, nuevoCod));
      if (cfgPrev?.esNocturnoPesado && cfgNuevo && nuevoLaborado) {
        throw new ConflictException(
          `RN-01 Bloqueante (${empNombre}): El día previo fue ${codPrev} (post-guardia), exige descanso o saliente.`
        );
      }
      const descPrev = calcularDescansoEntreTurnosMin(
        toTurnoLiquidable(cfgPrev, codPrev),
        toTurnoLiquidable(cfgNuevo, nuevoCod)
      );
      if (descPrev !== null && descPrev < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
        throw new ConflictException(
          `RN-02 Bloqueante (${empNombre}): Solo ${r2(descPrev / 60)}h de descanso entre ${codPrev} (día previo) y ${nuevoCod} (< 12h legales).`
        );
      }

      const sigLaborado = turnoEsLaborado(toTurnoLiquidable(cfgSig, codSig));
      if (cfgNuevo?.esNocturnoPesado && cfgSig && sigLaborado) {
        throw new ConflictException(
          `RN-01 Bloqueante (${empNombre}): Asignar ${nuevoCod} antes de ${codSig} incumple el saliente/libre obligatorio.`
        );
      }
      const descSig = calcularDescansoEntreTurnosMin(
        toTurnoLiquidable(cfgNuevo, nuevoCod),
        toTurnoLiquidable(cfgSig, codSig)
      );
      if (descSig !== null && descSig < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
        throw new ConflictException(
          `RN-02 Bloqueante (${empNombre}): Solo ${r2(descSig / 60)}h de descanso entre ${nuevoCod} y ${codSig} del día siguiente (< 12h legales).`
        );
      }
    };

    validarEmpEnDia(solicitante.nombre, solicitante.id, isoOri, codDes);
    validarEmpEnDia(receptor.nombre, receptor.id, isoDes, codOri);

    return { solicitante, receptor, servicio, cuadrante, codOri, codDes };
  }

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
      fechaSolicitud: formatearFechaHoraBogota(p.fechaSolicitud),
      solicitanteId: p.solicitanteId,
      solicitanteNombre: p.solicitante?.nombre || 'Solicitante',
      receptorId: p.receptorId,
      receptorNombre: p.receptor?.nombre || 'Receptor',
      categoria: p.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: p.servicioId,
      anio: p.anio,
      mes: p.mes,
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
    // El periodo es obligatorio: sin él no es posible ubicar ni validar las celdas.
    const anio = Number(dto.anio);
    const mes = Number(dto.mes);
    if (!Number.isInteger(anio) || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('La solicitud de permuta debe indicar el periodo (anio y mes) del cuadrante.');
    }

    const { solicitante, receptor, servicio, codOri, codDes } = await this.validarPermutaEnServidor({
      solicitanteId: dto.solicitanteId,
      receptorId: dto.receptorId,
      servicioId: dto.servicioId,
      anio,
      mes,
      diaOrigen: Number(dto.diaOrigen),
      turnoOrigen: dto.turnoOrigen,
      diaDestino: Number(dto.diaDestino),
      turnoDestino: dto.turnoDestino,
    });

    const permuta = await this.prisma.solicitudPermuta.create({
      data: {
        solicitanteId: solicitante.id,
        receptorId: receptor.id,
        servicioId: servicio.id,
        anio,
        mes,
        diaOrigen: Number(dto.diaOrigen),
        turnoOrigen: codOri,
        diaDestino: Number(dto.diaDestino),
        turnoDestino: codDes,
        estado: 'PENDIENTE_PAR',
        validacionReglas: dto.validacionReglas || 'Misma categoría y descanso mínimo de 12h verificado en servidor.',
      },
      include: {
        solicitante: { include: { categoria: true } },
        receptor: { include: { categoria: true } },
      },
    });

    return {
      id: permuta.id,
      fechaSolicitud: formatearFechaHoraBogota(permuta.fechaSolicitud),
      solicitanteId: permuta.solicitanteId,
      solicitanteNombre: permuta.solicitante?.nombre || 'Solicitante',
      receptorId: permuta.receptorId,
      receptorNombre: permuta.receptor?.nombre || 'Receptor',
      categoria: permuta.solicitante?.categoria?.nombre || 'Asistencial',
      servicioId: permuta.servicioId,
      anio: permuta.anio,
      mes: permuta.mes,
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
   * Transición atómica: PENDIENTE_PAR -> PENDIENTE_SUPERVISOR.
   */
  @Patch(':id/aceptar-par')
  async aceptarPermutaPar(@Param('id') id: string) {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.solicitudPermuta.updateMany({
        where: { id, estado: 'PENDIENTE_PAR' },
        data: { estado: 'PENDIENTE_SUPERVISOR' },
      });
      if (claim.count === 0) {
        const existe = await tx.solicitudPermuta.findUnique({ where: { id } });
        if (!existe) throw new NotFoundException('Solicitud de permuta no encontrada');
        throw new ConflictException(
          `La solicitud no se encuentra en estado PENDIENTE_PAR (estado actual: ${existe.estado}).`
        );
      }
      return tx.solicitudPermuta.findUnique({ where: { id } });
    });
  }

  /**
   * Paso 2 del Flujo: El compañero receptor (Colaborador 2) declina la propuesta.
   * Transición atómica estricta: PENDIENTE_PAR -> RECHAZADA.
   */
  @Patch(':id/rechazar-par')
  async rechazarPermutaPar(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const motivo = body?.motivo || 'Declinada por el compañero receptor.';
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.solicitudPermuta.updateMany({
        where: { id, estado: 'PENDIENTE_PAR' },
        data: {
          estado: 'RECHAZADA',
          motivoRechazo: motivo,
        },
      });
      if (claim.count === 0) {
        const existe = await tx.solicitudPermuta.findUnique({ where: { id } });
        if (!existe) throw new NotFoundException('Solicitud de permuta no encontrada');
        throw new ConflictException(
          `Solo un par con solicitud PENDIENTE_PAR puede declinarla (estado actual: ${existe.estado}).`
        );
      }
      return tx.solicitudPermuta.findUnique({ where: { id } });
    });
  }

  /**
   * Paso 3 del Flujo: La supervisora aprueba la permuta ya concertada por ambos colaboradores.
   * Toda la secuencia (bloqueo optimista atómico de estado + validaciones + intercambio + recálculo de Banco + auditoría)
   * ocurre dentro de la misma transacción ACID para impedir doble ejecución por concurrencia (TOCTOU).
   */
  @Patch(':id/aprobar')
  async aprobarPermuta(@Param('id') id: string, @Req() req?: any) {
    const resultado = await this.prisma.$transaction(
      async (tx) => {
        // 1. Lock optimista atómico dentro de la transacción: solo una llamada concurrente gana PENDIENTE_SUPERVISOR
        const claim = await tx.solicitudPermuta.updateMany({
          where: { id, estado: 'PENDIENTE_SUPERVISOR' },
          data: { estado: 'APROBADA' },
        });
        if (claim.count === 0) {
          const existe = await tx.solicitudPermuta.findUnique({
            where: { id },
            select: { id: true, estado: true },
          });
          if (!existe) throw new NotFoundException('Solicitud de permuta no encontrada');
          throw new ConflictException(
            `Solo se pueden aprobar solicitudes en estado PENDIENTE_SUPERVISOR (estado actual: ${existe.estado}).`
          );
        }

        const permuta = await tx.solicitudPermuta.findUnique({
          where: { id },
          include: {
            solicitante: { include: { empresaContratante: true } },
            receptor: { include: { empresaContratante: true } },
          },
        });
        if (!permuta) throw new NotFoundException('Solicitud de permuta no encontrada');
        if (!permuta.anio || !permuta.mes) {
          throw new BadRequestException(
            'La solicitud no tiene periodo (año/mes) registrado. Recházala y pide al colaborador que la vuelva a enviar.'
          );
        }

        const anio = permuta.anio;
        const mes = permuta.mes;

        await this.festivosService.asegurarAnios([anio - 1, anio, anio + 1]);

        const { cuadrante } = await this.validarPermutaEnServidor(
          {
            solicitanteId: permuta.solicitanteId,
            receptorId: permuta.receptorId,
            servicioId: permuta.servicioId,
            anio,
            mes,
            diaOrigen: permuta.diaOrigen,
            turnoOrigen: permuta.turnoOrigen,
            diaDestino: permuta.diaDestino,
            turnoDestino: permuta.turnoDestino,
          },
          tx
        );

        const fechaOrigen = new Date(Date.UTC(anio, mes - 1, permuta.diaOrigen));
        const fechaDestino = new Date(Date.UTC(anio, mes - 1, permuta.diaDestino));

        const resolverTipoObj = async (cod: string) => {
          const codigoDb = normalizarCodigo(cod);
          const tipo = await tx.tipoTurno.findUnique({ where: { codigo: codigoDb } });
          if (!tipo) {
            throw new BadRequestException(`El código de turno "${codigoDb}" no existe en el catálogo.`);
          }
          return tipo;
        };

        const [tipoObjSol, tipoObjRec] = await Promise.all([
          resolverTipoObj(permuta.turnoDestino),
          resolverTipoObj(permuta.turnoOrigen),
        ]);

        const reglasSol = this.liquidacionService.resolverReglasEmpleado?.(permuta.solicitante as any);
        const reglasRec = this.liquidacionService.resolverReglasEmpleado?.(permuta.receptor as any);
        const [horasSol, horasRec] = await Promise.all([
          this.liquidacionService.calcularHorasPorTipo(tipoObjSol, fechaOrigen, reglasSol),
          this.liquidacionService.calcularHorasPorTipo(tipoObjRec, fechaDestino, reglasRec),
        ]);

        const actualSolicitante = normalizarCodigo(permuta.turnoOrigen);
        const actualReceptor = normalizarCodigo(permuta.turnoDestino);

        const aplicar = (
          empleadoId: string,
          fecha: Date,
          tipoTurnoId: string,
          anterior: string,
          horas: { hod: number; hon: number; hdfd: number; hdfn: number; hed: number; hen: number }
        ) =>
          tx.asignacionTurno.upsert({
            where: { empleadoId_fecha: { empleadoId, fecha } },
            // Se conserva codigoPrevisto (lo planeado) para que el comparador Previsto vs Real refleje la permuta
            update: {
              tipoTurnoId,
              cuadranteId: cuadrante.id,
              servicioEjecutorId: permuta.servicioId,
              ...horas,
            },
            create: {
              cuadranteId: cuadrante.id,
              empleadoId,
              tipoTurnoId,
              servicioEjecutorId: permuta.servicioId,
              fecha,
              esRotacion: false,
              codigoPrevisto: anterior,
              ...horas,
            },
          });

        const nuevaSolicitante = await aplicar(
          permuta.solicitanteId,
          fechaOrigen,
          tipoObjSol.id,
          actualSolicitante,
          horasSol
        );
        const nuevaReceptor = await aplicar(
          permuta.receptorId,
          fechaDestino,
          tipoObjRec.id,
          actualReceptor,
          horasRec
        );

        const actorNombre = req?.usuarioSso?.nombre
          ? `${req.usuarioSso.nombre} (${req.usuarioSso.rol === 'ADMIN_TH' ? 'Talento Humano' : 'Coordinador'})`
          : 'Coordinación Asistencial';

        await tx.auditoriaCambio.createMany({
          data: [
            {
              asignacionTurnoId: nuevaSolicitante.id,
              servicioId: permuta.servicioId,
              empleadoId: permuta.solicitanteId,
              actorId: actorNombre,
              tipoAccion: 'PERMUTA',
              turnoAnterior: actualSolicitante,
              turnoNuevo: normalizarCodigo(permuta.turnoDestino),
              justificacion: `Permuta aprobada con ${permuta.receptor.nombre} (Día ${permuta.diaOrigen}: [${permuta.turnoOrigen}] ⇄ Día ${permuta.diaDestino}: [${permuta.turnoDestino}])`,
            },
            {
              asignacionTurnoId: nuevaReceptor.id,
              servicioId: permuta.servicioId,
              empleadoId: permuta.receptorId,
              actorId: actorNombre,
              tipoAccion: 'PERMUTA',
              turnoAnterior: actualReceptor,
              turnoNuevo: normalizarCodigo(permuta.turnoOrigen),
              justificacion: `Permuta aprobada con ${permuta.solicitante.nombre} (Día ${permuta.diaDestino}: [${permuta.turnoDestino}] ⇄ Día ${permuta.diaOrigen}: [${permuta.turnoOrigen}])`,
            },
          ],
        });

        // Recalcular banco de horas en el servicio ejecutado y servicios base afectados si ya consolidaron
        const serviciosImpactados = new Set<string>([permuta.servicioId]);
        if (permuta.solicitante.servicioBaseId !== permuta.servicioId) {
          serviciosImpactados.add(permuta.solicitante.servicioBaseId);
        }
        if (permuta.receptor.servicioBaseId !== permuta.servicioId) {
          serviciosImpactados.add(permuta.receptor.servicioBaseId);
        }
        for (const srvIdImp of serviciosImpactados) {
          const cuadImp =
            srvIdImp === permuta.servicioId
              ? cuadrante
              : await tx.cuadrante.findUnique({
                  where: { anio_mes_servicioId: { anio, mes, servicioId: srvIdImp } },
                  select: { estado: true },
                });
          if (cuadImp && cuadImp.estado !== 'BORRADOR') {
            await this.liquidacionService.consolidarSaldosBancoServicio(
              srvIdImp,
              anio,
              mes,
              new Map(),
              true,
              tx
            );
          }
        }

        const permutaFinal = await tx.solicitudPermuta.findUnique({ where: { id } });
        return { permutaFinal, permuta, anio, mes };
      },
      { timeout: 20000 }
    );

    return {
      ...resultado.permutaFinal,
      cambiosAplicados: [
        {
          empleadoId: resultado.permuta.solicitanteId,
          anio: resultado.anio,
          mes: resultado.mes,
          dia: resultado.permuta.diaOrigen,
          codigo: resultado.permuta.turnoDestino,
        },
        {
          empleadoId: resultado.permuta.receptorId,
          anio: resultado.anio,
          mes: resultado.mes,
          dia: resultado.permuta.diaDestino,
          codigo: resultado.permuta.turnoOrigen,
        },
      ],
    };
  }

  /**
   * Paso 3 del Flujo: La supervisora rechaza la permuta con justificación clínica/operativa.
   * Transición atómica estricta: solo desde PENDIENTE_PAR o PENDIENTE_SUPERVISOR.
   */
  @Patch(':id/rechazar')
  async rechazarPermuta(@Param('id') id: string, @Body() body?: { motivo?: string }) {
    const motivo = body?.motivo || 'Rechazada por la supervisora asistencial.';
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.solicitudPermuta.updateMany({
        where: { id, estado: { in: ['PENDIENTE_PAR', 'PENDIENTE_SUPERVISOR'] } },
        data: {
          estado: 'RECHAZADA',
          motivoRechazo: motivo,
        },
      });
      if (claim.count === 0) {
        const existe = await tx.solicitudPermuta.findUnique({ where: { id } });
        if (!existe) throw new NotFoundException('Solicitud de permuta no encontrada');
        throw new ConflictException(
          `No es posible rechazar una permuta cuyo estado actual es ${existe.estado}.`
        );
      }
      return tx.solicitudPermuta.findUnique({ where: { id } });
    });
  }

  @Post('simular')
  async simularPermutaEntrePares(@Body() dto: SolicitudPermutaDto) {
    if (
      dto.solicitanteId &&
      dto.receptorId &&
      dto.servicioId &&
      dto.anio &&
      dto.mes &&
      dto.diaOrigen &&
      dto.diaDestino
    ) {
      try {
        await this.validarPermutaEnServidor({
          solicitanteId: dto.solicitanteId,
          receptorId: dto.receptorId,
          servicioId: dto.servicioId,
          anio: Number(dto.anio),
          mes: Number(dto.mes),
          diaOrigen: Number(dto.diaOrigen),
          turnoOrigen: dto.turnoOrigen,
          diaDestino: Number(dto.diaDestino),
          turnoDestino: dto.turnoDestino,
        });
      } catch (e: any) {
        return {
          permitida: false,
          motivo: e?.message || 'La permuta incumple reglas legales o de novedades.',
        };
      }
      return {
        permitida: true,
        estadoInicial: 'PENDIENTE_PAR',
        mensaje:
          'Permuta válida: Cargo compatible, tipo de turno habilitado, sin novedades bloqueantes y descanso mínimo >= 12h verificado.',
      };
    }

    if (dto.solicitanteCategoria && dto.receptorCategoria && dto.solicitanteCategoria !== dto.receptorCategoria) {
      return {
        permitida: false,
        motivo: `RN-05 Bloqueante: Incompatibilidad de cargo profesional (${dto.solicitanteCategoria} vs ${dto.receptorCategoria}).`,
      };
    }

    return {
      permitida: true,
      estadoInicial: 'PENDIENTE_PAR',
      mensaje:
        'Permuta válida: Mismo cargo profesional, sin novedades bloqueantes y descanso mínimo >= 12h verificado.',
    };
  }
}

@Controller('api/v1/intranet')
export class IntranetIntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configService?: ConfigService
  ) {}

  private obtenerSecretSso(): string {
    return (
      this.configService?.get<string>('INTRANET_JWT_SECRET') ||
      process.env.INTRANET_JWT_SECRET ||
      'clave_secreta_compartida_con_intranet_hospitalaria'
    );
  }

  private obtenerUrlRetornoIntranet(): string {
    return (
      this.configService?.get<string>('INTRANET_RETURN_URL') ||
      process.env.INTRANET_RETURN_URL ||
      'http://localhost:4300'
    );
  }

  private obtenerIntranetApiUrl(): string {
    return (
      this.configService?.get<string>('INTRANET_API_URL') ||
      process.env.INTRANET_API_URL ||
      'http://localhost:4300'
    );
  }

  private obtenerIntranetHeaders(): Record<string, string> {
    const apiKey =
      this.configService?.get<string>('INTRANET_API_KEY') ||
      process.env.INTRANET_API_KEY ||
      '';
    return apiKey ? { 'x-api-key': apiKey } : {};
  }

  private async construirPerfilUsuarioSso(
    documento: string,
    rolSolicitado?: RolUsuarioSso,
    serviciosExtraIds?: string[]
  ) {
    let emp = await this.prisma.empleado.findFirst({
      where: {
        OR: [{ documento }, { intranetId: documento }, { id: documento }],
      },
      include: {
        categoria: true,
        empresaContratante: true,
        servicioBase: {
          include: {
            serviciosHermanosOrigen: {
              include: { servicioHermano: true },
            },
          },
        },
      },
    });

    if (!emp) {
      // Auto-aprovisionamiento Just-In-Time (JIT) desde la Intranet Hospitalaria (empresa + macroproceso + cargo)
      const intranetUrl = this.obtenerIntranetApiUrl();
      try {
        const resp = await fetch(`${intranetUrl}/api/intranet/empleados`, {
          headers: this.obtenerIntranetHeaders(),
        });
        if (resp.ok) {
          const censo = await resp.json();
          const datosEmp = Array.isArray(censo)
            ? censo.find((x: any) => String(x.documento).trim() === documento.trim())
            : null;
          if (datosEmp) {
            const cargoNom = String(datosEmp.cargoNombre || 'Auxiliar de Enfermería').trim();
            let cat = await this.prisma.categoriaProfesional.findFirst({
              where: { nombre: cargoNom },
            });
            if (!cat) {
              cat = await this.prisma.categoriaProfesional.create({
                data: { nombre: cargoNom },
              });
            }
            const { empresa } = await resolverEmpresaDesdeIntranet(this.prisma, datosEmp);
            const srvId = await resolverServicioPorMacroprocesoYCargo(this.prisma, {
              macroprocesoCodigo: datosEmp.macroprocesoCodigo,
              categoriaId: cat.id,
              servicioCodigoFallback: datosEmp.servicioCodigo,
            });
            if (srvId) {
              const horasSemEmp = Math.round(Number(empresa.horasSemanalesContrato) || 42);
              await this.prisma.empleado.create({
                data: {
                  documento,
                  nombre: datosEmp.nombre || `Colaborador ${documento}`,
                  correo: datosEmp.correo || `${documento}@hospital.gov.co`,
                  empresaContratanteId: empresa.id,
                  horasSemanalesLey: horasSemEmp,
                  horasContratoMes: Number(datosEmp.horasContratoMes) || Math.round(horasSemEmp * 4),
                  categoriaId: cat.id,
                  servicioBaseId: srvId,
                },
              });

              emp = await this.prisma.empleado.findFirst({
                where: { documento },
                include: {
                  categoria: true,
                  empresaContratante: true,
                  servicioBase: {
                    include: {
                      serviciosHermanosOrigen: {
                        include: { servicioHermano: true },
                      },
                    },
                  },
                },
              });
            }
          }
        }
      } catch {}
    }

    if (!emp) {
      throw new NotFoundException(
        `El documento/identificador "${documento}" del token SSO no corresponde a ningún colaborador activo en Rafa Turnos ni en la Intranet Hospitalaria.`
      );
    }

    const rolValido: RolUsuarioSso =
      rolSolicitado === 'ADMIN_TH' ||
      rolSolicitado === 'COORDINADOR' ||
      rolSolicitado === 'COLABORADOR'
        ? rolSolicitado
        : 'COLABORADOR';

    let serviciosPermitidosIds: string[] = [emp.servicioBaseId];
    if (rolValido === 'ADMIN_TH') {
      const todosSrvs = await this.prisma.servicio.findMany({ select: { id: true } });
      serviciosPermitidosIds = todosSrvs.map((s) => s.id);
    } else if (rolValido === 'COORDINADOR') {
      const hermanosIds = emp.servicioBase.serviciosHermanosOrigen.map(
        (sh) => sh.servicioHermanoId
      );
      serviciosPermitidosIds = Array.from(
        new Set([emp.servicioBaseId, ...hermanosIds, ...(serviciosExtraIds || [])])
      );
    }

    return {
      empleadoId: emp.id,
      documento: emp.documento,
      nombre: emp.nombre,
      correo: emp.correo || undefined,
      categoria: emp.categoria?.nombre || 'Personal Asistencial',
      rol: rolValido,
      servicioBaseId: emp.servicioBaseId,
      servicioBaseNombre: emp.servicioBase.nombre,
      serviciosPermitidosIds,
      empresaContratanteId: emp.empresaContratanteId || (emp as any).empresaContratante?.id || undefined,
      empresaCodigo: (emp as any).empresaContratante?.codigo || undefined,
      empresaNombre: (emp as any).empresaContratante?.nombre || undefined,
      empresaEstadoConfiguracion: (emp as any).empresaContratante?.estadoConfiguracion || undefined,
      horasSemanalesAplicadas: Number(
        (emp as any).horasSemanalesOverride ??
          (emp as any).empresaContratante?.horasSemanalesContrato ??
          emp.horasSemanalesLey ??
          42
      ),
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  /**
   * Intercambia el Token SSO firmado por la Intranet Hospitalaria (?sso_token=...)
   * por una sesión validada contra PostgreSQL.
   */
  @Post('sso-login')
  async intercambiarTokenSso(@Body() body: { ssoToken: string }) {
    if (!body?.ssoToken) {
      throw new BadRequestException('Se requiere el campo ssoToken.');
    }

    const payload = verificarJwtHmac<PayloadTokenSsoIntranet>(
      body.ssoToken,
      this.obtenerSecretSso()
    );

    if (!payload.documento) {
      throw new UnauthorizedException('El token SSO no contiene el documento del colaborador.');
    }

    const usuario = await this.construirPerfilUsuarioSso(
      String(payload.documento),
      payload.rol,
      payload.serviciosCoordinados
    );

    const sessionToken = firmarJwtHmac(
      {
        documento: usuario.documento,
        empleadoId: usuario.empleadoId,
        rol: usuario.rol,
        serviciosCoordinados: usuario.serviciosPermitidosIds,
      },
      this.obtenerSecretSso(),
      28800 // 8 horas de sesión
    );

    return {
      sessionToken,
      usuario,
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  /**
   * Verifica la sesión activa enviada en Authorization: Bearer <token>.
   */
  @Get('sesion')
  async verificarSesionActiva(@Headers('authorization') authHeader?: string) {
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!token) {
      throw new UnauthorizedException('No se encontró cabecera Authorization Bearer.');
    }

    const payload = verificarJwtHmac<PayloadTokenSsoIntranet>(
      token,
      this.obtenerSecretSso()
    );

    const usuario = await this.construirPerfilUsuarioSso(
      String(payload.documento),
      payload.rol,
      payload.serviciosCoordinados
    );

    return {
      usuario,
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
    };
  }

  @Get('status')
  estadoIntegracionSatelite() {
    return {
      arquitectura: 'Servicio Satélite con Réplica Local (intranetId)',
      sso: 'JWT Bearer Token compartido (Sin doble login)',
      intranetReturnUrl: this.obtenerUrlRetornoIntranet(),
      endpointsMaestros: [
        'POST /api/v1/intranet/sso-login (Intercambio de Token SSO HMAC-SHA256)',
        'GET /api/v1/intranet/sesion (Validación de sesión activa y rol)',
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
  constructor(private readonly prisma: PrismaService) {}

  private formatearFechaYmd(dateUtc: Date): string {
    const y = dateUtc.getUTCFullYear();
    const m = String(dateUtc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateUtc.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private formatearHoraHms(hhmm?: string, fallback = '070000'): string {
    if (!hhmm || !hhmm.includes(':')) return fallback;
    const [hStr, mStr] = hhmm.split(':');
    const h = String(Math.max(0, Math.min(23, Number(hStr) || 0))).padStart(2, '0');
    const m = String(Math.max(0, Math.min(59, Number(mStr) || 0))).padStart(2, '0');
    return `${h}${m}00`;
  }

  /**
   * Obtiene o genera el token personal de suscripción iCal (.ics) en PostgreSQL
   * para el colaborador indicado o el usuario autenticado en la sesión SSO.
   */
  @Get('mi-enlace')
  async obtenerMiEnlaceCalendario(
    @Query('empleadoId') empleadoIdQuery?: string,
    @Req() req?: any
  ) {
    const targetId = empleadoIdQuery || req?.usuarioSso?.empleadoId;
    let empleado = targetId
      ? await this.prisma.empleado.findFirst({
          where: { OR: [{ id: targetId }, { documento: targetId }] },
          include: { servicioBase: true },
        })
      : null;

    if (!empleado) {
      empleado = await this.prisma.empleado.findFirst({
        include: { servicioBase: true },
        orderBy: { documento: 'asc' },
      });
    }

    if (!empleado) {
      throw new NotFoundException('No se encontró colaborador para generar enlace de calendario.');
    }

    let tokenRecord = await this.prisma.tokenCalendario.findFirst({
      where: { empleadoId: empleado.id, activo: true },
      orderBy: { creadoEn: 'desc' },
    });

    if (!tokenRecord) {
      const sufijo = randomBytes(6).toString('hex');
      const tokenHash = `cal_${empleado.documento}_${sufijo}`;
      tokenRecord = await this.prisma.tokenCalendario.create({
        data: {
          empleadoId: empleado.id,
          tokenHash,
          activo: true,
        },
      });
    }

    const rawProto = req?.headers?.['x-forwarded-proto'] ?? req?.protocol ?? 'http';
    const protoStr = Array.isArray(rawProto) ? rawProto[0] : String(rawProto);
    const proto = protoStr.split(',')[0].trim().toLowerCase() === 'https' ? 'https' : 'http';
    const rawHost = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host ?? 'localhost:3000';
    const hostStr = Array.isArray(rawHost) ? rawHost[0] : String(rawHost);
    const host = hostStr.split(',')[0].trim() || 'localhost:3000';
    const httpUrl = `${proto}://${host}/api/v1/calendario/feed/${tokenRecord.tokenHash}.ics`;
    const webcalUrl = `webcal://${host}/api/v1/calendario/feed/${tokenRecord.tokenHash}.ics`;

    return {
      empleadoId: empleado.id,
      empleadoNombre: empleado.nombre,
      documento: empleado.documento,
      servicioNombre: empleado.servicioBase.nombre,
      token: tokenRecord.tokenHash,
      httpUrl,
      webcalUrl,
    };
  }

  /**
   * Genera el feed dinámico RFC 5545 (.ics) consultando en vivo las asignaciones reales
   * en PostgreSQL (`asignaciones_turno`) para Google Calendar, Apple Calendar (iOS) y Outlook.
   */
  @Get('feed/:token.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="mis_turnos_hospital.ics"')
  async generarFeedIcs(@Param('token') rawToken: string): Promise<string> {
    const tokenLimpio = (rawToken || '').replace(/\.ics$/i, '').trim();

    let tokenRecord = await this.prisma.tokenCalendario.findUnique({
      where: { tokenHash: tokenLimpio },
      include: {
        empleado: {
          include: {
            servicioBase: true,
            categoria: true,
          },
        },
      },
    });

    let empleado = tokenRecord?.activo ? tokenRecord.empleado : null;

    if (!empleado) {
      // Permitir resolución por documento si el token tiene formato cal_<documento>_...
      const matchDoc = tokenLimpio.match(/^cal_(\d+)_/);
      const docBuscar = matchDoc ? matchDoc[1] : tokenLimpio;
      empleado = await this.prisma.empleado.findFirst({
        where: { OR: [{ documento: docBuscar }, { id: docBuscar }] },
        include: {
          servicioBase: true,
          categoria: true,
        },
      });
    }

    const dtstamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');

    const nombreCalendario = empleado
      ? `Turnos — ${empleado.nombre} (${empleado.servicioBase.codigo})`
      : 'Mis Turnos Hospitalarios (Rafa Turnos)';

    const lineas: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Hospital//Rafa Turnos v2.0//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${nombreCalendario}`,
      'X-WR-TIMEZONE:America/Bogota',
    ];

    if (empleado) {
      const asignaciones = await this.prisma.asignacionTurno.findMany({
        where: {
          empleadoId: empleado.id,
          cuadrante: {
            estado: {
              in: ['PUBLICADO', 'VALIDADO', 'CERRADO_NOMINA'],
            },
          },
        },
        include: {
          tipoTurno: true,
          servicioEjecutor: true,
        },
        orderBy: { fecha: 'asc' },
      });

      for (const a of asignaciones) {
        const cod = String(a.tipoTurno?.codigo || '').trim().toUpperCase();
        if (!cod || cod === CODIGO_CELDA_VACIA_DB) continue;
        const tipo = a.tipoTurno as any;
        const mostrarEnCalendario =
          Number(tipo.horasOrdinarias) > 0 ||
          Boolean(tipo.esAusencia) ||
          Boolean(tipo.descuentaBancoHoras) ||
          Boolean(tipo.prorrateaMetaContrato) ||
          cod === 'DISP';
        if (!mostrarEnCalendario) continue;

        const fechaInicioUtc = new Date(a.fecha);
        const ymdInicio = this.formatearFechaYmd(fechaInicioUtc);
        const fechaDiaSigUtc = new Date(fechaInicioUtc.getTime() + 86400000);
        const ymdDiaSig = this.formatearFechaYmd(fechaDiaSigUtc);

        const srvNombre = a.servicioEjecutor?.nombre || empleado.servicioBase.nombre;
        const catNombre = empleado.categoria?.nombre || 'Personal Asistencial';

        if (a.tipoTurno.horasOrdinarias <= 0) {
          // Evento de día completo para Novedades / Compensatorios (VAC, INC, COMP, DISP)
          lineas.push(
            'BEGIN:VEVENT',
            `UID:turno-${a.id}@hospital.gov.co`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${ymdInicio}`,
            `DTEND;VALUE=DATE:${ymdDiaSig}`,
            `SUMMARY:[${cod}] ${a.tipoTurno.nombre} - ${srvNombre}`,
            `DESCRIPTION:Colaborador: ${empleado.nombre} (${catNombre})\\nNovedad / Estado: ${a.tipoTurno.nombre}\\nServicio: ${srvNombre}`,
            `LOCATION:${srvNombre}`,
            'END:VEVENT'
          );
        } else {
          // Turno operativo con hora exacta de entrada y salida
          const [hIni = 7, mIni = 0] = (a.tipoTurno.horaInicio || '07:00')
            .split(':')
            .map(Number);
          const [hFin = 15, mFin = 0] = (a.tipoTurno.horaFin || '15:00')
            .split(':')
            .map(Number);
          const minInicio = hIni * 60 + mIni;
          const minFin = hFin * 60 + mFin;

          const cruzaMedianoche =
            a.tipoTurno.horasOrdinarias >= 24 || minFin <= minInicio;
          const ymdFin = cruzaMedianoche ? ymdDiaSig : ymdInicio;

          const hmsInicio = this.formatearHoraHms(a.tipoTurno.horaInicio, '070000');
          const hmsFin = this.formatearHoraHms(a.tipoTurno.horaFin, '150000');

          lineas.push(
            'BEGIN:VEVENT',
            `UID:turno-${a.id}@hospital.gov.co`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;TZID=America/Bogota:${ymdInicio}T${hmsInicio}`,
            `DTEND;TZID=America/Bogota:${ymdFin}T${hmsFin}`,
            `SUMMARY:[${cod}] ${a.tipoTurno.nombre} (${a.tipoTurno.horaInicio}-${a.tipoTurno.horaFin}) - ${srvNombre}`,
            `DESCRIPTION:Colaborador: ${empleado.nombre} (${catNombre})\\nTurno: ${cod} - ${a.tipoTurno.nombre} (${a.tipoTurno.horasOrdinarias}h)\\nServicio: ${srvNombre}`,
            `LOCATION:${srvNombre}`,
            'END:VEVENT'
          );
        }
      }
    }

    lineas.push('END:VCALENDAR');
    return lineas.join('\r\n');
  }
}

@Controller('api/v1/auditorias')
export class AuditoriasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listarAuditorias(
    @Query('servicioId') servicioId?: string,
    @Query('empleadoId') empleadoId?: string,
    @Query('tipoAccion') tipoAccion?: string,
    @Query('fechaInicio') fechaInicio?: string,
    @Query('fechaFin') fechaFin?: string,
    @Query('limite') limiteQuery?: string,
    @Query('page') pageQuery?: string,
    @Req() req?: any,
  ) {
    const usuarioSso = req?.usuarioSso;
    const esColaborador = usuarioSso?.rol === 'COLABORADOR';
    const esCoordinador = usuarioSso?.rol === 'COORDINADOR';

    const andConditions: any[] = [];

    // 1. Regla de Privacidad: COLABORADOR solo ve sus propios movimientos
    if (esColaborador && (usuarioSso?.empleadoId || usuarioSso?.documento)) {
      andConditions.push({
        OR: [
          ...(usuarioSso?.empleadoId
            ? [{ empleadoId: usuarioSso.empleadoId }, { asignacionTurno: { empleadoId: usuarioSso.empleadoId } }]
            : []),
          ...(usuarioSso?.documento
            ? [
                { empleado: { documento: String(usuarioSso.documento) } },
                { asignacionTurno: { empleado: { documento: String(usuarioSso.documento) } } },
              ]
            : []),
        ],
      });
    } else if (empleadoId && empleadoId !== 'TODOS') {
      andConditions.push({
        OR: [
          { empleadoId },
          { empleado: { documento: empleadoId } },
          { asignacionTurno: { empleadoId } },
          { asignacionTurno: { empleado: { documento: empleadoId } } },
        ],
      });
    }

    // 2. Filtro por servicio
    if (esCoordinador && Array.isArray(usuarioSso?.serviciosCoordinados) && usuarioSso.serviciosCoordinados.length > 0) {
      const permitidos = usuarioSso.serviciosCoordinados;
      if (servicioId && permitidos.includes(servicioId) && servicioId !== 'TODOS') {
        andConditions.push({
          OR: [{ servicioId }, { asignacionTurno: { servicioEjecutorId: servicioId } }],
        });
      } else {
        andConditions.push({
          OR: [
            { servicioId: { in: permitidos } },
            { asignacionTurno: { servicioEjecutorId: { in: permitidos } } },
          ],
        });
      }
    } else if (servicioId && servicioId !== 'TODOS') {
      andConditions.push({
        OR: [{ servicioId }, { asignacionTurno: { servicioEjecutorId: servicioId } }],
      });
    }

    // 3. Filtro por tipo de acción
    if (tipoAccion && tipoAccion !== 'TODAS') {
      andConditions.push({ tipoAccion });
    }

    // 4. Filtro por rango de fechas (zona horaria Colombia UTC-5, alineado con el frontend)
    if (fechaInicio || fechaFin) {
      const tsFilter: any = {};
      if (fechaInicio) {
        tsFilter.gte = fechaInicio.includes('T')
          ? new Date(fechaInicio)
          : new Date(`${fechaInicio}T00:00:00-05:00`);
      }
      if (fechaFin) {
        tsFilter.lte = fechaFin.includes('T')
          ? new Date(fechaFin)
          : new Date(`${fechaFin}T23:59:59.999-05:00`);
      }
      andConditions.push({ timestamp: tsFilter });
    }

    const whereClause: any = andConditions.length > 0 ? { AND: andConditions } : {};

    const limite = Math.min(Math.max(Number(limiteQuery) || 100, 1), 500);
    const page = Math.max(Number(pageQuery) || 1, 1);
    const skip = (page - 1) * limite;

    const logs = await this.prisma.auditoriaCambio.findMany({
      where: whereClause,
      include: {
        servicio: {
          select: { id: true, nombre: true, codigo: true },
        },
        empleado: {
          select: { id: true, nombre: true, documento: true },
        },
        asignacionTurno: {
          select: {
            empleadoId: true,
            fecha: true,
            servicioEjecutorId: true,
            empleado: {
              select: {
                id: true,
                nombre: true,
                documento: true,
              },
            },
            servicioEjecutor: {
              select: {
                id: true,
                nombre: true,
                codigo: true,
              },
            },
          },
        },
      },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limite,
    });

    return logs.map((log) => {
      const fechaUtc = log.asignacionTurno?.fecha
        ? new Date(log.asignacionTurno.fecha)
        : null;
      const dia = fechaUtc ? fechaUtc.getUTCDate() : 0;
      const tsDate = new Date(log.timestamp);
      const timestampFormateado =
        tsDate.toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) +
        ' ' +
        tsDate.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour12: true });

      // Limpieza infalible de UUIDs residuales en motivos de permuta
      const motivoLimpio = (log.justificacion || 'Modificación registrada')
        .replace(/Permuta [0-9a-fA-F\-]{36} aprobada con /g, 'Permuta aprobada con ');

      const empNombre =
        log.empleado?.nombre ||
        log.asignacionTurno?.empleado?.nombre ||
        (log.tipoAccion === 'ESTADO_CUADRANTE' ? 'Todo el Personal del Servicio' : 'Colaborador');

      const empDoc =
        log.empleado?.documento ||
        log.asignacionTurno?.empleado?.documento ||
        '';

      const srvNombre =
        log.servicio?.nombre ||
        log.asignacionTurno?.servicioEjecutor?.nombre ||
        'Servicio Asistencial';

      const srvId =
        log.servicioId ||
        log.asignacionTurno?.servicioEjecutorId ||
        '';

      return {
        id: log.id,
        timestamp: timestampFormateado,
        timestampIso: log.timestamp.toISOString(),
        actor: log.actorId || 'Supervisión Asistencial',
        tipoAccion: log.tipoAccion || 'EDICION_TURNO',
        empleadoId: log.empleadoId || log.asignacionTurno?.empleadoId,
        empleadoNombre: empNombre,
        empleadoDocumento: empDoc,
        servicioId: srvId,
        servicioNombre: srvNombre,
        dia,
        fechaIso: fechaUtc ? fechaUtc.toISOString().slice(0, 10) : undefined,
        turnoAnterior: log.turnoAnterior || '—',
        turnoNuevo: log.turnoNuevo || '—',
        motivo: motivoLimpio,
      };
    });
  }
}

@Module({
  imports: [FestivosModule, LiquidacionModule],
  controllers: [
    PermutasController,
    IntranetIntegrationController,
    CalendarioIcalController,
    AuditoriasController,
  ],
})
export class OperacionesHospitalModule {}
