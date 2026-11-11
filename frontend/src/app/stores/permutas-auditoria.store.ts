import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, map, Observable, of, Subject, switchMap } from 'rxjs';
import {
  CeldaAsignacion,
  CodigoTurno,
  PermutaItem,
  RegistroAuditoria,
} from '../models';
import { TurnosApiService } from '../turnos-api.service';
import {
  calcularDescansoEntreTurnosMin,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
} from '../shared/liquidacion-horas';
import { CatalogosSsoStore } from './catalogos-sso.store';
import { CuadranteStore } from './cuadrante.store';
import { NotificacionStore } from './notificacion.store';

@Injectable({ providedIn: 'root' })
export class PermutasAuditoriaStore {
  private readonly api = inject(TurnosApiService);
  private readonly notificacion = inject(NotificacionStore);
  private readonly catalogos = inject(CatalogosSsoStore);
  private readonly cuadrante = inject(CuadranteStore);

  readonly listaPermutas = signal<PermutaItem[]>([]);
  readonly bitacoraAuditoria = signal<RegistroAuditoria[]>([]);

  private readonly auditoriaFiltroSubject = new Subject<{
    servicioId?: string;
    tipoAccion?: string;
    fechaInicio?: string;
    fechaFin?: string;
  }>();

  // Permutas visibles en la vista de Solicitudes según el rol y servicio activo
  readonly permutasVisiblesDashboard = computed<PermutaItem[]>(() => {
    const todas = this.listaPermutas();
    const sesion = this.catalogos.sesionActual();
    const srvActivo = this.catalogos.servicioSeleccionadoId();

    if (sesion && sesion.rol === 'COLABORADOR') {
      return todas.filter(
        (p) => p.solicitanteId === sesion.empleadoId || p.receptorId === sesion.empleadoId
      );
    }

    if (sesion && sesion.rol === 'COORDINADOR') {
      const permitidos = new Set(sesion.serviciosPermitidosIds || [sesion.servicioBaseId]);
      return todas.filter((p) => p.servicioId === srvActivo && permitidos.has(p.servicioId));
    }

    return todas.filter((p) => !srvActivo || p.servicioId === srvActivo);
  });

  // Notificaciones dinámicas de Solicitudes según el rol (Badge numérico en el menú lateral)
  readonly notificacionesSolicitudesCount = computed<number>(() => {
    const sesion = this.catalogos.sesionActual();
    if (!sesion) {
      return 0;
    }
    if (this.catalogos.esColaborador()) {
      return this.listaPermutas().filter(
        (p) => p.receptorId === sesion.empleadoId && p.estado === 'PENDIENTE_PAR'
      ).length;
    }
    return this.permutasVisiblesDashboard().filter((p) => p.estado === 'PENDIENTE_SUPERVISOR').length;
  });

