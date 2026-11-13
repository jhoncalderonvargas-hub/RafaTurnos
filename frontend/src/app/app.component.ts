import { Component, computed, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, Subject, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CeldaAsignacion,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  InfraccionNormativa,
  MenuContextualCeldaState,
  ServicioHospitalario,
  SesionUsuarioSso,
  TargetCeldaInspector,
} from './models';
import { TurnosApiService } from './turnos-api.service';
import { NotificacionStore } from './stores/notificacion.store';
import { CatalogosSsoStore } from './stores/catalogos-sso.store';
import { CuadranteStore, ResumenTandasBreakDia } from './stores/cuadrante.store';
import { PermutasAuditoriaStore } from './stores/permutas-auditoria.store';
import { PortalReportesStore } from './stores/portal-reportes.store';

import { ModalConfirmacionComponent } from './components/modales/modal-confirmacion.component';
import { ModalIcalComponent } from './components/modales/modal-ical.component';
import { ModalRotacionComponent } from './components/modales/modal-rotacion.component';
import { DashboardSolicitudesComponent } from './components/dashboard-solicitudes/dashboard-solicitudes.component';
import { PortalColaboradorComponent } from './components/portal-colaborador/portal-colaborador.component';
import { ReportesNominaComponent } from './components/reportes-nomina/reportes-nomina.component';
import { ConfiguracionServiciosComponent } from './components/configuracion-servicios/configuracion-servicios.component';
import { GestionPersonalComponent } from './components/gestion-personal/gestion-personal.component';
import { ConfiguracionEmpresasComponent } from './components/configuracion-empresas/configuracion-empresas.component';
import { ConfiguracionCatalogoTurnosComponent } from './components/configuracion-catalogo-turnos/configuracion-catalogo-turnos.component';
import { ConfiguracionFestivosComponent } from './components/configuracion-festivos/configuracion-festivos.component';
import { PlanificadorCuadranteComponent } from './components/planificador-cuadrante/planificador-cuadrante.component';
import { SidebarNavegacionComponent, VistaApp } from './components/sidebar-navegacion/sidebar-navegacion.component';
import { AuditoriaTrazabilidadComponent } from './components/auditoria-trazabilidad/auditoria-trazabilidad.component';
import { CeldaMenuContextualComponent } from './components/inspector-celda/celda-menu-contextual.component';
import { CeldaDrawerComponent } from './components/inspector-celda/celda-drawer.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    ModalConfirmacionComponent,
    ModalIcalComponent,
    ModalRotacionComponent,
    DashboardSolicitudesComponent,
    PortalColaboradorComponent,
    ReportesNominaComponent,
    ConfiguracionServiciosComponent,
    GestionPersonalComponent,
    ConfiguracionEmpresasComponent,
    ConfiguracionCatalogoTurnosComponent,
    ConfiguracionFestivosComponent,
    PlanificadorCuadranteComponent,
    SidebarNavegacionComponent,
    AuditoriaTrazabilidadComponent,
    CeldaMenuContextualComponent,
    CeldaDrawerComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  private readonly api = inject(TurnosApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly notificacion = inject(NotificacionStore);
  readonly catalogos = inject(CatalogosSsoStore);
  readonly cuadrante = inject(CuadranteStore);
  readonly permutasAuditoria = inject(PermutasAuditoriaStore);
  readonly portalReportes = inject(PortalReportesStore);

  // Navegación principal (Menú lateral izquierdo colapsable automáticamente por hover)
  readonly vistaActual = signal<VistaApp>('PLANIFICADOR');
  readonly sidebarFijo = signal<boolean>(false);
  readonly sidebarHovered = signal<boolean>(false);
  readonly sidebarExpandido = computed<boolean>(() => this.sidebarFijo() || this.sidebarHovered());
  readonly sidebarContraido = computed<boolean>(() => !this.sidebarExpandido());

  // Estado del Inspector Híbrido de Celda (Menú Contextual Clic Derecho + Drawer F2)
  readonly menuContextualCelda = signal<MenuContextualCeldaState | null>(null);
  readonly drawerInspectorCelda = signal<TargetCeldaInspector | null>(null);

  readonly menuContextualData = computed(() => {
    const st = this.menuContextualCelda();
    return st ? this.resolverContextoCelda(st.empId, st.dia, st.origenVista) : null;
  });

  readonly drawerInspectorData = computed(() => {
    const st = this.drawerInspectorCelda();
    return st ? this.resolverContextoCelda(st.empId, st.dia, st.origenVista) : null;
  });

  private resolverContextoCelda(
    empId: string,
    dia: number,
    origenVista: 'PLANIFICADOR' | 'PORTAL'
  ): {
    anio: number;
    mes: number;
    diasDelMes: DiaColumna[];
    empleado: EmpleadoHospital | undefined;
    celda: CeldaAsignacion | undefined;
    codigoDiaAnterior: CodigoTurno;
    celdaDiaSiguiente: CeldaAsignacion | undefined;
    servicioActual: ServicioHospitalario;
    estadoCuadrante: 'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA' | 'SIN_PLANIFICAR';
    infraccionesActivas: InfraccionNormativa[];
    resumenTandasBreakDia: ResumenTandasBreakDia | null;
  } {
    const anio = this.catalogos.anioSeleccionado();
    if (origenVista === 'PORTAL') {
      const mes = this.portalReportes.mesSeleccionadoPortal();
      const diasDelMes = this.portalReportes.diasDelMesPortal();
      const portalData = this.portalReportes.datosEmpleadoPortal();
      const empleado =
        portalData.empleado?.id === empId
          ? portalData.empleado
          : this.catalogos.empleados().find((e) => e.id === empId);
      const celdasEmp =
        portalData.empleado?.id === empId
          ? (portalData.celdas || {})
          : (this.portalReportes.asignacionesMesPortal()[empId] || {});
      const celda = celdasEmp[dia];
      const codigoDiaAnterior = (
        dia === 1
          ? this.cuadrante.obtenerUltimoTurnoMesPrevioEnPeriodo(
              empId,
              anio,
              mes,
              empleado?.ultimoTurnoMesPrevio || 'L'
            )
          : celdasEmp[dia - 1]?.codigo || ''
      ) as CodigoTurno;
      const celdaDiaSiguiente = dia < diasDelMes.length ? celdasEmp[dia + 1] : undefined;
      const srvIdEje =
        celda?.servicioEjecutorId || empleado?.servicioBaseId || this.catalogos.servicioSeleccionadoId();
      const servicioActual =
        this.catalogos.servicios().find((s) => s.id === srvIdEje) ||
        portalData.servicioBase ||
        this.catalogos.servicioActual();

      return {
        anio,
        mes,
        diasDelMes,
        empleado,
        celda,
        codigoDiaAnterior,
        celdaDiaSiguiente,
        servicioActual,
        estadoCuadrante: this.portalReportes.estadoCuadrantePortal(),
        infraccionesActivas: [],
        resumenTandasBreakDia: null,
      };
    }

    const mes = this.catalogos.mesSeleccionado();
    const diasDelMes = this.cuadrante.diasDelMes();
    const fila = this.cuadrante.filasServicioCompletas().find((f) => f.empleado.id === empId);
    const empleado =
      fila?.empleado || this.catalogos.empleados().find((e) => e.id === empId);
    const celdasEmp = this.cuadrante.asignaciones()[empId] || {};
    const celda = celdasEmp[dia];
    const codigoDiaAnterior = (
      dia === 1
        ? this.cuadrante.obtenerUltimoTurnoMesPrevio(empId, empleado?.ultimoTurnoMesPrevio || 'L')
        : celdasEmp[dia - 1]?.codigo || ''
    ) as CodigoTurno;
    const celdaDiaSiguiente = dia < diasDelMes.length ? celdasEmp[dia + 1] : undefined;
    const srvActual = this.catalogos.servicioActual();
    const resumenTandasBreakDia = celda?.codigo
      ? this.cuadrante.obtenerResumenTandasDia(srvActual.id, dia, celda.codigo)
      : null;

    return {
      anio,
      mes,
      diasDelMes,
      empleado,
      celda,
      codigoDiaAnterior,
      celdaDiaSiguiente,
      servicioActual: srvActual,
      estadoCuadrante: this.cuadrante.estadoCuadrante(),
      infraccionesActivas: this.cuadrante.infraccionesActivas(),
      resumenTandasBreakDia,
    };
  }

  private readonly periodoCambioSubject = new Subject<{
    anio: number;
    mes: number;
    recargarAnio: boolean;
    sincronizarIntranet: boolean;
  }>();

  ngOnInit(): void {
    this.periodoCambioSubject
      .pipe(
        switchMap((req) => {
          const tareas: Observable<unknown>[] = [
            this.api.getNovedades(req.anio, req.mes).pipe(
              map((novedadesDb) => {
                if (
                  req.anio === this.catalogos.anioSeleccionado() &&
                  req.mes === this.catalogos.mesSeleccionado() &&
                  Array.isArray(novedadesDb)
                ) {
                  this.cuadrante.listaNovedades.set(novedadesDb);
                }
                return novedadesDb;
              }),
              catchError(() => of([]))
            ),
          ];
          if (req.recargarAnio) {
            tareas.push(this.catalogos.crearObsFestivosAnio(req.anio));
            tareas.push(this.cuadrante.crearObsCuadrantesAnio(req.anio));
          }
          return forkJoin(tareas).pipe(
            map(() => req),
            catchError(() => of(req))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((req) => {
        if (
          req.sincronizarIntranet &&
          req.anio === this.catalogos.anioSeleccionado() &&
          req.mes === this.catalogos.mesSeleccionado() &&
          (this.catalogos.esAdminTh() || this.catalogos.esCoordinador())
        ) {
          this.cuadrante.sincronizacionAutomaticaIntranet(true);
        }
      });

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
              this.catalogos.intranetReturnUrl.set(res.intranetReturnUrl);
              try {
                sessionStorage.setItem('rafa_turnos_intranet_url', res.intranetReturnUrl);
              } catch {}
            }
            this.aplicarContextoSesionSso(res.usuario);
            this.catalogos.verificandoSesionSso.set(false);

            const debeSync = res.usuario.rol === 'ADMIN_TH' || res.usuario.rol === 'COORDINADOR';
            this.cargarDatosDesdeBaseDeDatos(debeSync);

            this.notificacion.mostrar(
              `🔑 Sesión SSO iniciada: ${res.usuario.nombre} (${this.catalogos.etiquetaRol(res.usuario.rol)})`
            );
          },
          error: (err) => {
            this.catalogos.verificandoSesionSso.set(false);
            const msg = err?.error?.message || 'Token SSO inválido o expirado.';
            this.notificacion.mostrar(`❌ Error de autenticación SSO: ${msg}`);
          },
        });
        return;
      }

      const tokenGuardado = sessionStorage.getItem('rafa_turnos_sso_jwt');
      if (tokenGuardado) {
        this.api.obtenerSesionSso(tokenGuardado).subscribe({
          next: (res) => {
            if (res.intranetReturnUrl) {
              this.catalogos.intranetReturnUrl.set(res.intranetReturnUrl);
              try {
                sessionStorage.setItem('rafa_turnos_intranet_url', res.intranetReturnUrl);
              } catch {}
            }
            this.aplicarContextoSesionSso(res.usuario);
            this.catalogos.verificandoSesionSso.set(false);

            const debeSync = res.usuario.rol === 'ADMIN_TH' || res.usuario.rol === 'COORDINADOR';
            this.cargarDatosDesdeBaseDeDatos(debeSync);
          },
          error: () => {
            try {
              sessionStorage.removeItem('rafa_turnos_sso_jwt');
            } catch {}
            this.catalogos.verificandoSesionSso.set(false);
            const destino = this.catalogos.intranetReturnUrl();
            if (destino && destino !== window.location.href) {
              window.location.href = destino;
            }
          },
        });
        return;
      }

      this.catalogos.verificandoSesionSso.set(false);
      // Sin sesión activa: redirigir automáticamente solo si existe URL de retorno de Intranet
      const destino = this.catalogos.intranetReturnUrl();
      if (destino && destino !== window.location.href) {
        window.location.href = destino;
      }
    } catch {
      this.catalogos.verificandoSesionSso.set(false);
    }
  }

  private aplicarContextoSesionSso(usuario: SesionUsuarioSso): void {
    this.catalogos.establecerSesionBasicaSso(usuario);
    this.portalReportes.aplicarContextoSesionSso(usuario);

    if (usuario.rol === 'COLABORADOR') {
      this.vistaActual.set('PORTAL_EMPLEADO');
    } else if (usuario.rol === 'COORDINADOR' && this.esVistaGestion(this.vistaActual())) {
      this.vistaActual.set('PLANIFICADOR');
    }
  }

  private esVistaGestion(vista: VistaApp): boolean {
    return (
      vista === 'GESTION_SERVICIOS' ||
      vista === 'GESTION_PERSONAL' ||
      vista === 'GESTION_TURNOS' ||
      vista === 'GESTION_EMPRESAS' ||
      vista === 'GESTION_FESTIVOS'
    );
  }

  cargarDatosDesdeBaseDeDatos(sincronizarIntranetDespues = false): void {
    const anio = this.catalogos.anioSeleccionado();
    const mes = this.catalogos.mesSeleccionado();

    forkJoin([
      this.api.getEmpresas().pipe(
        map((emps) => this.catalogos.aplicarEmpresasDesdeDb(emps)),
        catchError(() => of(null))
      ),
      this.api.getPlantillasEmpresas().pipe(
        map((plantillas) => this.catalogos.aplicarPlantillasDesdeDb(plantillas)),
        catchError(() => of(null))
      ),
      this.api.getMacroprocesos().pipe(
        map((lista) => {
          if (Array.isArray(lista) && lista.length > 0) this.catalogos.macroprocesos.set(lista);
        }),
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
      this.api.getTiposTurno().pipe(
        map((turnosDb) => this.catalogos.aplicarCatalogoTurnosDesdeDb(turnosDb)),
        catchError(() => of(null))
      ),
      this.api.getEmpleados().pipe(
        map((empsDb) => this.catalogos.aplicarEmpleadosDesdeDb(empsDb)),
        catchError(() => of(null))
      ),
      this.catalogos.crearObsFestivosAnio(anio),
      this.cuadrante.crearObsCuadrantesAnio(anio),
      this.api.getPermutas().pipe(
        map((permutasDb) => {
          if (Array.isArray(permutasDb)) {
            this.permutasAuditoria.listaPermutas.set(permutasDb);
            try {
              localStorage.removeItem('rafa_turnos_permutas');
            } catch {}
          }
        }),
        catchError(() => of(null))
      ),
      this.api.getNovedades(anio, mes).pipe(
        map((novedadesDb) => {
          if (Array.isArray(novedadesDb)) this.cuadrante.listaNovedades.set(novedadesDb);
        }),
        catchError(() => of(null))
      ),
      this.permutasAuditoria.crearObsAuditorias(),
    ]).subscribe(() => {
      if (sincronizarIntranetDespues && (this.catalogos.esAdminTh() || this.catalogos.esCoordinador())) {
        this.cuadrante.sincronizacionAutomaticaIntranet(true);
      }
    });
  }

  /**
   * Recarga bajo demanda los datos del Dashboard de Solicitudes y Auditoría desde PostgreSQL.
   */
  recargarDatosDashboard(): void {
    this.permutasAuditoria.sincronizarAuditoriasDesdePostgres();
    this.permutasAuditoria.sincronizarPermutasDesdePostgres();
    this.notificacion.mostrar('🔄 Datos de solicitudes y auditoría actualizados desde el servidor.');
  }

  irAConfigurarServiciosApoyo(): void {
    this.cuadrante.modalRotacionAbierto.set(false);
    this.vistaActual.set('GESTION_SERVICIOS');
  }

  irAConfigurarEmpresas(): void {
    if (!this.catalogos.esAdminTh()) {
      this.notificacion.mostrar('ℹ️ La gestión de empresas contratantes está reservada a Talento Humano / Admin.');
      return;
    }
    this.vistaActual.set('GESTION_EMPRESAS');
  }

  verCalendarioColaborador(empleadoId: string): void {
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set(null);
    this.portalReportes.cambiarEmpleadoPortal(empleadoId);
    this.vistaActual.set('PORTAL_EMPLEADO');
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

  onItemNavegacionClick(vista: VistaApp): void {
    if (
      this.catalogos.esColaborador() &&
      (vista === 'PLANIFICADOR' || vista === 'REPORTES' || vista === 'AUDITORIA' || this.esVistaGestion(vista))
    ) {
      this.notificacion.mostrar(
        '⛔ Acceso restringido: tu perfil de Colaborador solo tiene acceso a Mi Calendario y Solicitudes.'
      );
      return;
    }
    if (this.catalogos.esCoordinador() && this.esVistaGestion(vista)) {
      this.notificacion.mostrar(
        '⛔ Acceso restringido: los módulos de Gestión están reservados para Talento Humano / Administración.'
      );
      return;
    }
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set(null);
    this.vistaActual.set(vista);
    if (vista === 'DASHBOARD' || vista === 'AUDITORIA') {
      this.permutasAuditoria.sincronizarAuditoriasDesdePostgres();
      this.permutasAuditoria.sincronizarPermutasDesdePostgres();
    }
    if (!this.sidebarFijo()) {
      this.sidebarHovered.set(false);
    }
  }

  // Controladores del Inspector de Celda (Clic Derecho + F2)
  abrirMenuContextualPlanificador(ev: {
    empId: string;
    dia: number;
    clientX: number;
    clientY: number;
  }): void {
    this.menuContextualCelda.set({ ...ev, origenVista: 'PLANIFICADOR' });
  }

  abrirDrawerDesdeMenuContextual(ev: {
    empId: string;
    dia: number;
    origenVista: 'PLANIFICADOR' | 'PORTAL';
    focoSeccion?: 'NOTA' | 'APOYO' | 'EDICION';
  }): void {
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set(ev);
  }

  abrirDrawerPlanificador(ev: { empId: string; dia: number }): void {
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set({
      empId: ev.empId,
      dia: ev.dia,
      origenVista: 'PLANIFICADOR',
    });
  }

  abrirMenuContextualPortal(ev: { dia: number; clientX: number; clientY: number }): void {
    const empId =
      this.portalReportes.datosEmpleadoPortal().empleado?.id ||
      this.portalReportes.empleadoPortalId() ||
      this.catalogos.sesionActual()?.empleadoId ||
      '';
    if (!empId) return;
    this.menuContextualCelda.set({
      empId,
      dia: ev.dia,
      clientX: ev.clientX,
      clientY: ev.clientY,
      origenVista: 'PORTAL',
    });
  }

  abrirDrawerPortalDia(dia: number): void {
    const empId =
      this.portalReportes.datosEmpleadoPortal().empleado?.id ||
      this.portalReportes.empleadoPortalId() ||
      this.catalogos.sesionActual()?.empleadoId ||
      '';
    if (!empId) return;
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set({
      empId,
      dia,
      origenVista: 'PORTAL',
    });
  }

  navegarDiaDrawer(nuevoDia: number): void {
    const actual = this.drawerInspectorCelda();
    if (!actual) return;
    const totalDias =
      actual.origenVista === 'PORTAL'
        ? this.portalReportes.diasDelMesPortal().length
        : this.cuadrante.diasDelMes().length;
    if (nuevoDia < 1 || nuevoDia > totalDias) return;
    this.drawerInspectorCelda.set({
      empId: actual.empId,
      dia: nuevoDia,
      origenVista: actual.origenVista,
    });
    if (actual.origenVista === 'PLANIFICADOR') {
      this.cuadrante.enfocarCeldaPorId(actual.empId, nuevoDia);
    } else {
      this.portalReportes.seleccionarDiaEnPortal(nuevoDia);
    }
  }

  irAPermutaDesdeInspector(dia: number): void {
    this.portalReportes.seleccionarDiaEnPortal(dia);
    setTimeout(() => {
      const sel = document.getElementById('portal-companero-select');
      sel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      sel?.focus();
    }, 60);
  }

  // Controladores de cambio de servicio y periodo
  cambiarServicio(nuevoId: string): void {
    this.menuContextualCelda.set(null);
    this.drawerInspectorCelda.set(null);
    this.catalogos.servicioSeleccionadoId.set(nuevoId);
    this.cuadrante.limpiarEstadoAlCambiarServicio();
    this.permutasAuditoria.sincronizarAuditoriasDesdePostgres();
    this.portalReportes.sincronizarPortalAlCambiarServicio(nuevoId);
  }

  cambiarMes(nuevoMes: number): void {
    this.cambiarPeriodo(this.catalogos.anioSeleccionado(), Number(nuevoMes), false);
  }

  cambiarAnio(nuevoAnio: number): void {
    const anioNum = Number(nuevoAnio);
    if (!anioNum || anioNum === this.catalogos.anioSeleccionado()) return;
    this.cambiarPeriodo(anioNum, this.catalogos.mesSeleccionado(), false);
  }

  navegarMes(delta: -1 | 1): void {
    let nuevoMes = this.catalogos.mesSeleccionado() + delta;
    let nuevoAnio = this.catalogos.anioSeleccionado();
    if (nuevoMes < 1) {
      nuevoMes = 12;
      nuevoAnio--;
    } else if (nuevoMes > 12) {
      nuevoMes = 1;
      nuevoAnio++;
    }
    this.cambiarPeriodo(nuevoAnio, nuevoMes, false);
  }

  irAMesActual(): void {
    this.cambiarPeriodo(this.catalogos.anioActual, this.catalogos.mesActual, false);
  }

  cambiarMesPortal(nuevoMes: number): void {
    this.cambiarPeriodo(this.catalogos.anioSeleccionado(), Number(nuevoMes), true);
  }

  cambiarAnioPortal(nuevoAnio: number): void {
    const anioNum = Number(nuevoAnio);
    if (!anioNum || anioNum === this.catalogos.anioSeleccionado()) return;
    this.cambiarPeriodo(anioNum, this.catalogos.mesSeleccionado(), true);
  }

  irAMesActualPortal(): void {
    this.cambiarPeriodo(this.catalogos.anioActual, this.catalogos.mesActual, true);
  }

  private cambiarPeriodo(nuevoAnio: number, nuevoMes: number, desdePortal: boolean): void {
    this.menuContextualCelda.set(null);
    const anioValido = Number(nuevoAnio);
    const mesValido = Math.min(12, Math.max(1, Number(nuevoMes)));
    const cambioAnio = anioValido !== this.catalogos.anioSeleccionado();

    this.catalogos.anioSeleccionado.set(anioValido);
    this.catalogos.mesSeleccionado.set(mesValido);
    this.cuadrante.limpiarPilasAlCambiarPeriodo();
    this.portalReportes.ajustarDiaLimitePeriodo(anioValido, mesValido);

    if (cambioAnio) {
      this.cuadrante.inicializarMatrizCuadrante(this.catalogos.empleados());
    }

    this.periodoCambioSubject.next({
      anio: anioValido,
      mes: mesValido,
      recargarAnio: cambioAnio,
      sincronizarIntranet:
        !desdePortal && (this.catalogos.esAdminTh() || this.catalogos.esCoordinador()),
    });
  }

  @HostListener('window:keydown', ['$event'])
  onWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.cuadrante.teclaCtrlPresionada.set(true);
    }

    const activeTag = (document.activeElement?.tagName || '').toLowerCase();
    const enInputEditable = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

    if (event.key === 'F2' && !enInputEditable) {
      if (this.vistaActual() === 'PLANIFICADOR') {
        const enfocada = this.cuadrante.celdaEnfocada();
        if (enfocada) {
          event.preventDefault();
          this.abrirDrawerPlanificador(enfocada);
          return;
        }
      } else if (
        this.vistaActual() === 'PORTAL_EMPLEADO' &&
        this.portalReportes.mesesDisponiblesPortal().length > 0
      ) {
        event.preventDefault();
        this.abrirDrawerPortalDia(this.portalReportes.diaPermutaSeleccionado());
        return;
      }
    }

    const isCtrl = event.ctrlKey || event.metaKey;
    const keyLower = event.key.toLowerCase();

    if (isCtrl && keyLower === 'z' && !event.shiftKey) {
      if (enInputEditable) {
        return;
      }
      event.preventDefault();
      this.cuadrante.deshacerUltimaAccion();
      return;
    }

    if (isCtrl && (keyLower === 'y' || (keyLower === 'z' && event.shiftKey))) {
      if (enInputEditable) {
        return;
      }
      event.preventDefault();
      this.cuadrante.rehacerUltimaAccion();
    }
  }

  @HostListener('window:keyup', ['$event'])
  onWindowKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Control' || event.key === 'Meta') {
      this.cuadrante.teclaCtrlPresionada.set(false);
      if (this.cuadrante.clonandoConCtrl()) {
        this.cuadrante.finalizarPintadoRaton();
      }
    }
  }

  @HostListener('window:mouseup')
  onWindowMouseUp(): void {
    if (this.cuadrante.pintandoConRaton() || this.cuadrante.clonandoConCtrl()) {
      this.cuadrante.finalizarPintadoRaton();
    }
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.cuadrante.finalizarBlurVentana();
  }
}
