import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, concatMap, forkJoin, map, Observable, of, Subject, switchMap } from 'rxjs';
import {
  CambioCeldaHistorial,
  CeldaAsignacion,
  CoberturaTurnoDia,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  EmpresaContratante,
  EstadoCoberturaTurno,
  InfraccionNormativa,
  MetaTurnoServicio,
  PasoHistorialEdicion,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoTurnoConfig,
  TODOS_LOS_MESES,
} from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import {
  calcularMetaNominalMesEmpleado,
  calcularMetricasMesColaborador,
  guardarStorageSeguro,
  horasLiquidadasCelda,
  leerStorageSeguro,
  obtenerTandasBreakDeTurno,
  predicadoDescansoObligatorio,
  reglasEmpresaDeEmpleado,
  resumirHorasPeriodo,
} from '../calculo-turnos.helper';
import {
  calcularDescansoEntreTurnosMin,
  calcularMetaMensualPorDiasHabiles,
  contarDiasHabilesMes,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  evaluarJornadaSemanalPeriodo,
  formatearPorcentaje,
  r2,
  seleccionarTandaBreakEquilibrada,
  TurnoLiquidable,
} from '../shared/liquidacion-horas';
import { AutocompletadoService, clasificarFranjasTurno } from './autocompletado.service';
import { CatalogosSsoStore, csvTexto, descargarArchivoCsv, numeroCsv } from './catalogos-sso.store';
import { NotificacionStore } from './notificacion.store';

export interface FilaCoberturaTurno {
  codigoTurno: string;
  nombreTurno: string;
  colorHex: string;
  textHex: string;
  borderHex: string;
  horario: string;
  minimoBase: number;
  esperadoBase: number;
  minimoDomFest: number;
  esperadoDomFest: number;
  esOperativoDia: boolean;
  esNocturno: boolean;
  dias: Record<number, CoberturaTurnoDia>;
}

export interface OcupacionTandaBreak {
  orden: number;
  etiqueta: string;
  inicio: string;
  fin: string;
  asignados: number;
  maxSimultaneos: number;
  enAlerta: boolean;
  empleadosIds: string[];
}

export interface ResumenTandasBreakDia {
  dia: number;
  codigoTurno: string;
  recesoHabilitado: boolean;
  recesoRemunerado: boolean;
  maxSimultaneos: number;
  totalColaboradoresTurno: number;
  tandas: OcupacionTandaBreak[];
  tieneAlerta: boolean;
}

export interface AlertaSimultaneidadBreak {
  dia: number;
  codigoTurno: string;
  tandaOrden: number;
  etiqueta: string;
  inicio: string;
  fin: string;
  asignados: number;
  maxSimultaneos: number;
}

export interface ResumenSimultaneidadBreaksServicio {
  totalAlertas: number;
  alertasPorDia: Record<number, AlertaSimultaneidadBreak[]>;
  ocupacionPorClave: Record<string, OcupacionTandaBreak>;
}

export interface ResumenCoberturaTurnosServicio {
  usaMetasPorTurno: boolean;
  filasTurnos: FilaCoberturaTurno[];
  rojos: number;
  amarillos: number;
  verdes: number;
  excedentes: number;
}

@Injectable({ providedIn: 'root' })
export class CuadranteStore {
  private readonly api = inject(TurnosApiService);
  private readonly notificacion = inject(NotificacionStore);
  private readonly catalogos = inject(CatalogosSsoStore);
  private readonly autocompletado = inject(AutocompletadoService);

