import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FestivoEntry } from '../../models';
import { hoyColombiaIso } from '../../shared/liquidacion-horas';

@Component({
  selector: 'app-configuracion-festivos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './configuracion-festivos.component.css',
  template: `
    <div class="two-col-panels">
      <div class="panel-card">
        <div class="panel-header festivos-panel-header">
          <h3>🇨🇴 Festivos Oficiales y Días Cívicos {{ anioSeleccionado }}</h3>
          <div class="month-stepper">
            <button
              type="button"
              class="btn-nav-month"
              aria-label="Ver año anterior"
              (click)="cambiarAnio.emit(anioSeleccionado - 1)"
              title="Ver año anterior">
              ◀
            </button>
            <select
              class="select-month-input"
              aria-label="Seleccionar año del calendario de festivos"
              [ngModel]="anioSeleccionado"
              (ngModelChange)="cambiarAnio.emit(+$event)">
              @for (a of aniosDisponibles; track a) {
                <option [value]="a">{{ a }}</option>
              }
            </select>
            <button
              type="button"
              class="btn-nav-month"
              aria-label="Ver año siguiente"
              (click)="cambiarAnio.emit(anioSeleccionado + 1)"
              title="Ver año siguiente">
              ▶
            </button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Celebración</th>
              <th>Tipo</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            @for (f of listaFestivosAnio; track f.fecha) {
              <tr>
                <td class="font-mono"><strong>{{ f.fecha }}</strong></td>
                <td>{{ f.nombre }}</td>
                <td>
                  @if (f.esOficialLey) {
                    <span class="badge-law">Festivo Nacional</span>
                  } @else {
                    <span class="badge-custom">Día Cívico</span>
                  }
                </td>
                <td>
                  @if (!f.esOficialLey) {
                    <button type="button" class="btn-reject" (click)="eliminarDiaCivico.emit(f.fecha)">Eliminar</button>
                  } @else {
                    <span class="text-muted">Oficial</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="panel-card">
        <div class="panel-header">
          <h3>➕ Agregar Día Cívico Institucional</h3>
        </div>
        <div class="form-stack">
          <label for="festivo-fecha-input">Fecha:</label>
          <input
            id="festivo-fecha-input"
            type="date"
            [ngModel]="nuevoFestivoFecha"
            (ngModelChange)="cambiarNuevoFestivoFecha.emit($event)"
          />

          <label for="festivo-nombre-input">Nombre o Motivo:</label>
          <input
            id="festivo-nombre-input"
            type="text"
            placeholder="Ej. Día del Hospital"
            [ngModel]="nuevoFestivoNombre"
            (ngModelChange)="cambiarNuevoFestivoNombre.emit($event)"
          />

          <button type="button" class="btn-primary" (click)="agregarDiaCivico.emit()">
            💾 Agregar Día Cívico
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfiguracionFestivosComponent {
  @Input() anioSeleccionado = Number(hoyColombiaIso().substring(0, 4));
  @Input() aniosDisponibles: number[] = [];
  @Input() listaFestivosAnio: FestivoEntry[] = [];
  @Input() nuevoFestivoFecha = '';
  @Input() nuevoFestivoNombre = '';

  @Output() cambiarAnio = new EventEmitter<number>();
  @Output() eliminarDiaCivico = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoFecha = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoNombre = new EventEmitter<string>();
  @Output() agregarDiaCivico = new EventEmitter<void>();
}
