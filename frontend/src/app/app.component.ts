import { Component, computed, HostListener, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CATALOGO_TURNOS,
  CeldaAsignacion,
  CodigoTurno,
  CambioCeldaHistorial,
  EmpleadoHospital,
  DiaColumna,
  FestivoEntry,
  ModalConfirmacionConfig,
  ModalidadDiasServicio,
  PasoHistorialEdicion,
  PermutaItem,
  ReglaCargoServicio,
  RegistroAuditoria,
  RolUsuarioSso,
  ServicioHospitalario,
  SesionUsuarioSso,
  TipoTurnoConfig,
} from './models';
import { TurnosApiService } from './turnos-api.service';
import { FestivosColombiaHelper } from './festivos-colombia.helper';
import {
  calcularMetricasMesColaborador,
  guardarStorageSeguro,
  leerStorageSeguro,
} from './calculo-turnos.helper';

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
  enlaceIcalHttp = signal<string>('');
  enlaceIcalWebcal = signal<string>('');
  enlaceIcalEmpleadoNombre = signal<string>('');
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
  nuevoServicioModalidadDias = signal<ModalidadDiasServicio>('TODOS_24_7');
  nuevoServicioReqManana = signal<number>(4);
  nuevoServicioReqTarde = signal<number>(4);
  nuevoServicioReqNoche = signal<number>(2);
  nuevoServicioReqMananaFds = signal<number>(2);
  nuevoServicioReqTardeFds = signal<number>(2);
  nuevoServicioReqNocheFds = signal<number>(1);
  nuevoServicioTurnosHabilitados = signal<string[]>([
    'M8',
    'T8',
    'N8',
    'D12',
    'G24',
    'S',
    'L',
    'COMP',
    'VAC',
    'INC',
  ]);
  nuevoServicioReglasPorCargo = signal<ReglaCargoServicio[]>([]);
  enlaceHermanoSrv1 = signal<string>('srv-urg');
  enlaceHermanoSrv2 = signal<string>('srv-mat');

  // Catálogos reactivos cargados desde la Base de Datos
  servicios = signal<ServicioHospitalario[]>([]);
  empleados = signal<EmpleadoHospital[]>([]);
  empleadosRotadosPorServicio = signal<Record<string, string[]>>(this.cargarRotadosDesdeStorage());
  catalogoTurnosMap = signal<Record<string, TipoTurnoConfig>>({ ...CATALOGO_TURNOS });

  // Lista maestra del catálogo (sin los alias duplicados M, T, N, G12 ni el marcador interno BLANCO)
  listaTurnosCatalogo = computed<TipoTurnoConfig[]>(() => {
    const aliasOcultos = new Set(['M', 'T', 'N', 'G12', 'BLANCO']);
    return Object.values(this.catalogoTurnosMap()).filter(
      (t) => !aliasOcultos.has(t.codigo)
    );
  });

  // Turnos visibles en la Paleta del Cuadro de Turnos (filtrados por el servicio activo y el cargo filtrado si aplica)
  listaTurnosPaleta = computed<TipoTurnoConfig[]>(() => {
    const srv = this.servicioActual();
    const filtroCat = this.filtroCategoriaActiva();
    const reglaCat =
      filtroCat !== 'TODAS'
        ? (srv?.reglasPorCargo || []).find((r) => r.categoriaNombre === filtroCat)
        : undefined;

    const listaCodigosBase =
      reglaCat?.turnosHabilitados && reglaCat.turnosHabilitados.length > 0
        ? reglaCat.turnosHabilitados
        : srv?.turnosHabilitados && srv.turnosHabilitados.length > 0
          ? srv.turnosHabilitados
          : null;

    const habilitadosSrv = listaCodigosBase
      ? new Set(listaCodigosBase.map((c) => c.toUpperCase()))
      : null;
    const codigosBaseDescanso = new Set(['L', 'S', 'COMP', 'VAC', 'INC', 'LIC']);

    return this.listaTurnosCatalogo().filter((t) => {
      if (t.visibleEnPaleta === false) return false;
      if (!habilitadosSrv) return true;
      return habilitadosSrv.has(t.codigo.toUpperCase()) || codigosBaseDescanso.has(t.codigo.toUpperCase());
    });
  });

  // Formulario de Creación / Edición de Turnos en Catálogo de Turnos
  turnoEditandoCodigo = signal<string | null>(null);
  turnoFormCodigo = signal<string>('');
  turnoFormNombre = signal<string>('');
  turnoFormModoJornada = signal<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>('HORARIO');
  turnoFormHoraInicio = signal<string>('07:00');
  turnoFormHoraFin = signal<string>('15:00');
  turnoFormMinutosAlmuerzo = signal<number>(0);
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
    { key: 'LAVANDA_LIC', nombre: 'Lavanda Licencia', bgHex: '#E0E7FF', textHex: '#3730A3', borderHex: '#C7D2FE' },
    { key: 'GRIS_ADMIN', nombre: 'Gris Neutro', bgHex: '#F3F4F6', textHex: '#374151', borderHex: '#D1D5DB' },
  ];

  // Cálculo automático de horas Ordinarias, Diurnas (06:00-19:00) y Nocturnas (19:00-06:00) - Ley 2466 / CST Art. 160 y Art. 167 (Almuerzo)
  calculoAutomaticoHorasTurno = computed<{
    ordinarias: number;
    diurnas: number;
    nocturnas: number;
    minutosAlmuerzo: number;
    horarioTexto: string;
  }>(() => {
    const modo = this.turnoFormModoJornada();
    if (modo === 'DESCANSO') {
      return {
        ordinarias: 0,
        diurnas: 0,
        nocturnas: 0,
        minutosAlmuerzo: 0,
        horarioTexto: 'Descanso / Novedad',
      };
    }
    if (modo === 'GUARDIA_24H') {
      const ini = this.turnoFormHoraInicio() || '07:00';
      return {
        ordinarias: 24,
        diurnas: 13,
        nocturnas: 11,
        minutosAlmuerzo: 0,
        horarioTexto: `${ini} - ${ini} (+1)`,
      };
    }

    const iniStr = this.turnoFormHoraInicio() || '07:00';
    const finStr = this.turnoFormHoraFin() || '15:00';
    const minAlmuerzo = Math.max(0, Number(this.turnoFormMinutosAlmuerzo()) || 0);
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

    // Descuento legal de descanso intermedio / almuerzo no computable (Art. 167 CST), priorizando la franja diurna
    let descuentoRestante = Math.min(minAlmuerzo, minDiurnos + minNocturnos);
    const descDiurno = Math.min(minDiurnos, descuentoRestante);
    minDiurnos -= descDiurno;
    descuentoRestante -= descDiurno;
    if (descuentoRestante > 0) {
      minNocturnos = Math.max(0, minNocturnos - descuentoRestante);
    }

    const diurnas = Math.round((minDiurnos / 60) * 10) / 10;
    const nocturnas = Math.round((minNocturnos / 60) * 10) / 10;
    const ordinarias = Math.round(((minDiurnos + minNocturnos) / 60) * 10) / 10;

    return {
      ordinarias,
      diurnas,
      nocturnas,
      minutosAlmuerzo: minAlmuerzo,
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

  // Portal del Empleado (Autoservicio) y Sesión SSO de Intranet
  empleadoPortalId = signal<string>('emp-001');
  diaPermutaSeleccionado = signal<number>(10);
  companeroPermutaId = signal<string>('emp-002');
  sesionActual = signal<SesionUsuarioSso | null>(null);
  verificandoSesionSso = signal<boolean>(true);
  intranetReturnUrl = signal<string>('http://localhost:4300');

  rolActual = computed<RolUsuarioSso>(() => this.sesionActual()?.rol || 'COLABORADOR');
  esColaborador = computed<boolean>(() => this.rolActual() === 'COLABORADOR');
  esCoordinador = computed<boolean>(() => this.rolActual() === 'COORDINADOR');
  esAdminTh = computed<boolean>(() => this.rolActual() === 'ADMIN_TH');

  // Servicios autorizados según el rol de la sesión SSO activa
  serviciosVisibles = computed<ServicioHospitalario[]>(() => {
    const todos = this.servicios();
    const sesion = this.sesionActual();
    if (!sesion || sesion.rol === 'ADMIN_TH') {
      return todos;
    }
    const permitidos = new Set(sesion.serviciosPermitidosIds || [sesion.servicioBaseId]);
    const filtrados = todos.filter((s) => permitidos.has(s.id));
    return filtrados.length > 0 ? filtrados : todos;
  });

  // Permutas visibles en la vista de Solicitudes según el rol activo
  permutasVisiblesDashboard = computed<PermutaItem[]>(() => {
    const todas = this.listaPermutas();
    const sesion = this.sesionActual();
    if (!sesion || sesion.rol === 'ADMIN_TH') {
      return todas;
    }
    if (sesion.rol === 'COORDINADOR') {
      const permitidos = new Set(sesion.serviciosPermitidosIds || [sesion.servicioBaseId]);
      return todas.filter(
        (p) =>
          !p.servicioId ||
          permitidos.has(p.servicioId) ||
          p.solicitanteId === sesion.empleadoId ||
          p.receptorId === sesion.empleadoId
      );
    }
    // COLABORADOR: solo ve las solicitudes donde participa
    return todas.filter(
      (p) => p.solicitanteId === sesion.empleadoId || p.receptorId === sesion.empleadoId
    );
  });

  // Mapa de Saldos Consolidados de Banco de Horas (PostgreSQL)
  saldosConsolidadosMap = signal<Record<string, number>>({});

  // Solicitudes de Permuta 1-a-1 (Persistidas localmente sin datos residuales de prueba)
  listaPermutas = signal<PermutaItem[]>(this.cargarPermutasDesdeStorage());

  // Bitácora de Auditoría Médico-Legal (Persistida de forma centralizada en PostgreSQL)
  bitacoraAuditoria = signal<RegistroAuditoria[]>([]);

  // Pilas de Deshacer (Ctrl+Z) y Rehacer (Ctrl+Y) en el Planificador
  pilaDeshacer = signal<PasoHistorialEdicion[]>([]);
  pilaRehacer = signal<PasoHistorialEdicion[]>([]);
  private loteArrastreActual: CambioCeldaHistorial[] = [];

  // Novedades y Ausencias Oficiales desde Intranet Hospitalaria
  sincronizandoNovedades = signal<boolean>(false);
  listaNovedades = signal<any[]>([]);
  ultimaSincronizacionIntranet = signal<string>('');

  constructor(private readonly api: TurnosApiService) {}

  ngOnInit(): void {
    this.inicializarSesionSsoDesdeUrlOStorage();
  }

  private inicializarSesionSsoDesdeUrlOStorage(): void {
    try {
      const params = new URLSearchParams(window.location.search);
      const ssoToken = params.get('sso_token');

      if (ssoToken) {
        // Limpiar el token de la barra de direcciones por seguridad
        const urlLimpia = window.location.pathname + window.location.hash;
        window.history.replaceState({}, document.title, urlLimpia);

        this.api.intercambiarTokenSso(ssoToken).subscribe({
          next: (res) => {
            try {
              sessionStorage.setItem('rafa_turnos_sso_jwt', res.sessionToken);
            } catch {}
            if (res.intranetReturnUrl) {
              this.intranetReturnUrl.set(res.intranetReturnUrl);
              try {
                sessionStorage.setItem('rafa_turnos_intranet_url', res.intranetReturnUrl);
              } catch {}
            }
            this.aplicarContextoSesionSso(res.usuario);
            this.verificandoSesionSso.set(false);

            // Cargar datos institucionales con el token de sesión ya fijado
            this.cargarDatosDesdeBaseDeDatos();

            if (res.usuario.rol === 'ADMIN_TH' || res.usuario.rol === 'COORDINADOR') {
              this.sincronizacionAutomaticaIntranet(true);
            }

            this.mostrarNotificacion(
              `Sesión SSO iniciada: ${res.usuario.nombre} (${this.etiquetaRol(res.usuario.rol)})`
            );
          },
          error: (err) => {
            this.verificandoSesionSso.set(false);
            const msg = err?.error?.message || 'Token SSO inválido o expirado.';
            this.mostrarNotificacion(`❌ Error de autenticación SSO: ${msg}`);
          },
        });
        return;
      }

      const tokenGuardado = sessionStorage.getItem('rafa_turnos_sso_jwt');
      if (tokenGuardado) {
        this.api.obtenerSesionSso(tokenGuardado).subscribe({
          next: (res) => {
            if (res.intranetReturnUrl) {
              this.intranetReturnUrl.set(res.intranetReturnUrl);
              try {
                sessionStorage.setItem('rafa_turnos_intranet_url', res.intranetReturnUrl);
              } catch {}
            }
            this.aplicarContextoSesionSso(res.usuario);
            this.verificandoSesionSso.set(false);

            // Cargar datos institucionales con la sesión verificada
            this.cargarDatosDesdeBaseDeDatos();

            if (res.usuario.rol === 'ADMIN_TH' || res.usuario.rol === 'COORDINADOR') {
              this.sincronizacionAutomaticaIntranet(true);
            }
          },
          error: () => {
            try {
              sessionStorage.removeItem('rafa_turnos_sso_jwt');
            } catch {}
            this.verificandoSesionSso.set(false);
            const destino = this.intranetReturnUrl();
            if (destino) {
              window.location.href = destino;
            }
          },
        });
        return;
      }

      this.verificandoSesionSso.set(false);
      // Sin sesión activa: redirigir automáticamente al portal de la Intranet Hospitalaria
      const destino = this.intranetReturnUrl();
      if (destino) {
        window.location.href = destino;
      }
    } catch {
      this.verificandoSesionSso.set(false);
    }
  }

  private aplicarContextoSesionSso(usuario: SesionUsuarioSso): void {
    this.sesionActual.set(usuario);
    this.empleadoPortalId.set(usuario.empleadoId);
    this.servicioSeleccionadoId.set(usuario.servicioBaseId);

    const emps = this.empleados();
    const primerPar = emps.find(
      (e) =>
        e.id !== usuario.empleadoId &&
        e.servicioBaseId === usuario.servicioBaseId &&
        e.categoria === usuario.categoria
    );
    if (primerPar) {
      this.companeroPermutaId.set(primerPar.id);
    }

    if (usuario.rol === 'COLABORADOR') {
      this.vistaActual.set('PORTAL_EMPLEADO');
    } else if (usuario.rol === 'COORDINADOR') {
      this.filtroReporteServicioId.set(usuario.servicioBaseId);
      if (this.vistaActual() === 'CONFIGURACION') {
        this.vistaActual.set('PLANIFICADOR');
      }
    } else {
      this.filtroReporteServicioId.set('TODOS');
    }
  }

  etiquetaRol(rol: RolUsuarioSso): string {
    if (rol === 'ADMIN_TH') return 'Talento Humano / Admin';
    if (rol === 'COORDINADOR') return 'Coordinador de Servicio';
    return 'Colaborador Asistencial';
  }

  private cargarPermutasDesdeStorage(): PermutaItem[] {
    return leerStorageSeguro<PermutaItem[]>('rafa_turnos_permutas', []);
  }

  private guardarPermutasEnStorage(lista: PermutaItem[]): void {
    guardarStorageSeguro('rafa_turnos_permutas', lista);
  }

  private cargarRotadosDesdeStorage(): Record<string, string[]> {
    return leerStorageSeguro<Record<string, string[]>>('rafa_turnos_rotados_servicio', {});
  }

  private guardarRotadosEnStorage(mapa: Record<string, string[]>): void {
    guardarStorageSeguro('rafa_turnos_rotados_servicio', mapa);
  }

  private actualizarListaPermutas(lista: PermutaItem[]): void {
    this.listaPermutas.set(lista);
    this.guardarPermutasEnStorage(lista);
  }

  sincronizarAuditoriasDesdePostgres(): void {
    const srvId = this.servicioSeleccionadoId();
    this.api.obtenerAuditorias(srvId).subscribe({
      next: (logs) => {
        this.bitacoraAuditoria.set(logs || []);
        try {
          localStorage.removeItem('rafa_turnos_auditoria');
        } catch {}
      },
      error: () => {},
    });
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
    // Carga directa desde la Base de Datos PostgreSQL (Única fuente de verdad institucional)
    this.sincronizarServiciosDesdePostgres();
    this.sincronizarCatalogoTurnosDesdePostgres();
    this.sincronizarEmpleadosDesdePostgres();
    this.sincronizarFestivosDesdePostgres();
    this.sincronizarCuadrantesDesdePostgres();
    this.sincronizarPermutasDesdePostgres();
    this.sincronizarNovedadesDesdePostgres();
    this.sincronizarAuditoriasDesdePostgres();
  }

  sincronizarNovedadesDesdePostgres(): void {
    this.api.getNovedades(this.anioSeleccionado(), this.mesSeleccionado()).subscribe({
      next: (novedadesDb) => {
        if (Array.isArray(novedadesDb)) {
          this.listaNovedades.set(novedadesDb);
        }
      },
      error: () => {},
    });
  }

  /**
   * Sincronización Automática y Transparente con la Intranet Hospitalaria
   * - En segundo plano (silencioso = true) se ejecuta al iniciar la app o cambiar de mes.
   * - Manual (silencioso = false) se ejecuta cuando el usuario pulsa 'Refrescar Intranet'.
   */
  sincronizacionAutomaticaIntranet(silencioso = true): void {
    if (this.sincronizandoNovedades()) return;
    this.sincronizandoNovedades.set(true);

    if (!silencioso) {
      this.mostrarNotificacion('⏳ Conectando con Intranet Hospitalaria para actualizar censo y novedades...');
    }

    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();

    // 1. Sincronizar Censo Maestro de Empleados (nuevas altas, traslados o cambios de contrato)
    this.api.sincronizarEmpleadosIntranet().subscribe({
      next: (resEmp) => {
        if (resEmp && resEmp.creados > 0) {
          this.sincronizarEmpleadosDesdePostgres();
        }
      },
      error: () => {},
    });

    // 2. Sincronizar Novedades y Ausencias Oficiales del periodo
    this.api.sincronizarNovedadesIntranet(anio, mes).subscribe({
      next: (res) => {
        this.sincronizandoNovedades.set(false);
        const horaActual = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        this.ultimaSincronizacionIntranet.set(horaActual);

        if (res && res.ok) {
          this.sincronizarNovedadesDesdePostgres();
          this.sincronizarCuadrantesDesdePostgres();
          if (!silencioso) {
            this.mostrarNotificacion(
              `✅ Intranet al día (${horaActual}): ${res.totalSincronizadas} ausencias aplicadas (${res.celdasBloqueadas} días protegidos).`
            );
          }
        }
      },
      error: (err) => {
        this.sincronizandoNovedades.set(false);
        if (!silencioso) {
          const msg = err.error?.message || err.message || 'Error de conexión con Intranet';
          this.mostrarNotificacion(`⛔ No se pudo conectar con Intranet: ${msg}`);
        }
      },
    });
  }

  sincronizarNovedadesIntranet(): void {
    this.sincronizacionAutomaticaIntranet(false);
  }

  private sincronizarPermutasDesdePostgres(): void {
    this.api.getPermutas().subscribe({
      next: (permutasDb) => {
        if (Array.isArray(permutasDb)) {
          this.listaPermutas.set(permutasDb);
        }
      },
      error: () => {},
    });
  }

  private sincronizarEmpleadosDesdePostgres(): void {
    this.api.getEmpleados().subscribe({
      next: (empsDb) => {
        if (!Array.isArray(empsDb) || empsDb.length === 0) return;
        const emps = this.mapearEmpleadosDesdeBackend(empsDb);
        this.empleados.set(emps);
        this.inicializarMatrizCuadrante(emps);

        // Si hay sesión SSO activa, fijar el portal en el empleado autenticado
        const sesion = this.sesionActual();
        if (sesion && emps.some((e) => e.id === sesion.empleadoId)) {
          this.empleadoPortalId.set(sesion.empleadoId);
          const primerPar = emps.find(
            (e) =>
              e.id !== sesion.empleadoId &&
              e.servicioBaseId === sesion.servicioBaseId &&
              e.categoria === sesion.categoria
          );
          this.companeroPermutaId.set(primerPar?.id || sesion.empleadoId);
        } else if (!emps.some((e) => e.id === this.empleadoPortalId())) {
          const empInicial = emps.find((e) => e.servicioBaseId === 'srv-urg') || emps[0];
          this.empleadoPortalId.set(empInicial.id);
          const primerPar = emps.find(
            (e) => e.id !== empInicial.id && e.servicioBaseId === empInicial.servicioBaseId && e.categoria === empInicial.categoria
          );
          this.companeroPermutaId.set(primerPar?.id || empInicial.id);
        }
      },
      error: () => {
        // En caso de reconexión del servidor, conserva el censo previo en memoria
      },
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
    this.asignacionesPorPeriodo.update((actual) => {
      const porPeriodo = { ...actual };
      for (const m of this.mesesDisponibles) {
        const key = `${anio}-${m.valor}`;
        const mapaMes = { ...(porPeriodo[key] || {}) };
        emps.forEach((emp) => {
          if (!mapaMes[emp.id]) {
            mapaMes[emp.id] = {};
          }
        });
        porPeriodo[key] = mapaMes;
      }
      return porPeriodo;
    });
  }

  private sincronizarCatalogoTurnosDesdePostgres(): void {
    this.api.getTiposTurno().subscribe({
      next: (turnosDb) => {
        if (!Array.isArray(turnosDb) || turnosDb.length === 0) return;
        this.catalogoTurnosMap.update((actual) => {
          const copia = { ...actual };
          for (const t of turnosDb) {
            const cod = (t.codigo || '').toUpperCase();
            if (!cod || cod === 'BLANCO') continue;
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
              minutosAlmuerzo: Number(t.minutosAlmuerzo ?? existente?.minutosAlmuerzo ?? 0),
              bgHex: t.colorHex || existente?.bgHex || tema.bgHex,
              textHex: existente?.textHex || tema.textHex,
              borderHex: existente?.borderHex || tema.borderHex,
              esAusencia: existente?.esAusencia ?? (cod === 'VAC' || cod === 'INC'),
              esNocturnoPesado: Boolean(
                t.esNocturnoPesado ?? existente?.esNocturnoPesado ?? cod === 'G24'
              ),
              descuentaBancoHoras: !!(t.descuentaBancoHoras ?? existente?.descuentaBancoHoras),
              visibleEnPaleta: ['M', 'T', 'N', 'G12'].includes(cod)
                ? false
                : t.visibleEnPaleta !== undefined
                  ? Boolean(t.visibleEnPaleta)
                  : existente?.visibleEnPaleta ?? true,
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

          // Auto-descubrir personal de apoyo con asignaciones persistidas en PostgreSQL
          const mapaRot = { ...this.empleadosRotadosPorServicio() };
          let huboNuevosRotados = false;
          for (const [, mapaEmpsDb] of Object.entries(res.asignacionesPorPeriodo)) {
            for (const [empId, diasDb] of Object.entries(mapaEmpsDb)) {
              for (const celdaDb of Object.values(diasDb)) {
                if (celdaDb.esRotacion && celdaDb.servicioEjecutorId) {
                  const srvEje = celdaDb.servicioEjecutorId;
                  const lista = mapaRot[srvEje] || [];
                  if (!lista.includes(empId)) {
                    mapaRot[srvEje] = [...lista, empId];
                    huboNuevosRotados = true;
                  }
                }
              }
            }
          }
          if (huboNuevosRotados) {
            this.empleadosRotadosPorServicio.set(mapaRot);
            this.guardarRotadosEnStorage(mapaRot);
          }
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

  // Empleados totales del servicio actual sin filtro de categoría (Planta + Rotados homólogos / Apoyo)
  empleadosServicioSinFiltro = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const srvId = this.servicioSeleccionadoId();
    const todos = this.empleados();
    const idsRotados = new Set(this.empleadosRotadosPorServicio()[srvId] || []);

    // Incluir también cualquier colaborador que tenga turnos asignados en este servicio durante el periodo
    const matriz = this.asignaciones();
    for (const emp of todos) {
      if (emp.servicioBaseId !== srvId && !idsRotados.has(emp.id)) {
        const celdasEmp = matriz[emp.id];
        if (celdasEmp) {
          const tieneTurnoEnServicio = Object.values(celdasEmp).some(
            (c) => c && c.codigo && c.codigo !== '' && (c.servicioEjecutorId === srvId || c.esRotacion)
          );
          if (tieneTurnoEnServicio) {
            idsRotados.add(emp.id);
          }
        }
      }
    }

    const propios = todos
      .filter((e) => e.servicioBaseId === srvId)
      .map((emp) => ({ emp, esRotado: false }));

    const rotados = todos
      .filter((e) => e.servicioBaseId !== srvId && idsRotados.has(e.id))
      .map((emp) => ({ emp, esRotado: true }));

    return [...propios, ...rotados].sort((a, b) => {
      const cmpCat = a.emp.categoria.localeCompare(b.emp.categoria);
      if (cmpCat !== 0) return cmpCat;
      return a.emp.nombre.localeCompare(b.emp.nombre);
    });
  });

  // Empleados del cuadrante filtrados por la categoría seleccionada en la interfaz
  empleadosDelCuadrante = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const lista = this.empleadosServicioSinFiltro();
    const filtroCat = this.filtroCategoriaActiva();
    if (filtroCat !== 'TODAS') {
      return lista.filter((item) => item.emp.categoria === filtroCat);
    }
    return lista;
  });

  // Conteo de filas por categoría para los separadores de grupo del cuadrante
  conteoPorCategoriaCuadrante = computed<Record<string, number>>(() => {
    const conteo: Record<string, number> = {};
    for (const { emp } of this.empleadosDelCuadrante()) {
      conteo[emp.categoria] = (conteo[emp.categoria] || 0) + 1;
    }
    return conteo;
  });

  /**
   * Obtiene dinámicamente el turno asignado en el último día del mes inmediatamente anterior
   * (ej. día 31 de Octubre para Noviembre, o día 31 de Diciembre de anio-1 para Enero).
   */
  obtenerUltimoTurnoMesPrevio(empId: string, fallback: CodigoTurno = 'L'): CodigoTurno {
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const ultimoDiaPrev = new Date(anioPrev, mesPrev, 0).getDate();
    const periodoPrevKey = `${anioPrev}-${mesPrev}`;
    const codPrev = this.asignacionesPorPeriodo()[periodoPrevKey]?.[empId]?.[ultimoDiaPrev]?.codigo;
    return (codPrev || fallback) as CodigoTurno;
  }

  // Filas calculadas completas de todo el servicio (sin filtro visual de categoría), usadas para Cierre de Nómina y Exportación
  filasServicioCompletas = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const listaEmp = this.empleadosServicioSinFiltro();
    const catalogo = this.catalogoTurnosMap();
    const saldos = this.saldosConsolidadosMap();
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();

    return listaEmp.map(({ emp, esRotado }) => {
      const celdasEmp = matriz[emp.id] || {};
      const metricas = calcularMetricasMesColaborador(
        emp,
        celdasEmp,
        dias,
        catalogo,
        saldos,
        anio,
        mes
      );
      const ultimoTurnoPrevReal = this.obtenerUltimoTurnoMesPrevio(
        emp.id,
        emp.ultimoTurnoMesPrevio || 'L'
      );
      const empConSaldo = {
        ...emp,
        saldoBancoAnterior: metricas.saldoAntReal,
        ultimoTurnoMesPrevio: ultimoTurnoPrevReal,
      };

      return {
        empleado: empConSaldo,
        esPersonalRotado: esRotado,
        celdas: celdasEmp,
        ...metricas,
      };
    });
  });

  // Filas visibles en el cuadrante respetando el filtro de categoría activo
  filasCuadrante = computed(() => {
    const todas = this.filasServicioCompletas();
    const filtroCat = this.filtroCategoriaActiva();
    if (filtroCat !== 'TODAS') {
      return todas.filter((f) => f.empleado.categoria === filtroCat);
    }
    return todas;
  });

  /**
   * Determina qué franjas asistenciales (Mañana, Tarde, Noche) cubre un tipo de turno
   * a partir de su duración y rango horario (horaInicio / horaFin), incluyendo guardias de 12h y 24h.
   */
  private clasificarFranjasTurno(cfg?: TipoTurnoConfig): {
    manana: boolean;
    tarde: boolean;
    noche: boolean;
  } {
    if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia) {
      return { manana: false, tarde: false, noche: false };
    }
    if (cfg.horasOrdinarias >= 24) {
      return { manana: true, tarde: true, noche: true };
    }

    const parseHora = (hhmm: string | undefined, fallback: number): number => {
      if (!hhmm || !hhmm.includes(':')) return fallback;
      const h = parseInt(hhmm.split(':')[0], 10);
      return Number.isNaN(h) ? fallback : h;
    };
    const inicio = parseHora(cfg.horaInicio, 7);
    const fin = parseHora(cfg.horaFin, 15);

    const noche = Boolean(cfg.esNocturnoPesado || cfg.horasNocturnas >= 6);
    const manana = !noche && inicio >= 5 && inicio < 12;
    const tarde = !noche && ((inicio >= 12 && inicio < 18) || (inicio < 12 && fin >= 17));

    return { manana, tarde, noche };
  }

  // Cobertura dinámica por turno al pie del cuadrante (respeta el filtro de cargo activo si se selecciona uno)
  coberturaPorDia = computed<Record<number, { manana: number; tarde: number; noche: number }>>(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const filtroCat = this.filtroCategoriaActiva();
    const empsDelCuadrante = this.empleadosServicioSinFiltro().filter(
      ({ emp }) => filtroCat === 'TODAS' || emp.categoria === filtroCat
    );
    const catalogo = this.catalogoTurnosMap();
    const resultado: Record<number, { manana: number; tarde: number; noche: number }> = {};

    for (const d of dias) {
      let manana = 0;
      let tarde = 0;
      let noche = 0;

      for (const { emp } of empsDelCuadrante) {
        const cod = matriz[emp.id]?.[d.dia]?.codigo || '';
        if (!cod) continue;
        const franjas = this.clasificarFranjasTurno(catalogo[cod]);
        if (franjas.manana) manana++;
        if (franjas.tarde) tarde++;
        if (franjas.noche) noche++;
      }

      resultado[d.dia] = { manana, tarde, noche };
    }
    return resultado;
  });

  /**
   * Calcula las horas de descanso reales entre la salida de un turno en el día d-1
   * y el inicio del turno en el día d. Retorna null si alguno de los dos es descanso/ausencia.
   */
  calcularHorasDescansoEntreTurnos(
    cfgPrev?: TipoTurnoConfig,
    cfgAct?: TipoTurnoConfig
  ): number | null {
    if (
      !cfgPrev ||
      !cfgAct ||
      cfgPrev.horasOrdinarias <= 0 ||
      cfgAct.horasOrdinarias <= 0 ||
      cfgPrev.esAusencia ||
      cfgAct.esAusencia
    ) {
      return null;
    }

    const parseHora = (hhmm: string | undefined, def: number): number => {
      if (!hhmm || !hhmm.includes(':')) return def;
      const [h, m] = hhmm.split(':').map(Number);
      return (isNaN(h) ? def : h) + (isNaN(m) ? 0 : m / 60);
    };

    const inicioPrev = parseHora(cfgPrev.horaInicio, 7);
    const finPrev = parseHora(cfgPrev.horaFin, 15);
    const inicioAct = parseHora(cfgAct.horaInicio, 7);

    // Si el turno anterior dura 24h o cruza medianoche (fin <= inicio), termina en el día d a las (24 + finPrev)
    const finAbsolutoPrev =
      cfgPrev.horasOrdinarias >= 24 || finPrev <= inicioPrev ? 24 + finPrev : finPrev;
    const inicioAbsolutoAct = 24 + inicioAct;

    return Math.round((inicioAbsolutoAct - finAbsolutoPrev) * 10) / 10;
  }

  // Motor de validaciones CST dinámico por configuración de turno
  infraccionesActivas = computed<InfraccionNormativa[]>(() => {
    const dias = this.diasDelMes();
    const filas = this.filasServicioCompletas();
    const alertas: InfraccionNormativa[] = [];
    const catalogo = this.catalogoTurnosMap();

    for (const f of filas) {
      // 1. Validar Empalme con mes previo (Día 1)
      const prevCod = f.empleado.ultimoTurnoMesPrevio;
      const prevCfg = prevCod ? catalogo[prevCod] : undefined;
      const dia1Cod = f.celdas[1]?.codigo || '';
      const dia1Cfg = dia1Cod ? catalogo[dia1Cod] : undefined;
      const descansoDia1 = this.calcularHorasDescansoEntreTurnos(prevCfg, dia1Cfg);

      if (
        prevCfg?.esNocturnoPesado &&
        dia1Cfg &&
        dia1Cfg.horasOrdinarias > 0 &&
        dia1Cod !== 'S' &&
        dia1Cod !== 'L'
      ) {
        alertas.push({
          empleadoId: f.empleado.id,
          empleadoNombre: f.empleado.nombre,
          dia: 1,
          mensaje: `${f.empleado.nombre} (Día 1): Infracción Empalme — Cerró mes en ${prevCod}, requiere Saliente (S) o Libre (L).`,
        });
      } else if (descansoDia1 !== null && descansoDia1 < 12) {
        alertas.push({
          empleadoId: f.empleado.id,
          empleadoNombre: f.empleado.nombre,
          dia: 1,
          mensaje: `${f.empleado.nombre} (Día 1): Infracción Empalme — Solo ${descansoDia1}h de descanso entre ${prevCod} (${prevCfg?.horaInicio}-${prevCfg?.horaFin}) y ${dia1Cod} (${dia1Cfg?.horaInicio}-${dia1Cfg?.horaFin}) (Mínimo legal: 12h).`,
        });
      }

      // 2. Validar secuencia diaria (Descanso < 12h y Post-Guardia)
      for (let i = 1; i < dias.length; i++) {
        const dActual = dias[i].dia;
        const dPrevio = dias[i - 1].dia;
        const cPrev = f.celdas[dPrevio]?.codigo || '';
        const cAct = f.celdas[dActual]?.codigo || '';

        if (!cPrev || !cAct) continue;
        const cfgPrev = catalogo[cPrev];
        const cfgAct = catalogo[cAct];
        const horasDescanso = this.calcularHorasDescansoEntreTurnos(cfgPrev, cfgAct);

        if (
          cfgPrev?.esNocturnoPesado &&
          cfgAct &&
          cfgAct.horasOrdinarias > 0 &&
          cAct !== 'S' &&
          cAct !== 'L'
        ) {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Violación Post-Guardia tras ${cPrev} → ${cAct} (Requiere Saliente S o Libre L).`,
          });
        } else if (horasDescanso !== null && horasDescanso < 12) {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Descanso insuficiente de ${horasDescanso}h tras ${cPrev} (${cfgPrev?.horaInicio}-${cfgPrev?.horaFin}) → ${cAct} (${cfgAct?.horaInicio}-${cfgAct?.horaFin}) (Mínimo legal: 12h).`,
          });
        }
      }

      // 3. Validar racha de días consecutivos laborados sin descanso (> 6 días seguidos)
      let rachaDias =
        prevCfg && prevCfg.horasOrdinarias > 0 && !prevCfg.esAusencia ? 1 : 0;

      for (const d of dias) {
        const cAct = f.celdas[d.dia]?.codigo || '';
        const cfgAct = cAct ? catalogo[cAct] : undefined;
        const esLaborado = Boolean(cfgAct && cfgAct.horasOrdinarias > 0 && !cfgAct.esAusencia);

        if (esLaborado) {
          rachaDias++;
          if (rachaDias > 6) {
            const yaTieneAlertaEnDia = alertas.some(
              (a) => a.empleadoId === f.empleado.id && a.dia === d.dia
            );
            if (!yaTieneAlertaEnDia) {
              alertas.push({
                empleadoId: f.empleado.id,
                empleadoNombre: f.empleado.nombre,
                dia: d.dia,
                mensaje: `${f.empleado.nombre} (Día ${d.dia}): ${rachaDias} días consecutivos laborados sin descanso (${cAct}) — Máximo legal/recomendado: 6 días.`,
              });
            }
          }
        } else {
          rachaDias = 0;
        }
      }
    }
    return alertas;
  });

  reglaCargoActivaEnCuadrante = computed<ReglaCargoServicio | undefined>(() => {
    const cat = this.filtroCategoriaActiva();
    if (!cat || cat === 'TODAS') return undefined;
    const srv = this.servicioActual();
    return (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === cat);
  });

  /**
   * Calcula las metas de cobertura requeridas (Mañana / Tarde / Noche) para un día específico,
   * respetando la modalidad operativa del servicio (24/7, Guardia FDS, Lun-Sáb o Lun-Vie Hábiles)
   * y el desglose por cargo profesional cuando se filtra o evalúa un cargo específico.
   */
  obtenerMetasDiaServicio(
    srv: ServicioHospitalario,
    d: DiaColumna,
    categoriaEspecifica?: string
  ): { reqManana: number; reqTarde: number; reqNoche: number; cerrado: boolean } {
    const mod = srv.modalidadDias || 'TODOS_24_7';
    const esDomOFest = d.esDomingo || !!d.festivo;

    const catFiltro =
      categoriaEspecifica !== undefined
        ? categoriaEspecifica
        : this.filtroCategoriaActiva() !== 'TODAS'
          ? this.filtroCategoriaActiva()
          : undefined;

    const reglaCargo = catFiltro
      ? (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === catFiltro)
      : undefined;

    const baseM = reglaCargo ? reglaCargo.reqManana : srv.reqManana;
    const baseT = reglaCargo ? reglaCargo.reqTarde : srv.reqTarde;
    const baseN = reglaCargo ? reglaCargo.reqNoche : srv.reqNoche;
    const fdsM = reglaCargo ? (reglaCargo.reqMananaFds ?? baseM) : (srv.reqMananaFds ?? baseM);
    const fdsT = reglaCargo ? (reglaCargo.reqTardeFds ?? baseT) : (srv.reqTardeFds ?? baseT);
    const fdsN = reglaCargo ? (reglaCargo.reqNocheFds ?? baseN) : (srv.reqNocheFds ?? baseN);

    if (esDomOFest) {
      if (mod === 'LUN_VIE_HABILES' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return { reqManana: 0, reqTarde: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS') {
        return {
          reqManana: fdsM,
          reqTarde: fdsT,
          reqNoche: fdsN,
          cerrado: false,
        };
      }
      return {
        reqManana: baseM,
        reqTarde: baseT,
        reqNoche: baseN,
        cerrado: false,
      };
    }

    if (d.esSabado) {
      if (mod === 'LUN_VIE_HABILES') {
        return { reqManana: 0, reqTarde: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return {
          reqManana: fdsM,
          reqTarde: fdsT,
          reqNoche: fdsN,
          cerrado: false,
        };
      }
      return {
        reqManana: baseM,
        reqTarde: baseT,
        reqNoche: baseN,
        cerrado: false,
      };
    }

    return {
      reqManana: baseM,
      reqTarde: baseT,
      reqNoche: baseN,
      cerrado: false,
    };
  }

  etiquetaModalidadDias(mod?: string): string {
    switch (mod) {
      case 'TODOS_GUARDIA_FDS':
        return '24/7 (Guardia FDS/Fest.)';
      case 'LUN_SAB_SIN_FESTIVOS':
        return 'Lun–Sáb (Sin Dom/Fest)';
      case 'LUN_VIE_HABILES':
        return 'Lun–Vie Hábiles';
      default:
        return '24/7 Todos los días';
    }
  }

  // KPIs de la Torre de Control
  porcentajeCoberturaGlobal = computed<number>(() => {
    const dias = this.diasDelMes();
    const srv = this.servicioActual();
    const cob = this.coberturaPorDia();
    let totalChecks = 0;
    let cumplidos = 0;

    for (const d of dias) {
      const metas = this.obtenerMetasDiaServicio(srv, d);
      if (metas.cerrado) continue;
      const c = cob[d.dia];
      if (metas.reqManana > 0) {
        totalChecks++;
        if (c.manana >= metas.reqManana) cumplidos++;
      }
      if (metas.reqTarde > 0) {
        totalChecks++;
        if (c.tarde >= metas.reqTarde) cumplidos++;
      }
      if (metas.reqNoche > 0) {
        totalChecks++;
        if (c.noche >= metas.reqNoche) cumplidos++;
      }
    }
    return totalChecks > 0 ? Math.round((cumplidos / totalChecks) * 100) : 100;
  });

  balanceGlobalBancoServicio = computed<number>(() => {
    return this.filasCuadrante().reduce((acc, f) => acc + f.nuevoSaldoBanco, 0);
  });

  permutasPendientesCount = computed<number>(() => {
    return this.listaPermutas().filter((p) => p.estado === 'PENDIENTE_SUPERVISOR').length;
  });

  // Notificaciones dinámicas de Solicitudes según el rol (Badge numérico en el menú lateral)
  notificacionesSolicitudesCount = computed<number>(() => {
    const sesion = this.sesionActual();
    if (!sesion) {
      return this.permutasPendientesCount();
    }
    if (this.esColaborador()) {
      // Para el Colaborador: propuestas entrantes de compañeros que esperan su visto bueno
      return this.listaPermutas().filter(
        (p) => p.receptorId === sesion.empleadoId && p.estado === 'PENDIENTE_PAR'
      ).length;
    }
    // Para Supervisor / Admin: solicitudes concertadas por pares que esperan aprobación de supervisión
    return this.permutasPendientesCount();
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

    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const saldos = this.saldosConsolidadosMap();

    return filtrados.map((emp) => {
      const srvObj = mapaServicios.get(emp.servicioBaseId);
      const servicioNombre = srvObj ? srvObj.nombre : 'Servicio General';
      const celdasEmp = matriz[emp.id] || {};
      const metricas = calcularMetricasMesColaborador(
        emp,
        celdasEmp,
        dias,
        catalogo,
        saldos,
        anio,
        mes
      );

      return {
        emp,
        servicioNombre,
        horasContratoMes: emp.horasContratoMes,
        saldoBancoAnterior: metricas.saldoAntReal,
        ...metricas,
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
    const metricas = calcularMetricasMesColaborador(
      emp,
      celdasEmp,
      dias,
      this.catalogoTurnosMap(),
      this.saldosConsolidadosMap(),
      this.anioSeleccionado(),
      this.mesSeleccionado()
    );
    const servicioBase = this.servicios().find((s) => s.id === emp.servicioBaseId) || this.servicioActual();
    const empConSaldo = { ...emp, saldoBancoAnterior: metricas.saldoAntReal };

    return {
      empleado: empConSaldo,
      servicioBase,
      celdas: celdasEmp,
      ...metricas,
    };
  });

  obtenerServicioDiaPortal(celda?: CeldaAsignacion, srvBaseId?: string): {
    nombre: string;
    esRotacion: boolean;
  } | null {
    if (!celda || !celda.codigo || celda.codigo === 'L') return null;
    const cfg = this.catalogoTurnosMap()[celda.codigo];
    if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia) return null;

    const srvEjeId = celda.servicioEjecutorId || srvBaseId;
    const servicio = this.servicios().find((s) => s.id === srvEjeId);
    const esRotacion = Boolean(
      celda.esRotacion || (celda.servicioEjecutorId && celda.servicioEjecutorId !== srvBaseId)
    );

    return {
      nombre: servicio?.nombre || 'Servicio Hospitalario',
      esRotacion,
    };
  }

  servicioDiaSeleccionadoPortal = computed<{ id: string; nombre: string; esRotacion: boolean }>(() => {
    const portal = this.datosEmpleadoPortal();
    const dia = this.diaPermutaSeleccionado();
    const celda = portal.celdas[dia];
    const srvBaseId = portal.empleado.servicioBaseId;
    const srvEjeId = celda?.servicioEjecutorId || srvBaseId;
    const srv = this.servicios().find((s) => s.id === srvEjeId) || portal.servicioBase;
    const esRotacion = Boolean(
      celda?.esRotacion || (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srvBaseId)
    );
    return {
      id: srv?.id || srvBaseId,
      nombre: srv?.nombre || 'Servicio Hospitalario',
      esRotacion,
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
    const portal = this.datosEmpleadoPortal();
    const actual = portal.empleado;
    const dia = this.diaPermutaSeleccionado();
    const matriz = this.asignaciones();
    const srvActualId = this.servicioDiaSeleccionadoPortal().id;

    return this.empleados()
      .filter((e) => e.id !== actual.id)
      .map((e) => {
        const celda = matriz[e.id]?.[dia];
        const turno = (celda?.codigo || 'L') as CodigoTurno;
        const srvEjeId = celda?.servicioEjecutorId || e.servicioBaseId;
        return {
          empleado: e,
          turno,
          servicioEjecutorId: srvEjeId,
        };
      })
      .filter(
        (x) =>
          x.servicioEjecutorId === srvActualId &&
          x.turno !== '' &&
          x.turno !== 'L' &&
          x.turno !== 'S' &&
          x.turno !== 'VAC' &&
          x.turno !== 'INC'
      );
  });

  propuestasRecibidasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.listaPermutas().filter((p) => p.receptorId === id && p.estado === 'PENDIENTE_PAR');
  });

  misSolicitudesEnviadasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.listaPermutas().filter((p) => p.solicitanteId === id);
  });

  solicitudesSupervisor = computed<PermutaItem[]>(() => {
    return this.listaPermutas().filter((p) => p.estado === 'PENDIENTE_SUPERVISOR');
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

    const isCtrl = event.ctrlKey || event.metaKey;
    const keyLower = event.key.toLowerCase();

    // 1. Ctrl + Z (sin Shift): Deshacer en el planificador
    if (isCtrl && keyLower === 'z' && !event.shiftKey) {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      event.preventDefault();
      this.deshacerUltimaAccion();
      return;
    }

    // 2. Ctrl + Y o Ctrl + Shift + Z: Rehacer en el planificador
    if (isCtrl && (keyLower === 'y' || (keyLower === 'z' && event.shiftKey))) {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      event.preventDefault();
      this.rehacerUltimaAccion();
      return;
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
    this.loteArrastreActual = [];

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

    if (this.loteArrastreActual.length > 0) {
      const cambios = [...this.loteArrastreActual];
      const desc =
        cambios.length === 1
          ? `Cambio día ${cambios[0].dia}: ${cambios[0].turnoAnterior || 'L'} ➔ ${cambios[0].turnoNuevo}`
          : `Arrastre de ${cambios.length} celdas en lote`;

      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: desc,
            servicioId: this.servicioSeleccionadoId(),
            anio: this.anioSeleccionado(),
            mes: this.mesSeleccionado(),
            cambios,
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);
      this.loteArrastreActual = [];
    }
  }

  deshacerUltimaAccion(): void {
    if (this.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina.');
      return;
    }
    const pila = [...this.pilaDeshacer()];
    if (pila.length === 0) {
      this.mostrarNotificacion('ℹ️ No hay más acciones para deshacer en este servicio.');
      return;
    }
    const ultimoPaso = pila.pop()!;
    this.pilaDeshacer.set(pila);

    // Preparar paso simétrico para la pila de Rehacer (Ctrl + Y)
    const pasoInverso: PasoHistorialEdicion = {
      descripcion: ultimoPaso.descripcion,
      servicioId: ultimoPaso.servicioId,
      anio: ultimoPaso.anio,
      mes: ultimoPaso.mes,
      cambios: ultimoPaso.cambios.map((c) => ({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: c.previstoAnterior,
        esRotacion: c.esRotacion,
      })),
    };
    this.pilaRehacer.update((r) => [pasoInverso, ...r].slice(0, 30));

    // Revertir celdas en memoria reactiva
    const actualMap = { ...this.asignaciones() };
    const enBorrador = this.estadoCuadrante() === 'BORRADOR';
    const justificacionAuditoria = '↩️ Deshacer (Ctrl+Z): Reversión inmediata de asignación previa';

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      filaEmp[c.dia] = {
        codigo: c.turnoAnterior,
        previsto: c.previstoAnterior ?? (enBorrador ? c.turnoAnterior : (filaEmp[c.dia]?.previsto || c.turnoAnterior)),
        esRotacion: c.esRotacion,
        servicioEjecutorId: ultimoPaso.servicioId,
      };
      actualMap[c.empId] = filaEmp;

      // Persistir reversión en PostgreSQL
      this.api
        .guardarCeldaCuadrante({
          servicioId: ultimoPaso.servicioId,
          anio: ultimoPaso.anio,
          mes: ultimoPaso.mes,
          dia: c.dia,
          empleadoId: c.empId,
          codigo: c.turnoAnterior,
          previsto: filaEmp[c.dia].previsto || '',
          esRotacion: c.esRotacion,
          justificacion: justificacionAuditoria,
        })
        .subscribe();
    }

    this.actualizarAsignacionesMesActual(actualMap);

    if (this.estadoCuadrante() === 'PUBLICADO') {
      setTimeout(() => this.sincronizarAuditoriasDesdePostgres(), 400);
    }

    this.mostrarNotificacion(`↩️ Deshecho: ${ultimoPaso.descripcion}`);
  }

  rehacerUltimaAccion(): void {
    if (this.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina.');
      return;
    }
    const pila = [...this.pilaRehacer()];
    if (pila.length === 0) {
      this.mostrarNotificacion('ℹ️ No hay acciones para rehacer.');
      return;
    }
    const ultimoPaso = pila.shift()!;
    this.pilaRehacer.set(pila);

    // Preparar paso inverso para la pila de Deshacer (Ctrl + Z)
    const pasoInverso: PasoHistorialEdicion = {
      descripcion: ultimoPaso.descripcion,
      servicioId: ultimoPaso.servicioId,
      anio: ultimoPaso.anio,
      mes: ultimoPaso.mes,
      cambios: ultimoPaso.cambios.map((c) => ({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: c.previstoAnterior,
        esRotacion: c.esRotacion,
      })),
    };
    this.pilaDeshacer.update((d) => [...d, pasoInverso].slice(-30));

    // Reaplicar celdas en memoria reactiva
    const actualMap = { ...this.asignaciones() };
    const enBorrador = this.estadoCuadrante() === 'BORRADOR';
    const justificacionAuditoria = '↪️ Rehacer (Ctrl+Y): Reaplicación de asignación';

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      filaEmp[c.dia] = {
        codigo: c.turnoAnterior,
        previsto: enBorrador ? c.turnoAnterior : (filaEmp[c.dia]?.previsto || c.turnoAnterior),
        esRotacion: c.esRotacion,
        servicioEjecutorId: ultimoPaso.servicioId,
      };
      actualMap[c.empId] = filaEmp;

      this.api
        .guardarCeldaCuadrante({
          servicioId: ultimoPaso.servicioId,
          anio: ultimoPaso.anio,
          mes: ultimoPaso.mes,
          dia: c.dia,
          empleadoId: c.empId,
          codigo: c.turnoAnterior,
          previsto: filaEmp[c.dia].previsto || '',
          esRotacion: c.esRotacion,
          justificacion: justificacionAuditoria,
        })
        .subscribe();
    }

    this.actualizarAsignacionesMesActual(actualMap);

    if (this.estadoCuadrante() === 'PUBLICADO') {
      setTimeout(() => this.sincronizarAuditoriasDesdePostgres(), 400);
    }

    this.mostrarNotificacion(`↪️ Rehecho: ${ultimoPaso.descripcion}`);
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
      (celdaActual?.codigo === 'VAC' || celdaActual?.codigo === 'INC' || celdaActual?.codigo === 'LIC') &&
      nuevoCodigo !== celdaActual.codigo
    ) {
      this.mostrarNotificacion(
        `🔒 Celda bloqueada: Novedad oficial de Intranet (${celdaActual.codigo}). Las ausencias oficiales solo pueden ser gestionadas desde Gestión Humana.`
      );
      return;
    }

    const anterior = (celdaActual?.codigo as CodigoTurno) || 'L';
    if (anterior === nuevoCodigo) return;

    const empObj = this.empleados().find((e) => e.id === empId);
    const esRotacion = empObj ? empObj.servicioBaseId !== this.servicioSeleccionadoId() : false;
    const enBorrador = this.estadoCuadrante() === 'BORRADOR';

    const cambioHistorial: CambioCeldaHistorial = {
      empId,
      dia,
      turnoAnterior: anterior,
      turnoNuevo: nuevoCodigo,
      previstoAnterior: celdaActual?.previsto,
      esRotacion,
    };

    if (this.pintandoConRaton()) {
      const yaEnLote = this.loteArrastreActual.some((c) => c.empId === empId && c.dia === dia);
      if (!yaEnLote) {
        this.loteArrastreActual.push(cambioHistorial);
      }
    } else {
      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: `${empObj?.nombre?.split(' ')[0] || 'Colaborador'} día ${dia}: ${anterior} ➔ ${nuevoCodigo}`,
            servicioId: this.servicioSeleccionadoId(),
            anio: this.anioSeleccionado(),
            mes: this.mesSeleccionado(),
            cambios: [cambioHistorial],
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);
    }

    filaEmp[dia] = {
      codigo: nuevoCodigo,
      previsto: enBorrador ? nuevoCodigo : (celdaActual?.previsto ?? anterior),
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
          previsto: enBorrador ? 'S' : (filaEmp[dia + 1]?.previsto ?? sig),
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

    if (empObj && this.estadoCuadrante() === 'PUBLICADO') {
      setTimeout(() => this.sincronizarAuditoriasDesdePostgres(), 300);
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

    const enBorrador = this.estadoCuadrante() === 'BORRADOR';

    for (const { emp, esRotado } of this.empleadosServicioSinFiltro()) {
      const fila = { ...(actualMap[emp.id] || {}) };
      for (const d of this.diasDelMes()) {
        const celda = fila[d.dia];
        if (
          !celda ||
          celda.codigo === '' ||
          celda.codigo === 'VAC' ||
          celda.codigo === 'INC' ||
          celda.codigo === 'LIC'
        ) {
          continue;
        }
        // Si es personal de apoyo rotado, no borrar los turnos ejecutados en su servicio base original
        if (esRotado && celda.servicioEjecutorId && celda.servicioEjecutorId !== this.servicioSeleccionadoId()) {
          continue;
        }
        const prev = enBorrador ? '' : (celda.previsto ?? celda.codigo);
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

    this.mostrarNotificacion(
      `Cuadro de turnos en blanco: ${celdasLimpiadas} turnos borrados. Novedades oficiales de Intranet (VAC/INC/LIC) conservadas.`
    );
  }

  ejecutarAutocompletarHuecos(): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const dias = this.diasDelMes();
    const totalDias = dias.length;
    const srv = this.servicioActual();
    const catalogo = this.catalogoTurnosMap();
    const actualMap = { ...this.asignaciones() };
    const filasBase = this.filasServicioCompletas();
    const horasExtraLoop = new Map<string, number>();
    const nochesLoop = new Map<string, number>();
    const domFestLoop = new Map<string, number>();
    for (const f of filasBase) {
      nochesLoop.set(f.empleado.id, f.conteoNoches);
      domFestLoop.set(f.empleado.id, f.conteoDomFest);
    }

    let totalAsignados = 0;
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[] = [];

    // Helper: dado un arreglo de códigos habilitados (del servicio o de un cargo), elige los turnos ideales Mañana/Tarde/Noche
    const seleccionarTurnosIdeales = (
      listaCodigos?: string[]
    ): { turnoManana: CodigoTurno; turnoTarde: CodigoTurno; turnoNoche: CodigoTurno } => {
      const setHabilitados = new Set(
        (listaCodigos && listaCodigos.length > 0
          ? listaCodigos
          : srv.turnosHabilitados && srv.turnosHabilitados.length > 0
            ? srv.turnosHabilitados
            : ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP']
        ).map((c) => c.toUpperCase())
      );

      const operativos = this.listaTurnosCatalogo().filter(
        (t) => t.horasOrdinarias > 0 && !t.esAusencia && setHabilitados.has(t.codigo.toUpperCase())
      );

      const soloManana = operativos.filter((t) => {
        const f = this.clasificarFranjasTurno(t);
        return f.manana && !f.tarde && !f.noche;
      });
      const soloTarde = operativos.filter((t) => {
        const f = this.clasificarFranjasTurno(t);
        return f.tarde && !f.manana && !f.noche;
      });
      const diurnosCompletos = operativos.filter((t) => {
        const f = this.clasificarFranjasTurno(t);
        return f.manana && f.tarde && !f.noche;
      });
      const nocturnos = operativos.filter((t) => {
        const f = this.clasificarFranjasTurno(t);
        return f.noche && !f.manana;
      });
      const guardia24 = operativos.filter((t) => t.horasOrdinarias >= 24);

      const tM: CodigoTurno =
        soloManana.find((t) => t.codigo === 'M8')?.codigo ||
        soloManana[0]?.codigo ||
        diurnosCompletos.find((t) => t.codigo === 'D12')?.codigo ||
        diurnosCompletos[0]?.codigo ||
        guardia24[0]?.codigo ||
        'M8';

      const tT: CodigoTurno =
        soloTarde.find((t) => t.codigo === 'T8')?.codigo ||
        soloTarde[0]?.codigo ||
        diurnosCompletos.find((t) => t.codigo === 'D12')?.codigo ||
        diurnosCompletos[0]?.codigo ||
        guardia24[0]?.codigo ||
        'T8';

      const es12h =
        soloManana.length === 0 &&
        diurnosCompletos.some((t) => t.codigo === tM && t.horasOrdinarias >= 12);

      const tN: CodigoTurno =
        (es12h ? nocturnos.find((t) => t.codigo === 'N12')?.codigo : undefined) ||
        nocturnos.find((t) => t.codigo === 'N8')?.codigo ||
        nocturnos[0]?.codigo ||
        guardia24[0]?.codigo ||
        'N8';

      return { turnoManana: tM, turnoTarde: tT, turnoNoche: tN };
    };

    const { turnoManana, turnoTarde, turnoNoche } = seleccionarTurnosIdeales(srv.turnosHabilitados);

    // Helper: valida que al asignar un turno operativo en diaEval no supere los 6 días consecutivos sin descanso
    const superaMaximoDiasConsecutivos = (empObj: EmpleadoHospital, diaEval: number): boolean => {
      let rachaPrevia = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const codPrev = actualMap[empObj.id]?.[prev]?.codigo || '';
        const cfgP = codPrev ? catalogo[codPrev] : undefined;
        if (cfgP && cfgP.horasOrdinarias > 0 && !cfgP.esAusencia) {
          rachaPrevia++;
        } else {
          break;
        }
      }
      if (rachaPrevia === diaEval - 1) {
        const cfgMesPrev = empObj.ultimoTurnoMesPrevio ? catalogo[empObj.ultimoTurnoMesPrevio] : undefined;
        if (cfgMesPrev && cfgMesPrev.horasOrdinarias > 0 && !cfgMesPrev.esAusencia) {
          rachaPrevia++;
        }
      }

      let rachaPosterior = 0;
      for (let sig = diaEval + 1; sig <= totalDias; sig++) {
        const codSig = actualMap[empObj.id]?.[sig]?.codigo || '';
        const cfgS = codSig ? catalogo[codSig] : undefined;
        if (cfgS && cfgS.horasOrdinarias > 0 && !cfgS.esAusencia) {
          rachaPosterior++;
        } else {
          break;
        }
      }

      return rachaPrevia + 1 + rachaPosterior > 6;
    };

    // Helper: cuenta noches consecutivas inmediatamente previas a diaEval
    const contarNochesConsecutivasPrevias = (empObj: EmpleadoHospital, diaEval: number): number => {
      let nochesSeguidas = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const codPrev = actualMap[empObj.id]?.[prev]?.codigo || '';
        const cfgP = codPrev ? catalogo[codPrev] : undefined;
        if (cfgP && this.clasificarFranjasTurno(cfgP).noche) {
          nochesSeguidas++;
        } else {
          break;
        }
      }
      return nochesSeguidas;
    };

    // Helper: clasifica cualquier código de turno en su fase de rotación ('M' | 'T' | 'N' | 'L')
    const clasificarFaseCod = (cod?: string): 'M' | 'T' | 'N' | 'L' => {
      if (!cod || cod === 'L' || cod === 'S' || cod === 'COMP') return 'L';
      const cfg = catalogo[cod];
      if (!cfg || cfg.esAusencia || cfg.horasOrdinarias <= 0) return 'L';
      const fr = this.clasificarFranjasTurno(cfg);
      if (fr.noche) return 'N';
      if (fr.tarde && !fr.manana) return 'T';
      return 'M';
    };

    // Helper: obtiene la fase del día anterior, los días seguidos en esa misma fase y la racha laboral acumulada
    const obtenerEstadoRotacionPrevia = (
      empObj: EmpleadoHospital,
      diaEval: number
    ): { faseAyer: 'M' | 'T' | 'N' | 'L'; rachaFase: number; rachaTrabajo: number } => {
      if (diaEval <= 1) {
        const fasePrev = clasificarFaseCod(empObj.ultimoTurnoMesPrevio);
        return {
          faseAyer: fasePrev,
          rachaFase: fasePrev === 'L' ? 2 : 1,
          rachaTrabajo: fasePrev === 'L' ? 0 : 1,
        };
      }

      const codAyer = actualMap[empObj.id]?.[diaEval - 1]?.codigo || '';
      const faseAyer = clasificarFaseCod(codAyer);

      let rachaFase = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const fPrev = clasificarFaseCod(actualMap[empObj.id]?.[prev]?.codigo || '');
        if (fPrev === faseAyer) {
          rachaFase++;
        } else {
          break;
        }
      }

      let rachaTrabajo = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const fPrev = clasificarFaseCod(actualMap[empObj.id]?.[prev]?.codigo || '');
        if (fPrev !== 'L') {
          rachaTrabajo++;
        } else {
          break;
        }
      }
      if (rachaTrabajo === diaEval - 1 && clasificarFaseCod(empObj.ultimoTurnoMesPrevio) !== 'L') {
        rachaTrabajo++;
      }

      return { faseAyer, rachaFase, rachaTrabajo };
    };

    // Helper: puntaje de rotación horaria escalonada con descanso individual (L -> M -> T -> N -> L)
    const calcularPuntajeRotacion = (
      empObj: EmpleadoHospital,
      diaEval: number,
      faseDestino: 'M' | 'T' | 'N'
    ): number => {
      const { faseAyer, rachaFase, rachaTrabajo } = obtenerEstadoRotacionPrevia(empObj, diaEval);

      if (diaEval === 1) {
        if (faseDestino === 'M') {
          return faseAyer === 'L' ? 10 : 40;
        }
        if (faseDestino === 'T') {
          if (faseAyer === 'M' || faseAyer === 'T') return 10;
          if (faseAyer === 'L') return 20;
          return 40;
        }
        // faseDestino === 'N'
        if (faseAyer === 'N') return 10;
        if (faseAyer === 'T' || faseAyer === 'M') return 20;
        return 30;
      }

      // Si ayer descansó (L), prioridad #1 absoluta (score 5) para reingresar hoy y evitar 2 días libres seguidos (L L)
      if (faseAyer === 'L') {
        if (faseDestino === 'M') return 5;
        if (faseDestino === 'T') return 12;
        return 18;
      }

      if (faseDestino === 'M') {
        if (faseAyer === 'M' && rachaFase < 2 && rachaTrabajo < 5) return 10;
        if (faseAyer === 'M' && rachaTrabajo < 5) return 20 + rachaFase;
        return 50 + rachaTrabajo;
      }

      if (faseDestino === 'T') {
        if (faseAyer === 'M' && rachaTrabajo < 5) return 10;
        if (faseAyer === 'T' && rachaFase < 2 && rachaTrabajo < 5) return 15;
        if (faseAyer === 'T' && rachaTrabajo < 5) return 25 + rachaFase;
        return 50 + rachaTrabajo;
      }

      // faseDestino === 'N'
      if (faseAyer === 'T' && rachaTrabajo <= 5) return 10;
      if (faseAyer === 'N' && rachaFase < 2 && rachaTrabajo < 6) return 15;
      if (faseAyer === 'M' && rachaTrabajo <= 5) return 22;
      if (faseAyer === 'N' && rachaFase >= 2) return 60 + rachaFase;
      return 55;
    };

    const recalcularCoberturaDia = (diaNum: number, categoriaFiltro?: string) => {
      let manana = 0;
      let tarde = 0;
      let noche = 0;
      for (const f of filasBase) {
        if (categoriaFiltro && f.empleado.categoria !== categoriaFiltro) continue;
        const cod = actualMap[f.empleado.id]?.[diaNum]?.codigo || '';
        if (!cod) continue;
        const franjas = this.clasificarFranjasTurno(catalogo[cod]);
        if (franjas.manana) manana++;
        if (franjas.tarde) tarde++;
        if (franjas.noche) noche++;
      }
      return { manana, tarde, noche };
    };

    for (const d of dias) {
      const cubrir = (turno: CodigoTurno, cant: number, categoriaObjetivo?: string) => {
        if (cant <= 0 || !turno) return;
        const cfgTurno = catalogo[turno];
        if (!cfgTurno) return;
        const esNocturno = Boolean(cfgTurno.esNocturnoPesado);
        const franjasTurno = this.clasificarFranjasTurno(cfgTurno);
        const faseDestino: 'M' | 'T' | 'N' = franjasTurno.noche
          ? 'N'
          : franjasTurno.tarde && !franjasTurno.manana
            ? 'T'
            : 'M';
        const esDomOFest = d.esDomingo || !!d.festivo;

        const candidatos = [...filasBase]
          .filter((f) => {
            if (categoriaObjetivo && f.empleado.categoria !== categoriaObjetivo) return false;
            const hoy = actualMap[f.empleado.id]?.[d.dia]?.codigo || '';
            if (hoy !== '' && hoy !== 'L') return false;

            // Regla 1: Máximo 6 días consecutivos laborados sin descanso
            if (superaMaximoDiasConsecutivos(f.empleado, d.dia)) return false;

            // Regla 2: Máximo 3 noches consecutivas para evitar fatiga severa
            if (franjasTurno.noche && contarNochesConsecutivasPrevias(f.empleado, d.dia) >= 3) {
              return false;
            }

            // Regla 3: Descanso legal >= 12h respecto al día anterior (o cierre del mes previo en Día 1)
            const ayer =
              d.dia === 1
                ? f.empleado.ultimoTurnoMesPrevio
                : actualMap[f.empleado.id]?.[d.dia - 1]?.codigo || '';
            const cfgAyer = catalogo[ayer];
            if (cfgAyer?.esNocturnoPesado) return false;
            const descansoDesdeAyer = this.calcularHorasDescansoEntreTurnos(cfgAyer, cfgTurno);
            if (descansoDesdeAyer !== null && descansoDesdeAyer < 12) return false;

            // Regla 4: Si el día siguiente ya tiene un turno operativo asignado, verificar >= 12h de descanso
            if (d.dia < totalDias) {
              const sigCod = actualMap[f.empleado.id]?.[d.dia + 1]?.codigo || '';
              const cfgSig = catalogo[sigCod];
              if (esNocturno) {
                if (sigCod === 'VAC' || sigCod === 'INC' || (cfgSig && cfgSig.horasOrdinarias > 0)) {
                  return false;
                }
              } else {
                const descansoHaciaSig = this.calcularHorasDescansoEntreTurnos(cfgTurno, cfgSig);
                if (descansoHaciaSig !== null && descansoHaciaSig < 12) {
                  return false;
                }
              }
            }
            return true;
          })
          .sort((a, b) => {
            // Prioridad 0: Rotación horaria escalonada (L -> M[2d] -> T[2d] -> N[2d] -> L[2d])
            // Evita que todos los empleados trabajen 6 días seguidos desde el Día 1 y colapsen juntos los días 7, 14, 21 y 28
            const scoreRotA = calcularPuntajeRotacion(a.empleado, d.dia, faseDestino);
            const scoreRotB = calcularPuntajeRotacion(b.empleado, d.dia, faseDestino);
            if (scoreRotA !== scoreRotB) return scoreRotA - scoreRotB;

            // Equidad 1: si es turno nocturno, priorizar quien lleve menos noches en el mes
            if (franjasTurno.noche) {
              const diffNoches =
                (nochesLoop.get(a.empleado.id) || 0) - (nochesLoop.get(b.empleado.id) || 0);
              if (diffNoches !== 0) return diffNoches;
            }
            // Equidad 2: si es domingo o festivo, priorizar quien lleve menos domingos/festivos laborados
            if (esDomOFest) {
              const diffDom =
                (domFestLoop.get(a.empleado.id) || 0) - (domFestLoop.get(b.empleado.id) || 0);
              if (diffDom !== 0) return diffDom;
            }
            // Equidad 3: priorizar menor saldo acumulado en el Banco de Horas
            return (
              a.nuevoSaldoBanco +
              (horasExtraLoop.get(a.empleado.id) || 0) -
              (b.nuevoSaldoBanco + (horasExtraLoop.get(b.empleado.id) || 0))
            );
          });

        const enBorrador = this.estadoCuadrante() === 'BORRADOR';
        for (let i = 0; i < Math.min(cant, candidatos.length); i++) {
          const cand = candidatos[i];
          const fila = { ...(actualMap[cand.empleado.id] || {}) };
          const prev = enBorrador ? turno : (fila[d.dia]?.previsto || turno);
          fila[d.dia] = {
            codigo: turno,
            previsto: prev,
            esRotacion: cand.esPersonalRotado,
            servicioEjecutorId: this.servicioSeleccionadoId(),
          };
          loteParaDb.push({
            empleadoId: cand.empleado.id,
            dia: d.dia,
            codigo: turno,
            previsto: prev,
            esRotacion: cand.esPersonalRotado,
          });
          horasExtraLoop.set(
            cand.empleado.id,
            (horasExtraLoop.get(cand.empleado.id) || 0) + (cfgTurno.horasOrdinarias || 8)
          );
          if (franjasTurno.noche) {
            nochesLoop.set(cand.empleado.id, (nochesLoop.get(cand.empleado.id) || 0) + 1);
          }
          if (esDomOFest) {
            domFestLoop.set(cand.empleado.id, (domFestLoop.get(cand.empleado.id) || 0) + 1);
          }
          totalAsignados++;

          // Auto-protección Post-Guardia: asignar Saliente (S) en d.dia + 1 tras turno nocturno pesado (ej. G24)
          if (esNocturno && d.dia < totalDias) {
            const sigActual = fila[d.dia + 1]?.codigo || '';
            if (!sigActual || sigActual === 'L') {
              const prevSig = enBorrador ? 'S' : (fila[d.dia + 1]?.previsto || 'S');
              fila[d.dia + 1] = {
                codigo: 'S',
                previsto: prevSig,
                esRotacion: cand.esPersonalRotado,
                servicioEjecutorId: this.servicioSeleccionadoId(),
              };
              loteParaDb.push({
                empleadoId: cand.empleado.id,
                dia: d.dia + 1,
                codigo: 'S',
                previsto: prevSig,
                esRotacion: cand.esPersonalRotado,
              });
            }
          }

          actualMap[cand.empleado.id] = fila;
        }
      };

      const reglasCargosSrv = srv.reglasPorCargo || [];
      const filtroCatActiva = this.filtroCategoriaActiva();

      if (reglasCargosSrv.length > 0) {
        // Autocompletado diferenciado por Cargo Profesional (RequerimientoCobertura + ServicioTurnoHabilitado)
        for (const regla of reglasCargosSrv) {
          if (filtroCatActiva !== 'TODAS' && regla.categoriaNombre !== filtroCatActiva) continue;
          const metasCargo = this.obtenerMetasDiaServicio(srv, d, regla.categoriaNombre);
          if (metasCargo.cerrado) continue;

          const turnosCargo = seleccionarTurnosIdeales(regla.turnosHabilitados);

          const cob1 = recalcularCoberturaDia(d.dia, regla.categoriaNombre);
          cubrir(turnosCargo.turnoManana, Math.max(0, metasCargo.reqManana - cob1.manana), regla.categoriaNombre);

          const cob2 = recalcularCoberturaDia(d.dia, regla.categoriaNombre);
          cubrir(turnosCargo.turnoTarde, Math.max(0, metasCargo.reqTarde - cob2.tarde), regla.categoriaNombre);

          const cob3 = recalcularCoberturaDia(d.dia, regla.categoriaNombre);
          cubrir(turnosCargo.turnoNoche, Math.max(0, metasCargo.reqNoche - cob3.noche), regla.categoriaNombre);
        }
      } else {
        const metasDia = this.obtenerMetasDiaServicio(srv, d);
        if (!metasDia.cerrado) {
          const cob1 = recalcularCoberturaDia(d.dia);
          cubrir(turnoManana, Math.max(0, metasDia.reqManana - cob1.manana));

          const cob2 = recalcularCoberturaDia(d.dia);
          cubrir(turnoTarde, Math.max(0, metasDia.reqTarde - cob2.tarde));

          const cob3 = recalcularCoberturaDia(d.dia);
          cubrir(turnoNoche, Math.max(0, metasDia.reqNoche - cob3.noche));
        }
      }
    }

    // 2. Asignar 'L' (Libre Programado) en todas las celdas que hayan quedado vacías ('')
    const enBorradorFinal = this.estadoCuadrante() === 'BORRADOR';
    const filtroCatFinal = this.filtroCategoriaActiva();
    for (const f of filasBase) {
      if (filtroCatFinal !== 'TODAS' && f.empleado.categoria !== filtroCatFinal) continue;
      const fila = { ...(actualMap[f.empleado.id] || {}) };
      let modificada = false;
      for (const d of dias) {
        const codActual = fila[d.dia]?.codigo || '';
        if (codActual === '') {
          const prevLibre = enBorradorFinal ? 'L' : (fila[d.dia]?.previsto || 'L');
          fila[d.dia] = {
            codigo: 'L',
            previsto: prevLibre,
            esRotacion: f.esPersonalRotado,
            servicioEjecutorId: this.servicioSeleccionadoId(),
          };
          loteParaDb.push({
            empleadoId: f.empleado.id,
            dia: d.dia,
            codigo: 'L',
            previsto: prevLibre,
            esRotacion: f.esPersonalRotado,
          });
          modificada = true;
        }
      }
      if (modificada) {
        actualMap[f.empleado.id] = fila;
      }
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
      `Autocompletado por cargo finalizado: ${totalAsignados} turnos operativos asignados respetando metas por cargo, 12h de descanso y máx. 6 días continuos.`
    );
  }

  // Administración de Servicios y Servicios de Apoyo
  esTurnoHabilitadoEnServicioForm(codigo: string): boolean {
    return this.nuevoServicioTurnosHabilitados().includes(codigo.toUpperCase());
  }

  alternarTurnoEnServicioForm(codigo: string): void {
    const cod = codigo.toUpperCase();
    const actuales = this.nuevoServicioTurnosHabilitados();
    if (actuales.includes(cod)) {
      if (actuales.length <= 1) {
        this.mostrarNotificacion('El servicio debe tener al menos un turno habilitado.');
        return;
      }
      const nuevos = actuales.filter((c) => c !== cod);
      this.nuevoServicioTurnosHabilitados.set(nuevos);
      // También quitarlo de las reglas por cargo si estaba activo
      this.nuevoServicioReglasPorCargo.update((reglas) =>
        reglas.map((r) => ({
          ...r,
          turnosHabilitados: (r.turnosHabilitados || []).filter((t) => t.toUpperCase() !== cod),
        }))
      );
    } else {
      this.nuevoServicioTurnosHabilitados.set([...actuales, cod]);
      // Habilitarlo también por defecto en los cargos del servicio
      this.nuevoServicioReglasPorCargo.update((reglas) =>
        reglas.map((r) => ({
          ...r,
          turnosHabilitados: r.turnosHabilitados.includes(cod)
            ? r.turnosHabilitados
            : [...r.turnosHabilitados, cod],
        }))
      );
    }
  }

  aplicarPlantillaTurnosServicio(
    plantilla: 'ROTATIVO_8H' | 'GUARDIAS_12_24' | 'ADMINISTRATIVO' | 'TODOS'
  ): void {
    const baseDescansos = ['S', 'L', 'COMP', 'VAC', 'INC'];
    let nuevos: string[];
    if (plantilla === 'ROTATIVO_8H') {
      nuevos = ['M8', 'T8', 'N8', ...baseDescansos];
    } else if (plantilla === 'GUARDIAS_12_24') {
      nuevos = ['D12', 'N12', 'G24', ...baseDescansos];
    } else if (plantilla === 'ADMINISTRATIVO') {
      nuevos = ['ADM', 'M6', 'T6', ...baseDescansos];
    } else {
      nuevos = this.listaTurnosCatalogo().map((t) => t.codigo);
    }
    this.nuevoServicioTurnosHabilitados.set(nuevos);
    this.nuevoServicioReglasPorCargo.update((reglas) =>
      reglas.map((r) => ({ ...r, turnosHabilitados: [...nuevos] }))
    );
  }

  turnosOperativosHabilitadosEnForm = computed<TipoTurnoConfig[]>(() => {
    const hab = new Set(this.nuevoServicioTurnosHabilitados().map((c) => c.toUpperCase()));
    return this.listaTurnosCatalogo().filter(
      (t) => t.horasOrdinarias > 0 && !t.esAusencia && hab.has(t.codigo.toUpperCase())
    );
  });

  esTurnoHabilitadoEnCargoForm(categoriaNombre: string, codigoTurno: string): boolean {
    const regla = this.nuevoServicioReglasPorCargo().find((r) => r.categoriaNombre === categoriaNombre);
    if (!regla) return true;
    return (regla.turnosHabilitados || []).map((c) => c.toUpperCase()).includes(codigoTurno.toUpperCase());
  }

  alternarTurnoEnCargoForm(categoriaNombre: string, codigoTurno: string): void {
    const cod = codigoTurno.toUpperCase();
    this.nuevoServicioReglasPorCargo.update((reglas) =>
      reglas.map((r) => {
        if (r.categoriaNombre !== categoriaNombre) return r;
        const actuales = (r.turnosHabilitados || []).map((c) => c.toUpperCase());
        const operativosActuales = actuales.filter((c) => {
          const cfg = this.catalogoTurnosMap()[c];
          return cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia;
        });
        if (actuales.includes(cod)) {
          if (operativosActuales.length <= 1) {
            this.mostrarNotificacion(`El cargo "${categoriaNombre}" debe conservar al menos un turno operativo.`);
            return r;
          }
          return { ...r, turnosHabilitados: actuales.filter((c) => c !== cod) };
        }
        return { ...r, turnosHabilitados: [...actuales, cod] };
      })
    );
  }

  actualizarMetaCargoForm(
    categoriaNombre: string,
    campo: 'reqManana' | 'reqTarde' | 'reqNoche' | 'reqMananaFds' | 'reqTardeFds' | 'reqNocheFds',
    valor: number
  ): void {
    const num = Math.max(0, Number(valor) || 0);
    this.nuevoServicioReglasPorCargo.update((reglas) => {
      const actualizadas = reglas.map((r) =>
        r.categoriaNombre === categoriaNombre ? { ...r, [campo]: num } : r
      );
      // Recalcular automáticamente la meta total del servicio como suma de sus cargos
      this.nuevoServicioReqManana.set(actualizadas.reduce((s, r) => s + (Number(r.reqManana) || 0), 0));
      this.nuevoServicioReqTarde.set(actualizadas.reduce((s, r) => s + (Number(r.reqTarde) || 0), 0));
      this.nuevoServicioReqNoche.set(actualizadas.reduce((s, r) => s + (Number(r.reqNoche) || 0), 0));
      this.nuevoServicioReqMananaFds.set(actualizadas.reduce((s, r) => s + (Number(r.reqMananaFds) || 0), 0));
      this.nuevoServicioReqTardeFds.set(actualizadas.reduce((s, r) => s + (Number(r.reqTardeFds) || 0), 0));
      this.nuevoServicioReqNocheFds.set(actualizadas.reduce((s, r) => s + (Number(r.reqNocheFds) || 0), 0));
      return actualizadas;
    });
  }

  obtenerTurnosOperativosServicio(srv: ServicioHospitalario): TipoTurnoConfig[] {
    const catalogo = this.catalogoTurnosMap();
    const codigos =
      srv.turnosHabilitados && srv.turnosHabilitados.length > 0
        ? srv.turnosHabilitados
        : ['M8', 'T8', 'N8', 'D12', 'G24'];
    return codigos
      .map((c) => catalogo[c.toUpperCase()])
      .filter((t): t is TipoTurnoConfig => Boolean(t && t.horasOrdinarias > 0 && !t.esAusencia));
  }

  cargarServicioParaEdicion(srv: ServicioHospitalario): void {
    this.servicioEditandoId.set(srv.id);
    this.nuevoServicioCodigo.set(srv.codigo);
    this.nuevoServicioNombre.set(srv.nombre);
    this.nuevoServicioTipoAsistencia.set(srv.tipoAsistencia || 'URGENCIAS');
    this.nuevoServicioModalidadDias.set(srv.modalidadDias || 'TODOS_24_7');
    this.nuevoServicioReqManana.set(srv.reqManana ?? 4);
    this.nuevoServicioReqTarde.set(srv.reqTarde ?? 4);
    this.nuevoServicioReqNoche.set(srv.reqNoche ?? 2);
    this.nuevoServicioReqMananaFds.set(srv.reqMananaFds ?? srv.reqManana ?? 4);
    this.nuevoServicioReqTardeFds.set(srv.reqTardeFds ?? srv.reqTarde ?? 4);
    this.nuevoServicioReqNocheFds.set(srv.reqNocheFds ?? srv.reqNoche ?? 2);
    const turnosSrv =
      srv.turnosHabilitados && srv.turnosHabilitados.length > 0
        ? [...srv.turnosHabilitados]
        : ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'VAC', 'INC'];
    this.nuevoServicioTurnosHabilitados.set(turnosSrv);

    if (srv.reglasPorCargo && srv.reglasPorCargo.length > 0) {
      this.nuevoServicioReglasPorCargo.set(
        srv.reglasPorCargo.map((r) => ({
          ...r,
          turnosHabilitados: r.turnosHabilitados?.length ? [...r.turnosHabilitados] : [...turnosSrv],
        }))
      );
    } else {
      // Construir a partir de los cargos con personal adscrito al servicio
      const empsSrv = this.empleados().filter((e) => e.servicioBaseId === srv.id);
      const cats = Array.from(new Set(empsSrv.map((e) => e.categoria)));
      this.nuevoServicioReglasPorCargo.set(
        cats.map((cat) => {
          const count = empsSrv.filter((e) => e.categoria === cat).length;
          return {
            categoriaNombre: cat,
            empleadosCount: count,
            reqManana: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqTarde: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqNoche: count >= 3 ? 1 : 0,
            reqMananaFds: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqTardeFds: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqNocheFds: count >= 3 ? 1 : 0,
            turnosHabilitados: [...turnosSrv],
          };
        })
      );
    }

    this.mostrarNotificacion(`Modo edición activado: ${srv.nombre}`);

    setTimeout(() => {
      const panel = document.getElementById('panel-edicion-servicio');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const inputCod = document.getElementById('input-codigo-servicio') as HTMLInputElement | null;
      if (inputCod) {
        inputCod.focus({ preventScroll: true });
      }
    }, 30);
  }

  cancelarEdicionServicio(): void {
    this.servicioEditandoId.set(null);
    this.nuevoServicioCodigo.set('');
    this.nuevoServicioNombre.set('');
    this.nuevoServicioTipoAsistencia.set('URGENCIAS');
    this.nuevoServicioModalidadDias.set('TODOS_24_7');
    this.nuevoServicioReqManana.set(4);
    this.nuevoServicioReqTarde.set(4);
    this.nuevoServicioReqNoche.set(2);
    this.nuevoServicioReqMananaFds.set(2);
    this.nuevoServicioReqTardeFds.set(2);
    this.nuevoServicioReqNocheFds.set(1);
    this.nuevoServicioTurnosHabilitados.set([
      'M8',
      'T8',
      'N8',
      'D12',
      'G24',
      'S',
      'L',
      'COMP',
      'VAC',
      'INC',
    ]);
    this.nuevoServicioReglasPorCargo.set([]);
  }

  guardarServicioAutonomo(): void {
    const cod = this.nuevoServicioCodigo().trim().toUpperCase();
    const nom = this.nuevoServicioNombre().trim();
    const tipo = this.nuevoServicioTipoAsistencia();
    const modalidadDias = this.nuevoServicioModalidadDias();
    const reqManana = Math.max(0, Number(this.nuevoServicioReqManana()) || 0);
    const reqTarde = Math.max(0, Number(this.nuevoServicioReqTarde()) || 0);
    const reqNoche = Math.max(0, Number(this.nuevoServicioReqNoche()) || 0);
    const reqMananaFds = Math.max(0, Number(this.nuevoServicioReqMananaFds()) || 0);
    const reqTardeFds = Math.max(0, Number(this.nuevoServicioReqTardeFds()) || 0);
    const reqNocheFds = Math.max(0, Number(this.nuevoServicioReqNocheFds()) || 0);
    const turnosHabilitados = this.nuevoServicioTurnosHabilitados();
    const reglasPorCargo = this.nuevoServicioReglasPorCargo();
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
        .actualizarServicio(editandoId, {
          codigo: cod,
          nombre: nom,
          tipoAsistencia: tipo,
          reqManana,
          reqTarde,
          reqNoche,
          modalidadDias,
          reqMananaFds,
          reqTardeFds,
          reqNocheFds,
          turnosHabilitados,
          reglasPorCargo,
        })
        .subscribe({
          next: () => {
            this.mostrarNotificacion(`Servicio "${nom}", metas por cargo y turnos habilitados actualizados en PostgreSQL.`);
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
        .crearServicio({
          codigo: cod,
          nombre: nom,
          tipoAsistencia: tipo,
          reqManana,
          reqTarde,
          reqNoche,
          modalidadDias,
          reqMananaFds,
          reqTardeFds,
          reqNocheFds,
          turnosHabilitados,
          reglasPorCargo,
        })
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
      this.guardarRotadosEnStorage(mapaRot);
    }
    this.modalRotacionAbierto.set(false);
    this.mostrarNotificacion(`${cand.nombre} agregado como personal de apoyo al cuadrante.`);
  }

  quitarPersonalApoyo(empId: string): void {
    const srvId = this.servicioSeleccionadoId();
    const mapaRot = { ...this.empleadosRotadosPorServicio() };
    const listaActual = (mapaRot[srvId] || []).filter((id) => id !== empId);
    mapaRot[srvId] = listaActual;
    this.empleadosRotadosPorServicio.set(mapaRot);
    this.guardarRotadosEnStorage(mapaRot);

    const empObj = this.empleados().find((e) => e.id === empId);
    this.mostrarNotificacion(`${empObj?.nombre || 'Colaborador'} removido del personal de apoyo.`);
  }

  // =========================================================================
  // MOTOR DE VALIDACIÓN Y GESTIÓN DE PERMUTAS 1-A-1 (DOC 09)
  // =========================================================================

  /**
   * Valida en tiempo real que el intercambio cumpla con las reglas asistenciales y legales:
   * 1. Misma categoría profesional
   * 2. No sobreescribir ausencias oficiales (VAC/INC)
   * 3. Descanso mínimo de 12h previo y posterior para AMBOS colaboradores (CST Art. 160)
   */
  validarReglasPermuta(
    emp1Id: string,
    emp2Id: string,
    dia: number,
    turno1: string,
    turno2: string
  ): { valida: boolean; motivo: string } {
    const emp1 = this.empleados().find((e) => e.id === emp1Id);
    const emp2 = this.empleados().find((e) => e.id === emp2Id);
    if (!emp1 || !emp2) {
      return { valida: false, motivo: 'Colaborador no encontrado en la plantilla.' };
    }

    if (emp1.categoria !== emp2.categoria) {
      return {
        valida: false,
        motivo: `RN-05 Incompatibilidad: ${emp1.nombre} (${emp1.categoria}) no puede permutar con ${emp2.nombre} (${emp2.categoria}).`,
      };
    }

    if (turno1 === 'VAC' || turno1 === 'INC' || turno2 === 'VAC' || turno2 === 'INC') {
      return {
        valida: false,
        motivo: 'No se permiten permutas sobre periodos con Novedades Oficiales de RRHH (Vacaciones o Incapacidades).',
      };
    }

    if (turno1 === turno2) {
      return {
        valida: false,
        motivo: `Ambos colaboradores ya tienen el mismo turno (${turno1}) en el día ${dia}.`,
      };
    }

    const catalogo = this.catalogoTurnosMap();
    const cfgT1 = catalogo[turno1];
    const cfgT2 = catalogo[turno2];
    const map = this.asignaciones();
    const totalDias = this.diasDelMes().length;

    // 1. Simular descanso para Solicitante (emp1) al recibir turno2:
    const codPrev1 =
      dia === 1
        ? this.obtenerUltimoTurnoMesPrevio(emp1Id, emp1.ultimoTurnoMesPrevio || 'L')
        : map[emp1Id]?.[dia - 1]?.codigo || '';
    const cfgPrev1 = catalogo[codPrev1];
    const descPrev1 = this.calcularHorasDescansoEntreTurnos(cfgPrev1, cfgT2);
    if (
      (cfgPrev1?.esNocturnoPesado && cfgT2 && cfgT2.horasOrdinarias > 0 && turno2 !== 'S' && turno2 !== 'L') ||
      (descPrev1 !== null && descPrev1 < 12)
    ) {
      return {
        valida: false,
        motivo: `Infracción CST Art. 160 para ${emp1.nombre}: Tu turno del día anterior (${codPrev1}) y el nuevo turno (${turno2}) dejan menos de 12h de descanso legal.`,
      };
    }
    if (dia < totalDias) {
      const codSig1 = map[emp1Id]?.[dia + 1]?.codigo || '';
      const cfgSig1 = catalogo[codSig1];
      const descSig1 = this.calcularHorasDescansoEntreTurnos(cfgT2, cfgSig1);
      if (
        (cfgT2?.esNocturnoPesado && cfgSig1 && cfgSig1.horasOrdinarias > 0 && codSig1 !== 'S' && codSig1 !== 'L') ||
        (descSig1 !== null && descSig1 < 12)
      ) {
        return {
          valida: false,
          motivo: `Infracción CST Art. 160 para ${emp1.nombre}: El nuevo turno (${turno2}) y tu turno siguiente (${codSig1}) dejan menos de 12h de descanso legal obligatorias.`,
        };
      }
    }

    // 2. Simular descanso para Receptor (emp2) al recibir turno1:
    const codPrev2 =
      dia === 1
        ? this.obtenerUltimoTurnoMesPrevio(emp2Id, emp2.ultimoTurnoMesPrevio || 'L')
        : map[emp2Id]?.[dia - 1]?.codigo || '';
    const cfgPrev2 = catalogo[codPrev2];
    const descPrev2 = this.calcularHorasDescansoEntreTurnos(cfgPrev2, cfgT1);
    if (
      (cfgPrev2?.esNocturnoPesado && cfgT1 && cfgT1.horasOrdinarias > 0 && turno1 !== 'S' && turno1 !== 'L') ||
      (descPrev2 !== null && descPrev2 < 12)
    ) {
      return {
        valida: false,
        motivo: `Infracción CST Art. 160 para ${emp2.nombre}: Su turno del día anterior (${codPrev2}) y el turno que recibiría (${turno1}) dejan menos de 12h de descanso legal.`,
      };
    }
    if (dia < totalDias) {
      const codSig2 = map[emp2Id]?.[dia + 1]?.codigo || '';
      const cfgSig2 = catalogo[codSig2];
      const descSig2 = this.calcularHorasDescansoEntreTurnos(cfgT1, cfgSig2);
      if (
        (cfgT1?.esNocturnoPesado && cfgSig2 && cfgSig2.horasOrdinarias > 0 && codSig2 !== 'S' && codSig2 !== 'L') ||
        (descSig2 !== null && descSig2 < 12)
      ) {
        return {
          valida: false,
          motivo: `Infracción CST Art. 160 para ${emp2.nombre}: Recibiría (${turno1}) y su turno siguiente (${codSig2}) dejaría menos de 12h de descanso legal.`,
        };
      }
    }

    return {
      valida: true,
      motivo: `Misma categoría asistencial (${emp1.categoria}) y descanso mínimo de 12h verificado para ambos.`,
    };
  }

  /**
   * Paso 1 del Flujo: El Colaborador 1 (Solicitante) envía la propuesta al Colaborador 2.
   * Nace en estado PENDIENTE_PAR.
   */
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

    // Verificación clínica en tiempo real (Paso 1)
    const check = this.validarReglasPermuta(datosMios.empleado.id, comp.id, dia, miTurno, turnoComp);
    if (!check.valida) {
      this.mostrarNotificacion(`⛔ ${check.motivo}`);
      return;
    }

    const dto = {
      solicitanteId: datosMios.empleado.id,
      receptorId: comp.id,
      servicioId: datosMios.empleado.servicioBaseId,
      anio: this.anioSeleccionado(),
      mes: this.mesSeleccionado(),
      diaOrigen: dia,
      turnoOrigen: miTurno,
      diaDestino: dia,
      turnoDestino: turnoComp,
      validacionReglas: check.motivo,
    };

    this.api.crearPermuta(dto).subscribe({
      next: (permutaCreada) => {
        this.actualizarListaPermutas([permutaCreada, ...this.listaPermutas()]);
        this.mostrarNotificacion(`📩 Propuesta enviada a ${comp.nombre}. Esperando su aceptación (Paso 1 de 2).`);
      },
      error: (err) => {
        // Sin fallback local: una permuta que no existe en PostgreSQL no podría aprobarse después
        const msg = err?.error?.message || 'No fue posible conectar con el servidor.';
        this.mostrarNotificacion(`⛔ No se pudo enviar la propuesta: ${msg}`);
      },
    });
  }

  /**
   * Paso 2 del Flujo: El Colaborador 2 (Receptor) acepta la propuesta de su compañero.
   * La solicitud avanza al supervisor (PENDIENTE_SUPERVISOR).
   */
  aceptarPropuestaPar(idPermuta: string): void {
    this.api.aceptarPermutaPar(idPermuta).subscribe({
      next: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'PENDIENTE_SUPERVISOR' } : p))
        );
        this.mostrarNotificacion('✅ Has aceptado la propuesta. Fue enviada a la Supervisora para su visto bueno final.');
      },
      error: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'PENDIENTE_SUPERVISOR' } : p))
        );
        this.mostrarNotificacion('✅ Propuesta aceptada. Enviada a la Supervisora.');
      },
    });
  }

  /**
   * Paso 2 del Flujo: El Colaborador 2 (Receptor) declina la propuesta de su compañero.
   * La solicitud se cierra (RECHAZADA) sin llegar a molestar a la supervisora.
   */
  rechazarPropuestaPar(idPermuta: string): void {
    this.api.rechazarPermutaPar(idPermuta, 'Declinada por el compañero receptor').subscribe({
      next: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: 'Declinada por el compañero receptor' } : p
          )
        );
        this.mostrarNotificacion('Has declinado la propuesta de intercambio de turno.');
      },
      error: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: 'Declinada por el compañero receptor' } : p
          )
        );
        this.mostrarNotificacion('Propuesta de intercambio declinada.');
      },
    });
  }

  /**
   * Paso 3 del Flujo: La Supervisora aprueba la permuta ya concertada por ambos colaboradores.
   * El intercambio se ejecuta en PostgreSQL de forma transaccional (servicio y periodo de la permuta);
   * el frontend solo refleja los cambios confirmados por el backend, sin depender del servicio en pantalla.
   */
  aprobarPermuta(idPermuta: string): void {
    const perm = this.listaPermutas().find((p) => p.id === idPermuta);
    if (!perm) return;

    this.api.aprobarPermuta(idPermuta).subscribe({
      next: (res: {
        cambiosAplicados?: { empleadoId: string; anio: number; mes: number; dia: number; codigo: string }[];
      }) => {
        // Reflejar en memoria solo las celdas confirmadas, en su propio periodo (Año-Mes)
        const cambios = res?.cambiosAplicados || [];
        if (cambios.length > 0) {
          this.asignacionesPorPeriodo.update((todo) => {
            const copia = { ...todo };
            for (const c of cambios) {
              const key = `${c.anio}-${c.mes}`;
              const mapaPeriodo = { ...(copia[key] || {}) };
              const fila = { ...(mapaPeriodo[c.empleadoId] || {}) };
              const anterior = fila[c.dia];
              fila[c.dia] = {
                ...anterior,
                codigo: c.codigo as CodigoTurno,
                previsto: anterior?.previsto ?? anterior?.codigo ?? '',
                servicioEjecutorId: perm.servicioId,
              };
              mapaPeriodo[c.empleadoId] = fila;
              copia[key] = mapaPeriodo;
            }
            return copia;
          });
        }

        this.actualizarListaPermutas(
          this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'APROBADA' } : p))
        );

        this.sincronizarAuditoriasDesdePostgres();

        this.mostrarNotificacion(`✅ Cambio de turno aprobado por Supervisión y actualizado en el cuadrante.`);
      },
      error: (err) => {
        // No se marca como aprobada: el cuadrante en BD no fue modificado
        const msg = err?.error?.message || 'No fue posible conectar con el servidor.';
        this.mostrarNotificacion(`⛔ No se aprobó la permuta: ${msg}`);
      },
    });
  }

  /**
   * Paso 3 del Flujo: La Supervisora rechaza la permuta por motivos asistenciales o de servicio.
   */
  rechazarPermuta(idPermuta: string): void {
    this.api.rechazarPermuta(idPermuta, 'Rechazada por la supervisora asistencial').subscribe({
      next: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: 'Rechazada por la supervisora asistencial' } : p
          )
        );
        this.mostrarNotificacion('Solicitud de cambio de turno rechazada por supervisión.');
      },
      error: () => {
        this.actualizarListaPermutas(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: 'Rechazada por la supervisora asistencial' } : p
          )
        );
        this.mostrarNotificacion('Solicitud de cambio de turno rechazada.');
      },
    });
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
    const filas = this.filasServicioCompletas();
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
    if (this.esColaborador() && (vista === 'PLANIFICADOR' || vista === 'REPORTES' || vista === 'CONFIGURACION')) {
      this.mostrarNotificacion('Acceso restringido: tu perfil de Colaborador solo tiene acceso a Mi Calendario y Solicitudes.');
      return;
    }
    if (this.esCoordinador() && vista === 'CONFIGURACION') {
      this.mostrarNotificacion('Acceso restringido: la configuración global está reservada para Talento Humano / Administración.');
      return;
    }
    this.vistaActual.set(vista);
    if (vista === 'DASHBOARD') {
      this.sincronizarAuditoriasDesdePostgres();
    }
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
    this.pilaDeshacer.set([]);
    this.pilaRehacer.set([]);
    this.sincronizarAuditoriasDesdePostgres();
  }

  cambiarMes(nuevoMes: number): void {
    this.mesSeleccionado.set(Number(nuevoMes));
    this.pilaDeshacer.set([]);
    this.pilaRehacer.set([]);
    this.sincronizacionAutomaticaIntranet(true);
  }

  cambiarEstadoCuadrante(): void {
    if (this.esColaborador()) {
      this.mostrarNotificacion('No tienes permisos para cambiar el estado del cuadrante.');
      return;
    }

    const actual = this.estadoCuadrante();
    if (this.esCoordinador() && actual === 'PUBLICADO') {
      this.mostrarNotificacion('El Cierre para Nómina está reservado exclusivamente al perfil de Talento Humano / Nómina.');
      return;
    }
    if (this.esCoordinador() && actual === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('Este mes ya fue cerrado para Nómina. Solo Talento Humano puede reabrirlo.');
      return;
    }

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

    // Al publicar el cuadrante, congelar la foto oficial del Turno Previsto (previsto = codigo) en el servicio activo
    if (nuevoEstado === 'PUBLICADO') {
      const actualMap = { ...this.asignaciones() };
      const dias = this.diasDelMes();
      for (const { emp, esRotado } of this.empleadosServicioSinFiltro()) {
        const fila = { ...(actualMap[emp.id] || {}) };
        let modificada = false;
        for (const d of dias) {
          const celda = fila[d.dia];
          if (!celda) continue;
          if (esRotado && celda.servicioEjecutorId && celda.servicioEjecutorId !== srvId) {
            continue;
          }
          if (celda.previsto !== celda.codigo) {
            fila[d.dia] = { ...celda, previsto: celda.codigo };
            modificada = true;
          }
        }
        if (modificada) {
          actualMap[emp.id] = fila;
        }
      }
      this.actualizarAsignacionesMesActual(actualMap);
    }

    // Consolidar siempre la totalidad del personal de planta del servicio (ignorando cualquier filtro visual de categoría)
    const saldosConsolidados =
      nuevoEstado === 'CERRADO_NOMINA'
        ? this.filasServicioCompletas()
            .filter((f) => !f.esPersonalRotado)
            .map((f) => ({
              empleadoId: f.empleado.id,
              saldoInicial: f.empleado.saldoBancoAnterior,
              horasTrabajadas: f.horasTrabajadas,
              horasContratadas: f.empleado.horasContratoMes,
              horasAmortizadasComp: f.horasAmortizadasComp,
              diferenciaMes: f.diferenciaMes,
              saldoFinalAcumulado: f.nuevoSaldoBanco,
            }))
        : undefined;

    if (saldosConsolidados && saldosConsolidados.length > 0) {
      this.saldosConsolidadosMap.update((actualMap) => {
        const copia = { ...actualMap };
        for (const s of saldosConsolidados) {
          copia[`${s.empleadoId}::${anio}-${mes}`] = s.saldoFinalAcumulado;
        }
        return copia;
      });
    }

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
    if (!this.esAdminTh()) {
      return;
    }
    this.empleadoPortalId.set(nuevoId);
    const pares = this.companerosParesPortal();
    this.companeroPermutaId.set(pares.length > 0 ? pares[0].id : '');
  }

  enfocarCelda(empId: string, dia: number): void {
    this.enfocarCeldaPorId(empId, dia);
  }

  abrirModalIcal(): void {
    const empId = this.empleadoPortalId() || this.sesionActual()?.empleadoId || '';
    const empObj = this.empleados().find((e) => e.id === empId);
    this.enlaceIcalEmpleadoNombre.set(empObj?.nombre || this.sesionActual()?.nombre || 'Colaborador');
    this.modalIcalAbierto.set(true);

    if (empId) {
      this.api.obtenerEnlaceCalendarioIcal(empId).subscribe({
        next: (res) => {
          this.enlaceIcalHttp.set(res.httpUrl);
          this.enlaceIcalWebcal.set(res.webcalUrl);
          this.enlaceIcalEmpleadoNombre.set(res.empleadoNombre);
        },
        error: () => {
          const fallbackToken = `cal_${empObj?.documento || empId}`;
          this.enlaceIcalHttp.set(`http://localhost:3000/api/v1/calendario/feed/${fallbackToken}.ics`);
          this.enlaceIcalWebcal.set(`webcal://localhost:3000/api/v1/calendario/feed/${fallbackToken}.ics`);
        },
      });
    }
  }

  copiarEnlaceIcal(): void {
    const url = this.enlaceIcalHttp() || this.enlaceIcalWebcal();
    if (!url) {
      this.mostrarNotificacion('Generando enlace de calendario, intenta nuevamente...');
      return;
    }

    const finalizarCopia = () => {
      this.modalIcalAbierto.set(false);
      this.mostrarNotificacion('📋 Enlace personal de calendario (.ics) copiado al portapapeles.');
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(finalizarCopia).catch(() => {
        this.copiarTextoFallback(url);
        finalizarCopia();
      });
    } else {
      this.copiarTextoFallback(url);
      finalizarCopia();
    }
  }

  private copiarTextoFallback(texto: string): void {
    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {}
  }

  descargarArchivoIcal(): void {
    const url = this.enlaceIcalHttp();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mis_Turnos_${(this.enlaceIcalEmpleadoNombre() || 'Hospital').replace(/\s+/g, '_')}.ics`;
    a.target = '_blank';
    a.click();
    this.mostrarNotificacion('⬇️ Descargando archivo de calendario (.ics)...');
  }

  notificarIntranet(): void {
    const destino = this.sesionActual()?.intranetReturnUrl || this.intranetReturnUrl();
    try {
      sessionStorage.removeItem('rafa_turnos_sso_jwt');
    } catch {}
    this.sesionActual.set(null);
    this.mostrarNotificacion('Cerrando sesión y regresando a la Intranet Hospitalaria...');
    if (destino) {
      window.location.href = destino;
    }
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
    this.turnoFormMinutosAlmuerzo.set(turno.minutosAlmuerzo ?? 0);
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
    this.turnoFormMinutosAlmuerzo.set(0);
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
      minutosAlmuerzo: calc.minutosAlmuerzo,
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
        minutosAlmuerzo: nuevoTurno.minutosAlmuerzo || 0,
        colorHex: nuevoTurno.bgHex,
        descuentaBancoHoras: nuevoTurno.descuentaBancoHoras,
        esNocturnoPesado: nuevoTurno.esNocturnoPesado,
        visibleEnPaleta: nuevoTurno.visibleEnPaleta,
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

    // Si es un turno nuevo, incluirlo en la lista del formulario de servicio
    if (!existente && !this.nuevoServicioTurnosHabilitados().includes(codigo)) {
      this.nuevoServicioTurnosHabilitados.update((lista) => [...lista, codigo]);
    }

    this.limpiarFormularioTurno();
  }

  alternarVisibilidadTurnoPaleta(codigo: string): void {
    const itemActual = this.catalogoTurnosMap()[codigo];
    if (!itemActual) return;
    const nuevoValor = itemActual.visibleEnPaleta === false ? true : false;

    this.catalogoTurnosMap.update((actual) => ({
      ...actual,
      [codigo]: {
        ...itemActual,
        visibleEnPaleta: nuevoValor,
      },
    }));

    this.api
      .guardarTipoTurno({
        codigo: itemActual.codigo,
        nombre: itemActual.nombre,
        horaInicio: itemActual.horaInicio || '07:00',
        horaFin: itemActual.horaFin || '15:00',
        horasOrdinarias: itemActual.horasOrdinarias,
        horasDiurnas: itemActual.horasDiurnas,
        horasNocturnas: itemActual.horasNocturnas,
        minutosAlmuerzo: itemActual.minutosAlmuerzo || 0,
        colorHex: itemActual.bgHex,
        descuentaBancoHoras: itemActual.descuentaBancoHoras,
        esNocturnoPesado: itemActual.esNocturnoPesado,
        visibleEnPaleta: nuevoValor,
      })
      .subscribe();
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