  readonly estadosPorCuadrante = signal<Record<string, 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'>>({});
  readonly estadoCuadrante = computed<'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | 'SIN_PLANIFICAR'>(() => {
    const key = `${this.catalogos.servicioSeleccionadoId()}::${this.catalogos.anioSeleccionado()}-${this.catalogos.mesSeleccionado()}`;
    return this.estadosPorCuadrante()[key] || 'SIN_PLANIFICAR';
  });

  readonly aniosDisponibles = computed<number[]>(() => {
    const anios = new Set<number>();
    const minAnio = Math.min(this.catalogos.anioActual - 2, this.catalogos.anioSeleccionado());
    const maxAnio = Math.max(this.catalogos.anioActual + 2, this.catalogos.anioSeleccionado());
    for (let a = minAnio; a <= maxAnio; a++) {
      anios.add(a);
    }
    for (const key of Object.keys(this.estadosPorCuadrante())) {
      const m = key.match(/::(\d{4})-\d{1,2}$/);
      if (m) anios.add(Number(m[1]));
    }
    return Array.from(anios).sort((a, b) => a - b);
  });

  readonly mesesDisponiblesPlanificador = computed<Array<{ valor: number; nombre: string }>>(() => TODOS_LOS_MESES);
  readonly mesesDisponiblesReportes = computed<Array<{ valor: number; nombre: string }>>(() => TODOS_LOS_MESES);

  readonly filtroCategoriaActiva = signal<string>('TODAS');
  readonly modalRotacionAbierto = signal<boolean>(false);

  // Personal de apoyo / rotado persistido localmente por servicio
  readonly empleadosRotadosPorServicio = signal<Record<string, string[]>>(
    leerStorageSeguro<Record<string, string[]>>('rafa_turnos_rotados_servicio', {})
  );

  // Herramienta Pincel / Selector, Navegación y Clonación Ctrl
  readonly turnoPincelActivo = signal<string>('POINTER');
  readonly autoAvanzarAlTeclear = signal<boolean>(true);
  readonly pintandoConRaton = signal<boolean>(false);
  readonly celdaEnfocada = signal<{ empId: string; dia: number } | null>(null);
  readonly teclaCtrlPresionada = signal<boolean>(false);
  readonly clonandoConCtrl = signal<boolean>(false);
  readonly turnoClonandoConCtrl = signal<CodigoTurno | null>(null);

  // Estado Reactivo de Asignaciones en Memoria (independiente por Año-Mes)
  readonly asignacionesPorPeriodo = signal<Record<string, Record<string, Record<number, CeldaAsignacion>>>>({});
  readonly asignaciones = computed<Record<string, Record<number, CeldaAsignacion>>>(() => {
    const key = `${this.catalogos.anioSeleccionado()}-${this.catalogos.mesSeleccionado()}`;
    return this.asignacionesPorPeriodo()[key] || {};
  });

  // Mapa de Saldos Consolidados de Banco de Horas (PostgreSQL)
  readonly saldosConsolidadosMap = signal<Record<string, number>>({});

  // Pilas de Deshacer (Ctrl+Z) y Rehacer (Ctrl+Y)
  readonly pilaDeshacer = signal<PasoHistorialEdicion[]>([]);
  readonly pilaRehacer = signal<PasoHistorialEdicion[]>([]);
  private loteArrastreActual: CambioCeldaHistorial[] = [];

  // Novedades y Ausencias Oficiales desde Intranet Hospitalaria
  readonly sincronizandoNovedades = signal<boolean>(false);
  readonly listaNovedades = signal<any[]>([]);
  readonly ultimaSincronizacionIntranet = signal<string>('');

  // Notifica a PermutasAuditoriaStore tras mutaciones sobre cuadrantes publicados sin crear ciclo
  readonly cuadranteEditadoPublicado$ = new Subject<void>();
  // Notifica al Drawer Inspector de Celda cuando cambia el turno, nota, fijación o apoyo
  readonly celdaHistorialActualizada$ = new Subject<{ empId?: string; dia?: number }>();

  constructor() {
    this.catalogos.empleadosActualizados$
      .pipe(takeUntilDestroyed())
      .subscribe((emps) => {
        this.inicializarMatrizCuadrante(emps);
      });

    this.catalogos.empresasActualizadas$
      .pipe(
        switchMap(() => this.crearObsCuadrantesAnio(this.catalogos.anioSeleccionado())),
        takeUntilDestroyed()
      )
      .subscribe();
  }

  private guardarRotadosEnStorage(mapa: Record<string, string[]>): void {
    guardarStorageSeguro('rafa_turnos_rotados_servicio', mapa);
  }

  private actualizarAsignacionesMesActual(
    nuevoMapa: Record<string, Record<number, CeldaAsignacion>>
  ): void {
    const key = `${this.catalogos.anioSeleccionado()}-${this.catalogos.mesSeleccionado()}`;
    this.asignacionesPorPeriodo.update((todo) => ({ ...todo, [key]: nuevoMapa }));
  }

  private resolverEmpleadoConEmpresaActual(
    emp: EmpleadoHospital,
    empresasMap: Map<string, EmpresaContratante>
  ): EmpleadoHospital {
    const empresaId = emp.empresaContratanteId || emp.empresaContratante?.id;
    const empresaActual = empresaId ? empresasMap.get(empresaId) : undefined;
    if (!empresaActual) return emp;
    const hAplicadas = emp.horasSemanalesOverride ?? empresaActual.horasSemanalesContrato;
    return {
      ...emp,
      empresaContratanteId: empresaActual.id,
      empresaContratante: empresaActual,
      horasSemanalesAplicadas: hAplicadas,
    };
  }

  readonly listaTurnosPaleta = computed<TipoTurnoConfig[]>(() => {
    const srv = this.catalogos.servicioActual();
    const filtroCat = this.filtroCategoriaActiva();
    const reglaCat =
      filtroCat !== 'TODAS'
        ? (srv?.reglasPorCargo || []).find((r) => r.categoriaNombre === filtroCat)
        : undefined;

    const codigosMetas = (srv?.metasPorTurno || [])
      .filter((m) => m.habilitado !== false)
      .map((m) => m.codigoTurno);

    const listaCodigosBase =
      reglaCat?.turnosHabilitados && reglaCat.turnosHabilitados.length > 0
        ? reglaCat.turnosHabilitados
        : srv?.turnosHabilitados && srv.turnosHabilitados.length > 0
          ? Array.from(new Set([...srv.turnosHabilitados, ...codigosMetas]))
          : codigosMetas.length > 0
            ? codigosMetas
            : null;

    const habilitadosSrv = listaCodigosBase
      ? new Set(listaCodigosBase.map((c) => c.toUpperCase()))
      : null;
    const codigosBaseDescanso = new Set(['L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM']);

    return this.catalogos.listaTurnosActivosCatalogo().filter((t) => {
      if (t.visibleEnPaleta === false) return false;
      if (!habilitadosSrv) return true;
      const codUp = t.codigo.toUpperCase();
      return (
        habilitadosSrv.has(codUp) ||
        codigosBaseDescanso.has(codUp) ||
        Boolean(t.horasOrdinarias === 0 && (t.prorrateaMetaContrato || t.descuentaBancoHoras || t.esSistemaObligatorio))
      );
    });
  });

  readonly diasDelMes = computed<DiaColumna[]>(() => {
    this.catalogos.versionCacheFestivos();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const totalDias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    const letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const resultado: DiaColumna[] = [];

    for (let d = 1; d <= totalDias; d++) {
      const fechaObj = new Date(Date.UTC(anio, mes - 1, d));
      const dow = fechaObj.getUTCDay();
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
        esHoy: anio === this.catalogos.anioActual && mes === this.catalogos.mesActual && d === this.catalogos.diaActual,
        festivo,
      });
    }
    return resultado;
  });

  readonly categoriasEnServicioActual = computed<string[]>(() => {
    const emps = this.empleadosServicioSinFiltro().map((x) => x.emp);
    return Array.from(new Set(emps.map((e) => e.categoria))).sort();
  });

  readonly empleadosServicioSinFiltro = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const srvId = this.catalogos.servicioSeleccionadoId();
    const todos = this.catalogos.empleados();
    const idsRotados = new Set(this.empleadosRotadosPorServicio()[srvId] || []);

    const matriz = this.asignaciones();
    for (const emp of todos) {
      if (emp.servicioBaseId !== srvId && !idsRotados.has(emp.id)) {
        const celdasEmp = matriz[emp.id];
        if (celdasEmp) {
          const tieneTurnoEnServicio = Object.values(celdasEmp).some(
            (c) => c && c.codigo && c.codigo !== '' && c.servicioEjecutorId === srvId
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

  readonly empleadosDelCuadrante = computed<{ emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const lista = this.empleadosServicioSinFiltro();
    const filtroCat = this.filtroCategoriaActiva();
    if (filtroCat !== 'TODAS') {
      return lista.filter((item) => item.emp.categoria === filtroCat);
    }
    return lista;
  });

  readonly conteoPorCategoriaCuadrante = computed<Record<string, number>>(() => {
    const conteo: Record<string, number> = {};
    for (const { emp } of this.empleadosDelCuadrante()) {
      conteo[emp.categoria] = (conteo[emp.categoria] || 0) + 1;
    }
    return conteo;
  });

  obtenerUltimoTurnoMesPrevio(empId: string, fallback: CodigoTurno = 'L'): CodigoTurno {
    return this.obtenerUltimoTurnoMesPrevioEnPeriodo(
      empId,
      this.catalogos.anioSeleccionado(),
      this.catalogos.mesSeleccionado(),
      fallback
    );
  }

  obtenerUltimoTurnoMesPrevioEnPeriodo(
    empId: string,
    anio: number,
    mes: number,
    fallback: CodigoTurno = 'L'
  ): CodigoTurno {
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const ultimoDiaPrev = new Date(Date.UTC(anioPrev, mesPrev, 0)).getUTCDate();
    const codPrev = this.asignacionesPorPeriodo()[`${anioPrev}-${mesPrev}`]?.[empId]?.[ultimoDiaPrev]?.codigo;
    return (codPrev || fallback) as CodigoTurno;
  }

  // Mapa dinámico y continuo de Banco de Horas consolidado por empleado y periodo (empId::anio-mes)
  readonly mapaSaldosContinuos = computed<Record<string, { saldoInicial: number; saldoFinal: number }>>(() => {
    this.catalogos.versionCacheFestivos();
    const empresasMap = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const emps = this.catalogos.empleados();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const asignaciones = this.asignacionesPorPeriodo();
    const saldosOficialesDb = this.saldosConsolidadosMap();
    const estados = this.estadosPorCuadrante();
    const anio = this.catalogos.anioSeleccionado();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));
    const esDescansoPred = predicadoDescansoObligatorio();
    const habilesPorMes = Array.from({ length: 12 }, (_, idx) =>
      contarDiasHabilesMes(anio, idx + 1, predFest).diasHabilesMes
    );

    const mapa: Record<string, { saldoInicial: number; saldoFinal: number }> = {};

    for (const empRaw of emps) {
      const emp = this.resolverEmpleadoConEmpresaActual(empRaw, empresasMap);
      const reglas = reglasEmpresaDeEmpleado(emp);
      let saldoAcumulado = 0;

      const keyPrevAnio = `${emp.id}::${anio - 1}-12`;
      if (saldosOficialesDb[keyPrevAnio] !== undefined) {
        saldoAcumulado = r2(saldosOficialesDb[keyPrevAnio]);
      } else if (emp.saldoBancoOrigen && emp.saldoBancoOrigen.anio < anio) {
        saldoAcumulado = r2(emp.saldoBancoOrigen.saldo);
      } else if (anio === this.catalogos.anioActual && emp.saldoBancoOrigen === undefined) {
        saldoAcumulado = r2(emp.saldoBancoAnterior);
      }

      for (let m = 1; m <= 12; m++) {
        const periodoKey = `${anio}-${m}`;
        const saldoKey = `${emp.id}::${periodoKey}`;
        const celdasEmp = asignaciones[periodoKey]?.[emp.id];

        const { horasTrabajadas, horasAmortizadasComp, diasHabilesProrrateados } = resumirHorasPeriodo(
          celdasEmp,
          anio,
          m,
          catalogo,
          esDescansoPred,
          reglas,
          predFest
        );

        const tieneActividadOperativa = horasTrabajadas > 0 || horasAmortizadasComp > 0;
        const serviciosDelEmp = new Set<string>([emp.servicioBaseId]);
        if (celdasEmp) {
          for (const celda of Object.values(celdasEmp)) {
            if (celda?.servicioEjecutorId && celda.codigo && celda.codigo !== '' && celda.codigo !== 'L') {
              serviciosDelEmp.add(celda.servicioEjecutorId);
            }
          }
        }
        const estadoBase = estados[`${emp.servicioBaseId}::${periodoKey}`];
        const esMesOficialConsolidado = Array.from(serviciosDelEmp).some((srvId) => {
          const est = estados[`${srvId}::${periodoKey}`];
          return est === 'PUBLICADO' || est === 'CERRADO_NOMINA';
        });

        const saldoInicialMes = r2(saldoAcumulado);
        let saldoFinalMes = saldoInicialMes;

        if (reglas.usaBancoHoras === false) {
          saldoFinalMes = saldoInicialMes;
          if (esMesOficialConsolidado) {
            saldoAcumulado = saldoFinalMes;
          }
        } else if (tieneActividadOperativa) {
          const metaMes = calcularMetaMensualPorDiasHabiles(
            reglas.horasSemanalesContrato,
            habilesPorMes[m - 1],
            diasHabilesProrrateados,
            reglas.diasBaseSemana
          );
          const diferenciaMes = r2(
            horasTrabajadas - metaMes.horasContratadasEfectivas - horasAmortizadasComp
          );
          saldoFinalMes = r2(saldoInicialMes + diferenciaMes);
          if (esMesOficialConsolidado) {
            saldoAcumulado = saldoFinalMes;
          }
        } else if (estadoBase === 'CERRADO_NOMINA' && saldosOficialesDb[saldoKey] !== undefined) {
          saldoFinalMes = r2(saldosOficialesDb[saldoKey]);
          saldoAcumulado = saldoFinalMes;
        } else {
          saldoFinalMes = saldoInicialMes;
        }

        mapa[saldoKey] = {
          saldoInicial: saldoInicialMes,
          saldoFinal: saldoFinalMes,
        };
      }
    }

    return mapa;
  });

  readonly empleadosConSaldoActualizado = computed<EmpleadoHospital[]>(() => {
    this.catalogos.versionCacheFestivos();
    const empresasMap = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const emps = this.catalogos.empleados();
    const mapa = this.mapaSaldosContinuos();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const periodoKey = `${anio}-${mes}`;
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const estados = this.estadosPorCuadrante();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const saldos = this.saldosConsolidadosMap();
    const esDescansoPred = predicadoDescansoObligatorio();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));

    return emps.map((eRaw) => {
      const e = this.resolverEmpleadoConEmpresaActual(eRaw, empresasMap);
      const key = `${e.id}::${periodoKey}`;
      const saldoObj = mapa[key];
      const celdasEmp = matriz[e.id] || {};
      const metricas = calcularMetricasMesColaborador(
        e,
        celdasEmp,
        dias,
        catalogo,
        saldos,
        anio,
        mes,
        saldoObj?.saldoInicial,
        esDescansoPred,
        predFest
      );
      const tieneActividadMes = metricas.horasTrabajadas > 0 || metricas.horasAmortizadasComp > 0;
      const serviciosEmp = new Set<string>([e.servicioBaseId]);
      for (const celda of Object.values(celdasEmp)) {
        if (celda?.servicioEjecutorId && celda.codigo && celda.codigo !== '' && celda.codigo !== 'L') {
          serviciosEmp.add(celda.servicioEjecutorId);
        }
      }
      const cuadranteMesConsolidado = Array.from(serviciosEmp).some((srvId) => {
        const est = estados[`${srvId}::${periodoKey}`];
        return est === 'PUBLICADO' || est === 'CERRADO_NOMINA';
      });
      const saldoBancoActual = r2(
        tieneActividadMes ? metricas.nuevoSaldoBanco : (saldoObj?.saldoFinal ?? metricas.nuevoSaldoBanco)
      );
      const saldoBancoDiferenciaMes = r2(saldoBancoActual - metricas.saldoAntReal);

      return {
        ...e,
        horasSemanalesAplicadas: metricas.horasSemanalesAplicadas,
        horasContratoMes: metricas.horasContratadasNominales,
        horasContratadasEfectivas: metricas.horasContratadasEfectivas,
        horasExoneradasMes: metricas.horasExoneradas,
        diasProrrateadosMes: metricas.diasHabilesProrrateados,
        saldoBancoAnterior: metricas.saldoAntReal,
        saldoBancoActual,
        saldoBancoDiferenciaMes,
        tieneActividadMes,
        cuadranteMesConsolidado,
      };
    });
  });

  readonly filasServicioCompletas = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const empresasMap = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const listaEmp = this.empleadosServicioSinFiltro();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const saldos = this.saldosConsolidadosMap();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const mapaContinuo = this.mapaSaldosContinuos();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const mapaServicios = new Map(this.catalogos.servicios().map((s) => [s.id, s]));
    const esDescansoPredicado = predicadoDescansoObligatorio();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));

    return listaEmp.map(({ emp: empRaw, esRotado }) => {
      const emp = this.resolverEmpleadoConEmpresaActual(empRaw, empresasMap);
      const reglas = reglasEmpresaDeEmpleado(emp);
      const celdasEmp = matriz[emp.id] || {};
      const keyPeriodo = `${emp.id}::${anio}-${mes}`;
      const saldoCalculado = mapaContinuo[keyPeriodo]?.saldoInicial;

      const metricas = calcularMetricasMesColaborador(
        emp,
        celdasEmp,
        dias,
        catalogo,
        saldos,
        anio,
        mes,
        saldoCalculado,
        esDescansoPredicado,
        predFest
      );
      const ultimoTurnoPrevReal = this.obtenerUltimoTurnoMesPrevio(
        emp.id,
        emp.ultimoTurnoMesPrevio || 'L'
      );
      const empConSaldo: EmpleadoHospital = {
        ...emp,
        horasSemanalesAplicadas: metricas.horasSemanalesAplicadas,
        horasContratoMes: metricas.horasContratadasNominales,
        saldoBancoAnterior: metricas.saldoAntReal,
        ultimoTurnoMesPrevio: ultimoTurnoPrevReal,
      };

      let horasLocales = 0;
      let horasOtrosServicios = 0;
      const horasPorServicioMap = new Map<string, number>();

      for (const d of dias) {
        const celda = celdasEmp[d.dia];
        const cod = celda?.codigo || '';
        if (!cod) continue;
        const cfg = catalogo[cod];
        if (!cfg || cfg.esAusencia) continue;
        const hOrd = horasLiquidadasCelda(cfg, d.fechaIso, esDescansoPredicado, reglas, celda);
        if (hOrd <= 0) continue;

        const ejecutorId = celda?.servicioEjecutorId || emp.servicioBaseId;
        horasPorServicioMap.set(
          ejecutorId,
          (horasPorServicioMap.get(ejecutorId) || 0) + hOrd
        );
        if (ejecutorId === srvId) {
          horasLocales += hOrd;
        } else {
          horasOtrosServicios += hOrd;
        }
      }

      const desgloseServicios: Array<{
        servicioId: string;
        codigo: string;
        nombre: string;
        horas: number;
      }> = [];
      for (const [idSrv, h] of horasPorServicioMap.entries()) {
        const srvObj = mapaServicios.get(idSrv);
        desgloseServicios.push({
          servicioId: idSrv,
          codigo: srvObj?.codigo || 'SRV',
          nombre: srvObj?.nombre || idSrv,
          horas: h,
        });
      }

      const srvBaseObj = mapaServicios.get(emp.servicioBaseId);

      return {
        empleado: empConSaldo,
        esPersonalRotado: esRotado,
        servicioOrigenCodigo: srvBaseObj?.codigo || 'APOYO',
        servicioOrigenNombre: srvBaseObj?.nombre || 'Servicio Hermano',
        horasLocales,
        horasOtrosServicios,
        desgloseServicios,
        celdas: celdasEmp,
        ...metricas,
      };
    });
  });

  readonly filasCuadrante = computed(() => {
    const todas = this.filasServicioCompletas();
    const filtroCat = this.filtroCategoriaActiva();
    if (filtroCat !== 'TODAS') {
      return todas.filter((f) => f.empleado.categoria === filtroCat);
    }
    return todas;
  });

  readonly resumenSimultaneidadBreaks = computed<ResumenSimultaneidadBreaksServicio>(() => {
    const dias = this.diasDelMes();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const filas = this.filasServicioCompletas();

    const ocupacionPorClave: Record<string, OcupacionTandaBreak> = {};
    const alertasPorDia: Record<number, AlertaSimultaneidadBreak[]> = {};
    let totalAlertas = 0;

    for (const d of dias) {
      // Agrupar colaboradores activos en este servicio en d.dia por código de turno
      const porTurno = new Map<string, Array<{ empId: string; celda: CeldaAsignacion }>>();
      for (const f of filas) {
        const celda = f.celdas[d.dia];
        const cod = (celda?.codigo || '').trim().toUpperCase();
        if (!cod) continue;
        const ejecutorId = celda?.servicioEjecutorId || f.empleado.servicioBaseId;
        if (ejecutorId !== srvId) continue;
        const cfg = catalogo[cod];
        if (!cfg || !cfg.recesoHabilitado || cfg.esAusencia) continue;
        const lista = porTurno.get(cod) || [];
        lista.push({ empId: f.empleado.id, celda });
        porTurno.set(cod, lista);
      }

      for (const [cod, items] of porTurno.entries()) {
        const cfg = catalogo[cod];
        if (!cfg) continue;
        const tandas = obtenerTandasBreakDeTurno(cfg);
        if (tandas.length === 0) continue;
        const maxSim = Math.max(1, Number(cfg.recesoMaxSimultaneos || 1));

        for (const t of tandas) {
          ocupacionPorClave[`${d.dia}::${cod}::${t.orden}`] = {
            orden: t.orden,
            etiqueta: t.etiqueta || `T${t.orden}`,
            inicio: t.inicio,
            fin: t.fin,
            asignados: 0,
            maxSimultaneos: maxSim,
            enAlerta: false,
            empleadosIds: [],
          };
        }

        for (const { empId, celda } of items) {
          const ordenBase = celda.breakTandaOrden ?? tandas[0].orden;
          const tMatch = tandas.find((t) => t.orden === ordenBase) || tandas[0];
          const key = `${d.dia}::${cod}::${tMatch.orden}`;
          const bucket = ocupacionPorClave[key];
          if (bucket) {
            bucket.asignados++;
            bucket.empleadosIds.push(empId);
            if (bucket.asignados > maxSim) {
              bucket.enAlerta = true;
            }
          }
        }

        for (const t of tandas) {
          const bucket = ocupacionPorClave[`${d.dia}::${cod}::${t.orden}`];
          if (bucket && bucket.enAlerta) {
            totalAlertas++;
            if (!alertasPorDia[d.dia]) alertasPorDia[d.dia] = [];
            alertasPorDia[d.dia].push({
              dia: d.dia,
              codigoTurno: cod,
              tandaOrden: bucket.orden,
              etiqueta: bucket.etiqueta,
              inicio: bucket.inicio,
              fin: bucket.fin,
              asignados: bucket.asignados,
              maxSimultaneos: maxSim,
            });
          }
        }
      }
    }

    return {
      totalAlertas,
      alertasPorDia,
      ocupacionPorClave,
    };
  });

  obtenerResumenTandasDia(srvId: string, dia: number, codigoTurno: string): ResumenTandasBreakDia | null {
    const codUpper = (codigoTurno || '').trim().toUpperCase();
    if (!codUpper) return null;
    const cfg = this.catalogos.catalogoTurnosMap()[codUpper];
    if (!cfg || !cfg.recesoHabilitado || cfg.esAusencia) return null;

    const tandas = obtenerTandasBreakDeTurno(cfg);
    if (tandas.length === 0) return null;
    const maxSim = Math.max(1, Number(cfg.recesoMaxSimultaneos || 1));

    const matriz = this.asignaciones();
    const empleados = this.catalogos.empleados();
    const ocupacionMap = new Map<number, OcupacionTandaBreak>();
    for (const t of tandas) {
      ocupacionMap.set(t.orden, {
        orden: t.orden,
        etiqueta: t.etiqueta || `T${t.orden}`,
        inicio: t.inicio,
        fin: t.fin,
        asignados: 0,
        maxSimultaneos: maxSim,
        enAlerta: false,
        empleadosIds: [],
      });
    }

    let totalColaboradoresTurno = 0;
    for (const emp of empleados) {
      const celda = matriz[emp.id]?.[dia];
      const cod = (celda?.codigo || '').trim().toUpperCase();
      if (cod !== codUpper) continue;
      const ejecutorId = celda?.servicioEjecutorId || emp.servicioBaseId;
      if (ejecutorId !== srvId) continue;

      totalColaboradoresTurno++;
      const ordenBase = celda?.breakTandaOrden ?? tandas[0].orden;
      const tMatch = tandas.find((t) => t.orden === ordenBase) || tandas[0];
      const bucket = ocupacionMap.get(tMatch.orden);
      if (bucket) {
        bucket.asignados++;
        bucket.empleadosIds.push(emp.id);
        bucket.enAlerta = bucket.asignados > maxSim;
      }
    }

    const tandasResumen = Array.from(ocupacionMap.values()).sort((a, b) => a.orden - b.orden);
    return {
      dia,
      codigoTurno: codUpper,
      recesoHabilitado: true,
      recesoRemunerado: Boolean(cfg.recesoRemunerado),
      maxSimultaneos: maxSim,
      totalColaboradoresTurno,
      tandas: tandasResumen,
      tieneAlerta: tandasResumen.some((t) => t.enAlerta),
    };
  }

  readonly coberturaPorDia = computed<Record<number, { dia: number; noche: number }>>(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const filtroCat = this.filtroCategoriaActiva();
    const empsDelCuadrante = this.empleadosServicioSinFiltro().filter(
      ({ emp }) => filtroCat === 'TODAS' || emp.categoria === filtroCat
    );
    const catalogo = this.catalogos.catalogoTurnosMap();
    const resultado: Record<number, { dia: number; noche: number }> = {};

    for (const d of dias) {
      let dia = 0;
      let noche = 0;

      for (const { emp } of empsDelCuadrante) {
        const celda = matriz[emp.id]?.[d.dia];
        const cod = celda?.codigo || '';
        if (!cod) continue;
        if (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srvId) {
          continue;
        }
        const franjas = clasificarFranjasTurno(catalogo[cod]);
        if (franjas.dia) dia++;
        if (franjas.noche) noche++;
      }

      resultado[d.dia] = { dia, noche };
    }
    return resultado;
  });

  readonly resumenCoberturaPorTurnoYDia = computed<ResumenCoberturaTurnosServicio>(() => {
    const srv = this.catalogos.servicioActual();
    const srvId = srv?.id || this.catalogos.servicioSeleccionadoId();
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const filtroCat = this.filtroCategoriaActiva();
    const empsDelCuadrante = this.empleadosServicioSinFiltro().filter(
      ({ emp }) => filtroCat === 'TODAS' || emp.categoria === filtroCat
    );

    const mod = srv?.modalidadDias || 'TODOS_24_7';
    const reglaCat =
      filtroCat !== 'TODAS'
        ? (srv?.reglasPorCargo || []).find((r) => r.categoriaNombre === filtroCat)
        : undefined;
    const setTurnosCargo =
      reglaCat?.turnosHabilitados && reglaCat.turnosHabilitados.length > 0
        ? new Set(reglaCat.turnosHabilitados.map((c) => c.toUpperCase()))
        : null;

    // 1. Conteo diario por código de turno en el servicio actual
    const conteoDiaTurno = new Map<number, Map<string, number>>();
    for (const d of dias) {
      const porCod = new Map<string, number>();
      for (const { emp } of empsDelCuadrante) {
        const celda = matriz[emp.id]?.[d.dia];
        const cod = (celda?.codigo || '').trim().toUpperCase();
        if (!cod || cod === 'BLANCO') continue;
        if (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srvId) continue;
        const cfg = catalogo[cod];
        if (!cfg || cfg.esAusencia || cfg.horasOrdinarias <= 0) continue;
        porCod.set(cod, (porCod.get(cod) || 0) + 1);
      }
      conteoDiaTurno.set(d.dia, porCod);
    }

    // 2. Resolver metas por turno (metasPorTurno explícitas o respaldo desde turnosHabilitados)
    const metasExplicitas = (srv?.metasPorTurno || []).filter((m) => {
      if (m.habilitado === false) return false;
      const codUp = m.codigoTurno.trim().toUpperCase();
      if (setTurnosCargo && !setTurnosCargo.has(codUp)) return false;
      const cfg = catalogo[codUp];
      return Boolean(cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia && cfg.activo !== false);
    });

    const usaMetasPorTurno = metasExplicitas.length > 0;
    let fuentesMeta: MetaTurnoServicio[] = metasExplicitas;

    if (!usaMetasPorTurno) {
      const codsHab = (
        reglaCat?.turnosHabilitados && reglaCat.turnosHabilitados.length > 0
          ? reglaCat.turnosHabilitados
          : srv?.turnosHabilitados || []
      ).filter((c) => {
        const cfg = catalogo[c.trim().toUpperCase()];
        return Boolean(cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia && cfg.activo !== false);
      });
      const diurnosCount = codsHab.filter((c) => clasificarFranjasTurno(catalogo[c.toUpperCase()]).dia).length;
      const nocturnosCount = codsHab.filter((c) => clasificarFranjasTurno(catalogo[c.toUpperCase()]).noche).length;

      fuentesMeta = codsHab.map((codRaw) => {
        const cod = codRaw.trim().toUpperCase();
        const cfg = catalogo[cod];
        const fr = clasificarFranjasTurno(cfg);
        const espBase = fr.noche && !fr.dia
          ? Math.max(0, Math.ceil((srv?.reqNoche || 0) / Math.max(1, nocturnosCount)))
          : fr.dia && !fr.noche
            ? Math.max(0, Math.ceil((srv?.reqDia || 0) / Math.max(1, diurnosCount)))
            : Math.max(srv?.reqDia || 0, srv?.reqNoche || 0);
        const espDom = fr.noche && !fr.dia
          ? Math.max(0, Math.ceil((srv?.reqNocheDomFest ?? srv?.reqNoche ?? 0) / Math.max(1, nocturnosCount)))
          : fr.dia && !fr.noche
            ? Math.max(0, Math.ceil((srv?.reqDiaDomFest ?? srv?.reqDia ?? 0) / Math.max(1, diurnosCount)))
            : Math.max(srv?.reqDiaDomFest ?? srv?.reqDia ?? 0, srv?.reqNocheDomFest ?? srv?.reqNoche ?? 0);

        return {
          codigoTurno: cod,
          nombreTurno: cfg?.nombre || cod,
          colorHex: cfg?.bgHex || '#E0F2FE',
          habilitado: true,
          minimoBase: espBase > 0 ? 1 : 0,
          esperadoBase: espBase,
          minimoDomFest: espDom > 0 ? 1 : 0,
          esperadoDomFest: espDom,
        };
      });
    }

    let rojos = 0;
    let amarillos = 0;
    let verdes = 0;
    let excedentes = 0;

    const filasTurnos: FilaCoberturaTurno[] = fuentesMeta.map((m) => {
      const codUp = m.codigoTurno.trim().toUpperCase();
      const cfg = catalogo[codUp];
      const fr = clasificarFranjasTurno(cfg);
      const diasMap: Record<number, CoberturaTurnoDia> = {};

      for (const d of dias) {
        const esDomOFest = d.esDomingo || Boolean(d.festivo);
        const cerrado =
          (esDomOFest && (mod === 'LUN_VIE_HABILES' || mod === 'LUN_SAB_SIN_FESTIVOS')) ||
          (d.esSabado && mod === 'LUN_VIE_HABILES');
        const programados = conteoDiaTurno.get(d.dia)?.get(codUp) || 0;

        if (cerrado) {
          diasMap[d.dia] = {
            programados,
            minimo: 0,
            esperado: 0,
            estado: 'VERDE',
            exceso: programados,
            cerrado: true,
          };
          continue;
        }

        const minimo = Math.max(0, esDomOFest ? m.minimoDomFest : m.minimoBase);
        const esperado = Math.max(minimo, esDomOFest ? m.esperadoDomFest : m.esperadoBase);
        let estado: EstadoCoberturaTurno = 'VERDE';
        let exceso = 0;

        if (minimo === 0 && esperado === 0) {
          estado = 'VERDE';
          exceso = programados;
        } else if (programados < minimo) {
          estado = 'ROJO';
          rojos++;
        } else if (programados < esperado) {
          estado = 'AMARILLO';
          amarillos++;
        } else {
          estado = 'VERDE';
          exceso = Math.max(0, programados - esperado);
          verdes++;
          if (exceso > 0) excedentes++;
        }

        diasMap[d.dia] = {
          programados,
          minimo,
          esperado,
          estado,
          exceso,
          cerrado: false,
        };
      }

      return {
        codigoTurno: codUp,
        nombreTurno: m.nombreTurno || cfg?.nombre || codUp,
        colorHex: cfg?.bgHex || m.colorHex || '#E0F2FE',
        textHex: cfg?.textHex || '#0F172A',
        borderHex: cfg?.borderHex || '#94A3B8',
        horario: cfg?.horario || `${m.horaInicio || ''}-${m.horaFin || ''}`,
        minimoBase: m.minimoBase,
        esperadoBase: m.esperadoBase,
        minimoDomFest: m.minimoDomFest,
        esperadoDomFest: m.esperadoDomFest,
        esOperativoDia: fr.dia,
        esNocturno: fr.noche,
        dias: diasMap,
      };
    });

    return {
      usaMetasPorTurno,
      filasTurnos,
      rojos,
      amarillos,
      verdes,
      excedentes,
    };
  });

  readonly coberturaPorTurnoYDia = computed<FilaCoberturaTurno[]>(
    () => this.resumenCoberturaPorTurnoYDia().filasTurnos
  );

  readonly infraccionesActivas = computed<InfraccionNormativa[]>(() => {
    const dias = this.diasDelMes();
    const filas = this.filasServicioCompletas();
    const alertas: InfraccionNormativa[] = [];
    const catalogo = this.catalogos.catalogoTurnosMap();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const anioPrev = mes === 1 ? anio - 1 : anio;
    const mesPrev = mes === 1 ? 12 : mes - 1;
    const ultimoDiaPrev = new Date(Date.UTC(anioPrev, mesPrev, 0)).getUTCDate();
    const matrizPrev = this.asignacionesPorPeriodo()[`${anioPrev}-${mesPrev}`] || {};
    const primerDiaIso = dias[0]?.fechaIso || `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDiaIso = dias[dias.length - 1]?.fechaIso || primerDiaIso;

    for (const f of filas) {
      // 1. Validar Empalme con mes previo (Día 1)
      const prevCod = f.empleado.ultimoTurnoMesPrevio;
      const prevCfg = prevCod ? catalogo[prevCod] : undefined;
      const dia1Cod = f.celdas[1]?.codigo || '';
      const dia1Cfg = dia1Cod ? catalogo[dia1Cod] : undefined;
      const descansoMinDia1 = calcularDescansoEntreTurnosMin(prevCfg, dia1Cfg);
      const descansoDia1 = descansoMinDia1 === null ? null : Math.round((descansoMinDia1 / 60) * 10) / 10;

      if (
        prevCfg?.esNocturnoPesado &&
        dia1Cfg &&
        dia1Cfg.horasOrdinarias > 0 &&
        !dia1Cfg.esAusencia &&
        dia1Cod !== 'S' &&
        dia1Cod !== 'L'
      ) {
        alertas.push({
          empleadoId: f.empleado.id,
          empleadoNombre: f.empleado.nombre,
          dia: 1,
          mensaje: `${f.empleado.nombre} (Día 1): Infracción Empalme — Cerró mes en ${prevCod}, requiere Saliente (S) o Libre (L).`,
        });
      } else if (descansoMinDia1 !== null && descansoMinDia1 < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
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
        const descansoMin = calcularDescansoEntreTurnosMin(cfgPrev, cfgAct);
        const horasDescanso = descansoMin === null ? null : Math.round((descansoMin / 60) * 10) / 10;

        if (
          cfgPrev?.esNocturnoPesado &&
          cfgAct &&
          cfgAct.horasOrdinarias > 0 &&
          !cfgAct.esAusencia &&
          cAct !== 'S' &&
          cAct !== 'L'
        ) {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Violación Post-Guardia tras ${cPrev} → ${cAct} (Requiere Saliente S o Libre L).`,
          });
        } else if (descansoMin !== null && descansoMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Descanso insuficiente de ${horasDescanso}h tras ${cPrev} (${cfgPrev?.horaInicio}-${cfgPrev?.horaFin}) → ${cAct} (${cfgAct?.horaInicio}-${cfgAct?.horaFin}) (Mínimo legal: 12h).`,
          });
        }
      }

      // 3. Validar racha de días consecutivos laborados sin descanso (> 6 días seguidos), incluyendo borde real del mes previo
      const celdasPrevEmp = matrizPrev[f.empleado.id];
      let rachaDias = 0;
      const inicioRetro = Math.max(1, ultimoDiaPrev - 20);
      for (let dPrev = ultimoDiaPrev; dPrev >= inicioRetro; dPrev--) {
        const cP = celdasPrevEmp?.[dPrev]?.codigo || '';
        const cfgP = cP ? catalogo[cP] : undefined;
        if (cfgP && cfgP.horasOrdinarias > 0 && !cfgP.esAusencia) {
          rachaDias++;
        } else {
          break;
        }
      }
      if (rachaDias === 0 && !celdasPrevEmp && prevCfg && prevCfg.horasOrdinarias > 0 && !prevCfg.esAusencia) {
        rachaDias = 1;
      }

      for (const d of dias) {
        const cAct = f.celdas[d.dia]?.codigo || '';
        const cfgAct = cAct ? catalogo[cAct] : undefined;
        const esLaborado = Boolean(cfgAct && cfgAct.horasOrdinarias > 0 && !cfgAct.esAusencia);

        if (esLaborado) {
          rachaDias++;
          if (rachaDias > 6) {
            alertas.push({
              empleadoId: f.empleado.id,
              empleadoNombre: f.empleado.nombre,
              dia: d.dia,
              mensaje: `${f.empleado.nombre} (Día ${d.dia}): ${rachaDias} días consecutivos laborados sin descanso (${cAct}) — Máximo legal/recomendado: 6 días.`,
            });
          }
        } else {
          rachaDias = 0;
        }
      }

      // 4. Validar tope semanal (Ley 2101/2021 + Art. 22 Ley 50/1990 máx +12h extras/sem + Art. 165 CST promedio 3 semanas)
      const itemsEmp: { fechaIso: string; turno: TurnoLiquidable | undefined }[] = [];
      for (let dPrev = inicioRetro; dPrev <= ultimoDiaPrev; dPrev++) {
        const celdaP = celdasPrevEmp?.[dPrev];
        const cP = celdaP?.codigo || '';
        const cfgP = cP ? catalogo[cP] : undefined;
        if (cfgP) {
          itemsEmp.push({
            fechaIso: `${anioPrev}-${String(mesPrev).padStart(2, '0')}-${String(dPrev).padStart(2, '0')}`,
            turno:
              celdaP?.breakInicio || celdaP?.breakFin
                ? { ...cfgP, breakInicio: celdaP.breakInicio ?? null, breakFin: celdaP.breakFin ?? null }
                : cfgP,
          });
        }
      }
      for (const d of dias) {
        const celdaAct = f.celdas[d.dia];
        const cod = celdaAct?.codigo || '';
        const cfg = cod ? catalogo[cod] : undefined;
        if (cfg) {
          itemsEmp.push({
            fechaIso: d.fechaIso,
            turno:
              celdaAct?.breakInicio || celdaAct?.breakFin
                ? { ...cfg, breakInicio: celdaAct.breakInicio ?? null, breakFin: celdaAct.breakFin ?? null }
                : cfg,
          });
        }
      }

      if (itemsEmp.length > 0) {
        const evalSem = evaluarJornadaSemanalPeriodo(itemsEmp, reglasEmpresaDeEmpleado(f.empleado));
        const topeExtrasEmp = reglasEmpresaDeEmpleado(f.empleado).topeHorasExtrasSemanal ?? 12;
        const aplicaTopeEmp = reglasEmpresaDeEmpleado(f.empleado).aplicaTopeHorasExtrasSemanal !== false;
        for (const w of evalSem.semanas) {
          if (!w.excedeTopeAbsoluto || w.semanaFinIso < primerDiaIso || w.semanaInicioIso > ultimoDiaIso) {
            continue;
          }
          const diaAnclaObj = [...dias].reverse().find((d) => {
            if (d.fechaIso < w.semanaInicioIso || d.fechaIso > w.semanaFinIso) return false;
            const cfg = catalogo[f.celdas[d.dia]?.codigo || ''];
            return Boolean(cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia);
          });
          if (!diaAnclaObj) continue;
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: diaAnclaObj.dia,
            mensaje: `${f.empleado.nombre} (Sem ${w.semanaInicioIso.slice(5)}): Excede tope legal de ${aplicaTopeEmp ? w.limiteOrdinarioVigente + topeExtrasEmp : w.limiteOrdinarioVigente}h/sem (${w.horasTotales}h programadas; jornada ${w.limiteOrdinarioVigente}h + ${topeExtrasEmp}h extras máx.).`,
          });
        }
        for (const prom of evalSem.promedios3SemanasExcedidos) {
          if (prom.hastaSemana < primerDiaIso || prom.desdeSemana > ultimoDiaIso) continue;
          const diaAnclaObj = [...dias].reverse().find((d) => {
            if (d.fechaIso < prom.desdeSemana || d.fechaIso > prom.hastaSemana) return false;
            const cfg = catalogo[f.celdas[d.dia]?.codigo || ''];
            return Boolean(cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia);
          });
          if (!diaAnclaObj) continue;
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: diaAnclaObj.dia,
            mensaje: `${f.empleado.nombre} (Tri-semana ${prom.desdeSemana.slice(5)}..${prom.hastaSemana.slice(5)}): Promedio 3 semanas (${prom.promedio}h/sem) supera jornada legal de ${prom.limite}h/sem (Art. 165 CST / Ley 2101).`,
          });
        }
      }
    }
    return alertas;
  });

  readonly reglaCargoActivaEnCuadrante = computed<ReglaCargoServicio | undefined>(() => {
    const cat = this.filtroCategoriaActiva();
    if (!cat || cat === 'TODAS') return undefined;
    const srv = this.catalogos.servicioActual();
    return (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === cat);
  });

  readonly obtenerMetasDiaServicioFn = (
    srv: ServicioHospitalario,
    d: DiaColumna,
    categoriaEspecifica?: string
  ): { reqDia: number; reqNoche: number; cerrado: boolean } => {
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

    if (catFiltro && (srv.reglasPorCargo?.length || 0) > 0 && !reglaCargo) {
      return { reqDia: 0, reqNoche: 0, cerrado: false };
    }

    const baseD = reglaCargo ? reglaCargo.reqDia : srv.reqDia;
    const baseN = reglaCargo ? reglaCargo.reqNoche : srv.reqNoche;
    const domFestD = reglaCargo ? (reglaCargo.reqDiaDomFest ?? baseD) : (srv.reqDiaDomFest ?? baseD);
    const domFestN = reglaCargo ? (reglaCargo.reqNocheDomFest ?? baseN) : (srv.reqNocheDomFest ?? baseN);

    const turnosHab =
      reglaCargo?.turnosHabilitados && reglaCargo.turnosHabilitados.length > 0
        ? reglaCargo.turnosHabilitados
        : srv.turnosHabilitados && srv.turnosHabilitados.length > 0
          ? srv.turnosHabilitados
          : [];

    const catalogo = this.catalogos.catalogoTurnosMap();
    const tieneDia =
      turnosHab.length === 0 ||
      turnosHab.some((c) => {
        const cfg = catalogo[c.toUpperCase()];
        return cfg && clasificarFranjasTurno(cfg).dia;
      });
    const tieneNoche =
      turnosHab.length === 0 ||
      turnosHab.some((c) => {
        const cfg = catalogo[c.toUpperCase()];
        return cfg && clasificarFranjasTurno(cfg).noche;
      });

    const efD = tieneDia ? baseD : 0;
    const efN = tieneNoche ? baseN : 0;
    const efDomFestD = tieneDia ? domFestD : 0;
    const efDomFestN = tieneNoche ? domFestN : 0;

    if (esDomOFest) {
      if (mod === 'LUN_VIE_HABILES' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return { reqDia: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS') {
        return {
          reqDia: efDomFestD,
          reqNoche: efDomFestN,
          cerrado: false,
        };
      }
      return {
        reqDia: efD,
        reqNoche: efN,
        cerrado: false,
      };
    }

    if (d.esSabado && mod === 'LUN_VIE_HABILES') {
      return { reqDia: 0, reqNoche: 0, cerrado: true };
    }

    return {
      reqDia: efD,
      reqNoche: efN,
      cerrado: false,
    };
  };

  readonly porcentajeCoberturaGlobal = computed<number>(() => {
    const resumen = this.resumenCoberturaPorTurnoYDia();
    if (resumen.usaMetasPorTurno) {
      let totalChecks = 0;
      let cumplidos = 0;
      for (const fila of resumen.filasTurnos) {
        for (const cell of Object.values(fila.dias)) {
          if (cell.cerrado || (cell.minimo === 0 && cell.esperado === 0)) continue;
          totalChecks++;
          if (cell.estado === 'VERDE') {
            cumplidos += 1;
          } else if (cell.estado === 'AMARILLO') {
            cumplidos += 0.5;
          }
        }
      }
      return totalChecks > 0 ? Math.round((cumplidos / totalChecks) * 100) : 100;
    }

    const dias = this.diasDelMes();
    const srv = this.catalogos.servicioActual();
    const cob = this.coberturaPorDia();
    let totalChecks = 0;
    let cumplidos = 0;

    for (const d of dias) {
      const metas = this.obtenerMetasDiaServicioFn(srv, d);
      if (metas.cerrado) continue;
      const c = cob[d.dia];
      if (metas.reqDia > 0) {
        totalChecks++;
        if (c.dia >= metas.reqDia) cumplidos++;
      }
      if (metas.reqNoche > 0) {
        totalChecks++;
        if (c.noche >= metas.reqNoche) cumplidos++;
      }
    }
    return totalChecks > 0 ? Math.round((cumplidos / totalChecks) * 100) : 100;
  });

  readonly empresasPendientesEnCuadrante = computed<EmpresaContratante[]>(() => {
    const mapaEmpresas = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const pendientes = new Map<string, EmpresaContratante>();
    for (const { emp } of this.empleadosServicioSinFiltro()) {
      const empId = emp.empresaContratanteId || emp.empresaContratante?.id;
      const empresa =
        (empId ? mapaEmpresas.get(empId) : undefined) ||
        (emp.empresaContratante as EmpresaContratante | undefined);
      if (empresa && empresa.id && empresa.estadoConfiguracion === 'PENDIENTE_REGLAS') {
        pendientes.set(empresa.id, empresa);
      }
    }
    return Array.from(pendientes.values());
  });

  readonly balanceGlobalBancoServicio = computed<number>(() =>
    r2(this.filasCuadrante().reduce((acc, f) => acc + f.nuevoSaldoBanco, 0))
  );

  readonly candidatosRotacionHomologos = computed<any[]>(() => {
    const srvActual = this.catalogos.servicioActual();
    const idsHermanos = (srvActual.hermanos || []).map((h) => h.id);
    const todos = this.empleadosConSaldoActualizado();
    const yaIncluidos = new Set(this.empleadosServicioSinFiltro().map((x) => x.emp.id));
    const matriz = this.asignaciones();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const dias = this.diasDelMes();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const predDesc = predicadoDescansoObligatorio();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));
    const mapaServicios = new Map(this.catalogos.servicios().map((s) => [s.id, s]));

    const cargosIds =
      srvActual.cargosPermitidosIds && srvActual.cargosPermitidosIds.length > 0
        ? srvActual.cargosPermitidosIds
        : (srvActual.cargosPermitidos || []).map((c) => c.categoriaId).filter(Boolean);
    const cargosNombres = (srvActual.cargosPermitidos || [])
      .map((c) => c.categoriaNombre?.trim().toLowerCase())
      .filter(Boolean);
    const tieneRestriccionCargo = cargosIds.length > 0 || cargosNombres.length > 0;

    return todos
      .filter((e) => {
        if (!idsHermanos.includes(e.servicioBaseId) || yaIncluidos.has(e.id)) return false;
        if (!tieneRestriccionCargo) return true;
        const matchId = Boolean(e.categoriaId && cargosIds.includes(e.categoriaId));
        const matchNombre = Boolean(e.categoria && cargosNombres.includes(e.categoria.trim().toLowerCase()));
        return matchId || matchNombre;
      })
      .map((e) => {
        const srvOrigen = mapaServicios.get(e.servicioBaseId);
        const reglas = reglasEmpresaDeEmpleado(e);
        const nominal = calcularMetaNominalMesEmpleado(e, anio, mes, predFest);
        const celdasEmp = matriz[e.id] || {};
        let horasMesActual = 0;
        for (const d of dias) {
          const celdaEmpDia = celdasEmp[d.dia];
          const cod = celdaEmpDia?.codigo || '';
          const cfg = cod ? catalogo[cod] : undefined;
          if (cfg && !cfg.esAusencia) {
            horasMesActual = r2(horasMesActual + horasLiquidadasCelda(cfg, d.fechaIso, predDesc, reglas, celdaEmpDia));
          }
        }
        return {
          ...e,
          horasContratoMes: nominal.horasContratadasNominales,
          horasContratadasNominales: nominal.horasContratadasNominales,
          horasSemanalesAplicadas: nominal.horasSemanalesAplicadas,
          empresaCodigo: e.empresaContratante?.codigo || reglas.codigo || 'CST',
          empresaNombre: e.empresaContratante?.nombre || reglas.nombre || 'Régimen CST',
          servicioBaseCodigo: srvOrigen?.codigo || 'APOYO',
          servicioBaseNombre: srvOrigen?.nombre || 'Servicio de Apoyo',
          horasProgramadasMes: horasMesActual,
        };
      });
  });

  inicializarMatrizCuadrante(emps: EmpleadoHospital[]): void {
    const anio = this.catalogos.anioSeleccionado();
    this.asignacionesPorPeriodo.update((actual) => {
      const porPeriodo = { ...actual };
      for (const m of TODOS_LOS_MESES) {
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

  crearObsCuadrantesAnio(anioObjetivo: number): Observable<unknown> {
    return this.api.getEstadoGlobalCuadrantes(anioObjetivo).pipe(
      map((res) => {
        if (res && anioObjetivo === this.catalogos.anioSeleccionado()) {
          this.aplicarEstadoGlobalCuadrantes(anioObjetivo, res);
        }
      }),
      catchError(() => of(null))
    );
  }

  aplicarEstadoGlobalCuadrantes(anioObjetivo: number, res: any): void {
    const perteneceAnioRecargado = (periodoKey: string): boolean =>
      periodoKey.startsWith(`${anioObjetivo}-`) || periodoKey === `${anioObjetivo - 1}-12`;

    if (res.estados) {
      this.estadosPorCuadrante.update((actual) => {
        const filtrado: Record<string, 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'> = {};
        for (const [k, v] of Object.entries(actual)) {
          const idxSep = k.indexOf('::');
          const periodoPart = idxSep >= 0 ? k.slice(idxSep + 2) : '';
          if (!perteneceAnioRecargado(periodoPart)) {
            filtrado[k] = v;
          }
        }
        return { ...filtrado, ...res.estados };
      });
    }

    if (res.asignacionesPorPeriodo) {
      this.asignacionesPorPeriodo.update((actual) => {
        const copia: Record<string, Record<string, Record<number, CeldaAsignacion>>> = {};
        for (const [k, v] of Object.entries(actual)) {
          if (!perteneceAnioRecargado(k)) {
            copia[k] = v;
          }
        }
        for (const [periodoKey, mapaEmpsDb] of Object.entries(res.asignacionesPorPeriodo as Record<string, Record<string, Record<number, any>>>)) {
          const mapaPeriodo: Record<string, Record<number, CeldaAsignacion>> = {};
          for (const [empId, diasDb] of Object.entries(mapaEmpsDb)) {
            const filaEmp: Record<number, CeldaAsignacion> = {};
            for (const [diaStr, celdaDb] of Object.entries(diasDb)) {
              const diaNum = Number(diaStr);
              filaEmp[diaNum] = {
                codigo: (celdaDb.codigo || '') as CodigoTurno,
                previsto: ((celdaDb.previsto ?? celdaDb.codigo) || '') as CodigoTurno,
                esRotacion: celdaDb.esRotacion,
                servicioEjecutorId: celdaDb.servicioEjecutorId,
                ...(celdaDb.nota ? { nota: celdaDb.nota } : {}),
                ...(celdaDb.fijada ? { fijada: true } : {}),
                ...(celdaDb.breakTandaOrden != null ? { breakTandaOrden: Number(celdaDb.breakTandaOrden) } : {}),
                ...(celdaDb.breakInicio ? { breakInicio: celdaDb.breakInicio } : {}),
                ...(celdaDb.breakFin ? { breakFin: celdaDb.breakFin } : {}),
              };
            }
            mapaPeriodo[empId] = filaEmp;
          }
          copia[periodoKey] = mapaPeriodo;
        }
        return copia;
      });
      this.inicializarMatrizCuadrante(this.catalogos.empleados());

      const mapaRot = { ...this.empleadosRotadosPorServicio() };
      let huboNuevosRotados = false;
      for (const [, mapaEmpsDb] of Object.entries(res.asignacionesPorPeriodo as Record<string, Record<string, Record<number, any>>>)) {
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
      this.saldosConsolidadosMap.update((actual) => {
        const filtrado: Record<string, number> = {};
        for (const [k, v] of Object.entries(actual)) {
          const idxSep = k.indexOf('::');
          const periodoPart = idxSep >= 0 ? k.slice(idxSep + 2) : '';
          if (!perteneceAnioRecargado(periodoPart)) {
            filtrado[k] = v;
          }
        }
        return { ...filtrado, ...res.saldosConsolidados };
      });
    }
  }

  sincronizacionAutomaticaIntranet(silencioso = true): void {
    if (this.sincronizandoNovedades()) return;
    this.sincronizandoNovedades.set(true);

    if (!silencioso) {
      this.notificacion.mostrar('⏳ Conectando con Intranet Hospitalaria para actualizar censo y novedades...');
    }

    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    const syncEmpleados$ = this.catalogos.esAdminTh()
      ? this.api
          .sincronizarEmpleadosIntranet()
          .pipe(catchError(() => of({ ok: false, creados: 0, actualizados: 0, empresasPendientes: [] })))
      : of({ ok: false, creados: 0, actualizados: 0, empresasPendientes: [] });

    let empresasPendientesDetectadas: Array<{ codigo: string; nombre: string; recienCreada?: boolean }> = [];

    syncEmpleados$
      .pipe(
        concatMap((resEmp: any) => {
          empresasPendientesDetectadas = Array.isArray(resEmp?.empresasPendientes)
            ? resEmp.empresasPendientes
            : [];
          if (
            resEmp &&
            (resEmp.creados > 0 || resEmp.actualizados > 0 || empresasPendientesDetectadas.length > 0)
          ) {
            return forkJoin([
              this.api.getEmpresas().pipe(
                map((lista) => this.catalogos.aplicarEmpresasDesdeDb(lista)),
                catchError(() => of(null))
              ),
              this.api.getCategorias().pipe(
                map((cats) => this.catalogos.aplicarCategoriasDesdeDb(cats)),
                catchError(() => of(null))
              ),
              this.api.getServicios().pipe(
                map((srvs) => this.catalogos.aplicarServiciosDesdeDb(srvs)),
                catchError(() => of(null))
              ),
              this.api.getEmpleados().pipe(
                map((empsDb) => this.catalogos.aplicarEmpleadosDesdeDb(empsDb)),
                catchError(() => of(null))
              ),
            ]).pipe(concatMap(() => this.api.sincronizarNovedadesIntranet(anio, mes)));
          }
          return this.api.sincronizarNovedadesIntranet(anio, mes);
        }),
        concatMap((resNov) => {
          if (resNov && resNov.ok) {
            return forkJoin([
              this.api.getNovedades(anio, mes).pipe(
                map((novedadesDb) => {
                  if (anio === this.catalogos.anioSeleccionado() && mes === this.catalogos.mesSeleccionado() && Array.isArray(novedadesDb)) {
                    this.listaNovedades.set(novedadesDb);
                  }
                }),
                catchError(() => of(null))
              ),
              this.crearObsCuadrantesAnio(anio),
            ]).pipe(map(() => resNov));
          }
          return of(resNov);
        })
      )
      .subscribe({
        next: (res) => {
          this.sincronizandoNovedades.set(false);
          const horaActual = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          this.ultimaSincronizacionIntranet.set(horaActual);

          if (empresasPendientesDetectadas.length > 0) {
            const listadoEmp = empresasPendientesDetectadas.map((e) => `${e.nombre} (${e.codigo})`).join(', ');
            this.notificacion.mostrar(
              `⚠️ Intranet detectó empresa(s) nueva(s) con reglas pendientes por confirmar: ${listadoEmp}. Revísalas en Configuración → Empresas.`
            );
          } else if (res && res.ok && !silencioso) {
            this.notificacion.mostrar(
              `✅ Intranet al día (${horaActual}): ${res.totalSincronizadas} ausencias aplicadas (${res.celdasBloqueadas} días protegidos).`
            );
          }
        },
        error: (err) => {
          this.sincronizandoNovedades.set(false);
          if (!silencioso) {
            const msg = err.error?.message || err.message || 'Error de conexión con Intranet';
            this.notificacion.mostrar(`⛔ No se pudo conectar con Intranet: ${msg}`);
          }
        },
      });
  }

  sincronizarNovedadesIntranet(): void {
    this.sincronizacionAutomaticaIntranet(false);
  }

  // Limpieza de filtros/pilas al cambiar servicio o periodo
  limpiarEstadoAlCambiarServicio(): void {
    this.filtroCategoriaActiva.set('TODAS');
    this.pilaDeshacer.set([]);
    this.pilaRehacer.set([]);
  }

  limpiarPilasAlCambiarPeriodo(): void {
    this.pilaDeshacer.set([]);
    this.pilaRehacer.set([]);
  }

  // Interacciones con la Paleta y Celdas
  seleccionarPincel(cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
  }

  onDragStartPaleta(event: DragEvent, cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', cod);
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  onDragOverCelda(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  onDropCelda(event: DragEvent, empId: string, dia: number): void {
    event.preventDefault();
    const rawCod = event.dataTransfer?.getData('text/plain');
    const cod = ((rawCod !== undefined && rawCod !== null ? rawCod : this.turnoPincelActivo()) || '').trim().toUpperCase() as CodigoTurno;
    if (cod === 'POINTER') return;
    if (cod !== '' && !this.catalogos.catalogoTurnosMap()[cod]) {
      this.notificacion.mostrar(`⛔ Código de turno inválido al soltar: "${cod}".`);
      return;
    }
    this.aplicarTurnoEnCelda(empId, dia, cod, 'Arrastre Drag & Drop');
  }

  iniciarPintadoCelda(empId: string, dia: number, event?: MouseEvent): void {
    if (event && event.button !== 0) return;
    this.enfocarCeldaPorId(empId, dia);
    this.loteArrastreActual = [];

    const esCtrl = !!(event?.ctrlKey || event?.metaKey || this.teclaCtrlPresionada());

    if (esCtrl) {
      const celdaActual = this.asignaciones()[empId]?.[dia]?.codigo || '';
      this.clonandoConCtrl.set(true);
      this.turnoClonandoConCtrl.set(celdaActual);
      this.pintandoConRaton.set(true);
      return;
    }

    if (this.turnoPincelActivo() === 'POINTER') {
      return;
    }

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
          ? `Cambio día ${cambios[0].dia}: ${cambios[0].turnoAnterior || 'Vacío'} ➔ ${cambios[0].turnoNuevo || 'Vacío'}`
          : `Arrastre de ${cambios.length} celdas en lote`;

      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: desc,
            servicioId: this.catalogos.servicioSeleccionadoId(),
            anio: this.catalogos.anioSeleccionado(),
            mes: this.catalogos.mesSeleccionado(),
            cambios,
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);
      this.loteArrastreActual = [];
    }
  }

  finalizarBlurVentana(): void {
    this.teclaCtrlPresionada.set(false);
    if (this.pintandoConRaton() || this.clonandoConCtrl()) {
      this.finalizarPintadoRaton();
    }
  }

  deshacerUltimaAccion(): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina.');
      return;
    }
    const pila = [...this.pilaDeshacer()];
    if (pila.length === 0) {
      this.notificacion.mostrar('ℹ️ No hay más acciones para deshacer en este servicio.');
      return;
    }
    const ultimoPaso = pila[pila.length - 1];
    if (
      ultimoPaso.servicioId !== this.catalogos.servicioSeleccionadoId() ||
      ultimoPaso.anio !== this.catalogos.anioSeleccionado() ||
      ultimoPaso.mes !== this.catalogos.mesSeleccionado()
    ) {
      this.notificacion.mostrar('ℹ️ La acción pendiente pertenece a otro servicio o periodo.');
      return;
    }

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevDeshacer = this.pilaDeshacer();
    const prevRehacer = this.pilaRehacer();

    pila.pop();
    this.pilaDeshacer.set(pila);

    const actualMap = { ...this.asignaciones() };
    const enBorrador = this.estadoCuadrante() === 'BORRADOR';
    const justificacionAuditoria = '↩️ Deshacer (Ctrl+Z): Reversión inmediata de asignación previa';
    const cambiosRehacer: CambioCeldaHistorial[] = [];
    const cambiosAplicados: CambioCeldaHistorial[] = [];
    let celdasFijadasOmitidas = 0;

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      const celdaPre = filaEmp[c.dia];
      if (celdaPre?.fijada) {
        celdasFijadasOmitidas++;
        continue;
      }
      cambiosAplicados.push(c);
      cambiosRehacer.push({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: celdaPre?.previsto ?? c.previstoAnterior,
        esRotacion: celdaPre?.esRotacion,
        breakTandaOrdenAnterior: celdaPre?.breakTandaOrden ?? c.breakTandaOrdenNuevo ?? null,
        breakInicioAnterior: celdaPre?.breakInicio ?? c.breakInicioNuevo ?? null,
        breakFinAnterior: celdaPre?.breakFin ?? c.breakFinNuevo ?? null,
        breakTandaOrdenNuevo: c.breakTandaOrdenAnterior ?? null,
        breakInicioNuevo: c.breakInicioAnterior ?? null,
        breakFinNuevo: c.breakFinAnterior ?? null,
      });

      const empObj = this.catalogos.empleados().find((e) => e.id === c.empId);
      const esRotacionBase = empObj ? empObj.servicioBaseId !== ultimoPaso.servicioId : false;
      const esVacio = !c.turnoAnterior || c.turnoAnterior === '';
      const liberaPropiedadDia = esVacio || (esRotacionBase && c.turnoAnterior === 'L');
      const esRotacionDest = liberaPropiedadDia
        ? false
        : (c.esRotacion !== undefined ? c.esRotacion : esRotacionBase);

      filaEmp[c.dia] = {
        codigo: c.turnoAnterior,
        previsto: c.previstoAnterior ?? (enBorrador ? c.turnoAnterior : (celdaPre?.previsto ?? c.turnoAnterior)),
        esRotacion: esRotacionDest,
        servicioEjecutorId: liberaPropiedadDia ? undefined : ultimoPaso.servicioId,
        ...(celdaPre?.nota ? { nota: celdaPre.nota } : {}),
        ...(!liberaPropiedadDia && c.breakTandaOrdenAnterior != null
          ? {
              breakTandaOrden: c.breakTandaOrdenAnterior,
              ...(c.breakInicioAnterior ? { breakInicio: c.breakInicioAnterior } : {}),
              ...(c.breakFinAnterior ? { breakFin: c.breakFinAnterior } : {}),
            }
          : {}),
      };
      actualMap[c.empId] = filaEmp;
    }

    if (cambiosAplicados.length === 0) {
      this.pilaDeshacer.set(prevDeshacer);
      this.notificacion.mostrar('📌 No se pudo deshacer: las celdas de esa acción están fijadas.');
      return;
    }

    const pasoInverso: PasoHistorialEdicion = {
      descripcion: ultimoPaso.descripcion,
      servicioId: ultimoPaso.servicioId,
      anio: ultimoPaso.anio,
      mes: ultimoPaso.mes,
      cambios: cambiosRehacer,
    };
    this.pilaRehacer.update((r) => [pasoInverso, ...r].slice(0, 30));
    this.actualizarAsignacionesMesActual(actualMap);

    let persistencia$: Observable<unknown>;
    if (cambiosAplicados.length > 5) {
      const loteDb = cambiosAplicados.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return {
          empleadoId: c.empId,
          dia: c.dia,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
          breakTandaOrden: celdaDest?.breakTandaOrden ?? null,
          breakInicio: celdaDest?.breakInicio ?? null,
          breakFin: celdaDest?.breakFin ?? null,
        };
      });
      persistencia$ = this.api.guardarLoteCuadrante({
        servicioId: ultimoPaso.servicioId,
        anio: ultimoPaso.anio,
        mes: ultimoPaso.mes,
        origenAccion: 'DESHACER',
        justificacion: `${justificacionAuditoria} (${ultimoPaso.descripcion})`,
        celdas: loteDb,
      });
    } else {
      const llamadas = cambiosAplicados.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return this.api.guardarCeldaCuadrante({
          servicioId: ultimoPaso.servicioId,
          anio: ultimoPaso.anio,
          mes: ultimoPaso.mes,
          dia: c.dia,
          empleadoId: c.empId,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
          justificacion: justificacionAuditoria,
          origenAccion: 'DESHACER',
          breakTandaOrden: celdaDest?.breakTandaOrden ?? null,
          breakInicio: celdaDest?.breakInicio ?? null,
          breakFin: celdaDest?.breakFin ?? null,
        });
      });
      persistencia$ = llamadas.length > 0 ? forkJoin(llamadas) : of(null);
    }

    persistencia$.subscribe({
      next: () => {
        if (this.estadoCuadrante() === 'PUBLICADO') {
          this.cuadranteEditadoPublicado$.next();
        }
        this.celdaHistorialActualizada$.next(
          cambiosAplicados.length === 1 ? { empId: cambiosAplicados[0].empId, dia: cambiosAplicados[0].dia } : {}
        );
        const notaOmitidas = celdasFijadasOmitidas > 0 ? ` (${celdasFijadasOmitidas} fijada(s) 📌 omitida(s))` : '';
        this.notificacion.mostrar(`↩️ Deshecho: ${ultimoPaso.descripcion}${notaOmitidas}`);
      },
      error: (err) => {
        this.asignacionesPorPeriodo.set(prevAsignaciones);
        this.pilaDeshacer.set(prevDeshacer);
        this.pilaRehacer.set(prevRehacer);
        const msg = err?.error?.message || 'Error al deshacer cambios en PostgreSQL. Se restauró el estado previo.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  rehacerUltimaAccion(): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina.');
      return;
    }
    const pila = [...this.pilaRehacer()];
    if (pila.length === 0) {
      this.notificacion.mostrar('ℹ️ No hay acciones para rehacer.');
      return;
    }
    const ultimoPaso = pila[0];
    if (
      ultimoPaso.servicioId !== this.catalogos.servicioSeleccionadoId() ||
      ultimoPaso.anio !== this.catalogos.anioSeleccionado() ||
      ultimoPaso.mes !== this.catalogos.mesSeleccionado()
    ) {
      this.notificacion.mostrar('ℹ️ La acción pendiente pertenece a otro servicio o periodo.');
      return;
    }

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevDeshacer = this.pilaDeshacer();
    const prevRehacer = this.pilaRehacer();

    pila.shift();
    this.pilaRehacer.set(pila);

    const actualMap = { ...this.asignaciones() };
    const enBorrador = this.estadoCuadrante() === 'BORRADOR';
    const justificacionAuditoria = '↪️ Rehacer (Ctrl+Y): Reaplicación de asignación';
    const cambiosDeshacer: CambioCeldaHistorial[] = [];
    const cambiosAplicados: CambioCeldaHistorial[] = [];
    let celdasFijadasOmitidas = 0;

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      const celdaPre = filaEmp[c.dia];
      if (celdaPre?.fijada) {
        celdasFijadasOmitidas++;
        continue;
      }
      cambiosAplicados.push(c);
      cambiosDeshacer.push({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: celdaPre?.previsto ?? c.previstoAnterior,
        esRotacion: celdaPre?.esRotacion,
        breakTandaOrdenAnterior: celdaPre?.breakTandaOrden ?? c.breakTandaOrdenNuevo ?? null,
        breakInicioAnterior: celdaPre?.breakInicio ?? c.breakInicioNuevo ?? null,
        breakFinAnterior: celdaPre?.breakFin ?? c.breakFinNuevo ?? null,
        breakTandaOrdenNuevo: c.breakTandaOrdenAnterior ?? null,
        breakInicioNuevo: c.breakInicioAnterior ?? null,
        breakFinNuevo: c.breakFinAnterior ?? null,
      });

      const empObj = this.catalogos.empleados().find((e) => e.id === c.empId);
      const esRotacionBase = empObj ? empObj.servicioBaseId !== ultimoPaso.servicioId : false;
      const esVacio = !c.turnoAnterior || c.turnoAnterior === '';
      const liberaPropiedadDia = esVacio || (esRotacionBase && c.turnoAnterior === 'L');
      const esRotacionDest = liberaPropiedadDia
        ? false
        : (c.esRotacion !== undefined ? c.esRotacion : esRotacionBase);

      filaEmp[c.dia] = {
        codigo: c.turnoAnterior,
        previsto: c.previstoAnterior ?? (enBorrador ? c.turnoAnterior : (celdaPre?.previsto ?? c.turnoAnterior)),
        esRotacion: esRotacionDest,
        servicioEjecutorId: liberaPropiedadDia ? undefined : ultimoPaso.servicioId,
        ...(celdaPre?.nota ? { nota: celdaPre.nota } : {}),
        ...(!liberaPropiedadDia && c.breakTandaOrdenAnterior != null
          ? {
              breakTandaOrden: c.breakTandaOrdenAnterior,
              ...(c.breakInicioAnterior ? { breakInicio: c.breakInicioAnterior } : {}),
              ...(c.breakFinAnterior ? { breakFin: c.breakFinAnterior } : {}),
            }
          : {}),
      };
      actualMap[c.empId] = filaEmp;
    }

    if (cambiosAplicados.length === 0) {
      this.pilaRehacer.set(prevRehacer);
      this.notificacion.mostrar('📌 No se pudo rehacer: las celdas de esa acción están fijadas.');
      return;
    }

    const pasoInverso: PasoHistorialEdicion = {
      descripcion: ultimoPaso.descripcion,
      servicioId: ultimoPaso.servicioId,
      anio: ultimoPaso.anio,
      mes: ultimoPaso.mes,
      cambios: cambiosDeshacer,
    };
    this.pilaDeshacer.update((d) => [...d, pasoInverso].slice(-30));
    this.actualizarAsignacionesMesActual(actualMap);

    let persistencia$: Observable<unknown>;
    if (cambiosAplicados.length > 5) {
      const loteDb = cambiosAplicados.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return {
          empleadoId: c.empId,
          dia: c.dia,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
          breakTandaOrden: celdaDest?.breakTandaOrden ?? null,
          breakInicio: celdaDest?.breakInicio ?? null,
          breakFin: celdaDest?.breakFin ?? null,
        };
      });
      persistencia$ = this.api.guardarLoteCuadrante({
        servicioId: ultimoPaso.servicioId,
        anio: ultimoPaso.anio,
        mes: ultimoPaso.mes,
        origenAccion: 'REHACER',
        justificacion: `${justificacionAuditoria} (${ultimoPaso.descripcion})`,
        celdas: loteDb,
      });
    } else {
      const llamadas = cambiosAplicados.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return this.api.guardarCeldaCuadrante({
          servicioId: ultimoPaso.servicioId,
          anio: ultimoPaso.anio,
          mes: ultimoPaso.mes,
          dia: c.dia,
          empleadoId: c.empId,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
          justificacion: justificacionAuditoria,
          origenAccion: 'REHACER',
          breakTandaOrden: celdaDest?.breakTandaOrden ?? null,
          breakInicio: celdaDest?.breakInicio ?? null,
          breakFin: celdaDest?.breakFin ?? null,
        });
      });
      persistencia$ = llamadas.length > 0 ? forkJoin(llamadas) : of(null);
    }

    persistencia$.subscribe({
      next: () => {
        if (this.estadoCuadrante() === 'PUBLICADO') {
          this.cuadranteEditadoPublicado$.next();
        }
        this.celdaHistorialActualizada$.next(
          cambiosAplicados.length === 1 ? { empId: cambiosAplicados[0].empId, dia: cambiosAplicados[0].dia } : {}
        );
        const notaOmitidas = celdasFijadasOmitidas > 0 ? ` (${celdasFijadasOmitidas} fijada(s) 📌 omitida(s))` : '';
        this.notificacion.mostrar(`↪️ Rehecho: ${ultimoPaso.descripcion}${notaOmitidas}`);
      },
      error: (err) => {
        this.asignacionesPorPeriodo.set(prevAsignaciones);
        this.pilaDeshacer.set(prevDeshacer);
        this.pilaRehacer.set(prevRehacer);
        const msg = err?.error?.message || 'Error al rehacer cambios en PostgreSQL. Se restauró el estado previo.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
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

  enfocarCelda(empId: string, dia: number): void {
    this.enfocarCeldaPorId(empId, dia);
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
      nuevaFila = Math.max(0, Math.min(filas.length - 1, idxFila + deltaFila));
      nuevoDia = Math.max(1, Math.min(totalDias, dia + deltaDia));
    }

    const destinoEmpId = filas[nuevaFila].empleado.id;
    this.enfocarCeldaPorId(destinoEmpId, nuevoDia);
  }

  onKeyDownCelda(event: KeyboardEvent, empId: string, dia: number): void {
    const key = event.key;
    const keyUpper = key.toUpperCase();
    if (key === 'F2') return;

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

    const mapaTeclas: Record<string, CodigoTurno> = {
      '1': 'M8',
      '2': 'T8',
      '3': 'N12',
      '4': 'D12',
      '5': 'G24',
      '6': 'M6',
      '7': 'T6',
      '8': 'N8',
      '0': 'L',
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
      DELETE: '',
      BACKSPACE: '',
      ' ': '',
    };

    if (keyUpper in mapaTeclas || key in mapaTeclas) {
      event.preventDefault();
      const codigoAsignar = mapaTeclas[keyUpper] ?? mapaTeclas[key];
      this.aplicarTurnoEnCelda(empId, dia, codigoAsignar, `Atajo de teclado (${key})`);

      if (this.autoAvanzarAlTeclear()) {
        this.navegarCelda(empId, dia, 0, 1);
      }
    }
  }

  private inferirOrigenAccion(origen: string): string {
    const up = (origen || '').toUpperCase();
    if (up.includes('INSPECTOR') || up.includes('CONTEXTUAL') || up.includes('REVERTIR')) {
      return 'INSPECTOR';
    }
    return 'MANUAL';
  }

  private resolverBreakParaAsignacion(
    actualMap: Record<string, Record<number, CeldaAsignacion>>,
    empId: string,
    dia: number,
    nuevoCodigo: string,
    srvId: string
  ): { breakTandaOrden: number | null; breakInicio: string | null; breakFin: string | null } {
    const codUpper = (nuevoCodigo || '').trim().toUpperCase();
    const cfgNuevo = codUpper ? this.catalogos.catalogoTurnosMap()[codUpper] : undefined;
    if (!cfgNuevo || !cfgNuevo.recesoHabilitado || cfgNuevo.esAusencia) {
      return { breakTandaOrden: null, breakInicio: null, breakFin: null };
    }
    const tandas = obtenerTandasBreakDeTurno(cfgNuevo);
    if (tandas.length === 0) {
      return { breakTandaOrden: null, breakInicio: null, breakFin: null };
    }

    const empleados = this.catalogos.empleados();
    const empMap = new Map(empleados.map((e) => [e.id, e]));
    const conteos: Record<number, number> = {};
    for (const [otroEmpId, filaOtro] of Object.entries(actualMap)) {
      if (otroEmpId === empId) continue;
      const c = filaOtro?.[dia];
      if (!c) continue;
      if ((c.codigo || '').trim().toUpperCase() !== codUpper) continue;
      const empOtro = empMap.get(otroEmpId);
      const ejecutorOtro = c.servicioEjecutorId || empOtro?.servicioBaseId;
      if (ejecutorOtro !== srvId) continue;
      const orden = c.breakTandaOrden ?? tandas[0].orden;
      conteos[orden] = (conteos[orden] || 0) + 1;
    }

    const elegida = seleccionarTandaBreakEquilibrada(tandas, conteos, Math.max(0, dia - 1));
    if (!elegida) {
      return { breakTandaOrden: null, breakInicio: null, breakFin: null };
    }
    return {
      breakTandaOrden: elegida.orden,
      breakInicio: elegida.inicio,
      breakFin: elegida.fin,
    };
  }

  aplicarTurnoEnCelda(
    empId: string,
    dia: number,
    nuevoCodigo: CodigoTurno,
    origen: string,
    opciones?: { origenAccion?: string; justificacion?: string }
  ): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];
    const cfgActual = celdaActual?.codigo ? this.catalogos.catalogoTurnosMap()[celdaActual.codigo] : undefined;
    const esAusenciaBloqueada = cfgActual
      ? Boolean(cfgActual.esAusencia)
      : esCodigoExoneracionContrato(celdaActual?.codigo);

    if (esAusenciaBloqueada && nuevoCodigo !== celdaActual?.codigo) {
      this.notificacion.mostrar(
        `🔒 Celda bloqueada: Novedad oficial de Intranet (${celdaActual?.codigo}). Las ausencias oficiales solo pueden ser gestionadas desde Gestión Humana.`
      );
      return;
    }

    const anterior = (celdaActual?.codigo as CodigoTurno) || '';
    if (celdaActual?.fijada && anterior !== nuevoCodigo) {
      this.notificacion.mostrar(
        `📌 Celda fijada (Día ${dia}): desbloquéala desde el Inspector (Clic derecho / F2) antes de modificarla.`
      );
      return;
    }

    const empObj = this.catalogos.empleados().find((e) => e.id === empId);
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    if (
      celdaActual?.servicioEjecutorId &&
      celdaActual.servicioEjecutorId !== srvId &&
      celdaActual.codigo &&
      celdaActual.codigo !== '' &&
      celdaActual.codigo !== 'L'
    ) {
      const srvOtro = this.catalogos.servicios().find((s) => s.id === celdaActual.servicioEjecutorId);
      this.notificacion.mostrar(
        `📍 Celda Espejo bloqueada: ${empObj?.nombre || 'El colaborador'} ya tiene asignado "${celdaActual.codigo}" en "${srvOtro?.nombre || 'otro servicio'}" el día ${dia}. Libéralo en ese servicio si deseas reasignarlo aquí.`
      );
      return;
    }

    if (anterior === nuevoCodigo) return;

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevEstados = this.estadosPorCuadrante();
    const prevDeshacer = this.pilaDeshacer();
    const prevRehacer = this.pilaRehacer();
    const prevLoteArrastre = [...this.loteArrastreActual];
    const necesitaIniciarBorrador = this.estadoCuadrante() === 'SIN_PLANIFICAR';

    if (necesitaIniciarBorrador) {
      const key = `${srvId}::${anio}-${mes}`;
      this.estadosPorCuadrante.update((prev) => ({
        ...prev,
        [key]: 'BORRADOR',
      }));
    }

    const esRotacionBase = empObj ? empObj.servicioBaseId !== srvId : false;
    const liberaPropiedadDia = nuevoCodigo === '' || (esRotacionBase && nuevoCodigo === 'L');
    const esRotacion = liberaPropiedadDia ? false : esRotacionBase;
    const enBorrador = this.estadoCuadrante() === 'BORRADOR' || necesitaIniciarBorrador;
    const origenAccion = opciones?.origenAccion || this.inferirOrigenAccion(origen);
    const justificacionEnviar = opciones?.justificacion?.trim() || origen;

    const breakAsig = liberaPropiedadDia
      ? { breakTandaOrden: null, breakInicio: null, breakFin: null }
      : this.resolverBreakParaAsignacion(actualMap, empId, dia, nuevoCodigo, srvId);

    const cambioHistorial: CambioCeldaHistorial = {
      empId,
      dia,
      turnoAnterior: anterior as CodigoTurno,
      turnoNuevo: nuevoCodigo,
      previstoAnterior: celdaActual?.previsto,
      esRotacion,
      breakTandaOrdenAnterior: celdaActual?.breakTandaOrden ?? null,
      breakInicioAnterior: celdaActual?.breakInicio ?? null,
      breakFinAnterior: celdaActual?.breakFin ?? null,
      breakTandaOrdenNuevo: breakAsig.breakTandaOrden,
      breakInicioNuevo: breakAsig.breakInicio,
      breakFinNuevo: breakAsig.breakFin,
    };

    filaEmp[dia] = {
      codigo: nuevoCodigo,
      previsto: enBorrador ? nuevoCodigo : (celdaActual?.previsto ?? (anterior as CodigoTurno)),
      esRotacion,
      servicioEjecutorId: liberaPropiedadDia ? undefined : srvId,
      ...(celdaActual?.nota ? { nota: celdaActual.nota } : {}),
      ...(breakAsig.breakTandaOrden != null && breakAsig.breakInicio && breakAsig.breakFin
        ? {
            breakTandaOrden: breakAsig.breakTandaOrden,
            breakInicio: breakAsig.breakInicio,
            breakFin: breakAsig.breakFin,
          }
        : {}),
    };

    const cfgNuevo = this.catalogos.catalogoTurnosMap()[nuevoCodigo];
    let seAutoAsignoSaliente = false;
    let cambioSalienteHistorial: CambioCeldaHistorial | null = null;
    if (cfgNuevo?.esNocturnoPesado && dia < this.diasDelMes().length) {
      const celdaSig = filaEmp[dia + 1];
      const sig = celdaSig?.codigo || '';
      const bloqueadaOtroSrv =
        celdaSig?.servicioEjecutorId &&
        celdaSig.servicioEjecutorId !== srvId &&
        sig !== '' &&
        sig !== 'L';
      if (!celdaSig?.fijada && (!sig || sig === 'L') && !bloqueadaOtroSrv) {
        cambioSalienteHistorial = {
          empId,
          dia: dia + 1,
          turnoAnterior: sig as CodigoTurno,
          turnoNuevo: 'S' as CodigoTurno,
          previstoAnterior: celdaSig?.previsto,
          esRotacion: esRotacionBase,
          breakTandaOrdenAnterior: celdaSig?.breakTandaOrden ?? null,
          breakInicioAnterior: celdaSig?.breakInicio ?? null,
          breakFinAnterior: celdaSig?.breakFin ?? null,
          breakTandaOrdenNuevo: null,
          breakInicioNuevo: null,
          breakFinNuevo: null,
        };
        filaEmp[dia + 1] = {
          codigo: 'S',
          previsto: enBorrador ? 'S' : (filaEmp[dia + 1]?.previsto ?? sig),
          esRotacion: esRotacionBase,
          servicioEjecutorId: srvId,
          ...(celdaSig?.nota ? { nota: celdaSig.nota } : {}),
        };
        seAutoAsignoSaliente = true;
      }
    }

    if (this.pintandoConRaton()) {
      const idxExistente = this.loteArrastreActual.findIndex((c) => c.empId === empId && c.dia === dia);
      if (idxExistente === -1) {
        this.loteArrastreActual.push(cambioHistorial);
      } else {
        this.loteArrastreActual[idxExistente].turnoNuevo = nuevoCodigo;
        this.loteArrastreActual[idxExistente].breakTandaOrdenNuevo = breakAsig.breakTandaOrden;
        this.loteArrastreActual[idxExistente].breakInicioNuevo = breakAsig.breakInicio;
        this.loteArrastreActual[idxExistente].breakFinNuevo = breakAsig.breakFin;
      }
      if (cambioSalienteHistorial) {
        const idxSig = this.loteArrastreActual.findIndex((c) => c.empId === empId && c.dia === dia + 1);
        if (idxSig === -1) {
          this.loteArrastreActual.push(cambioSalienteHistorial);
        } else {
          this.loteArrastreActual[idxSig].turnoNuevo = 'S' as CodigoTurno;
          this.loteArrastreActual[idxSig].breakTandaOrdenNuevo = null;
          this.loteArrastreActual[idxSig].breakInicioNuevo = null;
          this.loteArrastreActual[idxSig].breakFinNuevo = null;
        }
      }
    } else {
      const listaCambiosPaso = cambioSalienteHistorial
        ? [cambioHistorial, cambioSalienteHistorial]
        : [cambioHistorial];
      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: `${empObj?.nombre?.split(' ')[0] || 'Colaborador'} día ${dia}: ${anterior || 'Vacío'} ➔ ${nuevoCodigo || 'Vacío'}`,
            servicioId: srvId,
            anio,
            mes,
            cambios: listaCambiosPaso,
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);
    }

    actualMap[empId] = filaEmp;
    this.actualizarAsignacionesMesActual(actualMap);

    const guardCalls: Observable<unknown>[] = [
      this.api.guardarCeldaCuadrante({
        servicioId: srvId,
        anio,
        mes,
        dia,
        empleadoId: empId,
        codigo: nuevoCodigo,
        previsto: filaEmp[dia].previsto || '',
        esRotacion,
        justificacion: justificacionEnviar,
        origenAccion,
        breakTandaOrden: breakAsig.breakTandaOrden,
        breakInicio: breakAsig.breakInicio,
        breakFin: breakAsig.breakFin,
      }),
    ];

    if (seAutoAsignoSaliente) {
      guardCalls.push(
        this.api.guardarCeldaCuadrante({
          servicioId: srvId,
          anio,
          mes,
          dia: dia + 1,
          empleadoId: empId,
          codigo: 'S',
          previsto: filaEmp[dia + 1].previsto || '',
          esRotacion,
          justificacion: `${justificacionEnviar} (Auto Saliente Post-Guardia)`,
          origenAccion,
          breakTandaOrden: null,
          breakInicio: null,
          breakFin: null,
        })
      );
    }

    const persistenciaObs = necesitaIniciarBorrador
      ? this.api
          .actualizarEstadoCuadrante({ servicioId: srvId, anio, mes, estado: 'BORRADOR' })
          .pipe(concatMap(() => forkJoin(guardCalls)))
      : forkJoin(guardCalls);

    persistenciaObs.subscribe({
      next: () => {
        if (empObj && prevEstados[`${srvId}::${anio}-${mes}`] === 'PUBLICADO') {
          this.cuadranteEditadoPublicado$.next();
        }
        this.celdaHistorialActualizada$.next({ empId, dia });
        if (seAutoAsignoSaliente) {
          this.celdaHistorialActualizada$.next({ empId, dia: dia + 1 });
        }
      },
      error: (err) => {
        this.asignacionesPorPeriodo.set(prevAsignaciones);
        this.estadosPorCuadrante.set(prevEstados);
        this.pilaDeshacer.set(prevDeshacer);
        this.pilaRehacer.set(prevRehacer);
        this.loteArrastreActual = prevLoteArrastre;
        this.pintandoConRaton.set(false);
        this.clonandoConCtrl.set(false);
        this.turnoClonandoConCtrl.set(null);
        const msg = err?.error?.message || 'Error al guardar el turno en PostgreSQL. Se revertió la celda.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  revertirCeldaAPrevisto(empId: string, dia: number, justificacion?: string): void {
    if (this.catalogos.esColaborador()) return;
    const celdaActual = this.asignaciones()[empId]?.[dia];
    if (!celdaActual || celdaActual.previsto === undefined) {
      this.notificacion.mostrar('ℹ️ Esta celda aún no tiene un turno oficial previsto registrado.');
      return;
    }
    const codPrev = celdaActual.previsto as CodigoTurno;
    if ((celdaActual.codigo || '') === codPrev) {
      this.notificacion.mostrar('ℹ️ La celda ya tiene el turno oficial previsto.');
      return;
    }
    this.aplicarTurnoEnCelda(
      empId,
      dia,
      codPrev,
      '↩️ Revertir a turno oficial previsto',
      {
        origenAccion: 'INSPECTOR',
        justificacion: justificacion?.trim() || '↩️ Revertir a turno oficial previsto',
      }
    );
  }

  guardarNotaCelda(empId: string, dia: number, notaRaw: string): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar notas.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    if (
      celdaActual?.servicioEjecutorId &&
      celdaActual.servicioEjecutorId !== srvId &&
      celdaActual.codigo &&
      celdaActual.codigo !== '' &&
      celdaActual.codigo !== 'L'
    ) {
      const srvOtro = this.catalogos.servicios().find((s) => s.id === celdaActual.servicioEjecutorId);
      this.notificacion.mostrar(
        `📍 Celda Espejo bloqueada: edita la nota desde "${srvOtro?.nombre || 'el otro servicio'}".`
      );
      return;
    }

    const notaLim = (notaRaw || '').trim().slice(0, 500);
    const notaEnviar = notaLim.length > 0 ? notaLim : null;
    const notaActual = (celdaActual?.nota || '').trim() || null;
    if (notaActual === notaEnviar) {
      this.notificacion.mostrar('ℹ️ La nota de la celda no presenta cambios.');
      return;
    }

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevEstados = this.estadosPorCuadrante();
    const key = `${srvId}::${anio}-${mes}`;
    const necesitaBorrador = this.estadoCuadrante() === 'SIN_PLANIFICAR' && notaEnviar !== null;

    if (necesitaBorrador) {
      this.estadosPorCuadrante.update((prev) => ({ ...prev, [key]: 'BORRADOR' }));
    }

    if (celdaActual) {
      const { nota: _oldNota, ...resto } = celdaActual;
      filaEmp[dia] = notaEnviar ? { ...resto, nota: notaEnviar } : { ...resto };
    } else if (notaEnviar) {
      filaEmp[dia] = { codigo: '' as CodigoTurno, previsto: '' as CodigoTurno, nota: notaEnviar };
    }
    actualMap[empId] = filaEmp;
    this.actualizarAsignacionesMesActual(actualMap);

    this.api
      .guardarNotaCelda({
        servicioId: srvId,
        anio,
        mes,
        dia,
        empleadoId: empId,
        nota: notaEnviar,
      })
      .subscribe({
        next: () => {
          if (prevEstados[key] === 'PUBLICADO') {
            this.cuadranteEditadoPublicado$.next();
          }
          this.celdaHistorialActualizada$.next({ empId, dia });
          this.notificacion.mostrar(
            notaEnviar ? '💬 Nota de celda guardada (visible para colaborador y .ics).' : '🗑️ Nota de celda eliminada.'
          );
        },
        error: (err) => {
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          this.estadosPorCuadrante.set(prevEstados);
          const msg = err?.error?.message || 'Error al guardar la nota de la celda.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  alternarFijacionCelda(
    empId: string,
    dia: number,
    fijadaDestino?: boolean,
    justificacion?: string
  ): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para fijar/desbloquear.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    const cfgActual = celdaActual?.codigo ? this.catalogos.catalogoTurnosMap()[celdaActual.codigo] : undefined;
    const esAusenciaBloqueada = cfgActual
      ? Boolean(cfgActual.esAusencia)
      : esCodigoExoneracionContrato(celdaActual?.codigo);

    const destino = fijadaDestino !== undefined ? fijadaDestino : !Boolean(celdaActual?.fijada);
    if (esAusenciaBloqueada && destino) {
      this.notificacion.mostrar(
        `🔒 Esta fecha tiene novedad oficial (${celdaActual?.codigo}) con prioridad legal de Intranet.`
      );
      return;
    }

    if (
      celdaActual?.servicioEjecutorId &&
      celdaActual.servicioEjecutorId !== srvId &&
      celdaActual.codigo &&
      celdaActual.codigo !== '' &&
      celdaActual.codigo !== 'L'
    ) {
      const srvOtro = this.catalogos.servicios().find((s) => s.id === celdaActual.servicioEjecutorId);
      this.notificacion.mostrar(
        `📍 Celda Espejo bloqueada: fija o desbloquea la celda desde "${srvOtro?.nombre || 'el otro servicio'}".`
      );
      return;
    }

    if (Boolean(celdaActual?.fijada) === destino) return;

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevEstados = this.estadosPorCuadrante();
    const key = `${srvId}::${anio}-${mes}`;
    const necesitaBorrador = this.estadoCuadrante() === 'SIN_PLANIFICAR' && destino;

    if (necesitaBorrador) {
      this.estadosPorCuadrante.update((prev) => ({ ...prev, [key]: 'BORRADOR' }));
    }

    if (celdaActual) {
      const { fijada: _oldFij, ...resto } = celdaActual;
      filaEmp[dia] = destino ? { ...resto, fijada: true } : { ...resto };
    } else if (destino) {
      filaEmp[dia] = { codigo: '' as CodigoTurno, previsto: '' as CodigoTurno, fijada: true };
    }
    actualMap[empId] = filaEmp;
    this.actualizarAsignacionesMesActual(actualMap);

    this.api
      .alternarFijacionCelda({
        servicioId: srvId,
        anio,
        mes,
        dia,
        empleadoId: empId,
        fijada: destino,
        justificacion: justificacion?.trim() || undefined,
      })
      .subscribe({
        next: () => {
          if (prevEstados[key] === 'PUBLICADO') {
            this.cuadranteEditadoPublicado$.next();
          }
          this.celdaHistorialActualizada$.next({ empId, dia });
          this.notificacion.mostrar(
            destino
              ? '📌 Celda fijada: protegida contra autocompletar, limpiar, pintado accidental, Ctrl+Z y permutas.'
              : '🔓 Protección 📌 retirada de la celda.'
          );
        },
        error: (err) => {
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          this.estadosPorCuadrante.set(prevEstados);
          const msg = err?.error?.message || 'Error al actualizar fijación de la celda.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  cambiarBreakCelda(empId: string, dia: number, tandaOrden: number | null): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar breaks.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    if (!celdaActual || !celdaActual.codigo) {
      this.notificacion.mostrar('ℹ️ Esta celda no tiene un turno asignado para configurar break.');
      return;
    }

    if (celdaActual.fijada) {
      this.notificacion.mostrar('📌 Celda fijada: desbloquéala antes de cambiar su tanda de break.');
      return;
    }

    if (
      celdaActual.servicioEjecutorId &&
      celdaActual.servicioEjecutorId !== srvId &&
      celdaActual.codigo !== 'L'
    ) {
      const srvOtro = this.catalogos.servicios().find((s) => s.id === celdaActual.servicioEjecutorId);
      this.notificacion.mostrar(
        `📍 Celda Espejo bloqueada: cambia la tanda de break desde "${srvOtro?.nombre || 'el otro servicio'}".`
      );
      return;
    }

    const codUpper = celdaActual.codigo.trim().toUpperCase();
    const cfg = this.catalogos.catalogoTurnosMap()[codUpper];
    if (!cfg || !cfg.recesoHabilitado || cfg.esAusencia) {
      this.notificacion.mostrar(`ℹ️ El turno ${codUpper} no tiene break/almuerzo habilitado.`);
      return;
    }

    const tandas = obtenerTandasBreakDeTurno(cfg);
    if (tandas.length === 0) return;

    const targetTanda =
      tandaOrden != null
        ? tandas.find((t) => t.orden === tandaOrden) || tandas[0]
        : tandas[0];

    if (
      celdaActual.breakTandaOrden === targetTanda.orden &&
      celdaActual.breakInicio === targetTanda.inicio &&
      celdaActual.breakFin === targetTanda.fin
    ) {
      return;
    }

    const prevAsignaciones = this.asignacionesPorPeriodo();
    filaEmp[dia] = {
      ...celdaActual,
      breakTandaOrden: targetTanda.orden,
      breakInicio: targetTanda.inicio,
      breakFin: targetTanda.fin,
    };
    actualMap[empId] = filaEmp;
    this.actualizarAsignacionesMesActual(actualMap);

    this.api
      .guardarBreakCelda({
        servicioId: srvId,
        anio,
        mes,
        dia,
        empleadoId: empId,
        breakTandaOrden: targetTanda.orden,
        breakInicio: targetTanda.inicio,
        breakFin: targetTanda.fin,
      })
      .subscribe({
        next: () => {
          if (this.estadoCuadrante() === 'PUBLICADO') {
            this.cuadranteEditadoPublicado$.next();
          }
          this.celdaHistorialActualizada$.next({ empId, dia });
          const resumenDia = this.obtenerResumenTandasDia(srvId, dia, codUpper);
          const tandaOcup = resumenDia?.tandas.find((t) => t.orden === targetTanda.orden);
          const alertaTxt = tandaOcup?.enAlerta
            ? ` ⚠️ (${tandaOcup.asignados}/${tandaOcup.maxSimultaneos} simultáneos)`
            : '';
          this.notificacion.mostrar(
            `🍽️ Break actualizado a ${targetTanda.etiqueta || 'T' + targetTanda.orden} (${targetTanda.inicio}–${targetTanda.fin})${alertaTxt}.`
          );
        },
        error: (err) => {
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          const msg = err?.error?.message || 'Error al guardar la tanda de break en PostgreSQL.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  rebalancearBreaksDia(dia: number, codigoTurnoFiltro?: string): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para balancear breaks.');
      return;
    }

    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const prevAsignaciones = this.asignacionesPorPeriodo();
    const actualMap = { ...this.asignaciones() };
    const codFiltroUpper = codigoTurnoFiltro ? codigoTurnoFiltro.trim().toUpperCase() : null;

    // Agrupar filas del servicio actual en ese día por código de turno
    const porTurno = new Map<
      string,
      Array<{ empId: string; celda: CeldaAsignacion; fijada: boolean }>
    >();
    for (const f of this.filasServicioCompletas()) {
      const celda = actualMap[f.empleado.id]?.[dia];
      const cod = (celda?.codigo || '').trim().toUpperCase();
      if (!cod) continue;
      if (codFiltroUpper && cod !== codFiltroUpper) continue;
      const ejecutor = celda?.servicioEjecutorId || f.empleado.servicioBaseId;
      if (ejecutor !== srvId) continue;
      const cfg = catalogo[cod];
      if (!cfg || !cfg.recesoHabilitado || cfg.esAusencia) continue;

      const list = porTurno.get(cod) || [];
      list.push({ empId: f.empleado.id, celda: celda!, fijada: Boolean(celda?.fijada) });
      porTurno.set(cod, list);
    }

    const loteParaDb: Array<{
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
      breakTandaOrden: number | null;
      breakInicio: string | null;
      breakFin: string | null;
    }> = [];

    for (const [cod, items] of porTurno.entries()) {
      const cfg = catalogo[cod];
      if (!cfg) continue;
      const tandas = obtenerTandasBreakDeTurno(cfg);
      if (tandas.length === 0) continue;

      const conteos: Record<number, number> = {};
      // Primero respetar las celdas fijadas y sumar su ocupación actual
      for (const it of items) {
        if (it.fijada) {
          const ord = it.celda.breakTandaOrden ?? tandas[0].orden;
          conteos[ord] = (conteos[ord] || 0) + 1;
        }
      }

      // Repartir equitativamente los no fijados con offset rotativo por día
      for (const it of items) {
        if (it.fijada) continue;
        const elegida = seleccionarTandaBreakEquilibrada(tandas, conteos, Math.max(0, dia - 1));
        if (!elegida) continue;
        conteos[elegida.orden] = (conteos[elegida.orden] || 0) + 1;

        const cambioReal =
          it.celda.breakTandaOrden !== elegida.orden ||
          it.celda.breakInicio !== elegida.inicio ||
          it.celda.breakFin !== elegida.fin;

        if (cambioReal) {
          const filaEmp = { ...(actualMap[it.empId] || {}) };
          filaEmp[dia] = {
            ...it.celda,
            breakTandaOrden: elegida.orden,
            breakInicio: elegida.inicio,
            breakFin: elegida.fin,
          };
          actualMap[it.empId] = filaEmp;

          loteParaDb.push({
            empleadoId: it.empId,
            dia,
            codigo: it.celda.codigo,
            previsto: it.celda.previsto,
            esRotacion: Boolean(it.celda.esRotacion),
            breakTandaOrden: elegida.orden,
            breakInicio: elegida.inicio,
            breakFin: elegida.fin,
          });
        }
      }
    }

    if (loteParaDb.length === 0) {
      this.notificacion.mostrar(`ℹ️ Las tandas de break del día ${dia} ya están equilibradas.`);
      return;
    }

    this.actualizarAsignacionesMesActual(actualMap);

    this.api
      .guardarLoteCuadrante({
        servicioId: srvId,
        anio,
        mes,
        origenAccion: 'BALANCEAR_BREAKS',
        justificacion: `⚖️ Balanceo automático de tandas de break (Día ${dia}${codFiltroUpper ? ` · ${codFiltroUpper}` : ''})`,
        celdas: loteParaDb,
      })
      .subscribe({
        next: () => {
          if (this.estadoCuadrante() === 'PUBLICADO') {
            this.cuadranteEditadoPublicado$.next();
          }
          this.celdaHistorialActualizada$.next({});
          this.notificacion.mostrar(
            `⚖️ Tandas de break balanceadas en el día ${dia} (${loteParaDb.length} colaborador(es) actualizados).`
          );
        },
        error: (err) => {
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          const msg = err?.error?.message || 'Error al persistir el balanceo de tandas de break.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  asignarApoyoDiaCelda(
    empId: string,
    dia: number,
    servicioDestinoId: string | null,
    codigoTurno?: CodigoTurno,
    justificacion?: string
  ): void {
    if (this.catalogos.esColaborador()) return;
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar apoyo.');
      return;
    }

    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    this.api
      .asignarApoyoDiaCelda({
        servicioId: srvId,
        anio,
        mes,
        dia,
        empleadoId: empId,
        servicioDestinoId: servicioDestinoId || '',
        codigo: codigoTurno,
        justificacion: justificacion?.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          const actualMap = { ...this.asignaciones() };
          const filaEmp = { ...(actualMap[empId] || {}) };
          const celdaPre = filaEmp[dia];
          filaEmp[dia] = {
            ...(celdaPre || {}),
            codigo: (res.codigo || '') as CodigoTurno,
            previsto: celdaPre?.previsto ?? ((res.codigo || '') as CodigoTurno),
            esRotacion: res.esRotacion,
            servicioEjecutorId: res.servicioEjecutorId,
            ...(res.breakTandaOrden != null
              ? {
                  breakTandaOrden: res.breakTandaOrden,
                  ...(res.breakInicio ? { breakInicio: res.breakInicio } : {}),
                  ...(res.breakFin ? { breakFin: res.breakFin } : {}),
                }
              : {
                  breakTandaOrden: undefined,
                  breakInicio: undefined,
                  breakFin: undefined,
                }),
          };
          actualMap[empId] = filaEmp;
          this.actualizarAsignacionesMesActual(actualMap);

          const keyDest = `${res.servicioEjecutorId}::${anio}-${mes}`;
          if (!this.estadosPorCuadrante()[keyDest]) {
            this.estadosPorCuadrante.update((prev) => ({ ...prev, [keyDest]: 'BORRADOR' }));
          }

          if (res.esRotacion && res.servicioEjecutorId) {
            const mapaRot = { ...this.empleadosRotadosPorServicio() };
            const lista = mapaRot[res.servicioEjecutorId] || [];
            if (!lista.includes(empId)) {
              mapaRot[res.servicioEjecutorId] = [...lista, empId];
              this.empleadosRotadosPorServicio.set(mapaRot);
              this.guardarRotadosEnStorage(mapaRot);
            }
          }

          this.cuadranteEditadoPublicado$.next();
          this.celdaHistorialActualizada$.next({ empId, dia });
          const srvDest = this.catalogos.servicios().find((s) => s.id === res.servicioEjecutorId);
          this.notificacion.mostrar(
            res.esRotacion
              ? `🔄 Apoyo puntual día ${dia} asignado a "${srvDest?.nombre || res.servicioEjecutorId}" [${res.codigo || 'Vacío'}].`
              : `🏠 Día ${dia} retornado al servicio base "${srvDest?.nombre || res.servicioEjecutorId}".`
          );
        },
        error: (err) => {
          const msg = err?.error?.message || 'No se pudo actualizar el apoyo puntual de esta celda.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  limpiarCuadranteCompleto(): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const srvNombre = this.catalogos.servicioActual().nombre;
    this.notificacion.abrirConfirmacion({
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
    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevDeshacer = this.pilaDeshacer();
    const prevRehacer = this.pilaRehacer();
    const actualMap = { ...this.asignaciones() };
    const catalogo = this.catalogos.catalogoTurnosMap();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    let celdasLimpiadas = 0;
    let celdasFijadasOmitidas = 0;
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
      breakTandaOrden?: number | null;
      breakInicio?: string | null;
      breakFin?: string | null;
    }[] = [];
    const cambiosParaHistorial: CambioCeldaHistorial[] = [];

    const enBorrador = this.estadoCuadrante() === 'BORRADOR';

    for (const { emp, esRotado } of this.empleadosServicioSinFiltro()) {
      const fila = { ...(actualMap[emp.id] || {}) };
      for (const d of this.diasDelMes()) {
        const celda = fila[d.dia];
        const cfgCelda = celda?.codigo ? catalogo[celda.codigo] : undefined;
        const esAusenciaProtegida = cfgCelda
          ? Boolean(cfgCelda.esAusencia)
          : esCodigoExoneracionContrato(celda?.codigo);
        if (!celda || celda.codigo === '' || esAusenciaProtegida) {
          continue;
        }
        if (celda.servicioEjecutorId && celda.servicioEjecutorId !== srvId) {
          continue;
        }
        if (celda.fijada) {
          celdasFijadasOmitidas++;
          continue;
        }
        const prev = enBorrador ? '' : (celda.previsto ?? celda.codigo);
        cambiosParaHistorial.push({
          empId: emp.id,
          dia: d.dia,
          turnoAnterior: celda.codigo as CodigoTurno,
          turnoNuevo: '' as CodigoTurno,
          previstoAnterior: (celda.previsto || celda.codigo) as CodigoTurno,
          esRotacion: esRotado,
          breakTandaOrdenAnterior: celda.breakTandaOrden ?? null,
          breakInicioAnterior: celda.breakInicio ?? null,
          breakFinAnterior: celda.breakFin ?? null,
          breakTandaOrdenNuevo: null,
          breakInicioNuevo: null,
          breakFinNuevo: null,
        });

        fila[d.dia] = {
          codigo: '',
          previsto: prev,
          esRotacion: false,
          servicioEjecutorId: undefined,
          ...(celda.nota ? { nota: celda.nota } : {}),
        };
        loteParaDb.push({
          empleadoId: emp.id,
          dia: d.dia,
          codigo: '',
          previsto: prev,
          esRotacion: false,
          breakTandaOrden: null,
          breakInicio: null,
          breakFin: null,
        });
        celdasLimpiadas++;
      }
      actualMap[emp.id] = fila;
    }

    this.actualizarAsignacionesMesActual(actualMap);

    if (cambiosParaHistorial.length > 0) {
      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: `🧹 Dejar en blanco (${celdasLimpiadas} turnos)`,
            servicioId: srvId,
            anio,
            mes,
            cambios: cambiosParaHistorial,
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);
    }

    if (loteParaDb.length > 0) {
      this.api
        .guardarLoteCuadrante({
          servicioId: srvId,
          anio,
          mes,
          origenAccion: 'LIMPIAR',
          justificacion: '🧹 Limpiar cuadrante completo (Dejar en blanco)',
          celdas: loteParaDb,
        })
        .subscribe({
          next: () => {
            if (this.estadoCuadrante() === 'PUBLICADO') {
              this.cuadranteEditadoPublicado$.next();
            }
            this.celdaHistorialActualizada$.next({});
            const extraFij = celdasFijadasOmitidas > 0 ? ` y ${celdasFijadasOmitidas} celda(s) fijada(s) 📌` : '';
            this.notificacion.mostrar(
              `✅ Cuadro de turnos en blanco: ${celdasLimpiadas} turnos borrados. Novedades oficiales (VAC/INC/LIC/FAM)${extraFij} conservadas.`
            );
          },
          error: (err) => {
            this.asignacionesPorPeriodo.set(prevAsignaciones);
            this.pilaDeshacer.set(prevDeshacer);
            this.pilaRehacer.set(prevRehacer);
            const msg = err?.error?.message || 'Error al limpiar el cuadro de turnos en PostgreSQL.';
            this.notificacion.mostrar(`⛔ ${msg}`);
          },
        });
    } else if (celdasFijadasOmitidas > 0) {
      this.notificacion.mostrar(
        `📌 No se limpiaron turnos porque las ${celdasFijadasOmitidas} celda(s) ocupadas están fijadas.`
      );
    } else {
      this.notificacion.mostrar('ℹ️ No había turnos operativos para limpiar en este servicio.');
    }
  }

  ejecutarAutocompletarHuecos(): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevEstados = this.estadosPorCuadrante();
    const prevDeshacer = this.pilaDeshacer();
    const prevRehacer = this.pilaRehacer();
    const prevMapSnapshot = this.asignaciones();
    const srv = this.catalogos.servicioActual();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const necesitaIniciarBorrador = this.estadoCuadrante() === 'SIN_PLANIFICAR';
    const enBorradorGlobal = this.estadoCuadrante() === 'BORRADOR' || necesitaIniciarBorrador;

    if (necesitaIniciarBorrador) {
      this.estadosPorCuadrante.update((prev) => ({
        ...prev,
        [`${srvId}::${anio}-${mes}`]: 'BORRADOR',
      }));
    }

    const resultado = this.autocompletado.generarAutocompletadoCuadrante({
      srv,
      srvId,
      dias: this.diasDelMes(),
      catalogo: this.catalogos.catalogoTurnosMap(),
      listaTurnosCatalogo: this.catalogos.listaTurnosActivosCatalogo(),
      prevMapSnapshot,
      filasBase: this.filasServicioCompletas(),
      filtroCategoriaActiva: this.filtroCategoriaActiva(),
      enBorradorGlobal,
      obtenerMetasDiaServicio: this.obtenerMetasDiaServicioFn,
    });

    this.actualizarAsignacionesMesActual(resultado.actualMap);

    if (resultado.loteParaDb.length > 0) {
      this.pilaDeshacer.update((pila) =>
        [
          ...pila,
          {
            descripcion: `✨ Autocompletar (${resultado.loteParaDb.length} turnos)`,
            servicioId: srvId,
            anio,
            mes,
            cambios: resultado.cambiosAutocompletar,
          },
        ].slice(-30)
      );
      this.pilaRehacer.set([]);

      const lotePayload = {
        servicioId: srvId,
        anio,
        mes,
        origenAccion: 'AUTOCOMPLETAR',
        justificacion: '✨ Autocompletado inteligente de huecos',
        celdas: resultado.loteParaDb,
      };
      const guardarObs = necesitaIniciarBorrador
        ? this.api
            .actualizarEstadoCuadrante({ servicioId: srvId, anio, mes, estado: 'BORRADOR' })
            .pipe(concatMap(() => this.api.guardarLoteCuadrante(lotePayload)))
        : this.api.guardarLoteCuadrante(lotePayload);

      guardarObs.subscribe({
        next: () => {
          if (prevEstados[`${srvId}::${anio}-${mes}`] === 'PUBLICADO') {
            this.cuadranteEditadoPublicado$.next();
          }
          this.celdaHistorialActualizada$.next({});
          this.notificacion.mostrar(
            `✅ Autocompletado por cargo finalizado: ${resultado.totalAsignados} turnos operativos asignados respetando metas por cargo, 12h de descanso, celdas fijadas 📌 y máx. 6 días continuos.`
          );
        },
        error: (err) => {
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          this.estadosPorCuadrante.set(prevEstados);
          this.pilaDeshacer.set(prevDeshacer);
          this.pilaRehacer.set(prevRehacer);
          const msg = err?.error?.message || 'Error al guardar el autocompletado en PostgreSQL.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
    } else {
      this.notificacion.mostrar('ℹ️ El cuadrante ya cumple las metas configuradas o no hay huecos disponibles.');
    }
  }

  // Personal de Apoyo y Rotación Inter-Servicios
  abrirModalRotacion(): void {
    this.modalRotacionAbierto.set(true);
  }

  vincularRotacionAlCuadrante(cand: EmpleadoHospital): void {
    const srvId = this.catalogos.servicioSeleccionadoId();
    const mapaRot = { ...this.empleadosRotadosPorServicio() };
    const listaActual = mapaRot[srvId] || [];
    if (!listaActual.includes(cand.id)) {
      mapaRot[srvId] = [...listaActual, cand.id];
      this.empleadosRotadosPorServicio.set(mapaRot);
      this.guardarRotadosEnStorage(mapaRot);
    }
    this.notificacion.mostrar(`✅ ${cand.nombre} agregado como personal de apoyo al cuadrante.`);
    if (this.candidatosRotacionHomologos().length === 0) {
      this.modalRotacionAbierto.set(false);
    }
  }

  vincularTodoEquipoApoyo(): void {
    const cands = this.candidatosRotacionHomologos();
    if (cands.length === 0) return;

    const srvId = this.catalogos.servicioSeleccionadoId();
    const mapaRot = { ...this.empleadosRotadosPorServicio() };
    const setActual = new Set(mapaRot[srvId] || []);
    for (const c of cands) {
      setActual.add(c.id);
    }
    mapaRot[srvId] = Array.from(setActual);
    this.empleadosRotadosPorServicio.set(mapaRot);
    this.guardarRotadosEnStorage(mapaRot);
    this.modalRotacionAbierto.set(false);
    this.notificacion.mostrar(
      `🔄 ${cands.length} colaboradores de apoyo vinculados al cuadrante de ${this.catalogos.servicioActual().nombre}.`
    );
  }

  quitarPersonalApoyo(empId: string): void {
    const srvId = this.catalogos.servicioSeleccionadoId();
    const empObj = this.catalogos.empleados().find((e) => e.id === empId);
    const actualMap = { ...this.asignaciones() };
    const fila = { ...(actualMap[empId] || {}) };

    let turnosEnEsteServicio = 0;
    for (const celda of Object.values(fila)) {
      if (celda && celda.servicioEjecutorId === srvId && celda.codigo && celda.codigo !== '') {
        turnosEnEsteServicio++;
      }
    }

    const ejecutarRemocion = () => {
      const prevRot = this.empleadosRotadosPorServicio();
      const prevAsignaciones = this.asignacionesPorPeriodo();
      const anio = this.catalogos.anioSeleccionado();
      const mes = this.catalogos.mesSeleccionado();

      const mapaRot = { ...prevRot };
      const listaActual = (mapaRot[srvId] || []).filter((id) => id !== empId);
      mapaRot[srvId] = listaActual;
      this.empleadosRotadosPorServicio.set(mapaRot);
      this.guardarRotadosEnStorage(mapaRot);

      const mapaActualizado = { ...this.asignaciones() };
      const filaEmp = { ...(mapaActualizado[empId] || {}) };
      const loteLimpiar: {
        empleadoId: string;
        dia: number;
        codigo: string;
        esRotacion: boolean;
        breakTandaOrden: number | null;
        breakInicio: string | null;
        breakFin: string | null;
      }[] = [];
      let fijadasOmitidas = 0;

      for (const [diaStr, celda] of Object.entries(filaEmp)) {
        if (celda && celda.servicioEjecutorId === srvId && celda.codigo && celda.codigo !== '') {
          if (celda.fijada) {
            fijadasOmitidas++;
            continue;
          }
          const diaNum = Number(diaStr);
          filaEmp[diaNum] = {
            codigo: '' as CodigoTurno,
            previsto: celda.previsto,
            esRotacion: false,
            servicioEjecutorId: undefined,
            ...(celda.nota ? { nota: celda.nota } : {}),
          };
          loteLimpiar.push({
            empleadoId: empId,
            dia: diaNum,
            codigo: '',
            esRotacion: false,
            breakTandaOrden: null,
            breakInicio: null,
            breakFin: null,
          });
        }
      }

      if (loteLimpiar.length > 0) {
        mapaActualizado[empId] = filaEmp;
        this.actualizarAsignacionesMesActual(mapaActualizado);
        this.api
          .guardarLoteCuadrante({
            servicioId: srvId,
            anio,
            mes,
            origenAccion: 'APOYO',
            justificacion: `🔄 Retiro de personal de apoyo (${loteLimpiar.length} días liberados)`,
            celdas: loteLimpiar,
          })
          .subscribe({
            next: () => {
              this.celdaHistorialActualizada$.next({});
              const msgFij = fijadasOmitidas > 0 ? ` (${fijadasOmitidas} fijada(s) 📌 conservadas)` : '';
              this.notificacion.mostrar(`✅ ${empObj?.nombre || 'Colaborador'} removido del personal de apoyo${msgFij}.`);
            },
            error: (err) => {
              this.empleadosRotadosPorServicio.set(prevRot);
              this.guardarRotadosEnStorage(prevRot);
              this.asignacionesPorPeriodo.set(prevAsignaciones);
              const msg = err?.error?.message || 'Error al liberar los días del personal de apoyo en PostgreSQL.';
              this.notificacion.mostrar(`⛔ ${msg}`);
            },
          });
      } else {
        this.notificacion.mostrar(`✅ ${empObj?.nombre || 'Colaborador'} removido del personal de apoyo.`);
      }
    };

    if (turnosEnEsteServicio > 0) {
      this.notificacion.abrirConfirmacion({
        titulo: '🔄 Quitar Personal de Apoyo',
        mensaje: `${empObj?.nombre || 'Este colaborador'} tiene ${turnosEnEsteServicio} turno(s) asignados en "${this.catalogos.servicioActual().nombre}" este mes.\n\nSi lo retiras del cuadro de apoyo, se liberarán esos ${turnosEnEsteServicio} días (sus turnos en otros servicios no se verán afectados). ¿Deseas continuar?`,
        textoBotonConfirmar: 'Sí, Retirar y Liberar Días',
        esPeligroso: true,
        onConfirmar: ejecutarRemocion,
      });
    } else {
      ejecutarRemocion();
    }
  }

  cambiarEstadoCuadrante(): void {
    if (this.catalogos.esColaborador()) {
      this.notificacion.mostrar('⛔ No tienes permisos para cambiar el estado del cuadrante.');
      return;
    }

    const actual = this.estadoCuadrante();
    if (this.catalogos.esCoordinador() && actual === 'PUBLICADO') {
      this.notificacion.mostrar('⛔ El Cierre para Nómina está reservado exclusivamente al perfil de Talento Humano / Nómina.');
      return;
    }
    if (this.catalogos.esCoordinador() && actual === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ Este mes ya fue cerrado para Nómina. Solo Talento Humano puede reabrirlo.');
      return;
    }

    const prevEstados = this.estadosPorCuadrante();
    const prevAsignaciones = this.asignacionesPorPeriodo();
    const prevSaldos = this.saldosConsolidadosMap();

    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const key = `${srvId}::${anio}-${mes}`;
    const mesNombre = this.catalogos.nombreMesSeleccionado();
    const srvNombre = this.catalogos.servicioActual().nombre;

    let nuevoEstado: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA';
    let msgExito = '';
    if (actual === 'SIN_PLANIFICAR') {
      nuevoEstado = 'BORRADOR';
      msgExito = `✅ Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) iniciado en borrador.`;
    } else if (actual === 'BORRADOR') {
      nuevoEstado = 'PUBLICADO';
      msgExito = `✅ Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) publicado oficialmente.`;
    } else if (actual === 'PUBLICADO') {
      const pendientes = this.empresasPendientesEnCuadrante();
      if (pendientes.length > 0) {
        const listado = pendientes.map((e) => `${e.nombre} (${e.codigo})`).join(', ');
        this.notificacion.mostrar(
          `⛔ No se puede cerrar para Nómina: hay empresa(s) con reglas pendientes por confirmar (${listado}). Confírmalas en Configuración → Empresas.`
        );
        return;
      }
      nuevoEstado = 'CERRADO_NOMINA';
      msgExito = `✅ Mes de ${mesNombre} ${anio} (${srvNombre}) cerrado para Nómina.`;
    } else {
      nuevoEstado = 'PUBLICADO';
      msgExito = `✅ Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) reabierto para gestión.`;
    }

    this.estadosPorCuadrante.update((m) => ({ ...m, [key]: nuevoEstado }));

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

    const saldosConsolidados =
      nuevoEstado === 'CERRADO_NOMINA' || nuevoEstado === 'PUBLICADO'
        ? this.filasServicioCompletas()
            .filter((f) => !f.esPersonalRotado)
            .map((f) => ({
              empleadoId: f.empleado.id,
              saldoInicial: f.empleado.saldoBancoAnterior,
              horasTrabajadas: f.horasTrabajadas,
              horasContratadas: f.horasContratadasEfectivas ?? f.empleado.horasContratoMes,
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
      .subscribe({
        next: () => {
          this.notificacion.mostrar(msgExito);
          this.cuadranteEditadoPublicado$.next();
        },
        error: (err) => {
          this.estadosPorCuadrante.set(prevEstados);
          this.asignacionesPorPeriodo.set(prevAsignaciones);
          this.saldosConsolidadosMap.set(prevSaldos);
          const msg = err?.error?.message || 'Error al actualizar estado del cuadrante en PostgreSQL.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  revertirCuadranteABorrador(): void {
    if (!this.catalogos.esAdminTh()) {
      this.notificacion.mostrar('⛔ Solo Talento Humano puede devolver un cuadrante publicado a estado Borrador.');
      return;
    }
    if (this.estadoCuadrante() !== 'PUBLICADO') {
      return;
    }

    const srvId = this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const key = `${srvId}::${anio}-${mes}`;
    const mesNombre = this.catalogos.nombreMesSeleccionado();
    const srvNombre = this.catalogos.servicioActual().nombre;

    this.notificacion.abrirConfirmacion({
      titulo: '↩️ Devolver Cuadrante a Borrador',
      mensaje: `¿Seguro que deseas devolver el cuadrante de "${srvNombre}" (${mesNombre} ${anio}) a estado BORRADOR?\n\nMientras esté en Borrador, los cambios realizados no generarán registros individuales de auditoría post-publicación, pero esta reapertura quedará registrada en la bitácora oficial.`,
      textoBotonConfirmar: 'Sí, Volver a Borrador',
      esPeligroso: false,
      onConfirmar: () => {
        const prevEstados = this.estadosPorCuadrante();
        this.estadosPorCuadrante.update((m) => ({ ...m, [key]: 'BORRADOR' }));
        this.api
          .actualizarEstadoCuadrante({
            servicioId: srvId,
            anio,
            mes,
            estado: 'BORRADOR',
          })
          .subscribe({
            next: () => {
              this.notificacion.mostrar(
                `✅ Cuadro de turnos de ${srvNombre} (${mesNombre} ${anio}) devuelto a Borrador.`
              );
              this.cuadranteEditadoPublicado$.next();
            },
            error: (err) => {
              this.estadosPorCuadrante.set(prevEstados);
              const msg = err?.error?.message || 'Error al devolver el cuadrante a Borrador en PostgreSQL.';
              this.notificacion.mostrar(`⛔ ${msg}`);
            },
          });
      },
    });
  }

  exportarExcelNomina(): void {
    const filas = this.filasServicioCompletas();
    const dias = this.diasDelMes();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const srvActual = this.catalogos.servicioActual();
    const encabezadosDias = dias.map((d) => `Dia_${d.dia}`).join(';');
    const header = `Periodo;Documento;Colaborador;Cargo;Empresa;Regimen_Semanal_H;Servicio;Dias_Habiles_Mes;Dias_Habiles_Prorrateados;Meta_Nominal_H;Prorrateo_H;Meta_Neta_H;HOD;HON;HDFD;HDFN;Horas_Trabajadas;Amortizadas_COMP_H;Recargo_Nocturno_Pct;Recargo_Dominical_Festivo_Pct;Recargo_Nocturno_Dominical_Festivo_Pct;Domingos_Laborados;Dom_Fest_Laborados;Compensatorio_Causado;Dias_VAC;Dias_INC;Dias_LIC;Dias_FAM;Saldo_Banco_Anterior;Diferencia_Mes;Nuevo_Saldo_Banco;${encabezadosDias}`;
    const periodoCsv = `${anio}-${String(mes).padStart(2, '0')}`;

    const lineas = filas.map((f) => {
      const turnosDia = dias.map((d) => f.celdas[d.dia]?.codigo || 'L').join(';');
      return [
        periodoCsv,
        csvTexto(f.empleado.documento),
        csvTexto(f.empleado.nombre),
        csvTexto(f.empleado.categoria),
        csvTexto(f.empresaNombre),
        numeroCsv(f.horasSemanalesAplicadas),
        csvTexto(srvActual.nombre),
        f.diasHabilesMes,
        f.diasHabilesProrrateados,
        numeroCsv(f.horasContratadasNominales),
        numeroCsv(f.horasExoneradas),
        numeroCsv(f.horasContratadasEfectivas),
        numeroCsv(f.hod),
        numeroCsv(f.hon),
        numeroCsv(f.hdfd),
        numeroCsv(f.hdfn),
        numeroCsv(f.horasTrabajadas),
        numeroCsv(f.horasAmortizadasComp),
        formatearPorcentaje(f.recargos.nocturno),
        formatearPorcentaje(f.recargos.dominical),
        formatearPorcentaje(f.recargos.nocturnoDominical),
        f.conteoDomingos,
        f.conteoDomFest,
        f.causaCompensatorioDominical ? 1 : 0,
        f.diasVac,
        f.diasInc,
        f.diasLic,
        f.diasFam,
        numeroCsv(f.empleado.saldoBancoAnterior),
        numeroCsv(f.diferenciaMes),
        numeroCsv(f.nuevoSaldoBanco),
        turnosDia,
      ].join(';');
    });

    descargarArchivoCsv(
      `Reporte_Nomina_${srvActual.codigo}_${anio}_${mes}.csv`,
      '\uFEFF' + [header, ...lineas].join('\n')
    );

    this.notificacion.mostrar('✅ Archivo Excel (CSV) de Nómina y Banco de Horas descargado.');
  }
}
