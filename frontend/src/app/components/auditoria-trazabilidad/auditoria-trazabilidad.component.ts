import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RegistroAuditoria, SesionUsuarioSso, ServicioHospitalario } from '../../models';
import { hoyColombiaIso } from '../../shared/liquidacion-horas';

@Component({
  selector: 'app-auditoria-trazabilidad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './auditoria-trazabilidad.component.css',
  template: `
    <div class="auditoria-layout">
      <!-- CABECERA INSTITUCIONAL DE AUDITORÍA -->
      <div class="auditoria-header-bar">
        <div class="header-main-info">
          <div class="header-icon-wrap" aria-hidden="true">🛡️</div>
          <div>
            <h2>Auditoría y Trazabilidad Médico-Legal</h2>
            <p class="auditoria-header-desc">
              Bitácora inmutable de cambios en cuadrantes publicados, permutas 1-a-1, cierres de nómina y ajustes operativos conforme a la normatividad laboral (CST y Ley 2101).
            </p>
          </div>
        </div>

        <div class="header-action-buttons">
          <button
            type="button"
            class="btn-audit-action btn-refresh"
            (click)="onRefrescar()"
            title="Sincronizar bitácora con PostgreSQL">
            🔄 Sincronizar
          </button>
          <button
            type="button"
            class="btn-audit-action btn-export"
            (click)="exportarCsv()"
            title="Descargar bitácora en formato CSV compatible con Excel">
            📥 Exportar CSV
          </button>
          <button
            type="button"
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

        <div class="kpi-card audit-kpi-permutas">
          <div class="kpi-label">🔄 Permutas Concertadas</div>
          <div class="kpi-value audit-kpi-val-permutas">{{ countPermutas }}</div>
          <div class="kpi-sub">Intercambios 1-a-1 aprobados</div>
        </div>

        <div class="kpi-card audit-kpi-ediciones">
          <div class="kpi-label">✏️ Modificaciones en Publicado</div>
          <div class="kpi-value audit-kpi-val-ediciones">{{ countEdiciones }}</div>
          <div class="kpi-sub">Turnos ajustados post-publicación</div>
        </div>

        <div class="kpi-card audit-kpi-estados">
          <div class="kpi-label">🔒 Cierres y Publicaciones</div>
          <div class="kpi-value audit-kpi-val-estados">{{ countEstados }}</div>
          <div class="kpi-sub">Estados oficiales de cuadrantes</div>
        </div>
      </div>

      <!-- BARRA AVANZADA DE FILTROS Y BÚSQUEDA -->
      <div class="panel-card audit-filters-panel">
        <div class="audit-filters-row">
          <!-- Filtro de Categoría / Tipo de Acción -->
          <div class="filter-group-action">
            <span class="filter-label">Tipo de Evento:</span>
            <div class="filter-pills">
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'TODAS'"
                (click)="onCambiarTipoAccion('TODAS')">
                Todos ({{ bitacoraAuditoria.length }})
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'PERMUTA'"
                (click)="onCambiarTipoAccion('PERMUTA')">
                🔄 Permutas
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'EDICION_TURNO'"
                (click)="onCambiarTipoAccion('EDICION_TURNO')">
                ✏️ Turnos Manuales
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'ESTADO_CUADRANTE'"
                (click)="onCambiarTipoAccion('ESTADO_CUADRANTE')">
                🔒 Estados Oficiales
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'ACCION_MASIVA'"
                (click)="onCambiarTipoAccion('ACCION_MASIVA')">
                ⚡ Ajustes Masivos
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'NOTA_CELDA'"
                (click)="onCambiarTipoAccion('NOTA_CELDA')">
                💬 Notas
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'FIJACION_CELDA'"
                (click)="onCambiarTipoAccion('FIJACION_CELDA')">
                📌 Fijaciones
              </button>
              <button
                type="button"
                class="pill-tab"
                [class.active]="tipoAccionFiltro === 'APOYO_SERVICIO'"
                (click)="onCambiarTipoAccion('APOYO_SERVICIO')">
                🔄 Apoyos
              </button>
            </div>
          </div>

          <!-- Filtro por Servicio Asistencial -->
          <div class="filter-control-box">
            <label for="audit-servicio-select" class="filter-label">Servicio Hospitalario:</label>
            <select
              id="audit-servicio-select"
              [(ngModel)]="servicioFiltro"
              (ngModelChange)="onCambiarServicioFiltro($event)"
              class="filter-select">
              @if (esAdminTh || servicios.length > 1) {
                <option value="TODOS">
                  {{ esAdminTh ? '🏥 Todos los Servicios' : '🏥 Todos mis Servicios Asignados' }}
                </option>
              }
              @for (srv of servicios; track srv.id) {
                <option [value]="srv.id">{{ srv.nombre }} ({{ srv.codigo }})</option>
              }
            </select>
          </div>

          <!-- Filtro por Rango de Fechas -->
          <div class="filter-control-box filter-dates-box">
            <label for="audit-fecha-desde" class="filter-label">Rango de Fechas (Desde - Hasta):</label>
            <div class="dates-inputs-wrap">
              <input
                id="audit-fecha-desde"
                type="date"
                aria-label="Fecha inicial de auditoría"
                [(ngModel)]="fechaDesde"
                (ngModelChange)="onCambiarRangoFechas()"
                class="filter-date-input"
                title="Fecha inicial de auditoría" />
              <span class="audit-date-arrow" aria-hidden="true">→</span>
              <input
                id="audit-fecha-hasta"
                type="date"
                aria-label="Fecha final de auditoría"
                [(ngModel)]="fechaHasta"
                (ngModelChange)="onCambiarRangoFechas()"
                class="filter-date-input"
                title="Fecha final de auditoría" />
              @if (fechaDesde || fechaHasta) {
                <button
                  type="button"
                  aria-label="Limpiar rango de fechas"
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
            <span class="search-icon-decor" aria-hidden="true">🔍</span>
            <input
              type="text"
              aria-label="Buscar en bitácora de auditoría"
              [(ngModel)]="busquedaTexto"
              placeholder="Buscar colaborador, cédula, supervisor/actor, turno (M8, T8...), o detalle del motivo..."
              class="filter-search-input" />
            @if (busquedaTexto) {
              <button
                type="button"
                aria-label="Limpiar búsqueda de auditoría"
                class="btn-clear-search"
                (click)="busquedaTexto = ''">
                ✕
              </button>
            }
          </div>
          @if (esAdminTh || esCoordinador) {
            <label class="audit-borrador-toggle" title="Por defecto se muestra trazabilidad oficial post-publicación (y desglose completo solo al activarlo o desde cada celda).">
              <input
                type="checkbox"
                [(ngModel)]="incluirBorrador"
                (ngModelChange)="onCambiarIncluirBorrador()" />
              <span>Incluir fase Borrador y desglose</span>
            </label>
          }
          <div class="results-counter">
            Mostrando <strong>{{ auditoriasFiltradas.length }}</strong> de <strong>{{ bitacoraAuditoria.length }}</strong> eventos
          </div>
        </div>
      </div>

      <!-- TABLA PRINCIPAL DE AUDITORÍA Y TRAZABILIDAD -->
      <div class="panel-card audit-table-card">
        <div class="panel-header audit-table-header">
          <h3>📋 Registro Cronológico de Operaciones</h3>
          <span class="badge-audit-status">🛡️ Trazabilidad Legal Inmutable (PostgreSQL)</span>
        </div>

        <div class="audit-table-wrap">
          <table class="data-table audit-data-table">
            <thead>
              <tr>
                <th class="audit-th-fecha">Fecha / Hora</th>
                <th class="audit-th-tipo">Tipo de Acción</th>
                <th class="audit-th-actor">Realizado por</th>
                <th class="audit-th-colab">Colaborador Afectado</th>
                <th class="audit-th-srv">Servicio</th>
                <th class="audit-th-dia">Día / Fecha</th>
                <th class="audit-th-trans">Transición</th>
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
                  <td class="audit-td-center">
                    @if (log.dia > 0) {
                      <span class="day-chip">Día {{ log.dia }}</span>
                    } @else {
                      <span class="period-chip">Periodo</span>
                    }
                  </td>
                  <td class="audit-td-center">
                    <div class="shift-transition-box">
                      <span class="mini-shift-badge before">{{ log.turnoAnterior || '—' }}</span>
                      <span class="transition-arrow">→</span>
                      <span class="mini-shift-badge after">{{ log.turnoNuevo || '—' }}</span>
                    </div>
                  </td>
                  <td class="justificacion-cell">
                    @if (log.faseCuadrante === 'BORRADOR') {
                      <span class="audit-draft-tag" title="Cambio ocurrido en fase Borrador">Borrador</span>
                    }
                    @if (log.esDetalleLote) {
                      <span class="audit-batch-tag" title="Detalle por celda de operación masiva">Lote</span>
                    }
                    {{ limpiarMotivoVisual(log.motivo) }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="text-muted empty-audit-box">
                    @if (busquedaTexto || tipoAccionFiltro !== 'TODAS' || servicioFiltro !== 'TODOS' || fechaDesde || fechaHasta || incluirBorrador) {
                      <div>
                        <div class="audit-empty-icon" aria-hidden="true">🔍</div>
                        <strong>No se encontraron registros de auditoría</strong> con los filtros actuales.
                        <div class="audit-empty-actions">
                          <button type="button" class="btn-clear-all-filters" (click)="resetearFiltros()">
                            Limpiar todos los filtros
                          </button>
                        </div>
                      </div>
                    } @else {
                      <div>
                        <div class="audit-empty-icon" aria-hidden="true">🛡️</div>
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
export class AuditoriaTrazabilidadComponent implements OnChanges {
  @Input() bitacoraAuditoria: RegistroAuditoria[] = [];
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() servicioActualId = 'srv-urg';
  @Input() esAdminTh = false;
  @Input() esCoordinador = false;
  @Input() sesionActual: SesionUsuarioSso | null = null;

  @Output() cambiarFiltrosServidor = new EventEmitter<{
    servicioId: string;
    tipoAccion: string;
    fechaInicio: string;
    fechaFin: string;
    incluirBorrador: boolean;
  }>();
  @Output() avisoToast = new EventEmitter<string>();

  tipoAccionFiltro:
    | 'TODAS'
    | 'PERMUTA'
    | 'EDICION_TURNO'
    | 'ESTADO_CUADRANTE'
    | 'ACCION_MASIVA'
    | 'NOTA_CELDA'
    | 'FIJACION_CELDA'
    | 'APOYO_SERVICIO'
    | 'NOVEDAD_INTRANET' = 'TODAS';
  servicioFiltro = 'TODOS';
  fechaDesde = '';
  fechaHasta = '';
  busquedaTexto = '';
  incluirBorrador = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['servicios'] || changes['esAdminTh']) {
      if (!this.esAdminTh && this.servicios.length === 1) {
        this.servicioFiltro = this.servicios[0].id;
      } else if (
        this.servicioFiltro !== 'TODOS' &&
        this.servicios.length > 0 &&
        !this.servicios.some((s) => s.id === this.servicioFiltro)
      ) {
        this.servicioFiltro = this.esAdminTh || this.servicios.length > 1 ? 'TODOS' : this.servicios[0].id;
      }
    }
  }

  private emitirFiltros(): void {
    this.cambiarFiltrosServidor.emit({
      servicioId: this.servicioFiltro,
      tipoAccion: this.tipoAccionFiltro,
      fechaInicio: this.fechaDesde,
      fechaFin: this.fechaHasta,
      incluirBorrador: this.incluirBorrador,
    });
  }

  onRefrescar(): void {
    this.emitirFiltros();
  }

  onCambiarIncluirBorrador(): void {
    this.emitirFiltros();
  }

  onCambiarServicioFiltro(srvId: string): void {
    this.servicioFiltro = srvId;
    this.emitirFiltros();
  }

  onCambiarTipoAccion(
    tipo:
      | 'TODAS'
      | 'PERMUTA'
      | 'EDICION_TURNO'
      | 'ESTADO_CUADRANTE'
      | 'ACCION_MASIVA'
      | 'NOTA_CELDA'
      | 'FIJACION_CELDA'
      | 'APOYO_SERVICIO'
      | 'NOVEDAD_INTRANET'
  ): void {
    this.tipoAccionFiltro = tipo;
    this.emitirFiltros();
  }

  onCambiarRangoFechas(): void {
    this.emitirFiltros();
  }

  limpiarRangoFechas(): void {
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.emitirFiltros();
  }

  resetearFiltros(): void {
    this.tipoAccionFiltro = 'TODAS';
    this.servicioFiltro = !this.esAdminTh && this.servicios.length === 1 ? this.servicios[0].id : 'TODOS';
    this.fechaDesde = '';
    this.fechaHasta = '';
    this.busquedaTexto = '';
    this.incluirBorrador = false;
    this.emitirFiltros();
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
    const dDesde = this.fechaDesde ? new Date(`${this.fechaDesde}T00:00:00-05:00`).getTime() : null;
    const dHasta = this.fechaHasta ? new Date(`${this.fechaHasta}T23:59:59.999-05:00`).getTime() : null;

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
        if (tsLog === null || Number.isNaN(tsLog)) return false;
        if (dDesde !== null && tsLog < dDesde) return false;
        if (dHasta !== null && tsLog > dHasta) return false;
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
      case 'NOTA_CELDA':
        return '💬 Nota de Celda';
      case 'FIJACION_CELDA':
        return '📌 Fijación Celda';
      case 'APOYO_SERVICIO':
        return '🔄 Apoyo 1 Día';
      case 'NOVEDAD_INTRANET':
        return '🏥 Novedad Intranet';
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
      case 'NOTA_CELDA':
        return 'badge-nota';
      case 'FIJACION_CELDA':
        return 'badge-fijacion';
      case 'APOYO_SERVICIO':
        return 'badge-apoyo';
      case 'NOVEDAD_INTRANET':
        return 'badge-intranet';
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
      this.avisoToast.emit('ℹ️ No hay registros de auditoría para exportar con los filtros seleccionados.');
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
    lineas.push(escapeCsv('E.S.E. HOSPITAL SAN RAFAEL DE YOLOMBÓ — RAFA TURNOS HOSPITALARIOS'));
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
    const timestampArchivo = hoyColombiaIso();
    link.setAttribute('href', url);
    link.setAttribute('download', `Auditoria_Turnos_${timestampArchivo}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  imprimirActa(): void {
    document.body.classList.add('printing-audit');
    const cleanup = () => {
      document.body.classList.remove('printing-audit');
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => window.print(), 20);
    setTimeout(cleanup, 1500);
  }
}
