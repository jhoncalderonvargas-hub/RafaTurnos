/**
 * SIMULADOR EXTERNO DE INTRANET HOSPITALARIA (Puerto 4300)
 * ========================================================
 * Este archivo está 100% separado del código fuente de Rafa Turnos (frontend/ y backend/).
 * Simula el servidor de la Intranet Hospitalaria que firma el Token JWT (HMAC-SHA256)
 * con la clave compartida INTRANET_JWT_SECRET y redirige a:
 *   http://localhost:4200/?sso_token=<JWT_FIRMADO>
 *
 * Para pasar a producción con la Intranet real:
 *   1. Basta con eliminar la carpeta `simulador-intranet/`.
 *   2. Configurar INTRANET_JWT_SECRET e INTRANET_RETURN_URL en `backend/.env`.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 4300;
const RAFA_TURNOS_FRONTEND_URL = 'http://localhost:4200';
const RAFA_TURNOS_BACKEND_URL = 'http://localhost:3000';

function leerSecretoCompartido() {
  try {
    const envPath = path.join(__dirname, '..', 'backend', '.env');
    const contenido = fs.readFileSync(envPath, 'utf8');
    const match = contenido.match(/INTRANET_JWT_SECRET\s*=\s*"([^"]+)"/);
    if (match && match[1]) return match[1];
  } catch {}
  return 'clave_secreta_compartida_con_intranet_hospitalaria';
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function firmarJwtIntranet(payload, secret, expiresInSeconds = 300) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const part1 = base64UrlEncode(JSON.stringify(header));
  const part2 = base64UrlEncode(JSON.stringify(body));
  const signingInput = `${part1}.${part2}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}

const HTML_PORTAL = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Intranet Hospitalaria — Lanzador SSO (Simulador Externo)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
    body { background: #0f172a; color: #f8fafc; min-height: 100vh; padding: 28px; }
    .container { max-width: 1020px; margin: 0 auto; }
    .header {
      display: flex; align-items: center; justify-content: space-between;
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border: 1px solid #334155; border-radius: 14px; padding: 20px 24px; margin-bottom: 22px;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .brand-icon {
      width: 48px; height: 48px; border-radius: 12px; background: #0284c7;
      display: flex; align-items: center; justify-content: center; font-size: 24px;
    }
    .brand h1 { font-size: 20px; font-weight: 700; color: #f8fafc; }
    .brand p { font-size: 13px; color: #94a3b8; margin-top: 2px; }
    .badge-ext {
      background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);
      padding: 6px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
    }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 22px; }
    .role-card {
      background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px;
      display: flex; flex-direction: column; justify-content: space-between; gap: 12px;
      transition: border-color 0.15s, transform 0.15s;
    }
    .role-card:hover { border-color: #38bdf8; transform: translateY(-2px); }
    .role-card h3 { font-size: 15px; display: flex; align-items: center; gap: 8px; }
    .role-card p { font-size: 12.5px; color: #94a3b8; line-height: 1.45; }
    .role-card ul { font-size: 12px; color: #cbd5e1; padding-left: 16px; line-height: 1.5; }
    .btn-quick {
      background: #0284c7; color: #fff; border: none; border-radius: 8px; padding: 10px 14px;
      font-weight: 600; font-size: 13px; cursor: pointer; width: 100%;
    }
    .btn-quick:hover { background: #0369a1; }
    .btn-quick.coord { background: #7c3aed; }
    .btn-quick.coord:hover { background: #6d28d9; }
    .btn-quick.admin { background: #059669; }
    .btn-quick.admin:hover { background: #047857; }
    .panel {
      background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 22px;
    }
    .panel h2 { font-size: 16px; margin-bottom: 14px; color: #e2e8f0; }
    .form-grid { display: grid; grid-template-columns: 1fr 1.5fr 1fr auto; gap: 12px; align-items: end; }
    label { display: block; font-size: 12px; color: #94a3b8; margin-bottom: 6px; font-weight: 600; }
    select, input {
      width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #475569;
      background: #0f172a; color: #f8fafc; font-size: 13px;
    }
    .token-preview {
      margin-top: 16px; padding: 12px 14px; background: #0f172a; border: 1px dashed #334155;
      border-radius: 8px; font-family: monospace; font-size: 11.5px; color: #38bdf8; word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-icon">🏥</div>
        <div>
          <h1>Intranet Hospitalaria — Portal del Colaborador</h1>
          <p>Simulador SSO Externo (Puerto 4300) • Firma JWT HMAC-SHA256 hacia Rafa Turnos (Puerto 4200)</p>
        </div>
      </div>
      <span class="badge-ext">🔒 SSO HS256 Activo</span>
    </div>

    <div class="grid-3">
      <div class="role-card">
        <div>
          <h3>👩‍⚕️ 1. Perfil Colaborador</h3>
          <p style="margin: 6px 0;">Médicos, enfermeros, auxiliares y técnicos.</p>
          <ul>
            <li>Aterriza directo en <b>Mi Calendario</b></li>
            <li>No puede cambiar de empleado en el selector</li>
            <li>Oculta Cuadro de Turnos, Reportes y Configuración</li>
            <li>Solo solicita/acepta sus propias permutas</li>
          </ul>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn-quick" onclick="lanzarDirecto('1010001018', 'COLABORADOR')">
            🏥 Urgencias: Bernardo Castro
          </button>
          <button class="btn-quick" style="background: #334155;" onclick="lanzarDirecto('1010001144', 'COLABORADOR')">
            🔧 Mantenimiento: Jaime Londoño
          </button>
        </div>
      </div>

      <div class="role-card">
        <div>
          <h3>🩺 2. Perfil Coordinador</h3>
          <p style="margin: 6px 0;">Jefe de Servicio Asistencial / Supervisora.</p>
          <ul>
            <li>Gestiona su servicio base y servicios hermanos</li>
            <li>Supervisa el calendario de sus colaboradores</li>
            <li>Aprueba o rechaza permutas de su servicio</li>
            <li>Publica el cuadrante mensual</li>
          </ul>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="btn-quick coord" onclick="lanzarDirecto('1010001022', 'COORDINADOR')">
            🏥 Urgencias: Alfonso Mora
          </button>
          <button class="btn-quick coord" style="background: #b45309;" onclick="lanzarDirecto('1037645182', 'COORDINADOR')">
            🔧 Mantenimiento: Jhon Alexander Calderon
          </button>
        </div>
      </div>

      <div class="role-card">
        <div>
          <h3>🏛️ 3. Perfil Talento Humano</h3>
          <p style="margin: 6px 0;">Dirección Asistencial / Nómina / Administrador.</p>
          <ul>
            <li>Acceso completo a todos los servicios del hospital</li>
            <li>Cierra y reabre meses para Nómina</li>
            <li>Supervisa Mi Calendario de cualquier colaborador</li>
            <li>Administra Servicios, Turnos y Días Cívicos</li>
          </ul>
        </div>
        <button class="btn-quick admin" onclick="lanzarRapido('ADMIN_TH')">
          🚀 Entrar como Talento Humano
        </button>
      </div>
    </div>

    <div class="panel">
      <h2>🎯 Lanzamiento Personalizado (Selecciona cualquier empleado real de PostgreSQL)</h2>
      <div class="form-grid">
        <div>
          <label>Filtrar por Servicio:</label>
          <select id="selServicio" onchange="filtrarEmpleados()">
            <option value="TODOS">Todos los servicios</option>
          </select>
        </div>
        <div>
          <label>Colaborador (Base de Datos PostgreSQL):</label>
          <select id="selEmpleado"></select>
        </div>
        <div>
          <label>Rol en el Token JWT:</label>
          <select id="selRol">
            <option value="COLABORADOR">COLABORADOR (Mi Calendario)</option>
            <option value="COORDINADOR">COORDINADOR (Jefe de Servicio)</option>
            <option value="ADMIN_TH">ADMIN_TH (Talento Humano / Nómina)</option>
          </select>
        </div>
        <div>
          <button class="btn-quick" style="padding: 10px 20px;" onclick="lanzarSeleccionado()">
            🔐 Firmar JWT y Abrir Rafa Turnos
          </button>
        </div>
      </div>
      <div id="tokenBox" class="token-preview">
        Cargando plantilla desde PostgreSQL (http://localhost:3000/api/v1/servicios-admin/empleados)...
      </div>
    </div>
  </div>

  <script>
    let empleados = [];
    let servicios = [];

    async function cargarDatos() {
      try {
        const [resSrv, resEmp] = await Promise.all([
          fetch('${RAFA_TURNOS_BACKEND_URL}/api/v1/servicios-admin'),
          fetch('${RAFA_TURNOS_BACKEND_URL}/api/v1/servicios-admin/empleados')
        ]);
        servicios = await resSrv.json();
        empleados = await resEmp.json();

        const selSrv = document.getElementById('selServicio');
        for (const s of servicios) {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.nombre + ' (' + s.codigo + ')';
          selSrv.appendChild(opt);
        }
        filtrarEmpleados();
        document.getElementById('tokenBox').textContent =
          '✅ ' + empleados.length + ' colaboradores cargados desde PostgreSQL. Elige un perfil para generar el token SSO.';
      } catch (e) {
        document.getElementById('tokenBox').textContent =
          '⚠️ No se pudo conectar con http://localhost:3000. Asegúrate de que el backend de Rafa Turnos esté encendido.';
      }
    }

    function filtrarEmpleados() {
      const srvId = document.getElementById('selServicio').value;
      const selEmp = document.getElementById('selEmpleado');
      selEmp.innerHTML = '';
      const lista = srvId === 'TODOS'
        ? empleados
        : empleados.filter(e => e.servicioBaseId === srvId);

      for (const e of lista) {
        const cat = e.categoria ? (e.categoria.nombre || e.categoria) : '';
        const srv = e.servicioBase ? e.servicioBase.codigo : '';
        const opt = document.createElement('option');
        opt.value = e.documento;
        opt.textContent = e.nombre + ' — ' + cat + ' [' + srv + '] (C.C. ' + e.documento + ')';
        selEmp.appendChild(opt);
      }
    }

    async function emitirYRedirigir(documento, rol) {
      const res = await fetch('/emitir-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento, rol })
      });
      const data = await res.json();
      if (data.redirectUrl) {
        document.getElementById('tokenBox').textContent = 'Token emitido: ' + data.ssoToken;
        window.location.href = data.redirectUrl;
      }
    }

    function lanzarSeleccionado() {
      const doc = document.getElementById('selEmpleado').value;
      const rol = document.getElementById('selRol').value;
      if (!doc) return;
      emitirYRedirigir(doc, rol);
    }

    function lanzarDirecto(documento, rol) {
      emitirYRedirigir(documento, rol);
    }

    function lanzarRapido(rol) {
      if (!empleados.length) return;
      let candidato = empleados[0];
      if (rol === 'COORDINADOR') {
        candidato = empleados.find(e => e.servicioBaseId === 'srv-urg' && (e.categoria?.nombre || '').includes('Jefe')) || empleados[0];
      } else if (rol === 'COLABORADOR') {
        candidato = empleados.find(e => e.servicioBaseId === 'srv-urg' && (e.categoria?.nombre || '').includes('Auxiliar')) || empleados[1] || empleados[0];
      }
      emitirYRedirigir(candidato.documento, rol);
    }

    cargarDatos();
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/intranet/empleados')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });

    // Obtener censo actual desde PostgreSQL y enriquecer con novedades de contratación
    fetch(`${RAFA_TURNOS_BACKEND_URL}/api/v1/servicios-admin/empleados`)
      .then((r) => r.json())
      .then((baseEmpleados) => {
        const censo = Array.isArray(baseEmpleados)
          ? baseEmpleados.map((e) => ({
              documento: e.documento,
              nombre: e.nombre,
              correo: e.correo,
              cargoNombre: e.categoria?.nombre || 'Auxiliar de Enfermería',
              servicioCodigo: e.servicioBase?.codigo || 'URG',
              horasContratoMes: e.horasContratoMes || 168,
              estadoContrato: 'ACTIVO',
            }))
          : [];

        // Nueva contratación reportada por Gestión Humana (para verificar auto-creación)
        if (!censo.some((x) => x.documento === '1099887766')) {
          censo.push({
            documento: '1099887766',
            nombre: 'Dra. Valentina Castro Mendoza',
            correo: 'valentina.castro@hospital.gov.co',
            cargoNombre: 'Médico General',
            servicioCodigo: 'URG',
            horasContratoMes: 168,
            estadoContrato: 'ACTIVO',
          });
        }
        if (!censo.some((x) => x.documento === '1037645123')) {
          censo.push({
            documento: '1037645123',
            nombre: 'Tomas grajales frias',
            correo: 'tomas.grajales@hospital.gov.co',
            cargoNombre: 'Tecnólogo(a) en Imágenes Diagnósticas',
            servicioCodigo: 'TOM',
            horasContratoMes: 168,
            estadoContrato: 'ACTIVO',
           });
        }

        res.end(JSON.stringify(censo, null, 2));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/intranet/novedades')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    const novedades = [
      {
        empleadoDocumento: '1010001016',
        empleadoNombre: 'Mónica Ruiz Quintero',
        cargo: 'Auxiliar de Enfermería',
        servicioCodigo: 'URG',
        tipoNovedad: 'VAC',
        fechaInicio: '2026-11-10',
        fechaFin: '2026-11-18',
        diasHabiles: 9,
        estado: 'APROBADA',
        resolucion: 'RES-GH-2026-849',
        observaciones: 'Vacaciones reglamentarias aprobadas por Gestión Humana'
      },
      {
        empleadoDocumento: '1010001001',
        empleadoNombre: 'Dr. Pablo Franco Duque',
        cargo: 'Médico General',
        servicioCodigo: 'URG',
        tipoNovedad: 'INC',
        fechaInicio: '2026-11-03',
        fechaFin: '2026-11-05',
        diasHabiles: 3,
        estado: 'APROBADA',
        codigoCie10: 'J06.9',
        entidad: 'EPS Sanitas',
        observaciones: 'Incapacidad médica por enfermedad respiratoria'
      },
      {
        empleadoDocumento: '1010001005',
        empleadoNombre: 'Enf. Iván Pineda Mora',
        cargo: 'Enfermero(a) Jefe',
        servicioCodigo: 'URG',
        tipoNovedad: 'LIC',
        fechaInicio: '2026-11-24',
        fechaFin: '2026-11-26',
        diasHabiles: 3,
        estado: 'APROBADA',
        resolucion: 'LIC-CAL-2026-112',
        observaciones: 'Licencia remunerada por calamidad / luto familiar'
      }
    ];
    res.end(JSON.stringify(novedades, null, 2));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PORTAL);
    return;
  }

  if (req.method === 'POST' && req.url === '/emitir-token') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { documento, rol } = JSON.parse(body || '{}');
        const secret = leerSecretoCompartido();
        const ssoToken = firmarJwtIntranet({ documento, rol }, secret, 300);
        const redirectUrl = `${RAFA_TURNOS_FRONTEND_URL}/?sso_token=${encodeURIComponent(ssoToken)}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ssoToken, redirectUrl }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`🏥 Simulador Externo de Intranet Hospitalaria activo en http://localhost:${PORT}`);
});
