import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RolUsuarioSso, SesionUsuarioSso } from '../../models';

export type VistaApp = 'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'AUDITORIA' | 'PORTAL_EMPLEADO' | 'CONFIGURACION';

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
            title="Solicitudes de Permuta">
            <span class="side-icon">🔄</span>
            @if (!sidebarContraido) {
              <span class="side-label">Solicitudes</span>
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
              title="Reportes y Analítica">
              <span class="side-icon">📊</span>
              @if (!sidebarContraido) {
                <span class="side-label">Reportes</span>
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
            <div class="side-section-label">COLABORADOR</div>
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
              <div class="side-section-label">CONFIGURACIÓN</div>
            } @else {
              <div class="side-divider"></div>
            }

            <button
              type="button"
              class="side-item"
              [class.active]="vistaActual === 'CONFIGURACION'"
              (click)="itemNavegacionClick.emit('CONFIGURACION')"
              title="Configuración (Empresas, Servicios, Catálogo de Turnos y Festivos)">
              <span class="side-icon">⚙️</span>
              @if (!sidebarContraido) {
                <span class="side-label">Configuración</span>
              }
              @if (empresasPendientesCount > 0) {
                <span
                  class="pill-count pill-warn"
                  [title]="empresasPendientesCount + ' empresa(s) contratante(s) pendiente(s) por confirmar reglas'">
                  {{ empresasPendientesCount }}
                </span>
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
  `,
})
export class SidebarNavegacionComponent {
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

  etiquetaRol(rol?: RolUsuarioSso): string {
    if (rol === 'ADMIN_TH') return 'Talento Humano / Admin';
    if (rol === 'COORDINADOR') return 'Coordinador de Servicio';
    return 'Colaborador Asistencial';
  }
}
