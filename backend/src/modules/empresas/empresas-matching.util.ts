import {
  combinarReglasEmpresa,
  ReglasEmpresaContrato,
} from '../../shared/liquidacion-horas';

export function normalizarCodigoMacroproceso(tipo: any): string {
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

export interface ResultadoEmpresaIntranet {
  empresa: any;
  recienCreada: boolean;
}

/**
 * Resuelve la EmpresaContratante a partir del payload recibido de Intranet:
 * 1) Coincidencia exacta por `codigo`
 * 2) Coincidencia en `aliasesCodigo`
 * 3) Coincidencia por `nit`
 * Si no existe y viene identificada con `empresaCodigo` o `empresaNit`, se auto-crea en estado `PENDIENTE_REGLAS`.
 */
export async function resolverEmpresaDesdeIntranet(
  db: any,
  item: {
    empresaCodigo?: string | null;
    empresaNombre?: string | null;
    empresaNit?: string | null;
    horasSemanalesContrato?: number | null;
    horasSemanales?: number | null;
  }
): Promise<ResultadoEmpresaIntranet> {
  const codRaw = String(item?.empresaCodigo || '').trim().toUpperCase();
  const nitRaw = item?.empresaNit ? String(item.empresaNit).trim() : null;
  const nomRaw = String(item?.empresaNombre || codRaw || 'Empresa Pendiente Intranet').trim();
  const hSemParsed = Number(item?.horasSemanalesContrato ?? item?.horasSemanales);
  const horasSem = Number.isFinite(hSemParsed) && hSemParsed > 0 ? hSemParsed : 42;

  if (codRaw || nitRaw) {
    const orConds: any[] = [];
    if (codRaw) {
      orConds.push({ codigo: codRaw });
      orConds.push({ aliasesCodigo: { has: codRaw } });
    }
    if (nitRaw) {
      orConds.push({ nit: nitRaw });
    }
    const existente = await db.empresaContratante?.findFirst({
      where: { OR: orConds },
    });
    if (existente) {
      return { empresa: existente, recienCreada: false };
    }

    const codigoNuevo =
      codRaw ||
      `EMP_${String(nitRaw || 'INTRANET')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .toUpperCase()}`;

    const creada = await db.empresaContratante.create({
      data: {
        codigo: codigoNuevo,
        nombre: nomRaw,
        nit: nitRaw,
        aliasesCodigo: codRaw ? [codRaw] : [],
        estadoConfiguracion: 'PENDIENTE_REGLAS',
        plantillaNormativa: horasSem === 44 ? 'DECRETO_1042' : 'PERSONALIZADA',
        horasSemanalesContrato: horasSem,
        diasBaseSemana: 6,
        horaInicioNocturnoMin: 19 * 60,
        horaFinNocturnoMin: 6 * 60,
        porcentajeRecargoNocturno: 0.35,
        modoRecargoDominical: 'LEY_2466',
        porcentajeRecargoDominicalFijo: null,
        aplicaTopeHorasExtrasSemanal: true,
        topeHorasExtrasSemanal: 12,
        usaBancoHoras: true,
        activa: true,
        observaciones: `Empresa auto-descubierta desde Intranet (${codigoNuevo}). Requiere validación normativa de Talento Humano antes de cerrar nómina.`,
      },
    });
    return { empresa: creada, recienCreada: true };
  }

  // Fallback si un cliente legacy omitió por completo datos de empresa en el JSON
  const fallback =
    (await db.empresaContratante?.findFirst({
      where: { codigo: 'TEMP_SALUD' },
    })) ||
    (await db.empresaContratante?.findFirst({
      orderBy: { creadoEn: 'asc' },
    }));

  if (fallback) {
    return { empresa: fallback, recienCreada: false };
  }

  const creadaDefault = await db.empresaContratante.create({
    data: {
      codigo: 'TEMP_SALUD',
      nombre: 'Operador Clínico Estándar (CST)',
      estadoConfiguracion: 'CONFIRMADA',
      plantillaNormativa: 'CST_LEY_2466',
      horasSemanalesContrato: 42,
      diasBaseSemana: 6,
      horaInicioNocturnoMin: 19 * 60,
      horaFinNocturnoMin: 6 * 60,
      porcentajeRecargoNocturno: 0.35,
      modoRecargoDominical: 'LEY_2466',
      aplicaTopeHorasExtrasSemanal: true,
      topeHorasExtrasSemanal: 12,
      usaBancoHoras: true,
      activa: true,
    },
  });
  return { empresa: creadaDefault, recienCreada: false };
}

/**
 * Resuelve el `servicioBaseId` inicial SOLO para colaboradores NUEVOS en Rafa_Turnos,
 * cruzando `(macroprocesoCodigo + cargoId)` contra `servicios_cargos_permitidos`.
 * No utiliza ningún campo `codigoAreaIntranet` para no restringir la rotación del personal.
 */
export async function resolverServicioPorMacroprocesoYCargo(
  db: any,
  params: {
    macroprocesoCodigo?: string | null;
    categoriaId: string;
    servicioCodigoFallback?: string | null;
  },
  serviciosPreload?: any[]
): Promise<string | null> {
  const servicios =
    Array.isArray(serviciosPreload) && serviciosPreload.length > 0
      ? serviciosPreload
      : await db.servicio.findMany({
          include: {
            macroproceso: { select: { codigo: true } },
            cargosPermitidos: { select: { categoriaId: true } },
          },
          orderBy: { codigo: 'asc' },
        });

  if (!Array.isArray(servicios) || servicios.length === 0) {
    return null;
  }

  const mpCod = params.macroprocesoCodigo
    ? normalizarCodigoMacroproceso(params.macroprocesoCodigo)
    : null;

  const conCargoEnMacro = mpCod
    ? servicios
        .filter(
          (s: any) =>
            s.macroproceso?.codigo === mpCod &&
            (s.cargosPermitidos || []).some((cp: any) => cp.categoriaId === params.categoriaId)
        )
        .sort(
          (a: any, b: any) =>
            (a.cargosPermitidos?.length || 99) - (b.cargosPermitidos?.length || 99) ||
            a.codigo.localeCompare(b.codigo)
        )
    : [];

  if (conCargoEnMacro.length > 0) {
    return conCargoEnMacro[0].id;
  }

  // Fallback 1: servicio compatible con el cargo en otro macroproceso (ordenado por especificidad)
  const conCargoGlobal = servicios
    .filter((s: any) =>
      (s.cargosPermitidos || []).some((cp: any) => cp.categoriaId === params.categoriaId)
    )
    .sort(
      (a: any, b: any) =>
        (a.cargosPermitidos?.length || 99) - (b.cargosPermitidos?.length || 99) ||
        a.codigo.localeCompare(b.codigo)
    );
  if (conCargoGlobal.length > 0) {
    return conCargoGlobal[0].id;
  }

  // Fallback 2: primer servicio dentro del mismo macroproceso
  if (mpCod) {
    const enMacro = servicios.find((s: any) => s.macroproceso?.codigo === mpCod);
    if (enMacro) return enMacro.id;
  }

  // Fallback 3: código explícito solo si viene de un entorno legacy de pruebas
  if (params.servicioCodigoFallback) {
    const cod = String(params.servicioCodigoFallback).trim().toUpperCase();
    const matchCod = servicios.find((s: any) => s.codigo.toUpperCase() === cod);
    if (matchCod) return matchCod.id;
  }

  return (
    servicios.find((s: any) => String(s.codigo).startsWith('URG'))?.id || servicios[0].id
  );
}

export function extraerReglasDeEmpleado(emp?: {
  empresaContratante?: Partial<ReglasEmpresaContrato> | null;
  horasSemanalesOverride?: number | null;
  horasSemanalesLey?: number | null;
} | null): ReglasEmpresaContrato {
  if (emp?.empresaContratante) {
    return combinarReglasEmpresa(emp.empresaContratante, emp.horasSemanalesOverride);
  }
  return combinarReglasEmpresa(
    {
      horasSemanalesContrato:
        emp?.horasSemanalesOverride ?? emp?.horasSemanalesLey ?? 42,
    },
    emp?.horasSemanalesOverride
  );
}
