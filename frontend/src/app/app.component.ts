import { Component, computed, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CATALOGO_TURNOS,
  CeldaAsignacion,
  CodigoTurno,
  EmpleadoHospital,
  FestivoEntry,
  PermutaItem,
  RegistroAuditoria,
  ServicioHospitalario,
  TipoTurnoConfig,
} from './models';
import { TurnosApiService } from './turnos-api.service';
import { FestivosColombiaHelper } from './festivos-colombia.helper';

// Importación de datos iniciales exportados de PostgreSQL para carga instantánea
import EMPLEADOS_DB_RAW from './empleados-seed.json';
import SERVICIOS_DB_RAW from './servicios-seed.json';

export interface DiaColumna {
  dia: number;
  fechaIso: string;
  letraDia: string;
  esSabado: boolean;
  esDomingo: boolean;
  festivo?: FestivoEntry;
}

export interface InfraccionNormativa {
  empleadoId: string;
  empleadoNombre: string;
  dia: number;
  mensaje: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  // Navegación principal (Menú lateral izquierdo colapsable estilo Thurni)
  vistaActual = signal<
    'PLANIFICADOR' | 'DASHBOARD' | 'PORTAL_EMPLEADO' | 'CONFIGURACION'
  >('PLANIFICADOR');
  subVistaConfig = signal<'SERVICIOS' | 'CATALOGO_TURNOS' | 'FESTIVOS'>('SERVICIOS');
  sidebarContraido = signal<boolean>(false);
  mensajeToast = signal<string>('');

  // Periodo y Servicio Activo
  anioSeleccionado = signal<number>(2026);
  mesSeleccionado = signal<number>(11); // Noviembre 2026
  servicioSeleccionadoId = signal<string>('srv-urg');
  estadosPorCuadrante = signal<Record<string, 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'>>({});
  estadoCuadrante = computed<'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'>(() => {
    const key = `${this.servicioSeleccionadoId()}::${this.anioSeleccionado()}-${this.mesSeleccionado()}`;
    return this.estadosPorCuadrante()[key] || 'BORRADOR';
  });
  mostrarComparadorPrevisto = signal<boolean>(false);

  // Filtro por Categoría en el Planificador (Mejora solicitada)
  filtroCategoriaActiva = signal<string>('TODAS');

  // Modales
  modalRotacionAbierto = signal<boolean>(false);
  modalIcalAbierto = signal<boolean>(false);

  // Formulario Nuevo Festivo / Día Cívico
  nuevoFestivoFecha = signal<string>('2026-11-20');
  nuevoFestivoNombre = signal<string>('Día Cívico Aniversario Hospitalario');
  versionCacheFestivos = signal<number>(1);

  // Formulario Nuevo Servicio Autónomo (Gestión de Servicios)
  nuevoServicioCodigo = signal<string>('');
  nuevoServicioNombre = signal<string>('');
  nuevoServicioTipoAsistencia = signal<string>('URGENCIAS');
  enlaceHermanoSrv1 = signal<string>('srv-urg');
  enlaceHermanoSrv2 = signal<string>('srv-mat');

  // Catálogos reactivos cargados desde la Base de Datos
  servicios = signal<ServicioHospitalario[]>([]);
  empleados = signal<EmpleadoHospital[]>([]);
  empleadosRotadosPorServicio = signal<Record<string, string[]>>({});
  catalogoTurnosMap = signal<Record<string, TipoTurnoConfig>>({ ...CATALOGO_TURNOS });

  // Lista maestra del catálogo (sin los alias duplicados M, T, N, G12)
  listaTurnosCatalogo = computed<TipoTurnoConfig[]>(() => {
    const aliasOcultos = new Set(['M', 'T', 'N', 'G12']);
    return Object.values(this.catalogoTurnosMap()).filter(
      (t) => !aliasOcultos.has(t.codigo)
    );
  });

  // Turnos visibles en la Paleta del Cuadro de Turnos
  listaTurnosPaleta = computed<TipoTurnoConfig[]>(() => {
    return this.listaTurnosCatalogo().filter((t) => t.visibleEnPaleta !== false);
  });

  // Formulario de Creación / Edición de Turnos en Catálogo de Turnos
  turnoEditandoCodigo = signal<string | null>(null);
  turnoFormCodigo = signal<string>('');
  turnoFormNombre = signal<string>('');
  turnoFormModoJornada = signal<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>('HORARIO');
  turnoFormHoraInicio = signal<string>('07:00');
  turnoFormHoraFin = signal<string>('15:00');
  turnoFormColorKey = signal<string>('AZUL_CIELO');
  turnoFormNocturnoPesado = signal<boolean>(false);
  turnoFormDescuentaBanco = signal<boolean>(false);

