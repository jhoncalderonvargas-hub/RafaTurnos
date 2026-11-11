/**
 * TEST E2E INTEGRAL DEL ECOSISTEMA RAFA TURNOS
 * ============================================
 * Valida los 5 pilares operativos:
 *  1. Planificación (asignación, guardado y publicación del cuadrante)
 *  2. Auditoría (trazabilidad estricta de cambios post-publicación)
 *  3. Permutas (flujo colaborativo: solicitud -> aceptación par -> aprobación supervisor -> swap real + auditoría)
 *  4. Suscripción iCal móvil (RFC 5545 .ics, feeds dinámicos con zona horaria America/Bogota)
 *  5. Cierre de Nómina (consolidación en banco_horas_saldos, bloqueo ante mutaciones y reapertura)
 *
 * Idempotente: limpia al iniciar (si quedaron restos de 2026-12) y al finalizar en bloque finally
 * usando @prisma/client para no dejar artefactos de prueba en PostgreSQL.
 */

const fs = require('fs');
const path = require('path');

function cargarEnvBackendLocal() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

cargarEnvBackendLocal();
const { PrismaClient } = require('@prisma/client');

const BACKEND_URL = 'http://localhost:3000';
const INTRANET_URL = 'http://localhost:4300';

let authTokenTH = null;
let authTokenCoord = null;
let empleados = [];
let servicios = [];

const resultados = {
  planificacion: false,
  auditoria: false,
  permuta: false,
  ical: false,
  cierreNomina: false,
};

function logStep(domain, title) {
  console.log(`\n======================================================`);
  console.log(`[${domain.toUpperCase()}] ${title}`);
  console.log(`======================================================`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FALLÓ: ${message}`);
    throw new Error(`Aserto fallido: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function emitirLoginSSO(documento, rol) {
  const tokenRes = await fetch(`${INTRANET_URL}/emitir-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documento, rol }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.ssoToken) {
    throw new Error(`No se pudo emitir token SSO para doc ${documento}`);
  }

  const loginRes = await fetch(`${BACKEND_URL}/api/v1/intranet/sso-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssoToken: tokenData.ssoToken }),
  });
  const loginData = await loginRes.json();
  if (!loginData.sessionToken) {
    throw new Error(`Fallo en login backend: ${loginData.message}`);
  }
  return {
    token: loginData.sessionToken,
    usuario: loginData.usuario,
  };
}

async function limpiarArtefactosE2E(prisma, opts) {
  const { servicioId, anio, mes, desdeFecha, extraEmpIds = [], tokensPreviosIds = [], empIcalId } = opts;

  const cuad = await prisma.cuadrante.findUnique({
    where: { anio_mes_servicioId: { anio, mes, servicioId } },
    select: { id: true },
  });

  const asigs = cuad
    ? await prisma.asignacionTurno.findMany({
        where: { cuadranteId: cuad.id },
        select: { id: true },
      })
    : [];
  const asigIds = asigs.map((a) => a.id);

  if (asigIds.length > 0) {
    await prisma.auditoriaCambio.deleteMany({
      where: { asignacionTurnoId: { in: asigIds } },
    });
  }

  if (desdeFecha) {
    await prisma.auditoriaCambio.deleteMany({
      where: {
        servicioId,
        timestamp: { gte: desdeFecha },
      },
    });
  } else if (cuad) {
    await prisma.auditoriaCambio.deleteMany({
      where: {
        servicioId,
        OR: [
          { justificacion: { contains: 'Diciembre 2026' } },
          { justificacion: { contains: 'E2E' } },
          { justificacion: { contains: 'Ajuste tras reapertura por Talento Humano' } },
        ],
      },
    });
  }

  await prisma.solicitudPermuta.deleteMany({
    where: { servicioId, anio, mes },
  });

  const empsSrv = await prisma.empleado.findMany({
    where: { servicioBaseId: servicioId },
    select: { id: true },
  });
  const idsSaldos = Array.from(new Set([...empsSrv.map((e) => e.id), ...extraEmpIds.filter(Boolean)]));
  if (idsSaldos.length > 0) {
    await prisma.bancoHorasSaldo.deleteMany({
      where: { anio, mes, empleadoId: { in: idsSaldos } },
    });
  }

  if (cuad) {
    await prisma.asignacionTurno.deleteMany({ where: { cuadranteId: cuad.id } });
    await prisma.cuadrante.delete({ where: { id: cuad.id } });
  }

  if (empIcalId) {
    await prisma.tokenCalendario.deleteMany({
      where: {
        empleadoId: empIcalId,
        id: { notIn: tokensPreviosIds },
      },
    });
  }
}

