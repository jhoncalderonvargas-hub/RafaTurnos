import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, Subject } from 'rxjs';
import {
  CATALOGO_TURNOS,
  CategoriaProfesionalItem,
  CodigoTurno,
  EmpleadoHospital,
  EmpresaContratante,
  FestivoEntry,
  MacroprocesoInfo,
  MetaTurnoServicio,
  ModalidadDiasServicio,
  NOMBRES_MESES,
  PlantillaEmpresaOption,
  ReglaCargoServicio,
  RolUsuarioSso,
  ServicioHospitalario,
  SesionUsuarioSso,
  TipoTurnoConfig,
} from '../models';
import { TurnosApiService } from '../turnos-api.service';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import { calcularMetaNominalMesEmpleado } from '../calculo-turnos.helper';
import {
  CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS,
  combinarReglasEmpresa,
  desglosarHorarioOrdinario,
  esCodigoExoneracionContrato,
  esFechaIsoValida,
  hoyColombiaIso,
  ModoAmortizacionBanco,
  obtenerHorasAmortizacionTurno,
  UMBRAL_HORAS_TURNO_NOCTURNO,
} from '../shared/liquidacion-horas';
import { clasificarFranjasTurno } from './autocompletado.service';
import { NotificacionStore } from './notificacion.store';

/** Número para CSV con separador ';' (configuración regional es-CO): coma decimal y máximo 2 decimales. */
export function numeroCsv(valor: number | undefined | null): string {
  const n = Math.round((Number(valor) || 0) * 100) / 100;
  return String(n).replace('.', ',');
}

/** Texto seguro para CSV con separador ';' (escapa comillas dobles). */
export function csvTexto(valor: string | undefined | null): string {
  const txt = valor === null || valor === undefined ? '' : String(valor);
  return `"${txt.replace(/"/g, '""')}"`;
}

