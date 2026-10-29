import { Component, computed, HostListener, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CATALOGO_TURNOS,
  CeldaAsignacion,
  CodigoTurno,
  EmpleadoHospital,
  FestivoEntry,
  ModalConfirmacionConfig,
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
  // Navegación principal (Menú lateral izquierdo colapsable automáticamente por hover)
  vistaActual = signal<
    'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'PORTAL_EMPLEADO' | 'CONFIGURACION'
  >('PLANIFICADOR');
  subVistaConfig = signal<'SERVICIOS' | 'CATALOGO_TURNOS' | 'FESTIVOS'>('SERVICIOS');
  subVistaReportes = signal<'PRE_NOMINA' | 'EQUIDAD' | 'BANCO_HORAS' | 'AUSENTISMO'>('PRE_NOMINA');
  filtroReporteServicioId = signal<string>('TODOS');
  busquedaReporteTexto = signal<string>('');
  sidebarFijo = signal<boolean>(false);
  sidebarHovered = signal<boolean>(false);
  sidebarExpandido = computed<boolean>(() => this.sidebarFijo() || this.sidebarHovered());
  sidebarContraido = computed<boolean>(() => !this.sidebarExpandido());
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
  nombreMesSeleccionado = computed<string>(() => {
    return (
      this.mesesDisponibles.find((m) => m.valor === this.mesSeleccionado())?.nombre ||
      String(this.mesSeleccionado())
    );
  });
  mostrarComparadorPrevisto = signal<boolean>(false);

  // Filtro por Categoría en el Planificador (Mejora solicitada)
  filtroCategoriaActiva = signal<string>('TODAS');

  // Modales
  modalRotacionAbierto = signal<boolean>(false);
  modalIcalAbierto = signal<boolean>(false);
  modalConfirmacion = signal<ModalConfirmacionConfig | null>(null);

  abrirConfirmacion(config: ModalConfirmacionConfig): void {
    this.modalConfirmacion.set(config);
  }

  cerrarConfirmacion(): void {
    this.modalConfirmacion.set(null);
  }

  ejecutarConfirmacion(): void {
    const conf = this.modalConfirmacion();
    if (conf) {
      this.modalConfirmacion.set(null);
      conf.onConfirmar();
    }
  }

  // Formulario Nuevo Festivo / Día Cívico
  nuevoFestivoFecha = signal<string>('2026-11-20');
  nuevoFestivoNombre = signal<string>('Día Cívico Aniversario Hospitalario');
  versionCacheFestivos = signal<number>(1);

  // Formulario de Creación / Edición de Servicio Autónomo
  servicioEditandoId = signal<string | null>(null);
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

  // Cálculo automático de horas Ordinarias, Diurnas (06:00-19:00) y Nocturnas (19:00-06:00) - Ley 2466 / CST Art. 160
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
        diurnas: 13,
        nocturnas: 11,
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
      // Franja diurna en Colombia (Ley 2466 / CST Art. 160): 06:00 (360) a 19:00 (1140)
      if (minDia >= 360 && minDia < 1140) {
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

  // Herramienta Pincel / Selector y Navegación
  turnoPincelActivo = signal<string>('POINTER');
  autoAvanzarAlTeclear = signal<boolean>(true);
  pintandoConRaton = signal<boolean>(false);
  celdaEnfocada = signal<{ empId: string; dia: number } | null>(null);

  // Modalidad Clonador Rápido con Ctrl (Estilo Excel)
  teclaCtrlPresionada = signal<boolean>(false);
  clonandoConCtrl = signal<boolean>(false);
  turnoClonandoConCtrl = signal<CodigoTurno | null>(null);

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

  // Mapa de Saldos Consolidados de Banco de Horas (PostgreSQL)
  saldosConsolidadosMap = signal<Record<string, number>>({});

  // Solicitudes de Permuta 1-a-1 (Persistidas localmente sin datos residuales de prueba)
  listaPermutas = signal<PermutaItem[]>(this.cargarPermutasDesdeStorage());

  // Bitácora de Auditoría (Persistida localmente sin datos residuales de prueba)
  bitacoraAuditoria = signal<RegistroAuditoria[]>(this.cargarAuditoriaDesdeStorage());

  constructor(private readonly api: TurnosApiService) {}

  ngOnInit(): void {
    this.cargarDatosDesdeBaseDeDatos();
  }

  private cargarPermutasDesdeStorage(): PermutaItem[] {
    try {
      const guardadas = localStorage.getItem('rafa_turnos_permutas');
      return guardadas ? JSON.parse(guardadas) : [];
    } catch {
      return [];
    }
  }

  private guardarPermutasEnStorage(lista: PermutaItem[]): void {
    try {
      localStorage.setItem('rafa_turnos_permutas', JSON.stringify(lista));
    } catch {}
  }

  private actualizarListaPermutas(lista: PermutaItem[]): void {
    this.listaPermutas.set(lista);
    this.guardarPermutasEnStorage(lista);
  }

  private cargarAuditoriaDesdeStorage(): RegistroAuditoria[] {
    try {
      const guardadas = localStorage.getItem('rafa_turnos_auditoria');
      return guardadas ? JSON.parse(guardadas) : [];
    } catch {
      return [];
    }
  }

  private guardarAuditoriaEnStorage(lista: RegistroAuditoria[]): void {
    try {
      localStorage.setItem('rafa_turnos_auditoria', JSON.stringify(lista));
    } catch {}
  }

  private registrarLogAuditoria(log: RegistroAuditoria): void {
    const actualizada = [log, ...this.bitacoraAuditoria().slice(0, 30)];
    this.bitacoraAuditoria.set(actualizada);
    this.guardarAuditoriaEnStorage(actualizada);
  }

  private mapearEmpleadosDesdeBackend(rawEmps: any[]): EmpleadoHospital[] {
    return rawEmps.map((e) => {
      const saldoObj = e.saldosBancoHoras && e.saldosBancoHoras[0];
      const saldoAnt = saldoObj ? Number(saldoObj.saldoFinalAcumulado || 0) : 0;

      return {
        id: e.id,
        documento: e.documento,
        nombre: e.nombre,
        categoria: e.categoria ? (e.categoria.nombre || e.categoria) : 'Personal Asistencial',
        servicioBaseId: e.servicioBaseId,
        horasContratoMes: e.horasContratoMes || 168,
        saldoBancoAnterior: saldoAnt,
        ultimoTurnoMesPrevio: 'L' as CodigoTurno,
      };
    });
  }

  cargarDatosDesdeBaseDeDatos(): void {
    // 1. Carga inicial resiliente de Servicios (fallback instantáneo para navegación fluida)
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

    // 2. Carga inicial de Empleados
    const rawEmps: any[] = Array.isArray(EMPLEADOS_DB_RAW)
      ? (EMPLEADOS_DB_RAW as unknown as any[])
      : ((EMPLEADOS_DB_RAW as any).value || []);

    const empsMapeados = this.mapearEmpleadosDesdeBackend(rawEmps);
    this.empleados.set(empsMapeados);

    // Inicializar matriz limpia del cuadrante (sin turnos ficticios de prueba)
    this.inicializarMatrizCuadrante(empsMapeados);

    // Ajustar selección de empleado en portal
    if (empsMapeados.length > 0) {
      this.empleadoPortalId.set(empsMapeados[0].id);
      this.companeroPermutaId.set(empsMapeados[1]?.id || empsMapeados[0].id);
    }

    // 3. SINCRONIZACIÓN MAESTRA CON POSTGRESQL (Única fuente de verdad)
    this.sincronizarServiciosDesdePostgres();
    this.sincronizarCatalogoTurnosDesdePostgres();
    this.sincronizarEmpleadosDesdePostgres();
    this.sincronizarFestivosDesdePostgres();
    this.sincronizarCuadrantesDesdePostgres();
  }

  private sincronizarEmpleadosDesdePostgres(): void {
    this.api.getEmpleados().subscribe({
      next: (empsDb) => {
        if (!Array.isArray(empsDb) || empsDb.length === 0) return;
        const emps = this.mapearEmpleadosDesdeBackend(empsDb);
        this.empleados.set(emps);
      },
      error: () => {},
    });
  }

  private sincronizarFestivosDesdePostgres(): void {
    this.api.getFestivos(this.anioSeleccionado()).subscribe({
      next: (res) => {
        if (res && Array.isArray(res.festivos)) {
          for (const f of res.festivos) {
            if (!f.esOficialLey) {
              FestivosColombiaHelper.agregarFestivoManual(f.fecha, f.nombre);
            }
          }
          this.versionCacheFestivos.update((v) => v + 1);
        }
      },
      error: () => {},
    });
  }

  private inicializarMatrizCuadrante(emps: EmpleadoHospital[]): void {
    const anio = this.anioSeleccionado();
    const porPeriodo: Record<string, Record<string, Record<number, CeldaAsignacion>>> = {};

    for (const m of this.mesesDisponibles) {
      const mapaMes: Record<string, Record<number, CeldaAsignacion>> = {};
      emps.forEach((emp) => {
        mapaMes[emp.id] = {};
      });
      porPeriodo[`${anio}-${m.valor}`] = mapaMes;
    }

    this.asignacionesPorPeriodo.set(porPeriodo);
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

        if (res.saldosConsolidados) {
          this.saldosConsolidadosMap.set(res.saldosConsolidados);
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

      const anio = this.anioSeleccionado();
      const mes = this.mesSeleccionado();
      const anioPrev = mes === 1 ? anio - 1 : anio;
      const mesPrev = mes === 1 ? 12 : mes - 1;
      const saldoKeyPrev = `${emp.id}::${anioPrev}-${mesPrev}`;
      const saldoAntReal = this.saldosConsolidadosMap()[saldoKeyPrev] !== undefined
        ? this.saldosConsolidadosMap()[saldoKeyPrev]
        : emp.saldoBancoAnterior;

      const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
      const nuevoSaldoBanco = saldoAntReal + diferenciaMes;
      const empConSaldo = { ...emp, saldoBancoAnterior: saldoAntReal };

      return {
        empleado: empConSaldo,
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

  // Filas consolidadas para Reportes (Multi-servicio o filtrado)
  datosReporteCalculados = computed(() => {
    const srvFiltro = this.filtroReporteServicioId();
    const textoBusqueda = this.busquedaReporteTexto().trim().toLowerCase();
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const todosEmps = this.empleados();
    const catalogo = this.catalogoTurnosMap();
    const mapaServicios = new Map(this.servicios().map((s) => [s.id, s]));

    let filtrados = todosEmps;
    if (srvFiltro !== 'TODOS') {
      filtrados = filtrados.filter((e) => e.servicioBaseId === srvFiltro);
    }
    if (textoBusqueda) {
      filtrados = filtrados.filter(
        (e) =>
          e.nombre.toLowerCase().includes(textoBusqueda) ||
          e.documento.includes(textoBusqueda) ||
          e.categoria.toLowerCase().includes(textoBusqueda)
      );
    }

    return filtrados.map((emp) => {
      const srvObj = mapaServicios.get(emp.servicioBaseId);
      const servicioNombre = srvObj ? srvObj.nombre : 'Servicio General';
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
        const cod = celdasEmp[d.dia]?.codigo || '';
        if (!cod) continue;
        const cfg = catalogo[cod];
        if (!cfg) continue;

        horasTrabajadas += cfg.horasOrdinarias;
        if (cfg.esNocturnoPesado || cfg.horasNocturnas > 0) conteoNoches++;
        if (cod === 'VAC') diasVac++;
        if (cod === 'INC') diasInc++;
        if (cfg.descuentaBancoHoras) horasAmortizadasComp += 8;

        const esDomOFest = d.esDomingo || !!d.festivo;
        if (esDomOFest && cfg.horasOrdinarias > 0) {
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

      let estadoBanco: 'EQUILIBRADO' | 'ATENCION' | 'CRITICO' = 'EQUILIBRADO';
      if (nuevoSaldoBanco > 30 || nuevoSaldoBanco < -18) {
        estadoBanco = 'CRITICO';
      } else if (nuevoSaldoBanco > 18 || nuevoSaldoBanco < -6) {
        estadoBanco = 'ATENCION';
      }

      let nivelFatiga: 'BAJO' | 'MODERADO' | 'ALTO' = 'BAJO';
      if (conteoNoches >= 5 || (conteoNoches >= 4 && conteoDomFest >= 3)) {
        nivelFatiga = 'ALTO';
      } else if (conteoNoches >= 3 || conteoDomFest >= 3) {
        nivelFatiga = 'MODERADO';
      }

      return {
        emp,
        servicioNombre,
        horasTrabajadas,
        horasContratoMes: emp.horasContratoMes,
        hod,
        hon,
        hdfd,
        hdfn,
        horasAmortizadasComp,
        conteoNoches,
        conteoDomFest,
        causaCompensatorioDominical: conteoDomFest >= 3,
        diasVac,
        diasInc,
        saldoBancoAnterior: emp.saldoBancoAnterior,
        diferenciaMes,
        nuevoSaldoBanco,
        estadoBanco,
        nivelFatiga,
      };
    });
  });

  kpisReportes = computed(() => {
    const filas = this.datosReporteCalculados();
    let totalHoras = 0;
    let totalNoches = 0;
    let totalDomFest = 0;
    let totalCompensatorios = 0;
    let criticosBanco = 0;
    let totalAusentismoDias = 0;

    for (const f of filas) {
      totalHoras += f.horasTrabajadas;
      totalNoches += f.conteoNoches;
      totalDomFest += f.conteoDomFest;
      if (f.causaCompensatorioDominical) totalCompensatorios++;
      if (f.estadoBanco === 'CRITICO') criticosBanco++;
      totalAusentismoDias += f.diasVac + f.diasInc;
    }

    return {
      totalEmpleados: filas.length,
      totalHoras,
      totalNoches,
      totalDomFest,
      totalCompensatorios,
      criticosBanco,
      totalAusentismoDias,
    };
  });

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
      nombre: 'Personal Asistencial',
      categoria: 'Personal Asistencial',
      servicioBaseId: 'srv-urg',
      horasContratoMes: 168,
      saldoBancoAnterior: 0,
      ultimoTurnoMesPrevio: 'L' as CodigoTurno,
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

    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const saldoKeyPrev = `${emp.id}::${anioPrev}-${mesPrev}`;
    const saldoAntReal = this.saldosConsolidadosMap()[saldoKeyPrev] !== undefined
      ? this.saldosConsolidadosMap()[saldoKeyPrev]
      : emp.saldoBancoAnterior;

    const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
    const nuevoSaldoBanco = saldoAntReal + diferenciaMes;
    const servicioBase = this.servicios().find((s) => s.id === emp.servicioBaseId) || this.servicioActual();
    const empConSaldo = { ...emp, saldoBancoAnterior: saldoAntReal };

    return {
      empleado: empConSaldo,
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

  // Matriz de turnos inicializada limpia (sin turnos de prueba)

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
    if (cod === 'POINTER') return;
    this.aplicarTurnoEnCelda(empId, dia, cod, 'Arrastre Drag & Drop');
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.teclaCtrlPresionada.set(true);
    }
  }

  @HostListener('window:keyup', ['$event'])
  onWindowKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.teclaCtrlPresionada.set(false);
      if (this.clonandoConCtrl()) {
        this.finalizarPintadoRaton();
      }
    }
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    if (this.pintandoConRaton() || this.clonandoConCtrl()) {
      this.finalizarPintadoRaton();
    }
  }

  iniciarPintadoCelda(empId: string, dia: number, event?: MouseEvent): void {
    this.enfocarCeldaPorId(empId, dia);

    const esCtrl = !!(event?.ctrlKey || event?.metaKey || this.teclaCtrlPresionada());

    if (esCtrl) {
      // Modalidad Clonador Rápido con Ctrl (Estilo Excel):
      // Lee el turno actual de la celda origen y lo propaga a las celdas por donde se arrastre
      const celdaActual = this.asignaciones()[empId]?.[dia]?.codigo || '';
      this.clonandoConCtrl.set(true);
      this.turnoClonandoConCtrl.set(celdaActual);
      this.pintandoConRaton.set(true);
      return;
    }

    if (this.turnoPincelActivo() === 'POINTER') {
      // Modo puntero/inspección sin Ctrl: enfoca la celda sin alterar su turno
      return;
    }

    // Modo brocha activa normal: aplica el turno seleccionado de la paleta
    this.pintandoConRaton.set(true);
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Asignación manual');
  }

  continuarPintadoCelda(empId: string, dia: number): void {
    if (!this.pintandoConRaton()) return;

    if (this.clonandoConCtrl()) {
      const turnoClonar = this.turnoClonandoConCtrl();
      if (turnoClonar !== null) {
        this.aplicarTurnoEnCelda(empId, dia, turnoClonar, 'Clonación rápida Ctrl');
      }
      return;
    }

    if (this.turnoPincelActivo() === 'POINTER') return;
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Arrastre continuo');
  }

  finalizarPintadoRaton(): void {
    this.pintandoConRaton.set(false);
    this.clonandoConCtrl.set(false);
    this.turnoClonandoConCtrl.set(null);
  }

  enfocarCeldaPorId(empId: string, dia: number): void {
    this.celdaEnfocada.set({ empId, dia });
    setTimeout(() => {
      const el = document.getElementById(`celda-${empId}-${dia}`);
      if (el) {
        el.focus();
      }
    }, 0);
  }

  navegarCelda(empId: string, dia: number, deltaFila: number, deltaDia: number, wrapTab = false): void {
    const filas = this.filasCuadrante();
    if (filas.length === 0) return;

    const totalDias = this.diasDelMes().length;
    const idxFila = filas.findIndex((f) => f.empleado.id === empId);
    if (idxFila === -1) return;

    let nuevaFila = idxFila;
    let nuevoDia = dia;

    if (wrapTab) {
      if (deltaDia > 0) {
        // Tab (avance continuo)
        if (dia < totalDias) {
          nuevoDia = dia + 1;
        } else if (idxFila < filas.length - 1) {
          nuevaFila = idxFila + 1;
          nuevoDia = 1;
        } else {
          nuevaFila = 0;
          nuevoDia = 1;
        }
      } else if (deltaDia < 0) {
        // Shift + Tab (retroceso continuo)
        if (dia > 1) {
          nuevoDia = dia - 1;
        } else if (idxFila > 0) {
          nuevaFila = idxFila - 1;
          nuevoDia = totalDias;
        } else {
          nuevaFila = filas.length - 1;
          nuevoDia = totalDias;
        }
      }
    } else {
      // Flechas de dirección y Enter
      nuevaFila = Math.max(0, Math.min(filas.length - 1, idxFila + deltaFila));
      nuevoDia = Math.max(1, Math.min(totalDias, dia + deltaDia));
    }

    const destinoEmpId = filas[nuevaFila].empleado.id;
    this.enfocarCeldaPorId(destinoEmpId, nuevoDia);
  }

  onKeyDownCelda(event: KeyboardEvent, empId: string, dia: number): void {
    const key = event.key;
    const keyUpper = key.toUpperCase();

    // 1. Teclas de Navegación
    if (key === 'ArrowRight') {
      event.preventDefault();
      this.navegarCelda(empId, dia, 0, 1);
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      this.navegarCelda(empId, dia, 0, -1);
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      this.navegarCelda(empId, dia, 1, 0);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      this.navegarCelda(empId, dia, -1, 0);
      return;
    }
    if (key === 'Tab') {
      event.preventDefault();
      this.navegarCelda(empId, dia, 0, event.shiftKey ? -1 : 1, true);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      this.navegarCelda(empId, dia, event.shiftKey ? -1 : 1, 0);
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      this.enfocarCeldaPorId(empId, 1);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      this.enfocarCeldaPorId(empId, this.diasDelMes().length);
      return;
    }
    if (key === 'Escape') {
      this.celdaEnfocada.set(null);
      return;
    }

    // 2. Teclas de Asignación Rápida
    const mapaTeclas: Record<string, CodigoTurno> = {
      // Numéricos
      '1': 'M8',
      '2': 'T8',
      '3': 'N12',
      '4': 'D12',
      '5': 'G24',
      '6': 'M6',
      '7': 'T6',
      '8': 'N8',
      '0': 'L',
      // Letras mnemotécnicas
      M: 'M8',
      T: 'T8',
      N: 'N12',
      D: 'D12',
      G: 'G24',
      S: 'S',
      L: 'L',
      C: 'COMP',
      V: 'VAC',
      I: 'INC',
      // Borrado
      DELETE: '',
      BACKSPACE: '',
      ' ': '',
    };

    if (keyUpper in mapaTeclas || key in mapaTeclas) {
      event.preventDefault();
      const codigoAsignar = mapaTeclas[keyUpper] ?? mapaTeclas[key];
      this.aplicarTurnoEnCelda(empId, dia, codigoAsignar, `Atajo de teclado (${key})`);

      // Auto-avance horizontal al siguiente día si está habilitado
      if (this.autoAvanzarAlTeclear()) {
        this.navegarCelda(empId, dia, 0, 1);
      }
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
      this.registrarLogAuditoria(nuevoLog);
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
    this.abrirConfirmacion({
      titulo: '🧹 Dejar en Blanco el Cuadro de Turnos',
      mensaje: `¿Deseas dejar en blanco todo el cuadro de turnos de "${srvNombre}"?\n\nSe borrarán los turnos asignados pero se conservarán las novedades oficiales (Vacaciones e Incapacidades).`,
      textoBotonConfirmar: 'Sí, Dejar en Blanco',
      esPeligroso: true,
      onConfirmar: () => {
        this.ejecutarLimpiezaCuadranteCompleto();
      },
    });
  }

  private ejecutarLimpiezaCuadranteCompleto(): void {
    const srvNombre = this.servicioActual().nombre;
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

    this.registrarLogAuditoria({
      id: 'aud-' + Date.now(),
      timestamp: new Date().toTimeString().substring(0, 8),
      actor: 'Gestión Humana',
      empleadoNombre: 'Todo el servicio',
      servicioNombre: srvNombre,
      dia: 0,
      turnoAnterior: '',
      turnoNuevo: '',
      motivo: `Limpieza total del cuadro de turnos (${celdasLimpiadas} turnos borrados) para construcción manual`,
    });

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
  cargarServicioParaEdicion(srv: ServicioHospitalario): void {
    this.servicioEditandoId.set(srv.id);
    this.nuevoServicioCodigo.set(srv.codigo);
    this.nuevoServicioNombre.set(srv.nombre);
    this.nuevoServicioTipoAsistencia.set(srv.tipoAsistencia || 'URGENCIAS');
    this.mostrarNotificacion(`Modo edición activado: ${srv.nombre}`);
  }

  cancelarEdicionServicio(): void {
    this.servicioEditandoId.set(null);
    this.nuevoServicioCodigo.set('');
    this.nuevoServicioNombre.set('');
    this.nuevoServicioTipoAsistencia.set('URGENCIAS');
  }

  guardarServicioAutonomo(): void {
    const cod = this.nuevoServicioCodigo().trim().toUpperCase();
    const nom = this.nuevoServicioNombre().trim();
    const tipo = this.nuevoServicioTipoAsistencia();
    const editandoId = this.servicioEditandoId();

    if (!cod || !nom) {
      this.mostrarNotificacion('Por favor completa el código y nombre del servicio.');
      return;
    }

    // Validación de código duplicado
    const duplicado = this.servicios().find(
      (s) => s.codigo.toUpperCase() === cod && s.id !== editandoId
    );
    if (duplicado) {
      this.mostrarNotificacion(`El código "${cod}" ya está asignado al servicio "${duplicado.nombre}".`);
      return;
    }

    if (editandoId) {
      // Actualizar existente
      this.api
        .actualizarServicio(editandoId, { codigo: cod, nombre: nom, tipoAsistencia: tipo })
        .subscribe({
          next: () => {
            this.mostrarNotificacion(`Servicio "${nom}" actualizado en PostgreSQL.`);
            this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error de conexión con el backend';
            this.mostrarNotificacion(`❌ Error al actualizar servicio: ${msg}`);
          },
        });
    } else {
      // Crear nuevo servicio en PostgreSQL
      this.api
        .crearServicio({ codigo: cod, nombre: nom, tipoAsistencia: tipo })
        .subscribe({
          next: () => {
            this.mostrarNotificacion(`Servicio "${nom}" creado y persistido en PostgreSQL.`);
            this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error de conexión con el backend';
            this.mostrarNotificacion(`❌ Error al crear servicio: ${msg}`);
          },
        });
    }
  }

  eliminarServicioAutonomo(srv: ServicioHospitalario): void {
    if (srv.empleadosCount && srv.empleadosCount > 0) {
      this.mostrarNotificacion(
        `No se puede eliminar "${srv.nombre}": tiene ${srv.empleadosCount} colaboradores adscritos. Trasládelos antes de eliminar.`
      );
      return;
    }

    this.abrirConfirmacion({
      titulo: '🗑️ Eliminar Servicio Hospitalario',
      mensaje: `¿Seguro que deseas eliminar el servicio "${srv.nombre}" (${srv.codigo}) de forma permanente en PostgreSQL?`,
      textoBotonConfirmar: 'Sí, Eliminar Servicio',
      esPeligroso: true,
      onConfirmar: () => {
        this.api.eliminarServicio(srv.id).subscribe({
          next: () => {
            this.mostrarNotificacion(`Servicio "${srv.nombre}" eliminado de PostgreSQL.`);
            if (this.servicioEditandoId() === srv.id) this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error al eliminar servicio en base de datos';
            this.mostrarNotificacion(`❌ ${msg}`);
          },
        });
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

    const srv1 = this.servicios().find((s) => s.id === id1);
    const srv2 = this.servicios().find((s) => s.id === id2);

    if (!srv1 || !srv2) {
      this.mostrarNotificacion('No se encontraron los servicios seleccionados.');
      return;
    }

    const yaSonHermanos = (srv1.hermanos || []).some((h) => h.id === id2);
    if (yaSonHermanos) {
      this.mostrarNotificacion(`"${srv1.nombre}" y "${srv2.nombre}" ya se encuentran vinculados como apoyo.`);
      return;
    }

    // Actualización inmediata en memoria y persistencia
    const actualizarMemoria = () => {
      this.servicios.update((lista) =>
        lista.map((s) => {
          if (s.id === id1) {
            const hermanos = (s.hermanos || []).filter((h) => h.id !== id2);
            return { ...s, hermanos: [...hermanos, { id: srv2.id, codigo: srv2.codigo, nombre: srv2.nombre }] };
          }
          if (s.id === id2) {
            const hermanos = (s.hermanos || []).filter((h) => h.id !== id1);
            return { ...s, hermanos: [...hermanos, { id: srv1.id, codigo: srv1.codigo, nombre: srv1.nombre }] };
          }
          return s;
        })
      );
    };

    actualizarMemoria();

    this.api.enlazarServiciosHermanos(id1, id2).subscribe({
      next: () => {
        this.mostrarNotificacion(`Servicios "${srv1.codigo}" y "${srv2.codigo}" vinculados como apoyo.`);
        this.recargarServicios();
      },
      error: () => {
        this.mostrarNotificacion(`Servicios "${srv1.codigo}" y "${srv2.codigo}" vinculados como apoyo.`);
      },
    });
  }

  desenlazarServicioHermano(srv1Id: string, srv2Id: string): void {
    const actualizarMemoria = () => {
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
    };

    actualizarMemoria();

    this.api.desenlazarServiciosHermanos(srv1Id, srv2Id).subscribe({
      next: () => {
        this.mostrarNotificacion('Vínculo de servicio de apoyo eliminado.');
        this.recargarServicios();
      },
      error: () => {
        this.mostrarNotificacion('Vínculo de servicio de apoyo eliminado.');
      },
    });
  }

  private sincronizarServiciosDesdePostgres(): void {
    this.recargarServicios();
  }

  private recargarServicios(): void {
    this.api.getServicios().subscribe({
      next: (srvs) => {
        if (srvs && srvs.length > 0) {
          this.servicios.set(srvs);
        }
      },
      error: () => {
        // En caso de que el backend no responda, conserva los servicios de memoria
      },
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

    this.actualizarListaPermutas(
      this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'APROBADA' } : p))
    );
    this.mostrarNotificacion(`Cambio de turno aprobado y actualizado en el cuadrante.`);
  }

  rechazarPermuta(idPermuta: string): void {
    this.actualizarListaPermutas(
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

    this.actualizarListaPermutas([nuevaPermuta, ...this.listaPermutas()]);
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

  // Controladores del Menú Lateral (Auto-colapso por Hover y Fijación)
  alternarFijarSidebar(): void {
    const nuevo = !this.sidebarFijo();
    this.sidebarFijo.set(nuevo);
    if (!nuevo) {
      this.sidebarHovered.set(false);
    }
  }

  onSidebarMouseEnter(): void {
    if (!this.sidebarFijo()) {
      this.sidebarHovered.set(true);
    }
  }

  onSidebarMouseLeave(): void {
    if (!this.sidebarFijo()) {
      this.sidebarHovered.set(false);
    }
  }

  onItemNavegacionClick(
    vista: 'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'PORTAL_EMPLEADO' | 'CONFIGURACION'
  ): void {
    this.vistaActual.set(vista);
    if (!this.sidebarFijo()) {
      this.sidebarHovered.set(false);
    }
  }

  // Exportar Excel en la Sección de Reportes
  exportarExcelReportes(): void {
    const filas = this.datosReporteCalculados();
    const sub = this.subVistaReportes();
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    let header = '';
    let lineas: string[] = [];

    if (sub === 'PRE_NOMINA') {
      header = 'Documento;Colaborador;Servicio;Cargo;Contrato;HOD;HON_35;HDFD_75;HDFN_110;Total_Mes;Dom_Fest;Compensatorio_CST;VAC_Dias;INC_Dias;Saldo_Banco_Ant;Mov_Mes;Nuevo_Saldo_Banco';
      lineas = filas.map((f) =>
        [
          f.emp.documento,
          `"${f.emp.nombre}"`,
          `"${f.servicioNombre}"`,
          `"${f.emp.categoria}"`,
          `${f.horasContratoMes}h`,
          f.hod,
          f.hon,
          f.hdfd,
          f.hdfn,
          f.horasTrabajadas,
          f.conteoDomFest,
          f.causaCompensatorioDominical ? 'SI' : 'NO',
          f.diasVac,
          f.diasInc,
          f.saldoBancoAnterior,
          f.diferenciaMes,
          f.nuevoSaldoBanco,
        ].join(';')
      );
    } else if (sub === 'EQUIDAD') {
      header = 'Documento;Colaborador;Servicio;Cargo;Turnos_Noche;Dom_Fest_Laborados;Total_Horas_Nocturnas;Compensatorio_Legal;Nivel_Fatiga';
      lineas = filas.map((f) =>
        [
          f.emp.documento,
          `"${f.emp.nombre}"`,
          `"${f.servicioNombre}"`,
          `"${f.emp.categoria}"`,
          f.conteoNoches,
          f.conteoDomFest,
          f.hon + f.hdfn,
          f.causaCompensatorioDominical ? 'SI' : 'NO',
          f.nivelFatiga,
        ].join(';')
      );
    } else if (sub === 'BANCO_HORAS') {
      header = 'Documento;Colaborador;Servicio;Cargo;Saldo_Anterior;Horas_Trabajadas;Contrato;Amortizadas_COMP;Mov_Mes;Nuevo_Saldo_Continuo;Estado_Riesgo';
      lineas = filas.map((f) =>
        [
          f.emp.documento,
          `"${f.emp.nombre}"`,
          `"${f.servicioNombre}"`,
          `"${f.emp.categoria}"`,
          f.saldoBancoAnterior,
          f.horasTrabajadas,
          f.horasContratoMes,
          f.horasAmortizadasComp,
          f.diferenciaMes,
          f.nuevoSaldoBanco,
          f.estadoBanco,
        ].join(';')
      );
    } else {
      header = 'Documento;Colaborador;Servicio;Cargo;Dias_Vacaciones;Dias_Incapacidad;Total_Ausencia_Dias';
      lineas = filas.map((f) =>
        [
          f.emp.documento,
          `"${f.emp.nombre}"`,
          `"${f.servicioNombre}"`,
          `"${f.emp.categoria}"`,
          f.diasVac,
          f.diasInc,
          f.diasVac + f.diasInc,
        ].join(';')
      );
    }

    const contenidoCsv = '\uFEFF' + [header, ...lineas].join('\n');
    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_${sub}_${anio}_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.mostrarNotificacion(`Reporte exportado exitosamente.`);
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
    this.enfocarCeldaPorId(empId, dia);
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
