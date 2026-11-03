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
    // Carga directa desde la Base de Datos PostgreSQL (Única fuente de verdad institucional)
    this.sincronizarServiciosDesdePostgres();
    this.sincronizarCatalogoTurnosDesdePostgres();
    this.sincronizarEmpleadosDesdePostgres();
    this.sincronizarFestivosDesdePostgres();
    this.sincronizarCuadrantesDesdePostgres();
    this.sincronizarPermutasDesdePostgres();
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

        // Si el empleado activo del portal no está definido o no existe en la BD, asignar preferiblemente uno con cuadrante activo o el primero
        if (!emps.some((e) => e.id === this.empleadoPortalId())) {
          const empInicial = emps.find((e) => e.servicioBaseId === 'srv-urg') || emps[0];
          this.empleadoPortalId.set(empInicial.id);
          const primerPar = emps.find(
            (e) => e.id !== empInicial.id && e.servicioBaseId === empInicial.servicioBaseId && e.categoria === empInicial.categoria
          );
          this.companeroPermutaId.set(primerPar?.id || empInicial.id);
        }
      },
      error: (err) => {
        console.error('Error al sincronizar empleados desde PostgreSQL:', err);
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
              esNocturnoPesado: Boolean(
                t.esNocturnoPesado ?? existente?.esNocturnoPesado ?? cod === 'G24'
              ),
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

  // Empleados totales del servicio actual sin filtro de categoría (Planta + Rotados homólogos)
  empleadosServicioSinFiltro = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const srvId = this.servicioSeleccionadoId();
    const todos = this.empleados();
    const idsRotados = this.empleadosRotadosPorServicio()[srvId] || [];

    const propios = todos
      .filter((e) => e.servicioBaseId === srvId)
      .map((emp) => ({ emp, esRotado: false }));

    const rotados = todos
      .filter((e) => idsRotados.includes(e.id))
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

  // Filas calculadas completas de todo el servicio (sin filtro visual de categoría), usadas para Cierre de Nómina y Exportación
  filasServicioCompletas = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const listaEmp = this.empleadosServicioSinFiltro();

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

  // Cobertura dinámica por turno al pie del cuadrante (incluye planta + personal rotado de apoyo)
  coberturaPorDia = computed<Record<number, { manana: number; tarde: number; noche: number }>>(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const empsDelCuadrante = this.empleadosServicioSinFiltro();
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
        saldoBancoAnterior: saldoAntReal,
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

    for (const { emp, esRotado } of this.empleadosServicioSinFiltro()) {
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
    const totalDias = dias.length;
    const srv = this.servicioActual();
    const catalogo = this.catalogoTurnosMap();
    const actualMap = { ...this.asignaciones() };
    const filasBase = this.filasServicioCompletas();
    const horasExtraLoop = new Map<string, number>();
    let totalAsignados = 0;
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[] = [];

    for (const d of dias) {
      // Recalcular cobertura del día sobre actualMap para reflejar cambios hechos en iteraciones previas
      let manana = 0;
      let tarde = 0;
      let noche = 0;
      for (const f of filasBase) {
        const cod = actualMap[f.empleado.id]?.[d.dia]?.codigo || '';
        if (!cod) continue;
        const franjas = this.clasificarFranjasTurno(catalogo[cod]);
        if (franjas.manana) manana++;
        if (franjas.tarde) tarde++;
        if (franjas.noche) noche++;
      }

      const faltanM = Math.max(0, srv.reqManana - manana);
      const faltanT = Math.max(0, srv.reqTarde - tarde);
      const faltanN = Math.max(0, srv.reqNoche - noche);

      const cubrir = (turno: CodigoTurno, cant: number) => {
        if (cant <= 0) return;
        const cfgTurno = catalogo[turno];
        const esNocturno = Boolean(cfgTurno?.esNocturnoPesado);

        const candidatos = [...filasBase]
          .filter((f) => {
            const hoy = actualMap[f.empleado.id]?.[d.dia]?.codigo || '';
            if (hoy !== '' && hoy !== 'L') return false;

            const ayer =
              d.dia === 1
                ? f.empleado.ultimoTurnoMesPrevio
                : actualMap[f.empleado.id]?.[d.dia - 1]?.codigo || '';
            const cfgAyer = catalogo[ayer];
            if (cfgAyer?.esNocturnoPesado) return false;
            const descansoDesdeAyer = this.calcularHorasDescansoEntreTurnos(cfgAyer, cfgTurno);
            if (descansoDesdeAyer !== null && descansoDesdeAyer < 12) return false;

            // Si el día siguiente ya tiene un turno operativo asignado, verificar que deje >= 12h de descanso
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
          .sort(
            (a, b) =>
              a.nuevoSaldoBanco +
              (horasExtraLoop.get(a.empleado.id) || 0) -
              (b.nuevoSaldoBanco + (horasExtraLoop.get(b.empleado.id) || 0))
          );

        for (let i = 0; i < Math.min(cant, candidatos.length); i++) {
          const cand = candidatos[i];
          const fila = { ...(actualMap[cand.empleado.id] || {}) };
          const prev = fila[d.dia]?.previsto ?? 'L';
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
            (horasExtraLoop.get(cand.empleado.id) || 0) + (cfgTurno?.horasOrdinarias || 8)
          );
          totalAsignados++;

          // Auto-protección Post-Guardia: asignar Saliente (S) en d.dia + 1 tras turno nocturno pesado
          if (esNocturno && d.dia < totalDias) {
            const sigActual = fila[d.dia + 1]?.codigo || '';
            if (!sigActual || sigActual === 'L') {
              const prevSig = fila[d.dia + 1]?.previsto ?? (sigActual || 'L');
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
    if (dia > 1) {
      const codPrev1 = map[emp1Id]?.[dia - 1]?.codigo || '';
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
    if (dia > 1) {
      const codPrev2 = map[emp2Id]?.[dia - 1]?.codigo || '';
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

        const srvNombre = this.servicios().find((s) => s.id === perm.servicioId)?.nombre || perm.servicioId;
        this.registrarLogAuditoria({
          id: 'aud-' + Date.now(),
          timestamp: new Date().toTimeString().substring(0, 8),
          actor: 'Supervisión',
          empleadoNombre: `${perm.solicitanteNombre} ⇄ ${perm.receptorNombre}`,
          servicioNombre: srvNombre,
          dia: perm.diaOrigen,
          turnoAnterior: perm.turnoOrigen,
          turnoNuevo: perm.turnoDestino,
          motivo: 'Permuta aprobada por Supervisión y aplicada en PostgreSQL',
        });

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
    this.empleadoPortalId.set(nuevoId);
    const pares = this.companerosParesPortal();
    this.companeroPermutaId.set(pares.length > 0 ? pares[0].id : '');
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
