import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FestivoEntry } from '../../models';

@Component({
  selector: 'app-configuracion-festivos',
  standalone: true,
  imports: [CommonModule, FormsModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="two-col-panels">
      <div class="panel-card">
        <div class="panel-header">
          <h3>🇨🇴 Festivos Oficiales y Días Cívicos {{ anioSeleccionado }}</h3>
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
                    <button class="btn-reject" (click)="eliminarDiaCivico.emit(f.fecha)">Eliminar</button>
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
          <label>Fecha:</label>
          <input
            type="date"
            [ngModel]="nuevoFestivoFecha"
            (ngModelChange)="cambiarNuevoFestivoFecha.emit($event)"
          />

          <label>Nombre o Motivo:</label>
          <input
            type="text"
            placeholder="Ej. Día del Hospital"
            [ngModel]="nuevoFestivoNombre"
            (ngModelChange)="cambiarNuevoFestivoNombre.emit($event)"
          />

          <button class="btn-primary" (click)="agregarDiaCivico.emit()">
            💾 Agregar Día Cívico
          </button>
        </div>
      </div>
    </div>
  `,
})
export class ConfiguracionFestivosComponent {
  @Input() anioSeleccionado = 2026;
  @Input() listaFestivosAnio: FestivoEntry[] = [];
  @Input() nuevoFestivoFecha = '';
  @Input() nuevoFestivoNombre = '';

  @Output() eliminarDiaCivico = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoFecha = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoNombre = new EventEmitter<string>();
  @Output() agregarDiaCivico = new EventEmitter<void>();
}
