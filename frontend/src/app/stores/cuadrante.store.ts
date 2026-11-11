import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, concatMap, forkJoin, map, Observable, of, Subject } from 'rxjs';
import {
  CambioCeldaHistorial,
  CeldaAsignacion,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  InfraccionNormativa,
  PasoHistorialEdicion,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoTurnoConfig,
  TODOS_LOS_MESES,
} from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import {
  calcularMetricasMesColaborador,
  guardarStorageSeguro,
  horasLiquidadasCelda,
  leerStorageSeguro,
  predicadoDescansoObligatorio,
  resumirHorasPeriodo,
} from '../calculo-turnos.helper';
import {
  calcularDescansoEntreTurnosMin,
  calcularMetaContractualProrrateada,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  evaluarJornadaSemanalPeriodo,
  formatearPorcentaje,
  r2,
} from '../shared/liquidacion-horas';
import { AutocompletadoService, clasificarFranjasTurno } from './autocompletado.service';
import { CatalogosSsoStore, csvTexto, descargarArchivoCsv, numeroCsv } from './catalogos-sso.store';
import { NotificacionStore } from './notificacion.store';

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

  readonly mostrarComparadorPrevisto = signal<boolean>(false);
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

  constructor() {
    this.catalogos.empleadosActualizados$
      .pipe(takeUntilDestroyed())
      .subscribe((emps) => {
        this.inicializarMatrizCuadrante(emps);
      });
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

  readonly listaTurnosPaleta = computed<TipoTurnoConfig[]>(() => {
    const srv = this.catalogos.servicioActual();
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
    const codigosBaseDescanso = new Set(['L', 'S', 'COMP', 'VAC', 'INC', 'LIC', 'FAM']);

    return this.catalogos.listaTurnosCatalogo().filter((t) => {
      if (t.visibleEnPaleta === false) return false;
      if (!habilitadosSrv) return true;
      return habilitadosSrv.has(t.codigo.toUpperCase()) || codigosBaseDescanso.has(t.codigo.toUpperCase());
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
    const emps = this.catalogos.empleados();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const asignaciones = this.asignacionesPorPeriodo();
    const saldosOficialesDb = this.saldosConsolidadosMap();
    const estados = this.estadosPorCuadrante();
    const anio = this.catalogos.anioSeleccionado();
    const esDescansoPred = predicadoDescansoObligatorio();

    const mapa: Record<string, { saldoInicial: number; saldoFinal: number }> = {};

    for (const emp of emps) {
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

        const { horasTrabajadas, horasAmortizadasComp, diasExonerados } = resumirHorasPeriodo(
          celdasEmp,
          anio,
          m,
          catalogo,
          esDescansoPred
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

        if (tieneActividadOperativa) {
          const totalDiasMes = new Date(Date.UTC(anio, m, 0)).getUTCDate();
          const metaMes = calcularMetaContractualProrrateada(
            emp.horasContratoMes,
            totalDiasMes,
            diasExonerados
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
    const emps = this.catalogos.empleados();
    const mapa = this.mapaSaldosContinuos();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    return emps.map((e) => {
      const key = `${e.id}::${anio}-${mes}`;
      const saldoObj = mapa[key];
      const saldoReal = saldoObj !== undefined ? saldoObj.saldoInicial : e.saldoBancoAnterior;
      return {
        ...e,
        saldoBancoAnterior: saldoReal,
      };
    });
  });

  readonly filasServicioCompletas = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const listaEmp = this.empleadosServicioSinFiltro();
    const catalogo = this.catalogos.catalogoTurnosMap();
    const saldos = this.saldosConsolidadosMap();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const mapaContinuo = this.mapaSaldosContinuos();
    const srvId = this.catalogos.servicioSeleccionadoId();
    const mapaServicios = new Map(this.catalogos.servicios().map((s) => [s.id, s]));
    const esDescansoPredicado = predicadoDescansoObligatorio();

    return listaEmp.map(({ emp, esRotado }) => {
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
        saldoCalculado
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

      let horasLocales = 0;
      let horasOtrosServicios = 0;
      const horasPorServicioMap = new Map<string, number>();

      for (const d of dias) {
        const celda = celdasEmp[d.dia];
        const cod = celda?.codigo || '';
        if (!cod) continue;
        const cfg = catalogo[cod];
        if (!cfg || cfg.esAusencia) continue;
        const hOrd = horasLiquidadasCelda(cfg, d.fechaIso, esDescansoPredicado);
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
      const itemsEmp: { fechaIso: string; turno: TipoTurnoConfig | undefined }[] = [];
      for (let dPrev = inicioRetro; dPrev <= ultimoDiaPrev; dPrev++) {
        const cP = celdasPrevEmp?.[dPrev]?.codigo || '';
        const cfgP = cP ? catalogo[cP] : undefined;
        if (cfgP) {
          itemsEmp.push({
            fechaIso: `${anioPrev}-${String(mesPrev).padStart(2, '0')}-${String(dPrev).padStart(2, '0')}`,
            turno: cfgP,
          });
        }
      }
      for (const d of dias) {
        const cod = f.celdas[d.dia]?.codigo || '';
        const cfg = cod ? catalogo[cod] : undefined;
        if (cfg) {
          itemsEmp.push({ fechaIso: d.fechaIso, turno: cfg });
        }
      }

      if (itemsEmp.length > 0) {
        const evalSem = evaluarJornadaSemanalPeriodo(itemsEmp);
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
            mensaje: `${f.empleado.nombre} (Sem ${w.semanaInicioIso.slice(5)}): Excede tope legal de ${w.limiteOrdinarioVigente + 12}h/sem (${w.horasTotales}h programadas; jornada ${w.limiteOrdinarioVigente}h + 12h extras máx. Art. 22 Ley 50/90).`,
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
    const mapaServicios = new Map(this.catalogos.servicios().map((s) => [s.id, s]));

    return todos
      .filter((e) => idsHermanos.includes(e.servicioBaseId) && !yaIncluidos.has(e.id))
      .map((e) => {
        const srvOrigen = mapaServicios.get(e.servicioBaseId);
        const celdasEmp = matriz[e.id] || {};
        let horasMesActual = 0;
        for (const d of dias) {
          const cod = celdasEmp[d.dia]?.codigo || '';
          const cfg = cod ? catalogo[cod] : undefined;
          if (cfg && !cfg.esAusencia) {
            horasMesActual += horasLiquidadasCelda(cfg, d.fechaIso);
          }
        }
        return {
          ...e,
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
          .pipe(catchError(() => of({ ok: false, creados: 0, actualizados: 0 })))
      : of({ ok: false, creados: 0, actualizados: 0 });

    syncEmpleados$
      .pipe(
        concatMap((resEmp: any) => {
          if (resEmp && (resEmp.creados > 0 || resEmp.actualizados > 0)) {
            return this.api.getEmpleados().pipe(
              map((empsDb) => this.catalogos.aplicarEmpleadosDesdeDb(empsDb)),
              catchError(() => of(null)),
              concatMap(() => this.api.sincronizarNovedadesIntranet(anio, mes))
            );
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

          if (res && res.ok && !silencioso) {
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

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      const celdaPre = filaEmp[c.dia];
      cambiosRehacer.push({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: celdaPre?.previsto ?? c.previstoAnterior,
        esRotacion: celdaPre?.esRotacion,
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
      };
      actualMap[c.empId] = filaEmp;
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
    if (ultimoPaso.cambios.length > 5) {
      const loteDb = ultimoPaso.cambios.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return {
          empleadoId: c.empId,
          dia: c.dia,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
        };
      });
      persistencia$ = this.api.guardarLoteCuadrante({
        servicioId: ultimoPaso.servicioId,
        anio: ultimoPaso.anio,
        mes: ultimoPaso.mes,
        celdas: loteDb,
      });
    } else {
      const llamadas = ultimoPaso.cambios.map((c) => {
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
        });
      });
      persistencia$ = llamadas.length > 0 ? forkJoin(llamadas) : of(null);
    }

    persistencia$.subscribe({
      next: () => {
        if (this.estadoCuadrante() === 'PUBLICADO') {
          this.cuadranteEditadoPublicado$.next();
        }
        this.notificacion.mostrar(`↩️ Deshecho: ${ultimoPaso.descripcion}`);
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

    for (const c of ultimoPaso.cambios) {
      const filaEmp = { ...(actualMap[c.empId] || {}) };
      const celdaPre = filaEmp[c.dia];
      cambiosDeshacer.push({
        empId: c.empId,
        dia: c.dia,
        turnoAnterior: c.turnoNuevo,
        turnoNuevo: c.turnoAnterior,
        previstoAnterior: celdaPre?.previsto ?? c.previstoAnterior,
        esRotacion: celdaPre?.esRotacion,
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
      };
      actualMap[c.empId] = filaEmp;
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
    if (ultimoPaso.cambios.length > 5) {
      const loteDb = ultimoPaso.cambios.map((c) => {
        const celdaDest = actualMap[c.empId]?.[c.dia];
        return {
          empleadoId: c.empId,
          dia: c.dia,
          codigo: c.turnoAnterior,
          previsto: celdaDest?.previsto ?? (enBorrador ? c.turnoAnterior : ''),
          esRotacion: !!celdaDest?.esRotacion,
        };
      });
      persistencia$ = this.api.guardarLoteCuadrante({
        servicioId: ultimoPaso.servicioId,
        anio: ultimoPaso.anio,
        mes: ultimoPaso.mes,
        celdas: loteDb,
      });
    } else {
      const llamadas = ultimoPaso.cambios.map((c) => {
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
        });
      });
      persistencia$ = llamadas.length > 0 ? forkJoin(llamadas) : of(null);
    }

    persistencia$.subscribe({
      next: () => {
        if (this.estadoCuadrante() === 'PUBLICADO') {
          this.cuadranteEditadoPublicado$.next();
        }
        this.notificacion.mostrar(`↪️ Rehecho: ${ultimoPaso.descripcion}`);
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

  aplicarTurnoEnCelda(empId: string, dia: number, nuevoCodigo: CodigoTurno, origen: string): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.notificacion.mostrar('⛔ El cuadro de turnos está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];
    const cfgActual = celdaActual?.codigo ? this.catalogos.catalogoTurnosMap()[celdaActual.codigo] : undefined;

    if (
      (esCodigoExoneracionContrato(celdaActual?.codigo) || cfgActual?.esAusencia) &&
      nuevoCodigo !== celdaActual?.codigo
    ) {
      this.notificacion.mostrar(
        `🔒 Celda bloqueada: Novedad oficial de Intranet (${celdaActual?.codigo}). Las ausencias oficiales solo pueden ser gestionadas desde Gestión Humana.`
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

    const anterior = (celdaActual?.codigo as CodigoTurno) || '';
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

    const cambioHistorial: CambioCeldaHistorial = {
      empId,
      dia,
      turnoAnterior: anterior as CodigoTurno,
      turnoNuevo: nuevoCodigo,
      previstoAnterior: celdaActual?.previsto,
      esRotacion,
    };

    filaEmp[dia] = {
      codigo: nuevoCodigo,
      previsto: enBorrador ? nuevoCodigo : (celdaActual?.previsto ?? (anterior as CodigoTurno)),
      esRotacion,
      servicioEjecutorId: liberaPropiedadDia ? undefined : srvId,
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
      if ((!sig || sig === 'L') && !bloqueadaOtroSrv) {
        cambioSalienteHistorial = {
          empId,
          dia: dia + 1,
          turnoAnterior: sig as CodigoTurno,
          turnoNuevo: 'S' as CodigoTurno,
          previstoAnterior: celdaSig?.previsto,
          esRotacion: esRotacionBase,
        };
        filaEmp[dia + 1] = {
          codigo: 'S',
          previsto: enBorrador ? 'S' : (filaEmp[dia + 1]?.previsto ?? sig),
          esRotacion: esRotacionBase,
          servicioEjecutorId: srvId,
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
      }
      if (cambioSalienteHistorial) {
        const idxSig = this.loteArrastreActual.findIndex((c) => c.empId === empId && c.dia === dia + 1);
        if (idxSig === -1) {
          this.loteArrastreActual.push(cambioSalienteHistorial);
        } else {
          this.loteArrastreActual[idxSig].turnoNuevo = 'S' as CodigoTurno;
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
        justificacion: origen,
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
          justificacion: `${origen} (Auto Saliente Post-Guardia)`,
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
    const loteParaDb: {
      empleadoId: string;
      dia: number;
      codigo: string;
      previsto?: string;
      esRotacion?: boolean;
    }[] = [];
    const cambiosParaHistorial: CambioCeldaHistorial[] = [];

    const enBorrador = this.estadoCuadrante() === 'BORRADOR';

    for (const { emp, esRotado } of this.empleadosServicioSinFiltro()) {
      const fila = { ...(actualMap[emp.id] || {}) };
      for (const d of this.diasDelMes()) {
        const celda = fila[d.dia];
        const cfgCelda = celda?.codigo ? catalogo[celda.codigo] : undefined;
        if (
          !celda ||
          celda.codigo === '' ||
          esCodigoExoneracionContrato(celda.codigo) ||
          cfgCelda?.esAusencia
        ) {
          continue;
        }
        if (celda.servicioEjecutorId && celda.servicioEjecutorId !== srvId) {
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
        });

        fila[d.dia] = {
          codigo: '',
          previsto: prev,
          esRotacion: false,
          servicioEjecutorId: undefined,
        };
        loteParaDb.push({
          empleadoId: emp.id,
          dia: d.dia,
          codigo: '',
          previsto: prev,
          esRotacion: false,
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
          celdas: loteParaDb,
        })
        .subscribe({
          next: () => {
            if (this.estadoCuadrante() === 'PUBLICADO') {
              this.cuadranteEditadoPublicado$.next();
            }
            this.notificacion.mostrar(
              `✅ Cuadro de turnos en blanco: ${celdasLimpiadas} turnos borrados. Novedades oficiales de Intranet (VAC/INC/LIC/FAM) conservadas.`
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
      listaTurnosCatalogo: this.catalogos.listaTurnosCatalogo(),
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
          this.notificacion.mostrar(
            `✅ Autocompletado por cargo finalizado: ${resultado.totalAsignados} turnos operativos asignados respetando metas por cargo, 12h de descanso y máx. 6 días continuos.`
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
      const loteLimpiar: { empleadoId: string; dia: number; codigo: string; esRotacion: boolean }[] = [];

      for (const [diaStr, celda] of Object.entries(filaEmp)) {
        if (celda && celda.servicioEjecutorId === srvId && celda.codigo && celda.codigo !== '') {
          const diaNum = Number(diaStr);
          filaEmp[diaNum] = {
            codigo: '' as CodigoTurno,
            previsto: celda.previsto,
            esRotacion: false,
            servicioEjecutorId: undefined,
          };
          loteLimpiar.push({
            empleadoId: empId,
            dia: diaNum,
            codigo: '',
            esRotacion: false,
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
            celdas: loteLimpiar,
          })
          .subscribe({
            next: () => {
              this.notificacion.mostrar(`✅ ${empObj?.nombre || 'Colaborador'} removido del personal de apoyo.`);
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
    const header = `Periodo;Documento;Colaborador;Cargo;Servicio;Contrato_Mes;Contrato_Efectivo_Mes;HOD;HON;HDFD;HDFN;Horas_Trabajadas;Recargo_Nocturno_Pct;Recargo_Dominical_Festivo_Pct;Recargo_Nocturno_Dominical_Festivo_Pct;Domingos_Laborados;Dom_Fest_Laborados;Compensatorio_Causado;Dias_VAC;Dias_INC;Dias_LIC;Dias_FAM;Saldo_Banco_Anterior;Diferencia_Mes;Nuevo_Saldo_Banco;${encabezadosDias}`;
    const periodoCsv = `${anio}-${String(mes).padStart(2, '0')}`;

    const lineas = filas.map((f) => {
      const turnosDia = dias.map((d) => f.celdas[d.dia]?.codigo || 'L').join(';');
      return [
        periodoCsv,
        csvTexto(f.empleado.documento),
        csvTexto(f.empleado.nombre),
        csvTexto(f.empleado.categoria),
        csvTexto(srvActual.nombre),
        numeroCsv(f.empleado.horasContratoMes),
        numeroCsv(f.horasContratadasEfectivas),
        numeroCsv(f.hod),
        numeroCsv(f.hon),
        numeroCsv(f.hdfd),
        numeroCsv(f.hdfn),
        numeroCsv(f.horasTrabajadas),
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
