import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CeldaAsignacion,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  EmpresaContratante,
  PermutaItem,
  SesionUsuarioSso,
  TODOS_LOS_MESES,
} from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import {
  calcularMetaNominalMesEmpleado,
  calcularMetricasMesColaborador,
} from '../calculo-turnos.helper';
import {
  esCodigoExoneracionContrato,
  formatearPorcentaje,
  r2,
} from '../shared/liquidacion-horas';
import { CatalogosSsoStore, csvTexto, descargarArchivoCsv, numeroCsv } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';
import { NotificacionStore } from './notificacion.store';
import { PermutasAuditoriaStore } from './permutas-auditoria.store';

@Injectable({ providedIn: 'root' })
export class PortalReportesStore {
  private readonly api = inject(TurnosApiService);
  private readonly notificacion = inject(NotificacionStore);
  private readonly catalogos = inject(CatalogosSsoStore);
  private readonly cuadrante = inject(CuadranteStore);
  private readonly permutasAuditoria = inject(PermutasAuditoriaStore);

  // Reportes y Analítica Hospitalaria
  readonly subVistaReportes = signal<'PRE_NOMINA' | 'EQUIDAD' | 'BANCO_HORAS' | 'AUSENTISMO'>('PRE_NOMINA');
  readonly filtroReporteServicioId = signal<string>('TODOS');
  readonly filtroReporteEmpresaId = signal<string>('TODOS');
  readonly busquedaReporteTexto = signal<string>('');

  readonly empresasDisponiblesReportes = computed<EmpresaContratante[]>(() => {
    const lista = this.catalogos.empresas();
    if (lista.length > 0) return lista;
    const derivadas = new Map<string, EmpresaContratante>();
    for (const e of this.catalogos.empleados()) {
      if (e.empresaContratante?.id) {
        derivadas.set(e.empresaContratante.id, e.empresaContratante as EmpresaContratante);
      }
    }
    return Array.from(derivadas.values());
  });

  // Portal del Colaborador y iCal
  readonly empleadoPortalId = signal<string>('');
  readonly diaPermutaSeleccionado = signal<number>(this.catalogos.diaActual);
  readonly companeroPermutaId = signal<string>('');
  readonly modalIcalAbierto = signal<boolean>(false);
  readonly enlaceIcalHttp = signal<string>('');
  readonly enlaceIcalWebcal = signal<string>('');
  readonly enlaceIcalEmpleadoNombre = signal<string>('');

  constructor() {
    this.catalogos.empleadosActualizados$
      .pipe(takeUntilDestroyed())
      .subscribe((emps) => {
        this.sincronizarSeleccionTrasCargaEmpleados(emps);
      });
  }

  readonly esPeriodoActualPortal = computed<boolean>(
    () => this.catalogos.anioSeleccionado() === this.catalogos.anioActual && this.mesSeleccionadoPortal() === this.catalogos.mesActual
  );

  // El Portal del Colaborador únicamente muestra meses con programación PUBLICADA o CERRADA de su servicio
  readonly mesesDisponiblesPortal = computed<Array<{ valor: number; nombre: string }>>(() => {
    const empId = this.empleadoPortalId();
    const sesion = this.catalogos.sesionActual();
    const emp = this.catalogos.empleados().find((e) => e.id === empId);
    const srvId = emp?.servicioBaseId || sesion?.servicioBaseId || this.catalogos.servicioSeleccionadoId();
    const anio = this.catalogos.anioSeleccionado();
    const estados = this.cuadrante.estadosPorCuadrante();

    const mesesValidos = new Set<number>();
    for (const [key, estado] of Object.entries(estados)) {
      const prefix = `${srvId}::${anio}-`;
      if (key.startsWith(prefix) && (estado === 'PUBLICADO' || estado === 'CERRADO_NOMINA')) {
        const mesNum = Number(key.replace(prefix, ''));
        if (!isNaN(mesNum) && mesNum >= 1 && mesNum <= 12) {
          mesesValidos.add(mesNum);
        }
      }
    }

    return TODOS_LOS_MESES.filter((m) => mesesValidos.has(m.valor));
  });