  constructor() {
    this.auditoriaFiltroSubject
      .pipe(
        switchMap((filtros) => this.crearObsAuditorias(filtros)),
        takeUntilDestroyed()
      )
      .subscribe();

    this.cuadrante.cuadranteEditadoPublicado$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.sincronizarAuditoriasDesdePostgres();
      });
  }

  crearObsAuditorias(filtros?: {
    servicioId?: string;
    tipoAccion?: string;
    fechaInicio?: string;
    fechaFin?: string;
  }): Observable<RegistroAuditoria[]> {
    const permitidos = new Set(this.catalogos.serviciosVisibles().map((s) => s.id));
    let srvId =
      filtros?.servicioId !== undefined
        ? filtros.servicioId
        : this.catalogos.esAdminTh()
          ? 'TODOS'
          : this.catalogos.servicioSeleccionadoId();

    if (!this.catalogos.esAdminTh() && srvId === 'TODOS' && permitidos.size === 1) {
      srvId = Array.from(permitidos)[0];
    }

    return this.api
      .obtenerAuditorias(srvId, 500, filtros?.tipoAccion, filtros?.fechaInicio, filtros?.fechaFin)
      .pipe(
        map((logs) => {
          const lista = Array.isArray(logs) ? logs : [];
          const filtrados = this.catalogos.esAdminTh()
            ? lista
            : lista.filter((l) => Boolean(l.servicioId && permitidos.has(l.servicioId)));
          this.bitacoraAuditoria.set(filtrados);
          try {
            localStorage.removeItem('rafa_turnos_auditoria');
          } catch {}
          return filtrados;
        }),
        catchError(() => of([]))
      );
  }

  sincronizarAuditoriasDesdePostgres(
    filtroSrv?: string | { servicioId?: string; tipoAccion?: string; fechaInicio?: string; fechaFin?: string }
  ): void {
    const filtrosObj =
      typeof filtroSrv === 'string'
        ? { servicioId: filtroSrv }
        : filtroSrv || {};
    this.auditoriaFiltroSubject.next(filtrosObj);
  }

  sincronizarPermutasDesdePostgres(): void {
    this.api.getPermutas().subscribe({
      next: (permutasDb) => {
        if (Array.isArray(permutasDb)) {
          this.listaPermutas.set(permutasDb);
          try {
            localStorage.removeItem('rafa_turnos_permutas');
          } catch {}
        }
      },
      error: () => {},
    });
  }

  validarReglasPermuta(
    emp1Id: string,
    emp2Id: string,
    dia: number,
    turno1: string,
    turno2: string,
    contexto?: {
      anio: number;
      mes: number;
      matriz: Record<string, Record<number, CeldaAsignacion>>;
      totalDias: number;
    }
  ): { valida: boolean; motivo: string } {
    const emp1 = this.catalogos.empleados().find((e) => e.id === emp1Id);
    const emp2 = this.catalogos.empleados().find((e) => e.id === emp2Id);
    if (!emp1 || !emp2) {
      return { valida: false, motivo: 'Colaborador no encontrado en la plantilla.' };
    }

    if (emp1.categoria !== emp2.categoria) {
      return {
        valida: false,
        motivo: `RN-05 Incompatibilidad: ${emp1.nombre} (${emp1.categoria}) no puede permutar con ${emp2.nombre} (${emp2.categoria}).`,
      };
    }

    const catalogo = this.catalogos.catalogoTurnosMap();
    const cfgT1 = catalogo[turno1];
    const cfgT2 = catalogo[turno2];

    if (
      esCodigoExoneracionContrato(turno1) ||
      esCodigoExoneracionContrato(turno2) ||
      cfgT1?.esAusencia ||
      cfgT2?.esAusencia
    ) {
      return {
        valida: false,
        motivo: 'No se permiten permutas sobre periodos con Novedades Oficiales de RRHH (Vacaciones, Incapacidades, Licencias o Día de la Familia).',
      };
    }

    if (turno1 === turno2) {
      return {
        valida: false,
        motivo: `Ambos colaboradores ya tienen el mismo turno (${turno1}) en el día ${dia}.`,
      };
    }

    const anioCtx = contexto?.anio ?? this.catalogos.anioSeleccionado();
    const mesCtx = contexto?.mes ?? this.catalogos.mesSeleccionado();
    const map = contexto?.matriz ?? this.cuadrante.asignaciones();
    const totalDias = contexto?.totalDias ?? this.cuadrante.diasDelMes().length;

    // 1. Simular descanso para Solicitante (emp1) al recibir turno2:
    const codPrev1 =
      dia === 1
        ? this.cuadrante.obtenerUltimoTurnoMesPrevioEnPeriodo(emp1Id, anioCtx, mesCtx, emp1.ultimoTurnoMesPrevio || 'L')
        : map[emp1Id]?.[dia - 1]?.codigo || '';
    const cfgPrev1 = catalogo[codPrev1];
    const descPrev1Min = calcularDescansoEntreTurnosMin(cfgPrev1, cfgT2);
    if (
      (cfgPrev1?.esNocturnoPesado && cfgT2 && cfgT2.horasOrdinarias > 0 && turno2 !== 'S' && turno2 !== 'L') ||
      (descPrev1Min !== null && descPrev1Min < DESCANSO_MINIMO_ENTRE_TURNOS_MIN)
    ) {
      return {
        valida: false,
        motivo: `Infracción CST Art. 160 para ${emp1.nombre}: Tu turno del día anterior (${codPrev1}) y el nuevo turno (${turno2}) dejan menos de 12h de descanso legal.`,
      };
    }
    if (dia < totalDias) {
      const codSig1 = map[emp1Id]?.[dia + 1]?.codigo || '';
      const cfgSig1 = catalogo[codSig1];
      const descSig1Min = calcularDescansoEntreTurnosMin(cfgT2, cfgSig1);
      if (
        (cfgT2?.esNocturnoPesado && cfgSig1 && cfgSig1.horasOrdinarias > 0 && codSig1 !== 'S' && codSig1 !== 'L') ||
        (descSig1Min !== null && descSig1Min < DESCANSO_MINIMO_ENTRE_TURNOS_MIN)
      ) {
        return {
          valida: false,
          motivo: `Infracción CST Art. 160 para ${emp1.nombre}: El nuevo turno (${turno2}) y tu turno siguiente (${codSig1}) dejan menos de 12h de descanso legal obligatorias.`,
        };
      }
    }

    // 2. Simular descanso para Receptor (emp2) al recibir turno1:
    const codPrev2 =
      dia === 1
        ? this.cuadrante.obtenerUltimoTurnoMesPrevioEnPeriodo(emp2Id, anioCtx, mesCtx, emp2.ultimoTurnoMesPrevio || 'L')
        : map[emp2Id]?.[dia - 1]?.codigo || '';
    const cfgPrev2 = catalogo[codPrev2];
    const descPrev2Min = calcularDescansoEntreTurnosMin(cfgPrev2, cfgT1);
    if (
      (cfgPrev2?.esNocturnoPesado && cfgT1 && cfgT1.horasOrdinarias > 0 && turno1 !== 'S' && turno1 !== 'L') ||
      (descPrev2Min !== null && descPrev2Min < DESCANSO_MINIMO_ENTRE_TURNOS_MIN)
    ) {
      return {
        valida: false,
        motivo: `Infracción CST Art. 160 para ${emp2.nombre}: Su turno del día anterior (${codPrev2}) y el turno que recibiría (${turno1}) dejan menos de 12h de descanso legal.`,
      };
    }
    if (dia < totalDias) {
      const codSig2 = map[emp2Id]?.[dia + 1]?.codigo || '';
      const cfgSig2 = catalogo[codSig2];
      const descSig2Min = calcularDescansoEntreTurnosMin(cfgT1, cfgSig2);
      if (
        (cfgT1?.esNocturnoPesado && cfgSig2 && cfgSig2.horasOrdinarias > 0 && codSig2 !== 'S' && codSig2 !== 'L') ||
        (descSig2Min !== null && descSig2Min < DESCANSO_MINIMO_ENTRE_TURNOS_MIN)
      ) {
        return {
          valida: false,
          motivo: `Infracción CST Art. 160 para ${emp2.nombre}: Recibiría (${turno1}) y su turno siguiente (${codSig2}) dejaría menos de 12h de descanso legal.`,
        };
      }
    }

    return {
      valida: true,
      motivo: `Mismo cargo asistencial (${emp1.categoria}) y descanso mínimo de 12h verificado para ambos.`,
    };
  }

  crearPermutaDesdePortal(
    dto: {
      solicitanteId: string;
      receptorId: string;
      servicioId: string;
      anio: number;
      mes: number;
      diaOrigen: number;
      turnoOrigen: string;
      diaDestino: number;
      turnoDestino: string;
      validacionReglas?: string;
    },
    nombreReceptor: string
  ): void {
    this.api.crearPermuta(dto).subscribe({
      next: (permutaCreada) => {
        this.listaPermutas.set([permutaCreada, ...this.listaPermutas()]);
        this.notificacion.mostrar(
          `📩 Propuesta enviada a ${nombreReceptor}. Esperando su aceptación (Paso 1 de 2).`
        );
      },
      error: (err) => {
        const msg = err?.error?.message || 'No fue posible conectar con el servidor.';
        this.notificacion.mostrar(`⛔ No se pudo enviar la propuesta: ${msg}`);
      },
    });
  }

  aceptarPropuestaPar(idPermuta: string): void {
    this.api.aceptarPermutaPar(idPermuta).subscribe({
      next: () => {
        this.listaPermutas.set(
          this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'PENDIENTE_SUPERVISOR' } : p))
        );
        this.notificacion.mostrar('✅ Has aceptado la propuesta. Fue enviada a la Supervisora para su visto bueno final.');
      },
      error: (err) => {
        const msg = err?.error?.message || 'No fue posible aceptar la propuesta en el servidor.';
        this.notificacion.mostrar(`⛔ ${msg}`);
        this.sincronizarPermutasDesdePostgres();
      },
    });
  }

  rechazarPropuestaPar(data: string | { id: string; motivo?: string }): void {
    const idPermuta = typeof data === 'string' ? data : data.id;
    const motivo = (typeof data === 'object' && data.motivo?.trim())
      ? data.motivo.trim()
      : 'Declinada por el compañero receptor';
    this.api.rechazarPermutaPar(idPermuta, motivo).subscribe({
      next: () => {
        this.listaPermutas.set(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: motivo } : p
          )
        );
        this.notificacion.mostrar('ℹ️ Has declinado la propuesta de intercambio de turno.');
      },
      error: (err) => {
        const msg = err?.error?.message || 'No fue posible declinar la propuesta en el servidor.';
        this.notificacion.mostrar(`⛔ ${msg}`);
        this.sincronizarPermutasDesdePostgres();
      },
    });
  }

  aprobarPermuta(idPermuta: string): void {
    const perm = this.listaPermutas().find((p) => p.id === idPermuta);
    if (!perm) return;

    this.api.aprobarPermuta(idPermuta).subscribe({
      next: (res: {
        cambiosAplicados?: { empleadoId: string; anio: number; mes: number; dia: number; codigo: string }[];
      }) => {
        const cambios = res?.cambiosAplicados || [];
        if (cambios.length > 0) {
          this.cuadrante.asignacionesPorPeriodo.update((todo) => {
            const copia = { ...todo };
            for (const c of cambios) {
              const key = `${c.anio}-${c.mes}`;
              const mapaPeriodo = { ...(copia[key] || {}) };
              const fila = { ...(mapaPeriodo[c.empleadoId] || {}) };
              const anterior = fila[c.dia];
              fila[c.dia] = {
                ...anterior,
                codigo: c.codigo as CodigoTurno,
                previsto: anterior?.previsto ?? anterior?.codigo ?? '',
                servicioEjecutorId: perm.servicioId,
              };
              mapaPeriodo[c.empleadoId] = fila;
              copia[key] = mapaPeriodo;
            }
            return copia;
          });
        }

        this.listaPermutas.set(
          this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'APROBADA' } : p))
        );

        this.sincronizarAuditoriasDesdePostgres();

        this.notificacion.mostrar('✅ Cambio de turno aprobado por Supervisión y actualizado en el cuadrante.');
      },
      error: (err) => {
        const msg = err?.error?.message || 'No fue posible conectar con el servidor.';
        this.notificacion.mostrar(`⛔ No se aprobó la permuta: ${msg}`);
      },
    });
  }

  rechazarPermuta(data: string | { id: string; motivo?: string }): void {
    const idPermuta = typeof data === 'string' ? data : data.id;
    const motivo = (typeof data === 'object' && data.motivo?.trim())
      ? data.motivo.trim()
      : 'Rechazada por la supervisora asistencial';
    this.api.rechazarPermuta(idPermuta, motivo).subscribe({
      next: () => {
        this.listaPermutas.set(
          this.listaPermutas().map((p) =>
            p.id === idPermuta ? { ...p, estado: 'RECHAZADA', motivoRechazo: motivo } : p
          )
        );
        this.notificacion.mostrar('ℹ️ Solicitud de cambio de turno rechazada por supervisión.');
      },
      error: (err) => {
        const msg = err?.error?.message || 'No fue posible rechazar la solicitud en el servidor.';
        this.notificacion.mostrar(`⛔ ${msg}`);
        this.sincronizarPermutasDesdePostgres();
      },
    });
  }
}
