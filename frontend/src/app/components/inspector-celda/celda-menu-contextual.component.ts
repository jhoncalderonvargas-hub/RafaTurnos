import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CeldaAsignacion,
  CodigoTurno,
  EmpleadoHospital,
  MenuContextualCeldaState,
  ServicioHospitalario,
  TipoTurnoConfig,
} from '../../models';
import { esCodigoExoneracionContrato } from '../../shared/liquidacion-horas';

@Component({
  selector: 'app-celda-menu-contextual',
  standalone: true,
  imports: [CommonModule],
  styleUrl: './celda-menu-contextual.component.css',
  template: `
    @if (menuState) {
      <div
        #menuPanel
        class="celda-context-menu"
        role="menu"
        aria-label="Acciones rápidas de celda"
        [style.left.px]="posX"
        [style.top.px]="posY"
        (contextmenu)="$event.preventDefault()">
        <div class="cm-header">
          <div class="cm-emp-row">
            <span class="cm-emp-name" [title]="empleado?.nombre || 'Colaborador'">
              {{ empleado?.nombre || 'Colaborador' }}
            </span>
            <span class="cm-day-pill">Día {{ menuState.dia }}</span>
          </div>
          <div class="cm-status-row">
            <span
              class="cm-shift-pill"
              [style.background-color]="cfgActual?.bgHex || '#f1f5f9'"
              [style.color]="cfgActual?.textHex || '#334155'"
              [style.border-color]="cfgActual?.borderHex || '#cbd5e1'">
              {{ celda?.codigo || 'Sin turno' }}
            </span>
            @if (esFijada) {
              <span class="cm-tag tag-pin" title="Protegida contra cambios automáticos y permutas">📌 Fijada</span>
            }
            @if (esAusencia) {
              <span class="cm-tag tag-lock">🔒 Ausencia</span>
            }
            @if (esCeldaEspejo) {
              <span class="cm-tag tag-mirror">📍 {{ nombreServicioEjecutor }}</span>
            }
            @if (esCerrado) {
              <span class="cm-tag tag-closed">🔒 Cerrado</span>
            }
            @if (celda?.nota) {
              <span class="cm-tag tag-note" [title]="celda?.nota || ''">💬 Nota</span>
            }
          </div>
        </div>

        @if (!esSoloLecturaPortal) {
          <div class="cm-quick-section">
            <div class="cm-section-label">
              Asignación rápida
              @if (esFijada) {
                <span class="cm-blocked-hint">(desfija primero)</span>
              }
            </div>
            <div class="cm-shifts-grid">
              @for (t of turnosRapidos; track t.codigo) {
                <button
                  type="button"
                  role="menuitem"
                  class="cm-shift-chip"
                  [class.active]="celda?.codigo === t.codigo"
                  [disabled]="!puedeEditarTurno || celda?.codigo === t.codigo"
                  [style.background-color]="t.bgHex"
                  [style.color]="t.textHex"
                  [style.border-color]="t.borderHex"
                  [title]="t.nombre + ' (' + t.horario + ')'"
                  (click)="onAplicarTurno(t.codigo)">
                  {{ t.codigo }}
                </button>
              }
            </div>
          </div>

          <div class="cm-divider"></div>

          <button
            type="button"
            role="menuitem"
            class="cm-action-btn"
            [disabled]="!puedeAlternarFijacion"
            (click)="onAlternarFijacion()">
            <span class="cm-act-icon">{{ esFijada ? '🔓' : '📌' }}</span>
            <span>{{ esFijada ? 'Desfijar celda' : 'Fijar celda' }}</span>
          </button>

          @if (mostrarRevertirPrevisto) {
            <button
              type="button"
              role="menuitem"
              class="cm-action-btn"
              [disabled]="!puedeEditarTurno"
              (click)="onRevertirAPrevisto()">
              <span class="cm-act-icon">↩️</span>
              <span>Revertir a previsto ({{ celda?.previsto || 'Vacío' }})</span>
            </button>
          }

          @if (celda?.codigo) {
            <button
              type="button"
              role="menuitem"
              class="cm-action-btn"
              [disabled]="!puedeEditarTurno"
              (click)="onAplicarTurno('')">
              <span class="cm-act-icon">🧹</span>
              <span>Limpiar celda</span>
            </button>
          }

          <button
            type="button"
            role="menuitem"
            class="cm-action-btn"
            (click)="onAbrirDrawer('NOTA')">
            <span class="cm-act-icon">💬</span>
            <span>{{ celda?.nota ? 'Editar nota de celda...' : 'Agregar nota de celda...' }}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            class="cm-action-btn"
            [disabled]="!puedeAbrirApoyo"
            (click)="onAbrirDrawer('APOYO')">
            <span class="cm-act-icon">🔄</span>
            <span>Apoyo puntual 1 día...</span>
          </button>

          <div class="cm-divider"></div>
        } @else {
          <button
            type="button"
            role="menuitem"
            class="cm-action-btn"
            [disabled]="!puedePermutar"
            (click)="onProponerPermuta()">
            <span class="cm-act-icon">🔄</span>
            <span>Proponer Permuta este día</span>
          </button>
          @if (!puedePermutar && motivoNoPermuta) {
            <div class="cm-readonly-note">{{ motivoNoPermuta }}</div>
          }
          <div class="cm-divider"></div>
        }

        <button
          type="button"
          role="menuitem"
          class="cm-action-btn cm-action-primary"
          (click)="onAbrirDrawer()">
          <span class="cm-act-icon">🔍</span>
          <span>Ver detalle e historial (F2)</span>
        </button>
      </div>
    }
  `,
})
export class CeldaMenuContextualComponent implements OnChanges {
  @ViewChild('menuPanel') menuPanelRef?: ElementRef<HTMLDivElement>;

