import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { RolUsuarioSso, SesionUsuarioSso } from '../../models';

export type VistaApp =
  | 'PLANIFICADOR'
  | 'DASHBOARD'
  | 'REPORTES'
  | 'AUDITORIA'
  | 'PORTAL_EMPLEADO'
  | 'GESTION_SERVICIOS'
  | 'GESTION_PERSONAL'
  | 'GESTION_TURNOS'
  | 'GESTION_EMPRESAS'
  | 'GESTION_FESTIVOS';

@Component({
  selector: 'app-sidebar-navegacion',
  standalone: true,
  imports: [],
  styleUrl: './sidebar-navegacion.component.css',
  template: `
    <div class="side-nav-rail" [class.is-pinned]="sidebarFijo">
      <aside
        class="side-nav"
        [class.collapsed]="sidebarContraido"
        [class.is-floating]="!sidebarFijo && sidebarHovered"
        [class.is-pinned]="sidebarFijo"
        (mouseenter)="sidebarMouseEnter.emit()"
        (mouseleave)="sidebarMouseLeave.emit()">
        <div class="side-brand">
          <button
            type="button"
            class="logo-badge"
            aria-label="Fijar o desanclar menú lateral"
            (click)="alternarFijarSidebar.emit()"
            title="ESE Hospital San Rafael Yolombó">
            <img src="assets/logo-hospital-yolombo.jpg" alt="Logo Hospital San Rafael Yolombó" class="logo-yolombo-img" />
          </button>
          @if (!sidebarContraido) {
            <div class="brand-text">
              <div class="app-title">HOSPITAL SAN RAFAEL</div>
              <div class="app-subtitle">YOLOMBÓ <span class="badge-sello-vida">• Turnos</span></div>
            </div>
          }
          <button
            type="button"
            class="btn-collapse-side"
            [class.pinned]="sidebarFijo"
            [attr.aria-label]="sidebarFijo ? 'Desanclar menú lateral' : 'Fijar menú lateral abierto'"
            (click)="alternarFijarSidebar.emit()"
            [title]="sidebarFijo ? 'Desanclar menú (Modo flotante automático)' : 'Fijar menú lateral abierto'">
            {{ sidebarFijo ? '📌' : (sidebarContraido ? '»' : '📌') }}
          </button>
        </div>

        <nav class="side-menu" aria-label="Menú principal">
          @if (!esColaborador) {
            @if (!sidebarContraido) {
              <div class="side-section-label">OPERACIÓN</div>
            }
            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'PLANIFICADOR'"
              (click)="itemNavegacionClick.emit('PLANIFICADOR')"
              title="Cuadro de Turnos">
              <span class="side-icon">📅</span>
              @if (!sidebarContraido) {
                <span class="side-label">Cuadro de Turnos</span>
              }
            </button>
          }

          <button
            type="button"
            class="side-item"
            [class.active]="vistaActual === 'DASHBOARD'"
            (click)="itemNavegacionClick.emit('DASHBOARD')"
            title="Cambios y Solicitudes de Permuta">
            <span class="side-icon">🔄</span>
            @if (!sidebarContraido) {
              <span class="side-label">Cambios y Solicitudes</span>
            }
            @if (notificacionesSolicitudesCount > 0) {
              <span class="pill-count">{{ notificacionesSolicitudesCount }}</span>
            }
          </button>

          @if (!esColaborador) {
            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'REPORTES'"
              (click)="itemNavegacionClick.emit('REPORTES')"
              title="Nómina y Reportes">
              <span class="side-icon">📊</span>
              @if (!sidebarContraido) {
                <span class="side-label">Nómina y Reportes</span>
              }
            </button>

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'AUDITORIA'"
              (click)="itemNavegacionClick.emit('AUDITORIA')"
              title="Auditoría y Trazabilidad Médico-Legal">
              <span class="side-icon">🛡️</span>
              @if (!sidebarContraido) {
                <span class="side-label">Auditoría</span>
              }
            </button>
          }

          @if (!sidebarContraido) {
            <div class="side-section-label">MI ESPACIO</div>
          } @else {
            <div class="side-divider"></div>
          }

          <button
            type="button"
            class="side-item"
            [class.active]="vistaActual === 'PORTAL_EMPLEADO'"
            (click)="itemNavegacionClick.emit('PORTAL_EMPLEADO')"
            title="Mi Calendario">
            <span class="side-icon">👩‍⚕️</span>
            @if (!sidebarContraido) {
              <span class="side-label">Mi Calendario</span>
            }
            @if (propuestasRecibidasCount > 0) {
              <span class="pill-count">{{ propuestasRecibidasCount }}</span>
            }
          </button>

          @if (esAdminTh) {
            @if (!sidebarContraido) {
              <div class="side-section-label">GESTIÓN</div>
            } @else {
              <div class="side-divider"></div>
            }

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'GESTION_SERVICIOS'"
              (click)="itemNavegacionClick.emit('GESTION_SERVICIOS')"
              title="Gestión de Servicios (Unidades, metas, personal y apoyos)">
              <span class="side-icon">🏥</span>
              @if (!sidebarContraido) {
                <span class="side-label">Gestión de Servicios</span>
              }
            </button>

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'GESTION_PERSONAL'"
              (click)="itemNavegacionClick.emit('GESTION_PERSONAL')"
              title="Gestión de Personal (Nómina, traslados y jornadas)">
              <span class="side-icon">🧑‍⚕️</span>
              @if (!sidebarContraido) {
                <span class="side-label">Gestión de Personal</span>
              }
            </button>

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'GESTION_TURNOS'"
              (click)="itemNavegacionClick.emit('GESTION_TURNOS')"
              title="Gestión de Turnos (Códigos, horarios, descansos y banco de horas)">
              <span class="side-icon">🎨</span>
              @if (!sidebarContraido) {
                <span class="side-label">Gestión de Turnos</span>
              }
            </button>

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'GESTION_EMPRESAS'"
              (click)="itemNavegacionClick.emit('GESTION_EMPRESAS')"
              title="Gestión de Empresas (Empresas contratantes y regímenes CST/1042)">
              <span class="side-icon">🏢</span>
              @if (!sidebarContraido) {
                <span class="side-label">Gestión de Empresas</span>
              }
              @if (empresasPendientesCount > 0) {
                <span
                  class="pill-count pill-warn"
                  [title]="empresasPendientesCount + ' empresa(s) contratante(s) pendiente(s) por confirmar reglas'">
                  {{ empresasPendientesCount }}
                </span>
              }
            </button>

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'GESTION_FESTIVOS'"
              (click)="itemNavegacionClick.emit('GESTION_FESTIVOS')"
              title="Festivos y Días Cívicos">
              <span class="side-icon">🇨🇴</span>
              @if (!sidebarContraido) {
                <span class="side-label">Festivos y Días Cívicos</span>
              }
            </button>
          }
        </nav>

        <div class="side-footer">
          @if (sesionActual; as sesion) {
            <div
              class="side-footer-btn side-session-box"
              [title]="sesion.nombre + ' • ' + etiquetaRol(sesion.rol) + ' • C.C. ' + sesion.documento">
              <span class="side-icon">🔐</span>
              @if (!sidebarContraido) {
                <div class="side-session-meta">
                  <strong class="side-session-name">{{ sesion.nombre }}</strong>
                  <span class="side-session-role">{{ etiquetaRol(sesion.rol) }}</span>
                </div>
              }
            </div>
          }
          <button
            type="button"
            class="side-footer-btn"
            (click)="abrirModalIcal.emit()"
            title="Vincular calendario con el teléfono">
            <span class="side-icon">📲</span>
            @if (!sidebarContraido) {
              <span>Vincular al Celular</span>
            }
          </button>

          <button
            type="button"
            class="side-footer-btn intranet-link"
            (click)="notificarIntranet.emit()"
            title="Volver a la Intranet">
            <span class="side-icon">⬅</span>
            @if (!sidebarContraido) {
              <span>Volver a la Intranet</span>
            }
          </button>
        </div>
      </aside>
    </div>

    <!-- BARRA DE NAVEGACIÓN INFERIOR (BOTTOM NAV BAR) PARA MÓVIL (<= 768px) -->
    <nav class="bottom-nav-bar" aria-label="Navegación móvil inferior">
      @if (esColaborador) {
        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="vistaActual === 'PORTAL_EMPLEADO' && !mostrarDrawerMas()"
          (click)="navegarEnMovil('PORTAL_EMPLEADO')"
          title="Ver mi calendario de turnos">
          <span class="bottom-icon">👩‍⚕️</span>
          <span class="bottom-label">Mi Turno</span>
          @if (propuestasRecibidasCount > 0) {
            <span class="bottom-badge" title="Propuestas de cambio recibidas">{{ propuestasRecibidasCount }}</span>
          }
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="vistaActual === 'DASHBOARD' && !mostrarDrawerMas()"
          (click)="navegarEnMovil('DASHBOARD')"
          title="Solicitudes y permutas">
          <span class="bottom-icon">🔄</span>
          <span class="bottom-label">Permutas</span>
          @if (notificacionesSolicitudesCount > 0) {
            <span class="bottom-badge" title="Alertas de solicitudes">{{ notificacionesSolicitudesCount }}</span>
          }
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          (click)="abrirModalIcalDesdeMovil()"
          title="Sincronizar calendario con Google / iPhone">
          <span class="bottom-icon">📲</span>
          <span class="bottom-label">Celular</span>
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="mostrarDrawerMas()"
          (click)="alternarDrawerMas()"
          title="Más opciones y menú">
          <span class="bottom-icon">☰</span>
          <span class="bottom-label">Más</span>
        </button>
      } @else {
        <!-- Coordinador o Administrador TH en móvil -->
        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="vistaActual === 'PLANIFICADOR' && !mostrarDrawerMas()"
          (click)="navegarEnMovil('PLANIFICADOR')"
          title="Cuadro de turnos">
          <span class="bottom-icon">📅</span>
          <span class="bottom-label">Turnos</span>
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="vistaActual === 'DASHBOARD' && !mostrarDrawerMas()"
          (click)="navegarEnMovil('DASHBOARD')"
          title="Permutas y solicitudes">
          <span class="bottom-icon">🔄</span>
          <span class="bottom-label">Permutas</span>
          @if (notificacionesSolicitudesCount > 0) {
            <span class="bottom-badge">{{ notificacionesSolicitudesCount }}</span>
          }
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="vistaActual === 'REPORTES' && !mostrarDrawerMas()"
          (click)="navegarEnMovil('REPORTES')"
          title="Reportes y nómina">
          <span class="bottom-icon">📊</span>
          <span class="bottom-label">Nómina</span>
        </button>

        <button
          type="button"
          class="bottom-nav-item"
          [class.active]="mostrarDrawerMas()"
          (click)="alternarDrawerMas()"
          title="Menú ampliado">
          <span class="bottom-icon">☰</span>
          <span class="bottom-label">Más</span>
          @if (empresasPendientesCount > 0 || propuestasRecibidasCount > 0) {
            <span class="bottom-badge bottom-badge-warn">!</span>
          }
        </button>
      }
    </nav>

    <!-- PANEL DESLIZANTE INFERIOR / CAJÓN "MÁS" (BOTTOM SHEET DRAWER) -->
    @if (mostrarDrawerMas()) {
      <div class="mobile-more-backdrop" (click)="cerrarDrawerMas()" aria-hidden="true"></div>
      <aside class="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="Menú ampliado">
        <div class="mobile-sheet-handle-bar" (click)="cerrarDrawerMas()">
          <div class="mobile-sheet-handle"></div>
        </div>

        <div class="mobile-sheet-header">
          <div class="mobile-sheet-brand">
            <img src="assets/logo-hospital-yolombo.jpg" alt="Logo Hospital San Rafael Yolombó" class="mobile-sheet-logo" />
            <div>
              <div class="mobile-sheet-title">Hospital San Rafael Yolombó</div>
              <div class="mobile-sheet-sub">Rafa Turnos • Sello de Vida</div>
            </div>
          </div>
          <button type="button" class="btn-close-sheet" (click)="cerrarDrawerMas()" aria-label="Cerrar menú">✕</button>
        </div>

        @if (sesionActual; as sesion) {
          <div class="mobile-sheet-user-card">
            <span class="mobile-user-icon">🔐</span>
            <div class="mobile-user-info">
              <strong class="mobile-user-name">{{ sesion.nombre }}</strong>
              <span class="mobile-user-role">{{ etiquetaRol(sesion.rol) }} • C.C. {{ sesion.documento }}</span>
            </div>
          </div>
        }

        <div class="mobile-sheet-menu">
          <div class="mobile-menu-section-title">MI ESPACIO</div>
          <button
            type="button"
            class="mobile-menu-item"
            [class.active]="vistaActual === 'PORTAL_EMPLEADO'"
            (click)="navegarEnMovil('PORTAL_EMPLEADO')">
            <span class="menu-icon">👩‍⚕️</span>
            <span>Mi Calendario Personal</span>
            @if (propuestasRecibidasCount > 0) {
              <span class="pill-count">{{ propuestasRecibidasCount }}</span>
            }
          </button>

          <button
            type="button"
            class="mobile-menu-item"
            [class.active]="vistaActual === 'DASHBOARD'"
            (click)="navegarEnMovil('DASHBOARD')">
            <span class="menu-icon">🔄</span>
            <span>Cambios y Solicitudes de Permuta</span>
            @if (notificacionesSolicitudesCount > 0) {
              <span class="pill-count">{{ notificacionesSolicitudesCount }}</span>
            }
          </button>

          @if (!esColaborador) {
            <div class="mobile-menu-section-title">OPERACIÓN</div>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'PLANIFICADOR'"
              (click)="navegarEnMovil('PLANIFICADOR')">
              <span class="menu-icon">📅</span>
              <span>Cuadro de Turnos</span>
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'REPORTES'"
              (click)="navegarEnMovil('REPORTES')">
              <span class="menu-icon">📊</span>
              <span>Nómina y Reportes</span>
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'AUDITORIA'"
              (click)="navegarEnMovil('AUDITORIA')">
              <span class="menu-icon">🛡️</span>
              <span>Auditoría y Trazabilidad</span>
            </button>
          }

          @if (esAdminTh) {
            <div class="mobile-menu-section-title">GESTIÓN Y CONFIGURACIÓN</div>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'GESTION_SERVICIOS'"
              (click)="navegarEnMovil('GESTION_SERVICIOS')">
              <span class="menu-icon">🏥</span>
              <span>Gestión de Servicios</span>
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'GESTION_PERSONAL'"
              (click)="navegarEnMovil('GESTION_PERSONAL')">
              <span class="menu-icon">🧑‍⚕️</span>
              <span>Gestión de Personal</span>
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'GESTION_TURNOS'"
              (click)="navegarEnMovil('GESTION_TURNOS')">
              <span class="menu-icon">🎨</span>
              <span>Gestión de Turnos</span>
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'GESTION_EMPRESAS'"
              (click)="navegarEnMovil('GESTION_EMPRESAS')">
              <span class="menu-icon">🏢</span>
              <span>Gestión de Empresas</span>
              @if (empresasPendientesCount > 0) {
                <span class="pill-count pill-warn">{{ empresasPendientesCount }}</span>
              }
            </button>
            <button
              type="button"
              class="mobile-menu-item"
              [class.active]="vistaActual === 'GESTION_FESTIVOS'"
              (click)="navegarEnMovil('GESTION_FESTIVOS')">
              <span class="menu-icon">🇨🇴</span>
              <span>Festivos y Días Cívicos</span>
            </button>
          }

          <div class="mobile-menu-section-title">UTILIDADES</div>
          <button
            type="button"
            class="mobile-menu-item"
            (click)="abrirModalIcalDesdeMovil()">
            <span class="menu-icon">📲</span>
            <span>Vincular Calendario al Celular</span>
          </button>
          <button
            type="button"
            class="mobile-menu-item mobile-menu-intranet"
            (click)="notificarIntranetDesdeMovil()">
            <span class="menu-icon">⬅️</span>
            <span>Volver a la Intranet Hospitalaria</span>
          </button>
        </div>
      </aside>
    }
  `,
})
export class SidebarNavegacionComponent {
  readonly mostrarDrawerMas = signal(false);