export function descargarArchivoCsv(nombreArchivo: string, contenidoCsv: string): void {
  const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

@Injectable({ providedIn: 'root' })
export class CatalogosSsoStore {
  private readonly api = inject(TurnosApiService);
  private readonly notificacion = inject(NotificacionStore);

  // Periodo actual del calendario oficial de Colombia (America/Bogota) y Periodo Activo seleccionado
  readonly hoyIsoSistema = hoyColombiaIso();
  readonly anioActual = Number(this.hoyIsoSistema.substring(0, 4));
  readonly mesActual = Number(this.hoyIsoSistema.substring(5, 7));
  readonly diaActual = Number(this.hoyIsoSistema.substring(8, 10));

  readonly anioSeleccionado = signal<number>(this.anioActual);
  readonly mesSeleccionado = signal<number>(this.mesActual);
  readonly esPeriodoActual = computed<boolean>(
    () => this.anioSeleccionado() === this.anioActual && this.mesSeleccionado() === this.mesActual
  );
  readonly nombreMesSeleccionado = computed<string>(
    () => NOMBRES_MESES[this.mesSeleccionado()] || String(this.mesSeleccionado())
  );

  // Sesión SSO de Intranet
  readonly sesionActual = signal<SesionUsuarioSso | null>(null);
  readonly verificandoSesionSso = signal<boolean>(true);
  readonly intranetReturnUrl = signal<string>(this.leerUrlIntranetGuardada());

  readonly rolActual = computed<RolUsuarioSso>(() => this.sesionActual()?.rol || 'COLABORADOR');
  readonly esColaborador = computed<boolean>(() => this.rolActual() === 'COLABORADOR');
  readonly esCoordinador = computed<boolean>(() => this.rolActual() === 'COORDINADOR');
  readonly esAdminTh = computed<boolean>(() => this.rolActual() === 'ADMIN_TH');

  // Catálogos reactivos cargados desde Base de Datos y Mapa de Procesos Intranet
  readonly macroprocesos = signal<MacroprocesoInfo[]>([]);
  readonly categoriasProfesionales = signal<CategoriaProfesionalItem[]>([]);
  readonly empresas = signal<EmpresaContratante[]>([]);
  readonly plantillasEmpresa = signal<PlantillaEmpresaOption[]>([]);
  readonly servicios = signal<ServicioHospitalario[]>([]);
  readonly servicioSeleccionadoId = signal<string>('');
  readonly empleados = signal<EmpleadoHospital[]>([]);
  readonly catalogoTurnosMap = signal<Record<string, TipoTurnoConfig>>({ ...CATALOGO_TURNOS });

  readonly empleadosActualizados$ = new Subject<EmpleadoHospital[]>();
  readonly empresasActualizadas$ = new Subject<void>();

  readonly empresasPendientes = computed<EmpresaContratante[]>(() =>
    this.empresas().filter((e) => e.estadoConfiguracion === 'PENDIENTE_REGLAS')
  );

  // Lista maestra del catálogo (sin los alias duplicados M, T, N, G12 ni el marcador interno BLANCO)
  readonly listaTurnosCatalogo = computed<TipoTurnoConfig[]>(() => {
    const aliasOcultos = new Set(['M', 'T', 'N', 'G12', 'BLANCO']);
    return Object.values(this.catalogoTurnosMap()).filter((t) => !aliasOcultos.has(t.codigo));
  });

  // Turnos activos en el catálogo (excluye turnos archivados para nuevos servicios y paleta)
  readonly listaTurnosActivosCatalogo = computed<TipoTurnoConfig[]>(() =>
    this.listaTurnosCatalogo().filter((t) => t.activo !== false)
  );

  // Servicios autorizados según el rol de la sesión SSO activa
  readonly serviciosVisibles = computed<ServicioHospitalario[]>(() => {
    const todos = this.servicios();
    const sesion = this.sesionActual();
    if (!sesion || sesion.rol === 'ADMIN_TH') {
      return todos;
    }
    const permitidos = new Set(sesion.serviciosPermitidosIds || [sesion.servicioBaseId]);
    const filtrados = todos.filter((s) => permitidos.has(s.id));
    return filtrados.length > 0 ? filtrados : todos;
  });

  readonly servicioActual = computed<ServicioHospitalario>(() => {
    return (
      this.servicios().find((s) => s.id === this.servicioSeleccionadoId()) ||
      this.servicios()[0] || {
        id: '',
        codigo: '---',
        nombre: 'Cargando servicio...',
        tipoAsistencia: 'URGENCIAS',
        reqDia: 0,
        reqNoche: 0,
      }
    );
  });

  readonly totalCategoriasUnicas = computed<number>(
    () => new Set(this.empleados().map((e) => e.categoria)).size
  );

  readonly totalEnlacesApoyo = computed<number>(() => {
    const totalDirecciones = this.servicios().reduce(
      (acc, s) => acc + (s.hermanos ? s.hermanos.length : 0),
      0
    );
    return Math.ceil(totalDirecciones / 2);
  });

  // Formulario Nuevo Festivo / Día Cívico
  readonly nuevoFestivoFecha = signal<string>(this.hoyIsoSistema);
  readonly nuevoFestivoNombre = signal<string>('Día Cívico Aniversario Hospitalario');
  readonly versionCacheFestivos = signal<number>(1);

  readonly listaFestivosAnio = computed<FestivoEntry[]>(() => {
    this.versionCacheFestivos();
    const mapa = FestivosColombiaHelper.getFestivosAnio(this.anioSeleccionado());
    return Array.from(mapa.values());
  });

  // Formulario de Creación / Edición de Servicio Autónomo
  readonly servicioEditandoId = signal<string | null>(null);
  readonly nuevoServicioCodigo = signal<string>('');
  readonly nuevoServicioNombre = signal<string>('');
  readonly nuevoServicioTipoAsistencia = signal<string>('URGENCIAS');
  readonly nuevoServicioModalidadDias = signal<ModalidadDiasServicio>('TODOS_24_7');
  readonly nuevoServicioReqDia = signal<number>(4);
  readonly nuevoServicioReqNoche = signal<number>(2);
  readonly nuevoServicioReqDiaDomFest = signal<number>(2);
  readonly nuevoServicioReqNocheDomFest = signal<number>(1);
  readonly nuevoServicioTurnosHabilitados = signal<string[]>([
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
    'LIC',
    'FAM',
  ]);
  readonly nuevoServicioPermitePermutaEntreCargos = signal<boolean>(false);
  readonly nuevoServicioCargosPermitidosIds = signal<string[]>([]);
  readonly nuevoServicioMetasPorTurno = signal<MetaTurnoServicio[]>([]);
  readonly nuevoServicioReglasPorCargo = signal<ReglaCargoServicio[]>([]);
  readonly enlaceHermanoSrv1 = signal<string>('');
  readonly enlaceHermanoSrv2 = signal<string>('');

  readonly turnosOperativosHabilitadosEnForm = computed<TipoTurnoConfig[]>(() => {
    const hab = new Set(this.nuevoServicioTurnosHabilitados().map((c) => c.toUpperCase()));
    return this.listaTurnosActivosCatalogo().filter(
      (t) => t.horasOrdinarias > 0 && !t.esAusencia && hab.has(t.codigo.toUpperCase())
    );
  });

  // Formulario de Creación / Edición de Turnos en Catálogo de Turnos
  readonly turnoEditandoCodigo = signal<string | null>(null);
  readonly turnoFormCodigo = signal<string>('');
  readonly turnoFormNombre = signal<string>('');
  readonly turnoFormModoJornada = signal<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>('HORARIO');
  readonly turnoFormHoraInicio = signal<string>('07:00');
  readonly turnoFormHoraFin = signal<string>('15:00');
  readonly turnoFormMinutosAlmuerzo = signal<number>(0);
  readonly turnoFormColorKey = signal<string>('AZUL_CIELO');
  readonly turnoFormNocturnoPesado = signal<boolean>(false);
  readonly turnoFormProrrateaMeta = signal<boolean>(false);
  readonly turnoFormEsAusencia = signal<boolean>(false);
  readonly turnoFormBloqueaPermutas = signal<boolean>(false);
  readonly turnoFormDescuentaBanco = signal<boolean>(false);
  readonly turnoFormModoAmortizacion = signal<ModoAmortizacionBanco>('HORAS_FIJAS');
  readonly turnoFormHorasAmortizacion = signal<number>(8);

  readonly temasColorTurno = [
    { key: 'AZUL_CIELO', nombre: 'Azul Mañana', bgHex: '#E0F2FE', textHex: '#0369A1', borderHex: '#7DD3FC' },
    { key: 'CELESTE', nombre: 'Celeste Claro', bgHex: '#BAE6FD', textHex: '#0284C7', borderHex: '#38BDF8' },
    { key: 'AMBAR_TARDE', nombre: 'Ámbar Tarde', bgHex: '#FEF08A', textHex: '#854D0E', borderHex: '#FACC15' },
    { key: 'NARANJA_GUARDIA', nombre: 'Naranja Guardia', bgHex: '#FED7AA', textHex: '#9A3412', borderHex: '#FB923C' },
    { key: 'VIOLETA_NOCHE', nombre: 'Violeta Noche', bgHex: '#EDE9FE', textHex: '#5B21B6', borderHex: '#C4B5FD' },
    { key: 'PURPURA_NOCHE', nombre: 'Púrpura Intenso', bgHex: '#DDD6FE', textHex: '#4C1D95', borderHex: '#A78BFA' },
    { key: 'ROJO_CORAL', nombre: 'Rojo Guardia 24h', bgHex: '#FEE2E2', textHex: '#991B1B', borderHex: '#FCA5A5' },
    { key: 'TURQUESA_COMP', nombre: 'Turquesa Compensatorio', bgHex: '#CCFBF1', textHex: '#0F766E', borderHex: '#5EEAD4' },
    { key: 'ESMERALDA_VAC', nombre: 'Verde Esmeralda', bgHex: '#D1FAE5', textHex: '#047857', borderHex: '#6EE7B7' },
    { key: 'ROSA_INC', nombre: 'Rosa Novedad', bgHex: '#FCE7F3', textHex: '#BE185D', borderHex: '#F9A8D4' },
    { key: 'LAVANDA_LIC', nombre: 'Lavanda Licencia', bgHex: '#E0E7FF', textHex: '#3730A3', borderHex: '#C7D2FE' },
    { key: 'GRIS_ADMIN', nombre: 'Gris Neutro', bgHex: '#F3F4F6', textHex: '#374151', borderHex: '#D1D5DB' },
    { key: 'BLANCO_LIBRE', nombre: 'Blanco Libre', bgHex: '#FFFFFF', textHex: '#64748B', borderHex: '#E2E8F0' },
  ];

  // Cálculo automático de horas Ordinarias, Diurnas (06:00-19:00) y Nocturnas (19:00-06:00) - Ley 2466 / CST Art. 160 y Art. 167 (Almuerzo)
  readonly calculoAutomaticoHorasTurno = computed<{
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
      const g24 = desglosarHorarioOrdinario(ini, ini, 0, hoyColombiaIso());
      return {
        ordinarias: g24?.ordinarias ?? 24,
        diurnas: g24?.diurnas ?? 13,
        nocturnas: g24?.nocturnas ?? 11,
        minutosAlmuerzo: 0,
        horarioTexto: `${ini} - ${ini} (+1)`,
      };
    }

    const iniStr = this.turnoFormHoraInicio() || '07:00';
    const finStr = this.turnoFormHoraFin() || '15:00';
    const minAlmuerzo = Math.max(0, Number(this.turnoFormMinutosAlmuerzo()) || 0);
    const desglose = desglosarHorarioOrdinario(iniStr, finStr, minAlmuerzo, hoyColombiaIso(), false);

    return {
      ordinarias: desglose?.ordinarias ?? 0,
      diurnas: desglose?.diurnas ?? 0,
      nocturnas: desglose?.nocturnas ?? 0,
      minutosAlmuerzo: minAlmuerzo,
      horarioTexto: `${iniStr} - ${finStr}`,
    };
  });

  private leerUrlIntranetGuardada(): string {
    try {
      return sessionStorage.getItem('rafa_turnos_intranet_url') || '';
    } catch {
      return '';
    }
  }

  etiquetaRol(rol: RolUsuarioSso): string {
    if (rol === 'ADMIN_TH') return 'Talento Humano / Admin';
    if (rol === 'COORDINADOR') return 'Coordinador de Servicio';
    return 'Colaborador Asistencial';
  }

  establecerSesionBasicaSso(usuario: SesionUsuarioSso): void {
    this.sesionActual.set(usuario);
    this.servicioSeleccionadoId.set(usuario.servicioBaseId);
  }

  notificarIntranet(): void {
    const destino = this.sesionActual()?.intranetReturnUrl || this.intranetReturnUrl();
    try {
      sessionStorage.removeItem('rafa_turnos_sso_jwt');
    } catch {}
    this.sesionActual.set(null);
    this.notificacion.mostrar('ℹ️ Cerrando sesión y regresando a la Intranet Hospitalaria...');
    if (destino && destino !== window.location.href) {
      window.location.href = destino;
    }
  }

  mapearEmpleadosDesdeBackend(rawEmps: any[]): EmpleadoHospital[] {
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const predFest = (iso: string) => Boolean(FestivosColombiaHelper.esFestivo(iso));

    return rawEmps.map((e) => {
      const saldoObj = e.saldosBancoHoras && e.saldosBancoHoras[0];
      const saldoAnt = saldoObj ? Number(saldoObj.saldoFinalAcumulado || 0) : 0;
      const empresaContratante: Partial<EmpresaContratante> | null = e.empresaContratante
        ? {
            ...e.empresaContratante,
            horasSemanalesContrato: Number(e.empresaContratante.horasSemanalesContrato) || 42,
            diasBaseSemana: Number(e.empresaContratante.diasBaseSemana) || 6,
          }
        : null;
      const horasSemanalesOverride =
        e.horasSemanalesOverride !== undefined && e.horasSemanalesOverride !== null
          ? Number(e.horasSemanalesOverride)
          : null;
      const reglas = combinarReglasEmpresa(
        empresaContratante || undefined,
        horasSemanalesOverride ?? (!empresaContratante && e.horasSemanalesLey ? Number(e.horasSemanalesLey) : undefined)
      );

      const mappedBase: EmpleadoHospital = {
        id: e.id,
        documento: e.documento,
        nombre: e.nombre,
        categoria: e.categoria ? e.categoria.nombre || e.categoria : 'Personal Asistencial',
        categoriaId: e.categoriaId || e.categoria?.id,
        servicioBaseId: e.servicioBaseId,
        empresaContratanteId: e.empresaContratanteId || empresaContratante?.id,
        empresaContratante,
        horasSemanalesOverride,
        horasSemanalesLey: e.horasSemanalesLey !== undefined ? Number(e.horasSemanalesLey) : reglas.horasSemanalesContrato,
        horasSemanalesAplicadas: reglas.horasSemanalesContrato,
        horasContratoMes: 0,
        saldoBancoAnterior: saldoAnt,
        saldoBancoOrigen: saldoObj
          ? {
              anio: Number(saldoObj.anio),
              mes: Number(saldoObj.mes),
              saldo: saldoAnt,
            }
          : undefined,
        ultimoTurnoMesPrevio: 'L' as CodigoTurno,
      };

      const nominalMes = calcularMetaNominalMesEmpleado(mappedBase, anio, mes, predFest);
      return {
        ...mappedBase,
        horasContratoMes: nominalMes.horasContratadasNominales,
      };
    });
  }

  aplicarEmpresasDesdeDb(emps: EmpresaContratante[]): void {
    if (Array.isArray(emps)) {
      this.empresas.set(emps);
    }
  }

  aplicarPlantillasDesdeDb(plantillas: PlantillaEmpresaOption[]): void {
    if (Array.isArray(plantillas)) {
      this.plantillasEmpresa.set(plantillas);
    }
  }

  aplicarCategoriasDesdeDb(cats: CategoriaProfesionalItem[]): void {
    if (Array.isArray(cats)) {
      this.categoriasProfesionales.set(cats);
    }
  }

  recargarEmpresas(): void {
    this.api.getEmpresas().subscribe({
      next: (lista) => this.aplicarEmpresasDesdeDb(lista),
      error: () => {},
    });
  }

  recargarCategorias(): void {
    this.api.getCategorias().subscribe({
      next: (lista) => this.aplicarCategoriasDesdeDb(lista),
      error: () => {},
    });
  }

  recargarEmpleados(): void {
    this.api.getEmpleados().subscribe({
      next: (empsDb) => this.aplicarEmpleadosDesdeDb(empsDb),
      error: () => {},
    });
  }

  crearEmpresa(dto: Partial<EmpresaContratante> & { confirmar?: boolean }): void {
    this.api.crearEmpresa(dto).subscribe({
      next: (creada) => {
        this.notificacion.mostrar(`✅ Empresa "${creada.nombre}" (${creada.codigo}) creada.`);
        this.recargarEmpresas();
        this.empresasActualizadas$.next();
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al crear la empresa contratante.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  actualizarEmpresa(id: string, dto: Partial<EmpresaContratante> & { confirmar?: boolean }): void {
    this.api.actualizarEmpresa(id, dto).subscribe({
      next: (act) => {
        this.notificacion.mostrar(`✅ Reglas de "${act.nombre}" actualizadas y periodos abiertos recalculados.`);
        this.recargarEmpresas();
        this.recargarEmpleados();
        this.empresasActualizadas$.next();
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al actualizar la empresa contratante.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  confirmarReglasEmpresa(id: string, dto?: Partial<EmpresaContratante>): void {
    this.api.confirmarReglasEmpresa(id, dto).subscribe({
      next: (act) => {
        this.notificacion.mostrar(`✅ Reglas normativas de "${act.nombre}" confirmadas.`);
        this.recargarEmpresas();
        this.recargarEmpleados();
        this.empresasActualizadas$.next();
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al confirmar reglas de la empresa.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  eliminarEmpresa(emp: EmpresaContratante): void {
    this.notificacion.abrirConfirmacion({
      titulo: '🗑️ Eliminar Empresa Contratante',
      mensaje: `¿Seguro que deseas eliminar la empresa "${emp.nombre}" (${emp.codigo})?`,
      textoBotonConfirmar: 'Sí, Eliminar',
      esPeligroso: true,
      onConfirmar: () => {
        this.api.eliminarEmpresa(emp.id).subscribe({
          next: (res) => {
            this.notificacion.mostrar(`✅ ${res?.mensaje || 'Empresa eliminada.'}`);
            this.recargarEmpresas();
            this.empresasActualizadas$.next();
          },
          error: (err) => {
            const msg = err?.error?.message || 'Error al eliminar la empresa.';
            this.notificacion.mostrar(`⛔ ${msg}`);
          },
        });
      },
    });
  }

  aplicarServiciosDesdeDb(srvs: ServicioHospitalario[]): void {
    if (srvs && srvs.length > 0) {
      this.servicios.set(srvs);
      const actualSrvId = this.servicioSeleccionadoId();
      const sesionSrvId = this.sesionActual()?.servicioBaseId;
      if (!actualSrvId || !srvs.some((s) => s.id === actualSrvId)) {
        const preferido = (sesionSrvId && srvs.find((s) => s.id === sesionSrvId)) || srvs[0];
        this.servicioSeleccionadoId.set(preferido.id);
      }
      if (!this.enlaceHermanoSrv1() || !srvs.some((s) => s.id === this.enlaceHermanoSrv1())) {
        this.enlaceHermanoSrv1.set(srvs[0].id);
      }
    }
  }

  aplicarEmpleadosDesdeDb(empsDb: any[]): void {
    if (!Array.isArray(empsDb) || empsDb.length === 0) return;
    const emps = this.mapearEmpleadosDesdeBackend(empsDb);
    this.empleados.set(emps);
    this.empleadosActualizados$.next(emps);
  }

  aplicarCatalogoTurnosDesdeDb(turnosDb: any[]): void {
    if (!Array.isArray(turnosDb) || turnosDb.length === 0) return;
    this.catalogoTurnosMap.update((actual) => {
      const copia = { ...actual };
      for (const t of turnosDb) {
        const cod = (t.codigo || '').toUpperCase();
        if (!cod || cod === 'BLANCO') continue;
        const existente = copia[cod];
        const temaEncontrado = this.temasColorTurno.find(
          (tm) => tm.bgHex.toLowerCase() === (t.colorHex || '').toLowerCase()
        );

        const horasOrd = Number(t.horasOrdinarias ?? existente?.horasOrdinarias ?? 0);
        const horaIni = t.horaInicio || existente?.horaInicio || '07:00';
        const horaFin = t.horaFin || existente?.horaFin || '15:00';
        const horario =
          t.horaInicio && t.horaFin
            ? horasOrd === 24
              ? `${horaIni} - ${horaFin} (+1)`
              : horasOrd > 0
                ? `${horaIni} - ${horaFin}`
                : 'Descanso / Novedad'
            : existente?.horario || (horasOrd > 0 ? `${horaIni} - ${horaFin}` : 'Descanso / Novedad');

        const tema = temaEncontrado || this.temasColorTurno[0];
        const activo = t.activo !== undefined ? Boolean(t.activo) : existente?.activo ?? true;
        const esAusencia =
          t.esAusencia !== undefined
            ? Boolean(t.esAusencia)
            : existente?.esAusencia ?? esCodigoExoneracionContrato(cod);
        const prorrateaMetaContrato =
          t.prorrateaMetaContrato !== undefined
            ? Boolean(t.prorrateaMetaContrato)
            : existente?.prorrateaMetaContrato ?? esCodigoExoneracionContrato(cod);
        const bloqueaPermutas =
          t.bloqueaPermutas !== undefined
            ? Boolean(t.bloqueaPermutas)
            : existente?.bloqueaPermutas ?? (esAusencia || cod === 'DISP' || cod === 'BLANCO');
        const descuentaBancoHoras = !!(t.descuentaBancoHoras ?? existente?.descuentaBancoHoras);
        const modoAmortizacionBanco =
          t.modoAmortizacionBanco ||
          existente?.modoAmortizacionBanco ||
          (cod === 'COMP' && descuentaBancoHoras ? 'DIA_HABIL_EMPRESA' : 'HORAS_FIJAS');
        const esSistemaObligatorio =
          t.esSistemaObligatorio !== undefined
            ? Boolean(t.esSistemaObligatorio)
            : existente?.esSistemaObligatorio ?? CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod);

        copia[cod] = {
          codigo: cod,
          nombre: t.nombre || existente?.nombre || cod,
          horario,
          horaInicio: horaIni,
          horaFin: horaFin,
          horasOrdinarias: horasOrd,
          horasDiurnas: Number(t.horasDiurnas ?? existente?.horasDiurnas ?? 0),
          horasNocturnas: Number(t.horasNocturnas ?? existente?.horasNocturnas ?? 0),
          minutosAlmuerzo: Number(t.minutosAlmuerzo ?? existente?.minutosAlmuerzo ?? 0),
          bgHex: t.colorHex || existente?.bgHex || tema.bgHex,
          textHex: temaEncontrado ? temaEncontrado.textHex : existente?.textHex || tema.textHex,
          borderHex: temaEncontrado ? temaEncontrado.borderHex : existente?.borderHex || tema.borderHex,
          esAusencia,
          prorrateaMetaContrato,
          bloqueaPermutas,
          esNocturnoPesado: Boolean(
            t.esNocturnoPesado ?? existente?.esNocturnoPesado ?? cod === 'G24'
          ),
          descuentaBancoHoras,
          modoAmortizacionBanco,
          horasAmortizacionBanco:
            t.horasAmortizacionBanco !== undefined
              ? t.horasAmortizacionBanco === null
                ? null
                : Number(t.horasAmortizacionBanco)
              : existente?.horasAmortizacionBanco,
          esSistemaObligatorio,
          activo,
          visibleEnPaleta: ['M', 'T', 'N', 'G12'].includes(cod) || !activo
            ? false
            : t.visibleEnPaleta !== undefined
              ? Boolean(t.visibleEnPaleta)
              : existente?.visibleEnPaleta ?? true,
        };
      }
      return copia;
    });
  }

  crearObsFestivosAnio(anio: number): Observable<unknown> {
    return forkJoin([
      this.api.getFestivos(anio - 1),
      this.api.getFestivos(anio),
      this.api.getFestivos(anio + 1),
    ]).pipe(
      map((respuestas) => {
        if (anio !== this.anioSeleccionado()) return;
        [anio - 1, anio, anio + 1].forEach((a, idx) => {
          FestivosColombiaHelper.limpiarFestivosManualesAnio(a);
          const res = respuestas[idx];
          if (res && Array.isArray(res.festivos)) {
            for (const f of res.festivos) {
              if (!f.esOficialLey) {
                FestivosColombiaHelper.agregarFestivoManual(f.fecha, f.nombre);
              }
            }
          }
        });
        this.versionCacheFestivos.update((v) => v + 1);
      }),
      catchError(() => of(null))
    );
  }

  // Gestión de Días Cívicos
  agregarDiaCivico(): void {
    const fecha = this.nuevoFestivoFecha();
    const nombre = this.nuevoFestivoNombre().trim();
    if (!fecha || !nombre || !esFechaIsoValida(fecha)) {
      this.notificacion.mostrar('⛔ Ingresa una fecha ISO válida (YYYY-MM-DD) y un nombre para el día cívico.');
      return;
    }
    const existente = FestivosColombiaHelper.esFestivo(fecha);
    if (existente?.esOficialLey) {
      this.notificacion.mostrar(`⛔ ${fecha} corresponde a festivo oficial de ley (${existente.nombre}) y no puede sobrescribirse.`);
      return;
    }

    const ok = FestivosColombiaHelper.agregarFestivoManual(fecha, nombre);
    if (!ok) {
      this.notificacion.mostrar('⛔ No fue posible registrar el día cívico localmente.');
      return;
    }
    this.versionCacheFestivos.update((v) => v + 1);
    this.api.agregarDiaCivico(fecha, nombre).subscribe({
      next: () => {
        this.notificacion.mostrar(`✅ Día cívico "${nombre}" guardado en el calendario.`);
      },
      error: (err) => {
        FestivosColombiaHelper.eliminarFestivoManual(fecha);
        if (existente && !existente.esOficialLey) {
          FestivosColombiaHelper.agregarFestivoManual(fecha, existente.nombre);
        }
        this.versionCacheFestivos.update((v) => v + 1);
        const msg = err?.error?.message || 'Error al guardar el día cívico en el servidor.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  eliminarDiaCivico(fecha: string): void {
    const actual = FestivosColombiaHelper.esFestivo(fecha);
    if (!actual || actual.esOficialLey) {
      this.notificacion.mostrar('⛔ Los festivos oficiales de ley no pueden eliminarse.');
      return;
    }

    FestivosColombiaHelper.eliminarFestivoManual(fecha);
    this.versionCacheFestivos.update((v) => v + 1);
    this.api.eliminarDiaCivico(fecha).subscribe({
      next: () => {
        this.notificacion.mostrar(`✅ Día cívico ${fecha} eliminado.`);
      },
      error: (err) => {
        FestivosColombiaHelper.agregarFestivoManual(fecha, actual.nombre);
        this.versionCacheFestivos.update((v) => v + 1);
        const msg = err?.error?.message || 'Error al eliminar el día cívico en el servidor.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  // Administración de Servicios, Cargos Permitidos, Metas por Turno y Adscripción
  private construirMetasDesdeTurnosSeleccionados(
    turnosCodigos: string[],
    metasActuales: MetaTurnoServicio[],
    modalidad?: ModalidadDiasServicio
  ): MetaTurnoServicio[] {
    const catalogo = this.catalogoTurnosMap();
    const mapaExistentes = new Map(
      metasActuales.map((m) => [m.codigoTurno.trim().toUpperCase(), m])
    );
    const cierraDomFest =
      modalidad === 'LUN_SAB_SIN_FESTIVOS' || modalidad === 'LUN_VIE_HABILES';

    const metas: MetaTurnoServicio[] = [];
    for (const rawCod of turnosCodigos) {
      const cod = rawCod.trim().toUpperCase();
      const cfg = catalogo[cod];
      if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia || cfg.activo === false) continue;

      const prev = mapaExistentes.get(cod);
      const minimoBase = prev ? Math.max(0, Number(prev.minimoBase) || 0) : 1;
      const esperadoBase = prev ? Math.max(minimoBase, Number(prev.esperadoBase) || minimoBase) : Math.max(1, minimoBase);
      const minimoDomFest = cierraDomFest
        ? 0
        : prev
          ? Math.max(0, Number(prev.minimoDomFest) || 0)
          : minimoBase;
      const esperadoDomFest = cierraDomFest
        ? 0
        : prev
          ? Math.max(minimoDomFest, Number(prev.esperadoDomFest) || minimoDomFest)
          : esperadoBase;

      metas.push({
        id: prev?.id,
        tipoTurnoId: prev?.tipoTurnoId,
        codigoTurno: cod,
        nombreTurno: cfg.nombre,
        colorHex: cfg.bgHex,
        horaInicio: cfg.horaInicio,
        horaFin: cfg.horaFin,
        horasOrdinarias: cfg.horasOrdinarias,
        horasNocturnas: cfg.horasNocturnas,
        esNocturnoPesado: cfg.esNocturnoPesado,
        habilitado: true,
        minimoBase,
        esperadoBase,
        minimoDomFest,
        esperadoDomFest,
      });
    }
    return metas;
  }

  private actualizarTotalesDerivadosDesdeMetas(metas: MetaTurnoServicio[]): void {
    const catalogo = this.catalogoTurnosMap();
    let reqD = 0;
    let reqN = 0;
    let reqDDom = 0;
    let reqNDom = 0;

    for (const m of metas) {
      if (m.habilitado === false) continue;
      const cfg = catalogo[m.codigoTurno.toUpperCase()];
      const hOrd = Number(cfg?.horasOrdinarias ?? m.horasOrdinarias ?? 0);
      if (hOrd <= 0) continue;

      const hNoc = Number(cfg?.horasNocturnas ?? m.horasNocturnas ?? 0);
      const pesado = Boolean(cfg?.esNocturnoPesado ?? m.esNocturnoPesado);
      const es24h = hOrd >= 24;
      const esNoche = pesado || hNoc >= UMBRAL_HORAS_TURNO_NOCTURNO;

      if (es24h) {
        reqD += m.esperadoBase;
        reqN += m.esperadoBase;
        reqDDom += m.esperadoDomFest;
        reqNDom += m.esperadoDomFest;
      } else if (esNoche) {
        reqN += m.esperadoBase;
        reqNDom += m.esperadoDomFest;
      } else {
        reqD += m.esperadoBase;
        reqDDom += m.esperadoDomFest;
      }
    }

    this.nuevoServicioReqDia.set(reqD);
    this.nuevoServicioReqNoche.set(reqN);
    this.nuevoServicioReqDiaDomFest.set(reqDDom);
    this.nuevoServicioReqNocheDomFest.set(reqNDom);
  }

  alternarCargoPermitidoEnServicioForm(categoriaId: string): void {
    const id = String(categoriaId || '').trim();
    if (!id) return;
    this.nuevoServicioCargosPermitidosIds.update((lista) =>
      lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]
    );
  }

  actualizarMetaTurnoEnServicioForm(
    codigoTurno: string,
    campo: 'minimoBase' | 'esperadoBase' | 'minimoDomFest' | 'esperadoDomFest',
    valor: number
  ): void {
    const cod = codigoTurno.trim().toUpperCase();
    const num = Math.max(0, Math.round(Number(valor) || 0));

    const actualizadas = this.nuevoServicioMetasPorTurno().map((m) => {
      if (m.codigoTurno.toUpperCase() !== cod) return m;
      const next = { ...m, [campo]: num };
      if (campo === 'minimoBase' && next.esperadoBase < next.minimoBase) {
        next.esperadoBase = next.minimoBase;
      }
      if (campo === 'esperadoBase' && next.esperadoBase < next.minimoBase) {
        next.minimoBase = next.esperadoBase;
      }
      if (campo === 'minimoDomFest' && next.esperadoDomFest < next.minimoDomFest) {
        next.esperadoDomFest = next.minimoDomFest;
      }
      if (campo === 'esperadoDomFest' && next.esperadoDomFest < next.minimoDomFest) {
        next.minimoDomFest = next.esperadoDomFest;
      }
      return next;
    });

    this.nuevoServicioMetasPorTurno.set(actualizadas);
    this.actualizarTotalesDerivadosDesdeMetas(actualizadas);
  }

  sincronizarModalidadEnMetasForm(modalidad: ModalidadDiasServicio): void {
    this.nuevoServicioModalidadDias.set(modalidad);
    const cierra = modalidad === 'LUN_SAB_SIN_FESTIVOS' || modalidad === 'LUN_VIE_HABILES';
    const actualizadas = this.nuevoServicioMetasPorTurno().map((m) =>
      cierra
        ? { ...m, minimoDomFest: 0, esperadoDomFest: 0 }
        : modalidad === 'TODOS_24_7'
          ? { ...m, minimoDomFest: m.minimoBase, esperadoDomFest: m.esperadoBase }
          : m
    );
    if (actualizadas.length > 0) {
      this.nuevoServicioMetasPorTurno.set(actualizadas);
      this.actualizarTotalesDerivadosDesdeMetas(actualizadas);
    }
  }

  adscribirEmpleadoAServicio(empleadoId: string, servicioBaseId: string): void {
    this.api.adscribirEmpleado(empleadoId, servicioBaseId).subscribe({
      next: (res) => {
        const msgBase = '✅ Colaborador adscrito correctamente al servicio.';
        this.notificacion.mostrar(
          res.advertenciaCargoCompatible ? `${msgBase} (${res.advertenciaCargoCompatible})` : msgBase
        );
        this.recargarEmpleados();
        this.recargarServicios();
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al adscribir colaborador.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  adscribirLoteAServicio(empleadoIds: string[], servicioBaseId: string): void {
    if (!empleadoIds || empleadoIds.length === 0) {
      this.notificacion.mostrar('ℹ️ Selecciona al menos un colaborador para adscribir o trasladar.');
      return;
    }
    this.api.adscribirLote(empleadoIds, servicioBaseId).subscribe({
      next: (res) => {
        const adv =
          res.advertenciasCargo && res.advertenciasCargo.length > 0
            ? ` ⚠️ ${res.advertenciasCargo.length} cargo(s) aún no están habilitados en destino.`
            : '';
        this.notificacion.mostrar(
          `✅ ${res.trasladados} colaborador(es) trasladado(s) a ${res.servicioNombre}.${adv}`
        );
        this.recargarEmpleados();
        this.recargarServicios();
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al trasladar lote de colaboradores.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  alternarTurnoEnServicioForm(codigo: string): void {
    const cod = codigo.toUpperCase();
    const actuales = this.nuevoServicioTurnosHabilitados();
    const catalogo = this.catalogoTurnosMap();

    if (actuales.includes(cod)) {
      if (actuales.length <= 1) {
        this.notificacion.mostrar('ℹ️ El servicio debe tener al menos un turno habilitado.');
        return;
      }
      const nuevos = actuales.filter((c) => c !== cod);
      this.nuevoServicioTurnosHabilitados.set(nuevos);
      const metas = this.construirMetasDesdeTurnosSeleccionados(
        nuevos,
        this.nuevoServicioMetasPorTurno(),
        this.nuevoServicioModalidadDias()
      );
      this.nuevoServicioMetasPorTurno.set(metas);
      if (metas.length > 0) {
        this.actualizarTotalesDerivadosDesdeMetas(metas);
      }

      const srvTieneDia = nuevos.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).dia);
      const srvTieneNoche = nuevos.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).noche);
      if (!srvTieneDia) {
        this.nuevoServicioReqDia.set(0);
        this.nuevoServicioReqDiaDomFest.set(0);
      }
      if (!srvTieneNoche) {
        this.nuevoServicioReqNoche.set(0);
        this.nuevoServicioReqNocheDomFest.set(0);
      }

      this.nuevoServicioReglasPorCargo.update((reglas) =>
        reglas.map((r) => {
          const tCat = (r.turnosHabilitados || []).filter((t) => t.toUpperCase() !== cod);
          const rTieneDia = tCat.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).dia);
          const rTieneNoche = tCat.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).noche);
          return {
            ...r,
            turnosHabilitados: tCat,
            reqDia: rTieneDia ? r.reqDia : 0,
            reqDiaDomFest: rTieneDia ? r.reqDiaDomFest : 0,
            reqNoche: rTieneNoche ? r.reqNoche : 0,
            reqNocheDomFest: rTieneNoche ? r.reqNocheDomFest : 0,
          };
        })
      );
    } else {
      const nuevos = [...actuales, cod];
      this.nuevoServicioTurnosHabilitados.set(nuevos);
      const metas = this.construirMetasDesdeTurnosSeleccionados(
        nuevos,
        this.nuevoServicioMetasPorTurno(),
        this.nuevoServicioModalidadDias()
      );
      this.nuevoServicioMetasPorTurno.set(metas);
      if (metas.length > 0) {
        this.actualizarTotalesDerivadosDesdeMetas(metas);
      }
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
    const baseDescansos = ['S', 'L', 'COMP', 'VAC', 'INC', 'LIC', 'FAM'];
    let nuevos: string[];
    if (plantilla === 'ROTATIVO_8H') {
      nuevos = ['M8', 'T8', 'N8', ...baseDescansos];
    } else if (plantilla === 'GUARDIAS_12_24') {
      nuevos = ['D12', 'N12', 'G24', ...baseDescansos];
    } else if (plantilla === 'ADMINISTRATIVO') {
      nuevos = ['ADM', 'M6', 'T6', ...baseDescansos];
    } else {
      nuevos = this.listaTurnosActivosCatalogo().map((t) => t.codigo);
    }

    const catalogo = this.catalogoTurnosMap();
    const srvTieneDia = nuevos.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).dia);
    const srvTieneNoche = nuevos.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).noche);

    this.nuevoServicioTurnosHabilitados.set(nuevos);
    const metas = this.construirMetasDesdeTurnosSeleccionados(
      nuevos,
      this.nuevoServicioMetasPorTurno(),
      this.nuevoServicioModalidadDias()
    );
    this.nuevoServicioMetasPorTurno.set(metas);
    if (metas.length > 0) {
      this.actualizarTotalesDerivadosDesdeMetas(metas);
    } else {
      if (!srvTieneDia) {
        this.nuevoServicioReqDia.set(0);
        this.nuevoServicioReqDiaDomFest.set(0);
      }
      if (!srvTieneNoche) {
        this.nuevoServicioReqNoche.set(0);
        this.nuevoServicioReqNocheDomFest.set(0);
      }
    }

    this.nuevoServicioReglasPorCargo.update((reglas) =>
      reglas.map((r) => ({
        ...r,
        turnosHabilitados: [...nuevos],
        reqDia: srvTieneDia ? r.reqDia : 0,
        reqDiaDomFest: srvTieneDia ? r.reqDiaDomFest : 0,
        reqNoche: srvTieneNoche ? r.reqNoche : 0,
        reqNocheDomFest: srvTieneNoche ? r.reqNocheDomFest : 0,
      }))
    );
  }

  alternarTurnoEnCargoForm(categoriaNombre: string, codigoTurno: string): void {
    const cod = codigoTurno.toUpperCase();
    const catalogo = this.catalogoTurnosMap();

    this.nuevoServicioReglasPorCargo.update((reglas) => {
      const actualizadas = reglas.map((r) => {
        if (r.categoriaNombre !== categoriaNombre) return r;
        const actuales = (r.turnosHabilitados || []).map((c) => c.toUpperCase());
        const operativosActuales = actuales.filter((c) => {
          const cfg = catalogo[c];
          return cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia;
        });
        if (actuales.includes(cod)) {
          if (operativosActuales.length <= 1) {
            this.notificacion.mostrar(`ℹ️ El cargo "${categoriaNombre}" debe conservar al menos un turno operativo.`);
            return r;
          }
          const nuevosTurnos = actuales.filter((c) => c !== cod);
          const rTieneDia = nuevosTurnos.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).dia);
          const rTieneNoche = nuevosTurnos.some((c) => catalogo[c] && clasificarFranjasTurno(catalogo[c]).noche);
          return {
            ...r,
            turnosHabilitados: nuevosTurnos,
            reqDia: rTieneDia ? r.reqDia : 0,
            reqDiaDomFest: rTieneDia ? r.reqDiaDomFest : 0,
            reqNoche: rTieneNoche ? r.reqNoche : 0,
            reqNocheDomFest: rTieneNoche ? r.reqNocheDomFest : 0,
          };
        }
        return { ...r, turnosHabilitados: [...actuales, cod] };
      });

      this.nuevoServicioReqDia.set(actualizadas.reduce((s, r) => s + (Number(r.reqDia) || 0), 0));
      this.nuevoServicioReqNoche.set(actualizadas.reduce((s, r) => s + (Number(r.reqNoche) || 0), 0));
      this.nuevoServicioReqDiaDomFest.set(actualizadas.reduce((s, r) => s + (Number(r.reqDiaDomFest) || 0), 0));
      this.nuevoServicioReqNocheDomFest.set(actualizadas.reduce((s, r) => s + (Number(r.reqNocheDomFest) || 0), 0));
      return actualizadas;
    });
  }

  actualizarMetaCargoForm(
    categoriaNombre: string,
    campo: 'reqDia' | 'reqNoche' | 'reqDiaDomFest' | 'reqNocheDomFest',
    valor: number
  ): void {
    const num = Math.max(0, Number(valor) || 0);
    this.nuevoServicioReglasPorCargo.update((reglas) => {
      const actualizadas = reglas.map((r) =>
        r.categoriaNombre === categoriaNombre ? { ...r, [campo]: num } : r
      );
      this.nuevoServicioReqDia.set(actualizadas.reduce((s, r) => s + (Number(r.reqDia) || 0), 0));
      this.nuevoServicioReqNoche.set(actualizadas.reduce((s, r) => s + (Number(r.reqNoche) || 0), 0));
      this.nuevoServicioReqDiaDomFest.set(actualizadas.reduce((s, r) => s + (Number(r.reqDiaDomFest) || 0), 0));
      this.nuevoServicioReqNocheDomFest.set(actualizadas.reduce((s, r) => s + (Number(r.reqNocheDomFest) || 0), 0));
      return actualizadas;
    });
  }

  cargarServicioParaEdicion(srv: ServicioHospitalario): void {
    this.servicioEditandoId.set(srv.id);
    this.enlaceHermanoSrv1.set(srv.id);
    this.enlaceHermanoSrv2.set('');
    this.nuevoServicioCodigo.set(srv.codigo);
    this.nuevoServicioNombre.set(srv.nombre);
    this.nuevoServicioTipoAsistencia.set(srv.tipoAsistencia || 'URGENCIAS');
    const mod = srv.modalidadDias || 'TODOS_24_7';
    this.nuevoServicioModalidadDias.set(mod);
    const catalogo = this.catalogoTurnosMap();
    const turnosSrv =
      srv.turnosHabilitados && srv.turnosHabilitados.length > 0
        ? [...srv.turnosHabilitados]
        : ['M8', 'T8', 'N8', 'M6', 'T6', 'N12', 'D12', 'G24', 'ADM', 'MD', 'AP', 'DISP', 'S', 'L', 'COMP', 'VAC', 'INC', 'LIC', 'FAM'];
    this.nuevoServicioTurnosHabilitados.set(turnosSrv);

    this.nuevoServicioPermitePermutaEntreCargos.set(Boolean(srv.permitePermutaEntreCargos));
    const cargosIds =
      srv.cargosPermitidosIds && srv.cargosPermitidosIds.length > 0
        ? [...srv.cargosPermitidosIds]
        : (srv.cargosPermitidos || []).map((c) => c.categoriaId).filter(Boolean);
    this.nuevoServicioCargosPermitidosIds.set(cargosIds);

    const metasSrv = this.construirMetasDesdeTurnosSeleccionados(
      turnosSrv,
      srv.metasPorTurno || [],
      mod
    );
    this.nuevoServicioMetasPorTurno.set(metasSrv);

    if (srv.metasPorTurno && srv.metasPorTurno.length > 0) {
      this.actualizarTotalesDerivadosDesdeMetas(metasSrv);
    } else {
      const srvTieneNoche = turnosSrv.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).noche);
      const srvTieneDia = turnosSrv.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).dia);

      this.nuevoServicioReqDia.set(srvTieneDia ? (srv.reqDia ?? 4) : 0);
      this.nuevoServicioReqNoche.set(srvTieneNoche ? (srv.reqNoche ?? 2) : 0);
      this.nuevoServicioReqDiaDomFest.set(srvTieneDia ? (srv.reqDiaDomFest ?? srv.reqDia ?? 4) : 0);
      this.nuevoServicioReqNocheDomFest.set(srvTieneNoche ? (srv.reqNocheDomFest ?? srv.reqNoche ?? 2) : 0);
    }

    if (srv.reglasPorCargo && srv.reglasPorCargo.length > 0) {
      this.nuevoServicioReglasPorCargo.set(
        srv.reglasPorCargo.map((r) => {
          const tCat = r.turnosHabilitados?.length ? [...r.turnosHabilitados] : [...turnosSrv];
          const rTieneNoche = tCat.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).noche);
          const rTieneDia = tCat.some((c) => catalogo[c.toUpperCase()] && clasificarFranjasTurno(catalogo[c.toUpperCase()]).dia);
          const esUnicoCargo = srv.reglasPorCargo?.length === 1;

          return {
            ...r,
            turnosHabilitados: tCat,
            reqDia: rTieneDia ? (esUnicoCargo ? (srv.reqDia ?? r.reqDia) : r.reqDia) : 0,
            reqNoche: rTieneNoche ? (esUnicoCargo ? (srv.reqNoche ?? r.reqNoche) : r.reqNoche) : 0,
            reqDiaDomFest: rTieneDia ? (esUnicoCargo ? (srv.reqDiaDomFest ?? r.reqDiaDomFest) : r.reqDiaDomFest) : 0,
            reqNocheDomFest: rTieneNoche ? (esUnicoCargo ? (srv.reqNocheDomFest ?? r.reqNocheDomFest) : r.reqNocheDomFest) : 0,
          };
        })
      );
    } else {
      const empsSrv = this.empleados().filter((e) => e.servicioBaseId === srv.id);
      const cats = Array.from(new Set(empsSrv.map((e) => e.categoria)));
      this.nuevoServicioReglasPorCargo.set(
        cats.map((cat) => {
          const count = empsSrv.filter((e) => e.categoria === cat).length;
          return {
            categoriaNombre: cat,
            empleadosCount: count,
            reqDia: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqNoche: count >= 3 ? 1 : 0,
            reqDiaDomFest: Math.max(1, Math.min(2, Math.floor(count / 2))),
            reqNocheDomFest: count >= 3 ? 1 : 0,
            turnosHabilitados: [...turnosSrv],
          };
        })
      );
    }

    this.notificacion.mostrar(`ℹ️ Modo edición activado: ${srv.nombre}`);

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
    this.enlaceHermanoSrv1.set(this.servicios()[0]?.id || '');
    this.enlaceHermanoSrv2.set('');
    this.nuevoServicioCodigo.set('');
    this.nuevoServicioNombre.set('');
    this.nuevoServicioTipoAsistencia.set('URGENCIAS');
    this.nuevoServicioModalidadDias.set('TODOS_24_7');
    this.nuevoServicioReqDia.set(4);
    this.nuevoServicioReqNoche.set(2);
    this.nuevoServicioReqDiaDomFest.set(2);
    this.nuevoServicioReqNocheDomFest.set(1);
    const turnosDef = [
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
      'LIC',
      'FAM',
    ];
    this.nuevoServicioTurnosHabilitados.set(turnosDef);
    this.nuevoServicioPermitePermutaEntreCargos.set(false);
    this.nuevoServicioCargosPermitidosIds.set([]);
    this.nuevoServicioMetasPorTurno.set([]);
    this.nuevoServicioReglasPorCargo.set([]);
  }

  guardarServicioAutonomo(): void {
    const cod = this.nuevoServicioCodigo().trim().toUpperCase();
    const nom = this.nuevoServicioNombre().trim();
    const tipo = this.nuevoServicioTipoAsistencia();
    const modalidadDias = this.nuevoServicioModalidadDias();
    const turnosHabilitados = this.nuevoServicioTurnosHabilitados();
    const metasPorTurno = this.nuevoServicioMetasPorTurno();
    const cargosPermitidosIds = this.nuevoServicioCargosPermitidosIds();
    const permitePermutaEntreCargos = this.nuevoServicioPermitePermutaEntreCargos();

    for (const m of metasPorTurno) {
      if (m.minimoBase > m.esperadoBase || m.minimoDomFest > m.esperadoDomFest) {
        this.notificacion.mostrar(
          `⛔ Meta inválida para el turno "${m.codigoTurno}": Mínimo no puede superar a Esperado.`
        );
        return;
      }
    }

    const reqDia = Math.max(0, Number(this.nuevoServicioReqDia()) || 0);
    const reqNoche = Math.max(0, Number(this.nuevoServicioReqNoche()) || 0);
    const reqDiaDomFest =
      modalidadDias === 'TODOS_GUARDIA_FDS'
        ? Math.max(0, Number(this.nuevoServicioReqDiaDomFest()) || 0)
        : modalidadDias === 'LUN_SAB_SIN_FESTIVOS' || modalidadDias === 'LUN_VIE_HABILES'
          ? 0
          : reqDia;
    const reqNocheDomFest =
      modalidadDias === 'TODOS_GUARDIA_FDS'
        ? Math.max(0, Number(this.nuevoServicioReqNocheDomFest()) || 0)
        : modalidadDias === 'LUN_SAB_SIN_FESTIVOS' || modalidadDias === 'LUN_VIE_HABILES'
          ? 0
          : reqNoche;
    const reglasPorCargo = this.nuevoServicioReglasPorCargo().map((r) => ({
      ...r,
      reqDiaDomFest:
        modalidadDias === 'TODOS_GUARDIA_FDS'
          ? Math.max(0, Number(r.reqDiaDomFest) || 0)
          : modalidadDias === 'LUN_SAB_SIN_FESTIVOS' || modalidadDias === 'LUN_VIE_HABILES'
            ? 0
            : Math.max(0, Number(r.reqDia) || 0),
      reqNocheDomFest:
        modalidadDias === 'TODOS_GUARDIA_FDS'
          ? Math.max(0, Number(r.reqNocheDomFest) || 0)
          : modalidadDias === 'LUN_SAB_SIN_FESTIVOS' || modalidadDias === 'LUN_VIE_HABILES'
            ? 0
            : Math.max(0, Number(r.reqNoche) || 0),
    }));
    const editandoId = this.servicioEditandoId();

    if (!cod || !nom) {
      this.notificacion.mostrar('⛔ Por favor completa el código y nombre del servicio.');
      return;
    }

    const duplicado = this.servicios().find(
      (s) => s.codigo.toUpperCase() === cod && s.id !== editandoId
    );
    if (duplicado) {
      this.notificacion.mostrar(`⛔ El código "${cod}" ya está asignado al servicio "${duplicado.nombre}".`);
      return;
    }

    const payloadBase: any = {
      codigo: cod,
      nombre: nom,
      tipoAsistencia: tipo,
      modalidadDias,
      permitePermutaEntreCargos,
      cargosPermitidosIds,
      turnosHabilitados,
      reglasPorCargo,
    };

    if (metasPorTurno.length > 0) {
      payloadBase.metasPorTurno = metasPorTurno.map((m) => ({
        tipoTurnoId: m.tipoTurnoId,
        codigoTurno: m.codigoTurno,
        habilitado: m.habilitado !== false,
        minimoBase: m.minimoBase,
        esperadoBase: m.esperadoBase,
        minimoDomFest: m.minimoDomFest,
        esperadoDomFest: m.esperadoDomFest,
      }));
    } else {
      payloadBase.reqDia = reqDia;
      payloadBase.reqNoche = reqNoche;
      payloadBase.reqDiaDomFest = reqDiaDomFest;
      payloadBase.reqNocheDomFest = reqNocheDomFest;
    }

    if (editandoId) {
      this.api
        .actualizarServicio(editandoId, payloadBase)
        .subscribe({
          next: () => {
            this.notificacion.mostrar(`✅ Servicio "${nom}", cargos permitidos y metas por turno actualizados en PostgreSQL.`);
            this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error de conexión con el backend';
            this.notificacion.mostrar(`❌ Error al actualizar servicio: ${msg}`);
          },
        });
    } else {
      this.api
        .crearServicio(payloadBase)
        .subscribe({
          next: () => {
            this.notificacion.mostrar(`✅ Servicio "${nom}" creado y persistido en PostgreSQL.`);
            this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error de conexión con el backend';
            this.notificacion.mostrar(`❌ Error al crear servicio: ${msg}`);
          },
        });
    }
  }

  eliminarServicioAutonomo(srv: ServicioHospitalario): void {
    if (srv.empleadosCount && srv.empleadosCount > 0) {
      this.notificacion.mostrar(
        `⛔ No se puede eliminar "${srv.nombre}": tiene ${srv.empleadosCount} colaboradores adscritos. Trasládelos antes de eliminar.`
      );
      return;
    }

    this.notificacion.abrirConfirmacion({
      titulo: '🗑️ Eliminar Servicio Hospitalario',
      mensaje: `¿Seguro que deseas eliminar el servicio "${srv.nombre}" (${srv.codigo}) de forma permanente en PostgreSQL?`,
      textoBotonConfirmar: 'Sí, Eliminar Servicio',
      esPeligroso: true,
      onConfirmar: () => {
        this.api.eliminarServicio(srv.id).subscribe({
          next: () => {
            this.notificacion.mostrar(`✅ Servicio "${srv.nombre}" eliminado de PostgreSQL.`);
            if (this.servicioEditandoId() === srv.id) this.cancelarEdicionServicio();
            this.recargarServicios();
          },
          error: (err) => {
            const msg = err?.error?.message || err?.message || 'Error al eliminar servicio en base de datos';
            this.notificacion.mostrar(`❌ ${msg}`);
          },
        });
      },
    });
  }

  guardarEnlaceHermanos(): void {
    const id1 = this.servicioEditandoId() || this.enlaceHermanoSrv1();
    const id2 = this.enlaceHermanoSrv2();

    if (!id2 || id1 === id2) {
      this.notificacion.mostrar('ℹ️ Selecciona un servicio de apoyo distinto para vincularlo.');
      return;
    }

    const srv1 = this.servicios().find((s) => s.id === id1);
    const srv2 = this.servicios().find((s) => s.id === id2);

    if (!srv1 || !srv2) {
      this.notificacion.mostrar('⛔ No se encontraron los servicios seleccionados.');
      return;
    }

    const yaSonHermanos = (srv1.hermanos || []).some((h) => h.id === id2);
    if (yaSonHermanos) {
      this.notificacion.mostrar(`ℹ️ "${srv1.nombre}" y "${srv2.nombre}" ya se encuentran vinculados como apoyo.`);
      return;
    }

    const prevServicios = this.servicios();
    const prevHermanoSrv2 = this.enlaceHermanoSrv2();

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

    this.api.enlazarServiciosHermanos(id1, id2).subscribe({
      next: () => {
        this.enlaceHermanoSrv2.set('');
        this.notificacion.mostrar(`✅ Servicios "${srv1.codigo}" y "${srv2.codigo}" vinculados como apoyo.`);
        this.recargarServicios();
      },
      error: (err) => {
        this.servicios.set(prevServicios);
        this.enlaceHermanoSrv2.set(prevHermanoSrv2);
        const msg = err?.error?.message || 'Error al vincular servicios hermanos en PostgreSQL.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  desenlazarServicioHermano(srv1Id: string, srv2Id: string): void {
    const prevServicios = this.servicios();

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

    this.api.desenlazarServiciosHermanos(srv1Id, srv2Id).subscribe({
      next: () => {
        this.notificacion.mostrar('✅ Vínculo de servicio de apoyo eliminado.');
        this.recargarServicios();
      },
      error: (err) => {
        this.servicios.set(prevServicios);
        const msg = err?.error?.message || 'Error al eliminar el vínculo de apoyo en PostgreSQL.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  recargarServicios(): void {
    this.api.getServicios().subscribe({
      next: (srvs) => this.aplicarServiciosDesdeDb(srvs),
      error: () => {},
    });
  }

  // Gestión del Catálogo Maestro de Tipos de Turno
  cambiarTurnoModoJornadaForm(modo: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'): void {
    this.turnoFormModoJornada.set(modo);
    if (modo !== 'DESCANSO') {
      this.turnoFormProrrateaMeta.set(false);
      this.turnoFormEsAusencia.set(false);
      this.turnoFormDescuentaBanco.set(false);
    }
  }

  cambiarTurnoProrrateaMetaForm(valor: boolean): void {
    const activo = Boolean(valor);
    this.turnoFormProrrateaMeta.set(activo);
    if (activo) {
      this.turnoFormModoJornada.set('DESCANSO');
      this.turnoFormDescuentaBanco.set(false);
      this.turnoFormNocturnoPesado.set(false);
    }
  }

  cambiarTurnoDescuentaBancoForm(valor: boolean): void {
    const activo = Boolean(valor);
    this.turnoFormDescuentaBanco.set(activo);
    if (activo) {
      this.turnoFormModoJornada.set('DESCANSO');
      this.turnoFormProrrateaMeta.set(false);
      this.turnoFormEsAusencia.set(false);
      this.turnoFormNocturnoPesado.set(false);
    }
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
    this.turnoFormProrrateaMeta.set(Boolean(turno.prorrateaMetaContrato));
    this.turnoFormEsAusencia.set(Boolean(turno.esAusencia));
    this.turnoFormBloqueaPermutas.set(Boolean(turno.bloqueaPermutas));
    this.turnoFormDescuentaBanco.set(!!turno.descuentaBancoHoras);
    this.turnoFormModoAmortizacion.set(
      (turno.modoAmortizacionBanco as ModoAmortizacionBanco) === 'DIA_HABIL_EMPRESA'
        ? 'DIA_HABIL_EMPRESA'
        : 'HORAS_FIJAS'
    );
    this.turnoFormHorasAmortizacion.set(
      turno.descuentaBancoHoras ? obtenerHorasAmortizacionTurno(turno) || 8 : 8
    );

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
    this.turnoFormProrrateaMeta.set(false);
    this.turnoFormEsAusencia.set(false);
    this.turnoFormBloqueaPermutas.set(false);
    this.turnoFormDescuentaBanco.set(false);
    this.turnoFormModoAmortizacion.set('HORAS_FIJAS');
    this.turnoFormHorasAmortizacion.set(8);
  }

  guardarTurnoEnCatalogo(): void {
    const codigo = this.turnoFormCodigo().trim().toUpperCase();
    const nombre = this.turnoFormNombre().trim();

    if (!codigo || !nombre) {
      this.notificacion.mostrar('⛔ Ingresa el código y el nombre del turno.');
      return;
    }

    const modo = this.turnoFormModoJornada();
    const esObligatorio = CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(codigo);
    if (esObligatorio && modo !== 'DESCANSO') {
      this.notificacion.mostrar(
        `⛔ El turno obligatorio "${codigo}" debe permanecer en modo Descanso / Novedad (0 h).`
      );
      return;
    }

    const calc = this.calculoAutomaticoHorasTurno();
    if (modo === 'HORARIO' && calc.ordinarias <= 0) {
      this.notificacion.mostrar('⛔ En modo Horario Fijo/Rotativo, la duración neta debe ser mayor a 0h (si dura 24h usa Guardia 24h).');
      return;
    }

    const prorrateaMeta = modo === 'DESCANSO' && this.turnoFormProrrateaMeta();
    const descuentaBanco = modo === 'DESCANSO' && this.turnoFormDescuentaBanco();
    if (prorrateaMeta && descuentaBanco) {
      this.notificacion.mostrar(
        '⛔ Un turno no puede prorratear la meta de días hábiles y amortizar Banco de Horas al mismo tiempo.'
      );
      return;
    }

    const horaInicioFinal = modo === 'DESCANSO' ? '00:00' : this.turnoFormHoraInicio();
    const horaFinFinal = modo === 'DESCANSO' ? '00:00' : modo === 'GUARDIA_24H' ? horaInicioFinal : this.turnoFormHoraFin();
    const modoAmortizacion = descuentaBanco ? this.turnoFormModoAmortizacion() : 'HORAS_FIJAS';
    const horasAmortizacionBanco = descuentaBanco
      ? Math.max(0.5, Number(this.turnoFormHorasAmortizacion()) || 8)
      : null;

    const tema =
      this.temasColorTurno.find((t) => t.key === this.turnoFormColorKey()) ||
      this.temasColorTurno[0];

    const prevCatalogo = this.catalogoTurnosMap();
    const prevServiciosHab = this.nuevoServicioTurnosHabilitados();
    const existente = prevCatalogo[codigo];
    const esAusencia = modo === 'DESCANSO' ? this.turnoFormEsAusencia() : false;
    const bloqueaPermutas = this.turnoFormBloqueaPermutas();

    const nuevoTurno: TipoTurnoConfig = {
      codigo,
      nombre,
      horario: calc.horarioTexto,
      horaInicio: horaInicioFinal,
      horaFin: horaFinFinal,
      horasOrdinarias: calc.ordinarias,
      horasDiurnas: calc.diurnas,
      horasNocturnas: calc.nocturnas,
      minutosAlmuerzo: calc.minutosAlmuerzo,
      bgHex: tema.bgHex,
      textHex: tema.textHex,
      borderHex: tema.borderHex,
      esAusencia,
      prorrateaMetaContrato: prorrateaMeta,
      bloqueaPermutas,
      esNocturnoPesado: modo === 'DESCANSO' ? false : this.turnoFormNocturnoPesado(),
      descuentaBancoHoras: descuentaBanco,
      modoAmortizacionBanco: modoAmortizacion,
      horasAmortizacionBanco,
      esSistemaObligatorio: existente?.esSistemaObligatorio ?? esObligatorio,
      activo: existente?.activo ?? true,
      visibleEnPaleta: existente?.visibleEnPaleta ?? true,
    };

    this.catalogoTurnosMap.update((actual) => ({
      ...actual,
      [codigo]: nuevoTurno,
    }));

    if (!existente && !prevServiciosHab.includes(codigo)) {
      this.nuevoServicioTurnosHabilitados.update((lista) => [...lista, codigo]);
    }

    this.api
      .guardarTipoTurno({
        codigo,
        nombre,
        horaInicio: horaInicioFinal,
        horaFin: horaFinFinal,
        horasOrdinarias: nuevoTurno.horasOrdinarias,
        horasDiurnas: nuevoTurno.horasDiurnas,
        horasNocturnas: nuevoTurno.horasNocturnas,
        minutosAlmuerzo: nuevoTurno.minutosAlmuerzo || 0,
        colorHex: nuevoTurno.bgHex,
        descuentaBancoHoras: nuevoTurno.descuentaBancoHoras,
        modoAmortizacionBanco: modoAmortizacion,
        horasAmortizacionBanco,
        prorrateaMetaContrato: prorrateaMeta,
        esAusencia,
        bloqueaPermutas,
        modoJornada: modo,
        esNocturnoPesado: nuevoTurno.esNocturnoPesado,
        visibleEnPaleta: nuevoTurno.visibleEnPaleta,
        activo: nuevoTurno.activo,
      })
      .subscribe({
        next: (respDb) => {
          if (respDb) {
            this.aplicarCatalogoTurnosDesdeDb([respDb]);
          }
          this.notificacion.mostrar(`✅ Turno [${codigo}] "${nombre}" guardado y liquidación actualizada.`);
          this.limpiarFormularioTurno();
        },
        error: (err) => {
          this.catalogoTurnosMap.set(prevCatalogo);
          this.nuevoServicioTurnosHabilitados.set(prevServiciosHab);
          const msg = err?.error?.message || 'Error al guardar tipo de turno en PostgreSQL.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }

  archivarTipoTurno(codigo: string): void {
    const cod = codigo.trim().toUpperCase();
    const item = this.catalogoTurnosMap()[cod];
    if (!item) return;
    if (item.esSistemaObligatorio || CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod)) {
      this.notificacion.mostrar(`⛔ El turno "${cod}" es obligatorio del sistema y no puede archivarse.`);
      return;
    }

    const nuevoEstado = item.activo === false;
    this.api.archivarTipoTurno(cod, nuevoEstado).subscribe({
      next: (respDb) => {
        this.aplicarCatalogoTurnosDesdeDb([respDb]);
        this.notificacion.mostrar(
          nuevoEstado
            ? `✅ Turno [${cod}] reactivado en catálogo y paleta.`
            : `📦 Turno [${cod}] archivado (su historial permanece intacto).`
        );
      },
      error: (err) => {
        const msg = err?.error?.message || 'Error al archivar/reactivar turno.';
        this.notificacion.mostrar(`⛔ ${msg}`);
      },
    });
  }

  eliminarTipoTurno(turno: TipoTurnoConfig): void {
    const cod = turno.codigo.trim().toUpperCase();
    if (turno.esSistemaObligatorio || CODIGOS_TURNOS_SISTEMA_OBLIGATORIOS.has(cod)) {
      this.notificacion.mostrar(`⛔ El turno "${cod}" es obligatorio del sistema y no puede eliminarse.`);
      return;
    }

    this.notificacion.abrirConfirmacion({
      titulo: '🗑️ Eliminar Turno del Catálogo',
      mensaje: `¿Seguro que deseas eliminar permanentemente el turno [${cod}] "${turno.nombre}"? Solo es posible si no tiene asignaciones registradas.`,
      textoBotonConfirmar: 'Sí, Eliminar',
      esPeligroso: true,
      onConfirmar: () => {
        this.api.eliminarTipoTurno(cod).subscribe({
          next: (res) => {
            this.catalogoTurnosMap.update((actual) => {
              const copia = { ...actual };
              delete copia[cod];
              return copia;
            });
            if (this.turnoEditandoCodigo() === cod) {
              this.limpiarFormularioTurno();
            }
            this.notificacion.mostrar(`✅ ${res?.mensaje || `Turno ${cod} eliminado.`}`);
          },
          error: (err) => {
            const msg = err?.error?.message || 'Error al eliminar el turno en PostgreSQL.';
            this.notificacion.mostrar(`⛔ ${msg}`);
          },
        });
      },
    });
  }

  alternarVisibilidadTurnoPaleta(codigo: string): void {
    const prevCatalogo = this.catalogoTurnosMap();
    const itemActual = prevCatalogo[codigo];
    if (!itemActual) return;
    if (itemActual.activo === false) {
      this.notificacion.mostrar('ℹ️ Reactiva este turno archivado para volver a mostrarlo en la paleta.');
      return;
    }
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
        modoAmortizacionBanco: itemActual.modoAmortizacionBanco || 'HORAS_FIJAS',
        horasAmortizacionBanco: itemActual.horasAmortizacionBanco ?? null,
        prorrateaMetaContrato: itemActual.prorrateaMetaContrato ?? false,
        esAusencia: itemActual.esAusencia,
        bloqueaPermutas: itemActual.bloqueaPermutas ?? false,
        esNocturnoPesado: itemActual.esNocturnoPesado,
        visibleEnPaleta: nuevoValor,
        activo: itemActual.activo ?? true,
      })
      .subscribe({
        error: (err) => {
          this.catalogoTurnosMap.set(prevCatalogo);
          const msg = err?.error?.message || 'Error al actualizar visibilidad del turno en PostgreSQL.';
          this.notificacion.mostrar(`⛔ ${msg}`);
        },
      });
  }
}