  readonly mesSeleccionadoPortal = computed<number>(() => {
    const disponibles = this.mesesDisponiblesPortal();
    if (disponibles.length === 0) {
      return this.catalogos.mesSeleccionado();
    }
    const actual = this.catalogos.mesSeleccionado();
    if (disponibles.some((m) => m.valor === actual)) {
      return actual;
    }
    return disponibles[disponibles.length - 1].valor;
  });

  readonly estadoCuadrantePortal = computed<'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | 'SIN_PLANIFICAR'>(() => {
    const empId = this.empleadoPortalId();
    const sesion = this.catalogos.sesionActual();
    const emp = this.catalogos.empleados().find((e) => e.id === empId);
    const srvId = emp?.servicioBaseId || sesion?.servicioBaseId || this.catalogos.servicioSeleccionadoId();
    const mes = this.mesSeleccionadoPortal();
    const key = `${srvId}::${this.catalogos.anioSeleccionado()}-${mes}`;
    return this.cuadrante.estadosPorCuadrante()[key] || 'SIN_PLANIFICAR';
  });

  readonly diasDelMesPortal = computed<DiaColumna[]>(() => {
    this.catalogos.versionCacheFestivos();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.mesSeleccionadoPortal();
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

  readonly celdasOffsetInicioMesPortal = computed<number[]>(() => {
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.mesSeleccionadoPortal();
    const primerDia = new Date(Date.UTC(anio, mes - 1, 1)).getUTCDay();
    const offset = primerDia === 0 ? 6 : primerDia - 1;
    return Array.from({ length: offset }, (_, i) => i);
  });

  readonly celdasOffsetFinMesPortal = computed<number[]>(() => {
    const totalCeldas = this.celdasOffsetInicioMesPortal().length + this.diasDelMesPortal().length;
    const resto = totalCeldas % 7;
    const faltantes = resto === 0 ? 0 : 7 - resto;
    return Array.from({ length: faltantes }, (_, i) => i);
  });

  readonly asignacionesMesPortal = computed<Record<string, Record<number, CeldaAsignacion>>>(() => {
    const key = `${this.catalogos.anioSeleccionado()}-${this.mesSeleccionadoPortal()}`;
    return this.cuadrante.asignacionesPorPeriodo()[key] || {};
  });

  readonly empleadosVisiblesPortal = computed<EmpleadoHospital[]>(() => {
    const todos = this.catalogos.empleados();
    if (this.catalogos.esAdminTh()) {
      return todos;
    }
    if (this.catalogos.esCoordinador()) {
      const sesion = this.catalogos.sesionActual();
      const permitidos = new Set(sesion?.serviciosPermitidosIds || [sesion?.servicioBaseId || '']);
      const filtrados = todos.filter((e) => permitidos.has(e.servicioBaseId));
      return filtrados.length > 0 ? filtrados : todos;
    }
    const id = this.empleadoPortalId();
    return todos.filter((e) => e.id === id);
  });

  readonly datosEmpleadoPortal = computed(() => {
    const id = this.empleadoPortalId();
    const sesion = this.catalogos.sesionActual();
    const empresasMap = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const emps = this.catalogos.empleados();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.mesSeleccionadoPortal();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));

    const encontrarEmp = emps.find((e) => e.id === id);
    let empBase: EmpleadoHospital;
    if (encontrarEmp) {
      const eId = encontrarEmp.empresaContratanteId || encontrarEmp.empresaContratante?.id;
      const empAct = eId ? empresasMap.get(eId) : undefined;
      empBase = empAct
        ? {
            ...encontrarEmp,
            empresaContratanteId: empAct.id,
            empresaContratante: empAct,
            horasSemanalesAplicadas: encontrarEmp.horasSemanalesOverride ?? empAct.horasSemanalesContrato,
          }
        : encontrarEmp;
    } else if (sesion && (sesion.empleadoId === id || sesion.documento === id)) {
      const empSesionAct = sesion.empresaContratanteId ? empresasMap.get(sesion.empresaContratanteId) : undefined;
      empBase = {
        id: sesion.empleadoId,
        documento: sesion.documento,
        nombre: sesion.nombre,
        categoria: sesion.categoria,
        servicioBaseId: sesion.servicioBaseId,
        empresaContratanteId: sesion.empresaContratanteId ?? undefined,
        empresaContratante:
          empSesionAct ||
          (sesion.empresaCodigo || sesion.horasSemanalesAplicadas
            ? {
                id: sesion.empresaContratanteId ?? undefined,
                codigo: sesion.empresaCodigo ?? 'CST_DEFAULT',
                nombre: sesion.empresaNombre ?? sesion.empresaCodigo ?? 'Régimen CST',
                estadoConfiguracion: sesion.empresaEstadoConfiguracion ?? 'CONFIRMADA',
                horasSemanalesContrato: sesion.horasSemanalesAplicadas ?? 42,
              }
            : null),
        horasSemanalesAplicadas: sesion.horasSemanalesAplicadas,
        horasContratoMes: 0,
        saldoBancoAnterior: 0,
        ultimoTurnoMesPrevio: 'L' as CodigoTurno,
      };
    } else {
      empBase =
        emps[0] || {
          id: '',
          documento: '',
          nombre: 'Cargando colaborador...',
          categoria: 'Personal Asistencial',
          servicioBaseId: '',
          horasContratoMes: 0,
          saldoBancoAnterior: 0,
          ultimoTurnoMesPrevio: 'L' as CodigoTurno,
        };
    }

    const nominal = calcularMetaNominalMesEmpleado(empBase, anio, mes, predFest);
    const emp: EmpleadoHospital = {
      ...empBase,
      horasSemanalesAplicadas: nominal.horasSemanalesAplicadas,
      horasContratoMes: nominal.horasContratadasNominales,
    };

    const dias = this.diasDelMesPortal();
    const celdasEmp = this.asignacionesMesPortal()[emp.id] || {};
    const keyPeriodo = `${emp.id}::${anio}-${mes}`;
    const saldoCalculado = this.cuadrante.mapaSaldosContinuos()[keyPeriodo]?.saldoInicial;

    const metricas = calcularMetricasMesColaborador(
      emp,
      celdasEmp,
      dias,
      this.catalogos.catalogoTurnosMap(),
      this.cuadrante.saldosConsolidadosMap(),
      anio,
      mes,
      saldoCalculado,
      undefined,
      predFest
    );
    const servicioBase = this.catalogos.servicios().find((s) => s.id === emp.servicioBaseId) || this.catalogos.servicioActual();
    const empConSaldo: EmpleadoHospital = {
      ...emp,
      horasContratoMes: metricas.horasContratadasNominales,
      horasSemanalesAplicadas: metricas.horasSemanalesAplicadas,
      saldoBancoAnterior: metricas.saldoAntReal,
    };

    return {
      empleado: empConSaldo,
      servicioBase,
      celdas: celdasEmp,
      ...metricas,
    };
  });

  readonly servicioDiaSeleccionadoPortal = computed<{ id: string; nombre: string; esRotacion: boolean }>(() => {
    const portal = this.datosEmpleadoPortal();
    const dia = this.diaPermutaSeleccionado();
    const celda = portal.celdas?.[dia];
    const srvBaseId = portal.empleado?.servicioBaseId || this.catalogos.servicioSeleccionadoId();
    const srvEjeId = celda?.servicioEjecutorId || srvBaseId;
    const srv = this.catalogos.servicios().find((s) => s.id === srvEjeId) || portal.servicioBase;
    const esRotacion = Boolean(
      celda?.esRotacion || (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srvBaseId)
    );
    return {
      id: srv?.id || srvBaseId,
      nombre: srv?.nombre || 'Servicio Hospitalario',
      esRotacion,
    };
  });

  readonly puedeIrAHoyPortal = computed<boolean>(() => {
    const empId = this.empleadoPortalId();
    const sesion = this.catalogos.sesionActual();
    const emp = this.catalogos.empleados().find((e) => e.id === empId);
    const srvId = emp?.servicioBaseId || sesion?.servicioBaseId || this.catalogos.servicioSeleccionadoId();
    const est = this.cuadrante.estadosPorCuadrante()[`${srvId}::${this.catalogos.anioActual}-${this.catalogos.mesActual}`];
    return est === 'PUBLICADO' || est === 'CERRADO_NOMINA';
  });

  readonly companerosParesPortal = computed<EmpleadoHospital[]>(() => {
    const empId = this.empleadoPortalId();
    const sesion = this.catalogos.sesionActual();
    const emps = this.catalogos.empleados();
    const actual =
      emps.find((e) => e.id === empId) ||
      (sesion && (sesion.empleadoId === empId || sesion.documento === empId)
        ? {
            id: sesion.empleadoId,
            servicioBaseId: sesion.servicioBaseId,
            categoria: sesion.categoria,
            categoriaId: undefined as string | undefined,
          }
        : null);
    if (!actual) return [];

    const srvDiaId = this.servicioDiaSeleccionadoPortal().id;
    const srvDiaObj = this.catalogos.servicios().find((s) => s.id === srvDiaId);
    const dia = this.diaPermutaSeleccionado();
    const matriz = this.asignacionesMesPortal();
    const catalogo = this.catalogos.catalogoTurnosMap();

    const cargoEnServicio = (emp: { categoriaId?: string; categoria: string }): boolean => {
      const ids =
        srvDiaObj?.cargosPermitidosIds && srvDiaObj.cargosPermitidosIds.length > 0
          ? srvDiaObj.cargosPermitidosIds
          : (srvDiaObj?.cargosPermitidos || []).map((c) => c.categoriaId).filter(Boolean);
      const nombres = (srvDiaObj?.cargosPermitidos || [])
        .map((c) => c.categoriaNombre?.trim().toLowerCase())
        .filter(Boolean);
      if (emp.categoriaId && ids.includes(emp.categoriaId)) return true;
      if (emp.categoria && nombres.includes(emp.categoria.trim().toLowerCase())) return true;
      return false;
    };

    const permiteMultiCargo = Boolean(srvDiaObj?.permitePermutaEntreCargos);

    return emps.filter((e) => {
      if (e.id === actual.id) return false;
      const mismoCargo =
        Boolean(e.categoriaId && actual.categoriaId && e.categoriaId === actual.categoriaId) ||
        e.categoria.trim().toLowerCase() === actual.categoria.trim().toLowerCase();
      if (!mismoCargo && !(permiteMultiCargo && cargoEnServicio(actual) && cargoEnServicio(e))) {
        return false;
      }

      const celdaPar = matriz[e.id]?.[dia];
      const codPar = (celdaPar?.codigo || '').trim().toUpperCase();
      const ejecutaEnSrvDia = celdaPar?.servicioEjecutorId === srvDiaId;
      const esDePlanta = e.servicioBaseId === srvDiaId;
      if (!esDePlanta && !ejecutaEnSrvDia) return false;

      const cfgPar = codPar ? catalogo[codPar] : undefined;
      const esAusPar = cfgPar ? Boolean(cfgPar.esAusencia) : esCodigoExoneracionContrato(codPar);

      if (
        celdaPar?.servicioEjecutorId &&
        celdaPar.servicioEjecutorId !== srvDiaId &&
        codPar !== '' &&
        codPar !== 'L' &&
        !esAusPar
      ) {
        return false;
      }

      if (esAusPar || cfgPar?.bloqueaPermutas) {
        return false;
      }

      return true;
    });
  });

  readonly equipoDeGuardiaDiaSeleccionado = computed(() => {
    const portal = this.datosEmpleadoPortal();
    const actual = portal.empleado;
    const dia = this.diaPermutaSeleccionado();
    const matriz = this.asignacionesMesPortal();
    const srvActualId = this.servicioDiaSeleccionadoPortal().id;
    const catalogo = this.catalogos.catalogoTurnosMap();

    return this.catalogos
      .empleados()
      .filter((e) => e.id !== actual.id)
      .map((e) => {
        const celda = matriz[e.id]?.[dia];
        const turno = (celda?.codigo || '') as CodigoTurno;
        const srvEjeId = celda?.servicioEjecutorId || e.servicioBaseId;
        return {
          empleado: e,
          turno,
          servicioEjecutorId: srvEjeId,
        };
      })
      .filter((x) => {
        const cfg = x.turno ? catalogo[x.turno] : undefined;
        return (
          x.servicioEjecutorId === srvActualId &&
          Boolean(cfg && !cfg.esAusencia && cfg.horasOrdinarias > 0)
        );
      });
  });

  readonly propuestasRecibidasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.permutasAuditoria.listaPermutas().filter((p) => p.receptorId === id && p.estado === 'PENDIENTE_PAR');
  });

  readonly misSolicitudesEnviadasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.permutasAuditoria.listaPermutas().filter((p) => p.solicitanteId === id);
  });

  // Filas consolidadas para Reportes (Multi-servicio / Multi-empresa o filtrado según alcance RBAC del rol)
  readonly datosReporteCalculados = computed(() => {
    const sesion = this.catalogos.sesionActual();
    if (this.catalogos.esColaborador()) {
      return [];
    }
    const srvFiltro = this.filtroReporteServicioId();
    const empFiltro = this.filtroReporteEmpresaId();
    const textoBusqueda = this.busquedaReporteTexto().trim().toLowerCase();
    const dias = this.cuadrante.diasDelMes();
    const matriz = this.cuadrante.asignaciones();
    const empresasMap = new Map(this.catalogos.empresas().map((e) => [e.id, e]));
    const todosEmps = this.catalogos.empleados().map((e) => {
      const ecId = e.empresaContratanteId || e.empresaContratante?.id;
      const empAct = ecId ? empresasMap.get(ecId) : undefined;
      return empAct
        ? {
            ...e,
            empresaContratanteId: empAct.id,
            empresaContratante: empAct,
            horasSemanalesAplicadas: e.horasSemanalesOverride ?? empAct.horasSemanalesContrato,
          }
        : e;
    });
    const catalogo = this.catalogos.catalogoTurnosMap();
    const mapaServicios = new Map(this.catalogos.servicios().map((s) => [s.id, s]));

    let filtrados = todosEmps;
    if (this.catalogos.esCoordinador() && sesion) {
      const permitidos = new Set(sesion.serviciosPermitidosIds || [sesion.servicioBaseId]);
      filtrados = filtrados.filter((e) => permitidos.has(e.servicioBaseId));
    }
    if (srvFiltro !== 'TODOS') {
      filtrados = filtrados.filter((e) => e.servicioBaseId === srvFiltro);
    }
    if (empFiltro !== 'TODOS') {
      filtrados = filtrados.filter(
        (e) => (e.empresaContratanteId || e.empresaContratante?.id) === empFiltro
      );
    }
    if (textoBusqueda) {
      filtrados = filtrados.filter(
        (e) =>
          e.nombre.toLowerCase().includes(textoBusqueda) ||
          e.documento.includes(textoBusqueda) ||
          e.categoria.toLowerCase().includes(textoBusqueda) ||
          (e.empresaContratante?.nombre || '').toLowerCase().includes(textoBusqueda) ||
          (e.empresaContratante?.codigo || '').toLowerCase().includes(textoBusqueda)
      );
    }

    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const saldos = this.cuadrante.saldosConsolidadosMap();
    const mapaContinuo = this.cuadrante.mapaSaldosContinuos();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));

    return filtrados.map((emp) => {
      const srvObj = mapaServicios.get(emp.servicioBaseId);
      const servicioNombre = srvObj ? srvObj.nombre : 'Servicio General';
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
        undefined,
        predFest
      );

      return {
        emp: {
          ...emp,
          horasContratoMes: metricas.horasContratadasNominales,
          horasSemanalesAplicadas: metricas.horasSemanalesAplicadas,
        },
        servicioNombre,
        horasContratoMes: metricas.horasContratadasNominales,
        saldoBancoAnterior: metricas.saldoAntReal,
        ...metricas,
      };
    });
  });

  readonly kpisReportes = computed(() => {
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
      totalAusentismoDias += f.diasVac + f.diasInc + f.diasLic + f.diasFam;
    }

    return {
      totalEmpleados: filas.length,
      totalHoras: r2(totalHoras),
      totalNoches,
      totalDomFest,
      totalCompensatorios,
      criticosBanco,
      totalAusentismoDias,
    };
  });

  aplicarContextoSesionSso(usuario: SesionUsuarioSso): void {
    this.empleadoPortalId.set(usuario.empleadoId);
    const emps = this.catalogos.empleados();
    const primerPar = emps.find(
      (e) =>
        e.id !== usuario.empleadoId &&
        e.servicioBaseId === usuario.servicioBaseId &&
        e.categoria === usuario.categoria
    );
    if (primerPar) {
      this.companeroPermutaId.set(primerPar.id);
    }

    if (usuario.rol === 'COORDINADOR') {
      this.filtroReporteServicioId.set(usuario.servicioBaseId);
    } else if (usuario.rol === 'ADMIN_TH') {
      this.filtroReporteServicioId.set('TODOS');
    }
  }

  sincronizarSeleccionTrasCargaEmpleados(emps: EmpleadoHospital[]): void {
    if (!Array.isArray(emps) || emps.length === 0) return;
    const sesion = this.catalogos.sesionActual();
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
      const srvRef = this.catalogos.servicioSeleccionadoId();
      const empInicial = (srvRef ? emps.find((e) => e.servicioBaseId === srvRef) : undefined) || emps[0];
      this.empleadoPortalId.set(empInicial.id);
      const primerPar = emps.find(
        (e) => e.id !== empInicial.id && e.servicioBaseId === empInicial.servicioBaseId && e.categoria === empInicial.categoria
      );
      this.companeroPermutaId.set(primerPar?.id || empInicial.id);
    }
  }

  sincronizarPortalAlCambiarServicio(nuevoSrvId: string): void {
    if (this.catalogos.esAdminTh() || this.catalogos.esCoordinador()) {
      const empsSrv = this.catalogos.empleados().filter((e) => e.servicioBaseId === nuevoSrvId);
      if (empsSrv.length > 0 && !empsSrv.some((e) => e.id === this.empleadoPortalId())) {
        this.empleadoPortalId.set(empsSrv[0].id);
        const pares = this.companerosParesPortal();
        this.companeroPermutaId.set(pares.length > 0 ? pares[0].id : '');
      }
    }
  }

  ajustarDiaLimitePeriodo(anio: number, mes: number): void {
    const maxDias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    if (this.diaPermutaSeleccionado() > maxDias) {
      this.diaPermutaSeleccionado.set(maxDias);
    }
  }

  seleccionarDiaEnPortal(dia: number): void {
    this.diaPermutaSeleccionado.set(dia);
    const pares = this.companerosParesPortal();
    if (pares.length > 0 && !pares.some((p) => p.id === this.companeroPermutaId())) {
      this.companeroPermutaId.set(pares[0].id);
    }
  }

  cambiarEmpleadoPortal(nuevoId: string): void {
    if (!this.catalogos.esAdminTh() && !this.catalogos.esCoordinador()) {
      return;
    }
    this.empleadoPortalId.set(nuevoId);
    const pares = this.companerosParesPortal();
    this.companeroPermutaId.set(pares.length > 0 ? pares[0].id : '');
  }

  enviarSolicitudPermutaDesdePortal(): void {
    const datosMios = this.datosEmpleadoPortal();
    const dia = this.diaPermutaSeleccionado();
    const celdaMia = datosMios.celdas?.[dia];
    const miTurno = celdaMia?.codigo || '';
    if (!miTurno) {
      this.notificacion.mostrar('⛔ No tienes un turno asignado en este día para proponer intercambio.');
      return;
    }

    const anioPortal = this.catalogos.anioSeleccionado();
    const mesPortal = this.mesSeleccionadoPortal();
    const matrizPortal = this.asignacionesMesPortal();
    const totalDiasPortal = this.diasDelMesPortal().length;
    const srvDiaId = this.servicioDiaSeleccionadoPortal().id;
    const comp = this.catalogos.empleados().find((e) => e.id === this.companeroPermutaId());

    if (!comp) {
      this.notificacion.mostrar('ℹ️ No hay compañeros con cargo compatible disponibles.');
      return;
    }

    const celdaComp = matrizPortal[comp.id]?.[dia];
    const turnoComp = celdaComp?.codigo || 'L';
    if (
      celdaComp?.servicioEjecutorId &&
      celdaComp.servicioEjecutorId !== srvDiaId &&
      turnoComp !== '' &&
      turnoComp !== 'L'
    ) {
      this.notificacion.mostrar('⛔ El compañero seleccionado ejecuta un turno en otro servicio ese día (Celda Espejo bloqueada).');
      return;
    }

    const check = this.permutasAuditoria.validarReglasPermuta(
      datosMios.empleado.id,
      comp.id,
      dia,
      miTurno,
      turnoComp,
      {
        anio: anioPortal,
        mes: mesPortal,
        matriz: matrizPortal,
        totalDias: totalDiasPortal,
        servicioId: srvDiaId,
      }
    );
    if (!check.valida) {
      this.notificacion.mostrar(`⛔ ${check.motivo}`);
      return;
    }

    this.permutasAuditoria.crearPermutaDesdePortal(
      {
        solicitanteId: datosMios.empleado.id,
        receptorId: comp.id,
        servicioId: srvDiaId,
        anio: anioPortal,
        mes: mesPortal,
        diaOrigen: dia,
        turnoOrigen: miTurno,
        diaDestino: dia,
        turnoDestino: turnoComp,
        validacionReglas: check.motivo,
      },
      comp.nombre
    );
  }

  abrirModalIcal(): void {
    const empId = this.empleadoPortalId() || this.catalogos.sesionActual()?.empleadoId || '';
    const empObj = this.catalogos.empleados().find((e) => e.id === empId);
    this.enlaceIcalEmpleadoNombre.set(empObj?.nombre || this.catalogos.sesionActual()?.nombre || 'Colaborador');
    this.enlaceIcalHttp.set('');
    this.enlaceIcalWebcal.set('');
    this.modalIcalAbierto.set(true);

    if (empId) {
      this.api.obtenerEnlaceCalendarioIcal(empId).subscribe({
        next: (res) => {
          this.enlaceIcalHttp.set(res.httpUrl);
          this.enlaceIcalWebcal.set(res.webcalUrl);
          this.enlaceIcalEmpleadoNombre.set(res.empleadoNombre);
        },
        error: (err) => {
          this.enlaceIcalHttp.set('');
          this.enlaceIcalWebcal.set('');
          const msg = err?.error?.message || 'No se pudo generar el enlace iCal desde el servidor.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
    }
  }

  copiarEnlaceIcal(): void {
    const url = this.enlaceIcalHttp() || this.enlaceIcalWebcal();
    if (!url) {
      this.notificacion.mostrar('ℹ️ Generando enlace de calendario, intenta nuevamente...');
      return;
    }

    const finalizarCopia = () => {
      this.modalIcalAbierto.set(false);
      this.notificacion.mostrar('📋 Enlace personal de calendario (.ics) copiado al portapapeles.');
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
    this.notificacion.mostrar('⬇️ Descargando archivo de calendario (.ics)...');
  }

  exportarExcelReportes(): void {
    const filas = this.datosReporteCalculados();
    const sub = this.subVistaReportes();
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();
    const periodoCsv = `${anio}-${String(mes).padStart(2, '0')}`;
    let header = '';
    let lineas: string[] = [];

    if (sub === 'PRE_NOMINA') {
      header = 'Periodo;Documento;Colaborador;Servicio;Cargo;Empresa;Regimen_Semanal_H;Dias_Habiles_Mes;Dias_Habiles_Prorrateados;Meta_Nominal_H;Prorrateo_H;Meta_Neta_H;HOD;HON;HDFD;HDFN;Total_Mes;Amortizadas_COMP_H;Recargo_Nocturno_Pct;Recargo_Dominical_Festivo_Pct;Recargo_Nocturno_Dominical_Festivo_Pct;Domingos_Laborados;Dom_Fest_Laborados;Compensatorio_CST;VAC_Dias;INC_Dias;LIC_Dias;FAM_Dias;Saldo_Banco_Ant;Mov_Mes;Nuevo_Saldo_Banco';
      lineas = filas.map((f) =>
        [
          periodoCsv,
          csvTexto(f.emp.documento),
          csvTexto(f.emp.nombre),
          csvTexto(f.servicioNombre),
          csvTexto(f.emp.categoria),
          csvTexto(f.empresaNombre),
          numeroCsv(f.horasSemanalesAplicadas),
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
          f.causaCompensatorioDominical ? 'SI' : 'NO',
          f.diasVac,
          f.diasInc,
          f.diasLic,
          f.diasFam,
          numeroCsv(f.saldoBancoAnterior),
          numeroCsv(f.diferenciaMes),
          numeroCsv(f.nuevoSaldoBanco),
        ].join(';')
      );
    } else if (sub === 'EQUIDAD') {
      header = 'Periodo;Documento;Colaborador;Servicio;Cargo;Empresa;Turnos_Noche;Domingos_Laborados;Dom_Fest_Laborados;Total_Horas_Nocturnas;Compensatorio_Legal;Nivel_Fatiga';
      lineas = filas.map((f) =>
        [
          periodoCsv,
          csvTexto(f.emp.documento),
          csvTexto(f.emp.nombre),
          csvTexto(f.servicioNombre),
          csvTexto(f.emp.categoria),
          csvTexto(f.empresaNombre),
          f.conteoNoches,
          f.conteoDomingos,
          f.conteoDomFest,
          numeroCsv(f.hon + f.hdfn),
          f.causaCompensatorioDominical ? 'SI' : 'NO',
          csvTexto(f.nivelFatiga),
        ].join(';')
      );
    } else if (sub === 'BANCO_HORAS') {
      header = 'Periodo;Documento;Colaborador;Servicio;Cargo;Empresa;Regimen_Semanal_H;Dias_Habiles_Mes;Meta_Nominal_H;Prorrateo_H;Meta_Neta_H;Saldo_Anterior;Horas_Trabajadas;Amortizadas_COMP;Mov_Mes;Nuevo_Saldo_Continuo;Estado_Riesgo';
      lineas = filas.map((f) =>
        [
          periodoCsv,
          csvTexto(f.emp.documento),
          csvTexto(f.emp.nombre),
          csvTexto(f.servicioNombre),
          csvTexto(f.emp.categoria),
          csvTexto(f.empresaNombre),
          numeroCsv(f.horasSemanalesAplicadas),
          f.diasHabilesMes,
          numeroCsv(f.horasContratadasNominales),
          numeroCsv(f.horasExoneradas),
          numeroCsv(f.horasContratadasEfectivas),
          numeroCsv(f.saldoBancoAnterior),
          numeroCsv(f.horasTrabajadas),
          numeroCsv(f.horasAmortizadasComp),
          numeroCsv(f.diferenciaMes),
          numeroCsv(f.nuevoSaldoBanco),
          csvTexto(f.estadoBanco),
        ].join(';')
      );
    } else {
      header = 'Periodo;Documento;Colaborador;Servicio;Cargo;Empresa;Dias_Vacaciones;Dias_Incapacidad;Dias_Licencia;Dias_Dia_Familia;Total_Ausencia_Dias';
      lineas = filas.map((f) =>
        [
          periodoCsv,
          csvTexto(f.emp.documento),
          csvTexto(f.emp.nombre),
          csvTexto(f.servicioNombre),
          csvTexto(f.emp.categoria),
          csvTexto(f.empresaNombre),
          f.diasVac,
          f.diasInc,
          f.diasLic,
          f.diasFam,
          f.diasVac + f.diasInc + f.diasLic + f.diasFam,
        ].join(';')
      );
    }

    descargarArchivoCsv(
      `Reporte_${sub}_${anio}_${mes}.csv`,
      '\uFEFF' + [header, ...lineas].join('\n')
    );

    this.notificacion.mostrar('✅ Reporte exportado exitosamente.');
  }
}
