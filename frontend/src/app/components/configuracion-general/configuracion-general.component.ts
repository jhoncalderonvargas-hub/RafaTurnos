import { Component, EventEmitter, Input, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  EmpleadoHospital,
  FestivoEntry,
  ModalidadDiasServicio,
  ReglaCargoServicio,
  ServicioHospitalario,
  TipoAsistencia,
  TipoTurnoConfig,
} from '../../models';
import { ConfiguracionServiciosComponent } from '../configuracion-servicios/configuracion-servicios.component';
import {
  CalculoAutomaticoHorasTurno,
  ConfiguracionCatalogoTurnosComponent,
  TemaColorTurno,
} from '../configuracion-catalogo-turnos/configuracion-catalogo-turnos.component';
import { ConfiguracionFestivosComponent } from '../configuracion-festivos/configuracion-festivos.component';

export type SubVistaConfiguracion = 'SERVICIOS' | 'CATALOGO_TURNOS' | 'FESTIVOS';

@Component({
  selector: 'app-configuracion-general',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ConfiguracionServiciosComponent,
    ConfiguracionCatalogoTurnosComponent,
    ConfiguracionFestivosComponent,
  ],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="view-container">
      <!-- Cabecero Principal Unificado de Configuración -->
      <div class="config-hero-card">
        <div class="config-hero-main">
          <div class="config-hero-brand">
            <div class="config-icon-badge">⚙️</div>
            <div class="config-hero-titles">
              <div class="config-title-row">
                <h2>Configuración del Sistema</h2>
                <span class="config-badge-chip">Ajustes Generales</span>
              </div>
              <p class="config-hero-desc">
                Gestión de servicios asistenciales, convenios de apoyo, catálogo de códigos de turno y calendario oficial de festivos
              </p>
            </div>
          </div>
        </div>

        <nav class="config-nav-tabs" aria-label="Módulos de Configuración">
          <button
            type="button"
            class="config-tab-btn"
            [class.active]="subVistaConfig === 'SERVICIOS'"
            (click)="cambiarSubVista.emit('SERVICIOS')">
            <span class="tab-icon">🏥</span>
            <span class="tab-text">Servicios y Apoyo</span>
            <span class="tab-count-badge">{{ servicios.length }}</span>
          </button>
          <button
            type="button"
            class="config-tab-btn"
            [class.active]="subVistaConfig === 'CATALOGO_TURNOS'"
            (click)="cambiarSubVista.emit('CATALOGO_TURNOS')">
            <span class="tab-icon">🎨</span>
            <span class="tab-text">Catálogo de Turnos</span>
            <span class="tab-count-badge">{{ listaTurnosCatalogo.length }}</span>
          </button>
          <button
            type="button"
            class="config-tab-btn"
            [class.active]="subVistaConfig === 'FESTIVOS'"
            (click)="cambiarSubVista.emit('FESTIVOS')">
            <span class="tab-icon">🇨🇴</span>
            <span class="tab-text">Calendario de Festivos</span>
            <span class="tab-count-badge">{{ listaFestivosAnio.length }}</span>
          </button>
        </nav>
      </div>

      <!-- SUB-VISTA A: SERVICIOS Y APOYO -->
      @if (subVistaConfig === 'SERVICIOS') {
        <app-configuracion-servicios
          [servicios]="servicios"
          [empleados]="empleados"
          [totalCategoriasUnicas]="totalCategoriasUnicas"
          [totalEnlacesApoyo]="totalEnlacesApoyo"
          [servicioEditandoId]="servicioEditandoId"
          [nuevoServicioCodigo]="nuevoServicioCodigo"
          [nuevoServicioNombre]="nuevoServicioNombre"
          [nuevoServicioTipoAsistencia]="nuevoServicioTipoAsistencia"
          [nuevoServicioModalidadDias]="nuevoServicioModalidadDias"
          [nuevoServicioReqManana]="nuevoServicioReqManana"
          [nuevoServicioReqTarde]="nuevoServicioReqTarde"
          [nuevoServicioReqNoche]="nuevoServicioReqNoche"
          [nuevoServicioReqMananaFds]="nuevoServicioReqMananaFds"
          [nuevoServicioReqTardeFds]="nuevoServicioReqTardeFds"
          [nuevoServicioReqNocheFds]="nuevoServicioReqNocheFds"
          [listaTurnosCatalogo]="listaTurnosCatalogo"
          [nuevoServicioTurnosHabilitados]="nuevoServicioTurnosHabilitados"
          [nuevoServicioReglasPorCargo]="nuevoServicioReglasPorCargo"
          [turnosOperativosHabilitadosEnForm]="turnosOperativosHabilitadosEnForm"
          [enlaceHermanoSrv1]="enlaceHermanoSrv1"
          [enlaceHermanoSrv2]="enlaceHermanoSrv2"
          [catalogoTurnosMap]="catalogoTurnosMap"
          (cambiarNuevoServicioCodigo)="cambiarNuevoServicioCodigo.emit($event)"
          (cambiarNuevoServicioNombre)="cambiarNuevoServicioNombre.emit($event)"
          (cambiarNuevoServicioTipoAsistencia)="cambiarNuevoServicioTipoAsistencia.emit($event)"
          (cambiarNuevoServicioModalidadDias)="cambiarNuevoServicioModalidadDias.emit($event)"
          (cambiarNuevoServicioReqManana)="cambiarNuevoServicioReqManana.emit($event)"
          (cambiarNuevoServicioReqTarde)="cambiarNuevoServicioReqTarde.emit($event)"
          (cambiarNuevoServicioReqNoche)="cambiarNuevoServicioReqNoche.emit($event)"
          (cambiarNuevoServicioReqMananaFds)="cambiarNuevoServicioReqMananaFds.emit($event)"
          (cambiarNuevoServicioReqTardeFds)="cambiarNuevoServicioReqTardeFds.emit($event)"
          (cambiarNuevoServicioReqNocheFds)="cambiarNuevoServicioReqNocheFds.emit($event)"
          (aplicarPlantillaTurnosServicio)="aplicarPlantillaTurnosServicio.emit($event)"
          (alternarTurnoEnServicioForm)="alternarTurnoEnServicioForm.emit($event)"
          (actualizarMetaCargoForm)="actualizarMetaCargoForm.emit($event)"
          (alternarTurnoEnCargoForm)="alternarTurnoEnCargoForm.emit($event)"
          (guardarServicioAutonomo)="guardarServicioAutonomo.emit()"
          (cancelarEdicionServicio)="cancelarEdicionServicio.emit()"
          (cambiarEnlaceHermanoSrv1)="cambiarEnlaceHermanoSrv1.emit($event)"
          (cambiarEnlaceHermanoSrv2)="cambiarEnlaceHermanoSrv2.emit($event)"
          (guardarEnlaceHermanos)="guardarEnlaceHermanos.emit()"
          (desenlazarServicioHermano)="desenlazarServicioHermano.emit($event)"
          (abrirCuadroServicio)="abrirCuadroServicio.emit($event)"
          (cargarServicioParaEdicion)="cargarServicioParaEdicion.emit($event)"
          (eliminarServicioAutonomo)="eliminarServicioAutonomo.emit($event)"
        />
      }

      <!-- SUB-VISTA B: CATÁLOGO DE TURNOS -->
      @if (subVistaConfig === 'CATALOGO_TURNOS') {
        <app-configuracion-catalogo-turnos
          [turnoEditandoCodigo]="turnoEditandoCodigo"
          [turnoFormCodigo]="turnoFormCodigo"
          [turnoFormNombre]="turnoFormNombre"
          [turnoFormModoJornada]="turnoFormModoJornada"
          [turnoFormHoraInicio]="turnoFormHoraInicio"
          [turnoFormHoraFin]="turnoFormHoraFin"
          [turnoFormMinutosAlmuerzo]="turnoFormMinutosAlmuerzo"
          [calc]="calc"
          [temasColorTurno]="temasColorTurno"
          [turnoFormColorKey]="turnoFormColorKey"
          [turnoFormNocturnoPesado]="turnoFormNocturnoPesado"
          [turnoFormDescuentaBanco]="turnoFormDescuentaBanco"
          [listaTurnosCatalogo]="listaTurnosCatalogo"
          (limpiarFormularioTurno)="limpiarFormularioTurno.emit()"
          (cambiarTurnoFormCodigo)="cambiarTurnoFormCodigo.emit($event)"
          (cambiarTurnoFormNombre)="cambiarTurnoFormNombre.emit($event)"
          (cambiarTurnoFormModoJornada)="cambiarTurnoFormModoJornada.emit($event)"
          (cambiarTurnoFormHoraInicio)="cambiarTurnoFormHoraInicio.emit($event)"
          (cambiarTurnoFormHoraFin)="cambiarTurnoFormHoraFin.emit($event)"
          (cambiarTurnoFormMinutosAlmuerzo)="cambiarTurnoFormMinutosAlmuerzo.emit($event)"
          (cambiarTurnoFormColorKey)="cambiarTurnoFormColorKey.emit($event)"
          (cambiarTurnoFormNocturnoPesado)="cambiarTurnoFormNocturnoPesado.emit($event)"
          (cambiarTurnoFormDescuentaBanco)="cambiarTurnoFormDescuentaBanco.emit($event)"
          (guardarTurnoEnCatalogo)="guardarTurnoEnCatalogo.emit()"
          (alternarVisibilidadTurnoPaleta)="alternarVisibilidadTurnoPaleta.emit($event)"
          (cargarTurnoParaEdicion)="cargarTurnoParaEdicion.emit($event)"
        />
      }

      <!-- SUB-VISTA C: CALENDARIO DE FESTIVOS -->
      @if (subVistaConfig === 'FESTIVOS') {
        <app-configuracion-festivos
          [anioSeleccionado]="anioSeleccionado"
          [listaFestivosAnio]="listaFestivosAnio"
          [nuevoFestivoFecha]="nuevoFestivoFecha"
          [nuevoFestivoNombre]="nuevoFestivoNombre"
          (eliminarDiaCivico)="eliminarDiaCivico.emit($event)"
          (cambiarNuevoFestivoFecha)="cambiarNuevoFestivoFecha.emit($event)"
          (cambiarNuevoFestivoNombre)="cambiarNuevoFestivoNombre.emit($event)"
          (agregarDiaCivico)="agregarDiaCivico.emit()"
        />
      }
    </div>
  `,
})
export class ConfiguracionGeneralComponent {
  @Input() subVistaConfig: SubVistaConfiguracion = 'SERVICIOS';
  @Input() servicios: ServicioHospitalario[] = [];
  @Input() empleados: EmpleadoHospital[] = [];
  @Input() totalCategoriasUnicas = 0;
  @Input() totalEnlacesApoyo = 0;
  @Input() servicioEditandoId: string | null = null;
  @Input() nuevoServicioCodigo = '';
  @Input() nuevoServicioNombre = '';
  @Input() nuevoServicioTipoAsistencia: any = 'URGENCIAS';
  @Input() nuevoServicioModalidadDias: any = 'TODOS_24_7';
  @Input() nuevoServicioReqManana = 4;
  @Input() nuevoServicioReqTarde = 4;
  @Input() nuevoServicioReqNoche = 2;
  @Input() nuevoServicioReqMananaFds = 4;
  @Input() nuevoServicioReqTardeFds = 4;
  @Input() nuevoServicioReqNocheFds = 2;
  @Input() listaTurnosCatalogo: TipoTurnoConfig[] = [];
  @Input() nuevoServicioTurnosHabilitados: string[] = [];
  @Input() nuevoServicioReglasPorCargo: ReglaCargoServicio[] = [];
  @Input() turnosOperativosHabilitadosEnForm: TipoTurnoConfig[] = [];
  @Input() enlaceHermanoSrv1 = '';
  @Input() enlaceHermanoSrv2 = '';
  @Input() catalogoTurnosMap: Record<string, TipoTurnoConfig> = {};

  @Input() turnoEditandoCodigo: string | null = null;
  @Input() turnoFormCodigo = '';
  @Input() turnoFormNombre = '';
  @Input() turnoFormModoJornada: 'HORARIO' | 'GUARDIA_24H' | 'DESCANSO' = 'HORARIO';
  @Input() turnoFormHoraInicio = '07:00';
  @Input() turnoFormHoraFin = '15:00';
  @Input() turnoFormMinutosAlmuerzo = 0;
  @Input({ required: true }) calc!: CalculoAutomaticoHorasTurno;
  @Input() temasColorTurno: TemaColorTurno[] = [];
  @Input() turnoFormColorKey = 'AZUL_CIELO';
  @Input() turnoFormNocturnoPesado = false;
  @Input() turnoFormDescuentaBanco = false;

  @Input() anioSeleccionado = 2026;
  @Input() listaFestivosAnio: FestivoEntry[] = [];
  @Input() nuevoFestivoFecha = '';
  @Input() nuevoFestivoNombre = '';

  @Output() cambiarSubVista = new EventEmitter<SubVistaConfiguracion>();
  @Output() cambiarNuevoServicioCodigo = new EventEmitter<string>();
  @Output() cambiarNuevoServicioNombre = new EventEmitter<string>();
  @Output() cambiarNuevoServicioTipoAsistencia = new EventEmitter<any>();
  @Output() cambiarNuevoServicioModalidadDias = new EventEmitter<any>();
  @Output() cambiarNuevoServicioReqManana = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqTarde = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNoche = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqMananaFds = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqTardeFds = new EventEmitter<number>();
  @Output() cambiarNuevoServicioReqNocheFds = new EventEmitter<number>();
  @Output() aplicarPlantillaTurnosServicio = new EventEmitter<'ROTATIVO_8H' | 'GUARDIAS_12_24' | 'ADMINISTRATIVO' | 'TODOS'>();
  @Output() alternarTurnoEnServicioForm = new EventEmitter<string>();
  @Output() actualizarMetaCargoForm = new EventEmitter<{ categoriaNombre: string; campo: 'reqManana' | 'reqTarde' | 'reqNoche' | 'reqMananaFds' | 'reqTardeFds' | 'reqNocheFds'; valor: number }>();
  @Output() alternarTurnoEnCargoForm = new EventEmitter<{ categoriaNombre: string; codigoTurno: string }>();
  @Output() guardarServicioAutonomo = new EventEmitter<void>();
  @Output() cancelarEdicionServicio = new EventEmitter<void>();
  @Output() cambiarEnlaceHermanoSrv1 = new EventEmitter<string>();
  @Output() cambiarEnlaceHermanoSrv2 = new EventEmitter<string>();
  @Output() guardarEnlaceHermanos = new EventEmitter<void>();
  @Output() desenlazarServicioHermano = new EventEmitter<{ srvId: string; hermanoId: string }>();
  @Output() abrirCuadroServicio = new EventEmitter<string>();
  @Output() cargarServicioParaEdicion = new EventEmitter<ServicioHospitalario>();
  @Output() eliminarServicioAutonomo = new EventEmitter<ServicioHospitalario>();

  @Output() limpiarFormularioTurno = new EventEmitter<void>();
  @Output() cambiarTurnoFormCodigo = new EventEmitter<string>();
  @Output() cambiarTurnoFormNombre = new EventEmitter<string>();
  @Output() cambiarTurnoFormModoJornada = new EventEmitter<'HORARIO' | 'GUARDIA_24H' | 'DESCANSO'>();
  @Output() cambiarTurnoFormHoraInicio = new EventEmitter<string>();
  @Output() cambiarTurnoFormHoraFin = new EventEmitter<string>();
  @Output() cambiarTurnoFormMinutosAlmuerzo = new EventEmitter<number>();
  @Output() cambiarTurnoFormColorKey = new EventEmitter<string>();
  @Output() cambiarTurnoFormNocturnoPesado = new EventEmitter<boolean>();
  @Output() cambiarTurnoFormDescuentaBanco = new EventEmitter<boolean>();
  @Output() guardarTurnoEnCatalogo = new EventEmitter<void>();
  @Output() alternarVisibilidadTurnoPaleta = new EventEmitter<string>();
  @Output() cargarTurnoParaEdicion = new EventEmitter<TipoTurnoConfig>();

  @Output() eliminarDiaCivico = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoFecha = new EventEmitter<string>();
  @Output() cambiarNuevoFestivoNombre = new EventEmitter<string>();
  @Output() agregarDiaCivico = new EventEmitter<void>();
}
