import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RolUsuarioSso, SesionUsuarioSso } from '../../models';

export type VistaApp = 'PLANIFICADOR' | 'DASHBOARD' | 'REPORTES' | 'AUDITORIA' | 'PORTAL_EMPLEADO' | 'CONFIGURACION';

@Component({
  selector: 'app-sidebar-navegacion',
  standalone: true,
  imports: [CommonModule],
  encapsulation: ViewEncapsulation.None,
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
          <div class="logo-badge" (click)="alternarFijarSidebar.emit()" title="Fijar / liberar menú">🏥</div>
          @if (!sidebarContraido) {
            <div class="brand-text">
              <div class="app-title">RAFA TURNOS</div>
              <div class="app-subtitle">Gestión de Turnos</div>
            </div>
          }
          <button
            class="btn-collapse-side"
            [class.pinned]="sidebarFijo"
            (click)="alternarFijarSidebar.emit()"
            [title]="sidebarFijo ? 'Desanclar menú (Modo flotante automático)' : 'Fijar menú lateral abierto'">
            {{ sidebarFijo ? '📌' : (sidebarContraido ? '»' : '📌') }}
          </button>
        </div>

        <nav class="side-menu">
          @if (!esColaborador) {
            @if (!sidebarContraido) {
              <div class="side-section-label">OPERACIÓN</div>
            }
            <button
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
              class="side-item"
              [class.active]="vistaActual === 'CONFIGURACION'"
              (click)="itemNavegacionClick.emit('CONFIGURACION')"
              title="Configuración (Servicios, Catálogo de Turnos y Festivos)">
              <span class="side-icon">⚙️</span>
              @if (!sidebarContraido) {
                <span class="side-label">Configuración</span>
              }
            </button>
          }
        </nav>

        <div class="side-footer">
          @if (sesionActual; as sesion) {
            <div
              class="side-footer-btn"
              style="cursor: default; background: rgba(14, 165, 233, 0.12); border: 1px solid rgba(14, 165, 233, 0.3);"
              [title]="sesion.nombre + ' • ' + etiquetaRol(sesion.rol) + ' • C.C. ' + sesion.documento">
              <span class="side-icon">🔐</span>
              @if (!sidebarContraido) {
                <div style="display: flex; flex-direction: column; line-height: 1.2; overflow: hidden;">
                  <strong style="font-size: 11px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">{{ sesion.nombre }}</strong>
                  <span style="font-size: 10px; opacity: 0.85;">{{ etiquetaRol(sesion.rol) }}</span>
                </div>
              }
            </div>
          }
          <button
            class="side-footer-btn"
            (click)="abrirModalIcal.emit()"
            title="Vincular calendario con el teléfono">
            <span class="side-icon">📲</span>
            @if (!sidebarContraido) {
              <span>Vincular al Celular</span>
            }
          </button>

          <a
            class="side-footer-btn intranet-link"
            href="javascript:void(0)"
            (click)="notificarIntranet.emit()"
            title="Volver a la Intranet">
            <span class="side-icon">⬅</span>
            @if (!sidebarContraido) {
              <span>Volver a la Intranet</span>
            }
          </a>
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
