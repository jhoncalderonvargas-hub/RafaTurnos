import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  InfraccionNormativa,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoTurnoConfig,
} from '../../models';

@Component({
  selector: 'app-planificador-cuadrante',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <section class="toolbar-controls">
      <div class="selectors-group">
        <div class="control-item">
          <label>Servicio:</label>
          <select [ngModel]="servicioSeleccionadoId" (ngModelChange)="cambiarServicio.emit($event)">
            @for (srv of serviciosVisibles; track srv.id) {
              <option [value]="srv.id">{{ srv.nombre }}</option>
            }
          </select>
        </div>

        <div class="control-item">
          <label>Mes / Año:</label>
          <select [ngModel]="mesSeleccionado" (ngModelChange)="cambiarMes.emit($event)">
            @for (m of mesesDisponibles; track m.valor) {
              <option [value]="m.valor">{{ m.nombre }} {{ anioSeleccionado }}</option>
            }
          </select>
        </div>

        <div class="control-item">
          <label>Categoría:</label>
          <select [ngModel]="filtroCategoriaActiva" (ngModelChange)="cambiarFiltroCategoria.emit($event)">
            <option value="TODAS">Todas las categorías ({{ categoriasEnServicioActual.length }})</option>
            @for (cat of categoriasEnServicioActual; track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
        </div>

        <div class="estado-cuadrante-badge" [attr.data-estado]="estadoCuadrante">
          Estado: <strong>{{ estadoCuadrante }}</strong>
        </div>
      </div>

      <div class="actions-group">
        <label class="toggle-check" title="Avanza automáticamente a la siguiente celda al presionar una tecla de turno">
          <input type="checkbox" [ngModel]="autoAvanzarAlTeclear" (ngModelChange)="cambiarAutoAvanzar.emit($event)">
          <span>⚡ Auto-avanzar celda</span>
        </label>

        <label class="toggle-check">
          <input type="checkbox" [ngModel]="mostrarComparadorPrevisto" (ngModelChange)="cambiarMostrarComparador.emit($event)">
          <span>🔍 Ver cambios frente al original</span>
        </label>

        <div class="intranet-status-box" [title]="'Sincronización automática con Intranet: ' + (ultimaSincronizacionIntranet || 'Activa')">
          <span class="live-dot"></span>
          <span class="intranet-label">Intranet</span>
          @if (ultimaSincronizacionIntranet) {
            <span class="intranet-time">{{ ultimaSincronizacionIntranet }}</span>
          }
          <button
            class="btn-icon-refresh"
            (click)="sincronizarNovedadesIntranet.emit()"
            [disabled]="sincronizandoNovedades"
            title="Forzar actualización inmediata con Intranet (Censo y Ausencias)">
            🔄
          </button>
        </div>

        <button class="btn-secondary" (click)="abrirModalRotacion.emit()">
          🔄 Traer Personal de Apoyo
        </button>

        <button class="btn-wizard" (click)="ejecutarAutocompletarHuecos.emit()">
          ✨ Autocompletar Turnos Faltantes
        </button>

        <div class="undo-redo-cluster">
          <button
            class="btn-undo-action"
            (click)="deshacerUltimaAccion.emit()"
            [disabled]="pilaDeshacer.length === 0"
            title="Deshacer último cambio (Ctrl + Z)">
            ↩️ Deshacer
          </button>
          <button
            class="btn-undo-action"
            (click)="rehacerUltimaAccion.emit()"
            [disabled]="pilaRehacer.length === 0"
            title="Rehacer cambio revertido (Ctrl + Y)">
            ↪️ Rehacer
          </button>
        </div>

        <button class="btn-outline" (click)="limpiarCuadranteCompleto.emit()" title="Borra todos los turnos para armar el cuadro de turnos a mano (conserva VAC/INC)">
          🧹 Dejar en Blanco
        </button>

        <button
          class="btn-primary"
          (click)="cambiarEstadoCuadrante.emit()"
          [disabled]="esCoordinador && estadoCuadrante !== 'BORRADOR'"
          [title]="esCoordinador && estadoCuadrante !== 'BORRADOR' ? 'Solo Talento Humano / Nómina puede cerrar o reabrir meses publicados' : ''">
          @if (estadoCuadrante === 'BORRADOR') {
            🚀 Publicar Cuadro de Turnos
          } @else if (estadoCuadrante === 'PUBLICADO') {
            🔒 Cerrar Mes para Nómina
          } @else {
            🔓 Reabrir Cuadro de Turnos
          }
        </button>

        <button class="btn-excel" (click)="exportarExcelNomina.emit()">
          📊 Exportar Excel
        </button>
      </div>
    </section>

    <!-- PALETA DE TURNOS -->
    <section class="thurni-palette-bar">
      <div class="palette-instructions">
        <strong>🎨 Tipos de Turno:</strong>
        <span>Usa <strong>👆 Puntero</strong> para navegar o teclear turnos (<code>1-8, M, T, N, D, G, S, L, C, V, I, Supr</code>). <span class="badge-ctrl-tip">💡 <strong>Ctrl + Arrastrar</strong> clona el turno de cualquier celda (estilo Excel).</span></span>
      </div>

      <div class="palette-chips">
        <div
          class="shift-chip pointer-chip"
          [class.selected]="turnoPincelActivo === 'POINTER'"
          (click)="seleccionarPincel.emit('POINTER')"
          title="Modo Selección / Puntero: Haz clic para navegar o inspeccionar sin sobreescribir">
          <div class="chip-code">👆</div>
          <div class="chip-meta">
            <span class="chip-name">Puntero</span>
            <span class="chip-hours">Navegar / Teclado</span>
          </div>
        </div>

        @for (t of listaTurnosPaleta; track t.codigo) {
          <div
            class="shift-chip"
            [class.selected]="turnoPincelActivo === t.codigo"
            [class.chip-heavy]="t.horasOrdinarias >= 12 || t.codigo === 'G24' || t.codigo === 'N12' || t.codigo === 'D12'"
            [class.chip-24]="t.codigo === 'G24'"
            [style.background-color]="t.bgHex"
            [style.color]="t.textHex"
            [style.border-color]="t.borderHex"
            draggable="true"
            (dragstart)="onDragStartPaleta(t.codigo, $event)"
            (click)="seleccionarPincel.emit(t.codigo)"
            title="{{ t.nombre }} ({{ t.horario }}) - {{ t.horasOrdinarias }}h">
            <div class="chip-code">{{ t.codigo }}</div>
            <div class="chip-meta">
              <span class="chip-name">{{ t.nombre }}</span>
              <span class="chip-hours">{{ t.horario }}</span>
            </div>
          </div>
        }

        <div
          class="shift-chip eraser-chip"
          [class.selected]="turnoPincelActivo === ''"
          draggable="true"
          (dragstart)="onDragStartPaleta('', $event)"
          (click)="seleccionarPincel.emit('')">
          <div class="chip-code">🧽</div>
          <div class="chip-meta">
            <span class="chip-name">Borrador</span>
            <span class="chip-hours">Limpiar celda</span>
          </div>
        </div>
      </div>
    </section>

    <!-- BARRA DE ALERTAS EN VIVO -->
    @if (infraccionesActivas.length > 0) {
      <div class="alert-bar-violations">
        <div class="alert-title">
          ⚠️ <strong>{{ infraccionesActivas.length }} Alertas de descanso detectadas:</strong>
        </div>
        <div class="alert-list">
          @for (inf of infraccionesActivas.slice(0, 4); track $index) {
            <span class="violation-pill" (click)="enfocarCelda.emit({ empId: inf.empleadoId, dia: inf.dia })">
              {{ inf.mensaje }}
            </span>
          }
        </div>
      </div>
    }

    <!-- MATRIZ DEL CUADRANTE MENSUAL -->
    @if (clonandoConCtrl) {
      <div class="floating-clone-badge">
        📋 <span>Clonando turno: <strong>{{ turnoClonandoConCtrl || 'Vacío (Borrador)' }}</strong></span>
      </div>
    }

    <div class="grid-container" [class.ctrl-pressed]="teclaCtrlPresionada" [class.is-cloning]="clonandoConCtrl">
      <table class="schedule-matrix" (mouseleave)="onGridMouseLeave()">
        <thead>
          <tr>
            <th class="col-sticky-emp">Colaborador / Categoría</th>
            <th class="col-empalme" title="Último turno del mes anterior (Protección de Empalme)">Emp.<br>Ant</th>
            @for (d of diasDelMes; track d.dia) {
              <th
                class="col-day"
                [class.col-focused]="celdaEnfocada?.dia === d.dia"
                [class.col-hovered]="celdaHovered?.dia === d.dia"
                [class.col-week-end]="d.esDomingo"
                [class.is-saturday]="d.esSabado"
                [class.is-sunday]="d.esDomingo"
                [class.is-holiday]="!!d.festivo"
                [title]="d.festivo ? '🇨🇴 FESTIVO: ' + d.festivo.nombre + ' (+75% Recargo)' : (d.esDomingo ? 'Domingo (+75% Recargo)' : (d.esSabado ? 'Sábado' : 'Día Ordinario'))">
                <div class="day-number">{{ d.dia }}</div>
                <div class="day-letter">{{ d.letraDia }}</div>
                @if (d.festivo) {
                  <div class="holiday-dot">🇨🇴</div>
                }
              </th>
            }
            <th class="col-summary" title="Horas Reales Programadas vs Contrato Mes (Ley 2101)">Horas<br>Mes</th>
            <th class="col-summary col-recargo" title="Horas Ordinarias Diurnas (06:00-19:00 L-S)">HOD</th>
            <th class="col-summary col-recargo" title="Horas Ordinarias Nocturnas (19:00-06:00 L-S) Recargo 35%">HON<br>35%</th>
            <th class="col-summary col-recargo" title="Horas Dominicales/Festivas Diurnas (06:00-19:00) Recargo 75%">HDFD<br>75%</th>
            <th class="col-summary col-recargo" title="Horas Dominicales/Festivas Nocturnas (19:00-06:00) Recargo 110%">HDFN<br>110%</th>
            <th class="col-summary" title="Saldo Arrastrado del Mes Anterior">Banco<br>Ant.</th>
            <th class="col-summary" title="Diferencia del Mes (Trabajadas - Contrato - Amortizadas COMP)">Mov.<br>Mes</th>
            <th class="col-summary col-banco-final" title="Nuevo Saldo Acumulado Continuo (Pasa al siguiente mes)">Nuevo<br>Banco</th>
            <th class="col-summary" title="Recargos Nocturnos (HON+HDFN) y Domingos/Festivos">Noches /<br>Dom-Fest</th>
          </tr>
        </thead>

        <tbody>
          @for (fila of filasCuadrante; track fila.empleado.id; let i = $index) {
            <!-- Separador de grupo por categoría (evita repetir el rol en cada fila) -->
            @if (i === 0 || filasCuadrante[i - 1].empleado.categoria !== fila.empleado.categoria) {
              <tr class="group-row">
                <td class="col-sticky-emp group-label">
                  {{ fila.empleado.categoria }}
                  <span class="group-count">{{ conteoPorCategoriaCuadrante[fila.empleado.categoria] }}</span>
                </td>
                <td class="group-fill" [attr.colspan]="diasDelMes.length + 10"></td>
              </tr>
            }
            <tr
              [class.row-rotacion]="fila.esPersonalRotado"
              [class.row-focused]="celdaEnfocada?.empId === fila.empleado.id"
              [class.row-hovered]="celdaHovered?.empId === fila.empleado.id">
              <!-- Info del Empleado (una sola línea) -->
              <td class="col-sticky-emp" [title]="fila.empleado.nombre + ' • ' + fila.empleado.categoria">
                <div class="emp-cell">
                  <div class="emp-avatar" [attr.data-cat]="fila.empleado.categoria">
                    {{ obtenerIniciales(fila.empleado.nombre) }}
                  </div>
                  <span class="emp-name">{{ fila.empleado.nombre }}</span>
                  @if (fila.esPersonalRotado) {
                    <span class="badge-rotado" title="Personal de apoyo de otro servicio">🔄</span>
                    <button
                      type="button"
                      class="btn-quitar-rotado"
                      (click)="quitarPersonalApoyo.emit(fila.empleado.id)"
                      title="Quitar este colaborador del personal de apoyo"
                    >
                      ✕
                    </button>
                  }
                </div>
              </td>

              <!-- Empalme Mes Anterior -->
              <td class="col-empalme">
                <span class="empalme-badge" [attr.data-code]="fila.empleado.ultimoTurnoMesPrevio">
                  {{ fila.empleado.ultimoTurnoMesPrevio || '-' }}
                </span>
              </td>

              <!-- Celdas de los días 1..30/31 -->
              @for (d of diasDelMes; track d.dia) {
                @let celda = fila.celdas[d.dia];
                @let cfg = obtenerConfigTurno(celda?.codigo || '');
                @let conflicto = obtenerConflictoCelda(fila.empleado.id, d.dia);
                @let cambioDiff = mostrarComparadorPrevisto && celda?.previsto !== undefined && celda?.previsto !== celda?.codigo;

                <td
                  [id]="'celda-' + fila.empleado.id + '-' + d.dia"
                  class="matrix-cell"
                  tabindex="0"
                  [class.cell-focused]="celdaEnfocada?.empId === fila.empleado.id && celdaEnfocada?.dia === d.dia"
                  [class.cell-hovered]="celdaHovered?.empId === fila.empleado.id && celdaHovered?.dia === d.dia"
                  [class.cell-col-guide]="celdaEnfocada?.dia === d.dia || celdaHovered?.dia === d.dia"
                  [class.cell-week-end]="d.esDomingo"
                  [class.cell-saturday]="d.esSabado"
                  [class.cell-sunday]="d.esDomingo"
                  [class.cell-holiday]="!!d.festivo"
                  [class.cell-conflict]="!!conflicto"
                  [class.cell-locked]="celda?.codigo === 'VAC' || celda?.codigo === 'INC' || celda?.codigo === 'LIC'"
                  [class.shift-heavy]="cfg && (cfg.horasOrdinarias >= 12 || cfg.codigo === 'G24' || cfg.codigo === 'N12' || cfg.codigo === 'D12')"
                  [class.shift-24]="celda?.codigo === 'G24'"
                  [style.background-color]="cfg ? cfg.bgHex : ''"
                  [style.color]="cfg ? cfg.textHex : ''"
                  (mousedown)="iniciarPintadoCelda.emit({ empId: fila.empleado.id, dia: d.dia, event: $event })"
                  (mouseenter)="onCeldaMouseEnter(fila.empleado.id, d.dia)"
                  (dragover)="dragOverCelda.emit($event)"
                  (drop)="dropCelda.emit({ event: $event, empId: fila.empleado.id, dia: d.dia })"
                  (keydown)="keyDownCelda.emit({ event: $event, empId: fila.empleado.id, dia: d.dia })"
                  [title]="construirTooltipCelda(fila.empleado, d, celda, conflicto)">

                  <div class="cell-inner">
                    <span class="cell-code">{{ celda?.codigo || '' }}</span>
                    @if (celda?.codigo === 'VAC' || celda?.codigo === 'INC' || celda?.codigo === 'LIC') {
                      <span class="lock-mini-tag" title="Bloqueado por novedad oficial Intranet">🔒</span>
                    }
                    @if (celda?.esRotacion) {
                      <span class="rotacion-mini-tag">🔄</span>
                    }
                    @if (conflicto) {
                      <span class="conflict-indicator">!</span>
                    }
                    @if (cambioDiff) {
                      <span class="diff-triangle" title="Previsto original: {{ celda?.previsto || 'Vacío' }}"></span>
                    }
                  </div>
                </td>
              }

              <!-- Totales, Desglose de Recargos y Banco de Horas por Colaborador -->
              <td class="col-summary font-mono" [title]="'Programadas ' + fila.horasTrabajadas + 'h de ' + fila.empleado.horasContratoMes + 'h de contrato'">
                <strong>{{ fila.horasTrabajadas }}</strong><span class="sub-contract">/{{ fila.empleado.horasContratoMes }}</span>
              </td>

              <td class="col-summary col-recargo font-mono" title="Horas Ordinarias Diurnas (06:00-19:00 L-S)">
                {{ fila.hod }}h
              </td>

              <td class="col-summary col-recargo font-mono" title="Horas Ordinarias Nocturnas (19:00-06:00 L-S) Recargo 35%">
                {{ fila.hon }}h
              </td>

              <td class="col-summary col-recargo font-mono" title="Horas Dominicales/Festivas Diurnas (06:00-19:00) Recargo 75%">
                {{ fila.hdfd }}h
              </td>

              <td class="col-summary col-recargo font-mono" title="Horas Dominicales/Festivas Nocturnas (19:00-06:00) Recargo 110%">
                {{ fila.hdfn }}h
              </td>

              <td class="col-summary font-mono">
                <span class="banco-pill" [class.pos]="fila.empleado.saldoBancoAnterior > 0" [class.neg]="fila.empleado.saldoBancoAnterior < 0">
                  {{ formatearSigno(fila.empleado.saldoBancoAnterior) }}h
                </span>
              </td>

              <td class="col-summary font-mono">
                <span [class.text-pos]="fila.diferenciaMes > 0" [class.text-neg]="fila.diferenciaMes < 0">
                  {{ formatearSigno(fila.diferenciaMes) }}h
                </span>
                @if (fila.horasAmortizadasComp > 0) {
                  <span class="comp-note" title="Horas descontadas del banco por turno COMP">C-{{ fila.horasAmortizadasComp }}</span>
                }
              </td>

              <td class="col-summary col-banco-final font-mono">
                <span
                  class="banco-badge-final"
                  [class.status-ok]="fila.nuevoSaldoBanco >= -6 && fila.nuevoSaldoBanco <= 18"
                  [class.status-warn]="(fila.nuevoSaldoBanco > 18 && fila.nuevoSaldoBanco <= 30) || (fila.nuevoSaldoBanco < -6 && fila.nuevoSaldoBanco >= -18)"
                  [class.status-danger]="fila.nuevoSaldoBanco > 30 || fila.nuevoSaldoBanco < -18">
                  {{ formatearSigno(fila.nuevoSaldoBanco) }}h
                </span>
              </td>

              <td class="col-summary">
                <div class="equity-counts">
                  <span title="Turnos de Noche en el mes">🌙 {{ fila.conteoNoches }}</span>
                  <span title="Domingos y Festivos laborados (≥3 genera Compensatorio)">☀️ {{ fila.conteoDomFest }}</span>
                  @if (fila.causaCompensatorioDominical) {
                    <span class="comp-dom-tag" title="Laboró 3 o más domingos: Causa 1 Compensatorio Legal CST">🏅</span>
                  }
                </div>
              </td>
            </tr>
          }
        </tbody>

        <!-- FOOTER REACTIVO DE COBERTURAS MÍNIMAS POR TURNO -->
        <tfoot>
          @let reglaFiltroFoot = reglaCargoActivaEnCuadrante;
          <tr class="coverage-row">
            <td colspan="2" class="col-sticky-emp coverage-label">
              ☀️ Cobertura Mañana • <strong>Mín: {{ reglaFiltroFoot ? reglaFiltroFoot.reqManana : servicioActual.reqManana }}</strong>
              @if (filtroCategoriaActiva !== 'TODAS') {
                <span style="font-size: 10.5px; color: #0284c7; font-weight: 700;">({{ filtroCategoriaActiva }})</span>
              }
            </td>
            @for (d of diasDelMes; track d.dia) {
              @let cob = coberturaPorDia[d.dia];
              @let metas = obtenerMetasDiaServicio(servicioActual, d);
              @if (metas.cerrado || metas.reqManana === 0) {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" style="color: #94a3b8; background: #f8fafc;" title="Servicio sin requerimiento en esta franja / día">
                  —
                </td>
              } @else {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" [class.cov-ok]="cob.manana >= metas.reqManana" [class.cov-deficit]="cob.manana < metas.reqManana">
                  {{ cob.manana }}/{{ metas.reqManana }}
                </td>
              }
            }
            <td colspan="9" class="coverage-summary-note">
              Programados / Mínimo requerido ({{ etiquetaModalidadDias(servicioActual.modalidadDias) }})
            </td>
          </tr>

          <tr class="coverage-row">
            <td colspan="2" class="col-sticky-emp coverage-label">
              🌤️ Cobertura Tarde • <strong>Mín: {{ reglaFiltroFoot ? reglaFiltroFoot.reqTarde : servicioActual.reqTarde }}</strong>
              @if (filtroCategoriaActiva !== 'TODAS') {
                <span style="font-size: 10.5px; color: #0284c7; font-weight: 700;">({{ filtroCategoriaActiva }})</span>
              }
            </td>
            @for (d of diasDelMes; track d.dia) {
              @let cob = coberturaPorDia[d.dia];
              @let metas = obtenerMetasDiaServicio(servicioActual, d);
              @if (metas.cerrado || metas.reqTarde === 0) {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" style="color: #94a3b8; background: #f8fafc;" title="Servicio sin requerimiento en esta franja / día">
                  —
                </td>
              } @else {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" [class.cov-ok]="cob.tarde >= metas.reqTarde" [class.cov-deficit]="cob.tarde < metas.reqTarde">
                  {{ cob.tarde }}/{{ metas.reqTarde }}
                </td>
              }
            }
            <td colspan="9" class="coverage-summary-note">
              Verde = Cobertura completa • (—) = Franja/día no operativo
            </td>
          </tr>

          <tr class="coverage-row">
            <td colspan="2" class="col-sticky-emp coverage-label">
              🌙 Cobertura Noche • <strong>Mín: {{ reglaFiltroFoot ? reglaFiltroFoot.reqNoche : servicioActual.reqNoche }}</strong>
              @if (filtroCategoriaActiva !== 'TODAS') {
                <span style="font-size: 10.5px; color: #0284c7; font-weight: 700;">({{ filtroCategoriaActiva }})</span>
              }
            </td>
            @for (d of diasDelMes; track d.dia) {
              @let cob = coberturaPorDia[d.dia];
              @let metas = obtenerMetasDiaServicio(servicioActual, d);
              @if (metas.cerrado || metas.reqNoche === 0) {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" style="color: #94a3b8; background: #f8fafc;" title="Servicio sin requerimiento en esta franja / día">
                  —
                </td>
              } @else {
                <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" [class.cov-ok]="cob.noche >= metas.reqNoche" [class.cov-deficit]="cob.noche < metas.reqNoche">
                  {{ cob.noche }}/{{ metas.reqNoche }}
                </td>
              }
            }
            <td colspan="9" class="coverage-summary-note">
              Rojo = Falta personal en el turno
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  `,
})
export class PlanificadorCuadranteComponent {
  @Input() servicioSeleccionadoId = '';
  @Input() serviciosVisibles: ServicioHospitalario[] = [];
  @Input() mesSeleccionado = 1;
  @Input() mesesDisponibles: Array<{ valor: number; nombre: string }> = [];
  @Input() anioSeleccionado = 2026;
  @Input() filtroCategoriaActiva = 'TODAS';
  @Input() categoriasEnServicioActual: string[] = [];
  @Input() estadoCuadrante = 'BORRADOR';
  @Input() autoAvanzarAlTeclear = false;
  @Input() mostrarComparadorPrevisto = false;
  @Input() ultimaSincronizacionIntranet = '';
  @Input() sincronizandoNovedades = false;
  @Input() pilaDeshacer: any[] = [];
  @Input() pilaRehacer: any[] = [];
  @Input() esCoordinador = false;
  @Input() turnoPincelActivo = 'POINTER';
  @Input() listaTurnosPaleta: TipoTurnoConfig[] = [];
  @Input() infraccionesActivas: InfraccionNormativa[] = [];
  @Input() clonandoConCtrl = false;
  @Input() turnoClonandoConCtrl: string | null = null;
  @Input() teclaCtrlPresionada = false;
  @Input() diasDelMes: DiaColumna[] = [];
  @Input() celdaEnfocada: { empId: string; dia: number } | null = null;
  @Input() filasCuadrante: any[] = [];
  @Input() conteoPorCategoriaCuadrante: Record<string, number> = {};
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};
  @Input() reglaCargoActivaEnCuadrante: ReglaCargoServicio | null | undefined = null;
  @Input({ required: true }) servicioActual!: ServicioHospitalario;
  @Input() coberturaPorDia: Record<number, { manana: number; tarde: number; noche: number }> = {};

  @Output() cambiarServicio = new EventEmitter<string>();
  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarFiltroCategoria = new EventEmitter<string>();
  @Output() cambiarAutoAvanzar = new EventEmitter<boolean>();
  @Output() cambiarMostrarComparador = new EventEmitter<boolean>();
  @Output() sincronizarNovedadesIntranet = new EventEmitter<void>();
  @Output() abrirModalRotacion = new EventEmitter<void>();
  @Output() ejecutarAutocompletarHuecos = new EventEmitter<void>();
  @Output() deshacerUltimaAccion = new EventEmitter<void>();
  @Output() rehacerUltimaAccion = new EventEmitter<void>();
  @Output() limpiarCuadranteCompleto = new EventEmitter<void>();
  @Output() cambiarEstadoCuadrante = new EventEmitter<void>();
  @Output() exportarExcelNomina = new EventEmitter<void>();
  @Output() seleccionarPincel = new EventEmitter<string>();
  @Output() dragStartPaleta = new EventEmitter<{ codigo: string; event: DragEvent }>();
  @Output() enfocarCelda = new EventEmitter<{ empId: string; dia: number }>();
  @Output() quitarPersonalApoyo = new EventEmitter<string>();
  @Output() iniciarPintadoCelda = new EventEmitter<{ empId: string; dia: number; event: MouseEvent }>();
  @Output() continuarPintadoCelda = new EventEmitter<{ empId: string; dia: number }>();
  @Output() dragOverCelda = new EventEmitter<DragEvent>();
  @Output() dropCelda = new EventEmitter<{ event: DragEvent; empId: string; dia: number }>();
  @Output() keyDownCelda = new EventEmitter<{ event: KeyboardEvent; empId: string; dia: number }>();

  celdaHovered: { empId: string; dia: number } | null = null;

  onCeldaMouseEnter(empId: string, dia: number): void {
    this.celdaHovered = { empId, dia };
    this.continuarPintadoCelda.emit({ empId, dia });
  }

  onGridMouseLeave(): void {
    this.celdaHovered = null;
  }

  onDragStartPaleta(codigo: string, event: DragEvent): void {
    this.dragStartPaleta.emit({ codigo, event });
  }

  obtenerConfigTurno(codigo: string): TipoTurnoConfig | undefined {
    return this.catalogoTurnosMap[codigo];
  }

  obtenerConflictoCelda(empId: string, dia: number): InfraccionNormativa | undefined {
    return this.infraccionesActivas.find((i) => i.empleadoId === empId && i.dia === dia);
  }

  obtenerIniciales(nombre: string): string {
    return nombre
      .replace('Dr. ', '')
      .replace('Dra. ', '')
      .replace('Enf. ', '')
      .replace('Lic. ', '')
      .replace('Tec. ', '')
      .replace('Q.F. ', '')
      .replace('Reg. ', '')
      .replace('Bact. ', '')
      .split(' ')
      .slice(0, 2)
      .map((p) => p[0])
      .join('')
      .toUpperCase();
  }

  formatearSigno(valor: number): string {
    return valor > 0 ? `+${valor}` : `${valor}`;
  }

  construirTooltipCelda(
    emp: EmpleadoHospital,
    d: DiaColumna,
    celda?: CeldaAsignacion,
    conflicto?: InfraccionNormativa
  ): string {
    const partes: string[] = [`${emp.nombre} • ${emp.categoria} • Día ${d.dia}`];
    if (d.festivo) partes.push(`🇨🇴 Festivo: ${d.festivo.nombre}`);
    if (celda?.codigo) {
      const cfg = this.catalogoTurnosMap[celda.codigo];
      if (cfg) partes.push(`Turno: ${cfg.nombre} (${cfg.horario})`);
    } else {
      partes.push('Sin turno asignado');
    }
    if (conflicto) partes.push(`⚠️ ALERTA: ${conflicto.mensaje}`);
    return partes.join(' | ');
  }

  obtenerMetasDiaServicio(
    srv: ServicioHospitalario,
    d: DiaColumna,
    categoriaEspecifica?: string
  ): { reqManana: number; reqTarde: number; reqNoche: number; cerrado: boolean } {
    const mod = srv.modalidadDias || 'TODOS_24_7';
    const esDomOFest = d.esDomingo || !!d.festivo;

    const catFiltro =
      categoriaEspecifica !== undefined
        ? categoriaEspecifica
        : this.filtroCategoriaActiva !== 'TODAS'
          ? this.filtroCategoriaActiva
          : undefined;

    const reglaCargo = catFiltro
      ? (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === catFiltro)
      : undefined;

    const baseM = reglaCargo ? reglaCargo.reqManana : srv.reqManana;
    const baseT = reglaCargo ? reglaCargo.reqTarde : srv.reqTarde;
    const baseN = reglaCargo ? reglaCargo.reqNoche : srv.reqNoche;
    const fdsM = reglaCargo ? (reglaCargo.reqMananaFds ?? baseM) : (srv.reqMananaFds ?? baseM);
    const fdsT = reglaCargo ? (reglaCargo.reqTardeFds ?? baseT) : (srv.reqTardeFds ?? baseT);
    const fdsN = reglaCargo ? (reglaCargo.reqNocheFds ?? baseN) : (srv.reqNocheFds ?? baseN);

    if (esDomOFest) {
      if (mod === 'LUN_VIE_HABILES' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return { reqManana: 0, reqTarde: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS') {
        return {
          reqManana: fdsM,
          reqTarde: fdsT,
          reqNoche: fdsN,
          cerrado: false,
        };
      }
      return {
        reqManana: baseM,
        reqTarde: baseT,
        reqNoche: baseN,
        cerrado: false,
      };
    }

    if (d.esSabado) {
      if (mod === 'LUN_VIE_HABILES') {
        return { reqManana: 0, reqTarde: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return {
          reqManana: fdsM,
          reqTarde: fdsT,
          reqNoche: fdsN,
          cerrado: false,
        };
      }
      return {
        reqManana: baseM,
        reqTarde: baseT,
        reqNoche: baseN,
        cerrado: false,
      };
    }

    return {
      reqManana: baseM,
      reqTarde: baseT,
      reqNoche: baseN,
      cerrado: false,
    };
  }

  etiquetaModalidadDias(mod?: string): string {
    switch (mod) {
      case 'TODOS_GUARDIA_FDS':
        return '24/7 (Guardia FDS/Fest.)';
      case 'LUN_SAB_SIN_FESTIVOS':
        return 'Lun-Sáb (Cierra Dom/Fest)';
      case 'LUN_VIE_HABILES':
        return 'Lun-Vie Hábiles';
      default:
        return 'Todos los días 24/7';
    }
  }
}
