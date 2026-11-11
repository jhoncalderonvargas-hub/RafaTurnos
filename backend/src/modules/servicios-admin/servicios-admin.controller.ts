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
  Post,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { desglosarHorarioOrdinario, hoyColombiaIso } from '../../shared/liquidacion-horas';
import { LiquidacionService } from '../liquidacion/liquidacion.module';

function normalizarCodigoMacroproceso(tipo: any): string {
  if (!tipo) return 'URGENCIAS';
  const val = String(tipo).trim().toUpperCase();
  if (val === 'UCI' || val === 'CUIDADOS_INTENSIVOS') return 'CUIDADOS_INTENSIVOS';
  if (val === 'AMBULATORIO' || val === 'CONSULTA_EXTERNA') return 'CONSULTA_EXTERNA';
  if (val === 'QUIRURGICO') return 'QUIRURGICO';
  if (val === 'HOSPITALIZACION') return 'HOSPITALIZACION';
  if (val === 'APOYO_DIAGNOSTICO') return 'APOYO_DIAGNOSTICO';
  if (val === 'ADMINISTRATIVO') return 'ADMINISTRATIVO';
  if (val === 'APOYO_OPERATIVO') return 'APOYO_OPERATIVO';
  if (val === 'URGENCIAS') return 'URGENCIAS';
  return val;
}

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

  // 1. Listar todos los servicios con sus servicios hermanos enlazados y desglose por cargo
  @Get()
  async listarServicios() {
    const servicios = await this.prisma.servicio.findMany({
      include: {
        macroproceso: true,
        serviciosHermanosOrigen: {
          include: { servicioHermano: true },
        },
        coberturas: {
          include: { categoria: true },
        },
        turnosHabilitados: {
          include: { categoria: true, tipoTurno: true },
        },
        empleadosBase: {
          include: { categoria: true },
        },
        _count: {
          select: { empleadosBase: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return servicios.map((s) => {
      const turnosSrv =
        Array.isArray(s.turnosHabilitadosCodigos) && s.turnosHabilitadosCodigos.length > 0
          ? s.turnosHabilitadosCodigos
          : ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'];

      // Agrupar turnos habilitados por categoría desde la tabla servicios_turnos_habilitados
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

      // Construir reglasPorCargo combinando requerimientos_cobertura y las categorías reales del servicio
      const mapaCoberturas = new Map<string, (typeof s.coberturas)[number]>();
      for (const cob of s.coberturas || []) {
        if (!cob.categoria) continue;
        mapaCoberturas.set(cob.categoria.nombre, cob);
      }

      const nombresCategorias = Array.from(
        new Set([...Array.from(conteoPorCat.keys()), ...Array.from(mapaCoberturas.keys())])
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

      return {
        id: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        macroprocesoId: s.macroprocesoId,
        macroprocesoNombre: s.macroproceso?.nombre,
        tipoAsistencia: s.macroproceso?.codigo || 'URGENCIAS',
        intranetId: s.intranetId,
        reqDia: s.reqDia ?? 4,
        reqNoche: s.reqNoche ?? 2,
        modalidadDias: s.modalidadDias || 'TODOS_24_7',
        reqDiaDomFest: s.reqDiaDomFest ?? s.reqDia ?? 4,
        reqNocheDomFest: s.reqNocheDomFest ?? s.reqNoche ?? 2,
        turnosHabilitados: turnosSrv,
        reglasPorCargo,
        empleadosCount: s._count.empleadosBase,
        hermanos: s.serviciosHermanosOrigen.map((sh) => ({
          id: sh.servicioHermano.id,
          codigo: sh.servicioHermano.codigo,
          nombre: sh.servicioHermano.nombre,
        })),
      };
    });
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

  // 1.1b Sincronización del Censo Maestro de Personal desde Intranet Hospitalaria
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
      return { ok: true, total: 0, creados: 0, actualizados: 0 };
    }

    const [categoriasDb, serviciosDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      this.prisma.servicio.findMany({ orderBy: { nombre: 'asc' } }),
    ]);

    const mapaCat = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const mapaServiciosPorCodigo = new Map(
      serviciosDb.map((s) => [s.codigo.trim().toUpperCase(), s.id])
    );
    const srvDefaultId =
      serviciosDb.find((s) => s.codigo === 'URG')?.id || serviciosDb[0]?.id;

    const docs = [
      ...new Set(
        censo
          .map((item: any) => String(item.documento || '').trim())
          .filter(Boolean)
      ),
    ];

    const existentesDb = await this.prisma.empleado.findMany({
      where: { documento: { in: docs } },
      select: { id: true, documento: true, nombre: true },
    });
    const mapaExistentes = new Map(existentesDb.map((e) => [e.documento, e]));

    let creados = 0;
    let actualizados = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const item of censo) {
        const doc = String(item.documento || '').trim();
        if (!doc) continue;

        // Resolver categoría (Cargo Profesional reportado por la Intranet)
        const cargoNombre = String(item.cargoNombre || 'Auxiliar de Enfermería').trim();
        let catId = mapaCat.get(cargoNombre.toLowerCase());
        if (!catId) {
          const nuevaCat = await tx.categoriaProfesional.create({
            data: { nombre: cargoNombre },
          });
          catId = nuevaCat.id;
          mapaCat.set(cargoNombre.toLowerCase(), catId);
        }

        const horasMes = Number(item.horasContratoMes) || 168;
        const correo = item.correo || `${doc}@hospital.gov.co`;

        const existente = mapaExistentes.get(doc);

        if (!existente) {
          const codSrv = String(item.servicioCodigo || '').trim().toUpperCase();
          const servicioAsignadoId =
            (codSrv ? mapaServiciosPorCodigo.get(codSrv) : undefined) || srvDefaultId;
          if (!servicioAsignadoId) continue;
          const nuevo = await tx.empleado.create({
            data: {
              documento: doc,
              nombre: item.nombre || `Colaborador ${doc}`,
              correo,
              horasSemanalesLey: 42,
              horasContratoMes: horasMes,
              categoriaId: catId,
              servicioBaseId: servicioAsignadoId,
            },
            select: { id: true, documento: true, nombre: true },
          });
          mapaExistentes.set(doc, nuevo);
          creados++;
        } else {
          // La Intranet solo abarca hasta el Cargo Profesional (categoriaId);
          // el servicioBaseId es propiedad exclusiva de Rafa Turnos y no se sobrescribe.
          await tx.empleado.update({
            where: { id: existente.id },
            data: {
              nombre: item.nombre || existente.nombre,
              correo,
              horasContratoMes: horasMes,
              categoriaId: catId,
            },
          });
          actualizados++;
        }
      }
    });

    return {
      ok: true,
      mensaje: `Censo sincronizado exitosamente con la Intranet Hospitalaria.`,
      total: censo.length,
      creados,
      actualizados,
    };
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
      minutosAlmuerzo?: number;
      colorHex: string;
      descuentaBancoHoras?: boolean;
      horasAmortizacionBanco?: number | null;
      esNocturnoPesado?: boolean;
      visibleEnPaleta?: boolean;
      modoJornada?: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO';
    }
  ) {
    const cod = String(data?.codigo || '').trim().toUpperCase();
    const nom = String(data?.nombre || '').trim();
    if (!cod || !nom) {
      throw new BadRequestException('El código y el nombre del turno son obligatorios.');
    }

    const minAlmuerzo =
      data.minutosAlmuerzo !== undefined ? Math.max(0, Number(data.minutosAlmuerzo) || 0) : 0;
    const codNoOperativo = ['L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM', 'DISP', 'BLANCO'].includes(
      cod
    );
    let horaInicio = String(data.horaInicio || '00:00').trim() || '00:00';
    let horaFin = String(data.horaFin || '00:00').trim() || '00:00';
    let horasOrdinarias = Number(data.horasOrdinarias) || 0;
    let horasDiurnas = Number(data.horasDiurnas) || 0;
    let horasNocturnas = Number(data.horasNocturnas) || 0;

    if (data.modoJornada === 'DESCANSO') {
      horaInicio = '00:00';
      horaFin = '00:00';
      horasOrdinarias = 0;
      horasDiurnas = 0;
      horasNocturnas = 0;
    } else if (
      !codNoOperativo &&
      (horasOrdinarias > 0 || data.modoJornada === 'HORARIO' || data.modoJornada === 'GUARDIA_24H') &&
      horaInicio &&
      horaFin
    ) {
      const esGuardia24 =
        data.modoJornada === 'GUARDIA_24H' || cod === 'G24' || Number(data.horasOrdinarias) >= 24;
      const desglose = desglosarHorarioOrdinario(
        horaInicio,
        horaFin,
        minAlmuerzo,
        hoyColombiaIso(),
        esGuardia24
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

    const horasAmortizacionBanco =
      data.horasAmortizacionBanco !== undefined && data.horasAmortizacionBanco !== null
        ? Math.max(0.5, Number(data.horasAmortizacionBanco) || 8)
        : 8;

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
        minutosAlmuerzo: minAlmuerzo,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        horasAmortizacionBanco,
        esNocturnoPesado: !!data.esNocturnoPesado,
        visibleEnPaleta: data.visibleEnPaleta !== undefined ? !!data.visibleEnPaleta : true,
      },
      update: {
        nombre: nom,
        horaInicio,
        horaFin,
        horasOrdinarias,
        horasDiurnas,
        horasNocturnas,
        minutosAlmuerzo: minAlmuerzo,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        horasAmortizacionBanco,
        esNocturnoPesado: !!data.esNocturnoPesado,
        ...(data.visibleEnPaleta !== undefined ? { visibleEnPaleta: !!data.visibleEnPaleta } : {}),
      },
    });

    await this.liquidacionService.recalcularPorTipoTurno(guardado.id);
    return guardado;
  }

  private async sincronizarReglasPorCargoEnDb(
    servicioId: string,
    turnosServicio: string[],
    reglasPorCargo?: {
      categoriaId?: string;
      categoriaNombre: string;
      reqDia?: number;
      reqNoche?: number;
      reqDiaDomFest?: number;
      reqNocheDomFest?: number;
      turnosHabilitados?: string[];
    }[]
  ) {
    if (!Array.isArray(reglasPorCargo)) return;

    const [categoriasDb, tiposTurnoDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      this.prisma.tipoTurno.findMany(),
    ]);

    const mapaCatPorNombre = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t.id]));
    const mapaTurnoPorId = new Map(tiposTurnoDb.map((t) => [t.id, t]));

    await this.prisma.$transaction(async (tx) => {
      const categoriasConservadas: string[] = [];

      for (const regla of reglasPorCargo) {
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
        categoriasConservadas.push(catId);

        const listaExplicita = Array.isArray(regla.turnosHabilitados);
        const codigosCat = listaExplicita
          ? regla.turnosHabilitados!.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
          : turnosServicio;

        const turnosObjCat = codigosCat
          .map((cod) => mapaTurnoPorCod.get(cod))
          .filter((id): id is string => Boolean(id))
          .map((id) => mapaTurnoPorId.get(id));

        const sinTurnosCat = listaExplicita && codigosCat.length === 0;
        const tieneNocheCat = sinTurnosCat
          ? false
          : turnosObjCat.length === 0 ||
            turnosObjCat.some(
              (t) => t && t.horasOrdinarias > 0 && (t.esNocturnoPesado || t.horasNocturnas >= 6)
            );
        const tieneDiaCat = sinTurnosCat
          ? false
          : turnosObjCat.length === 0 ||
            turnosObjCat.some(
              (t) =>
                t &&
                t.horasOrdinarias > 0 &&
                (t.horasOrdinarias >= 24 || (!t.esNocturnoPesado && t.horasNocturnas < 6))
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
          .map((cod) => mapaTurnoPorCod.get(cod))
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
    });
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
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
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

    const turnosLimpios = Array.isArray(data.turnosHabilitados)
      ? Array.from(new Set(data.turnosHabilitados.map((t) => String(t).trim().toUpperCase()).filter(Boolean)))
      : ['M8', 'T8', 'N8', 'D12', 'G24', 'S', 'L', 'COMP', 'FAM', 'VAC', 'INC', 'LIC'];

    const reqD = data.reqDia !== undefined ? Math.max(0, Number(data.reqDia) || 0) : 4;
    const reqN = data.reqNoche !== undefined ? Math.max(0, Number(data.reqNoche) || 0) : 2;
    const macroprocesoId = await this.resolverMacroprocesoId(data.macroprocesoId || data.tipoAsistencia);

    const creado = await this.prisma.servicio.create({
      data: {
        codigo: cod,
        nombre: nom,
        macroprocesoId,
        intranetId: data.intranetId,
        reqDia: reqD,
        reqNoche: reqN,
        modalidadDias: data.modalidadDias || 'TODOS_24_7',
        reqDiaDomFest: data.reqDiaDomFest !== undefined ? Math.max(0, Number(data.reqDiaDomFest) || 0) : reqD,
        reqNocheDomFest: data.reqNocheDomFest !== undefined ? Math.max(0, Number(data.reqNocheDomFest) || 0) : reqN,
        turnosHabilitadosCodigos: turnosLimpios,
      },
    });

    await this.sincronizarReglasPorCargoEnDb(creado.id, turnosLimpios, data.reglasPorCargo);
    return creado;
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
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
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

    const turnosLimpios = Array.isArray(data.turnosHabilitados)
      ? Array.from(new Set(data.turnosHabilitados.map((t) => String(t).trim().toUpperCase()).filter(Boolean)))
      : undefined;

    const tiposTurnoDb = await this.prisma.tipoTurno.findMany();
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t]));
    const turnosObjSrv = (turnosLimpios || [])
      .map((c) => mapaTurnoPorCod.get(c))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));

    const tieneNocheSrv =
      !turnosLimpios || turnosObjSrv.length === 0
        ? true
        : turnosObjSrv.some((t) => t.horasOrdinarias > 0 && (t.esNocturnoPesado || t.horasNocturnas >= 6));
    const tieneDiaSrv =
      !turnosLimpios || turnosObjSrv.length === 0
        ? true
        : turnosObjSrv.some(
            (t) => t.horasOrdinarias > 0 && (t.horasOrdinarias >= 24 || (!t.esNocturnoPesado && t.horasNocturnas < 6))
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
        ...(data.reqDia !== undefined ? { reqDia: tieneDiaSrv ? Math.max(0, Number(data.reqDia) || 0) : 0 } : {}),
        ...(data.reqNoche !== undefined ? { reqNoche: tieneNocheSrv ? Math.max(0, Number(data.reqNoche) || 0) : 0 } : {}),
        ...(data.modalidadDias !== undefined ? { modalidadDias: data.modalidadDias } : {}),
        ...(data.reqDiaDomFest !== undefined ? { reqDiaDomFest: tieneDiaSrv ? Math.max(0, Number(data.reqDiaDomFest) || 0) : 0 } : {}),
        ...(data.reqNocheDomFest !== undefined ? { reqNocheDomFest: tieneNocheSrv ? Math.max(0, Number(data.reqNocheDomFest) || 0) : 0 } : {}),
        ...(turnosLimpios !== undefined ? { turnosHabilitadosCodigos: turnosLimpios } : {}),
      },
    });

    await this.sincronizarReglasPorCargoEnDb(
      id,
      turnosLimpios || actualizado.turnosHabilitadosCodigos || ['M8', 'T8', 'N8'],
      data.reglasPorCargo
    );

    return actualizado;
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

    // Se eliminan los vínculos en una sola transacción atómica
    await this.prisma.$transaction(async (tx) => {
      await tx.servicioHermano.deleteMany({
        where: {
          OR: [{ servicioId: id }, { servicioHermanoId: id }],
        },
      });

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

  // 3. Enlazar dos "Servicios Hermanos" para habilitar rotación de personal homólogo (Atómico simétrico)
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
      this.prisma.servicio.findUnique({ where: { id: servicioId } }),
      this.prisma.servicio.findUnique({ where: { id: hermanoId } }),
    ]);
    if (!srvPrincipal) {
      throw new NotFoundException(`El servicio principal '${servicioId}' no existe.`);
    }
    if (!srvHermano) {
      throw new NotFoundException(`El servicio hermano '${hermanoId}' no existe.`);
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

  // 5. Adscribir o trasladar un colaborador a un servicio base
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
      this.prisma.empleado.findUnique({ where: { id: empleadoId } }),
      this.prisma.servicio.findUnique({ where: { id: servicioBaseId } }),
    ]);
    if (!emp) {
      throw new NotFoundException(`No se encontró el colaborador '${empleadoId}'.`);
    }
    if (!srv) {
      throw new NotFoundException(`No se encontró el servicio '${servicioBaseId}'.`);
    }

    return this.prisma.empleado.update({
      where: { id: empleadoId },
      data: { servicioBaseId },
    });
  }
}
