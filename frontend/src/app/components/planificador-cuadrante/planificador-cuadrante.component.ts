import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild, ViewEncapsulation } from '@angular/core';
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
    <section class="toolbar-controls toolbar-eje3">
      <!-- BLOQUE 1: CONTEXTO Y ESTADO CLÍNICO (IZQUIERDA) -->
      <div class="toolbar-zone toolbar-zone-context">
        <div class="control-item">
          <label>Servicio:</label>
          <select [ngModel]="servicioSeleccionadoId" (ngModelChange)="cambiarServicio.emit($event)">
            @for (srv of serviciosVisibles; track srv.id) {
              <option [value]="srv.id">{{ srv.nombre }}</option>
            }
          </select>
        </div>

        <div class="control-item">
          <label>Mes:</label>
          <select [ngModel]="mesSeleccionado" (ngModelChange)="cambiarMes.emit($event)">
            @for (m of mesesDisponibles; track m.valor) {
              <option [value]="m.valor">{{ m.nombre }} {{ anioSeleccionado }}</option>
            }
          </select>
        </div>

        <div class="control-item">
          <label>Cargo:</label>
          <select [ngModel]="filtroCategoriaActiva" (ngModelChange)="cambiarFiltroCategoria.emit($event)">
            <option value="TODAS">Todos los cargos ({{ categoriasEnServicioActual.length }})</option>
            @for (cat of categoriasEnServicioActual; track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
        </div>

        <div class="estado-cuadrante-badge" [attr.data-estado]="estadoCuadrante" [title]="'Estado legal del cuadro de turnos: ' + estadoCuadrante">
          @if (estadoCuadrante === 'BORRADOR') {
            <span class="badge-dot dot-warn"></span>
            <span>Borrador</span>
          } @else if (estadoCuadrante === 'PUBLICADO') {
            <span class="badge-dot dot-success"></span>
            <span>Publicado</span>
          } @else {
            <span class="badge-dot dot-locked"></span>
            <span>Cerrado Nómina</span>
          }
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <!-- BLOQUE 2: HERRAMIENTAS DE EDICIÓN ASISTIDA (CENTRO) -->
      <div class="toolbar-zone toolbar-zone-tools">
        <!-- Clúster Deshacer / Rehacer -->
        <div class="undo-redo-cluster">
          <button
            class="btn-undo-action"
            (click)="deshacerUltimaAccion.emit()"
            [disabled]="pilaDeshacer.length === 0"
            title="Deshacer último cambio (Ctrl + Z)">
            ↩️
          </button>
          <button
            class="btn-undo-action"
            (click)="rehacerUltimaAccion.emit()"
            [disabled]="pilaRehacer.length === 0"
            title="Rehacer cambio revertido (Ctrl + Y)">
            ↪️
          </button>
        </div>

        <!-- Asistente y Acciones de Cuadrante -->
        <button class="btn-tool btn-tool-wizard" (click)="ejecutarAutocompletarHuecos.emit()" title="Autocompletar turnos faltantes respetando descansos y normativa colombiana">
          ✨ Autocompletar
        </button>

        <button class="btn-tool btn-tool-apoyo" (click)="abrirModalRotacion.emit()" title="Solicitar o traer personal de apoyo homólogo de otros servicios">
          🔄 Traer Apoyo
        </button>

        <button class="btn-tool btn-tool-limpiar" (click)="limpiarCuadranteCompleto.emit()" title="Borra todos los turnos para armar a mano (conserva VAC/INC)">
          🧹 En Blanco
        </button>

        <div class="tools-micro-divider"></div>

        <!-- Modo Auditoría / Comparador Visual -->
        <label class="toggle-chip" [class.active]="mostrarComparadorPrevisto" title="Muestra triángulo amarillo en celdas modificadas respecto a la versión oficial">
          <input type="checkbox" class="toggle-hidden-input" [ngModel]="mostrarComparadorPrevisto" (ngModelChange)="cambiarMostrarComparador.emit($event)">
          <span>🔍 Cambios</span>
        </label>
      </div>

      <div class="toolbar-divider"></div>

      <!-- BLOQUE 3: GOBERNANZA, INTEGRACIÓN Y ACCIÓN PRINCIPAL (DERECHA) -->
      <div class="toolbar-zone toolbar-zone-governance">
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

        <button class="btn-tool btn-tool-excel" (click)="exportarExcelNomina.emit()" title="Exportar pre-nómina y desglose de horas a Microsoft Excel (.xlsx)">
          📊 Excel
        </button>

        <button
          class="btn-cta-primary"
          [attr.data-estado]="estadoCuadrante"
          (click)="cambiarEstadoCuadrante.emit()"
          [disabled]="esCoordinador && estadoCuadrante !== 'BORRADOR'"
          [title]="esCoordinador && estadoCuadrante !== 'BORRADOR' ? 'Solo Talento Humano / Nómina puede cerrar o reabrir meses publicados' : ''">
          @if (estadoCuadrante === 'BORRADOR') {
            🚀 Publicar Cuadro
          } @else if (estadoCuadrante === 'PUBLICADO') {
            🔒 Cerrar Nómina
          } @else {
            🔓 Reabrir Cuadro
          }
        </button>
      </div>
    </section>

    <!-- PALETA DE TURNOS -->
    <section class="thurni-palette-bar">
      <div class="palette-clusters-wrapper">
        <!-- BLOQUE 1: HERRAMIENTAS (PUNTERO Y BORRADOR) -->
        <div class="palette-cluster cluster-tools">
          <span class="cluster-tag" title="Herramientas de navegación y limpieza">🛠️</span>
          <div
            class="shift-chip pointer-chip"
            [class.selected]="turnoPincelActivo === 'POINTER'"
            (click)="seleccionarPincel.emit('POINTER')"
            title="Puntero: Navegar e inspeccionar celdas (Usa teclado 1-8, M, T, N, etc.)">
            <span class="chip-code">👆</span>
          </div>

          <div
            class="shift-chip eraser-chip"
            [class.selected]="turnoPincelActivo === ''"
            draggable="true"
            (dragstart)="onDragStartPaleta('', $event)"
            (click)="seleccionarPincel.emit('')"
            title="Borrador: Limpiar turno asignado (Tecla Supr / Delete)">
            <span class="chip-code">🧽</span>
          </div>
        </div>

        <div class="cluster-divider"></div>

        <!-- BLOQUE 2: OPERATIVOS DIURNOS -->
        @if (turnosDiurnos.length > 0) {
          <div class="palette-cluster cluster-diurnos">
            <span class="cluster-tag tag-diurno" title="Familia Diurna (Horas ordinarias solares)">☀️ Diurnos</span>
            @for (t of turnosDiurnos; track t.codigo) {
              <div
                class="shift-chip"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </div>
            }
          </div>

          <div class="cluster-divider"></div>
        }

        <!-- BLOQUE 3: GUARDIAS Y NOCHES -->
        @if (turnosGuardiasNoches.length > 0) {
          <div class="palette-cluster cluster-guardias">
            <span class="cluster-tag tag-guardia" title="Familia Guardias & Noches (Recargo nocturno y dominical)">🌙 Guardias</span>
            @for (t of turnosGuardiasNoches; track t.codigo) {
              <div
                class="shift-chip chip-heavy"
                [class.selected]="turnoPincelActivo === t.codigo"
                [class.chip-24]="t.codigo === 'G24' || t.horasOrdinarias >= 24"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </div>
            }
          </div>

          <div class="cluster-divider"></div>
        }

        <!-- BLOQUE 4: DESCANSOS Y BANCO -->
        @if (turnosDescansos.length > 0) {
          <div class="palette-cluster cluster-descansos">
            <span class="cluster-tag tag-descanso" title="Familia Descanso Legal y Banco de Horas">☕ Descanso</span>
            @for (t of turnosDescansos; track t.codigo) {
              <div
                class="shift-chip"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </div>
            }
          </div>

          <div class="cluster-divider"></div>
        }

        <!-- BLOQUE 5: AUSENCIAS OFICIALES INTRANET -->
        @if (turnosAusencias.length > 0) {
          <div class="palette-cluster cluster-ausencias">
            <span class="cluster-tag tag-ausencia" title="Novedades oficiales bloqueadas por Intranet">🔒 Ausencias</span>
            @for (t of turnosAusencias; track t.codigo) {
              <div
                class="shift-chip"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </div>
            }
          </div>
        }
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

    <div
      #gridContainer
      class="grid-container"
      [class.ctrl-pressed]="teclaCtrlPresionada"
      [class.is-cloning]="clonandoConCtrl"
      (dragover)="onGridDragOver($event)"
      (dragleave)="onGridDragLeave($event)"
      (drop)="onGridDrop($event)"
      (mousemove)="onGridMouseMove($event)"
      (mouseleave)="onGridMouseLeave()">
      <table class="schedule-matrix">
        <thead>
          <tr>
            <th class="col-sticky-emp">Colaborador / Cargo</th>
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
                  [class.shift-24]="celda?.codigo === 'G24' || (cfg && cfg.horasOrdinarias >= 24)"
                  [style.background-color]="cfg ? cfg.bgHex : ''"
                  [style.color]="cfg ? cfg.textHex : ''"
                  (mousedown)="iniciarPintadoCelda.emit({ empId: fila.empleado.id, dia: d.dia, event: $event })"
                  (mouseenter)="onCeldaMouseEnter(fila.empleado.id, d.dia)"
                  (dragover)="onCeldaDragOver($event)"
                  (drop)="onCeldaDrop($event, fila.empleado.id, d.dia)"
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
export class PlanificadorCuadranteComponent implements OnDestroy {
  @ViewChild('gridContainer') gridContainerRef?: ElementRef<HTMLDivElement>;

  private autoScrollAnimationId: number | null = null;
  private autoScrollVelocidadY = 0;
  private autoScrollVelocidadX = 0;
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

  ngOnDestroy(): void {
    this.detenerAutoScroll();
  }

  onCeldaMouseEnter(empId: string, dia: number): void {
    this.celdaHovered = { empId, dia };
    this.continuarPintadoCelda.emit({ empId, dia });
  }

  onGridDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.procesarAutoScroll(event.clientY, event.clientX);
  }

  onGridDragLeave(event: DragEvent): void {
    this.detenerAutoScroll();
  }

  onGridDrop(event: DragEvent): void {
    this.detenerAutoScroll();
  }

  onCeldaDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.procesarAutoScroll(event.clientY, event.clientX);
    this.dragOverCelda.emit(event);
  }

  onCeldaDrop(event: DragEvent, empId: string, dia: number): void {
    this.detenerAutoScroll();
    this.dropCelda.emit({ event, empId, dia });
  }

  onGridMouseMove(event: MouseEvent): void {
    if (event.buttons === 1) {
      this.procesarAutoScroll(event.clientY, event.clientX);
    } else if (this.autoScrollVelocidadY !== 0 || this.autoScrollVelocidadX !== 0) {
      this.detenerAutoScroll();
    }
  }

  onGridMouseLeave(): void {
    this.celdaHovered = null;
    this.detenerAutoScroll();
  }

  private procesarAutoScroll(clientY: number, clientX: number): void {
    const el = this.gridContainerRef?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const threshold = 75; // Zona sensible de 75px en los bordes

    // Detección Vertical
    if (clientY > rect.bottom - threshold && clientY <= rect.bottom + 35) {
      const factor = Math.min(1, Math.max(0.15, (clientY - (rect.bottom - threshold)) / threshold));
      this.autoScrollVelocidadY = Math.round(factor * 20) + 6;
    } else if (clientY < rect.top + threshold && clientY >= rect.top - 35) {
      const factor = Math.min(1, Math.max(0.15, ((rect.top + threshold) - clientY) / threshold));
      this.autoScrollVelocidadY = -(Math.round(factor * 20) + 6);
    } else {
      this.autoScrollVelocidadY = 0;
    }

    // Detección Horizontal
    if (clientX > rect.right - threshold && clientX <= rect.right + 35) {
      const factor = Math.min(1, Math.max(0.15, (clientX - (rect.right - threshold)) / threshold));
      this.autoScrollVelocidadX = Math.round(factor * 20) + 6;
    } else if (clientX < rect.left + threshold && clientX >= rect.left - 35) {
      const factor = Math.min(1, Math.max(0.15, ((rect.left + threshold) - clientX) / threshold));
      this.autoScrollVelocidadX = -(Math.round(factor * 20) + 6);
    } else {
      this.autoScrollVelocidadX = 0;
    }

    if ((this.autoScrollVelocidadY !== 0 || this.autoScrollVelocidadX !== 0) && this.autoScrollAnimationId === null) {
      this.iniciarLoopAutoScroll();
    } else if (this.autoScrollVelocidadY === 0 && this.autoScrollVelocidadX === 0) {
      this.detenerAutoScroll();
    }
  }

  private iniciarLoopAutoScroll(): void {
    const tick = () => {
      const el = this.gridContainerRef?.nativeElement;
      if (!el || (this.autoScrollVelocidadY === 0 && this.autoScrollVelocidadX === 0)) {
        this.detenerAutoScroll();
        return;
      }

      if (this.autoScrollVelocidadY !== 0) {
        el.scrollTop += this.autoScrollVelocidadY;
      }
      if (this.autoScrollVelocidadX !== 0) {
        el.scrollLeft += this.autoScrollVelocidadX;
      }

      this.autoScrollAnimationId = requestAnimationFrame(tick);
    };

    this.autoScrollAnimationId = requestAnimationFrame(tick);
  }

  detenerAutoScroll(): void {
    if (this.autoScrollAnimationId !== null) {
      cancelAnimationFrame(this.autoScrollAnimationId);
      this.autoScrollAnimationId = null;
    }
    this.autoScrollVelocidadY = 0;
    this.autoScrollVelocidadX = 0;
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

  get turnosDiurnos(): TipoTurnoConfig[] {
    return this.listaTurnosPaleta.filter((t) => this.clasificarFamilia(t) === 'DIURNO');
  }

  get turnosGuardiasNoches(): TipoTurnoConfig[] {
    return this.listaTurnosPaleta.filter((t) => this.clasificarFamilia(t) === 'GUARDIA_NOCHE');
  }

  get turnosDescansos(): TipoTurnoConfig[] {
    return this.listaTurnosPaleta.filter((t) => this.clasificarFamilia(t) === 'DESCANSO');
  }

  get turnosAusencias(): TipoTurnoConfig[] {
    return this.listaTurnosPaleta.filter((t) => this.clasificarFamilia(t) === 'AUSENCIA');
  }

  clasificarFamilia(t: TipoTurnoConfig): 'DIURNO' | 'GUARDIA_NOCHE' | 'DESCANSO' | 'AUSENCIA' {
    if (t.esAusencia || ['VAC', 'INC', 'LIC'].includes((t.codigo || '').toUpperCase())) {
      return 'AUSENCIA';
    }
    if (
      ['L', 'S', 'COMP', 'DISP'].includes((t.codigo || '').toUpperCase()) ||
      (t.horasOrdinarias === 0 && !t.esAusencia)
    ) {
      return 'DESCANSO';
    }
    if (
      t.esNocturnoPesado ||
      (t.horasNocturnas || 0) >= 6 ||
      (t.horasOrdinarias || 0) >= 12 ||
      ['N8', 'N12', 'G24', 'D12', 'G12'].includes((t.codigo || '').toUpperCase())
    ) {
      return 'GUARDIA_NOCHE';
    }
    return 'DIURNO';
  }

  construirTooltipPaleta(t: TipoTurnoConfig): string {
    const partes: string[] = [`${t.codigo} • ${t.nombre} (${t.horario})`];
    if (t.horasOrdinarias > 0) {
      partes.push(`${t.horasOrdinarias}h ordinarias`);
      if (t.horasNocturnas > 0) partes.push(`${t.horasNocturnas}h nocturnas (Recargo 35%)`);
      if (t.minutosAlmuerzo && t.minutosAlmuerzo > 0) partes.push(`${t.minutosAlmuerzo}m almuerzo`);
    } else if (t.esAusencia) {
      partes.push('Novedad Oficial Intranet (Bloqueo Legal)');
    } else if (t.descuentaBancoHoras) {
      partes.push('Amortiza 8h Banco de Horas');
    } else {
      partes.push('Descanso no laborado');
    }
    return partes.join(' | ');
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
      if (cfg) {
        const fam = this.clasificarFamilia(cfg);
        const famTag =
          fam === 'GUARDIA_NOCHE'
            ? '🌙 Guardia / Noche'
            : fam === 'DIURNO'
              ? '☀️ Diurno'
              : fam === 'DESCANSO'
                ? '☕ Descanso / Banco'
                : '🔒 Novedad Oficial';
        partes.push(`${famTag}: ${cfg.nombre} (${cfg.horario})`);
      }
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