async function ejecutarPruebaE2E() {
  console.log('🚀 Iniciando Validación Integral de Extremo a Extremo (E2E)...');

  const prisma = new PrismaClient();
  const ANIO_TEST = 2026;
  const MES_TEST = 12; // Diciembre 2026 para no colisionar con datos de producción noviembre
  const SRV_TEST = 'srv-urg';

  let emp1 = null;
  let emp2 = null;
  let tokensPreviosIds = [];
  const inicioPrueba = new Date();

  try {
    // 0. Cargar empleados y servicios base
    const resEmps = await fetch(`${BACKEND_URL}/api/v1/servicios-admin/empleados`);
    empleados = await resEmps.json();
    const resSrv = await fetch(`${BACKEND_URL}/api/v1/servicios-admin`);
    servicios = await resSrv.json();

    assert(empleados.length > 0, `Se cargaron ${empleados.length} empleados desde PostgreSQL`);
    assert(servicios.length > 0, `Se cargaron ${servicios.length} servicios hospitalarios`);

    emp1 = empleados.find((e) => e.servicioBaseId === 'srv-urg') || empleados[0];
    emp2 = empleados.find((e) => e.servicioBaseId === 'srv-urg' && e.id !== emp1.id) || empleados[1];

    const tokensPrevios = await prisma.tokenCalendario.findMany({
      where: { empleadoId: emp1.id },
      select: { id: true },
    });
    tokensPreviosIds = tokensPrevios.map((t) => t.id);

    // Pre-limpieza de seguridad por si una corrida anterior abortó antes de tiempo
    await limpiarArtefactosE2E(prisma, {
      servicioId: SRV_TEST,
      anio: ANIO_TEST,
      mes: MES_TEST,
      extraEmpIds: [emp1.id, emp2.id],
    });

    console.log(`Colaborador 1 de prueba: ${emp1.nombre} (Doc: ${emp1.documento})`);
    console.log(`Colaborador 2 de prueba: ${emp2.nombre} (Doc: ${emp2.documento})`);

    // Autenticar perfiles SSO
    const sessionTH = await emitirLoginSSO(emp1.documento, 'ADMIN_TH');
    authTokenTH = sessionTH.token;
    const sessionCoord = await emitirLoginSSO(emp1.documento, 'COORDINADOR');
    authTokenCoord = sessionCoord.token;

    const authHeaderTH = { 'Content-Type': 'application/json', Authorization: `Bearer ${authTokenTH}` };
    const authHeaderCoord = { 'Content-Type': 'application/json', Authorization: `Bearer ${authTokenCoord}` };

    // -------------------------------------------------------------
    // 1. DOMINIO PLANIFICACIÓN
    // -------------------------------------------------------------
    logStep('Planificación', 'Borrador, Asignación de Celdas y Publicación Oficial');

    // Asegurar que el mes esté en BORRADOR inicialmente
    await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado`, {
      method: 'PUT',
      headers: authHeaderTH,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        estado: 'BORRADOR',
      }),
    });

    // Asignar turnos iniciales para emp1 (Día 10 = M8) y emp2 (Día 12 = T8)
    const resCelda1 = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 10,
        empleadoId: emp1.id,
        codigo: 'M8',
        previsto: 'L',
      }),
    });
    assert(resCelda1.status === 200, `Celda asignada a ${emp1.nombre} día 10 turno M8`);

    const resCelda2 = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 12,
        empleadoId: emp2.id,
        codigo: 'T8',
        previsto: 'L',
      }),
    });
    assert(resCelda2.status === 200, `Celda asignada a ${emp2.nombre} día 12 turno T8`);

    // Publicar el cuadrante oficial
    const resPub = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        estado: 'PUBLICADO',
      }),
    });
    const dataPub = await resPub.json();
    assert(dataPub.estado === 'PUBLICADO', 'Cuadrante publicado oficialmente');

    // Verificar estado global
    const resGlobal = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado-global?anio=${ANIO_TEST}`);
    const dataGlobal = await resGlobal.json();
    assert(dataGlobal.estados[`${SRV_TEST}::${ANIO_TEST}-${MES_TEST}`] === 'PUBLICADO', 'Estado en estado-global es PUBLICADO');

    resultados.planificacion = true;

    // -------------------------------------------------------------
    // 2. DOMINIO AUDITORÍA
    // -------------------------------------------------------------
    logStep('Auditoría', 'Modificación de Turno Post-Publicación con Justificación');

    const MOTIVO_TEST = 'Ajuste operativo de emergencia E2E';
    const resMod = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 10,
        empleadoId: emp1.id,
        codigo: 'T8', // Cambiar de M8 a T8
        justificacion: MOTIVO_TEST,
      }),
    });
    assert(resMod.status === 200, 'Turno modificado sobre cuadrante publicado');

    // Consultar auditorías con paginación
    const resAudit = await fetch(`${BACKEND_URL}/api/v1/auditorias?limite=10&page=1`, {
      headers: authHeaderCoord,
    });
    const logsAudit = await resAudit.json();
    assert(Array.isArray(logsAudit), 'Endpoint /auditorias responde un arreglo paginado');

    const logEncontrado = logsAudit.find(
      (l) => l.empleadoId === emp1.id && l.dia === 10 && l.turnoAnterior === 'M8' && l.turnoNuevo === 'T8'
    );
    assert(Boolean(logEncontrado), `Registro de auditoría encontrado: M8 -> T8 con justificación "${logEncontrado?.motivo}"`);
    assert(logEncontrado.servicioNombre.length > 0, `Servicio registrado en auditoría: ${logEncontrado.servicioNombre}`);

    resultados.auditoria = true;

    // -------------------------------------------------------------
    // 3. DOMINIO PERMUTAS
    // -------------------------------------------------------------
    logStep('Permutas', 'Flujo completo Solicitud -> Aceptación Par -> Aprobación Supervisor -> Swap Real');

    // Asignar turnos limpios para permuta en día 20 y día 22
    await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 20,
        empleadoId: emp1.id,
        codigo: 'M8',
      }),
    });
    await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 22,
        empleadoId: emp2.id,
        codigo: 'N8',
      }),
    });

    // Paso 3.1: Emp1 solicita permuta con Emp2
    const resCrearPermuta = await fetch(`${BACKEND_URL}/api/v1/permutas`, {
      method: 'POST',
      headers: authHeaderCoord,
      body: JSON.stringify({
        solicitanteId: emp1.id,
        receptorId: emp2.id,
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        diaOrigen: 20,
        turnoOrigen: 'M8',
        diaDestino: 22,
        turnoDestino: 'N8',
        validacionReglas: 'Validación E2E descanso adecuado',
      }),
    });
    const dataPermuta = await resCrearPermuta.json();
    assert(resCrearPermuta.status === 201, `Permuta creada con id ${dataPermuta.id} en estado ${dataPermuta.estado}`);
    assert(dataPermuta.estado === 'PENDIENTE_PAR', 'Estado inicial es PENDIENTE_PAR');

    // Paso 3.2: Emp2 acepta la propuesta
    const resAceptarPar = await fetch(`${BACKEND_URL}/api/v1/permutas/${dataPermuta.id}/aceptar-par`, {
      method: 'PATCH',
      headers: authHeaderCoord,
    });
    const dataAceptada = await resAceptarPar.json();
    assert(dataAceptada.estado === 'PENDIENTE_SUPERVISOR', 'Estado tras aceptación par es PENDIENTE_SUPERVISOR');

    // Paso 3.3: Supervisora aprueba la permuta (intercambia celdas y audita)
    const resAprobar = await fetch(`${BACKEND_URL}/api/v1/permutas/${dataPermuta.id}/aprobar`, {
      method: 'PATCH',
      headers: authHeaderCoord,
    });
    const dataAprobada = await resAprobar.json();
    if (!resAprobar.ok) {
      console.error('Error en aprobarPermuta:', resAprobar.status, dataAprobada);
    }
    assert(dataAprobada.estado === 'APROBADA', 'Permuta aprobada exitosamente por supervisora');

    // Paso 3.4: Verificar swap en estado-global
    const resGlobalPost = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado-global?anio=${ANIO_TEST}`);
    const dataGlobalPost = await resGlobalPost.json();
    const asignacionesMes = dataGlobalPost.asignacionesPorPeriodo[`${ANIO_TEST}-${MES_TEST}`] || {};

    const turnoEmp1Dia20 = asignacionesMes[emp1.id]?.[20]?.codigo;
    const turnoEmp2Dia20 = asignacionesMes[emp2.id]?.[20]?.codigo;
    const turnoEmp1Dia22 = asignacionesMes[emp1.id]?.[22]?.codigo;
    const turnoEmp2Dia22 = asignacionesMes[emp2.id]?.[22]?.codigo;

    console.log(`Verificación tras swap:`);
    console.log(`  Emp1 día 20: ${turnoEmp1Dia20} (recibió turnoDestino N8)`);
    console.log(`  Emp2 día 22: ${turnoEmp2Dia22} (recibió turnoOrigen M8)`);

    assert(turnoEmp1Dia20 === 'N8', `Emp1 ahora ejecuta N8 en día 20`);
    assert(turnoEmp2Dia22 === 'M8', `Emp2 ahora ejecuta M8 en día 22`);

    resultados.permuta = true;

    // -------------------------------------------------------------
    // 4. DOMINIO SUSCRIPCIÓN ICAL EN MÓVIL
    // -------------------------------------------------------------
    logStep('Suscripción iCal', 'Enlace personal y Feed RFC 5545 para Google Calendar / iPhone');

    const resEnlace = await fetch(`${BACKEND_URL}/api/v1/calendario/mi-enlace?empleadoId=${emp1.id}`, {
      headers: authHeaderCoord,
    });
    const dataEnlace = await resEnlace.json();
    assert(Boolean(dataEnlace.token), `Token iCal obtenido: ${dataEnlace.token}`);
    assert(dataEnlace.webcalUrl.startsWith('webcal://'), `URL webcal para iOS: ${dataEnlace.webcalUrl}`);
    assert(dataEnlace.httpUrl.startsWith('http://'), `URL http para Google Calendar: ${dataEnlace.httpUrl}`);

    // Descargar el archivo .ics
    const resIcs = await fetch(`${BACKEND_URL}/api/v1/calendario/feed/${dataEnlace.token}.ics`);
    assert(resIcs.status === 200, 'Feed .ics descargado exitosamente (HTTP 200)');
    assert(
      resIcs.headers.get('content-type')?.includes('text/calendar'),
      `Content-Type correcto: ${resIcs.headers.get('content-type')}`
    );

    const icsBody = await resIcs.text();
    assert(icsBody.includes('BEGIN:VCALENDAR'), 'El feed contiene cabecera BEGIN:VCALENDAR');
    assert(icsBody.includes('VERSION:2.0'), 'Cumple con especificación iCalendar VERSION:2.0');
    assert(icsBody.includes('X-WR-TIMEZONE:America/Bogota'), 'Zona horaria configurada en America/Bogota');
    assert(icsBody.includes('END:VCALENDAR'), 'El feed finaliza con END:VCALENDAR');
    assert(icsBody.includes('BEGIN:VEVENT'), 'Contiene eventos VEVENT generados desde PostgreSQL');
    assert(icsBody.includes('SUMMARY:[N8]'), 'El turno N8 obtenido en la permuta aparece en el feed del colaborador');

    resultados.ical = true;

    // -------------------------------------------------------------
    // 5. DOMINIO CIERRE DE NÓMINA
    // -------------------------------------------------------------
    logStep('Cierre de Nómina', 'Consolidación de Banco de Horas, Bloqueo de Modificaciones y Reapertura');

    // Paso 5.1: Simular cálculo
    const resSim = await fetch(`${BACKEND_URL}/api/v1/banco-horas-nomina/simular-cierre`, {
      method: 'POST',
      headers: authHeaderTH,
      body: JSON.stringify({
        empleadoId: emp1.id,
        documento: emp1.documento,
        nombre: emp1.nombre,
        anio: ANIO_TEST,
        mes: MES_TEST,
        saldoInicialMesAnterior: 8,
        horasContratoMes: 160,
        horasRealesTrabajadas: 168,
        turnosCompensatoriosTomados: 1,
        hod: 140,
        hon: 28,
        hdfd: 0,
        hdfn: 0,
        domingosHabituales: 0,
      }),
    });
    const simData = await resSim.json();
    assert(simData.bancoDeHoras?.nuevoSaldoAcumuladoContinuo === 8, `Simulación de cierre calculada: Saldo continuo ${simData.bancoDeHoras?.nuevoSaldoAcumuladoContinuo}h`);

    // Paso 5.2: Cerrar el cuadrante para nómina con consolidación de saldos
    const resCierre = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado`, {
      method: 'PUT',
      headers: authHeaderTH,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        estado: 'CERRADO_NOMINA',
        saldosConsolidados: [
          {
            empleadoId: emp1.id,
            saldoInicial: 0,
            horasTrabajadas: 168,
            horasContratadas: 160,
            horasAmortizadasComp: 8,
            diferenciaMes: 0,
            saldoFinalAcumulado: 0,
          },
        ],
      }),
    });
    const dataCierre = await resCierre.json();
    assert(dataCierre.estado === 'CERRADO_NOMINA', 'Cuadrante marcado como CERRADO_NOMINA');

    // Paso 5.3: Probar blindaje contra mutaciones (Loose end verificado)
    const resIntentoMutacion = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 10,
        empleadoId: emp1.id,
        codigo: 'M8',
      }),
    });
    assert(
      resIntentoMutacion.status === 409,
      `Blindaje verificado: Intento de modificar celda en mes CERRADO_NOMINA rechazado con HTTP 409 Conflict`
    );

    // Paso 5.4: Reabrir el periodo por Talento Humano
    const resReabrir = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/estado`, {
      method: 'PUT',
      headers: authHeaderTH,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        estado: 'PUBLICADO',
      }),
    });
    const dataReabierto = await resReabrir.json();
    assert(dataReabierto.estado === 'PUBLICADO', 'Talento Humano reabrió exitosamente el cuadrante');

    // Paso 5.5: Permitir nuevamente edición tras reapertura
    const resEdicionReabierta = await fetch(`${BACKEND_URL}/api/v1/cuadrantes/celda`, {
      method: 'PUT',
      headers: authHeaderCoord,
      body: JSON.stringify({
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        dia: 10,
        empleadoId: emp1.id,
        codigo: 'T8',
        justificacion: 'Ajuste tras reapertura por Talento Humano',
      }),
    });
    assert(resEdicionReabierta.status === 200, 'Edición permitida normalmente tras reapertura');

    resultados.cierreNomina = true;

    // -------------------------------------------------------------
    // RESUMEN FINAL
    // -------------------------------------------------------------
    console.log(`\n======================================================`);
    console.log(`🎉 RESULTADOS DE LA VALIDACIÓN INTEGRAL E2E`);
    console.log(`======================================================`);
    console.log(`1. Planificación:       ${resultados.planificacion ? '✅ APROBADO' : '❌ REPROBADO'}`);
    console.log(`2. Auditoría:           ${resultados.auditoria ? '✅ APROBADO' : '❌ REPROBADO'}`);
    console.log(`3. Permutas:            ${resultados.permuta ? '✅ APROBADO' : '❌ REPROBADO'}`);
    console.log(`4. Suscripción iCal:    ${resultados.ical ? '✅ APROBADO' : '❌ REPROBADO'}`);
    console.log(`5. Cierre de Nómina:    ${resultados.cierreNomina ? '✅ APROBADO' : '❌ REPROBADO'}`);
    console.log(`======================================================`);
    console.log(`El ecosistema Rafa Turnos no presenta cabos sueltos.`);
  } finally {
    try {
      await limpiarArtefactosE2E(prisma, {
        servicioId: SRV_TEST,
        anio: ANIO_TEST,
        mes: MES_TEST,
        desdeFecha: inicioPrueba,
        extraEmpIds: [emp1?.id, emp2?.id],
        tokensPreviosIds,
        empIcalId: emp1?.id,
      });
      console.log('🧹 Limpieza E2E completada: base de datos restaurada.');
    } catch (cleanErr) {
      console.error('⚠️ Error durante limpieza E2E:', cleanErr);
    } finally {
      await prisma.$disconnect();
    }
  }
}

ejecutarPruebaE2E().catch((err) => {
  console.error('\n❌ Error durante la ejecución E2E:', err);
  process.exit(1);
});
