import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistroAuditoria, SesionUsuarioSso, ServicioHospitalario } from '../../models';

@Component({
  selector: 'app-auditoria-trazabilidad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="auditoria-layout">
      <!-- CABECERA INSTITUCIONAL DE AUDITORÍA -->
      <div class="auditoria-header-bar">
        <div class="header-main-info">
          <div class="header-icon-wrap">🛡️</div>
          <div>
            <h2>Auditoría y Trazabilidad Médico-Legal</h2>
            <p class="auditoria-header-desc">
              Bitácora inmutable de cambios en cuadrantes publicados, permutas 1-a-1, cierres de nómina y ajustes operativos conforme a la normatividad laboral (CST y Ley 2101).
            </p>
          </div>
        </div>

        <div class="header-action-buttons">
          <button
            class="btn-audit-action btn-refresh"
            (click)="onRefrescar()"
            title="Sincronizar bitácora con PostgreSQL">
            🔄 Sincronizar
          </button>
          <button
            class="btn-audit-action btn-export"
            (click)="exportarCsv()"
            title="Descargar bitácora en formato CSV compatible con Excel">
            📥 Exportar CSV
          </button>
          <button
            class="btn-audit-action btn-print"
            (click)="imprimirActa()"
            title="Imprimir acta oficial médico-legal">
            🖨️ Imprimir Acta
          </button>
        </div>
      </div>

      <!-- TARJETAS DE INDICADORES FORENSES (KPIs) -->
      <div class="kpi-grid audit-kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Total Movimientos Registrados</div>
          <div class="kpi-value text-audit">{{ auditoriasFiltradas.length }}</div>
          <div class="kpi-sub">Eventos en el alcance actual</div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #0284c7;">
          <div class="kpi-label">🔄 Permutas Concertadas</div>
          <div class="kpi-value" style="color: #0369a1;">{{ countPermutas }}</div>
          <div class="kpi-sub">Intercambios 1-a-1 aprobados</div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #d97706;">
          <div class="kpi-label">✏️ Modificaciones en Publicado</div>
          <div class="kpi-value" style="color: #b45309;">{{ countEdiciones }}</div>
          <div class="kpi-sub">Turnos ajustados post-publicación</div>
        </div>

        <div class="kpi-card" style="border-left: 4px solid #7c3aed;">
          <div class="kpi-label">🔒 Cierres y Publicaciones</div>
          <div class="kpi-value" style="color: #6d28d9;">{{ countEstados }}</div>
          <div class="kpi-sub">Estados oficiales de cuadrantes</div>
        </div>
      </div>

      <!-- BARRA AVANZADA DE FILTROS Y BÚSQUEDA -->
      <div class="panel-card audit-filters-panel">
        <div class="audit-filters-row">
          <!-- Filtro de Categoría / Tipo de Acción -->
          <div class="filter-group-action">
            <label class="filter-label">Tipo de Evento:</label>
            <div class="filter-pills">
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'TODAS'"
                (click)="tipoAccionFiltro = 'TODAS'">
                Todos ({{ bitacoraAuditoria.length }})
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'PERMUTA'"
                (click)="tipoAccionFiltro = 'PERMUTA'">
                🔄 Permutas
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'EDICION_TURNO'"
                (click)="tipoAccionFiltro = 'EDICION_TURNO'">
                ✏️ Turnos Manuales
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'ESTADO_CUADRANTE'"
                (click)="tipoAccionFiltro = 'ESTADO_CUADRANTE'">
                🔒 Estados Oficiales
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'ACCION_MASIVA'"
                (click)="tipoAccionFiltro = 'ACCION_MASIVA'">
                ⚡ Ajustes Masivos
              </button>
            </div>
          </div>

          <!-- Filtro por Servicio Asistencial -->
          <div class="filter-control-box">
            <label class="filter-label">Servicio Hospitalario:</label>
            <select
              [(ngModel)]="servicioFiltro"
              (ngModelChange)="onCambiarServicioFiltro($event)"
              class="filter-select">
              <option value="TODOS">🏥 Todos los Servicios</option>
              @for (srv of servicios; track srv.id) {
                <option [value]="srv.id">{{ srv.nombre }} ({{ srv.codigo }})</option>
              }
            </select>
          </div>

          <!-- Filtro por Rango de Fechas -->
          <div class="filter-control-box filter-dates-box">
            <label class="filter-label">Rango de Fechas (Desde - Hasta):</label>
            <div class="dates-inputs-wrap">
              <input
                type="date"
                [(ngModel)]="fechaDesde"
                class="filter-date-input"
                title="Fecha inicial de auditoría" />
              <span style="color: #94a3b8;">→</span>
              <input
                type="date"
                [(ngModel)]="fechaHasta"
                class="filter-date-input"
                title="Fecha final de auditoría" />
              @if (fechaDesde || fechaHasta) {
                <button
                  type="button"
                  class="btn-clear-date"
                  (click)="limpiarRangoFechas()"
                  title="Limpiar rango de fechas">
                  ✕
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Buscador de Texto en Tiempo Real -->
        <div class="audit-search-row">
          <div class="search-input-wrap search-input-full">
            <span class="search-icon-decor">🔍</span>
            <input
              type="text"
              [(ngModel)]="busquedaTexto"
              placeholder="Buscar colaborador, cédula, supervisor/actor, turno (M8, T8...), o detalle del motivo..."
              class="filter-search-input" />
            @if (busquedaTexto) {
              <button class="btn-clear-search" (click)="busquedaTexto = ''">✕</button>
            }
          </div>
          <div class="results-counter">
            Mostrando <strong>{{ auditoriasFiltradas.length }}</strong> de <strong>{{ bitacoraAuditoria.length }}</strong> eventos
          </div>
        </div>
      </div>

      <!-- TABLA PRINCIPAL DE AUDITORÍA Y TRAZABILIDAD -->
      <div class="panel-card audit-table-card">
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center;">
          <h3>📋 Registro Cronológico de Operaciones</h3>
          <span class="badge-audit-status">🛡️ Trazabilidad Legal Inmutable (PostgreSQL)</span>
        </div>

        <div class="audit-table-wrap">
          <table class="data-table audit-data-table">
            <thead>
              <tr>
                <th style="width: 155px;">Fecha / Hora</th>
                <th style="width: 130px;">Tipo de Acción</th>
                <th style="width: 170px;">Realizado por</th>
                <th style="width: 200px;">Colaborador Afectado</th>
                <th style="width: 160px;">Servicio</th>
                <th style="width: 90px; text-align: center;">Día / Fecha</th>
                <th style="width: 110px; text-align: center;">Transición</th>
                <th>Motivo / Justificación Legal</th>
              </tr>
            </thead>
            <tbody>
              @for (log of auditoriasFiltradas; track log.id) {
                <tr class="audit-row">
                  <td class="font-mono text-date-time">{{ log.timestamp }}</td>
                  <td>
                    <span class="badge-action-pill" [ngClass]="obtenerClaseTipoAccion(log.tipoAccion)">
                      {{ formatearTipoAccion(log.tipoAccion) }}
                    </span>
                  </td>
                  <td>
                    <strong class="actor-name">{{ log.actor }}</strong>
                  </td>
                  <td>
                    <div class="colab-info-cell">
                      <span class="colab-nombre">{{ log.empleadoNombre }}</span>
                      @if (log.empleadoDocumento) {
                        <span class="colab-doc">C.C. {{ log.empleadoDocumento }}</span>
                      }
                    </div>
                  </td>
                  <td>
                    <span class="srv-chip">{{ log.servicioNombre }}</span>
                  </td>
                  <td style="text-align: center;">
                    @if (log.dia > 0) {
                      <span class="day-chip">Día {{ log.dia }}</span>
                    } @else {
                      <span class="period-chip">Periodo</span>
                    }
                  </td>
                  <td style="text-align: center;">
                    <div class="shift-transition-box">
                      <span class="mini-shift-badge before">{{ log.turnoAnterior || '—' }}</span>
                      <span class="transition-arrow">→</span>
                      <span class="mini-shift-badge after">{{ log.turnoNuevo || '—' }}</span>
                    </div>
                  </td>
                  <td class="justificacion-cell">
                    {{ limpiarMotivoVisual(log.motivo) }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="text-muted empty-audit-box">
                    @if (busquedaTexto || tipoAccionFiltro !== 'TODAS' || servicioFiltro !== 'TODOS' || fechaDesde || fechaHasta) {
                      <div>
                        <div style="font-size: 28px; margin-bottom: 6px;">🔍</div>
                        <strong>No se encontraron registros de auditoría</strong> con los filtros actuales.
                        <div style="margin-top: 6px;">
                          <button class="btn-clear-all-filters" (click)="resetearFiltros()">Limpiar todos los filtros</button>
                        </div>
                      </div>
                    } @else {
                      <div>
                        <div style="font-size: 28px; margin-bottom: 6px;">🛡️</div>
                        <strong>No hay movimientos de auditoría registrados</strong> para el criterio seleccionado.
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
})
export class AuditoriaTrazabilidadComponent {
  @Input() bitacoraAuditoria: RegistroAuditoria[] = [];
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() servicioActualId = 'srv-urg';
  @Input() esAdminTh = false;
  @Input() esCoordinador = false;
  @Input() sesionActual: SesionUsuarioSso | null = null;

  @Output() refrescarBitacora = new EventEmitter<string | void>();
  @Output() filtrarServicio = new EventEmitter<string>();

  tipoAccionFiltro: 'TODAS' | 'PERMUTA' | 'EDICION_TURNO' | 'ESTADO_CUADRANTE' | 'ACCION_MASIVA' = 'TODAS';
  servicioFiltro = 'TODOS';
  fechaDesde = '';
  fechaHasta = '';
  busquedaTexto = '';

  onRefrescar(): void {
    this.refrescarBitacora.emit(this.servicioFiltro);
  }

  onCambiarServicioFiltro(srvId: string): void {
    this.servicioFiltro = srvId;
    this.filtrarServicio.emit(srvId);
    this.refrescarBitacora.emit(srvId);
  }

  limpiarRangoFechas(): void {
    this.fechaDesde = '';
    this.fechaHasta = '';
  }

  resetearFiltros(): void {
    this.tipoAccionFiltro = 'TODAS';
    this.servicioFiltro = 'TODOS';
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.busquedaTexto = '';
    this.refrescarBitacora.emit('TODOS');
  }

  get countPermutas(): number {
    return this.bitacoraAuditoria.filter(
      (a) => a.tipoAccion === 'PERMUTA' || (a.motivo && a.motivo.toLowerCase().includes('permuta'))
    ).length;
  }

  get countEdiciones(): number {
    return this.bitacoraAuditoria.filter(
      (a) => a.tipoAccion === 'EDICION_TURNO' || (!a.tipoAccion && a.dia > 0)
    ).length;
  }

  get countEstados(): number {
    return this.bitacoraAuditoria.filter((a) => a.tipoAccion === 'ESTADO_CUADRANTE').length;
  }

  get countMasivas(): number {
    return this.bitacoraAuditoria.filter((a) => a.tipoAccion === 'ACCION_MASIVA').length;
  }

  get auditoriasFiltradas(): RegistroAuditoria[] {
    const q = this.busquedaTexto.trim().toLowerCase();
    const srv = this.servicioFiltro;
    const tipo = this.tipoAccionFiltro;
    const dDesde = this.fechaDesde ? new Date(`${this.fechaDesde}T00:00:00Z`).getTime() : null;
    const dHasta = this.fechaHasta ? new Date(`${this.fechaHasta}T23:59:59Z`).getTime() : null;

    return this.bitacoraAuditoria.filter((log) => {
      // 1. Filtro por Tipo de Acción
      if (tipo !== 'TODAS') {
        const accionLog = log.tipoAccion || (log.motivo?.toLowerCase().includes('permuta') ? 'PERMUTA' : 'EDICION_TURNO');
        if (accionLog !== tipo) return false;
      }

      // 2. Filtro por Servicio
      if (srv !== 'TODOS') {
        const srvObj = this.servicios.find((s) => s.id === srv);
        const matchId = log.servicioId === srv;
        const matchNom = srvObj && log.servicioNombre === srvObj.nombre;
        if (!matchId && !matchNom) return false;
      }

      // 3. Filtro por Rango de Fechas
      if (dDesde !== null || dHasta !== null) {
        const tsLog = log.timestampIso ? new Date(log.timestampIso).getTime() : null;
        if (tsLog !== null) {
          if (dDesde !== null && tsLog < dDesde) return false;
          if (dHasta !== null && tsLog > dHasta) return false;
        }
      }

      // 4. Búsqueda por Texto Libre
      if (q) {
        const colabNom = log.empleadoNombre?.toLowerCase() || '';
        const colabDoc = log.empleadoDocumento?.toLowerCase() || '';
        const actor = log.actor?.toLowerCase() || '';
        const srvNom = log.servicioNombre?.toLowerCase() || '';
        const motivo = log.motivo?.toLowerCase() || '';
        const turnoAnt = String(log.turnoAnterior || '').toLowerCase();
        const turnoNue = String(log.turnoNuevo || '').toLowerCase();
        const dia = String(log.dia);

        const match =
          colabNom.includes(q) ||
          colabDoc.includes(q) ||
          actor.includes(q) ||
          srvNom.includes(q) ||
          motivo.includes(q) ||
          turnoAnt.includes(q) ||
          turnoNue.includes(q) ||
          dia.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }

  formatearTipoAccion(tipo?: string): string {
    switch (tipo) {
      case 'PERMUTA':
        return '🔄 Permuta';
      case 'EDICION_TURNO':
        return '✏️ Modificación';
      case 'ESTADO_CUADRANTE':
        return '🔒 Estado Cuadrante';
      case 'ACCION_MASIVA':
        return '⚡ Ajuste en Bloque';
      default:
        return '✏️ Modificación';
    }
  }

  obtenerClaseTipoAccion(tipo?: string): string {
    switch (tipo) {
      case 'PERMUTA':
        return 'badge-permuta';
      case 'EDICION_TURNO':
        return 'badge-edicion';
      case 'ESTADO_CUADRANTE':
        return 'badge-estado';
      case 'ACCION_MASIVA':
        return 'badge-masiva';
      default:
        return 'badge-edicion';
    }
  }

  limpiarMotivoVisual(motivo?: string): string {
    if (!motivo) return 'Modificación registrada';
    // Remueve de forma definitiva cualquier UUID remanente para presentación humana
    return motivo.replace(/Permuta [0-9a-fA-F\-]{36} aprobada con /g, 'Permuta aprobada con ');
  }

  exportarCsv(): void {
    const datos = this.auditoriasFiltradas;
    if (datos.length === 0) {
      window.alert('No hay registros de auditoría para exportar con los filtros seleccionados.');
      return;
    }

    const fechaGen = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const usuarioGen = this.sesionActual?.nombre || 'Supervisión Asistencial';
    const srvTexto = this.servicioFiltro === 'TODOS' ? 'Todos los Servicios' : (this.servicios.find(s => s.id === this.servicioFiltro)?.nombre || this.servicioFiltro);

    const headers = [
      'ID Registro',
      'Fecha y Hora (Bogotá)',
      'Tipo de Acción',
      'Realizado Por',
      'Colaborador Afectado',
      'Documento Cédula',
      'Servicio Asistencial',
      'Día Afectado',
      'Turno Anterior',
      'Turno Nuevo',
      'Motivo / Justificación Legal',
    ];

    const escapeCsv = (str?: any): string => {
      const txt = str === null || str === undefined ? '' : String(str);
      return `"${txt.replace(/"/g, '""')}"`;
    };

    const lineas: string[] = [];
    lineas.push(escapeCsv('HOSPITAL RAFAEL URIBE URIBE — RAFA TURNOS HOSPITALARIOS'));
    lineas.push(escapeCsv('BITÁCORA OFICIAL DE AUDITORÍA Y TRAZABILIDAD MÉDICO-LEGAL'));
    lineas.push(escapeCsv(`Fecha de Emisión: ${fechaGen} | Generado por: ${usuarioGen} | Servicio: ${srvTexto}`));
    lineas.push(''); // Línea en blanco
    lineas.push(headers.map(escapeCsv).join(';'));

    for (const r of datos) {
      lineas.push(
        [
          escapeCsv(r.id),
          escapeCsv(r.timestamp),
          escapeCsv(this.formatearTipoAccion(r.tipoAccion)),
          escapeCsv(r.actor),
          escapeCsv(r.empleadoNombre),
          escapeCsv(r.empleadoDocumento || 'N/A'),
          escapeCsv(r.servicioNombre),
          escapeCsv(r.dia > 0 ? `Día ${r.dia}` : 'Periodo Oficial'),
          escapeCsv(r.turnoAnterior || '—'),
          escapeCsv(r.turnoNuevo || '—'),
          escapeCsv(this.limpiarMotivoVisual(r.motivo)),
        ].join(';')
      );
    }

    const csvContent = '\uFEFF' + lineas.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestampArchivo = new Date().toISOString().slice(0, 10);
    link.setAttribute('href', url);
    link.setAttribute('download', `Auditoria_Turnos_${timestampArchivo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  imprimirActa(): void {
    window.print();
  }
}
