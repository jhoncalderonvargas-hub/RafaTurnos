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

  // 1. Listar todos los servicios con sus servicios hermanos enlazados y desglose por cargo
  @Get()
  async listarServicios() {
    const servicios = await this.prisma.servicio.findMany({
      include: {
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
        Array.isArray((s as any).turnosHabilitadosCodigos) && (s as any).turnosHabilitadosCodigos.length > 0
          ? (s as any).turnosHabilitadosCodigos
          : ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'VAC', 'INC'];

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
      const mapaCoberturas = new Map<string, any>();
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
        const reqM = (cob as any)?.reqManana ?? 1;
        const reqT = (cob as any)?.reqTarde ?? 1;
        const reqN = (cob as any)?.reqNoche ?? 0;
        return {
          categoriaId: cob?.categoriaId || infoCat?.id,
          categoriaNombre: catNombre,
          empleadosCount: infoCat?.count || 0,
          reqManana: reqM,
          reqTarde: reqT,
          reqNoche: reqN,
          reqMananaFds: (cob as any)?.reqMananaFds ?? reqM,
          reqTardeFds: (cob as any)?.reqTardeFds ?? reqT,
          reqNocheFds: (cob as any)?.reqNocheFds ?? reqN,
          turnosHabilitados: turnosCat && turnosCat.length > 0 ? turnosCat : turnosSrv,
        };
      });

      return {
        id: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        tipoAsistencia: s.tipoAsistencia,
        intranetId: s.intranetId,
        reqManana: s.reqManana ?? 4,
        reqTarde: s.reqTarde ?? 4,
        reqNoche: s.reqNoche ?? 2,
        modalidadDias: (s as any).modalidadDias || 'TODOS_24_7',
        reqMananaFds: (s as any).reqMananaFds ?? s.reqManana ?? 4,
        reqTardeFds: (s as any).reqTardeFds ?? s.reqTarde ?? 4,
        reqNocheFds: (s as any).reqNocheFds ?? s.reqNoche ?? 2,
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
    const intranetUrl =
      body?.intranetUrl || process.env.INTRANET_API_URL || 'http://localhost:4300';

    let censo: any[] = [];
    try {
      const resp = await fetch(`${intranetUrl}/api/intranet/empleados`);
      if (!resp.ok) {
        throw new BadRequestException(`Intranet respondió con código ${resp.status}`);
      }
      censo = await resp.json();
    } catch (err: any) {
      throw new BadRequestException(
        `No se pudo conectar con la Intranet en ${intranetUrl}: ${err.message}`
      );
    }

    if (!Array.isArray(censo) || censo.length === 0) {
      return { ok: true, total: 0, creados: 0, actualizados: 0 };
    }

    const [categoriasDb, serviciosDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      this.prisma.servicio.findMany(),
    ]);

    const mapaCat = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const mapaSrv = new Map(
      serviciosDb.map((s) => [s.codigo.trim().toUpperCase(), s.id])
    );
    for (const s of serviciosDb) {
      mapaSrv.set(s.id, s.id);
    }

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

        // Resolver categoría
        const cargoNombre = String(item.cargoNombre || 'Auxiliar de Enfermería').trim();
        let catId = mapaCat.get(cargoNombre.toLowerCase());
        if (!catId) {
          const nuevaCat = await tx.categoriaProfesional.create({
            data: { nombre: cargoNombre },
          });
          catId = nuevaCat.id;
          mapaCat.set(cargoNombre.toLowerCase(), catId);
        }

        // Resolver servicio base
        const srvCodigo = String(item.servicioCodigo || 'URG').trim().toUpperCase();
        const srvId = mapaSrv.get(srvCodigo) || serviciosDb[0]?.id;
        if (!srvId) continue;

        const horasMes = Number(item.horasContratoMes) || 168;
        const correo = item.correo || `${doc}@hospital.gov.co`;

        const existente = mapaExistentes.get(doc);

        if (!existente) {
          const nuevo = await tx.empleado.create({
            data: {
              documento: doc,
              nombre: item.nombre || `Colaborador ${doc}`,
              correo,
              horasSemanalesLey: 42,
              horasContratoMes: horasMes,
              categoriaId: catId,
              servicioBaseId: srvId,
            },
            select: { id: true, documento: true, nombre: true },
          });
          mapaExistentes.set(doc, nuevo);
          creados++;
        } else {
          await tx.empleado.update({
            where: { id: existente.id },
            data: {
              nombre: item.nombre || existente.nombre,
              horasContratoMes: horasMes,
              categoriaId: catId,
              ...(item.servicioCodigo ? { servicioBaseId: srvId } : {}),
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
      esNocturnoPesado?: boolean;
      visibleEnPaleta?: boolean;
    }
  ) {
    const cod = data.codigo.trim().toUpperCase();
    const minAlmuerzo = data.minutosAlmuerzo !== undefined ? Math.max(0, Number(data.minutosAlmuerzo) || 0) : 0;
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
        minutosAlmuerzo: minAlmuerzo,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        esNocturnoPesado: !!data.esNocturnoPesado,
        visibleEnPaleta: data.visibleEnPaleta !== undefined ? !!data.visibleEnPaleta : true,
      } as any,
      update: {
        nombre: data.nombre.trim(),
        horaInicio: data.horaInicio,
        horaFin: data.horaFin,
        horasOrdinarias: Number(data.horasOrdinarias) || 0,
        horasDiurnas: Number(data.horasDiurnas) || 0,
        horasNocturnas: Number(data.horasNocturnas) || 0,
        minutosAlmuerzo: minAlmuerzo,
        colorHex: data.colorHex || '#E0F2FE',
        descuentaBancoHoras: !!data.descuentaBancoHoras,
        esNocturnoPesado: !!data.esNocturnoPesado,
        ...(data.visibleEnPaleta !== undefined ? { visibleEnPaleta: !!data.visibleEnPaleta } : {}),
      } as any,
    });
  }

  private async sincronizarReglasPorCargoEnDb(
    servicioId: string,
    turnosServicio: string[],
    reglasPorCargo?: {
      categoriaId?: string;
      categoriaNombre: string;
      reqManana?: number;
      reqTarde?: number;
      reqNoche?: number;
      reqMananaFds?: number;
      reqTardeFds?: number;
      reqNocheFds?: number;
      turnosHabilitados?: string[];
    }[]
  ) {
    const [categoriasDb, tiposTurnoDb] = await Promise.all([
      this.prisma.categoriaProfesional.findMany(),
      this.prisma.tipoTurno.findMany(),
    ]);

    const mapaCatPorNombre = new Map(categoriasDb.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t.id]));
    const mapaTurnoPorId = new Map(tiposTurnoDb.map((t) => [t.id, t]));

    if (Array.isArray(reglasPorCargo) && reglasPorCargo.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        for (const regla of reglasPorCargo) {
          let catId =
            regla.categoriaId ||
            mapaCatPorNombre.get(
              (regla.categoriaNombre || '').trim().toLowerCase()
            );
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

          const codigosCat =
            Array.isArray(regla.turnosHabilitados) &&
            regla.turnosHabilitados.length > 0
              ? regla.turnosHabilitados.map((c) =>
                  String(c).trim().toUpperCase()
                )
              : turnosServicio;

          const turnosObjCat = codigosCat
            .map((cod) => mapaTurnoPorCod.get(cod))
            .filter((id): id is string => Boolean(id))
            .map((id) => mapaTurnoPorId.get(id));

          const tieneNocheCat = turnosObjCat.some(
            (t) => t && (t.esNocturnoPesado || t.horasNocturnas >= 6)
          );
          const tieneTardeCat = turnosObjCat.some(
            (t) => t && (t.horasDiurnas > 0 || (t.horaFin && parseInt(t.horaFin.split(':')[0], 10) >= 15))
          );
          const tieneMananaCat = turnosObjCat.some(
            (t) => t && (t.horasDiurnas > 0 || (t.horaInicio && parseInt(t.horaInicio.split(':')[0], 10) < 12))
          );

          const reqM = tieneMananaCat ? Math.max(0, Number(regla.reqManana) || 0) : 0;
          const reqT = tieneTardeCat ? Math.max(0, Number(regla.reqTarde) || 0) : 0;
          const reqN = tieneNocheCat ? Math.max(0, Number(regla.reqNoche) || 0) : 0;
          const reqMFds = tieneMananaCat
            ? regla.reqMananaFds !== undefined
              ? Math.max(0, Number(regla.reqMananaFds) || 0)
              : reqM
            : 0;
          const reqTFds = tieneTardeCat
            ? regla.reqTardeFds !== undefined
              ? Math.max(0, Number(regla.reqTardeFds) || 0)
              : reqT
            : 0;
          const reqNFds = tieneNocheCat
            ? regla.reqNocheFds !== undefined
              ? Math.max(0, Number(regla.reqNocheFds) || 0)
              : reqN
            : 0;

          await (tx.requerimientoCobertura as any).upsert({
            where: {
              servicioId_categoriaId: {
                servicioId,
                categoriaId: catId,
              },
            },
            update: {
              cantidadMinima: Math.max(1, reqM),
              reqManana: reqM,
              reqTarde: reqT,
              reqNoche: reqN,
              reqMananaFds: reqMFds,
              reqTardeFds: reqTFds,
              reqNocheFds: reqNFds,
            },
            create: {
              servicioId,
              categoriaId: catId,
              cantidadMinima: Math.max(1, reqM),
              aplicaFestivoDom: true,
              reqManana: reqM,
              reqTarde: reqT,
              reqNoche: reqN,
              reqMananaFds: reqMFds,
              reqTardeFds: reqTFds,
              reqNocheFds: reqNFds,
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
      });
    }
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
      reqManana?: number;
      reqTarde?: number;
      reqNoche?: number;
      modalidadDias?: string;
      reqMananaFds?: number;
      reqTardeFds?: number;
      reqNocheFds?: number;
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
      : ['M8', 'T8', 'N8', 'D12', 'G24', 'S', 'L', 'COMP', 'VAC', 'INC'];

    const reqM = data.reqManana !== undefined ? Math.max(0, Number(data.reqManana) || 0) : 4;
    const reqT = data.reqTarde !== undefined ? Math.max(0, Number(data.reqTarde) || 0) : 4;
    const reqN = data.reqNoche !== undefined ? Math.max(0, Number(data.reqNoche) || 0) : 2;

    const creado = await this.prisma.servicio.create({
      data: {
        codigo: cod,
        nombre: nom,
        tipoAsistencia: normalizarTipoAsistencia(data.tipoAsistencia),
        intranetId: data.intranetId,
        reqManana: reqM,
        reqTarde: reqT,
        reqNoche: reqN,
        modalidadDias: data.modalidadDias || 'TODOS_24_7',
        reqMananaFds: data.reqMananaFds !== undefined ? Math.max(0, Number(data.reqMananaFds) || 0) : reqM,
        reqTardeFds: data.reqTardeFds !== undefined ? Math.max(0, Number(data.reqTardeFds) || 0) : reqT,
        reqNocheFds: data.reqNocheFds !== undefined ? Math.max(0, Number(data.reqNocheFds) || 0) : reqN,
        turnosHabilitadosCodigos: turnosLimpios,
      } as any,
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
      tipoAsistencia: any;
      reqManana?: number;
      reqTarde?: number;
      reqNoche?: number;
      modalidadDias?: string;
      reqMananaFds?: number;
      reqTardeFds?: number;
      reqNocheFds?: number;
      turnosHabilitados?: string[];
      reglasPorCargo?: any[];
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

    const turnosLimpios = Array.isArray(data.turnosHabilitados)
      ? Array.from(new Set(data.turnosHabilitados.map((t) => String(t).trim().toUpperCase()).filter(Boolean)))
      : undefined;

    const tiposTurnoDb = await this.prisma.tipoTurno.findMany();
    const mapaTurnoPorCod = new Map(tiposTurnoDb.map((t) => [t.codigo.trim().toUpperCase(), t]));

    const tieneNocheSrv = turnosLimpios
      ? turnosLimpios.some((c) => {
          const t = mapaTurnoPorCod.get(c);
          return t && (t.esNocturnoPesado || t.horasNocturnas >= 6);
        })
      : true;

    const actualizado = await this.prisma.servicio.update({
      where: { id },
      data: {
        codigo: cod,
        nombre: nom,
        tipoAsistencia: normalizarTipoAsistencia(data.tipoAsistencia),
        ...(data.reqManana !== undefined ? { reqManana: Math.max(0, Number(data.reqManana) || 0) } : {}),
        ...(data.reqTarde !== undefined ? { reqTarde: Math.max(0, Number(data.reqTarde) || 0) } : {}),
        ...(data.reqNoche !== undefined ? { reqNoche: tieneNocheSrv ? Math.max(0, Number(data.reqNoche) || 0) : 0 } : {}),
        ...(data.modalidadDias !== undefined ? { modalidadDias: data.modalidadDias } : {}),
        ...(data.reqMananaFds !== undefined ? { reqMananaFds: Math.max(0, Number(data.reqMananaFds) || 0) } : {}),
        ...(data.reqTardeFds !== undefined ? { reqTardeFds: Math.max(0, Number(data.reqTardeFds) || 0) } : {}),
        ...(data.reqNocheFds !== undefined ? { reqNocheFds: tieneNocheSrv ? Math.max(0, Number(data.reqNocheFds) || 0) : 0 } : {}),
        ...(turnosLimpios !== undefined ? { turnosHabilitadosCodigos: turnosLimpios } : {}),
      } as any,
    });

    await this.sincronizarReglasPorCargoEnDb(
      id,
      turnosLimpios || (actualizado as any).turnosHabilitadosCodigos || ['M8', 'T8', 'N8'],
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
    return this.prisma.empleado.update({
      where: { id: body.empleadoId },
      data: { servicioBaseId: body.servicioBaseId },
    });
  }
}
