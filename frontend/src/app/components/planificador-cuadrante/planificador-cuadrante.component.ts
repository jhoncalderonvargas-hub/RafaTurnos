import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  esCodigoExoneracionContrato,
  formatearPorcentaje,
  hoyColombiaIso,
  obtenerHorasAmortizacionTurno,
  resumenNormativoPeriodo,
  SEMAFORO_BANCO_HORAS,
} from '../../shared/liquidacion-horas';
import { FormsModule } from '@angular/forms';
import {
  CeldaAsignacion,
  CoberturaTurnoDia,
  DiaColumna,
  EmpleadoHospital,
  EmpresaContratante,
  InfraccionNormativa,
  MacroprocesoInfo,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoTurnoConfig,
} from '../../models';
import {
  FilaCoberturaTurno,
  ResumenCoberturaTurnosServicio,
} from '../../stores/cuadrante.store';

@Component({
  selector: 'app-planificador-cuadrante',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './planificador-cuadrante.component.css',
  template: `
    <section class="toolbar-controls toolbar-eje3">
      <!-- BLOQUE 1: CONTEXTO Y ESTADO CLÍNICO (IZQUIERDA) -->
      <div class="toolbar-zone toolbar-zone-context">
        <div class="control-item" title="Servicio hospitalario activo (agrupado por Macroproceso del Mapa de Procesos)">
          <select
            class="select-context select-servicio"
            aria-label="Seleccionar servicio hospitalario"
            [ngModel]="servicioSeleccionadoId"
            (ngModelChange)="cambiarServicio.emit($event)">
            @for (grupo of serviciosAgrupadosPorMacroproceso; track grupo.macro.codigo) {
              <optgroup [label]="grupo.macro.icono + ' ' + grupo.macro.nombreCorto">
                @for (srv of grupo.servicios; track srv.id) {
                  <option [value]="srv.id">{{ srv.nombre }} ({{ srv.codigo }})</option>
                }
              </optgroup>
            }
          </select>
        </div>

        <div class="month-stepper month-stepper-toolbar" title="Navegar entre meses y años">
          <button
            type="button"
            class="btn-nav-month"
            aria-label="Ir al mes anterior"
            (click)="navegarMes.emit(-1)"
            title="Ir al mes anterior">
            ◀
          </button>
          <select
            class="select-context select-mes"
            aria-label="Mes de planificación"
            [ngModel]="mesSeleccionado"
            (ngModelChange)="cambiarMes.emit(+$event)">
            @for (m of mesesDisponibles; track m.valor) {
              <option [value]="m.valor">{{ m.nombre }}</option>
            }
          </select>
          <select
            class="select-context select-year"
            aria-label="Año de planificación"
            [ngModel]="anioSeleccionado"
            (ngModelChange)="cambiarAnio.emit(+$event)"
            title="Año de planificación">
            @for (a of aniosDisponibles; track a) {
              <option [value]="a">{{ a }}</option>
            }
          </select>
          <button
            type="button"
            class="btn-nav-month"
            aria-label="Ir al mes siguiente"
            (click)="navegarMes.emit(1)"
            title="Ir al mes siguiente">
            ▶
          </button>
          <button
            type="button"
            class="btn-hoy-period"
            [class.is-current]="esPeriodoActual"
            [disabled]="esPeriodoActual"
            (click)="irAMesActual.emit()"
            [title]="esPeriodoActual ? 'Ya estás viendo el mes actual' : 'Volver al mes y año actual'">
            {{ esPeriodoActual ? '● Hoy' : 'Hoy' }}
          </button>
        </div>

        <div class="control-item" title="Filtrar cuadrante por cargo / especialidad">
          <select
            class="select-context select-cargo"
            aria-label="Filtrar cuadrante por cargo"
            [ngModel]="filtroCategoriaActiva"
            (ngModelChange)="cambiarFiltroCategoria.emit($event)">
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
          } @else if (estadoCuadrante === 'CERRADO_NOMINA') {
            <span class="badge-dot dot-locked"></span>
            <span>Cerrado Nómina</span>
          } @else {
            <span class="badge-dot dot-neutral"></span>
            <span>Sin Planificar</span>
          }
        </div>
      </div>

      <div class="toolbar-divider"></div>

      <!-- BLOQUE 2: HERRAMIENTAS DE EDICIÓN ASISTIDA (CENTRO) -->
      <div class="toolbar-zone toolbar-zone-tools">
        <!-- Clúster Deshacer / Rehacer -->
        <div class="undo-redo-cluster">
          <button
            type="button"
            aria-label="Deshacer último cambio"
            class="btn-undo-action"
            (click)="deshacerUltimaAccion.emit()"
            [disabled]="pilaDeshacer.length === 0"
            title="Deshacer último cambio (Ctrl + Z)">
            ↩️
          </button>
          <button
            type="button"
            aria-label="Rehacer cambio revertido"
            class="btn-undo-action"
            (click)="rehacerUltimaAccion.emit()"
            [disabled]="pilaRehacer.length === 0"
            title="Rehacer cambio revertido (Ctrl + Y)">
            ↪️
          </button>
        </div>

        <!-- Asistente y Acciones de Cuadrante -->
        <button
          type="button"
          class="btn-tool btn-tool-wizard"
          (click)="ejecutarAutocompletarHuecos.emit()"
          title="Autocompletar turnos faltantes respetando descansos y normativa colombiana">
          ✨ Autocompletar
        </button>

        <button
          type="button"
          class="btn-tool btn-tool-apoyo"
          (click)="abrirModalRotacion.emit()"
          title="Solicitar o traer personal de apoyo homólogo de otros servicios">
          🔄 Apoyo
        </button>

        <button
          type="button"
          class="btn-tool btn-tool-limpiar"
          (click)="limpiarCuadranteCompleto.emit()"
          title="Borra todos los turnos para armar a mano (conserva VAC/INC)">
          🧹 Limpiar
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
          <button
            type="button"
            aria-label="Sincronizar novedades con Intranet"
            class="btn-icon-refresh"
            (click)="sincronizarNovedadesIntranet.emit()"
            [disabled]="sincronizandoNovedades"
            [title]="'Forzar actualización inmediata con Intranet • Última: ' + (ultimaSincronizacionIntranet || 'Activa')">
            🔄
          </button>
        </div>

        <button
          type="button"
          class="btn-tool btn-tool-excel"
          (click)="exportarExcelNomina.emit()"
          title="Exportar pre-nómina y desglose de horas a Excel / CSV (.csv)">
          📊 Excel
        </button>

        @if (!esCoordinador && estadoCuadrante === 'PUBLICADO') {
          <button
            type="button"
            class="btn-tool btn-tool-revert"
            (click)="revertirABorrador.emit()"
            title="Devolver este cuadrante a estado Borrador (Exclusivo Talento Humano)">
            ↩️ Borrador
          </button>
        }

        <button
          type="button"
          class="btn-cta-primary"
          [attr.data-estado]="estadoCuadrante"
          (click)="cambiarEstadoCuadrante.emit()"
          [disabled]="esCoordinador && (estadoCuadrante === 'PUBLICADO' || estadoCuadrante === 'CERRADO_NOMINA')"
          [title]="esCoordinador && (estadoCuadrante === 'PUBLICADO' || estadoCuadrante === 'CERRADO_NOMINA') ? 'Solo Talento Humano / Nómina puede cerrar o reabrir meses publicados' : ''">
          @if (estadoCuadrante === 'SIN_PLANIFICAR') {
            📝 Iniciar Borrador
          } @else if (estadoCuadrante === 'BORRADOR') {
            🚀 Publicar Cuadro
          } @else if (estadoCuadrante === 'PUBLICADO') {
            🔒 Cerrar Nómina
          } @else {
            🔓 Reabrir Cuadro
          }
        </button>
      </div>
    </section>

    <!-- PALETA DE TURNOS (1 SOLA FILA COMPACTA) -->
    <section class="thurni-palette-bar" aria-label="Paleta de turnos">
      <div class="palette-clusters-wrapper">
        <!-- BLOQUE 1: HERRAMIENTAS (PUNTERO Y BORRADOR) -->
        <div class="palette-cluster cluster-tools">
          <span class="cluster-tag" title="Herramientas de navegación y limpieza" aria-hidden="true">🛠️</span>
          <button
            type="button"
            class="shift-chip pointer-chip"
            aria-label="Herramienta Puntero: Navegar e inspeccionar celdas"
            [attr.aria-pressed]="turnoPincelActivo === 'POINTER'"
            [class.selected]="turnoPincelActivo === 'POINTER'"
            (click)="seleccionarPincel.emit('POINTER')"
            title="Puntero: Navegar e inspeccionar celdas (Usa teclado 1-8, M, T, N, etc.)">
            <span class="chip-code">👆</span>
          </button>

          <button
            type="button"
            class="shift-chip eraser-chip"
            aria-label="Herramienta Borrador: Limpiar turno asignado"
            [attr.aria-pressed]="turnoPincelActivo === ''"
            [class.selected]="turnoPincelActivo === ''"
            draggable="true"
            (dragstart)="onDragStartPaleta('', $event)"
            (click)="seleccionarPincel.emit('')"
            title="Borrador: Limpiar turno asignado (Tecla Supr / Delete)">
            <span class="chip-code">🧽</span>
          </button>
        </div>

        <!-- BLOQUE 2: OPERATIVOS DIURNOS -->
        @if (turnosDiurnos.length > 0) {
          <div class="palette-cluster cluster-diurnos">
            <span class="cluster-tag tag-diurno" title="Familia Diurna (Horas ordinarias solares)" aria-hidden="true">☀️</span>
            @for (t of turnosDiurnos; track t.codigo) {
              <button
                type="button"
                class="shift-chip"
                [attr.aria-pressed]="turnoPincelActivo === t.codigo"
                [attr.aria-label]="'Turno ' + t.codigo + ': ' + t.nombre"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </button>
            }
          </div>
        }

        <!-- BLOQUE 3: GUARDIAS Y NOCHES -->
        @if (turnosGuardiasNoches.length > 0) {
          <div class="palette-cluster cluster-guardias">
            <span class="cluster-tag tag-guardia" title="Familia Guardias & Noches (Recargo nocturno y dominical)" aria-hidden="true">🌙</span>
            @for (t of turnosGuardiasNoches; track t.codigo) {
              <button
                type="button"
                class="shift-chip chip-heavy"
                [attr.aria-pressed]="turnoPincelActivo === t.codigo"
                [attr.aria-label]="'Turno ' + t.codigo + ': ' + t.nombre"
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
              </button>
            }
          </div>
        }

        <!-- BLOQUE 4: DESCANSOS Y BANCO -->
        @if (turnosDescansos.length > 0) {
          <div class="palette-cluster cluster-descansos">
            <span class="cluster-tag tag-descanso" title="Familia Descanso Legal y Banco de Horas" aria-hidden="true">☕</span>
            @for (t of turnosDescansos; track t.codigo) {
              <button
                type="button"
                class="shift-chip"
                [attr.aria-pressed]="turnoPincelActivo === t.codigo"
                [attr.aria-label]="'Turno ' + t.codigo + ': ' + t.nombre"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </button>
            }
          </div>
        }

        <!-- BLOQUE 5: AUSENCIAS OFICIALES INTRANET -->
        @if (turnosAusencias.length > 0) {
          <div class="palette-cluster cluster-ausencias">
            <span class="cluster-tag tag-ausencia" title="Novedades oficiales bloqueadas por Intranet" aria-hidden="true">🔒</span>
            @for (t of turnosAusencias; track t.codigo) {
              <button
                type="button"
                class="shift-chip"
                [attr.aria-pressed]="turnoPincelActivo === t.codigo"
                [attr.aria-label]="'Novedad ' + t.codigo + ': ' + t.nombre"
                [class.selected]="turnoPincelActivo === t.codigo"
                [style.background-color]="t.bgHex"
                [style.color]="t.textHex"
                [style.border-color]="t.borderHex"
                draggable="true"
                (dragstart)="onDragStartPaleta(t.codigo, $event)"
                (click)="seleccionarPincel.emit(t.codigo)"
                [title]="construirTooltipPaleta(t)">
                <span class="chip-code">{{ t.codigo }}</span>
              </button>
            }
          </div>
        }
      </div>
    </section>

    <!-- ALERTA DE EMPRESAS CONTRATANTES PENDIENTES DE CONFIRMAR REGLAS -->
    @if (empresasPendientes.length > 0) {
      <div class="empresas-pendientes-cuadrante-banner" role="alert">
        <div class="epc-left">
          <span aria-hidden="true">⚠️</span>
          <div>
            <strong>
              {{ empresasPendientes.length }} empresa(s) contratante(s) con reglas normativas pendientes de confirmar:
            </strong>
            <span>
              @for (ep of empresasPendientes; track ep.id; let last = $last) {
                {{ ep.nombre }} ({{ ep.codigo }})@if (!last) {, }
              }
            </span>
            <small>— El cierre de nómina (<code>CERRADO_NOMINA</code>) permanecerá bloqueado hasta confirmar sus reglas.</small>
          </div>
        </div>
        @if (!esCoordinador) {
          <button
            type="button"
            class="btn-configurar-empresas"
            (click)="irAConfigurarEmpresas.emit()">
            ⚙️ Configurar Empresas
          </button>
        }
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
                [class.col-hovered]="celdaGuiaLaser?.dia === d.dia"
                [class.col-week-end]="d.esDomingo"
                [class.is-saturday]="d.esSabado"
                [class.is-sunday]="d.esDomingo"
                [class.is-holiday]="!!d.festivo"
                [class.is-today]="!!d.esHoy"
                [title]="(d.esHoy ? '📍 HOY • ' : '') + (d.festivo ? '🇨🇴 FESTIVO: ' + d.festivo.nombre + ' (+' + pct(normativa.recargos.dominical) + ' Recargo)' : (d.esDomingo ? 'Domingo (+' + pct(normativa.recargos.dominical) + ' Recargo)' : (d.esSabado ? 'Sábado' : 'Día Ordinario')))">
                <div class="day-number">{{ d.dia }}</div>
                <div class="day-letter">{{ d.letraDia }}</div>
                @if (d.festivo) {
                  <div class="holiday-dot">🇨🇴</div>
                }
              </th>
            }
            <th class="col-summary" [title]="'Horas Reales Programadas vs Meta Mensual por Días Hábiles (' + resumenRegimenesCuadrante + ')'">Horas<br>Mes</th>
            <th class="col-summary col-recargo" title="Horas Ordinarias Diurnas en días hábiles (Lun–Sáb no festivo)">HOD</th>
            <th class="col-summary col-recargo" title="Horas Ordinarias Nocturnas en días hábiles según ventana nocturna y recargo de cada empresa">HON<br>{{ pct(normativa.recargos.nocturno) }}</th>
            <th class="col-summary col-recargo" title="Horas Dominicales/Festivas Diurnas según recargo de cada empresa (100% Dec. 1042 o gradual Ley 2466)">HDFD<br>Dom/Fest</th>
            <th class="col-summary col-recargo" title="Horas Dominicales/Festivas Nocturnas acumuladas según recargo de cada empresa">HDFN<br>Noct.D/F</th>
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
              [class.row-hovered]="celdaGuiaLaser?.empId === fila.empleado.id">
              <!-- Info del Empleado (una sola línea) -->
              <td class="col-sticky-emp" [title]="fila.empleado.nombre + ' • ' + fila.empleado.categoria + ' • ' + (fila.empresaNombre || '') + ' (' + (fila.horasSemanalesAplicadas ?? 42) + 'h/sem)'">
                <div class="emp-cell">
                  <div class="emp-avatar" [attr.data-cat]="fila.empleado.categoria">
                    {{ obtenerIniciales(fila.empleado.nombre) }}
                  </div>
                  <span class="emp-name">{{ fila.empleado.nombre }}</span>
                  <span
                    class="emp-empresa-chip"
                    [class.is-pendiente]="fila.empresaEstadoConfiguracion === 'PENDIENTE_REGLAS'"
                    [title]="(fila.empresaNombre || 'Empresa') + ' · Régimen ' + (fila.horasSemanalesAplicadas ?? 42) + 'h/sem'">
                    {{ fila.empresaCodigo || 'CST' }}·{{ fila.horasSemanalesAplicadas ?? 42 }}h
                  </span>
                  @if (fila.esPersonalRotado) {
                    <span
                      class="badge-rotado"
                      [title]="'Personal de apoyo adscrito a: ' + (fila.servicioOrigenNombre || 'Servicio Hermano')">
                      🔄 {{ fila.servicioOrigenCodigo || 'APOYO' }}
                    </span>
                    <button
                      type="button"
                      aria-label="Quitar personal de apoyo"
                      class="btn-quitar-rotado"
                      (click)="quitarPersonalApoyo.emit(fila.empleado.id)"
                      title="Quitar este colaborador del personal de apoyo">
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
                @let conflictos = obtenerConflictosCelda(fila.empleado.id, d.dia);
                @let esCeldaEspejo = esTurnoOtroServicio(celda);
                @let cambioDiff = mostrarComparadorPrevisto && celda?.previsto !== undefined && celda?.previsto !== celda?.codigo;

                <td
                  [id]="'celda-' + fila.empleado.id + '-' + d.dia"
                  class="matrix-cell"
                  tabindex="0"
                  [class.cell-focused]="celdaEnfocada?.empId === fila.empleado.id && celdaEnfocada?.dia === d.dia"
                  [class.cell-hovered]="celdaHovered?.empId === fila.empleado.id && celdaHovered?.dia === d.dia"
                  [class.cell-col-guide]="celdaGuiaLaser?.dia === d.dia"
                  [class.cell-week-end]="d.esDomingo"
                  [class.cell-saturday]="d.esSabado"
                  [class.cell-sunday]="d.esDomingo"
                  [class.cell-holiday]="!!d.festivo"
                  [class.cell-conflict]="conflictos.length > 0"
                  [class.cell-locked]="esCeldaBloqueada(celda?.codigo, cfg)"
                  [class.cell-mirror-other-service]="esCeldaEspejo"
                  [class.shift-heavy]="!esCeldaEspejo && cfg && (cfg.horasOrdinarias >= 12 || cfg.codigo === 'G24' || cfg.codigo === 'N12' || cfg.codigo === 'D12')"
                  [class.shift-24]="!esCeldaEspejo && (celda?.codigo === 'G24' || (cfg && cfg.horasOrdinarias >= 24))"
                  [style.background-color]="esCeldaEspejo ? '' : (cfg ? cfg.bgHex : '')"
                  [style.color]="esCeldaEspejo ? '' : (cfg ? cfg.textHex : '')"
                  (mousedown)="iniciarPintadoCelda.emit({ empId: fila.empleado.id, dia: d.dia, event: $event })"
                  (mouseenter)="onCeldaMouseEnter(fila.empleado.id, d.dia)"
                  (dragover)="onCeldaDragOver($event)"
                  (drop)="onCeldaDrop($event, fila.empleado.id, d.dia)"
                  (keydown)="onCeldaKeyDown($event, fila.empleado.id, d.dia)"
                  [title]="construirTooltipCelda(fila.empleado, d, celda, conflictos)">

                  <div class="cell-inner">
                    @if (esCeldaEspejo) {
                      <div class="mirror-cell-content">
                        <span class="mirror-srv-code">📍{{ obtenerCodigoServicio(celda?.servicioEjecutorId) }}</span>
                        <span class="mirror-shift-code">{{ celda?.codigo }}</span>
                      </div>
                    } @else {
                      <span class="cell-code">{{ celda?.codigo || '' }}</span>
                      @if (esCeldaBloqueada(celda?.codigo, cfg)) {
                        <span class="lock-mini-tag" title="Bloqueado por novedad oficial Intranet">🔒</span>
                      }
                      @if (celda?.esRotacion && celda?.codigo && celda?.codigo !== 'L') {
                        <span class="rotacion-mini-tag" title="Turno de apoyo ejecutado en este servicio">🔄</span>
                      }
                      @if (cambioDiff) {
                        <span class="diff-triangle" title="Previsto original: {{ celda?.previsto || 'Vacío' }}"></span>
                      }
                    }
                  </div>
                </td>
              }

              <!-- Totales, Desglose de Recargos y Banco de Horas por Colaborador -->
              <td class="col-summary font-mono" [title]="construirTooltipHorasMes(fila)">
                <div>
                  <strong>{{ fila.horasTrabajadas }}</strong><span class="sub-contract">/{{ fila.horasContratadasEfectivas ?? fila.empleado.horasContratoMes }}</span>
                </div>
                @if (fila.horasOtrosServicios > 0) {
                  <div class="multi-srv-hours-badge">
                    {{ fila.horasLocales }}h aquí · {{ fila.horasOtrosServicios }}h apoyo
                  </div>
                }
              </td>

              <td class="col-summary col-recargo font-mono" [title]="'Horas Ordinarias Diurnas en días hábiles (' + (fila.empresaNombre || 'Empresa') + ')'">
                {{ fila.hod }}h
              </td>

              <td class="col-summary col-recargo font-mono" [title]="'Horas Ordinarias Nocturnas (' + (fila.empresaNombre || 'Empresa') + ': Recargo ' + pct(fila.recargos?.nocturno ?? normativa.recargos.nocturno) + ')'">
                {{ fila.hon }}h
              </td>

              <td class="col-summary col-recargo font-mono" [title]="'Horas Dominicales/Festivas Diurnas (' + (fila.empresaNombre || 'Empresa') + ': Recargo ' + pct(fila.recargos?.dominical ?? normativa.recargos.dominical) + ')'">
                {{ fila.hdfd }}h
              </td>

              <td class="col-summary col-recargo font-mono" [title]="'Horas Dominicales/Festivas Nocturnas (' + (fila.empresaNombre || 'Empresa') + ': Recargo ' + pct(fila.recargos?.nocturnoDominical ?? normativa.recargos.nocturnoDominical) + ')'">
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
                  [class.status-ok]="fila.nuevoSaldoBanco >= semaforo.ATENCION_NEG && fila.nuevoSaldoBanco <= semaforo.ATENCION_POS"
                  [class.status-warn]="(fila.nuevoSaldoBanco > semaforo.ATENCION_POS && fila.nuevoSaldoBanco <= semaforo.CRITICO_POS) || (fila.nuevoSaldoBanco < semaforo.ATENCION_NEG && fila.nuevoSaldoBanco >= semaforo.CRITICO_NEG)"
                  [class.status-danger]="fila.nuevoSaldoBanco > semaforo.CRITICO_POS || fila.nuevoSaldoBanco < semaforo.CRITICO_NEG">
                  {{ formatearSigno(fila.nuevoSaldoBanco) }}h
                </span>
              </td>

              <td class="col-summary">
                <div class="equity-counts">
                  <span title="Turnos de Noche en el mes">🌙 {{ fila.conteoNoches }}</span>
                  <span [title]="'Domingos laborados: ' + (fila.conteoDomingos ?? fila.conteoDomFest) + ' (≥3 causa compensatorio Art. 179 CST) • Dom+Fest: ' + fila.conteoDomFest">
                    ☀️ {{ fila.conteoDomFest }}@if (fila.conteoDomingos !== undefined && fila.conteoDomingos !== fila.conteoDomFest) { <small class="dom-sub-count">({{ fila.conteoDomingos }}d)</small> }
                  </span>
                  @if (fila.causaCompensatorioDominical) {
                    <span class="comp-dom-tag" [title]="'Laboró ' + (fila.conteoDomingos ?? fila.conteoDomFest) + ' domingos (≥3): Causa 1 Compensatorio Legal CST (Art. 179 Par. 1 / Art. 181)'">🏅</span>
                  }
                </div>
              </td>
            </tr>
          }
        </tbody>

        <!-- FOOTER CUADRANTE DE COBERTURAS POR TURNO OPERATIVO (ESQUEMA B) + RESUMEN DÍA/NOCHE COLAPSABLE -->
        <tfoot>
          <tr class="coverage-quad-header-row">
            <td class="col-sticky-emp coverage-quad-title-cell">
              <span>🎯 Cobertura por Turno</span>
              @if (filtroCategoriaActiva !== 'TODAS') {
                <span class="coverage-cargo-tag">({{ filtroCategoriaActiva }})</span>
              }
            </td>
            <td [attr.colspan]="diasDelMes.length + 10" class="coverage-quad-meta-cell">
              <div class="cov-quad-bar">
                <div class="cov-kpi-group">
                  <span class="cov-kpi-pill kpi-rojo" title="Celdas por debajo del mínimo requerido">
                    🔴 Déficit: {{ resumenCoberturaTurnos?.rojos ?? 0 }}
                  </span>
                  <span class="cov-kpi-pill kpi-amarillo" title="Celdas que alcanzan el mínimo pero por debajo de lo esperado">
                    🟡 Bajo esp.: {{ resumenCoberturaTurnos?.amarillos ?? 0 }}
                  </span>
                  <span class="cov-kpi-pill kpi-verde" title="Celdas que cumplen o superan lo esperado">
                    🟢 Óptimos: {{ resumenCoberturaTurnos?.verdes ?? 0 }}
                  </span>
                  @if ((resumenCoberturaTurnos?.excedentes ?? 0) > 0) {
                    <span class="cov-kpi-pill kpi-exceso" title="Personal adicional programado por encima de la meta esperada">
                      +{{ resumenCoberturaTurnos?.excedentes }} excedentes
                    </span>
                  }
                </div>
                <button
                  type="button"
                  class="btn-toggle-legacy-cov"
                  (click)="mostrarFranjasLegacy = !mostrarFranjasLegacy">
                  {{ mostrarFranjasLegacy ? '▲ Ocultar franjas Día/Noche' : '▼ Ver franjas Día/Noche' }}
                </button>
              </div>
            </td>
          </tr>

          @for (filaCob of (resumenCoberturaTurnos?.filasTurnos || []); track filaCob.codigoTurno) {
            <tr class="coverage-row coverage-turno-row">
              <td class="col-sticky-emp coverage-label coverage-turno-label">
                <span
                  class="mini-shift cov-turno-chip"
                  [style.background-color]="filaCob.colorHex"
                  [style.color]="filaCob.textHex"
                  [style.border-color]="filaCob.borderHex">
                  {{ filaCob.codigoTurno }}
                </span>
                <span class="cov-meta-text">
                  Mín <strong>{{ filaCob.minimoBase }}</strong> · Esp <strong>{{ filaCob.esperadoBase }}</strong>
                </span>
                @if (servicioActual.modalidadDias === 'TODOS_GUARDIA_FDS') {
                  <span class="coverage-fds-note" title="Meta en Domingos y Festivos: Mínimo / Esperado">
                    (DF: {{ filaCob.minimoDomFest }}/{{ filaCob.esperadoDomFest }})
                  </span>
                }
              </td>
              <td class="col-empalme coverage-off">—</td>
              @for (d of diasDelMes; track d.dia) {
                @let cell = filaCob.dias[d.dia];
                @if (!cell || cell.cerrado) {
                  <td
                    class="coverage-cell coverage-off"
                    [class.cell-week-end]="d.esDomingo"
                    title="Día no operativo / cerrado según modalidad del servicio">
                    —
                  </td>
                } @else {
                  <td
                    class="coverage-cell"
                    [class.cell-week-end]="d.esDomingo"
                    [class.cov-rojo]="cell.estado === 'ROJO'"
                    [class.cov-amarillo]="cell.estado === 'AMARILLO'"
                    [class.cov-verde]="cell.estado === 'VERDE'"
                    [title]="construirTooltipCoberturaTurno(filaCob, d, cell)">
                    <span class="cov-ratio">{{ cell.programados }}/{{ cell.esperado }}</span>@if (cell.exceso > 0) {<span class="cov-exceso-tag">+{{ cell.exceso }}</span>}
                  </td>
                }
              }
              <td colspan="9" class="coverage-summary-note">
                <strong>{{ filaCob.nombreTurno }}</strong> ({{ filaCob.horario }}) • 🟢 ≥{{ filaCob.esperadoBase }} · 🟡 {{ filaCob.minimoBase }}–{{ filaCob.esperadoBase - 1 }} · 🔴 &lt;{{ filaCob.minimoBase }}
              </td>
            </tr>
          }

          @if (mostrarFranjasLegacy) {
            @let reglaFiltroFoot = reglaCargoActivaEnCuadrante;
            <tr class="coverage-row coverage-legacy-row">
              <td class="col-sticky-emp coverage-label">
                ☀️ Resumen Día • <strong>Mín: {{ reglaFiltroFoot ? reglaFiltroFoot.reqDia : servicioActual.reqDia }}</strong>
                @if (servicioActual.modalidadDias === 'TODOS_GUARDIA_FDS') {
                  <span class="coverage-fds-note">
                    (Dom/Fest: {{ reglaFiltroFoot ? (reglaFiltroFoot.reqDiaDomFest ?? reglaFiltroFoot.reqDia) : (servicioActual.reqDiaDomFest ?? servicioActual.reqDia) }})
                  </span>
                }
              </td>
              <td class="col-empalme coverage-off">—</td>
              @for (d of diasDelMes; track d.dia) {
                @let cob = coberturaPorDia[d.dia];
                @let metas = obtenerMetasDiaServicio(servicioActual, d);
                @if (metas.cerrado || metas.reqDia === 0) {
                  <td class="coverage-cell coverage-off" [class.cell-week-end]="d.esDomingo" title="Servicio sin requerimiento en esta franja / día">
                    —
                  </td>
                } @else {
                  <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" [class.cov-ok]="cob.dia >= metas.reqDia" [class.cov-deficit]="cob.dia < metas.reqDia">
                    {{ cob.dia }}/{{ metas.reqDia }}
                  </td>
                }
              }
              <td colspan="9" class="coverage-summary-note">
                Vista general Día ({{ etiquetaModalidadDias(servicioActual.modalidadDias) }})
              </td>
            </tr>

            <tr class="coverage-row coverage-legacy-row">
              <td class="col-sticky-emp coverage-label">
                🌙 Resumen Noche • <strong>Mín: {{ reglaFiltroFoot ? reglaFiltroFoot.reqNoche : servicioActual.reqNoche }}</strong>
                @if (servicioActual.modalidadDias === 'TODOS_GUARDIA_FDS') {
                  <span class="coverage-fds-note">
                    (Dom/Fest: {{ reglaFiltroFoot ? (reglaFiltroFoot.reqNocheDomFest ?? reglaFiltroFoot.reqNoche) : (servicioActual.reqNocheDomFest ?? servicioActual.reqNoche) }})
                  </span>
                }
              </td>
              <td class="col-empalme coverage-off">—</td>
              @for (d of diasDelMes; track d.dia) {
                @let cob = coberturaPorDia[d.dia];
                @let metas = obtenerMetasDiaServicio(servicioActual, d);
                @if (metas.cerrado || metas.reqNoche === 0) {
                  <td class="coverage-cell coverage-off" [class.cell-week-end]="d.esDomingo" title="Servicio sin requerimiento en esta franja / día">
                    —
                  </td>
                } @else {
                  <td class="coverage-cell" [class.cell-week-end]="d.esDomingo" [class.cov-ok]="cob.noche >= metas.reqNoche" [class.cov-deficit]="cob.noche < metas.reqNoche">
                    {{ cob.noche }}/{{ metas.reqNoche }}
                  </td>
                }
              }
              <td colspan="9" class="coverage-summary-note">
                Vista general Noche • ⚖️ {{ resumenRegimenesCuadrante }}
              </td>
            </tr>
          }
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
  @Input() macroprocesos: MacroprocesoInfo[] = [];
  @Input() servicioSeleccionadoId = '';
  @Input() serviciosVisibles: ServicioHospitalario[] = [];
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() mesSeleccionado = 1;
  @Input() mesesDisponibles: Array<{ valor: number; nombre: string }> = [];
  @Input() anioSeleccionado = Number(hoyColombiaIso().substring(0, 4));
  readonly semaforo = SEMAFORO_BANCO_HORAS;
  @Input() aniosDisponibles: number[] = [];
  @Input() esPeriodoActual = true;
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
  @Input() coberturaPorDia: Record<number, { dia: number; noche: number }> = {};
  @Input() resumenCoberturaTurnos?: ResumenCoberturaTurnosServicio;
  @Input() empresasPendientes: EmpresaContratante[] = [];

  @Output() irAConfigurarEmpresas = new EventEmitter<void>();
  @Output() cambiarServicio = new EventEmitter<string>();
  @Output() cambiarMes = new EventEmitter<number>();
  @Output() cambiarAnio = new EventEmitter<number>();
  @Output() navegarMes = new EventEmitter<-1 | 1>();
  @Output() irAMesActual = new EventEmitter<void>();
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
  @Output() revertirABorrador = new EventEmitter<void>();
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
  mostrarFranjasLegacy = false;

  get resumenRegimenesCuadrante(): string {
    const regs = Array.from(
      new Set(
        (this.filasCuadrante || []).map(
          (f) => `${f.empresaCodigo || 'CST'} ${f.horasSemanalesAplicadas ?? 42}h`
        )
      )
    );
    return regs.length > 0 ? regs.join(' / ') : 'Según empresa contratante';
  }

  construirTooltipCoberturaTurno(
    filaCob: FilaCoberturaTurno,
    d: DiaColumna,
    cell: CoberturaTurnoDia
  ): string {
    const estadoTxt =
      cell.estado === 'VERDE'
        ? 'Óptimo (Cumple esperado)'
        : cell.estado === 'AMARILLO'
          ? 'Alerta (Alcanza mínimo, bajo esperado)'
          : 'Déficit crítico (Bajo mínimo)';
    const excesoTxt = cell.exceso > 0 ? ` · Exceso: +${cell.exceso}` : '';
    return `${filaCob.codigoTurno} — ${filaCob.nombreTurno} | Día ${d.dia}\nProgramados: ${cell.programados} (Mín: ${cell.minimo}, Esp: ${cell.esperado})${excesoTxt}\nEstado: ${estadoTxt}`;
  }

  private normativaCache?: { clave: string; valor: ReturnType<typeof resumenNormativoPeriodo> };

  /** Franjas y recargos legales vigentes del periodo visible (Art. 160/168/179 CST, Ley 2466/2025). */
  get normativa(): ReturnType<typeof resumenNormativoPeriodo> {
    const clave = `${this.anioSeleccionado}-${this.mesSeleccionado}`;
    if (!this.normativaCache || this.normativaCache.clave !== clave) {
      this.normativaCache = { clave, valor: resumenNormativoPeriodo(this.anioSeleccionado, this.mesSeleccionado) };
    }
    return this.normativaCache.valor;
  }

  pct(fraccion: number): string {
    return formatearPorcentaje(fraccion);
  }

  /**
   * Un único láser inteligente:
   * - Cuando el puntero está sobre la grilla (`celdaHovered`), el haz láser sigue al puntero.
   * - Cuando el ratón sale de la tabla o se navega por teclado, el haz láser se posa en `celdaEnfocada`.
   */
  get celdaGuiaLaser(): { empId: string; dia: number } | null {
    return this.celdaHovered ?? this.celdaEnfocada;
  }

  get serviciosAgrupadosPorMacroproceso(): Array<{
    macro: { codigo: string; icono: string; nombreCorto: string };
    servicios: ServicioHospitalario[];
  }> {
    const lista = this.serviciosVisibles || [];
    if (!this.macroprocesos || this.macroprocesos.length === 0) {
      return lista.length > 0
        ? [{ macro: { codigo: 'TODOS', icono: '🏥', nombreCorto: 'Servicios' }, servicios: lista }]
        : [];
    }
    return this.macroprocesos
      .map((macro) => ({
        macro,
        servicios: lista.filter(
          (s) => (s.tipoAsistencia || 'URGENCIAS').toUpperCase() === macro.codigo
        ),
      }))
      .filter((g) => g.servicios.length > 0);
  }

  ngOnDestroy(): void {
    this.detenerAutoScroll();
  }

  onCeldaMouseEnter(empId: string, dia: number): void {
    this.celdaHovered = { empId, dia };
    this.continuarPintadoCelda.emit({ empId, dia });
  }

  onCeldaKeyDown(event: KeyboardEvent, empId: string, dia: number): void {
    this.celdaHovered = null;
    this.keyDownCelda.emit({ event, empId, dia });
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

  obtenerConflictosCelda(empId: string, dia: number): InfraccionNormativa[] {
    return this.infraccionesActivas.filter((i) => i.empleadoId === empId && i.dia === dia);
  }

  esCeldaBloqueada(codigo?: string, cfg?: TipoTurnoConfig): boolean {
    return Boolean(cfg?.esAusencia || esCodigoExoneracionContrato(codigo));
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
    if (t.esAusencia || esCodigoExoneracionContrato(t.codigo)) {
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
      if (t.horasNocturnas > 0) partes.push(`${t.horasNocturnas}h nocturnas (Recargo ${this.pct(this.normativa.recargos.nocturno)})`);
      if (t.minutosAlmuerzo && t.minutosAlmuerzo > 0) partes.push(`${t.minutosAlmuerzo}m almuerzo`);
    } else if (t.esAusencia || esCodigoExoneracionContrato(t.codigo)) {
      partes.push('Novedad Oficial Intranet (Bloqueo Legal)');
    } else if (t.descuentaBancoHoras) {
      partes.push(`Amortiza ${obtenerHorasAmortizacionTurno(t)}h Banco de Horas`);
    } else {
      partes.push('Descanso no laborado');
    }
    return partes.join(' | ');
  }

  esTurnoOtroServicio(celda?: CeldaAsignacion): boolean {
    if (!celda || !celda.codigo) return false;
    if (celda.codigo === 'L' || esCodigoExoneracionContrato(celda.codigo)) return false;
    return Boolean(
      celda.servicioEjecutorId &&
        celda.servicioEjecutorId !== this.servicioSeleccionadoId
    );
  }

  obtenerCodigoServicio(servicioId?: string): string {
    if (!servicioId) return 'SRV';
    const srv =
      this.servicios.find((s) => s.id === servicioId) ||
      this.serviciosVisibles.find((s) => s.id === servicioId);
    return srv ? srv.codigo : 'OTRO';
  }

  obtenerNombreServicio(servicioId?: string): string {
    if (!servicioId) return 'Otro Servicio';
    const srv =
      this.servicios.find((s) => s.id === servicioId) ||
      this.serviciosVisibles.find((s) => s.id === servicioId);
    return srv ? srv.nombre : servicioId;
  }

  construirTooltipHorasMes(fila: any): string {
    const nom = fila.horasContratadasNominales ?? fila.empleado.horasContratoMes;
    const metaEf = fila.horasContratadasEfectivas ?? nom;
    const hSem = fila.horasSemanalesAplicadas ?? fila.empleado.horasSemanalesAplicadas ?? 42;
    const dhMes = fila.diasHabilesMes ?? '—';
    const dhPror = fila.diasHabilesProrrateados ?? fila.diasExonerados ?? 0;
    const regTxt = `${fila.empresaNombre || 'Régimen'} (${hSem}h/sem · ${dhMes} días hábiles mes)`;
    const base =
      dhPror > 0
        ? `${regTxt}\nTotal Hospital: ${fila.horasTrabajadas}h de ${metaEf}h efectivas (Nominal: ${nom}h menos ${fila.horasExoneradas || 0}h por ${dhPror} día(s) hábil(es) exonerado(s))`
        : `${regTxt}\nTotal Hospital: ${fila.horasTrabajadas}h programadas de ${nom}h de contrato mensual`;
    if (!fila.desgloseServicios || fila.desgloseServicios.length <= 1) {
      if (fila.horasOtrosServicios > 0) {
        return `${base}\n• En este servicio: ${fila.horasLocales}h\n• En otros servicios (Apoyo): ${fila.horasOtrosServicios}h`;
      }
      return base;
    }
    const lineas = fila.desgloseServicios.map(
      (d: { servicioId: string; codigo: string; nombre: string; horas: number }) =>
        `• ${d.nombre} (${d.codigo}): ${d.horas}h${d.servicioId === this.servicioSeleccionadoId ? ' [Actual]' : ''}`
    );
    return `${base}\n${lineas.join('\n')}`;
  }

  construirTooltipCelda(
    emp: EmpleadoHospital,
    d: DiaColumna,
    celda?: CeldaAsignacion,
    conflictos?: InfraccionNormativa[] | InfraccionNormativa
  ): string {
    const partes: string[] = [`${emp.nombre} • ${emp.categoria} • Día ${d.dia}`];
    if (d.festivo) partes.push(`🇨🇴 Festivo: ${d.festivo.nombre}`);
    if (this.esTurnoOtroServicio(celda)) {
      const nomSrv = this.obtenerNombreServicio(celda?.servicioEjecutorId);
      const codSrv = this.obtenerCodigoServicio(celda?.servicioEjecutorId);
      const cfg = celda?.codigo ? this.catalogoTurnosMap[celda.codigo] : undefined;
      partes.push(
        `📍 ROTACIÓN ACTIVA EN: ${nomSrv} (${codSrv}) — Turno ${celda?.codigo}${cfg ? ' (' + cfg.horario + ')' : ''}`
      );
      partes.push(
        `🔒 Celda Espejo bloqueada en este servicio • Suma a sus horas de contrato, pero NO suma a la cobertura local de ${this.servicioActual?.nombre || 'este servicio'}.`
      );
    } else if (celda?.codigo) {
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
      if (celda.esRotacion && celda.codigo !== 'L') {
        partes.push(`🔄 Turno de apoyo ejecutado en ${this.servicioActual?.nombre || 'este servicio'}`);
      }
    } else {
      partes.push('Sin turno asignado');
    }
    const listaConflictos = Array.isArray(conflictos)
      ? conflictos
      : conflictos
        ? [conflictos]
        : [];
    for (const c of listaConflictos) {
      partes.push(`⚠️ ALERTA: ${c.mensaje}`);
    }
    return partes.join('\n');
  }

  private clasificarFranjasTurnoLocal(cfg?: TipoTurnoConfig): { dia: boolean; noche: boolean } {
    if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia) {
      return { dia: false, noche: false };
    }
    if (cfg.horasOrdinarias >= 24) {
      return { dia: true, noche: true };
    }
    const noche = Boolean(cfg.esNocturnoPesado || cfg.horasNocturnas >= 6);
    return { dia: !noche, noche };
  }

  obtenerMetasDiaServicio(
    srv: ServicioHospitalario,
    d: DiaColumna,
    categoriaEspecifica?: string
  ): { reqDia: number; reqNoche: number; cerrado: boolean } {
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

    if (catFiltro && (srv.reglasPorCargo?.length || 0) > 0 && !reglaCargo) {
      return { reqDia: 0, reqNoche: 0, cerrado: false };
    }

    const baseD = reglaCargo ? reglaCargo.reqDia : srv.reqDia;
    const baseN = reglaCargo ? reglaCargo.reqNoche : srv.reqNoche;
    const domFestD = reglaCargo ? (reglaCargo.reqDiaDomFest ?? baseD) : (srv.reqDiaDomFest ?? baseD);
    const domFestN = reglaCargo ? (reglaCargo.reqNocheDomFest ?? baseN) : (srv.reqNocheDomFest ?? baseN);

    const turnosHab =
      reglaCargo?.turnosHabilitados && reglaCargo.turnosHabilitados.length > 0
        ? reglaCargo.turnosHabilitados
        : srv.turnosHabilitados && srv.turnosHabilitados.length > 0
          ? srv.turnosHabilitados
          : [];

    const tieneDia =
      turnosHab.length === 0 ||
      turnosHab.some((c) => {
        const cfg = this.catalogoTurnosMap[c.toUpperCase()];
        return cfg && this.clasificarFranjasTurnoLocal(cfg).dia;
      });
    const tieneNoche =
      turnosHab.length === 0 ||
      turnosHab.some((c) => {
        const cfg = this.catalogoTurnosMap[c.toUpperCase()];
        return cfg && this.clasificarFranjasTurnoLocal(cfg).noche;
      });

    const efD = tieneDia ? baseD : 0;
    const efN = tieneNoche ? baseN : 0;
    const efDomFestD = tieneDia ? domFestD : 0;
    const efDomFestN = tieneNoche ? domFestN : 0;

    if (esDomOFest) {
      if (mod === 'LUN_VIE_HABILES' || mod === 'LUN_SAB_SIN_FESTIVOS') {
        return { reqDia: 0, reqNoche: 0, cerrado: true };
      }
      if (mod === 'TODOS_GUARDIA_FDS') {
        return {
          reqDia: efDomFestD,
          reqNoche: efDomFestN,
          cerrado: false,
        };
      }
      return {
        reqDia: efD,
        reqNoche: efN,
        cerrado: false,
      };
    }

    if (d.esSabado && mod === 'LUN_VIE_HABILES') {
      return { reqDia: 0, reqNoche: 0, cerrado: true };
    }

    return {
      reqDia: efD,
      reqNoche: efN,
      cerrado: false,
    };
  }

  etiquetaModalidadDias(mod?: string): string {
    switch (mod) {
      case 'TODOS_GUARDIA_FDS':
        return '24/7 (Lun–Sáb y Dom/Fest diferenciado)';
      case 'LUN_SAB_SIN_FESTIVOS':
        return 'Lun–Sáb (Cierra Dom/Fest)';
      case 'LUN_VIE_HABILES':
        return 'Lun–Vie Hábiles';
      default:
        return 'Todos los días 24/7';
    }
  }
}
