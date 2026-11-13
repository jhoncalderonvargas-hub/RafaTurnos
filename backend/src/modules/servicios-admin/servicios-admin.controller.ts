import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS,
  desglosarHorarioOrdinario,
  esCodigoExoneracionContrato,
  generarTandasEscalonadasDefault,
  hoyColombiaIso,
  normalizarTandasBreak,
  TandaBreakTurno,
  UMBRAL_HORAS_TURNO_NOCTURNO,
} from '../../shared/liquidacion-horas';
import {
  normalizarCodigoMacroproceso,
  resolverEmpresaDesdeIntranet,
  resolverServicioPorMacroprocesoYCargo,
} from '../empresas/empresas-matching.util';
import { LiquidacionService } from '../liquidacion/liquidacion.module';

@Controller('api/v1/servicios-admin')
export class ServiciosAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liquidacionService: LiquidacionService,
    @Optional() private readonly configService?: ConfigService
  ) {}

  private obtenerConfigIntranet(overrideUrl?: string): {
    intranetUrl: string;
    headers: Record<string, string>;
  } {
    const intranetUrl =
      (overrideUrl && String(overrideUrl).trim()) ||
      this.configService?.get<string>('INTRANET_API_URL') ||
      process.env.INTRANET_API_URL ||
      'http://localhost:4300';
    const apiKey =
      this.configService?.get<string>('INTRANET_API_KEY') ||
      process.env.INTRANET_API_KEY ||
      '';
    const headers: Record<string, string> = {};
    if (apiKey.trim()) {
      headers['x-api-key'] = apiKey.trim();
    }
    return { intranetUrl, headers };
  }

  // 0. Sincronizar y obtener Catálogo de Macroprocesos (Intranet -> PostgreSQL tabla macroprocesos)
  @Get('macroprocesos')
  async listarMacroprocesosIntranet() {
    const { intranetUrl, headers } = this.obtenerConfigIntranet();
    try {
      const resp = await fetch(`${intranetUrl}/api/intranet/macroprocesos`, { headers });
      if (resp.ok) {
        const lista = await resp.json();
        if (Array.isArray(lista) && lista.length > 0) {
          for (const m of lista) {
            const cod = String(m.codigo || '').trim().toUpperCase();
            if (!cod) continue;
            await this.prisma.macroproceso.upsert({
              where: { codigo: cod },
              update: {
                nombre: m.nombre || cod,
                nombreCorto: m.nombreCorto || m.nombre || cod,
                tipoProceso: m.tipoProceso || 'MISIONAL_ASISTENCIAL',
                icono: m.icono || '🏥',
                orden: Number(m.orden) || 1,
                modalidadSugerida: m.modalidadSugerida || 'TODOS_24_7',
                plantillaTurnosSugerida: m.plantillaTurnosSugerida || 'ROTATIVO_8H',
              },
              create: {
                id: `mp-${cod.toLowerCase().replace(/_/g, '-')}`,
                codigo: cod,
                nombre: m.nombre || cod,
                nombreCorto: m.nombreCorto || m.nombre || cod,
                tipoProceso: m.tipoProceso || 'MISIONAL_ASISTENCIAL',
                icono: m.icono || '🏥',
                orden: Number(m.orden) || 1,
                modalidadSugerida: m.modalidadSugerida || 'TODOS_24_7',
                plantillaTurnosSugerida: m.plantillaTurnosSugerida || 'ROTATIVO_8H',
              },
            });
          }
        }
      } else {
        console.warn(`Intranet macroprocesos respondió HTTP ${resp.status}; usando catálogo en BD.`);
      }
    } catch (err: any) {
      console.warn(`No se pudo sincronizar macroprocesos desde Intranet (${err?.message || 'error'}); usando catálogo en BD.`);
    }
    return this.prisma.macroproceso.findMany({ orderBy: { orden: 'asc' } });
  }

  private async resolverMacroprocesoId(codigoOId?: string): Promise<string> {
    const cod = normalizarCodigoMacroproceso(codigoOId);
    const porCodigo = await this.prisma.macroproceso.findFirst({
      where: {
        OR: [{ codigo: cod }, { id: String(codigoOId || '') }],
      },
    });
    if (porCodigo) return porCodigo.id;

    const creado = await this.prisma.macroproceso.create({
      data: {
        id: `mp-${cod.toLowerCase().replace(/_/g, '-')}`,
        codigo: cod,
        nombre: cod,
        nombreCorto: cod,
        tipoProceso: 'MISIONAL_ASISTENCIAL',
        icono: '🏥',
        orden: 99,
        modalidadSugerida: 'TODOS_24_7',
        plantillaTurnosSugerida: 'ROTATIVO_8H',
      },
    });
    return creado.id;
  }

  // 0.1 Catálogo maestro de cargos profesionales (para asignar cargosPermitidos en servicios)
  @Get('categorias')
  async listarCategorias() {
    return this.prisma.categoriaProfesional.findMany({
      orderBy: { nombre: 'asc' },
    });
  }

  // 1. Listar todos los servicios con cargos permitidos, metas por turno, servicios hermanos y compatibilidad
  @Get()
  async listarServicios() {
    const servicios = await this.prisma.servicio.findMany({
      include: {
        macroproceso: true,
        serviciosHermanosOrigen: {
          include: { servicioHermano: true },
        },
        cargosPermitidos: {
          include: { categoria: true },
        },
        metasPorTurno: {
          include: { tipoTurno: true },
        },
        coberturas: {
          include: { categoria: true },
        },
        turnosHabilitados: {
          include: { categoria: true, tipoTurno: true },
        },
        empleadosBase: {
          include: { categoria: true, empresaContratante: true },
        },
        _count: {
          select: { empleadosBase: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return servicios.map((s: any) => {
      const metasHabilitadas = (s.metasPorTurno || [])
        .filter((m: any) => m.habilitado && m.tipoTurno)
        .map((m: any) => ({
          id: m.id,
          tipoTurnoId: m.tipoTurnoId,
          codigoTurno: m.tipoTurno.codigo,
          nombreTurno: m.tipoTurno.nombre,
          colorHex: m.tipoTurno.colorHex,
          horaInicio: m.tipoTurno.horaInicio,
          horaFin: m.tipoTurno.horaFin,
          horasOrdinarias: m.tipoTurno.horasOrdinarias,
          horasNocturnas: m.tipoTurno.horasNocturnas,
          esNocturnoPesado: Boolean(m.tipoTurno.esNocturnoPesado),
          habilitado: Boolean(m.habilitado),
          minimoBase: m.minimoBase ?? 1,
          esperadoBase: m.esperadoBase ?? 1,
          minimoDomFest: m.minimoDomFest ?? m.minimoBase ?? 1,
          esperadoDomFest: m.esperadoDomFest ?? m.esperadoBase ?? 1,
        }));

      const turnosSrv =
        Array.isArray(s.turnosHabilitadosCodigos) && s.turnosHabilitadosCodigos.length > 0
          ? s.turnosHabilitadosCodigos
          : metasHabilitadas.map((m: any) => m.codigoTurno);

      // Contar empleados por categoría en este servicio
      const conteoPorCat = new Map<string, { id: string; nombre: string; count: number }>();
      for (const emp of s.empleadosBase || []) {
        if (!emp.categoria) continue;
        const prev = conteoPorCat.get(emp.categoria.nombre);
        conteoPorCat.set(emp.categoria.nombre, {
          id: emp.categoria.id,
          nombre: emp.categoria.nombre,
          count: (prev?.count || 0) + 1,
        });
      }

      const cargosPermitidosMap = new Map<
        string,
        { categoriaId: string; categoriaNombre: string; empleadosCount: number }
      >();
      for (const cp of s.cargosPermitidos || []) {
        if (!cp.categoria) continue;
        cargosPermitidosMap.set(cp.categoriaId, {
          categoriaId: cp.categoriaId,
          categoriaNombre: cp.categoria.nombre,
          empleadosCount: conteoPorCat.get(cp.categoria.nombre)?.count || 0,
        });
      }

      // Agrupar turnos habilitados por categoría desde la tabla servicios_turnos_habilitados (compatibilidad transición)
      const mapaTurnosPorCat = new Map<string, string[]>();
      for (const th of s.turnosHabilitados || []) {
        if (!th.habilitado || !th.categoria || !th.tipoTurno) continue;
        const catNombre = th.categoria.nombre;
        const lista = mapaTurnosPorCat.get(catNombre) || [];
        if (!lista.includes(th.tipoTurno.codigo)) {
          lista.push(th.tipoTurno.codigo);
        }
        mapaTurnosPorCat.set(catNombre, lista);
      }

      const mapaCoberturas = new Map<string, any>();
      for (const cob of s.coberturas || []) {
        if (!cob.categoria) continue;
        mapaCoberturas.set(cob.categoria.nombre, cob);
      }

      const nombresCategorias = Array.from(
        new Set([
          ...Array.from(cargosPermitidosMap.values()).map((c) => c.categoriaNombre),
          ...Array.from(conteoPorCat.keys()),
          ...Array.from(mapaCoberturas.keys()),
        ])
      );

      const reglasPorCargo = nombresCategorias.map((catNombre) => {
        const cob = mapaCoberturas.get(catNombre);
        const infoCat = conteoPorCat.get(catNombre);
        const turnosCat = mapaTurnosPorCat.get(catNombre);
        const reqD = cob?.reqDia ?? 1;
        const reqN = cob?.reqNoche ?? 0;
        const reqDDomFest = cob?.reqDiaDomFest ?? reqD;
        const reqNDomFest = cob?.reqNocheDomFest ?? reqN;
        const sinTurnosExplicitos =
          !turnosCat &&
          Boolean(cob) &&
          reqD === 0 &&
          reqN === 0 &&
          reqDDomFest === 0 &&
          reqNDomFest === 0;
        return {
          categoriaId: cob?.categoriaId || infoCat?.id,
          categoriaNombre: catNombre,
          empleadosCount: infoCat?.count || 0,
          reqDia: reqD,
          reqNoche: reqN,
          reqDiaDomFest: reqDDomFest,
          reqNocheDomFest: reqNDomFest,
          turnosHabilitados: turnosCat && turnosCat.length > 0 ? turnosCat : sinTurnosExplicitos ? [] : turnosSrv,
        };
      });

      const cargosPermitidos = Array.from(cargosPermitidosMap.values()).sort((a, b) =>
        a.categoriaNombre.localeCompare(b.categoriaNombre)
      );

      return {
        id: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        macroprocesoId: s.macroprocesoId,
        macroprocesoNombre: s.macroproceso?.nombre,
        tipoAsistencia: s.macroproceso?.codigo || 'URGENCIAS',
        intranetId: s.intranetId,
        permitePermutaEntreCargos: Boolean(s.permitePermutaEntreCargos),
        reqDia: s.reqDia ?? 4,
        reqNoche: s.reqNoche ?? 2,
        modalidadDias: s.modalidadDias || 'TODOS_24_7',
        reqDiaDomFest: s.reqDiaDomFest ?? s.reqDia ?? 4,
        reqNocheDomFest: s.reqNocheDomFest ?? s.reqNoche ?? 2,
        turnosHabilitados: turnosSrv,
        cargosPermitidos,
        cargosPermitidosIds: cargosPermitidos.map((c) => c.categoriaId),
        metasPorTurno: metasHabilitadas,
        reglasPorCargo,
        empleadosCount: s._count?.empleadosBase || 0,
        hermanos: (s.serviciosHermanosOrigen || []).map((sh: any) => ({
          id: sh.servicioHermano.id,
          codigo: sh.servicioHermano.codigo,
          nombre: sh.servicioHermano.nombre,
        })),
      };
    });
  }

  // 1.1 Listar todos los empleados con sus categorías, empresa contratante y último saldo
  @Get('empleados')
  async listarEmpleados() {
    return this.prisma.empleado.findMany({
      include: {
        categoria: true,
        servicioBase: true,
        empresaContratante: true,
        saldosBancoHoras: {
          orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  // 1.1b Sincronización del Censo Maestro de Personal desde Intranet Hospitalaria (Empresa + Macroproceso + Cargo)
  @Post('sincronizar-empleados-intranet')
  async sincronizarEmpleadosIntranet(@Body() body?: { intranetUrl?: string }) {
    const { intranetUrl, headers } = this.obtenerConfigIntranet(body?.intranetUrl);

    let censo: any[] = [];
    try {
      const resp = await fetch(`${intranetUrl}/api/intranet/empleados`, { headers });
      if (!resp.ok) {
        throw new BadRequestException(`Intranet respondió con código ${resp.status}`);
      }
      censo = await resp.json();
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `No se pudo conectar con la Intranet en ${intranetUrl}: ${err.message}`
      );
    }

    if (!Array.isArray(censo) || censo.length === 0) {
      return { ok: true, total: 0, creados: 0, actualizados: 0, empresasPendientes: [] };
    }

    const [categoriasDb, serviciosDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      this.prisma.servicio.findMany({
        include: {
          macroproceso: { select: { codigo: true } },
          cargosPermitidos: { select: { categoriaId: true } },
        },
        orderBy: { codigo: 'asc' },
      }),
    ]);

    const mapaCat = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));

    const docs = [
      ...new Set(
        censo
          .map((item: any) => String(item.documento || '').trim())
          .filter(Boolean)
      ),
    ];

    const existentesDb = await this.prisma.empleado.findMany({
      where: { documento: { in: docs } },
      select: { id: true, documento: true, nombre: true, horasSemanalesOverride: true },
    });
    const mapaExistentes = new Map(existentesDb.map((e) => [e.documento, e]));

    let creados = 0;
    let actualizados = 0;
    const empresasPendientesMap = new Map<string, any>();

    await this.prisma.$transaction(async (tx) => {
      for (const item of censo) {
        const doc = String(item.documento || '').trim();
        if (!doc) continue;

        // 1) Resolver Cargo Profesional
        const cargoNombre = String(item.cargoNombre || 'Auxiliar de Enfermería').trim();
        let catId = mapaCat.get(cargoNombre.toLowerCase());
        if (!catId) {
          const nuevaCat = await tx.categoriaProfesional.create({
            data: { nombre: cargoNombre },
          });
          catId = nuevaCat.id;
          mapaCat.set(cargoNombre.toLowerCase(), catId);
        }

        // 2) Resolver o auto-descubrir EmpresaContratante (PENDIENTE_REGLAS si es desconocida)
        const { empresa, recienCreada } = await resolverEmpresaDesdeIntranet(tx, item);
        if (recienCreada || empresa.estadoConfiguracion === 'PENDIENTE_REGLAS') {
          empresasPendientesMap.set(empresa.id, {
            id: empresa.id,
            codigo: empresa.codigo,
            nombre: empresa.nombre,
            horasSemanalesContrato: empresa.horasSemanalesContrato,
            recienCreada,
          });
        }

        const horasSem =
          Number(empresa.horasSemanalesContrato || item.horasSemanalesContrato) || 42;
        const horasMes = Number(item.horasContratoMes) || Math.round(horasSem * 4);
        const correo = item.correo || `${doc}@hospital.gov.co`;

        const existente = mapaExistentes.get(doc);

        if (!existente) {
          // Para altas nuevas, sugerir servicio cruzando (macroprocesoCodigo + cargo)
          const servicioAsignadoId = await resolverServicioPorMacroprocesoYCargo(
            tx,
            {
              macroprocesoCodigo: item.macroprocesoCodigo,
              categoriaId: catId,
              servicioCodigoFallback: item.servicioCodigo,
            },
            serviciosDb
          );
          if (!servicioAsignadoId) continue;

          const nuevo = await tx.empleado.create({
            data: {
              documento: doc,
              nombre: item.nombre || `Colaborador ${doc}`,
              correo,
              empresaContratanteId: empresa.id,
              horasSemanalesLey: Math.round(horasSem),
              horasContratoMes: horasMes,
              categoriaId: catId,
              servicioBaseId: servicioAsignadoId,
            },
            select: { id: true, documento: true, nombre: true, horasSemanalesOverride: true },
          });
          mapaExistentes.set(doc, nuevo);
          creados++;
        } else {
          // servicioBaseId es propiedad exclusiva de Rafa_Turnos y jamás se sobrescribe en sync
          await tx.empleado.update({
            where: { id: existente.id },
            data: {
              nombre: item.nombre || existente.nombre,
              correo,
              empresaContratanteId: empresa.id,
              horasSemanalesLey: existente.horasSemanalesOverride
                ? Math.round(existente.horasSemanalesOverride)
                : Math.round(horasSem),
              horasContratoMes: horasMes,
              categoriaId: catId,
            },
          });
          actualizados++;
        }
      }
    });

    const empresasPendientes = Array.from(empresasPendientesMap.values());
    return {
      ok: true,
      mensaje:
        empresasPendientes.length > 0
          ? `Censo sincronizado (${creados} nuevos, ${actualizados} actualizados). Atención: ${empresasPendientes.length} empresa(s) requiere(n) confirmar reglas normativas.`
          : `Censo sincronizado exitosamente con la Intranet Hospitalaria.`,
      total: censo.length,
      creados,
      actualizados,
      empresasPendientes,
    };
  }

  // 1.2 Listar el catálogo maestro de tipos de turno
  @Get('turnos')
  async listarTiposTurno() {
    return this.prisma.tipoTurno.findMany({
      orderBy: [{ esSistemaObligatorio: 'desc' }, { codigo: 'asc' }],
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
      minutosAlmuerzo?: number;
      recesoHabilitado?: boolean;
      recesoRemunerado?: boolean;
      recesoMaxSimultaneos?: number;
      recesoTandasJson?: TandaBreakTurno[] | null;
      colorHex: string;
      descuentaBancoHoras?: boolean;
      modoAmortizacionBanco?: 'DIA_HABIL_EMPRESA' | 'HORAS_FIJAS' | string;
      horasAmortizacionBanco?: number | null;
      prorrateaMetaContrato?: boolean;
      esAusencia?: boolean;
      bloqueaPermutas?: boolean;
      esNocturnoPesado?: boolean;
      visibleEnPaleta?: boolean;
      activo?: boolean;
      modoJornada?: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO';
    }
  ) {
    const cod = String(data?.codigo || '').trim().toUpperCase();
    const nom = String(data?.nombre || '').trim();
    if (!cod || !nom) {
      throw new BadRequestException('El código y el nombre del turno son obligatorios.');
    }

    const existente =
      typeof this.prisma.tipoTurno.findUnique === 'function'
        ? await this.prisma.tipoTurno.findUnique({ where: { codigo: cod } })
        : null;

    const esSistemaObligatorio =
      Boolean((existente as any)?.esSistemaObligatorio) ||
      CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod);

    if (esSistemaObligatorio && data.activo === false) {
      throw new ConflictException(
        `El turno "${cod}" es obligatorio del sistema y no puede archivarse ni desactivarse.`
      );
    }

    const minAlmuerzo =
      data.minutosAlmuerzo !== undefined ? Math.round(Number(data.minutosAlmuerzo)) : 0;
    if (!Number.isFinite(minAlmuerzo) || minAlmuerzo < 0) {
      throw new BadRequestException(
        'Los minutos de almuerzo deben ser un número entero mayor o igual a 0.'
      );
    }

    let horaInicio = String(data.horaInicio || '00:00').trim() || '00:00';
    let horaFin = String(data.horaFin || '00:00').trim() || '00:00';
    let horasOrdinarias = Number(data.horasOrdinarias) || 0;
    let horasDiurnas = Number(data.horasDiurnas) || 0;
    let horasNocturnas = Number(data.horasNocturnas) || 0;

    const modoInferido: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO' = data.modoJornada
      ? data.modoJornada
      : esSistemaObligatorio || horasOrdinarias <= 0
        ? 'DESCANSO'
        : horasOrdinarias >= 24 && horaInicio === horaFin
          ? 'GUARDIA_24H'
          : 'HORARIO';

    if (esSistemaObligatorio && modoInferido !== 'DESCANSO') {
      throw new BadRequestException(
        `El turno obligatorio del sistema "${cod}" debe permanecer como jornada de Descanso / Exoneración (0 h).`
      );
    }

    let finalMinAlmuerzo = minAlmuerzo;
    let recesoHabilitado = false;
    let recesoRemunerado = false;
    let recesoMaxSimultaneos = 1;
    let recesoTandasFinales: TandaBreakTurno[] = [];

    if (modoInferido === 'DESCANSO') {
      horaInicio = '00:00';
      horaFin = '00:00';
      horasOrdinarias = 0;
      horasDiurnas = 0;
      horasNocturnas = 0;
      finalMinAlmuerzo = 0;
    } else {
      const esGuardia24 = modoInferido === 'GUARDIA_24H' || Number(data.horasOrdinarias) >= 24;
      const habilitadoReq =
        data.recesoHabilitado !== undefined
          ? Boolean(data.recesoHabilitado)
          : minAlmuerzo > 0 || (Array.isArray(data.recesoTandasJson) && data.recesoTandasJson.length > 0);

      if (habilitadoReq) {
        recesoHabilitado = true;
        recesoRemunerado = Boolean(data.recesoRemunerado);
        const maxSimRaw = Number(data.recesoMaxSimultaneos);
        recesoMaxSimultaneos =
          Number.isFinite(maxSimRaw) && maxSimRaw >= 1 ? Math.min(99, Math.round(maxSimRaw)) : 1;

        const durFallback = minAlmuerzo > 0 ? minAlmuerzo : 60;
        const tandasNormalizadas = normalizarTandasBreak(
          data.recesoTandasJson,
          horaInicio,
          horaFin,
          esGuardia24
        );
        recesoTandasFinales =
          tandasNormalizadas.length > 0
            ? tandasNormalizadas
            : generarTandasEscalonadasDefault(horaInicio, horaFin, 1, durFallback, esGuardia24);

        finalMinAlmuerzo = recesoRemunerado
          ? 0
          : (recesoTandasFinales[0]?.duracionMin ?? durFallback);
      } else {
        recesoHabilitado = false;
        recesoRemunerado = false;
        recesoMaxSimultaneos = 1;
        recesoTandasFinales = [];
        finalMinAlmuerzo = 0;
      }

      const tandaBase = recesoTandasFinales[0];
      const desglose = desglosarHorarioOrdinario(
        horaInicio,
        horaFin,
        finalMinAlmuerzo,
        hoyColombiaIso(),
        esGuardia24,
        null,
        recesoHabilitado && tandaBase
          ? {
              recesoRemunerado,
              breakInicio: tandaBase.inicio,
              breakFin: tandaBase.fin,
            }
          : { recesoRemunerado }
      );
      if (!desglose) {
        throw new BadRequestException(
          'Horario de turno inválido: en modo HORARIO la hora de inicio y fin no pueden ser iguales y el almuerzo debe ser menor que la duración.'
        );
      }
      horasOrdinarias = desglose.ordinarias;
      horasDiurnas = desglose.diurnas;
      horasNocturnas = desglose.nocturnas;
    }

    const descuentaBancoHoras =
      data.descuentaBancoHoras !== undefined
        ? Boolean(data.descuentaBancoHoras)
        : Boolean((existente as any)?.descuentaBancoHoras);

    const prorrateaMetaContrato =
      data.prorrateaMetaContrato !== undefined
        ? Boolean(data.prorrateaMetaContrato)
        : (existente as any)?.prorrateaMetaContrato !== undefined
          ? Boolean((existente as any).prorrateaMetaContrato)
          : esCodigoExoneracionContrato(cod);

    if (descuentaBancoHoras && horasOrdinarias > 0) {
      throw new BadRequestException(
        'Solo los turnos en modo Descanso (0 h) pueden amortizar el Banco de Horas (descuentaBancoHoras).'
      );
    }
    if (prorrateaMetaContrato && horasOrdinarias > 0) {
      throw new BadRequestException(
        'Solo los turnos en modo Descanso (0 h) pueden prorratear la meta mensual de días hábiles.'
      );
    }
    if (prorrateaMetaContrato && descuentaBancoHoras) {
      throw new BadRequestException(
        'Un turno no puede amortizar Banco de Horas y prorratear la meta contractual de días hábiles al mismo tiempo.'
      );
    }

    const modoAmortizacionBanco =
      data.modoAmortizacionBanco ||
      (existente as any)?.modoAmortizacionBanco ||
      (cod === 'COMP' && descuentaBancoHoras ? 'DIA_HABIL_EMPRESA' : 'HORAS_FIJAS');

    if (!['DIA_HABIL_EMPRESA', 'HORAS_FIJAS'].includes(modoAmortizacionBanco)) {
      throw new BadRequestException(
        'modoAmortizacionBanco debe ser DIA_HABIL_EMPRESA o HORAS_FIJAS.'
      );
    }

    const horasAmortizacionBanco =
      data.horasAmortizacionBanco !== undefined && data.horasAmortizacionBanco !== null
        ? Math.max(0.5, Number(data.horasAmortizacionBanco) || 8)
        : (existente as any)?.horasAmortizacionBanco ?? 8;

    const esAusencia =
      data.esAusencia !== undefined
        ? Boolean(data.esAusencia)
        : (existente as any)?.esAusencia !== undefined
          ? Boolean((existente as any).esAusencia)
          : esCodigoExoneracionContrato(cod);

    const bloqueaPermutas =
      data.bloqueaPermutas !== undefined
        ? Boolean(data.bloqueaPermutas)
        : (existente as any)?.bloqueaPermutas !== undefined
          ? Boolean((existente as any).bloqueaPermutas)
          : esAusencia || cod === 'BLANCO' || cod === 'DISP';

    const activo = esSistemaObligatorio
      ? true
      : data.activo !== undefined
        ? Boolean(data.activo)
        : (existente as any)?.activo !== undefined
          ? Boolean((existente as any).activo)
          : true;

    const visibleEnPaleta =
      cod === 'BLANCO'
        ? false
        : !activo
          ? false
          : data.visibleEnPaleta !== undefined
            ? Boolean(data.visibleEnPaleta)
            : (existente as any)?.visibleEnPaleta ?? true;

    const guardado = await this.prisma.tipoTurno.upsert({
      where: { codigo: cod },
      create: {
        codigo: cod,
        nombre: nom,
        horaInicio,
        horaFin,
        horasOrdinarias,
        horasDiurnas,
        horasNocturnas,
        minutosAlmuerzo: finalMinAlmuerzo,
        recesoHabilitado,
        recesoRemunerado,
        recesoMaxSimultaneos,
        recesoTandasJson:
          recesoTandasFinales.length > 0 ? (recesoTandasFinales as any) : Prisma.DbNull,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras,
        modoAmortizacionBanco,
        horasAmortizacionBanco,
        prorrateaMetaContrato,
        esAusencia,
        bloqueaPermutas,
        esNocturnoPesado: !!data.esNocturnoPesado,
        esSistemaObligatorio,
        visibleEnPaleta,
        activo,
      },
      update: {
        nombre: nom,
        horaInicio,
        horaFin,
        horasOrdinarias,
        horasDiurnas,
        horasNocturnas,
        minutosAlmuerzo: finalMinAlmuerzo,
        recesoHabilitado,
        recesoRemunerado,
        recesoMaxSimultaneos,
        recesoTandasJson:
          recesoTandasFinales.length > 0 ? (recesoTandasFinales as any) : Prisma.DbNull,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras,
        modoAmortizacionBanco,
        horasAmortizacionBanco,
        prorrateaMetaContrato,
        esAusencia,
        bloqueaPermutas,
        esNocturnoPesado: !!data.esNocturnoPesado,
        esSistemaObligatorio,
        visibleEnPaleta,
        activo,
      },
    });

    await this.liquidacionService.recalcularPorTipoTurno(guardado.id);
    return guardado;
  }

  // 1.3b Archivar o reactivar un tipo de turno no obligatorio sin romper historial
  @Patch('turnos/:codigo/archivar')
  async archivarTipoTurno(
    @Param('codigo') codigoRaw: string,
    @Body() body?: { activo?: boolean }
  ) {
    const cod = String(codigoRaw || '').trim().toUpperCase();
    const tipo = await this.prisma.tipoTurno.findUnique({ where: { codigo: cod } });
    if (!tipo) {
      throw new NotFoundException(`No se encontró el turno "${cod}".`);
    }
    if (tipo.esSistemaObligatorio || CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod)) {
      throw new ConflictException(
        `El turno "${cod}" es obligatorio del sistema y no puede archivarse.`
      );
    }
    const nuevoEstado = body?.activo !== undefined ? Boolean(body.activo) : !tipo.activo;
    return this.prisma.tipoTurno.update({
      where: { id: tipo.id },
      data: {
        activo: nuevoEstado,
        visibleEnPaleta: nuevoEstado ? true : false,
      },
    });
  }

  // 1.3c Eliminar un turno creado manualmente solo si no es del sistema y no tiene asignaciones
  @Delete('turnos/:codigo')
  async eliminarTipoTurno(@Param('codigo') codigoRaw: string) {
    const cod = String(codigoRaw || '').trim().toUpperCase();
    const tipo = await this.prisma.tipoTurno.findUnique({
      where: { codigo: cod },
      include: { _count: { select: { asignaciones: true } } },
    });
    if (!tipo) {
      throw new NotFoundException(`No se encontró el turno "${cod}".`);
    }
    if (tipo.esSistemaObligatorio || CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod)) {
      throw new ConflictException(
        `El turno "${cod}" es obligatorio del sistema y está protegido contra eliminación.`
      );
    }
    if ((tipo._count?.asignaciones || 0) > 0) {
      throw new ConflictException(
        `El turno "${cod}" tiene ${tipo._count.asignaciones} asignación(es) registrada(s). Archívalo para preservar la trazabilidad histórica.`
      );
    }
    await this.prisma.tipoTurno.delete({ where: { id: tipo.id } });
    return { ok: true, mensaje: `Turno "${cod}" eliminado del catálogo.` };
  }

  private async calcularTotalesDerivadosDeMetas(
    metas: Array<{
      codigoTurno?: string;
      tipoTurnoId?: string;
      habilitado?: boolean;
      minimoBase: number;
      esperadoBase: number;
      minimoDomFest: number;
      esperadoDomFest: number;
    }>,
    mapaTurnoPorId: Map<string, any>,
    mapaTurnoPorCod: Map<string, any>
  ) {
    let reqDia = 0;
    let reqNoche = 0;
    let reqDiaDomFest = 0;
    let reqNocheDomFest = 0;

    for (const m of metas) {
      if (m.habilitado === false) continue;
      const tipo =
        (m.tipoTurnoId ? mapaTurnoPorId.get(m.tipoTurnoId) : null) ||
        (m.codigoTurno ? mapaTurnoPorCod.get(String(m.codigoTurno).trim().toUpperCase()) : null);
      if (!tipo || Number(tipo.horasOrdinarias) <= 0) continue;

      const es24h = Number(tipo.horasOrdinarias) >= 24;
      const esNoche =
        Boolean(tipo.esNocturnoPesado) || Number(tipo.horasNocturnas) >= UMBRAL_HORAS_TURNO_NOCTURNO;

      if (es24h) {
        reqDia += m.esperadoBase;
        reqNoche += m.esperadoBase;
        reqDiaDomFest += m.esperadoDomFest;
        reqNocheDomFest += m.esperadoDomFest;
      } else if (esNoche) {
        reqNoche += m.esperadoBase;
        reqNocheDomFest += m.esperadoDomFest;
      } else {
        reqDia += m.esperadoBase;
        reqDiaDomFest += m.esperadoDomFest;
      }
    }

    return {
      reqDia: Math.max(0, reqDia),
      reqNoche: Math.max(0, reqNoche),
      reqDiaDomFest: Math.max(0, reqDiaDomFest),
      reqNocheDomFest: Math.max(0, reqNocheDomFest),
    };
  }

  private async sincronizarConfiguracionServicioEnDb(
    servicioId: string,
    turnosServicio: string[],
    opciones: {
      cargosPermitidosIds?: string[];
      cargosPermitidos?: Array<{ categoriaId?: string; categoriaNombre?: string }>;
      metasPorTurno?: Array<{
        tipoTurnoId?: string;
        codigoTurno?: string;
        habilitado?: boolean;
        minimoBase: number;
        esperadoBase: number;
        minimoDomFest?: number;
        esperadoDomFest?: number;
      }>;
      tiposTurnoPreloaded?: any[];
      reglasPorCargo?: {
        categoriaId?: string;
        categoriaNombre: string;
        reqDia?: number;
        reqNoche?: number;
        reqDiaDomFest?: number;
        reqNocheDomFest?: number;
        turnosHabilitados?: string[];
      }[];
    }
  ): Promise<{
    totalesDerivados?: {
      reqDia: number;
      reqNoche: number;
      reqDiaDomFest: number;
      reqNocheDomFest: number;
    };
  }> {
    const [categoriasDb, tiposTurnoDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      Array.isArray(opciones.tiposTurnoPreloaded)
        ? Promise.resolve(opciones.tiposTurnoPreloaded)
        : this.prisma.tipoTurno.findMany(),
    ]);

    const mapaCatPorNombre = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t]));
    const mapaTurnoPorCodId = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t.id]));
    const mapaTurnoPorId = new Map(tiposTurnoDb.map((t) => [t.id, t]));

    // Validar metasPorTurno antes de abrir transacción
    const metasNormalizadas: Array<{
      tipoTurnoId: string;
      codigoTurno: string;
      habilitado: boolean;
      minimoBase: number;
      esperadoBase: number;
      minimoDomFest: number;
      esperadoDomFest: number;
    }> = [];

    if (Array.isArray(opciones.metasPorTurno)) {
      for (const m of opciones.metasPorTurno) {
        const codRaw = String(m.codigoTurno || '').trim().toUpperCase();
        const tipo =
          (m.tipoTurnoId ? mapaTurnoPorId.get(m.tipoTurnoId) : null) ||
          (codRaw ? mapaTurnoPorCod.get(codRaw) : null);
        if (!tipo) continue;

        const habilitado = m.habilitado !== false;
        const minB = Math.round(Number(m.minimoBase ?? 1));
        const espB = Math.round(Number(m.esperadoBase ?? minB));
        const minD = Math.round(Number(m.minimoDomFest ?? minB));
        const espD = Math.round(Number(m.esperadoDomFest ?? Math.max(espB, minD)));

        if (minB < 0 || espB < 0 || minD < 0 || espD < 0) {
          throw new BadRequestException(
            `Las metas del turno ${tipo.codigo} no pueden ser negativas.`
          );
        }
        if (minB > espB || minD > espD) {
          throw new BadRequestException(
            `Meta inválida para ${tipo.codigo}: Mínimo no puede superar a Esperado.`
          );
        }

        metasNormalizadas.push({
          tipoTurnoId: tipo.id,
          codigoTurno: tipo.codigo,
          habilitado,
          minimoBase: minB,
          esperadoBase: espB,
          minimoDomFest: minD,
          esperadoDomFest: espD,
        });
      }
    }

    let totalesDerivados:
      | { reqDia: number; reqNoche: number; reqDiaDomFest: number; reqNocheDomFest: number }
      | undefined;

    await this.prisma.$transaction(async (tx: any) => {
      // 1) Sincronizar ServicioCargoPermitido (preferir cargosPermitidosIds / cargosPermitidos; si no, extraer de reglasPorCargo)
      const tieneCargosExplicitos =
        Array.isArray(opciones.cargosPermitidosIds) || Array.isArray(opciones.cargosPermitidos);
      let cargosIdsFinales: string[] = [];

      if (tieneCargosExplicitos) {
        const setCargos = new Set<string>(
          (opciones.cargosPermitidosIds || []).map((id) => String(id).trim()).filter(Boolean)
        );
        for (const cp of opciones.cargosPermitidos || []) {
          let cId =
            cp.categoriaId ||
            mapaCatPorNombre.get(String(cp.categoriaNombre || '').trim().toLowerCase());
          if (!cId && cp.categoriaNombre) {
            const creada = await tx.categoriaProfesional.upsert({
              where: { nombre: String(cp.categoriaNombre).trim() },
              update: {},
              create: { nombre: String(cp.categoriaNombre).trim() },
            });
            cId = creada.id;
            mapaCatPorNombre.set(creada.nombre.toLowerCase(), creada.id);
          }
          if (cId) setCargos.add(cId);
        }
        cargosIdsFinales = Array.from(setCargos);
      }

      // 2) Sincronizar metasPorTurno (ServicioTurnoMeta)
      if (Array.isArray(opciones.metasPorTurno) && tx.servicioTurnoMeta) {
        const conservadosMetaIds = metasNormalizadas.map((m) => m.tipoTurnoId);
        if (conservadosMetaIds.length > 0) {
          await tx.servicioTurnoMeta.deleteMany({
            where: { servicioId, tipoTurnoId: { notIn: conservadosMetaIds } },
          });
        } else {
          await tx.servicioTurnoMeta.deleteMany({ where: { servicioId } });
        }

        for (const m of metasNormalizadas) {
          await tx.servicioTurnoMeta.upsert({
            where: {
              servicioId_tipoTurnoId: { servicioId, tipoTurnoId: m.tipoTurnoId },
            },
            update: {
              habilitado: m.habilitado,
              minimoBase: m.minimoBase,
              esperadoBase: m.esperadoBase,
              minimoDomFest: m.minimoDomFest,
              esperadoDomFest: m.esperadoDomFest,
            },
            create: {
              servicioId,
              tipoTurnoId: m.tipoTurnoId,
              habilitado: m.habilitado,
              minimoBase: m.minimoBase,
              esperadoBase: m.esperadoBase,
              minimoDomFest: m.minimoDomFest,
              esperadoDomFest: m.esperadoDomFest,
            },
          });
        }

        totalesDerivados = await this.calcularTotalesDerivadosDeMetas(
          metasNormalizadas,
          mapaTurnoPorId,
          mapaTurnoPorCod
        );
      }

      // 3) Sincronizar tablas legacy reglasPorCargo + ServicioTurnoHabilitado (transición)
      const categoriasConservadas: string[] = [...cargosIdsFinales];
      if (Array.isArray(opciones.reglasPorCargo)) {
        for (const regla of opciones.reglasPorCargo) {
          let catId =
            regla.categoriaId ||
            mapaCatPorNombre.get((regla.categoriaNombre || '').trim().toLowerCase());
          if (!catId && regla.categoriaNombre) {
            const creada = await tx.categoriaProfesional.upsert({
              where: { nombre: regla.categoriaNombre.trim() },
              update: {},
              create: { nombre: regla.categoriaNombre.trim() },
            });
            catId = creada.id;
            mapaCatPorNombre.set(creada.nombre.toLowerCase(), creada.id);
          }
          if (!catId) continue;
          if (!categoriasConservadas.includes(catId)) {
            categoriasConservadas.push(catId);
          }

          const listaExplicita = Array.isArray(regla.turnosHabilitados);
          const codigosCat = listaExplicita
            ? regla.turnosHabilitados!.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
            : turnosServicio;

          const turnosObjCat = codigosCat
            .map((cod) => mapaTurnoPorCod.get(cod))
            .filter(Boolean);

          const sinTurnosCat = listaExplicita && codigosCat.length === 0;
          const tieneNocheCat = sinTurnosCat
            ? false
            : turnosObjCat.length === 0 ||
              turnosObjCat.some(
                (t) =>
                  t &&
                  t.horasOrdinarias > 0 &&
                  (t.esNocturnoPesado || t.horasNocturnas >= UMBRAL_HORAS_TURNO_NOCTURNO)
              );
          const tieneDiaCat = sinTurnosCat
            ? false
            : turnosObjCat.length === 0 ||
              turnosObjCat.some(
                (t) =>
                  t &&
                  t.horasOrdinarias > 0 &&
                  (t.horasOrdinarias >= 24 ||
                    (!t.esNocturnoPesado && t.horasNocturnas < UMBRAL_HORAS_TURNO_NOCTURNO))
              );

          const reqD = tieneDiaCat ? Math.max(0, Number(regla.reqDia) || 0) : 0;
          const reqN = tieneNocheCat ? Math.max(0, Number(regla.reqNoche) || 0) : 0;
          const reqDDomFest = tieneDiaCat
            ? regla.reqDiaDomFest !== undefined
              ? Math.max(0, Number(regla.reqDiaDomFest) || 0)
              : reqD
            : 0;
          const reqNDomFest = tieneNocheCat
            ? regla.reqNocheDomFest !== undefined
              ? Math.max(0, Number(regla.reqNocheDomFest) || 0)
              : reqN
            : 0;

          await tx.requerimientoCobertura.upsert({
            where: {
              servicioId_categoriaId: {
                servicioId,
                categoriaId: catId,
              },
            },
            update: {
              reqDia: reqD,
              reqNoche: reqN,
              reqDiaDomFest: reqDDomFest,
              reqNocheDomFest: reqNDomFest,
            },
            create: {
              servicioId,
              categoriaId: catId,
              reqDia: reqD,
              reqNoche: reqN,
              reqDiaDomFest: reqDDomFest,
              reqNocheDomFest: reqNDomFest,
            },
          });

          await tx.servicioTurnoHabilitado.deleteMany({
            where: { servicioId, categoriaId: catId },
          });

          const filasTurnos = codigosCat
            .map((cod) => mapaTurnoPorCodId.get(cod))
            .filter((id): id is string => Boolean(id))
            .map((tipoTurnoId) => ({
              servicioId,
              categoriaId: catId!,
              tipoTurnoId,
              habilitado: true,
            }));

          if (filasTurnos.length > 0) {
            await tx.servicioTurnoHabilitado.createMany({
              data: filasTurnos,
              skipDuplicates: true,
            });
          }
        }

        if (categoriasConservadas.length > 0) {
          await tx.servicioTurnoHabilitado.deleteMany({
            where: { servicioId, categoriaId: { notIn: categoriasConservadas } },
          });
          await tx.requerimientoCobertura.deleteMany({
            where: { servicioId, categoriaId: { notIn: categoriasConservadas } },
          });
        } else {
          await tx.servicioTurnoHabilitado.deleteMany({ where: { servicioId } });
          await tx.requerimientoCobertura.deleteMany({ where: { servicioId } });
        }
      }

      if ((tieneCargosExplicitos || Array.isArray(opciones.reglasPorCargo)) && tx.servicioCargoPermitido) {
        if (categoriasConservadas.length > 0) {
          await tx.servicioCargoPermitido.deleteMany({
            where: { servicioId, categoriaId: { notIn: categoriasConservadas } },
          });
          await tx.servicioCargoPermitido.createMany({
            data: categoriasConservadas.map((categoriaId) => ({ servicioId, categoriaId })),
            skipDuplicates: true,
          });
        } else if (tieneCargosExplicitos) {
          await tx.servicioCargoPermitido.deleteMany({ where: { servicioId } });
        }
      }
    });

    return { totalesDerivados };
  }

  private async adscribirEmpleadosInterno(
    servicioId: string,
    empleadosIdsRaw?: string[],
    cargosPermitidosIdsHint?: string[]
  ): Promise<{ empleadosAdscritos: number; advertenciasCargo: string[] }> {
    const ids = Array.isArray(empleadosIdsRaw)
      ? Array.from(new Set(empleadosIdsRaw.map((id) => String(id).trim()).filter(Boolean)))
      : [];
    if (ids.length === 0) {
      return { empleadosAdscritos: 0, advertenciasCargo: [] };
    }

    const empleados = await this.prisma.empleado.findMany({
      where: { id: { in: ids } },
      include: { categoria: true },
    });
    if (empleados.length === 0) {
      return { empleadosAdscritos: 0, advertenciasCargo: [] };
    }

    let permitidosIds = Array.isArray(cargosPermitidosIdsHint) ? cargosPermitidosIdsHint : [];
    if (permitidosIds.length === 0 && (this.prisma as any).servicioCargoPermitido?.findMany) {
      const cp = await (this.prisma as any).servicioCargoPermitido.findMany({
        where: { servicioId },
        select: { categoriaId: true },
      });
      if (Array.isArray(cp)) {
        permitidosIds = cp.map((x: any) => x.categoriaId).filter(Boolean);
      }
    }

    const permitidos = new Set(permitidosIds);
    const advertenciasCargo =
      permitidos.size > 0
        ? empleados
            .filter((e) => !permitidos.has(e.categoriaId))
            .map((e) => `${e.nombre} (${e.categoria?.nombre || e.categoriaId})`)
        : [];

    const validIds = empleados.map((e) => e.id);
    await this.prisma.empleado.updateMany({
      where: { id: { in: validIds } },
      data: { servicioBaseId: servicioId },
    });

    return {
      empleadosAdscritos: validIds.length,
      advertenciasCargo,
    };
  }

  // 2. Crear un servicio nuevo (autónomo en Rafa Turnos)
  @Post()
  async crearServicio(
    @Body()
    data: {
      codigo: string;
      nombre: string;
      tipoAsistencia?: any;
      macroprocesoId?: string;
      intranetId?: string;
      reqDia?: number;
      reqNoche?: number;
      modalidadDias?: string;
      reqDiaDomFest?: number;
      reqNocheDomFest?: number;
      permitePermutaEntreCargos?: boolean;
      cargosPermitidosIds?: string[];
      cargosPermitidos?: Array<{ categoriaId?: string; categoriaNombre?: string }>;
      metasPorTurno?: any[];
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
      empleadosIds?: string[];
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

    const turnosDeMetas = Array.isArray(data.metasPorTurno)
      ? data.metasPorTurno
          .filter((m) => m?.habilitado !== false && m?.codigoTurno)
          .map((m) => String(m.codigoTurno).trim().toUpperCase())
      : [];
    const baseTurnos = Array.isArray(data.turnosHabilitados)
      ? data.turnosHabilitados.map((t) => String(t).trim().toUpperCase()).filter(Boolean)
      : ['M8', 'T8', 'N8', 'D12', 'G24', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'];
    const turnosLimpios = Array.from(new Set([...turnosDeMetas, ...baseTurnos]));

    const reqD = data.reqDia !== undefined ? Math.max(0, Number(data.reqDia) || 0) : 4;
    const reqN = data.reqNoche !== undefined ? Math.max(0, Number(data.reqNoche) || 0) : 2;
    const macroprocesoId = await this.resolverMacroprocesoId(data.macroprocesoId || data.tipoAsistencia);

    const creado = await this.prisma.servicio.create({
      data: {
        codigo: cod,
        nombre: nom,
        macroprocesoId,
        intranetId: data.intranetId,
        permitePermutaEntreCargos: Boolean(data.permitePermutaEntreCargos),
        reqDia: reqD,
        reqNoche: reqN,
        modalidadDias: data.modalidadDias || 'TODOS_24_7',
        reqDiaDomFest: data.reqDiaDomFest !== undefined ? Math.max(0, Number(data.reqDiaDomFest) || 0) : reqD,
        reqNocheDomFest: data.reqNocheDomFest !== undefined ? Math.max(0, Number(data.reqNocheDomFest) || 0) : reqN,
        turnosHabilitadosCodigos: turnosLimpios,
      },
    });

    const { totalesDerivados } = await this.sincronizarConfiguracionServicioEnDb(
      creado.id,
      turnosLimpios,
      {
        cargosPermitidosIds: data.cargosPermitidosIds,
        cargosPermitidos: data.cargosPermitidos,
        metasPorTurno: data.metasPorTurno,
        reglasPorCargo: data.reglasPorCargo,
      }
    );

    const { empleadosAdscritos, advertenciasCargo } = await this.adscribirEmpleadosInterno(
      creado.id,
      data.empleadosIds,
      data.cargosPermitidosIds
    );

    if (totalesDerivados) {
      const actualizado = await this.prisma.servicio.update({
        where: { id: creado.id },
        data: totalesDerivados,
      });
      return { ...actualizado, empleadosAdscritos, advertenciasCargo };
    }
    return { ...creado, empleadosAdscritos, advertenciasCargo };
  }

  // 2.0 Adscribir o trasladar colaboradores (siempre registrado ANTES de :id para evitar colisión de rutas)
  @Put('adscribir-empleado')
  async adscribirEmpleadoAServicio(
    @Body() body: { empleadoId: string; servicioBaseId: string }
  ) {
    const empleadoId = String(body?.empleadoId || '').trim();
    const servicioBaseId = String(body?.servicioBaseId || '').trim();
    if (!empleadoId || !servicioBaseId) {
      throw new BadRequestException('empleadoId y servicioBaseId son obligatorios.');
    }

    const [emp, srv] = await Promise.all([
      this.prisma.empleado.findUnique({
        where: { id: empleadoId },
        include: { categoria: true },
      }),
      this.prisma.servicio.findUnique({
        where: { id: servicioBaseId },
        include: { cargosPermitidos: true },
      }),
    ]);
    if (!emp) {
      throw new NotFoundException(`No se encontró el colaborador '${empleadoId}'.`);
    }
    if (!srv) {
      throw new NotFoundException(`No se encontró el servicio '${servicioBaseId}'.`);
    }

    const permitidos = new Set(((srv as any).cargosPermitidos || []).map((cp: any) => cp.categoriaId));
    const advertenciaCargoCompatible =
      permitidos.size > 0 && !permitidos.has(emp.categoriaId)
        ? `Aviso: El cargo "${emp.categoria?.nombre || emp.categoriaId}" aún no figura entre los cargos permitidos de "${srv.nombre}".`
        : null;

    const actualizado = await this.prisma.empleado.update({
      where: { id: empleadoId },
      data: { servicioBaseId },
    });

    return {
      ...actualizado,
      advertenciaCargoCompatible,
    };
  }

  @Put('adscribir-lote')
  async adscribirLoteAServicio(
    @Body() body: { empleadoIds: string[]; servicioBaseId: string }
  ) {
    const servicioBaseId = String(body?.servicioBaseId || '').trim();
    const empleadoIds = Array.isArray(body?.empleadoIds)
      ? Array.from(new Set(body.empleadoIds.map((id) => String(id).trim()).filter(Boolean)))
      : [];

    if (!servicioBaseId || empleadoIds.length === 0) {
      throw new BadRequestException('Debe indicar servicioBaseId y al menos un empleadoId.');
    }

    const srv = await this.prisma.servicio.findUnique({
      where: { id: servicioBaseId },
      include: { cargosPermitidos: true },
    });
    if (!srv) {
      throw new NotFoundException(`No se encontró el servicio '${servicioBaseId}'.`);
    }

    const empleados = await this.prisma.empleado.findMany({
      where: { id: { in: empleadoIds } },
      include: { categoria: true },
    });
    if (empleados.length === 0) {
      throw new NotFoundException('Ninguno de los empleados indicados fue encontrado.');
    }

    const permitidos = new Set(((srv as any).cargosPermitidos || []).map((cp: any) => cp.categoriaId));
    const advertenciasCargo =
      permitidos.size > 0
        ? empleados
            .filter((e) => !permitidos.has(e.categoriaId))
            .map((e) => `${e.nombre} (${e.categoria?.nombre || e.categoriaId})`)
        : [];

    const validIds = empleados.map((e) => e.id);
    await this.prisma.empleado.updateMany({
      where: { id: { in: validIds } },
      data: { servicioBaseId },
    });

    return {
      ok: true,
      servicioBaseId,
      servicioNombre: srv.nombre,
      trasladados: validIds.length,
      advertenciasCargo,
    };
  }

  // 2.0b Actualizar condiciones contractuales/adscripción de un colaborador (Gestión de Personal)
  @Put('empleados/:id/condiciones')
  async actualizarCondicionesEmpleado(
    @Param('id') empleadoId: string,
    @Body()
    body: {
      servicioBaseId?: string;
      empresaContratanteId?: string;
      horasSemanalesOverride?: number | null;
    }
  ) {
    const id = String(empleadoId || '').trim();
    if (!id) {
      throw new BadRequestException('El identificador del colaborador es obligatorio.');
    }

    const emp = await this.prisma.empleado.findUnique({
      where: { id },
      include: { categoria: true, empresaContratante: true, servicioBase: true },
    });
    if (!emp) {
      throw new NotFoundException(`No se encontró el colaborador '${id}'.`);
    }

    const updateData: any = {};
    let advertenciaCargoCompatible: string | null = null;
    let empresaDestino = (emp as any).empresaContratante;

    if (body?.servicioBaseId !== undefined) {
      const servicioBaseId = String(body.servicioBaseId || '').trim();
      if (!servicioBaseId) {
        throw new BadRequestException('servicioBaseId no puede quedar vacío.');
      }
      const srv = await this.prisma.servicio.findUnique({
        where: { id: servicioBaseId },
        include: { cargosPermitidos: true },
      });
      if (!srv) {
        throw new NotFoundException(`No se encontró el servicio '${servicioBaseId}'.`);
      }
      const permitidos = new Set(
        ((srv as any).cargosPermitidos || []).map((cp: any) => cp.categoriaId)
      );
      if (permitidos.size > 0 && !permitidos.has(emp.categoriaId)) {
        advertenciaCargoCompatible = `Aviso: El cargo "${emp.categoria?.nombre || emp.categoriaId}" aún no figura entre los cargos permitidos de "${srv.nombre}".`;
      }
      updateData.servicioBaseId = servicioBaseId;
    }

    if (body?.empresaContratanteId !== undefined) {
      const empresaContratanteId = String(body.empresaContratanteId || '').trim();
      if (!empresaContratanteId) {
        throw new BadRequestException('empresaContratanteId no puede quedar vacío.');
      }
      const empresa = await (this.prisma as any).empresaContratante?.findUnique({
        where: { id: empresaContratanteId },
      });
      if (!empresa) {
        throw new NotFoundException(`No se encontró la empresa '${empresaContratanteId}'.`);
      }
      updateData.empresaContratanteId = empresaContratanteId;
      empresaDestino = empresa;
    }

    if (body?.horasSemanalesOverride !== undefined) {
      if (body.horasSemanalesOverride === null || (body.horasSemanalesOverride as any) === '') {
        updateData.horasSemanalesOverride = null;
        const horasEmp = Number(empresaDestino?.horasSemanalesContrato || emp.horasSemanalesLey || 42);
        updateData.horasSemanalesLey = Math.round(horasEmp);
      } else {
        const horas = Number(body.horasSemanalesOverride);
        if (!Number.isFinite(horas) || horas <= 0 || horas > 72) {
          throw new BadRequestException(
            'horasSemanalesOverride debe ser un número válido mayor a 0 y menor o igual a 72 (o null para usar la regla de empresa).'
          );
        }
        updateData.horasSemanalesOverride = horas;
        updateData.horasSemanalesLey = Math.round(horas);
      }
    } else if (updateData.empresaContratanteId && (emp as any).horasSemanalesOverride == null) {
      const horasEmp = Number(empresaDestino?.horasSemanalesContrato || emp.horasSemanalesLey || 42);
      updateData.horasSemanalesLey = Math.round(horasEmp);
    }

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('Debe especificar al menos un campo a actualizar.');
    }

    const actualizado = await this.prisma.empleado.update({
      where: { id },
      data: updateData,
      include: {
        categoria: true,
        servicioBase: true,
        empresaContratante: true,
      },
    });

    if (
      (updateData.empresaContratanteId || body?.horasSemanalesOverride !== undefined) &&
      updateData.empresaContratanteId &&
      typeof (this.liquidacionService as any)?.recalcularPorEmpresa === 'function'
    ) {
      await (this.liquidacionService as any).recalcularPorEmpresa(updateData.empresaContratanteId);
    }

    return {
      ...actualizado,
      advertenciaCargoCompatible,
    };
  }

  // 2.1 Actualizar datos de un servicio existente
  @Put(':id')
  async actualizarServicio(
    @Param('id') id: string,
    @Body()
    data: {
      codigo: string;
      nombre: string;
      tipoAsistencia?: any;
      macroprocesoId?: string;
      reqDia?: number;
      reqNoche?: number;
      modalidadDias?: string;
      reqDiaDomFest?: number;
      reqNocheDomFest?: number;
      permitePermutaEntreCargos?: boolean;
      cargosPermitidosIds?: string[];
      cargosPermitidos?: Array<{ categoriaId?: string; categoriaNombre?: string }>;
      metasPorTurno?: any[];
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
      empleadosIds?: string[];
    }
  ) {
    const existente = await this.prisma.servicio.findUnique({ where: { id } });
    if (!existente) {
      throw new NotFoundException(`No se encontró el servicio '${id}'.`);
    }

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

    const turnosDeMetas = Array.isArray(data.metasPorTurno)
      ? data.metasPorTurno
          .filter((m) => m?.habilitado !== false && m?.codigoTurno)
          .map((m) => String(m.codigoTurno).trim().toUpperCase())
      : [];

    const turnosLimpios = Array.isArray(data.turnosHabilitados)
      ? Array.from(
          new Set([
            ...turnosDeMetas,
            ...data.turnosHabilitados.map((t) => String(t).trim().toUpperCase()).filter(Boolean),
          ])
        )
      : undefined;

    const tiposTurnoDb = await this.prisma.tipoTurno.findMany();
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t]));
    const turnosObjSrv = (turnosLimpios || [])
      .map((c) => mapaTurnoPorCod.get(c))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const tieneNocheSrv =
      !turnosLimpios || turnosObjSrv.length === 0
        ? true
        : turnosObjSrv.some(
            (t) =>
              t.horasOrdinarias > 0 &&
              (t.esNocturnoPesado || t.horasNocturnas >= UMBRAL_HORAS_TURNO_NOCTURNO)
          );
    const tieneDiaSrv =
      !turnosLimpios || turnosObjSrv.length === 0
        ? true
        : turnosObjSrv.some(
            (t) =>
              t.horasOrdinarias > 0 &&
              (t.horasOrdinarias >= 24 ||
                (!t.esNocturnoPesado && t.horasNocturnas < UMBRAL_HORAS_TURNO_NOCTURNO))
          );

    const macroprocesoEntrada = data.macroprocesoId || data.tipoAsistencia;
    const macroprocesoId = macroprocesoEntrada
      ? await this.resolverMacroprocesoId(macroprocesoEntrada)
      : existente.macroprocesoId;

    const actualizado = await this.prisma.servicio.update({
      where: { id },
      data: {
        codigo: cod,
        nombre: nom,
        macroprocesoId,
        ...(data.permitePermutaEntreCargos !== undefined
          ? { permitePermutaEntreCargos: Boolean(data.permitePermutaEntreCargos) }
          : {}),
        ...(data.reqDia !== undefined ? { reqDia: tieneDiaSrv ? Math.max(0, Number(data.reqDia) || 0) : 0 } : {}),
        ...(data.reqNoche !== undefined ? { reqNoche: tieneNocheSrv ? Math.max(0, Number(data.reqNoche) || 0) : 0 } : {}),
        ...(data.modalidadDias !== undefined ? { modalidadDias: data.modalidadDias } : {}),
        ...(data.reqDiaDomFest !== undefined ? { reqDiaDomFest: tieneDiaSrv ? Math.max(0, Number(data.reqDiaDomFest) || 0) : 0 } : {}),
        ...(data.reqNocheDomFest !== undefined ? { reqNocheDomFest: tieneNocheSrv ? Math.max(0, Number(data.reqNocheDomFest) || 0) : 0 } : {}),
        ...(turnosLimpios !== undefined ? { turnosHabilitadosCodigos: turnosLimpios } : {}),
      },
    });

    const { totalesDerivados } = await this.sincronizarConfiguracionServicioEnDb(
      id,
      turnosLimpios || actualizado.turnosHabilitadosCodigos || ['M8', 'T8', 'N8'],
      {
        cargosPermitidosIds: data.cargosPermitidosIds,
        cargosPermitidos: data.cargosPermitidos,
        metasPorTurno: data.metasPorTurno,
        tiposTurnoPreloaded: tiposTurnoDb,
        reglasPorCargo: data.reglasPorCargo,
      }
    );

    const resultadoServicio =
      totalesDerivados && data.reqDia === undefined && data.reqNoche === undefined
        ? await this.prisma.servicio.update({
            where: { id },
            data: totalesDerivados,
          })
        : actualizado;

    const { empleadosAdscritos, advertenciasCargo } = await this.adscribirEmpleadosInterno(
      id,
      data.empleadosIds,
      data.cargosPermitidosIds
    );

    return {
      ...resultadoServicio,
      empleadosAdscritos,
      advertenciasCargo,
    };
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

    await this.prisma.$transaction(async (tx: any) => {
      await tx.servicioHermano.deleteMany({
        where: {
          OR: [{ servicioId: id }, { servicioHermanoId: id }],
        },
      });
      if (tx.servicioCargoPermitido) {
        await tx.servicioCargoPermitido.deleteMany({ where: { servicioId: id } });
      }
      if (tx.servicioTurnoMeta) {
        await tx.servicioTurnoMeta.deleteMany({ where: { servicioId: id } });
      }
      await tx.servicioTurnoHabilitado.deleteMany({
        where: { servicioId: id },
      });
      await tx.requerimientoCobertura.deleteMany({
        where: { servicioId: id },
      });
      await tx.servicio.delete({
        where: { id },
      });
    });

    return { mensaje: "Servicio '" + servicio.nombre + "' eliminado correctamente." };
  }

  // 3. Enlazar dos "Servicios Hermanos" validando compatibilidad real de cargos permitidos
  @Post(':id/enlace-hermano/:hermanoId')
  async enlazarServiciosHermanos(
    @Param('id') servicioId: string,
    @Param('hermanoId') hermanoId: string
  ) {
    if (!servicioId || !hermanoId) {
      throw new BadRequestException('Debe especificar ambos identificadores de servicio.');
    }
    if (servicioId === hermanoId) {
      throw new BadRequestException('Un servicio no puede enlazarse consigo mismo como servicio de apoyo.');
    }
    const [srvPrincipal, srvHermano] = await Promise.all([
      this.prisma.servicio.findUnique({
        where: { id: servicioId },
        include: { cargosPermitidos: { include: { categoria: true } } } as any,
      }),
      this.prisma.servicio.findUnique({
        where: { id: hermanoId },
        include: { cargosPermitidos: { include: { categoria: true } } } as any,
      }),
    ]);
    if (!srvPrincipal) {
      throw new NotFoundException(`El servicio principal '${servicioId}' no existe.`);
    }
    if (!srvHermano) {
      throw new NotFoundException(`El servicio hermano '${hermanoId}' no existe.`);
    }

    const cargosA: any[] = (srvPrincipal as any).cargosPermitidos || [];
    const cargosB: any[] = (srvHermano as any).cargosPermitidos || [];
    if (cargosA.length > 0 && cargosB.length > 0) {
      const setB = new Set(cargosB.map((c) => c.categoriaId));
      const compartenCargo = cargosA.some((c) => setB.has(c.categoriaId));
      if (!compartenCargo) {
        const nomA = cargosA.map((c) => c.categoria?.nombre || c.categoriaId).join(', ');
        const nomB = cargosB.map((c) => c.categoria?.nombre || c.categoriaId).join(', ');
        throw new ConflictException(
          `Incompatibilidad de cargos entre '${srvPrincipal.nombre}' [${nomA}] y '${srvHermano.nombre}' [${nomB}]. Solo pueden hermanarse servicios con al menos un cargo profesional en común.`
        );
      }
    }

    await this.prisma.$transaction([
      this.prisma.servicioHermano.upsert({
        where: {
          servicioId_servicioHermanoId: { servicioId, servicioHermanoId: hermanoId },
        },
        create: { servicioId, servicioHermanoId: hermanoId },
        update: {},
      }),
      this.prisma.servicioHermano.upsert({
        where: {
          servicioId_servicioHermanoId: { servicioId: hermanoId, servicioHermanoId: servicioId },
        },
        create: { servicioId: hermanoId, servicioHermanoId: servicioId },
        update: {},
      }),
    ]);

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
}