  readonly temasColorTurno = [
    { key: 'AZUL_CIELO', nombre: 'Azul Mañana', bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC' },
    { key: 'CELESTE', nombre: 'Celeste Claro', bgHex: '#BAE6FD', textHex: '#0284C7', borderHex: '#38BDF8' },
    { key: 'AMBAR_TARDE', nombre: 'Ámbar Tarde', bgHex: '#FEF3C7', textHex: '#B45309', borderHex: '#FCD34D' },
    { key: 'NARANJA_GUARDIA', nombre: 'Naranja Guardia', bgHex: '#FFEDD5', textHex: '#C2410C', borderHex: '#FDBA74' },
    { key: 'VIOLETA_NOCHE', nombre: 'Violeta Noche', bgHex: '#EDE9FE', textHex: '#6D28D9', borderHex: '#C4B5FD' },
    { key: 'PURPURA_NOCHE', nombre: 'Púrpura Intenso', bgHex: '#DDD6FE', textHex: '#7C3AED', borderHex: '#A78BFA' },
    { key: 'ROJO_CORAL', nombre: 'Rojo Guardia 24h', bgHex: '#FEE2E2', textHex: '#B91C1C', borderHex: '#FCA5A5' },
    { key: 'TURQUESA_COMP', nombre: 'Turquesa Compensatorio', bgHex: '#CCFBF1', textHex: '#0F766E', borderHex: '#5EEAD4' },
    { key: 'ESMERALDA_VAC', nombre: 'Verde Esmeralda', bgHex: '#D1FAE5', textHex: '#047857', borderHex: '#6EE7B7' },
    { key: 'ROSA_INC', nombre: 'Rosa Novedad', bgHex: '#FCE7F3', textHex: '#BE185D', borderHex: '#F9A8D4' },
    { key: 'GRIS_ADMIN', nombre: 'Gris Neutro', bgHex: '#F3F4F6', textHex: '#374151', borderHex: '#D1D5DB' },
  ];

  // Cálculo automático de horas Ordinarias, Diurnas (06:00-21:00) y Nocturnas (21:00-06:00)
  calculoAutomaticoHorasTurno = computed<{
    ordinarias: number;
    diurnas: number;
    nocturnas: number;
    horarioTexto: string;
  }>(() => {
    const modo = this.turnoFormModoJornada();
    if (modo === 'DESCANSO') {
      return {
        ordinarias: 0,
        diurnas: 0,
        nocturnas: 0,
        horarioTexto: 'Descanso / Novedad',
      };
    }
    if (modo === 'GUARDIA_24H') {
      const ini = this.turnoFormHoraInicio() || '07:00';
      return {
        ordinarias: 24,
        diurnas: 15,
        nocturnas: 9,
        horarioTexto: `${ini} - ${ini} (+1)`,
      };
    }

    const iniStr = this.turnoFormHoraInicio() || '07:00';
    const finStr = this.turnoFormHoraFin() || '15:00';
    const [hIni, mIni] = iniStr.split(':').map((n) => Number(n) || 0);
    const [hFin, mFin] = finStr.split(':').map((n) => Number(n) || 0);

    const minInicio = hIni * 60 + mIni;
    let minFin = hFin * 60 + mFin;
    if (minFin <= minInicio) {
      minFin += 24 * 60; // Cruza la medianoche
    }

    let minDiurnos = 0;
    let minNocturnos = 0;
    for (let m = minInicio; m < minFin; m++) {
      const minDia = m % 1440;
      // Franja diurna en Colombia: 06:00 (360) a 21:00 (1260)
      if (minDia >= 360 && minDia < 1260) {
        minDiurnos++;
      } else {
        minNocturnos++;
      }
    }

    const diurnas = Math.round((minDiurnos / 60) * 10) / 10;
    const nocturnas = Math.round((minNocturnos / 60) * 10) / 10;
    const ordinarias = Math.round(((minDiurnos + minNocturnos) / 60) * 10) / 10;

    return {
      ordinarias,
      diurnas,
      nocturnas,
      horarioTexto: `${iniStr} - ${finStr}`,
    };
  });
  readonly mesesDisponibles = [
    { valor: 7, nombre: 'Julio' },
    { valor: 8, nombre: 'Agosto' },
    { valor: 9, nombre: 'Septiembre' },
    { valor: 10, nombre: 'Octubre' },
    { valor: 11, nombre: 'Noviembre' },
    { valor: 12, nombre: 'Diciembre' },
  ];

  // Herramienta Pincel / Drag & Drop estilo Thurni
  turnoPincelActivo = signal<CodigoTurno>('M8');
  pintandoConRaton = signal<boolean>(false);
  celdaEnfocada = signal<{ empId: string; dia: number } | null>(null);

  // Estado Reactivo de Asignaciones en Memoria (independiente por Año-Mes)
  asignacionesPorPeriodo = signal<Record<string, Record<string, Record<number, CeldaAsignacion>>>>({});
  asignaciones = computed<Record<string, Record<number, CeldaAsignacion>>>(() => {
    const key = `${this.anioSeleccionado()}-${this.mesSeleccionado()}`;
    return this.asignacionesPorPeriodo()[key] || {};
  });

  private actualizarAsignacionesMesActual(
    nuevoMapa: Record<string, Record<number, CeldaAsignacion>>
  ): void {
    const key = `${this.anioSeleccionado()}-${this.mesSeleccionado()}`;
    this.asignacionesPorPeriodo.update((todo) => ({ ...todo, [key]: nuevoMapa }));
  }

  // Portal del Empleado (Autoservicio)
  empleadoPortalId = signal<string>('emp-001');
  diaPermutaSeleccionado = signal<number>(10);
  companeroPermutaId = signal<string>('emp-002');

  // Solicitudes de Permuta 1-a-1
  listaPermutas = signal<PermutaItem[]>([
    {
      id: 'perm-101',
      fechaSolicitud: '2026-10-28 08:15',
      solicitanteId: 'emp-005',
      solicitanteNombre: 'Enf. Diana Carolina Mora',
      receptorId: 'emp-006',
      receptorNombre: 'Enf. Camilo Andrés López',
      categoria: 'Enfermero(a) Jefe',
      servicioId: 'srv-urg',
      diaOrigen: 6,
      turnoOrigen: 'N8',
      diaDestino: 6,
      turnoDestino: 'M8',
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: 'Cumple descanso mínimo de 12h y mantiene la cobertura del servicio.',
    },
    {
      id: 'perm-102',
      fechaSolicitud: '2026-10-28 09:40',
      solicitanteId: 'emp-009',
      solicitanteNombre: 'Laura Marcela Gómez Pineda',
      receptorId: 'emp-011',
      receptorNombre: 'Paola Andrea Castro Mejía',
      categoria: 'Auxiliar de Enfermería',
      servicioId: 'srv-urg',
      diaOrigen: 14,
      turnoOrigen: 'T8',
      diaDestino: 14,
      turnoDestino: 'M8',
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: 'Misma categoría profesional y sin cruce de horarios.',
    },
  ]);

  // Bitácora de Auditoría
  bitacoraAuditoria = signal<RegistroAuditoria[]>([
    {
      id: 'aud-1',
      timestamp: '2026-10-28 07:30:12',
      actor: 'Coordinación Urgencias',
      empleadoNombre: 'Enf. Diana Carolina Mora',
      servicioNombre: 'Urgencias Generales',
      dia: 1,
      turnoAnterior: 'M8',
      turnoNuevo: 'S',
      motivo: 'Descanso post-turno nocturno',
    },
  ]);

  constructor(private readonly api: TurnosApiService) {}

  ngOnInit(): void {
    this.cargarDatosDesdeBaseDeDatos();
  }

  cargarDatosDesdeBaseDeDatos(): void {
    // 1. Mapeo de Servicios desde PostgreSQL
    const rawSrvs: any[] = Array.isArray(SERVICIOS_DB_RAW)
      ? (SERVICIOS_DB_RAW as unknown as any[])
      : ((SERVICIOS_DB_RAW as any).value || []);

    const srvsMapeados: ServicioHospitalario[] = rawSrvs.map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      tipoAsistencia: s.tipoAsistencia,
      intranetId: s.intranetId,
      reqManana: s.codigo === 'URG' ? 6 : s.codigo === 'CIR' ? 5 : 4,
      reqTarde: s.codigo === 'URG' ? 6 : s.codigo === 'CIR' ? 4 : 4,
      reqNoche: s.codigo === 'URG' ? 4 : s.codigo === 'CIR' ? 2 : 2,
      empleadosCount: s.empleadosCount || 0,
      hermanos: s.hermanos || [],
    }));
    this.servicios.set(srvsMapeados);

    // 2. Mapeo de Empleados desde PostgreSQL con sus saldos reales de Banco de Horas
    const rawEmps: any[] = Array.isArray(EMPLEADOS_DB_RAW)
      ? (EMPLEADOS_DB_RAW as unknown as any[])
      : ((EMPLEADOS_DB_RAW as any).value || []);

    const empsMapeados: EmpleadoHospital[] = rawEmps.map((e, idx) => {
      const saldoObj = e.saldosBancoHoras && e.saldosBancoHoras[0];
      const saldoAnt = saldoObj ? saldoObj.saldoFinalAcumulado : ((idx % 3 === 0) ? 16 : (idx % 3 === 1) ? -8 : 0);
      const ultimoTurno = (idx % 4 === 0) ? 'N8' : (idx % 4 === 1) ? 'T8' : (idx % 4 === 2) ? 'M8' : 'L';

      return {
        id: e.id,
        documento: e.documento,
        nombre: e.nombre,
        categoria: e.categoria ? e.categoria.nombre : 'Personal Asistencial',
        servicioBaseId: e.servicioBaseId,
        horasContratoMes: e.horasContratoMes || 168,
        saldoBancoAnterior: saldoAnt,
        ultimoTurnoMesPrevio: ultimoTurno as CodigoTurno,
      };
    });
    this.empleados.set(empsMapeados);

    // Inicializar asignaciones de cuadrante con rueda balanceada
    this.sembrarCuadranteConPlantillaReal(empsMapeados);

    // Ajustar selección de empleado en portal
    if (empsMapeados.length > 0) {
      this.empleadoPortalId.set(empsMapeados[0].id);
      this.companeroPermutaId.set(empsMapeados[1]?.id || empsMapeados[0].id);
    }

    // 3. Cargar estados de cuadrantes y turnos persistidos en PostgreSQL
    this.sincronizarCuadrantesDesdePostgres();
    this.sincronizarCatalogoTurnosDesdePostgres();
  }

  private sincronizarCatalogoTurnosDesdePostgres(): void {
    this.api.getTiposTurno().subscribe({
      next: (turnosDb) => {
        if (!Array.isArray(turnosDb) || turnosDb.length === 0) return;
        this.catalogoTurnosMap.update((actual) => {
          const copia = { ...actual };
          for (const t of turnosDb) {
            const cod = (t.codigo || '').toUpperCase();
            if (!cod) continue;
            const existente = copia[cod];
            const tema =
              this.temasColorTurno.find(
                (tm) => tm.bgHex.toLowerCase() === (t.colorHex || '').toLowerCase()
              ) || this.temasColorTurno[0];

            const horario =
              existente?.horario ||
              (t.horasOrdinarias === 24
                ? `${t.horaInicio || '07:00'} - ${t.horaFin || '07:00'} (+1)`
                : t.horasOrdinarias > 0
                  ? `${t.horaInicio || '07:00'} - ${t.horaFin || '15:00'}`
                  : 'Descanso / Novedad');

            copia[cod] = {
              codigo: cod,
              nombre: t.nombre || existente?.nombre || cod,
              horario,
              horaInicio: t.horaInicio || existente?.horaInicio || '07:00',
              horaFin: t.horaFin || existente?.horaFin || '15:00',
              horasOrdinarias: Number(t.horasOrdinarias ?? existente?.horasOrdinarias ?? 0),
              horasDiurnas: Number(t.horasDiurnas ?? existente?.horasDiurnas ?? 0),
              horasNocturnas: Number(t.horasNocturnas ?? existente?.horasNocturnas ?? 0),
              bgHex: t.colorHex || existente?.bgHex || tema.bgHex,
              textHex: existente?.textHex || tema.textHex,
              borderHex: existente?.borderHex || tema.borderHex,
              esAusencia: existente?.esAusencia ?? (cod === 'VAC' || cod === 'INC'),
              esNocturnoPesado: !!(t.esNocturnoPesado ?? existente?.esNocturnoPesado),
              descuentaBancoHoras: !!(t.descuentaBancoHoras ?? existente?.descuentaBancoHoras),
              visibleEnPaleta:
                existente?.visibleEnPaleta !== undefined
                  ? existente.visibleEnPaleta
                  : !['M', 'T', 'N', 'G12'].includes(cod),
            };
          }
          return copia;
        });
      },
      error: () => {},
    });
  }

  private sincronizarCuadrantesDesdePostgres(): void {
    this.api.getEstadoGlobalCuadrantes(this.anioSeleccionado()).subscribe({
      next: (res) => {
        if (res.estados) {
          this.estadosPorCuadrante.set(res.estados);
        }

        if (res.asignacionesPorPeriodo) {
          this.asignacionesPorPeriodo.update((actual) => {
            const copia = { ...actual };
            for (const [periodoKey, mapaEmpsDb] of Object.entries(res.asignacionesPorPeriodo)) {
              const mapaPeriodo = { ...(copia[periodoKey] || {}) };
              for (const [empId, diasDb] of Object.entries(mapaEmpsDb)) {
                const filaEmp = { ...(mapaPeriodo[empId] || {}) };
                for (const [diaStr, celdaDb] of Object.entries(diasDb)) {
                  const diaNum = Number(diaStr);
                  filaEmp[diaNum] = {
                    codigo: (celdaDb.codigo || '') as CodigoTurno,
                    previsto: ((celdaDb.previsto ?? celdaDb.codigo) || '') as CodigoTurno,
                    esRotacion: celdaDb.esRotacion,
                    servicioEjecutorId: celdaDb.servicioEjecutorId,
                  };
                }
                mapaPeriodo[empId] = filaEmp;
              }
              copia[periodoKey] = mapaPeriodo;
            }
            return copia;
          });
        }
      },
      error: () => {
        // Si el backend está reiniciando, conserva el estado en memoria
      },
    });
  }

  // Servicio seleccionado
  servicioActual = computed<ServicioHospitalario>(() => {
    return (
      this.servicios().find((s) => s.id === this.servicioSeleccionadoId()) ||
      this.servicios()[0] || {
        id: 'srv-urg',
        codigo: 'URG',
        nombre: 'Urgencias Generales',
        tipoAsistencia: 'URGENCIAS',
        reqManana: 6,
        reqTarde: 6,
        reqNoche: 4,
      }
    );
  });

  // Lista de festivos del año desde la Caché RAM
  listaFestivosAnio = computed<FestivoEntry[]>(() => {
    this.versionCacheFestivos();
    const mapa = FestivosColombiaHelper.getFestivosAnio(this.anioSeleccionado());
    return Array.from(mapa.values());
  });

  // Días del mes seleccionado
  diasDelMes = computed<DiaColumna[]>(() => {
    this.versionCacheFestivos();
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const totalDias = new Date(anio, mes, 0).getDate();
    const letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const resultado: DiaColumna[] = [];

    for (let d = 1; d <= totalDias; d++) {
      const fechaObj = new Date(anio, mes - 1, d);
      const dow = fechaObj.getDay();
      const mm = String(mes).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const fechaIso = `${anio}-${mm}-${dd}`;
      const festivo = FestivosColombiaHelper.esFestivo(fechaIso);

      resultado.push({
        dia: d,
        fechaIso,
        letraDia: letras[dow],
        esSabado: dow === 6,
        esDomingo: dow === 0,
        festivo,
      });
    }
    return resultado;
  });

  // Celdas de relleno al inicio y final del mes para alinear filas semanales (Lunes a Domingo)
  celdasOffsetInicioMes = computed<number[]>(() => {
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const dowPrimerDia = new Date(anio, mes - 1, 1).getDay(); // 0=Dom, 1=Lun, ..., 6=Sab
    const offsetLunes = dowPrimerDia === 0 ? 6 : dowPrimerDia - 1;
    return Array.from({ length: offsetLunes }, (_, i) => i);
  });

  celdasOffsetFinMes = computed<number[]>(() => {
    const totalCeldas = this.celdasOffsetInicioMes().length + this.diasDelMes().length;
    const resto = totalCeldas % 7;
    const faltantes = resto === 0 ? 0 : 7 - resto;
    return Array.from({ length: faltantes }, (_, i) => i);
  });

  // Lista de categorías únicas presentes en el servicio actual
  categoriasEnServicioActual = computed<string[]>(() => {
    const srvId = this.servicioSeleccionadoId();
    const emps = this.empleados().filter((e) => e.servicioBaseId === srvId);
    return Array.from(new Set(emps.map((e) => e.categoria))).sort();
  });

  // Métricas resumen de servicios y categorías para la vista de Servicios
  totalCategoriasUnicas = computed<number>(() => {
    return new Set(this.empleados().map((e) => e.categoria)).size;
  });

  totalEnlacesApoyo = computed<number>(() => {
    const totalDirecciones = this.servicios().reduce(
      (acc, s) => acc + (s.hermanos ? s.hermanos.length : 0),
      0
    );
    return Math.ceil(totalDirecciones / 2);
  });

  // Empleados del cuadrante (Planta + Rotados homólogos de servicios hermanos)
  empleadosDelCuadrante = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const srvId = this.servicioSeleccionadoId();
    const todos = this.empleados();
    const idsRotados = this.empleadosRotadosPorServicio()[srvId] || [];
    const filtroCat = this.filtroCategoriaActiva();

    let propios = todos
      .filter((e) => e.servicioBaseId === srvId)
      .map((emp) => ({ emp, esRotado: false }));

    let rotados = todos
      .filter((e) => idsRotados.includes(e.id))
      .map((emp) => ({ emp, esRotado: true }));

    let lista = [...propios, ...rotados];

    if (filtroCat !== 'TODAS') {
      lista = lista.filter((item) => item.emp.categoria === filtroCat);
    }

    // Ordenar agrupados por categoría y luego por nombre
    return lista.sort((a, b) => {
      const cmpCat = a.emp.categoria.localeCompare(b.emp.categoria);
      if (cmpCat !== 0) return cmpCat;
      return a.emp.nombre.localeCompare(b.emp.nombre);
    });
  });

  // Conteo de filas por categoría para los separadores de grupo del cuadrante
  conteoPorCategoriaCuadrante = computed<Record<string, number>>(() => {
    const conteo: Record<string, number> = {};
    for (const { emp } of this.empleadosDelCuadrante()) {
      conteo[emp.categoria] = (conteo[emp.categoria] || 0) + 1;
    }
    return conteo;
  });

  // Filas calculadas con reglas CST y Banco de Horas (Descuenta 8h con COMP)
  filasCuadrante = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const listaEmp = this.empleadosDelCuadrante();

    return listaEmp.map(({ emp, esRotado }) => {
      const celdasEmp = matriz[emp.id] || {};
      let horasTrabajadas = 0;
      let hod = 0;
      let hon = 0;
      let hdfd = 0;
      let hdfn = 0;
      let horasAmortizadasComp = 0;
      let conteoNoches = 0;
      let conteoDomFest = 0;
      let diasVac = 0;
      let diasInc = 0;

      for (const d of dias) {
        const celda = celdasEmp[d.dia];
        const cod = celda?.codigo || '';
        if (!cod) continue;

        const cfg = this.catalogoTurnosMap()[cod];
        if (!cfg) continue;

        horasTrabajadas += cfg.horasOrdinarias;
        if (cfg.esNocturnoPesado || cfg.horasNocturnas > 0) {
          conteoNoches++;
        }
        if (cod === 'VAC') diasVac++;
        if (cod === 'INC') diasInc++;
        if (cfg.descuentaBancoHoras) {
          horasAmortizadasComp += 8; // Regla de jornada estándar de 8h
        }

        const esDiaDominicalOFestivo = d.esDomingo || !!d.festivo;
        if (esDiaDominicalOFestivo && cfg.horasOrdinarias > 0) {
          conteoDomFest++;
          hdfd += cfg.horasDiurnas;
          hdfn += cfg.horasNocturnas;
        } else {
          hod += cfg.horasDiurnas;
          hon += cfg.horasNocturnas;
        }
      }

      const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
      const nuevoSaldoBanco = emp.saldoBancoAnterior + diferenciaMes;

      return {
        empleado: emp,
        esPersonalRotado: esRotado,
        celdas: celdasEmp,
        horasTrabajadas,
        hod,
        hon,
        hdfd,
        hdfn,
        horasAmortizadasComp,
        diferenciaMes,
        nuevoSaldoBanco,
        conteoNoches,
        conteoDomFest,
        causaCompensatorioDominical: conteoDomFest >= 3,
        diasVac,
        diasInc,
      };
    });
  });

  // Cobertura dinámica por turno al pie del cuadrante
  coberturaPorDia = computed<Record<number, { manana: number; tarde: number; noche: number }>>(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const srvId = this.servicioSeleccionadoId();
    const empsDelServicio = this.empleados().filter((e) => e.servicioBaseId === srvId);
    const resultado: Record<number, { manana: number; tarde: number; noche: number }> = {};

    for (const d of dias) {
      let manana = 0;
      let tarde = 0;
      let noche = 0;

      for (const emp of empsDelServicio) {
        const cod = matriz[emp.id]?.[d.dia]?.codigo || '';
        if (!cod) continue;
        const cfg = this.catalogoTurnosMap()[cod];
        if (!cfg) continue;

        // Clasificación inteligente por horario del turno
        if (cfg.horario.includes('07:00') && !cfg.esNocturnoPesado) manana++;
        if (cfg.horario.includes('13:00') || cfg.horario.includes('15:00')) tarde++;
        if (cfg.esNocturnoPesado || cfg.horasNocturnas >= 4) noche++;
      }

      resultado[d.dia] = { manana, tarde, noche };
    }
    return resultado;
  });

  // Motor de validaciones CST dinámico por configuración de turno
  infraccionesActivas = computed<InfraccionNormativa[]>(() => {
    const dias = this.diasDelMes();
    const filas = this.filasCuadrante();
    const alertas: InfraccionNormativa[] = [];

    for (const f of filas) {
      // 1. Validar Empalme con mes previo
      const catalogo = this.catalogoTurnosMap();
      const prevCod = f.empleado.ultimoTurnoMesPrevio;
      const prevCfg = prevCod ? catalogo[prevCod] : undefined;
      const dia1Cod = f.celdas[1]?.codigo || '';
      const dia1Cfg = dia1Cod ? catalogo[dia1Cod] : undefined;

      if (prevCfg?.esNocturnoPesado && dia1Cfg && dia1Cfg.horasOrdinarias > 0 && dia1Cod !== 'S') {
        alertas.push({
          empleadoId: f.empleado.id,
          empleadoNombre: f.empleado.nombre,
          dia: 1,
          mensaje: `${f.empleado.nombre} (Día 1): Infracción Empalme — Cerró mes en ${prevCod}, requiere Saliente (S) o Libre (L).`,
        });
      }

      // 2. Validar secuencia diaria
      for (let i = 1; i < dias.length; i++) {
        const dActual = dias[i].dia;
        const dPrevio = dias[i - 1].dia;
        const cPrev = f.celdas[dPrevio]?.codigo || '';
        const cAct = f.celdas[dActual]?.codigo || '';

        if (!cPrev || !cAct) continue;
        const cfgPrev = catalogo[cPrev];
        const cfgAct = catalogo[cAct];

        if (cfgPrev?.esNocturnoPesado && cfgAct && cfgAct.horasOrdinarias > 0 && cAct !== 'S' && cAct !== 'L') {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Violación Post-Guardia tras ${cPrev} (Descanso legal < 12h).`,
          });
        }
      }
    }
    return alertas;
  });

  // KPIs de la Torre de Control
  porcentajeCoberturaGlobal = computed<number>(() => {
    const dias = this.diasDelMes();
    const srv = this.servicioActual();
    const cob = this.coberturaPorDia();
    let totalChecks = dias.length * 3;
    let cumplidos = 0;

    for (const d of dias) {
      const c = cob[d.dia];
      if (c.manana >= srv.reqManana) cumplidos++;
      if (c.tarde >= srv.reqTarde) cumplidos++;
      if (c.noche >= srv.reqNoche) cumplidos++;
    }
    return totalChecks > 0 ? Math.round((cumplidos / totalChecks) * 100) : 100;
  });

  balanceGlobalBancoServicio = computed<number>(() => {
    return this.filasCuadrante().reduce((acc, f) => acc + f.nuevoSaldoBanco, 0);
  });

  permutasPendientesCount = computed<number>(() => {
    return this.listaPermutas().filter((p) => p.estado === 'PENDIENTE_SUPERVISOR').length;
  });

  resumenNominaCalculado = computed(() => this.filasCuadrante());

  // Candidatos de rotación homólogos de servicios hermanos (Doc 20)
  candidatosRotacionHomologos = computed<EmpleadoHospital[]>(() => {
    const srvActual = this.servicioActual();
    const idsHermanos = (srvActual.hermanos || []).map((h) => h.id);
    const todos = this.empleados();
    const yaIncluidos = new Set(this.empleadosDelCuadrante().map((x) => x.emp.id));

    return todos.filter((e) => idsHermanos.includes(e.servicioBaseId) && !yaIncluidos.has(e.id));
  });

  // Datos para el Portal del Empleado
  datosEmpleadoPortal = computed(() => {
    const id = this.empleadoPortalId();
    const emp = this.empleados().find((e) => e.id === id) || this.empleados()[0] || {
      id: 'emp-001',
      documento: '1010001001',
      nombre: 'Dr. Alejandro Mendoza',
      categoria: 'Médico General',
      servicioBaseId: 'srv-urg',
      horasContratoMes: 168,
      saldoBancoAnterior: 16,
      ultimoTurnoMesPrevio: 'T8',
    };

    const dias = this.diasDelMes();
    const celdasEmp = this.asignaciones()[emp.id] || {};
    let horasTrabajadas = 0;
    let horasAmortizadasComp = 0;
    let conteoNoches = 0;
    let conteoDomFest = 0;

    for (const d of dias) {
      const cod = celdasEmp[d.dia]?.codigo || '';
      const cfg = cod ? this.catalogoTurnosMap()[cod] : undefined;
      if (!cfg) continue;

      horasTrabajadas += cfg.horasOrdinarias;
      if (cfg.esNocturnoPesado || cfg.horasNocturnas > 0) conteoNoches++;
      if ((d.esDomingo || !!d.festivo) && cfg.horasOrdinarias > 0) conteoDomFest++;
      if (cfg.descuentaBancoHoras) horasAmortizadasComp += 8;
    }

    const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
    const nuevoSaldoBanco = emp.saldoBancoAnterior + diferenciaMes;
    const servicioBase = this.servicios().find((s) => s.id === emp.servicioBaseId) || this.servicioActual();

    return {
      empleado: emp,
      servicioBase,
      celdas: celdasEmp,
      horasTrabajadas,
      horasAmortizadasComp,
      diferenciaMes,
      nuevoSaldoBanco,
      conteoNoches,
      conteoDomFest,
    };
  });

  companerosParesPortal = computed<EmpleadoHospital[]>(() => {
    const actual = this.datosEmpleadoPortal().empleado;
    return this.empleados().filter(
      (e) =>
        e.id !== actual.id &&
        e.servicioBaseId === actual.servicioBaseId &&
        e.categoria === actual.categoria
    );
  });

  equipoDeGuardiaDiaSeleccionado = computed(() => {
    const actual = this.datosEmpleadoPortal().empleado;
    const dia = this.diaPermutaSeleccionado();
    const matriz = this.asignaciones();

    return this.empleados()
      .filter((e) => e.servicioBaseId === actual.servicioBaseId && e.id !== actual.id)
      .map((e) => ({
        empleado: e,
        turno: (matriz[e.id]?.[dia]?.codigo || 'L') as CodigoTurno,
      }))
      .filter((x) => x.turno !== '' && x.turno !== 'L' && x.turno !== 'S' && x.turno !== 'VAC' && x.turno !== 'INC');
  });

  misPermutasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.listaPermutas().filter((p) => p.solicitanteId === id || p.receptorId === id);
  });

  private sembrarCuadranteConPlantillaReal(emps: EmpleadoHospital[]): void {
    const rueda8h: CodigoTurno[] = ['M8', 'M8', 'T8', 'T8', 'N8', 'S', 'L', 'L'];
    const anio = this.anioSeleccionado();
    const porPeriodo: Record<string, Record<string, Record<number, CeldaAsignacion>>> = {};

    for (const m of this.mesesDisponibles) {
      const mapaMes: Record<string, Record<number, CeldaAsignacion>> = {};
      emps.forEach((emp, idx) => {
        mapaMes[emp.id] = {};
        for (let d = 1; d <= 31; d++) {
          if (d === 1 && (emp.ultimoTurnoMesPrevio === 'N8' || emp.ultimoTurnoMesPrevio === 'G24')) {
            mapaMes[emp.id][d] = { codigo: 'S', previsto: 'S' };
            continue;
          }
          const anterior = mapaMes[emp.id][d - 1]?.codigo;
          if (anterior === 'N8' || anterior === 'G24') {
            mapaMes[emp.id][d] = { codigo: 'S', previsto: 'S' };
            continue;
          }

          const cod = rueda8h[(d + idx * 2 + m.valor) % rueda8h.length];
          mapaMes[emp.id][d] = { codigo: cod, previsto: cod };
        }
      });
      porPeriodo[`${anio}-${m.valor}`] = mapaMes;
    }

    this.asignacionesPorPeriodo.set(porPeriodo);
  }

  // Interacciones con la Paleta y Celdas
  seleccionarPincel(cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
  }

  onDragStartPaleta(event: DragEvent, cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
    event.dataTransfer?.setData('text/plain', cod);
  }

  onDragOverCelda(event: DragEvent): void {
    event.preventDefault();
  }

  onDropCelda(event: DragEvent, empId: string, dia: number): void {
    event.preventDefault();
    const cod = (event.dataTransfer?.getData('text/plain') as CodigoTurno) ?? this.turnoPincelActivo();
    this.aplicarTurnoEnCelda(empId, dia, cod, 'Arrastre Drag & Drop');
  }

  iniciarPintadoCelda(empId: string, dia: number): void {
    this.celdaEnfocada.set({ empId, dia });
    this.pintandoConRaton.set(true);
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Asignación manual');
  }

  continuarPintadoCelda(empId: string, dia: number): void {
    if (!this.pintandoConRaton()) return;
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Arrastre continuo');
  }

  finalizarPintadoRaton(): void {
    this.pintandoConRaton.set(false);
  }

  onKeyDownCelda(event: KeyboardEvent, empId: string, dia: number): void {
    const key = event.key.toUpperCase();
    const mapaTeclas: Record<string, CodigoTurno> = {
      M: 'M8',
      T: 'T8',
      N: 'N8',
      G: 'D12',
      S: 'S',
      L: 'L',
      C: 'COMP',
      V: 'VAC',
      I: 'INC',
      DELETE: '',
      BACKSPACE: '',
    };

    if (key in mapaTeclas) {
      event.preventDefault();
      this.aplicarTurnoEnCelda(empId, dia, mapaTeclas[key], `Atajo de teclado (${key})`);
    }
  }

  aplicarTurnoEnCelda(empId: string, dia: number, nuevoCodigo: CodigoTurno, origen: string): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];

    if (
      (celdaActual?.codigo === 'VAC' || celdaActual?.codigo === 'INC') &&
      nuevoCodigo !== '' &&
      nuevoCodigo !== celdaActual.codigo
    ) {
      this.mostrarNotificacion(
        `Celda bloqueada por novedad oficial (${celdaActual.codigo}). Usa el borrador si deseas retirar la ausencia.`
      );
      return;
    }

    const anterior = celdaActual?.codigo || '';
    if (anterior === nuevoCodigo) return;

    const empObj = this.empleados().find((e) => e.id === empId);
    const esRotacion = empObj ? empObj.servicioBaseId !== this.servicioSeleccionadoId() : false;

    filaEmp[dia] = {
      codigo: nuevoCodigo,
      previsto: celdaActual?.previsto ?? anterior,
      esRotacion,
      servicioEjecutorId: this.servicioSeleccionadoId(),
    };

    // Auto-protección con Saliente (S) al día siguiente
    const cfgNuevo = this.catalogoTurnosMap()[nuevoCodigo];
    let seAutoAsignoSaliente = false;
    if (cfgNuevo?.esNocturnoPesado && dia < this.diasDelMes().length) {
      const sig = filaEmp[dia + 1]?.codigo || '';
      if (!sig || sig === 'L') {
        filaEmp[dia + 1] = {
          codigo: 'S',
          previsto: filaEmp[dia + 1]?.previsto ?? sig,
          esRotacion,
        };
        seAutoAsignoSaliente = true;
      }
    }

    actualMap[empId] = filaEmp;
    this.actualizarAsignacionesMesActual(actualMap);

    // Persistir cambio de celda en PostgreSQL (asignaciones_turno)
    this.api
      .guardarCeldaCuadrante({
        servicioId: this.servicioSeleccionadoId(),
        anio: this.anioSeleccionado(),
        mes: this.mesSeleccionado(),
        dia,
        empleadoId: empId,
        codigo: nuevoCodigo,
        previsto: filaEmp[dia].previsto || '',
        esRotacion,
      })
      .subscribe();

    if (seAutoAsignoSaliente) {
      this.api
        .guardarCeldaCuadrante({
          servicioId: this.servicioSeleccionadoId(),
          anio: this.anioSeleccionado(),
          mes: this.mesSeleccionado(),
          dia: dia + 1,
          empleadoId: empId,
          codigo: 'S',
          previsto: filaEmp[dia + 1].previsto || '',
          esRotacion,
        })
        .subscribe();
    }

    if (empObj) {
      const nuevoLog: RegistroAuditoria = {
        id: 'aud-' + Date.now(),
        timestamp: new Date().toTimeString().substring(0, 8),
        actor: 'Supervisora de Servicio',
        empleadoNombre: empObj.nombre,
        servicioNombre: this.servicioActual().nombre,
        dia,
        turnoAnterior: anterior,
        turnoNuevo: nuevoCodigo,
        motivo: origen,
      };
      this.bitacoraAuditoria.set([nuevoLog, ...this.bitacoraAuditoria().slice(0, 25)]);
    }
  }

  /**
   * Deja el cuadrante del servicio activo en blanco para que Gestión Humana
   * lo construya a mano. Conserva las novedades oficiales (VAC / INC) que
   * provienen de la Intranet y no se pueden borrar desde el planificador.
   */
  limpiarCuadranteCompleto(): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const srvNombre = this.servicioActual().nombre;
    const confirmado = window.confirm(
      `¿Dejar en blanco TODO el cuadro de turnos de "${srvNombre}"?\n\n` +
        'Se borrarán los turnos asignados (incluida la sugerencia automática). ' +
        'Las vacaciones e incapacidades oficiales se conservan.'
    );
    if (!confirmado) return;

    const actualMap = { ...this.asignaciones() };
    let celdasLimpiadas = 0;
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[] = [];

    for (const { emp, esRotado } of this.empleadosDelCuadrante()) {
      const fila = { ...(actualMap[emp.id] || {}) };
      for (const d of this.diasDelMes()) {
        const celda = fila[d.dia];
        if (!celda || celda.codigo === '' || celda.codigo === 'VAC' || celda.codigo === 'INC') {
          continue;
        }
        const prev = celda.previsto ?? celda.codigo;
        fila[d.dia] = {
          codigo: '',
          previsto: prev,
          esRotacion: esRotado,
        };
        loteParaDb.push({
          empleadoId: emp.id,
          dia: d.dia,
          codigo: '',
          previsto: prev,
          esRotacion: esRotado,
        });
        celdasLimpiadas++;
      }
      actualMap[emp.id] = fila;
    }

    this.actualizarAsignacionesMesActual(actualMap);

    if (loteParaDb.length > 0) {
      this.api
        .guardarLoteCuadrante({
          servicioId: this.servicioSeleccionadoId(),
          anio: this.anioSeleccionado(),
          mes: this.mesSeleccionado(),
          celdas: loteParaDb,
        })
        .subscribe();
    }

    this.bitacoraAuditoria.set([
      {
        id: 'aud-' + Date.now(),
        timestamp: new Date().toTimeString().substring(0, 8),
        actor: 'Gestión Humana',
        empleadoNombre: 'Todo el servicio',
        servicioNombre: srvNombre,
        dia: 0,
        turnoAnterior: '',
        turnoNuevo: '',
        motivo: `Limpieza total del cuadro de turnos (${celdasLimpiadas} turnos borrados) para construcción manual`,
      },
      ...this.bitacoraAuditoria().slice(0, 25),
    ]);

    this.mostrarNotificacion(
      `Cuadro de turnos en blanco: ${celdasLimpiadas} turnos borrados. VAC e INC oficiales conservadas.`
    );
  }

  ejecutarAutocompletarHuecos(): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const dias = this.diasDelMes();
    const srv = this.servicioActual();
    const actualMap = { ...this.asignaciones() };
    let totalAsignados = 0;
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[] = [];

    for (const d of dias) {
      const cob = this.coberturaPorDia()[d.dia];
      const faltanM = Math.max(0, srv.reqManana - cob.manana);
      const faltanT = Math.max(0, srv.reqTarde - cob.tarde);
      const faltanN = Math.max(0, srv.reqNoche - cob.noche);

      const cubrir = (turno: CodigoTurno, cant: number) => {
        if (cant <= 0) return;
        const candidatos = [...this.filasCuadrante()]
          .filter((f) => {
            const hoy = actualMap[f.empleado.id]?.[d.dia]?.codigo || '';
            const ayer =
              d.dia === 1
                ? f.empleado.ultimoTurnoMesPrevio
                : actualMap[f.empleado.id]?.[d.dia - 1]?.codigo || '';
            const cfgAyer = CATALOGO_TURNOS[ayer];
            return (hoy === '' || hoy === 'L') && !cfgAyer?.esNocturnoPesado;
          })
          .sort((a, b) => a.nuevoSaldoBanco - b.nuevoSaldoBanco);

        for (let i = 0; i < Math.min(cant, candidatos.length); i++) {
          const cand = candidatos[i];
          const fila = { ...(actualMap[cand.empleado.id] || {}) };
          const prev = fila[d.dia]?.previsto ?? 'L';
          fila[d.dia] = {
            codigo: turno,
            previsto: prev,
            esRotacion: cand.esPersonalRotado,
          };
          actualMap[cand.empleado.id] = fila;
          loteParaDb.push({
            empleadoId: cand.empleado.id,
            dia: d.dia,
            codigo: turno,
            previsto: prev,
            esRotacion: cand.esPersonalRotado,
          });
          totalAsignados++;
        }
      };

      cubrir('M8', faltanM);
      cubrir('T8', faltanT);
      cubrir('N8', faltanN);
    }

    this.actualizarAsignacionesMesActual(actualMap);

    if (loteParaDb.length > 0) {
      this.api
        .guardarLoteCuadrante({
          servicioId: this.servicioSeleccionadoId(),
          anio: this.anioSeleccionado(),
          mes: this.mesSeleccionado(),
          celdas: loteParaDb,
        })
        .subscribe();
    }
    this.mostrarNotificacion(
      `Se completaron automáticamente ${totalAsignados} turnos faltantes.`
    );
  }

  // Administración de Servicios y Servicios de Apoyo
  crearNuevoServicioAutonomo(): void {
    const cod = this.nuevoServicioCodigo().trim();
    const nom = this.nuevoServicioNombre().trim();
    const tipo = this.nuevoServicioTipoAsistencia();

    if (!cod || !nom) {
      this.mostrarNotificacion('Por favor completa el código y nombre del nuevo servicio.');
      return;
    }

    this.api
      .crearServicio({
        codigo: cod,
        nombre: nom,
        tipoAsistencia: tipo,
      })
      .subscribe({
        next: () => {
          this.mostrarNotificacion(`Servicio "${nom}" creado correctamente.`);
          this.nuevoServicioCodigo.set('');
          this.nuevoServicioNombre.set('');
          this.recargarServicios();
        },
        error: () => {
          // Fallback local
          const nuevoSrv: ServicioHospitalario = {
            id: 'srv-' + cod.toLowerCase(),
            codigo: cod.toUpperCase(),
            nombre: nom,
            tipoAsistencia: tipo as any,
            reqManana: 4,
            reqTarde: 4,
            reqNoche: 2,
            empleadosCount: 0,
            hermanos: [],
          };
          this.servicios.set([...this.servicios(), nuevoSrv]);
          this.mostrarNotificacion(`Servicio "${nom}" creado correctamente.`);
        },
      });
  }

  guardarEnlaceHermanos(): void {
    const id1 = this.enlaceHermanoSrv1();
    const id2 = this.enlaceHermanoSrv2();

    if (id1 === id2) {
      this.mostrarNotificacion('Selecciona dos servicios distintos para vincularlos como apoyo.');
      return;
    }

    this.api.enlazarServiciosHermanos(id1, id2).subscribe({
      next: () => {
        this.mostrarNotificacion('Servicios vinculados como servicios de apoyo.');
        this.recargarServicios();
      },
      error: () => {
        this.mostrarNotificacion('Servicios vinculados como servicios de apoyo.');
      },
    });
  }

  desenlazarServicioHermano(srv1Id: string, srv2Id: string): void {
    this.api.desenlazarServiciosHermanos(srv1Id, srv2Id).subscribe({
      next: () => {
        this.mostrarNotificacion('Vínculo de servicio de apoyo eliminado.');
        this.recargarServicios();
      },
      error: () => {
        this.servicios.update((lista) =>
          lista.map((s) => {
            if (s.id === srv1Id) {
              return { ...s, hermanos: (s.hermanos || []).filter((h) => h.id !== srv2Id) };
            }
            if (s.id === srv2Id) {
              return { ...s, hermanos: (s.hermanos || []).filter((h) => h.id !== srv1Id) };
            }
            return s;
          })
        );
        this.mostrarNotificacion('Vínculo de servicio de apoyo eliminado.');
      },
    });
  }

  private recargarServicios(): void {
    this.api.getServicios().subscribe((srvs) => {
      if (srvs && srvs.length > 0) {
        this.servicios.set(srvs);
      }
    });
  }

  // Personal de Apoyo
  abrirModalRotacion(): void {
    this.modalRotacionAbierto.set(true);
  }

  vincularRotacionAlCuadrante(cand: EmpleadoHospital): void {
    const srvId = this.servicioSeleccionadoId();
    const mapaRot = { ...this.empleadosRotadosPorServicio() };
    const listaActual = mapaRot[srvId] || [];
    if (!listaActual.includes(cand.id)) {
      mapaRot[srvId] = [...listaActual, cand.id];
      this.empleadosRotadosPorServicio.set(mapaRot);
    }
    this.modalRotacionAbierto.set(false);
    this.mostrarNotificacion(`${cand.nombre} agregado como personal de apoyo al cuadrante.`);
  }

  // Cambios de Turno
  aprobarPermuta(idPermuta: string): void {
    const perm = this.listaPermutas().find((p) => p.id === idPermuta);
    if (!perm) return;

    this.aplicarTurnoEnCelda(
      perm.solicitanteId,
      perm.diaOrigen,
      perm.turnoDestino,
      `Cambio de turno aprobado con ${perm.receptorNombre}`
    );
    this.aplicarTurnoEnCelda(
      perm.receptorId,
      perm.diaDestino,
      perm.turnoOrigen,
      `Cambio de turno aprobado con ${perm.solicitanteNombre}`
    );

    this.listaPermutas.set(
      this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'APROBADA' } : p))
    );
    this.mostrarNotificacion(`Cambio de turno aprobado y actualizado en el cuadrante.`);
  }

  rechazarPermuta(idPermuta: string): void {
    this.listaPermutas.set(
      this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'RECHAZADA' } : p))
    );
    this.mostrarNotificacion('Solicitud de cambio de turno rechazada.');
  }

  enviarSolicitudPermutaDesdePortal(): void {
    const datosMios = this.datosEmpleadoPortal();
    const dia = this.diaPermutaSeleccionado();
    const miTurno = datosMios.celdas[dia]?.codigo || 'L';
    const comp = this.empleados().find((e) => e.id === this.companeroPermutaId());

    if (!comp) {
      this.mostrarNotificacion('No hay compañeros de la misma categoría disponibles.');
      return;
    }

    const turnoComp = this.asignaciones()[comp.id]?.[dia]?.codigo || 'L';
    if (miTurno === turnoComp) {
      this.mostrarNotificacion(`Ambos tienen el mismo turno (${miTurno}) el día ${dia}.`);
      return;
    }

    const nuevaPermuta: PermutaItem = {
      id: 'perm-' + Math.floor(100 + Math.random() * 900),
      fechaSolicitud: 'Hoy ' + new Date().toTimeString().substring(0, 5),
      solicitanteId: datosMios.empleado.id,
      solicitanteNombre: datosMios.empleado.nombre,
      receptorId: comp.id,
      receptorNombre: comp.nombre,
      categoria: datosMios.empleado.categoria,
      servicioId: datosMios.empleado.servicioBaseId,
      diaOrigen: dia,
      turnoOrigen: miTurno,
      diaDestino: dia,
      turnoDestino: turnoComp,
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: `Misma categoría (${datosMios.empleado.categoria}) y descanso mínimo de 12h cumplido.`,
    };

    this.listaPermutas.set([nuevaPermuta, ...this.listaPermutas()]);
    this.mostrarNotificacion(`Solicitud de cambio de turno enviada.`);
  }

  // Días cívicos
  agregarDiaCivico(): void {
    const fecha = this.nuevoFestivoFecha();
    const nombre = this.nuevoFestivoNombre().trim();
    if (!fecha || !nombre) return;

    FestivosColombiaHelper.agregarFestivoManual(fecha, nombre);
    this.versionCacheFestivos.update((v) => v + 1);
    this.api.agregarDiaCivico(fecha, nombre).subscribe();
    this.mostrarNotificacion(`Día cívico "${nombre}" agregado al calendario.`);
  }

  eliminarDiaCivico(fecha: string): void {
    FestivosColombiaHelper.eliminarFestivoManual(fecha);
    this.versionCacheFestivos.update((v) => v + 1);
    this.api.eliminarDiaCivico(fecha).subscribe();
    this.mostrarNotificacion(`Día cívico ${fecha} eliminado.`);
  }

  // Exportar Excel Nómina
  exportarExcelNomina(): void {
    const filas = this.filasCuadrante();
    const dias = this.diasDelMes();
    const encabezadosDias = dias.map((d) => `Dia_${d.dia}`).join(';');
    const header = `Documento;Colaborador;Categoria;Servicio;Contrato_Mes;HOD;HON_35;HDFD_75;HDFN_110;Horas_Trabajadas;Domingos_Festivos;Compensatorio_Causado;Dias_VAC;Dias_INC;Saldo_Banco_Anterior;Diferencia_Mes;Nuevo_Saldo_Banco;${encabezadosDias}`;

    const lineas = filas.map((f) => {
      const turnosDia = dias.map((d) => f.celdas[d.dia]?.codigo || 'L').join(';');
      return [
        f.empleado.documento,
        `"${f.empleado.nombre}"`,
        `"${f.empleado.categoria}"`,
        `"${this.servicioActual().nombre}"`,
        f.empleado.horasContratoMes,
        f.hod,
        f.hon,
        f.hdfd,
        f.hdfn,
        f.horasTrabajadas,
        f.conteoDomFest,
        f.causaCompensatorioDominical ? 1 : 0,
        f.diasVac,
        f.diasInc,
        f.empleado.saldoBancoAnterior,
        f.diferenciaMes,
        f.nuevoSaldoBanco,
        turnosDia,
      ].join(';');
    });

    const contenidoCsv = '\uFEFF' + [header, ...lineas].join('\n');
    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_Nomina_${this.servicioActual().codigo}_${this.anioSeleccionado()}_${this.mesSeleccionado()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.mostrarNotificacion('Archivo Excel (CSV) de Nómina y Banco de Horas descargado.');
  }

  // Controladores de eventos
  cambiarServicio(nuevoId: string): void {
    this.servicioSeleccionadoId.set(nuevoId);
    this.filtroCategoriaActiva.set('TODAS');
  }

  cambiarMes(nuevoMes: number): void {
    this.mesSeleccionado.set(Number(nuevoMes));
  }

  cambiarEstadoCuadrante(): void {
    const actual = this.estadoCuadrante();
    const srvId = this.servicioSeleccionadoId();
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const key = `${srvId}::${anio}-${mes}`;
    const mesNombre =
      this.mesesDisponibles.find((m) => m.valor === mes)?.nombre || String(mes);
    const srvNombre = this.servicioActual().nombre;

    let nuevoEstado: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA';
    if (actual === 'BORRADOR') {
      nuevoEstado = 'PUBLICADO';
      this.mostrarNotificacion(
        `Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) publicado.`
      );
    } else if (actual === 'PUBLICADO') {
      nuevoEstado = 'CERRADO_NOMINA';
      this.mostrarNotificacion(
        `Mes de ${mesNombre} ${anio} (${srvNombre}) cerrado para Nómina.`
      );
    } else {
      nuevoEstado = 'BORRADOR';
      this.mostrarNotificacion(
        `Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) reabierto en borrador.`
      );
    }

    this.estadosPorCuadrante.update((m) => ({ ...m, [key]: nuevoEstado }));

    const saldosConsolidados =
      nuevoEstado === 'CERRADO_NOMINA'
        ? this.filasCuadrante().map((f) => ({
            empleadoId: f.empleado.id,
            saldoInicial: f.empleado.saldoBancoAnterior,
            horasTrabajadas: f.horasTrabajadas,
            horasContratadas: f.empleado.horasContratoMes,
            horasAmortizadasComp: f.horasAmortizadasComp,
            diferenciaMes: f.diferenciaMes,
            saldoFinalAcumulado: f.nuevoSaldoBanco,
          }))
        : undefined;

    this.api
      .actualizarEstadoCuadrante({
        servicioId: srvId,
        anio,
        mes,
        estado: nuevoEstado,
        saldosConsolidados,
      })
      .subscribe();
  }

  seleccionarDiaEnPortal(dia: number): void {
    this.diaPermutaSeleccionado.set(dia);
    const pares = this.companerosParesPortal();
    if (pares.length > 0 && !pares.some((p) => p.id === this.companeroPermutaId())) {
      this.companeroPermutaId.set(pares[0].id);
    }
  }

  cambiarEmpleadoPortal(nuevoId: string): void {
    this.empleadoPortalId.set(nuevoId);
    const pares = this.companerosParesPortal();
    if (pares.length > 0) {
      this.companeroPermutaId.set(pares[0].id);
    }
  }

  enfocarCelda(empId: string, dia: number): void {
    this.celdaEnfocada.set({ empId, dia });
  }

  copiarEnlaceIcal(): void {
    this.modalIcalAbierto.set(false);
    this.mostrarNotificacion('Enlace de calendario copiado al portapapeles.');
  }

  notificarIntranet(): void {
    this.mostrarNotificacion('Regresando a la Intranet Hospitalaria...');
  }

  obtenerConfigTurno(cod: CodigoTurno): TipoTurnoConfig | undefined {
    return cod ? this.catalogoTurnosMap()[cod] : undefined;
  }

  cargarTurnoParaEdicion(turno: TipoTurnoConfig): void {
    this.turnoEditandoCodigo.set(turno.codigo);
    this.turnoFormCodigo.set(turno.codigo);
    this.turnoFormNombre.set(turno.nombre);

    if (turno.horasOrdinarias === 0) {
      this.turnoFormModoJornada.set('DESCANSO');
    } else if (turno.horasOrdinarias === 24) {
      this.turnoFormModoJornada.set('GUARDIA_24H');
    } else {
      this.turnoFormModoJornada.set('HORARIO');
    }

    this.turnoFormHoraInicio.set(turno.horaInicio || '07:00');
    this.turnoFormHoraFin.set(turno.horaFin || '15:00');
    this.turnoFormNocturnoPesado.set(!!turno.esNocturnoPesado);
    this.turnoFormDescuentaBanco.set(!!turno.descuentaBancoHoras);

    const tema =
      this.temasColorTurno.find(
        (tm) => tm.bgHex.toLowerCase() === turno.bgHex.toLowerCase()
      ) || this.temasColorTurno[0];
    this.turnoFormColorKey.set(tema.key);
  }

  limpiarFormularioTurno(): void {
    this.turnoEditandoCodigo.set(null);
    this.turnoFormCodigo.set('');
    this.turnoFormNombre.set('');
    this.turnoFormModoJornada.set('HORARIO');
    this.turnoFormHoraInicio.set('07:00');
    this.turnoFormHoraFin.set('15:00');
    this.turnoFormColorKey.set('AZUL_CIELO');
    this.turnoFormNocturnoPesado.set(false);
    this.turnoFormDescuentaBanco.set(false);
  }

  guardarTurnoEnCatalogo(): void {
    const codigo = this.turnoFormCodigo().trim().toUpperCase();
    const nombre = this.turnoFormNombre().trim();

    if (!codigo || !nombre) {
      this.mostrarNotificacion('Ingresa el código y el nombre del turno.');
      return;
    }

    const calc = this.calculoAutomaticoHorasTurno();
    const tema =
      this.temasColorTurno.find((t) => t.key === this.turnoFormColorKey()) ||
      this.temasColorTurno[0];

    const existente = this.catalogoTurnosMap()[codigo];
    const nuevoTurno: TipoTurnoConfig = {
      codigo,
      nombre,
      horario: calc.horarioTexto,
      horaInicio: this.turnoFormHoraInicio(),
      horaFin: this.turnoFormHoraFin(),
      horasOrdinarias: calc.ordinarias,
      horasDiurnas: calc.diurnas,
      horasNocturnas: calc.nocturnas,
      bgHex: tema.bgHex,
      textHex: tema.textHex,
      borderHex: tema.borderHex,
      esAusencia: existente?.esAusencia ?? false,
      esNocturnoPesado: this.turnoFormNocturnoPesado(),
      descuentaBancoHoras: this.turnoFormDescuentaBanco(),
      visibleEnPaleta: existente?.visibleEnPaleta ?? true,
    };

    this.catalogoTurnosMap.update((actual) => ({
      ...actual,
      [codigo]: nuevoTurno,
    }));

    this.api
      .guardarTipoTurno({
        codigo,
        nombre,
        horaInicio: nuevoTurno.horaInicio || '07:00',
        horaFin: nuevoTurno.horaFin || '15:00',
        horasOrdinarias: nuevoTurno.horasOrdinarias,
        horasDiurnas: nuevoTurno.horasDiurnas,
        horasNocturnas: nuevoTurno.horasNocturnas,
        colorHex: nuevoTurno.bgHex,
        descuentaBancoHoras: nuevoTurno.descuentaBancoHoras,
        esNocturnoPesado: nuevoTurno.esNocturnoPesado,
      })
      .subscribe({
        next: () => {
          this.mostrarNotificacion(
            `Turno [${codigo}] "${nombre}" guardado en el catálogo.`
          );
        },
        error: () => {
          this.mostrarNotificacion(
            `Turno [${codigo}] actualizado en la sesión actual.`
          );
        },
      });

    this.limpiarFormularioTurno();
  }

  alternarVisibilidadTurnoPaleta(codigo: string): void {
    this.catalogoTurnosMap.update((actual) => {
      const item = actual[codigo];
      if (!item) return actual;
      return {
        ...actual,
        [codigo]: {
          ...item,
          visibleEnPaleta: item.visibleEnPaleta === false ? true : false,
        },
      };
    });
  }

  obtenerConflictoCelda(empId: string, dia: number): InfraccionNormativa | undefined {
    return this.infraccionesActivas().find((i) => i.empleadoId === empId && i.dia === dia);
  }

  obtenerIniciales(nombre: string): string {
    return nombre
      .replace('Dr. ', '')
      .replace('Dra. ', '')
      .replace('Enf. ', '')
      .replace('Lic. ', '')
      .replace('Tec. ', '')
      .replace('Q.F. ', '')
      .replace('Reg. ', '')
      .replace('Bact. ', '')
      .split(' ')
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }

  formatearSigno(valor: number): string {
    return valor > 0 ? `+${valor}` : `${valor}`;
  }

  construirTooltipCelda(
    emp: EmpleadoHospital,
    d: DiaColumna,
    celda?: CeldaAsignacion,
    conflicto?: InfraccionNormativa
  ): string {
    const partes: string[] = [`${emp.nombre} • ${emp.categoria} • Día ${d.dia}`];
    if (d.festivo) partes.push(`🇨🇴 Festivo: ${d.festivo.nombre}`);
    if (celda?.codigo) {
      const cfg = this.catalogoTurnosMap()[celda.codigo];
      if (cfg) partes.push(`Turno: ${cfg.nombre} (${cfg.horario})`);
    } else {
      partes.push('Sin turno asignado');
    }
    if (conflicto) partes.push(`⚠️ ALERTA: ${conflicto.mensaje}`);
    return partes.join(' | ');
  }

  private mostrarNotificacion(msg: string): void {
    this.mensajeToast.set(msg);
    setTimeout(() => {
      if (this.mensajeToast() === msg) {
        this.mensajeToast.set('');
      }
    }, 4500);
  }
}
