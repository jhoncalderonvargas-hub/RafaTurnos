import { PrismaClient } from '@prisma/client';
import {
  CATEGORIAS_SEED,
  DESCANSOS_ESTANDAR,
  EMPRESAS_SEED,
  MACROPROCESOS_SEED,
  PARES_HERMANOS_SEED,
  SERVICIOS_RECLASIFICADOS_SEED,
  TURNOS_SEED,
  asignarEmpresaCodigoDeterministico,
  calcularResumenDerivadoServicio,
} from './catalogo-base';

const prisma = new PrismaClient();

const MAPA_RECLASIFICACION: Record<string, Record<string, string>> = {
  'srv-urg': {
    'Médico General': 'srv-urg-med',
    'Enfermero(a) Jefe': 'srv-urg-enf',
    'Auxiliar de Enfermería': 'srv-urg-aux',
  },
  'srv-mat': {
    'Médico Especialista (Pediatra/Ginecólogo/Internista)': 'srv-mat-esp',
    'Enfermero(a) Jefe': 'srv-mat-enf',
    'Auxiliar de Enfermería': 'srv-mat-aux',
  },
  'srv-ped': {
    'Médico Especialista (Pediatra/Ginecólogo/Internista)': 'srv-ped-esp',
    'Enfermero(a) Jefe': 'srv-ped-enf',
    'Auxiliar de Enfermería': 'srv-ped-aux',
  },
  'srv-cir': {
    'Médico Cirujano (Especialista)': 'srv-cir-cir',
    'Médico Anestesiólogo': 'srv-cir-ane',
    'Instrumentador(a) Quirúrgico(a)': 'srv-cir-inst',
    'Enfermero(a) Jefe': 'srv-cir-enf',
    'Auxiliar de Enfermería': 'srv-cir-aux',
  },
  'srv-hosp': {
    'Médico General': 'srv-hosp-med',
    'Enfermero(a) Jefe': 'srv-hosp-enf',
    'Auxiliar de Enfermería': 'srv-hosp-aux',
  },
  'srv-med-int': {
    'Médico Especialista (Pediatra/Ginecólogo/Internista)': 'srv-med-int-esp',
    'Enfermero(a) Jefe': 'srv-med-int-enf',
    'Auxiliar de Enfermería': 'srv-med-int-aux',
  },
  'srv-lab-img': {
    'Bacteriólogo(a)': 'srv-lab-bac',
    'Auxiliar de Laboratorio Clínico': 'srv-lab-aux',
    'Tecnólogo(a) en Imágenes Diagnósticas': 'srv-img-tec',
    'Médico Especialista (Pediatra/Ginecólogo/Internista)': 'srv-med-int-esp',
  },
  'srv-farm': {
    'Químico Farmacéutico / Regente de Farmacia': 'srv-farm-qf',
    'Auxiliar de Farmacia': 'srv-farm-aux',
  },
};

const SERVICIOS_OBSOLETOS = Object.keys(MAPA_RECLASIFICACION);

const FALLBACK_AUDITORIA_SERVICIO: Record<string, string> = {
  'srv-urg': 'srv-urg-aux',
  'srv-mat': 'srv-mat-aux',
  'srv-ped': 'srv-ped-aux',
  'srv-cir': 'srv-cir-aux',
  'srv-hosp': 'srv-hosp-aux',
  'srv-med-int': 'srv-med-int-aux',
  'srv-lab-img': 'srv-lab-aux',
  'srv-farm': 'srv-farm-aux',
};

const UPGRADES_CARGO_MULTICARGO: Record<string, string> = {
  '1010001145': 'Tecnólogo Biomédico',
  '1010001146': 'Auxiliar de Mantenimiento',
  '1010001116': 'Técnico Administrativo en Salud',
  '1010001117': 'Técnico Administrativo en Salud',
  '1010001121': 'Técnico Administrativo en Salud',
};

function resolverServicioDestino(oldSrvId: string, cargoNombre: string, esRotacion = false): string {
  if (oldSrvId === 'srv-lab-img' && esRotacion) {
    return 'srv-lab-aux';
  }
  const mapa = MAPA_RECLASIFICACION[oldSrvId];
  if (!mapa) return oldSrvId;
  return mapa[cargoNombre] || FALLBACK_AUDITORIA_SERVICIO[oldSrvId] || oldSrvId;
}

