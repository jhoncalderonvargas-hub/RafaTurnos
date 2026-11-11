import { Component, computed, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, Subject, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SesionUsuarioSso } from './models';
import { TurnosApiService } from './turnos-api.service';
import { NotificacionStore } from './stores/notificacion.store';
import { CatalogosSsoStore } from './stores/catalogos-sso.store';
import { CuadranteStore } from './stores/cuadrante.store';
import { PermutasAuditoriaStore } from './stores/permutas-auditoria.store';
import { PortalReportesStore } from './stores/portal-reportes.store';

import { ModalConfirmacionComponent } from './components/modales/modal-confirmacion.component';
import { ModalIcalComponent } from './components/modales/modal-ical.component';
import { ModalRotacionComponent } from './components/modales/modal-rotacion.component';
import { DashboardSolicitudesComponent } from './components/dashboard-solicitudes/dashboard-solicitudes.component';
import { PortalColaboradorComponent } from './components/portal-colaborador/portal-colaborador.component';
import { ReportesNominaComponent } from './components/reportes-nomina/reportes-nomina.component';
import { ConfiguracionGeneralComponent } from './components/configuracion-general/configuracion-general.component';
import { PlanificadorCuadranteComponent } from './components/planificador-cuadrante/planificador-cuadrante.component';
import { SidebarNavegacionComponent } from './components/sidebar-navegacion/sidebar-navegacion.component';
import { AuditoriaTrazabilidadComponent } from './components/auditoria-trazabilidad/auditoria-trazabilidad.component';

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
    ConfiguracionGeneralComponent,
    PlanificadorCuadranteComponent,
    SidebarNavegacionComponent,
    AuditoriaTrazabilidadComponent,
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
  readonly vistaActual = signal<
    'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'AUDITORIA' | 'PORTAL_EMPLEADO' | 'CONFIGURACION'
  >('PLANIFICADOR');
  readonly subVistaConfig = signal<'SERVICIOS' | 'EMPRESAS' | 'CATALOGO_TURNOS' | 'FESTIVOS'>('SERVICIOS');
  readonly sidebarFijo = signal<boolean>(false);
  readonly sidebarHovered = signal<boolean>(false);
  readonly sidebarExpandido = computed<boolean>(() => this.sidebarFijo() || this.sidebarHovered());
  readonly sidebarContraido = computed<boolean>(() => !this.sidebarExpandido());

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
    } else if (usuario.rol === 'COORDINADOR' && this.vistaActual() === 'CONFIGURACION') {
      this.vistaActual.set('PLANIFICADOR');
    }
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
    this.subVistaConfig.set('SERVICIOS');
    this.vistaActual.set('CONFIGURACION');
  }

  irAConfigurarEmpresas(): void {
    if (!this.catalogos.esAdminTh()) {
      this.notificacion.mostrar('ℹ️ La gestión de empresas contratantes está reservada a Talento Humano / Admin.');
      return;
    }
    this.subVistaConfig.set('EMPRESAS');
    this.vistaActual.set('CONFIGURACION');
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
    vista: 'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'AUDITORIA' | 'PORTAL_EMPLEADO' | 'CONFIGURACION'
  ): void {
    if (
      this.catalogos.esColaborador() &&
      (vista === 'PLANIFICADOR' || vista === 'REPORTES' || vista === 'CONFIGURACION' || vista === 'AUDITORIA')
    ) {
      this.notificacion.mostrar(
        '⛔ Acceso restringido: tu perfil de Colaborador solo tiene acceso a Mi Calendario y Solicitudes.'
      );
      return;
    }
    if (this.catalogos.esCoordinador() && vista === 'CONFIGURACION') {
      this.notificacion.mostrar(
        '⛔ Acceso restringido: la configuración global está reservada para Talento Humano / Administración.'
      );
      return;
    }
    this.vistaActual.set(vista);
    if (vista === 'DASHBOARD' || vista === 'AUDITORIA') {
      this.permutasAuditoria.sincronizarAuditoriasDesdePostgres();
      this.permutasAuditoria.sincronizarPermutasDesdePostgres();
    }
    if (!this.sidebarFijo()) {
      this.sidebarHovered.set(false);
    }
  }

  // Controladores de cambio de servicio y periodo
  cambiarServicio(nuevoId: string): void {
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

    const isCtrl = event.ctrlKey || event.metaKey;
    const keyLower = event.key.toLowerCase();

    if (isCtrl && keyLower === 'z' && !event.shiftKey) {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      event.preventDefault();
      this.cuadrante.deshacerUltimaAccion();
      return;
    }

    if (isCtrl && (keyLower === 'y' || (keyLower === 'z' && event.shiftKey))) {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
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