  @Input() sidebarFijo = false;
  @Input() sidebarContraido = true;
  @Input() sidebarHovered = false;
  @Input() vistaActual = 'PLANIFICADOR';
  @Input() esColaborador = false;
  @Input() esAdminTh = false;
  @Input() notificacionesSolicitudesCount = 0;
  @Input() propuestasRecibidasCount = 0;
  @Input() empresasPendientesCount = 0;
  @Input() sesionActual: SesionUsuarioSso | null = null;

  @Output() alternarFijarSidebar = new EventEmitter<void>();
  @Output() sidebarMouseEnter = new EventEmitter<void>();
  @Output() sidebarMouseLeave = new EventEmitter<void>();
  @Output() itemNavegacionClick = new EventEmitter<VistaApp>();
  @Output() abrirModalIcal = new EventEmitter<void>();
  @Output() notificarIntranet = new EventEmitter<void>();

  alternarDrawerMas(): void {
    this.mostrarDrawerMas.update((v) => !v);
  }

  cerrarDrawerMas(): void {
    this.mostrarDrawerMas.set(false);
  }

  navegarEnMovil(vista: VistaApp): void {
    this.mostrarDrawerMas.set(false);
    this.itemNavegacionClick.emit(vista);
  }

  abrirModalIcalDesdeMovil(): void {
    this.mostrarDrawerMas.set(false);
    this.abrirModalIcal.emit();
  }

  notificarIntranetDesdeMovil(): void {
    this.mostrarDrawerMas.set(false);
    this.notificarIntranet.emit();
  }

  etiquetaRol(rol?: RolUsuarioSso): string {
    if (rol === 'ADMIN_TH') return 'Talento Humano / Admin';
    if (rol === 'COORDINADOR') return 'Coordinador de Servicio';
    return 'Colaborador Asistencial';
  }
}