async function main() {
  console.log('🔄 Migrando base de datos piloto viva hacia Empresas Contratantes + Servicios Homogéneos/Equivalentes...');

  // 1. Upsert Empresas Contratantes
  const mapEmpresas = new Map<string, (typeof EMPRESAS_SEED)[number]>();
  for (const empDef of EMPRESAS_SEED) {
    await prisma.empresaContratante.upsert({
      where: { codigo: empDef.codigo },
      update: {
        nombre: empDef.nombre,
        nit: empDef.nit,
        aliasesCodigo: empDef.aliasesCodigo,
        estadoConfiguracion: empDef.estadoConfiguracion,
        plantillaNormativa: empDef.plantillaNormativa,
        horasSemanalesContrato: empDef.horasSemanalesContrato,
        diasBaseSemana: empDef.diasBaseSemana,
        horaInicioNocturnoMin: empDef.horaInicioNocturnoMin,
        horaFinNocturnoMin: empDef.horaFinNocturnoMin,
        porcentajeRecargoNocturno: empDef.porcentajeRecargoNocturno,
        modoRecargoDominical: empDef.modoRecargoDominical,
        porcentajeRecargoDominicalFijo: empDef.porcentajeRecargoDominicalFijo,
        aplicaTopeHorasExtrasSemanal: empDef.aplicaTopeHorasExtrasSemanal,
        topeHorasExtrasSemanal: empDef.topeHorasExtrasSemanal,
        usaBancoHoras: empDef.usaBancoHoras,
        activa: empDef.activa,
        observaciones: empDef.observaciones,
      },
      create: empDef,
    });
    mapEmpresas.set(empDef.codigo, empDef);
  }
  const empresasDb = await prisma.empresaContratante.findMany();
  const mapEmpresaIdPorCodigo = new Map(empresasDb.map((e) => [e.codigo, e.id]));

  // 2. Upsert Macroprocesos y Categorías
  for (const m of MACROPROCESOS_SEED) {
    await prisma.macroproceso.upsert({
      where: { codigo: m.codigo },
      update: m,
      create: m,
    });
  }

  for (const nombre of CATEGORIAS_SEED) {
    await prisma.categoriaProfesional.upsert({
      where: { nombre },
      update: {},
      create: { nombre },
    });
  }
  const categoriasDb = await prisma.categoriaProfesional.findMany();
  const mapCatId = new Map(categoriasDb.map((c) => [c.nombre, c.id]));

  // 3. Upsert TiposTurno con banderas configurables y obligatorios protegidos
  for (const t of TURNOS_SEED) {
    await prisma.tipoTurno.upsert({
      where: { codigo: t.codigo },
      update: {
        esSistemaObligatorio: t.esSistemaObligatorio,
        prorrateaMetaContrato: t.prorrateaMetaContrato,
        esAusencia: t.esAusencia,
        bloqueaPermutas: t.bloqueaPermutas,
        modoAmortizacionBanco: t.modoAmortizacionBanco,
      },
      create: t,
    });
  }
  const tiposDb = await prisma.tipoTurno.findMany();
  const mapTipoTurnoId = new Map(tiposDb.map((t) => [t.codigo.toUpperCase(), t.id]));

  // 4. Upsert Servicios Reclasificados (conservando existentes como COND, OF-VAR, MANT, FACT-URG, FACT-CEN, MED-GRAL)
  for (const srvDef of SERVICIOS_RECLASIFICADOS_SEED) {
    const resumen = calcularResumenDerivadoServicio(srvDef.metasTurnos);
    const turnosCodigos = Array.from(
      new Set([
        ...srvDef.metasTurnos.filter((m) => m.habilitado).map((m) => m.codigoTurno),
        ...DESCANSOS_ESTANDAR,
      ])
    );

    const existentePorCodigo = await prisma.servicio.findUnique({ where: { codigo: srvDef.codigo } });
    if (existentePorCodigo) {
      await prisma.servicio.update({
        where: { id: existentePorCodigo.id },
        data: {
          nombre: srvDef.nombre,
          macroprocesoId: srvDef.macroprocesoId,
          modalidadDias: srvDef.modalidadDias,
          permitePermutaEntreCargos: srvDef.permitePermutaEntreCargos,
          reqDia: resumen.reqDia,
          reqNoche: resumen.reqNoche,
          reqDiaDomFest: resumen.reqDiaDomFest,
          reqNocheDomFest: resumen.reqNocheDomFest,
          turnosHabilitadosCodigos: turnosCodigos,
        },
      });
    } else {
      await prisma.servicio.create({
        data: {
          id: srvDef.id,
          codigo: srvDef.codigo,
          nombre: srvDef.nombre,
          macroprocesoId: srvDef.macroprocesoId,
          modalidadDias: srvDef.modalidadDias,
          permitePermutaEntreCargos: srvDef.permitePermutaEntreCargos,
          reqDia: resumen.reqDia,
          reqNoche: resumen.reqNoche,
          reqDiaDomFest: resumen.reqDiaDomFest,
          reqNocheDomFest: resumen.reqNocheDomFest,
          turnosHabilitadosCodigos: turnosCodigos,
        },
      });
    }
  }

  // 5. Enriquecer cargos multi-cargo de MANT / FACT-URG / FACT-CEN y reclasificar empleados
  for (const [doc, nuevoCargo] of Object.entries(UPGRADES_CARGO_MULTICARGO)) {
    const catId = mapCatId.get(nuevoCargo);
    if (!catId) continue;
    await prisma.empleado.updateMany({
      where: { documento: doc },
      data: { categoriaId: catId },
    });
  }

  const empleadosAll = await prisma.empleado.findMany({
    include: { categoria: true },
    orderBy: { documento: 'asc' },
  });

  const nuevoServicioPorEmpId = new Map<string, string>();
  const cargoPorEmpId = new Map<string, string>();

  for (let i = 0; i < empleadosAll.length; i++) {
    const emp = empleadosAll[i];
    const cargoNombre = emp.categoria?.nombre || 'Auxiliar de Enfermería';
    cargoPorEmpId.set(emp.id, cargoNombre);

    const destinoSrvId = resolverServicioDestino(emp.servicioBaseId, cargoNombre, false);
    nuevoServicioPorEmpId.set(emp.id, destinoSrvId);

    const empCod = asignarEmpresaCodigoDeterministico(emp.documento, i);
    const empDef = mapEmpresas.get(empCod) || EMPRESAS_SEED[1];
    const empEmpresaId = mapEmpresaIdPorCodigo.get(empCod) || emp.empresaContratanteId;

    await prisma.empleado.update({
      where: { id: emp.id },
      data: {
        servicioBaseId: destinoSrvId,
        empresaContratanteId: empEmpresaId,
        horasSemanalesLey: Math.round(empDef.horasSemanalesContrato),
      },
    });
  }
  console.log(`✅ ${empleadosAll.length} empleados distribuidos entre 3 empresas y servicios homogéneos/equivalentes.`);

  // 6. Migrar Cuadrantes y Asignaciones desde servicios mixtos hacia los nuevos servicios homogéneos
  const cuadrantesObsoletos = await prisma.cuadrante.findMany({
    where: { servicioId: { in: SERVICIOS_OBSOLETOS } },
    include: {
      asignaciones: true,
    },
  });

  for (const q of cuadrantesObsoletos) {
    for (const asig of q.asignaciones) {
      const cargoNombre = cargoPorEmpId.get(asig.empleadoId) || 'Auxiliar de Enfermería';
      const targetSrvId = resolverServicioDestino(q.servicioId, cargoNombre, asig.esRotacion);

      let targetCuadrante = await prisma.cuadrante.findUnique({
        where: {
          anio_mes_servicioId: {
            anio: q.anio,
            mes: q.mes,
            servicioId: targetSrvId,
          },
        },
      });
      if (!targetCuadrante) {
        targetCuadrante = await prisma.cuadrante.create({
          data: {
            anio: q.anio,
            mes: q.mes,
            servicioId: targetSrvId,
            estado: q.estado,
          },
        });
      }

      const nuevoEjecutorId = SERVICIOS_OBSOLETOS.includes(asig.servicioEjecutorId)
        ? resolverServicioDestino(asig.servicioEjecutorId, cargoNombre, asig.esRotacion)
        : asig.servicioEjecutorId;

      await prisma.asignacionTurno.update({
        where: { id: asig.id },
        data: {
          cuadranteId: targetCuadrante.id,
          servicioEjecutorId: nuevoEjecutorId,
        },
      });
    }
  }

  // Migrar cualquier asignación residual cuyo servicioEjecutorId apuntara a un obsoleto
  const residuales = await prisma.asignacionTurno.findMany({
    where: { servicioEjecutorId: { in: SERVICIOS_OBSOLETOS } },
  });
  for (const asig of residuales) {
    const cargoNombre = cargoPorEmpId.get(asig.empleadoId) || 'Auxiliar de Enfermería';
    const targetSrvId = resolverServicioDestino(asig.servicioEjecutorId, cargoNombre, asig.esRotacion);
    await prisma.asignacionTurno.update({
      where: { id: asig.id },
      data: { servicioEjecutorId: targetSrvId },
    });
  }

  // Migrar Auditorías asociadas a servicios mixtos
  const auditoriasObsoletas = await prisma.auditoriaCambio.findMany({
    where: { servicioId: { in: SERVICIOS_OBSOLETOS } },
    include: { asignacionTurno: true },
  });
  for (const aud of auditoriasObsoletas) {
    const srvObjetivo =
      aud.asignacionTurno?.servicioEjecutorId ||
      (aud.servicioId ? FALLBACK_AUDITORIA_SERVICIO[aud.servicioId] : undefined) ||
      'srv-urg-aux';
    await prisma.auditoriaCambio.update({
      where: { id: aud.id },
      data: { servicioId: srvObjetivo },
    });
  }

  // Migrar Solicitudes de Permuta que apunten a servicios obsoletos (por si hubiera alguna)
  const permutasObsoletas = await prisma.solicitudPermuta.findMany({
    where: { servicioId: { in: SERVICIOS_OBSOLETOS } },
    include: { solicitante: { include: { categoria: true } } },
  });
  for (const perm of permutasObsoletas) {
    const targetSrv = resolverServicioDestino(
      perm.servicioId,
      perm.solicitante?.categoria?.nombre || 'Auxiliar de Enfermería',
      false
    );
    await prisma.solicitudPermuta.update({
      where: { id: perm.id },
      data: { servicioId: targetSrv },
    });
  }

  // Eliminar cuadrantes vacíos, reglas y servicios obsoletos ya vaciados
  await prisma.cuadrante.deleteMany({ where: { servicioId: { in: SERVICIOS_OBSOLETOS } } });
  await prisma.servicioHermano.deleteMany();
  await prisma.servicioCargoPermitido.deleteMany();
  await prisma.servicioTurnoMeta.deleteMany();
  await prisma.servicioTurnoHabilitado.deleteMany();
  await prisma.requerimientoCobertura.deleteMany();
  await prisma.servicio.deleteMany({ where: { id: { in: SERVICIOS_OBSOLETOS } } });

  // 7. Repoblar ServicioCargoPermitido, ServicioTurnoMeta, compatibilidad legacy y ServicioHermano
  for (const srvDef of SERVICIOS_RECLASIFICADOS_SEED) {
    const resumen = calcularResumenDerivadoServicio(srvDef.metasTurnos);
    const turnosCodigos = Array.from(
      new Set([
        ...srvDef.metasTurnos.filter((m) => m.habilitado).map((m) => m.codigoTurno),
        ...DESCANSOS_ESTANDAR,
      ])
    );

    for (const cargoNombre of srvDef.cargosPermitidos) {
      const catId = mapCatId.get(cargoNombre);
      if (!catId) continue;
      await prisma.servicioCargoPermitido.create({
        data: { servicioId: srvDef.id, categoriaId: catId },
      });
      await prisma.requerimientoCobertura.create({
        data: {
          servicioId: srvDef.id,
          categoriaId: catId,
          reqDia: resumen.reqDia,
          reqNoche: resumen.reqNoche,
          reqDiaDomFest: resumen.reqDiaDomFest,
          reqNocheDomFest: resumen.reqNocheDomFest,
        },
      });
      const filasLegacy = turnosCodigos
        .filter((cod) => mapTipoTurnoId.has(cod.toUpperCase()))
        .map((cod) => ({
          servicioId: srvDef.id,
          categoriaId: catId,
          tipoTurnoId: mapTipoTurnoId.get(cod.toUpperCase())!,
          habilitado: true,
        }));
      if (filasLegacy.length > 0) {
        await prisma.servicioTurnoHabilitado.createMany({ data: filasLegacy, skipDuplicates: true });
      }
    }

    for (const meta of srvDef.metasTurnos) {
      const tipoTurnoId = mapTipoTurnoId.get(meta.codigoTurno.toUpperCase());
      if (!tipoTurnoId) continue;
      await prisma.servicioTurnoMeta.create({
        data: {
          servicioId: srvDef.id,
          tipoTurnoId,
          habilitado: meta.habilitado,
          minimoBase: Math.min(meta.minimoBase, meta.esperadoBase),
          esperadoBase: Math.max(meta.minimoBase, meta.esperadoBase),
          minimoDomFest: Math.min(meta.minimoDomFest, meta.esperadoDomFest),
          esperadoDomFest: Math.max(meta.minimoDomFest, meta.esperadoDomFest),
        },
      });
    }
  }

  for (const [a, b] of PARES_HERMANOS_SEED) {
    await prisma.servicioHermano.createMany({
      data: [
        { servicioId: a, servicioHermanoId: b },
        { servicioId: b, servicioHermanoId: a },
      ],
      skipDuplicates: true,
    });
  }

  console.log('🎉 Migración de datos piloto completada sin pérdida de asignaciones ni historial.');
}

main()
  .catch((e) => {
    console.error('❌ Error migrando datos piloto:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