  @Input() menuState: MenuContextualCeldaState | null = null;
  @Input() empleado?: EmpleadoHospital;
  @Input() celda?: CeldaAsignacion;
  @Input() servicioActual?: ServicioHospitalario;
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() turnosPaleta: TipoTurnoConfig[] = [];
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};
  @Input() estadoCuadrante = 'BORRADOR';
  @Input() esColaborador = false;

  @Output() cerrar = new EventEmitter<void>();
  @Output() aplicarTurno = new EventEmitter<{ empId: string; dia: number; codigo: CodigoTurno }>();
  @Output() revertirAPrevisto = new EventEmitter<{ empId: string; dia: number }>();
  @Output() alternarFijacion = new EventEmitter<{ empId: string; dia: number }>();
  @Output() abrirDrawer = new EventEmitter<{
    empId: string;
    dia: number;
    origenVista: 'PLANIFICADOR' | 'PORTAL';
    focoSeccion?: 'NOTA' | 'APOYO' | 'EDICION';
  }>();
  @Output() seleccionarPermutaDia = new EventEmitter<number>();

  posX = 12;
  posY = 12;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['menuState'] && this.menuState) {
      this.aplicarPosicionInicial(this.menuState);
      setTimeout(() => this.ajustarDentroViewport(), 0);
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.menuState) return;
    const panel = this.menuPanelRef?.nativeElement;
    if (panel && event.target instanceof Node && panel.contains(event.target)) {
      return;
    }
    this.cerrar.emit();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (!this.menuState) return;
    event.preventDefault();
    event.stopPropagation();
    this.cerrar.emit();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.menuState) {
      this.ajustarDentroViewport();
    }
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    if (this.menuState) {
      this.cerrar.emit();
    }
  }

  private aplicarPosicionInicial(state: MenuContextualCeldaState): void {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    this.posX = Math.max(8, Math.min(state.clientX, vw - 275));
    this.posY = Math.max(8, Math.min(state.clientY, vh - 300));
  }

  private ajustarDentroViewport(): void {
    const state = this.menuState;
    const el = this.menuPanelRef?.nativeElement;
    if (!state || !el || typeof window === 'undefined') return;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let x = state.clientX;
    let y = state.clientY;
    if (x + rect.width + margin > vw) {
      x = Math.max(margin, state.clientX - rect.width);
      if (x + rect.width + margin > vw) {
        x = Math.max(margin, vw - rect.width - margin);
      }
    }
    if (y + rect.height + margin > vh) {
      y = Math.max(margin, state.clientY - rect.height);
      if (y + rect.height + margin > vh) {
        y = Math.max(margin, vh - rect.height - margin);
      }
    }
    this.posX = Math.round(x);
    this.posY = Math.round(y);
  }

  get cfgActual(): TipoTurnoConfig | undefined {
    return this.celda?.codigo ? this.catalogoTurnosMap[this.celda.codigo] : undefined;
  }

  get esSoloLecturaPortal(): boolean {
    return this.esColaborador || this.menuState?.origenVista === 'PORTAL';
  }

  get esAusencia(): boolean {
    return Boolean(this.cfgActual?.esAusencia || esCodigoExoneracionContrato(this.celda?.codigo));
  }

  get esCerrado(): boolean {
    return this.estadoCuadrante === 'CERRADO_NOMINA';
  }

  get esFijada(): boolean {
    return Boolean(this.celda?.fijada);
  }

  get esCeldaEspejo(): boolean {
    if (this.menuState?.origenVista !== 'PLANIFICADOR') return false;
    const cod = (this.celda?.codigo || '').trim().toUpperCase();
    if (!cod || cod === 'L' || this.esAusencia) return false;
    return Boolean(
      this.celda?.servicioEjecutorId &&
        this.servicioActual?.id &&
        this.celda.servicioEjecutorId !== this.servicioActual.id
    );
  }

  get nombreServicioEjecutor(): string {
    const srv = this.servicios.find((s) => s.id === this.celda?.servicioEjecutorId);
    return srv?.codigo || srv?.nombre || 'Otro servicio';
  }

  get puedeAlternarFijacion(): boolean {
    return !this.esSoloLecturaPortal && !this.esCerrado && !this.esAusencia && !this.esCeldaEspejo;
  }

  get puedeEditarTurno(): boolean {
    return this.puedeAlternarFijacion && !this.esFijada;
  }

  get puedeAbrirApoyo(): boolean {
    return !this.esSoloLecturaPortal && !this.esCerrado && !this.esAusencia && !this.esFijada;
  }

  get mostrarRevertirPrevisto(): boolean {
    return (
      !this.esSoloLecturaPortal &&
      this.celda?.previsto !== undefined &&
      (this.celda.codigo || '') !== (this.celda.previsto || '')
    );
  }

  get turnosRapidos(): TipoTurnoConfig[] {
    const filtrados = (this.turnosPaleta || []).filter(
      (t) =>
        t.activo !== false &&
        !t.esAusencia &&
        !esCodigoExoneracionContrato(t.codigo) &&
        t.codigo !== 'BLANCO' &&
        t.codigo !== 'L'
    );
    const seleccionados = filtrados.slice(0, 6);
    const turnoL = this.catalogoTurnosMap['L'];
    return turnoL ? [...seleccionados, turnoL] : seleccionados;
  }

  get puedePermutar(): boolean {
    return (
      this.estadoCuadrante === 'PUBLICADO' &&
      Boolean(this.celda?.codigo) &&
      !this.esAusencia &&
      !this.cfgActual?.bloqueaPermutas &&
      !this.esFijada
    );
  }

  get motivoNoPermuta(): string {
    if (this.estadoCuadrante !== 'PUBLICADO') return 'Disponible solo cuando el cuadrante esté Publicado.';
    if (!this.celda?.codigo) return 'Sin turno asignado en este día.';
    if (this.esAusencia) return 'Bloqueado por novedad oficial de RRHH.';
    if (this.cfgActual?.bloqueaPermutas) return 'Tipo de turno restringido para permuta.';
    if (this.esFijada) return '📌 Celda fijada por coordinación.';
    return '';
  }

  onAplicarTurno(codigo: CodigoTurno): void {
    if (!this.menuState || !this.puedeEditarTurno) return;
    this.aplicarTurno.emit({
      empId: this.menuState.empId,
      dia: this.menuState.dia,
      codigo,
    });
    this.cerrar.emit();
  }

  onRevertirAPrevisto(): void {
    if (!this.menuState || !this.puedeEditarTurno) return;
    this.revertirAPrevisto.emit({
      empId: this.menuState.empId,
      dia: this.menuState.dia,
    });
    this.cerrar.emit();
  }

  onAlternarFijacion(): void {
    if (!this.menuState || !this.puedeAlternarFijacion) return;
    this.alternarFijacion.emit({
      empId: this.menuState.empId,
      dia: this.menuState.dia,
    });
    this.cerrar.emit();
  }

  onAbrirDrawer(focoSeccion?: 'NOTA' | 'APOYO' | 'EDICION'): void {
    if (!this.menuState) return;
    this.abrirDrawer.emit({
      empId: this.menuState.empId,
      dia: this.menuState.dia,
      origenVista: this.menuState.origenVista,
      focoSeccion,
    });
    this.cerrar.emit();
  }

  onProponerPermuta(): void {
    if (!this.menuState || !this.puedePermutar) return;
    this.seleccionarPermutaDia.emit(this.menuState.dia);
    this.cerrar.emit();
  }
}
