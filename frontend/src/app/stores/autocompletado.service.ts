import { Injectable } from '@angular/core';
import {
  CambioCeldaHistorial,
  CeldaAsignacion,
  CodigoTurno,
  DiaColumna,
  EmpleadoHospital,
  ServicioHospitalario,
  TipoTurnoConfig,
} from '../models';
import {
  horasLiquidadasCelda,
  obtenerTandasBreakDeTurno,
  predicadoDescansoObligatorio,
  reglasEmpresaDeEmpleado,
} from '../calculo-turnos.helper';
import { FestivosColombiaHelper } from '../festivos-colombia.helper';
import {
  calcularDescansoEntreTurnosMin,
  calcularMetaMensualPorDiasHabiles,
  contarDiasHabilesMes,
  contarDiasHabilesProrrateados,
  DESCANSO_MINIMO_ENTRE_TURNOS_MIN,
  esCodigoExoneracionContrato,
  obtenerHorasAmortizacionTurno,
  r2,
  seleccionarTandaBreakEquilibrada,
  TurnoLiquidable,
} from '../shared/liquidacion-horas';

/**
 * Determina qué franjas asistenciales (Día / Noche) cubre un tipo de turno
 * a partir de su duración y recargo nocturno (incluyendo guardias de 24h que cubren ambas).
 */
export function clasificarFranjasTurno(cfg?: TipoTurnoConfig): {
  dia: boolean;
  noche: boolean;
} {
  if (!cfg || cfg.horasOrdinarias <= 0 || cfg.esAusencia) {
    return { dia: false, noche: false };
  }
  if (cfg.horasOrdinarias >= 24) {
    return { dia: true, noche: true };
  }

  const noche = Boolean(cfg.esNocturnoPesado || cfg.horasNocturnas >= 6);
  return { dia: !noche, noche };
}

export interface FilaAutocompletadoBase {
  empleado: EmpleadoHospital;
  esPersonalRotado: boolean;
  conteoNoches: number;
  conteoDomFest: number;
  nuevoSaldoBanco: number;
}

export interface CeldaLoteAutocompletado {
  empleadoId: string;
  dia: number;
  codigo: string;
  previsto?: string;
  esRotacion?: boolean;
  breakTandaOrden?: number | null;
  breakInicio?: string | null;
  breakFin?: string | null;
}

export interface ParametrosAutocompletado {
  srv: ServicioHospitalario;
  srvId: string;
  dias: DiaColumna[];
  catalogo: Record<string, TipoTurnoConfig>;
  listaTurnosCatalogo: TipoTurnoConfig[];
  prevMapSnapshot: Record<string, Record<number, CeldaAsignacion>>;
  filasBase: FilaAutocompletadoBase[];
  filtroCategoriaActiva: string;
  enBorradorGlobal: boolean;
  obtenerMetasDiaServicio: (
    srv: ServicioHospitalario,
    d: DiaColumna,
    categoriaEspecifica?: string
  ) => { reqDia: number; reqNoche: number; cerrado: boolean };
}

export interface ResultadoAutocompletado {
  actualMap: Record<string, Record<number, CeldaAsignacion>>;
  loteParaDb: CeldaLoteAutocompletado[];
  cambiosAutocompletar: CambioCeldaHistorial[];
  totalAsignados: number;
}

@Injectable({ providedIn: 'root' })
export class AutocompletadoService {
  generarAutocompletadoCuadrante(params: ParametrosAutocompletado): ResultadoAutocompletado {
    const {
      srv,
      srvId,
      dias,
      catalogo,
      listaTurnosCatalogo,
      prevMapSnapshot,
      filasBase,
      filtroCategoriaActiva,
      enBorradorGlobal,
      obtenerMetasDiaServicio,
    } = params;

    const totalDias = dias.length;
    const esDescansoPred = predicadoDescansoObligatorio();
    const festivosEnDias = new Set(dias.filter((d) => Boolean(d.festivo)).map((d) => d.fechaIso));
    const predFest = (iso: string) =>
      Boolean(FestivosColombiaHelper.esFestivo(iso)) || festivosEnDias.has(iso);
    const actualMap: Record<string, Record<number, CeldaAsignacion>> = { ...prevMapSnapshot };
    const horasExtraLoop = new Map<string, number>();
    const nochesLoop = new Map<string, number>();
    const domFestLoop = new Map<string, number>();
    for (const f of filasBase) {
      nochesLoop.set(f.empleado.id, f.conteoNoches);
      domFestLoop.set(f.empleado.id, f.conteoDomFest);
    }

    let totalAsignados = 0;
    const loteParaDb: CeldaLoteAutocompletado[] = [];

    const metasHabilitadas = (srv.metasPorTurno || []).filter((m) => {
      if (m.habilitado === false) return false;
      const cfg = catalogo[m.codigoTurno.trim().toUpperCase()];
      return Boolean(cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia && cfg.activo !== false);
    });

    const codigosBaseServicio = Array.from(
      new Set([
        ...(srv.turnosHabilitados || []),
        ...metasHabilitadas.map((m) => m.codigoTurno),
      ])
    );

    const esCargoPermitidoEnServicio = (emp: EmpleadoHospital): boolean => {
      const idsPermitidos =
        srv.cargosPermitidosIds && srv.cargosPermitidosIds.length > 0
          ? srv.cargosPermitidosIds
          : (srv.cargosPermitidos || []).map((c) => c.categoriaId).filter(Boolean);
      const nombresPermitidos = (srv.cargosPermitidos || [])
        .map((c) => c.categoriaNombre?.trim().toLowerCase())
        .filter(Boolean);
      if (idsPermitidos.length === 0 && nombresPermitidos.length === 0) {
        return true;
      }
      if (emp.categoriaId && idsPermitidos.includes(emp.categoriaId)) return true;
      if (emp.categoria && nombresPermitidos.includes(emp.categoria.trim().toLowerCase())) return true;
      return false;
    };

    // Helper: dado un arreglo de códigos habilitados (del servicio o de un cargo), elige los turnos ideales Día/Noche
    // Incluye rotación entre turnos diurnos múltiples (ej. M8/T8 o M6/T6) cuando están habilitados juntos.
    const seleccionarTurnosIdeales = (
      listaCodigos?: string[]
    ): { turnoDia: CodigoTurno | null; turnosDiaAlternativos: CodigoTurno[]; turnoNoche: CodigoTurno | null } => {
      const setHabilitados = new Set(
        (listaCodigos && listaCodigos.length > 0 ? listaCodigos : codigosBaseServicio).map((c) =>
          c.toUpperCase()
        )
      );

      const operativos = listaTurnosCatalogo.filter(
        (t) =>
          t.activo !== false &&
          t.horasOrdinarias > 0 &&
          !t.esAusencia &&
          setHabilitados.has(t.codigo.toUpperCase())
      );

      const soloDiurnos = operativos.filter((t) => {
        const f = clasificarFranjasTurno(t);
        return f.dia && !f.noche;
      });
      const soloNocturnos = operativos.filter((t) => {
        const f = clasificarFranjasTurno(t);
        return f.noche && !f.dia;
      });
      const guardia24 = operativos.filter((t) => t.horasOrdinarias >= 24);

      const tD: CodigoTurno | null =
        soloDiurnos.find((t) => t.codigo === 'D12')?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'G12')?.codigo ||
        soloDiurnos.find((t) => t.horasOrdinarias >= 12)?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'ADM')?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'AP')?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'MD')?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'M8')?.codigo ||
        soloDiurnos.find((t) => t.codigo === 'T8')?.codigo ||
        soloDiurnos[0]?.codigo ||
        guardia24[0]?.codigo ||
        null;

      let turnosDiaAlternativos: CodigoTurno[] = tD ? [tD] : [];
      if (setHabilitados.has('M8') && setHabilitados.has('T8')) {
        turnosDiaAlternativos = ['M8', 'T8'];
      } else if (setHabilitados.has('M6') && setHabilitados.has('T6')) {
        turnosDiaAlternativos = ['M6', 'T6'];
      }

      const es12h = Boolean(
        tD && soloDiurnos.some((t) => t.codigo === tD && t.horasOrdinarias >= 12)
      );

      const tN: CodigoTurno | null =
        (es12h ? soloNocturnos.find((t) => t.codigo === 'N12')?.codigo : undefined) ||
        soloNocturnos.find((t) => t.codigo === 'N8')?.codigo ||
        soloNocturnos[0]?.codigo ||
        guardia24[0]?.codigo ||
        null;

      return { turnoDia: tD, turnosDiaAlternativos, turnoNoche: tN };
    };

    const { turnosDiaAlternativos, turnoNoche } = seleccionarTurnosIdeales(codigosBaseServicio);

    // Helper: valida que al asignar un turno operativo en diaEval no supere los 6 días consecutivos sin descanso
    const superaMaximoDiasConsecutivos = (empObj: EmpleadoHospital, diaEval: number): boolean => {
      let rachaPrevia = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const codPrev = actualMap[empObj.id]?.[prev]?.codigo || '';
        const cfgP = codPrev ? catalogo[codPrev] : undefined;
        if (cfgP && cfgP.horasOrdinarias > 0 && !cfgP.esAusencia) {
          rachaPrevia++;
        } else {
          break;
        }
      }
      if (rachaPrevia === diaEval - 1) {
        const cfgMesPrev = empObj.ultimoTurnoMesPrevio ? catalogo[empObj.ultimoTurnoMesPrevio] : undefined;
        if (cfgMesPrev && cfgMesPrev.horasOrdinarias > 0 && !cfgMesPrev.esAusencia) {
          rachaPrevia++;
        }
      }

      let rachaPosterior = 0;
      for (let sig = diaEval + 1; sig <= totalDias; sig++) {
        const codSig = actualMap[empObj.id]?.[sig]?.codigo || '';
        const cfgS = codSig ? catalogo[codSig] : undefined;
        if (cfgS && cfgS.horasOrdinarias > 0 && !cfgS.esAusencia) {
          rachaPosterior++;
        } else {
          break;
        }
      }

      return rachaPrevia + 1 + rachaPosterior > 6;
    };

    // Helper: cuenta noches consecutivas inmediatamente previas a diaEval
    const contarNochesConsecutivasPrevias = (empObj: EmpleadoHospital, diaEval: number): number => {
      let nochesSeguidas = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const codPrev = actualMap[empObj.id]?.[prev]?.codigo || '';
        const cfgP = codPrev ? catalogo[codPrev] : undefined;
        if (cfgP && clasificarFranjasTurno(cfgP).noche) {
          nochesSeguidas++;
        } else {
          break;
        }
      }
      return nochesSeguidas;
    };

    // Helper: clasifica cualquier código de turno en su fase de rotación ('D' | 'N' | 'L')
    const clasificarFaseCod = (cod?: string): 'D' | 'N' | 'L' => {
      if (!cod || cod === 'L' || cod === 'S' || cod === 'COMP') return 'L';
      const cfg = catalogo[cod];
      if (!cfg || cfg.esAusencia || cfg.horasOrdinarias <= 0) return 'L';
      const fr = clasificarFranjasTurno(cfg);
      if (fr.noche) return 'N';
      return 'D';
    };

    // Helper: obtiene la fase del día anterior, los días seguidos en esa misma fase y la racha laboral acumulada
    const obtenerEstadoRotacionPrevia = (
      empObj: EmpleadoHospital,
      diaEval: number
    ): { faseAyer: 'D' | 'N' | 'L'; rachaFase: number; rachaTrabajo: number } => {
      if (diaEval <= 1) {
        const fasePrev = clasificarFaseCod(empObj.ultimoTurnoMesPrevio);
        return {
          faseAyer: fasePrev,
          rachaFase: fasePrev === 'L' ? 2 : 1,
          rachaTrabajo: fasePrev === 'L' ? 0 : 1,
        };
      }

      const codAyer = actualMap[empObj.id]?.[diaEval - 1]?.codigo || '';
      const faseAyer = clasificarFaseCod(codAyer);

      let rachaFase = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const fPrev = clasificarFaseCod(actualMap[empObj.id]?.[prev]?.codigo || '');
        if (fPrev === faseAyer) {
          rachaFase++;
        } else {
          break;
        }
      }

      let rachaTrabajo = 0;
      for (let prev = diaEval - 1; prev >= 1; prev--) {
        const fPrev = clasificarFaseCod(actualMap[empObj.id]?.[prev]?.codigo || '');
        if (fPrev !== 'L') {
          rachaTrabajo++;
        } else {
          break;
        }
      }
      if (rachaTrabajo === diaEval - 1 && clasificarFaseCod(empObj.ultimoTurnoMesPrevio) !== 'L') {
        rachaTrabajo++;
      }

      return { faseAyer, rachaFase, rachaTrabajo };
    };

    // Helper: puntaje de rotación horaria escalonada con descanso individual (L -> D -> N -> L)
    const calcularPuntajeRotacion = (
      empObj: EmpleadoHospital,
      diaEval: number,
      faseDestino: 'D' | 'N'
    ): number => {
      const { faseAyer, rachaFase, rachaTrabajo } = obtenerEstadoRotacionPrevia(empObj, diaEval);

      if (diaEval === 1) {
        if (faseDestino === 'D') {
          return faseAyer === 'L' ? 10 : 40;
        }
        if (faseAyer === 'N') return 10;
        if (faseAyer === 'D') return 20;
        return 30;
      }

      // Si ayer descansó (L), prioridad #1 absoluta para reingresar hoy y evitar 2 días libres seguidos
      if (faseAyer === 'L') {
        return faseDestino === 'D' ? 5 : 15;
      }

      if (faseDestino === 'D') {
        if (faseAyer === 'D' && rachaFase < 2 && rachaTrabajo < 5) return 10;
        if (faseAyer === 'D' && rachaTrabajo < 5) return 20 + rachaFase;
        return 50 + rachaTrabajo;
      }

      if (faseAyer === 'D' && rachaTrabajo <= 5) return 10;
      if (faseAyer === 'N' && rachaFase < 2 && rachaTrabajo < 6) return 15;
      if (faseAyer === 'N' && rachaFase >= 2) return 60 + rachaFase;
      return 55;
    };

    const recalcularCoberturaDia = (diaNum: number, categoriaFiltro?: string) => {
      let dia = 0;
      let noche = 0;
      for (const f of filasBase) {
        if (categoriaFiltro && f.empleado.categoria !== categoriaFiltro) continue;
        const celda = actualMap[f.empleado.id]?.[diaNum];
        const cod = celda?.codigo || '';
        if (!cod) continue;
        // Propiedad por Día (Opción 1): Solo contar turnos ejecutados en el servicio actual
        if (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srv.id) continue;
        const franjas = clasificarFranjasTurno(catalogo[cod]);
        if (franjas.dia) dia++;
        if (franjas.noche) noche++;
      }
      return { dia, noche };
    };

    const contarTurnoDia = (diaNum: number, codigoTurno: string): number => {
      const target = codigoTurno.trim().toUpperCase();
      let count = 0;
      for (const f of filasBase) {
        if (filtroCategoriaActiva !== 'TODAS' && f.empleado.categoria !== filtroCategoriaActiva) {
          continue;
        }
        const celda = actualMap[f.empleado.id]?.[diaNum];
        const cod = (celda?.codigo || '').trim().toUpperCase();
        if (cod !== target) continue;
        if (celda?.servicioEjecutorId && celda.servicioEjecutorId !== srv.id) continue;
        count++;
      }
      return count;
    };

    const asignarTandaBreakEnDia = (
      diaNum: number,
      codigoTurno: string,
      cfgTurno?: TipoTurnoConfig
    ): { breakTandaOrden: number; breakInicio: string; breakFin: string } | null => {
      if (!cfgTurno || !cfgTurno.recesoHabilitado || cfgTurno.esAusencia) {
        return null;
      }
      const tandas = obtenerTandasBreakDeTurno(cfgTurno);
      if (tandas.length === 0) return null;

      const codTarget = codigoTurno.trim().toUpperCase();
      const conteos: Record<number, number> = {};
      for (const f of filasBase) {
        const c = actualMap[f.empleado.id]?.[diaNum];
        if (!c) continue;
        if ((c.codigo || '').trim().toUpperCase() !== codTarget) continue;
        if (c.servicioEjecutorId && c.servicioEjecutorId !== srv.id) continue;
        const orden = c.breakTandaOrden ?? tandas[0].orden;
        conteos[orden] = (conteos[orden] || 0) + 1;
      }

      const elegida = seleccionarTandaBreakEquilibrada(tandas, conteos, Math.max(0, diaNum - 1));
      if (!elegida) return null;
      return {
        breakTandaOrden: elegida.orden,
        breakInicio: elegida.inicio,
        breakFin: elegida.fin,
      };
    };

    const modServicio = srv.modalidadDias || 'TODOS_24_7';
    const esDiaCerradoServicio = (d: DiaColumna): boolean => {
      const esDomOFest = d.esDomingo || Boolean(d.festivo);
      if (esDomOFest && (modServicio === 'LUN_VIE_HABILES' || modServicio === 'LUN_SAB_SIN_FESTIVOS')) {
        return true;
      }
      if (d.esSabado && modServicio === 'LUN_VIE_HABILES') {
        return true;
      }
      return false;
    };

    const cubrirEnDia = (
      d: DiaColumna,
      turnosCandidatos: CodigoTurno | CodigoTurno[] | null,
      cant: number,
      categoriaObjetivo?: string
    ) => {
      if (!turnosCandidatos || cant <= 0) return;
      const listaOpciones = (Array.isArray(turnosCandidatos) ? turnosCandidatos : [turnosCandidatos]).filter(Boolean);
      if (listaOpciones.length === 0) return;

      const setSrvHab = new Set(codigosBaseServicio.map((c) => c.toUpperCase()));
      const esDomOFest = d.esDomingo || !!d.festivo;

      const turnoPorSlot = (slotIdx: number): CodigoTurno =>
        listaOpciones[(slotIdx + d.dia) % listaOpciones.length];

      const turnoBase = turnoPorSlot(0);
      const cfgBase = catalogo[turnoBase];
      if (!cfgBase || cfgBase.activo === false || cfgBase.esAusencia) return;
      const franjasBase = clasificarFranjasTurno(cfgBase);
      const faseDestino: 'D' | 'N' = franjasBase.noche ? 'N' : 'D';

      const puedeAsignarTurnoCandidato = (
        f: FilaAutocompletadoBase,
        turnoEvaluar: CodigoTurno
      ): boolean => {
        if (!esCargoPermitidoEnServicio(f.empleado)) return false;

        const codUpper = turnoEvaluar.toUpperCase();
        if (setSrvHab.size > 0 && !setSrvHab.has(codUpper)) return false;

        const reglaCargoEmp = (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === f.empleado.categoria);
        if (reglaCargoEmp?.turnosHabilitados && reglaCargoEmp.turnosHabilitados.length > 0) {
          const setCatHab = new Set(reglaCargoEmp.turnosHabilitados.map((c) => c.toUpperCase()));
          if (!setCatHab.has(codUpper)) return false;
        }

        const cfgTurno = catalogo[turnoEvaluar];
        if (!cfgTurno || cfgTurno.activo === false || cfgTurno.esAusencia) return false;
        const franjasTurno = clasificarFranjasTurno(cfgTurno);

        const celdaHoy = actualMap[f.empleado.id]?.[d.dia];
        if (celdaHoy?.fijada) return false;
        const hoy = celdaHoy?.codigo || '';
        if (celdaHoy?.servicioEjecutorId && celdaHoy.servicioEjecutorId !== srv.id && hoy !== '' && hoy !== 'L') {
          return false;
        }
        if (hoy !== '' && hoy !== 'L') return false;

        if (superaMaximoDiasConsecutivos(f.empleado, d.dia)) return false;
        if (franjasTurno.noche && contarNochesConsecutivasPrevias(f.empleado, d.dia) >= 3) return false;

        const ayer =
          d.dia === 1
            ? f.empleado.ultimoTurnoMesPrevio
            : actualMap[f.empleado.id]?.[d.dia - 1]?.codigo || '';
        const cfgAyer = catalogo[ayer];
        if (cfgAyer?.esNocturnoPesado) return false;
        const descansoDesdeAyerMin = calcularDescansoEntreTurnosMin(cfgAyer, cfgTurno);
        if (descansoDesdeAyerMin !== null && descansoDesdeAyerMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) return false;

        if (d.dia < totalDias) {
          const celdaSig = actualMap[f.empleado.id]?.[d.dia + 1];
          const sigCod = celdaSig?.codigo || '';
          const cfgSig = catalogo[sigCod];
          const bloqueadoOtroSig =
            celdaSig?.servicioEjecutorId &&
            celdaSig.servicioEjecutorId !== srv.id &&
            sigCod !== '' &&
            sigCod !== 'L';
          if (cfgTurno.esNocturnoPesado) {
            if (
              bloqueadoOtroSig ||
              (celdaSig?.fijada && !sigCod) ||
              esCodigoExoneracionContrato(sigCod) ||
              cfgSig?.esAusencia ||
              cfgSig?.prorrateaMetaContrato ||
              cfgSig?.descuentaBancoHoras ||
              (cfgSig && cfgSig.horasOrdinarias > 0)
            ) {
              return false;
            }
          } else {
            const descansoHaciaSigMin = calcularDescansoEntreTurnosMin(cfgTurno, cfgSig);
            if (descansoHaciaSigMin !== null && descansoHaciaSigMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) {
              return false;
            }
          }
        }
        return true;
      };

      const candidatos = [...filasBase]
        .filter((f) => {
          if (f.esPersonalRotado) return false;
          if (!esCargoPermitidoEnServicio(f.empleado)) return false;
          if (categoriaObjetivo && f.empleado.categoria !== categoriaObjetivo) return false;
          return listaOpciones.some((tOp) => puedeAsignarTurnoCandidato(f, tOp));
        })
        .sort((a, b) => {
          const scoreRotA = calcularPuntajeRotacion(a.empleado, d.dia, faseDestino);
          const scoreRotB = calcularPuntajeRotacion(b.empleado, d.dia, faseDestino);
          if (scoreRotA !== scoreRotB) return scoreRotA - scoreRotB;

          if (franjasBase.noche) {
            const diffNoches =
              (nochesLoop.get(a.empleado.id) || 0) - (nochesLoop.get(b.empleado.id) || 0);
            if (diffNoches !== 0) return diffNoches;
          }
          if (esDomOFest) {
            const diffDom =
              (domFestLoop.get(a.empleado.id) || 0) - (domFestLoop.get(b.empleado.id) || 0);
            if (diffDom !== 0) return diffDom;
          }
          return (
            a.nuevoSaldoBanco +
            (horasExtraLoop.get(a.empleado.id) || 0) -
            (b.nuevoSaldoBanco + (horasExtraLoop.get(b.empleado.id) || 0))
          );
        });

      let asignadosEnSlot = 0;
      for (const cand of candidatos) {
        if (asignadosEnSlot >= cant) break;
        const preferidoSlot = turnoPorSlot(asignadosEnSlot);
        const turnoElegido = puedeAsignarTurnoCandidato(cand, preferidoSlot)
          ? preferidoSlot
          : listaOpciones.find((tOp) => puedeAsignarTurnoCandidato(cand, tOp));
        if (!turnoElegido) continue;

        const cfgTurno = catalogo[turnoElegido];
        if (!cfgTurno) continue;
        const franjasTurno = clasificarFranjasTurno(cfgTurno);
        const esNocturno = Boolean(cfgTurno.esNocturnoPesado);
        const reglasCand = reglasEmpresaDeEmpleado(cand.empleado);

        const fila = { ...(actualMap[cand.empleado.id] || {}) };
        const notaExistente = fila[d.dia]?.nota;
        const prev = enBorradorGlobal ? turnoElegido : (fila[d.dia]?.previsto || turnoElegido);
        const breakAsig = asignarTandaBreakEnDia(d.dia, turnoElegido, cfgTurno);
        fila[d.dia] = {
          codigo: turnoElegido,
          previsto: prev,
          esRotacion: cand.esPersonalRotado,
          servicioEjecutorId: srvId,
          ...(notaExistente ? { nota: notaExistente } : {}),
          ...(breakAsig
            ? {
                breakTandaOrden: breakAsig.breakTandaOrden,
                breakInicio: breakAsig.breakInicio,
                breakFin: breakAsig.breakFin,
              }
            : {}),
        };
        loteParaDb.push({
          empleadoId: cand.empleado.id,
          dia: d.dia,
          codigo: turnoElegido,
          previsto: prev,
          esRotacion: cand.esPersonalRotado,
          breakTandaOrden: breakAsig?.breakTandaOrden ?? null,
          breakInicio: breakAsig?.breakInicio ?? null,
          breakFin: breakAsig?.breakFin ?? null,
        });
        horasExtraLoop.set(
          cand.empleado.id,
          r2(
            (horasExtraLoop.get(cand.empleado.id) || 0) +
              horasLiquidadasCelda(cfgTurno, d.fechaIso, esDescansoPred, reglasCand, fila[d.dia])
          )
        );
        if (franjasTurno.noche) {
          nochesLoop.set(cand.empleado.id, (nochesLoop.get(cand.empleado.id) || 0) + 1);
        }
        if (esDomOFest) {
          domFestLoop.set(cand.empleado.id, (domFestLoop.get(cand.empleado.id) || 0) + 1);
        }
        totalAsignados++;
        asignadosEnSlot++;

        // Auto-protección Post-Guardia: asignar Saliente (S) en d.dia + 1 tras turno nocturno pesado (ej. G24)
        if (esNocturno && d.dia < totalDias) {
          const celdaSig = fila[d.dia + 1];
          const sigActual = celdaSig?.codigo || '';
          const bloqueadaOtroSig =
            celdaSig?.servicioEjecutorId &&
            celdaSig.servicioEjecutorId !== srvId &&
            sigActual !== '' &&
            sigActual !== 'L';
          if (!celdaSig?.fijada && (!sigActual || sigActual === 'L') && !bloqueadaOtroSig) {
            const prevSig = enBorradorGlobal ? 'S' : (celdaSig?.previsto || 'S');
            fila[d.dia + 1] = {
              codigo: 'S',
              previsto: prevSig,
              esRotacion: cand.esPersonalRotado,
              servicioEjecutorId: srvId,
              ...(celdaSig?.nota ? { nota: celdaSig.nota } : {}),
            };
            loteParaDb.push({
              empleadoId: cand.empleado.id,
              dia: d.dia + 1,
              codigo: 'S',
              previsto: prevSig,
              esRotacion: cand.esPersonalRotado,
            });
          }
        }

        actualMap[cand.empleado.id] = fila;
      }
    };

    if (metasHabilitadas.length > 0 && filtroCategoriaActiva === 'TODAS') {
      // Pasada 1: Prioridad crítica MÍNIMO en todo el mes antes de elevar días a ESPERADO
      for (const d of dias) {
        if (esDiaCerradoServicio(d)) continue;
        const esDomOFest = d.esDomingo || Boolean(d.festivo);
        for (const meta of metasHabilitadas) {
          const minReq = Math.max(0, esDomOFest ? meta.minimoDomFest : meta.minimoBase);
          if (minReq <= 0) continue;
          const actualCount = contarTurnoDia(d.dia, meta.codigoTurno);
          const faltanteMin = Math.max(0, minReq - actualCount);
          if (faltanteMin > 0) {
            cubrirEnDia(d, meta.codigoTurno, faltanteMin);
          }
        }
      }

      // Pasada 2: Completar cobertura hasta ESPERADO por cada turno habilitado
      for (const d of dias) {
        if (esDiaCerradoServicio(d)) continue;
        const esDomOFest = d.esDomingo || Boolean(d.festivo);
        for (const meta of metasHabilitadas) {
          const minReq = Math.max(0, esDomOFest ? meta.minimoDomFest : meta.minimoBase);
          const espReq = Math.max(minReq, esDomOFest ? meta.esperadoDomFest : meta.esperadoBase);
          if (espReq <= 0) continue;
          const actualCount = contarTurnoDia(d.dia, meta.codigoTurno);
          const faltanteEsp = Math.max(0, espReq - actualCount);
          if (faltanteEsp > 0) {
            cubrirEnDia(d, meta.codigoTurno, faltanteEsp);
          }
        }
      }
    } else {
      for (const d of dias) {
        const reglasCargosSrv = srv.reglasPorCargo || [];

        if (reglasCargosSrv.length > 0) {
          for (const regla of reglasCargosSrv) {
            if (filtroCategoriaActiva !== 'TODAS' && regla.categoriaNombre !== filtroCategoriaActiva) continue;
            const metasCargo = obtenerMetasDiaServicio(srv, d, regla.categoriaNombre);
            if (metasCargo.cerrado) continue;

            const turnosCargo = seleccionarTurnosIdeales(regla.turnosHabilitados);

            if (turnosCargo.turnosDiaAlternativos.length > 0 && metasCargo.reqDia > 0) {
              const cob1 = recalcularCoberturaDia(d.dia, regla.categoriaNombre);
              cubrirEnDia(
                d,
                turnosCargo.turnosDiaAlternativos,
                Math.max(0, metasCargo.reqDia - cob1.dia),
                regla.categoriaNombre
              );
            }

            if (turnosCargo.turnoNoche && metasCargo.reqNoche > 0) {
              const cob2 = recalcularCoberturaDia(d.dia, regla.categoriaNombre);
              cubrirEnDia(
                d,
                turnosCargo.turnoNoche,
                Math.max(0, metasCargo.reqNoche - cob2.noche),
                regla.categoriaNombre
              );
            }
          }
        } else {
          const metasDia = obtenerMetasDiaServicio(srv, d);
          if (!metasDia.cerrado) {
            if (turnosDiaAlternativos.length > 0 && metasDia.reqDia > 0) {
              const cob1 = recalcularCoberturaDia(d.dia);
              cubrirEnDia(d, turnosDiaAlternativos, Math.max(0, metasDia.reqDia - cob1.dia));
            }

            if (turnoNoche && metasDia.reqNoche > 0) {
              const cob2 = recalcularCoberturaDia(d.dia);
              cubrirEnDia(d, turnoNoche, Math.max(0, metasDia.reqNoche - cob2.noche));
            }
          }
        }
      }
    }

    // =========================================================================
    // FASE 2: CUMPLIMIENTO DE META POR DÍAS HÁBILES DE LA EMPRESA Y BANCO HORAS
    // =========================================================================
    const fechaBaseRef = dias[0]?.fechaIso || '2026-01-01';
    const anioPeriodo = Number(fechaBaseRef.slice(0, 4)) || 2026;
    const mesPeriodo = Number(fechaBaseRef.slice(5, 7)) || 1;
    const diasHabilesMes = contarDiasHabilesMes(anioPeriodo, mesPeriodo, predFest).diasHabilesMes;

    for (const f of filasBase) {
      if (f.esPersonalRotado) continue;
      if (!esCargoPermitidoEnServicio(f.empleado)) continue;
      if (filtroCategoriaActiva !== 'TODAS' && f.empleado.categoria !== filtroCategoriaActiva) continue;

      const reglasEmp = reglasEmpresaDeEmpleado(f.empleado);
      const fila = { ...(actualMap[f.empleado.id] || {}) };
      let horasAsignadas = 0;
      let horasAmortizadasComp = 0;
      const itemsEmp: Array<{ fechaIso: string; codigo?: string; turno: TurnoLiquidable | undefined }> = [];

      for (const dItem of dias) {
        const celdaItem = fila[dItem.dia];
        const c = (celdaItem?.codigo || '').trim().toUpperCase();
        if (!c || c === 'BLANCO') continue;
        const cfg = catalogo[c];
        const turnoConBreak: TurnoLiquidable | undefined =
          cfg && (celdaItem?.breakInicio || celdaItem?.breakFin)
            ? { ...cfg, breakInicio: celdaItem.breakInicio ?? null, breakFin: celdaItem.breakFin ?? null }
            : cfg;
        itemsEmp.push({ fechaIso: dItem.fechaIso, codigo: c, turno: turnoConBreak });
        if (!cfg) continue;
        horasAmortizadasComp = r2(
          horasAmortizadasComp +
            obtenerHorasAmortizacionTurno(cfg, reglasEmp.horasSemanalesContrato, reglasEmp.diasBaseSemana)
        );
        if (!cfg.esAusencia) {
          horasAsignadas = r2(
            horasAsignadas + horasLiquidadasCelda(cfg, dItem.fechaIso, esDescansoPred, reglasEmp, celdaItem)
          );
        }
      }

      const diasHabilesProrrateados = contarDiasHabilesProrrateados(itemsEmp, predFest);
      const metaHabiles = calcularMetaMensualPorDiasHabiles(
        reglasEmp.horasSemanalesContrato,
        diasHabilesMes,
        diasHabilesProrrateados,
        reglasEmp.diasBaseSemana
      );
      const horasContratoObjetivo = Math.max(
        0,
        r2(metaHabiles.horasContratadasEfectivas - horasAmortizadasComp)
      );

      if (horasAsignadas >= horasContratoObjetivo) continue;

      const reglaCargoEmp = (srv.reglasPorCargo || []).find((r) => r.categoriaNombre === f.empleado.categoria);
      const turnosIdealesEmp = seleccionarTurnosIdeales(
        reglaCargoEmp?.turnosHabilitados || codigosBaseServicio
      );
      const turnosDiaEmp =
        turnosIdealesEmp.turnosDiaAlternativos.length > 0
          ? turnosIdealesEmp.turnosDiaAlternativos
          : turnosIdealesEmp.turnoNoche
            ? [turnosIdealesEmp.turnoNoche]
            : [];

      if (turnosDiaEmp.length === 0) continue;

      for (let idxDia = 0; idxDia < dias.length; idxDia++) {
        const d = dias[idxDia];
        if (horasAsignadas >= horasContratoObjetivo) break;

        const celdaHoy = fila[d.dia];
        if (celdaHoy?.fijada) continue;
        const codHoy = celdaHoy?.codigo || '';
        if (celdaHoy?.servicioEjecutorId && celdaHoy.servicioEjecutorId !== srv.id && codHoy !== '' && codHoy !== 'L') {
          continue;
        }
        if (codHoy !== '') continue;

        if (modServicio === 'LUN_VIE_HABILES' && (d.esSabado || d.esDomingo || !!d.festivo)) {
          continue;
        }
        if (modServicio === 'LUN_SAB_SIN_FESTIVOS' && (d.esDomingo || !!d.festivo)) {
          continue;
        }
        if (superaMaximoDiasConsecutivos(f.empleado, d.dia)) continue;

        const turnoAEvaluar = turnosDiaEmp[idxDia % turnosDiaEmp.length];
        const cfgTurno = catalogo[turnoAEvaluar];
        if (!cfgTurno || cfgTurno.activo === false || cfgTurno.esAusencia) continue;
        const franjasTurno = clasificarFranjasTurno(cfgTurno);
        if (franjasTurno.noche && contarNochesConsecutivasPrevias(f.empleado, d.dia) >= 3) {
          continue;
        }

        const ayer =
          d.dia === 1
            ? f.empleado.ultimoTurnoMesPrevio
            : fila[d.dia - 1]?.codigo || '';
        const cfgAyer = catalogo[ayer];
        if (cfgAyer?.esNocturnoPesado) continue;
        const descansoDesdeAyerMin = calcularDescansoEntreTurnosMin(cfgAyer, cfgTurno);
        if (descansoDesdeAyerMin !== null && descansoDesdeAyerMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) continue;

        if (d.dia < totalDias) {
          const celdaSig = fila[d.dia + 1];
          const sigCod = celdaSig?.codigo || '';
          const cfgSig = catalogo[sigCod];
          const bloqueadaOtroSig =
            celdaSig?.servicioEjecutorId &&
            celdaSig.servicioEjecutorId !== srv.id &&
            sigCod !== '' &&
            sigCod !== 'L';
          if (
            cfgTurno.esNocturnoPesado &&
            (bloqueadaOtroSig ||
              (celdaSig?.fijada && !sigCod) ||
              esCodigoExoneracionContrato(sigCod) ||
              cfgSig?.esAusencia ||
              cfgSig?.prorrateaMetaContrato ||
              cfgSig?.descuentaBancoHoras ||
              (cfgSig && cfgSig.horasOrdinarias > 0))
          ) {
            continue;
          }
          const descansoHaciaSigMin = calcularDescansoEntreTurnosMin(cfgTurno, cfgSig);
          if (descansoHaciaSigMin !== null && descansoHaciaSigMin < DESCANSO_MINIMO_ENTRE_TURNOS_MIN) continue;
        }

        const prev = enBorradorGlobal ? turnoAEvaluar : (fila[d.dia]?.previsto || turnoAEvaluar);
        const breakAsig2 = asignarTandaBreakEnDia(d.dia, turnoAEvaluar, cfgTurno);
        fila[d.dia] = {
          codigo: turnoAEvaluar,
          previsto: prev,
          esRotacion: f.esPersonalRotado,
          servicioEjecutorId: srvId,
          ...(celdaHoy?.nota ? { nota: celdaHoy.nota } : {}),
          ...(breakAsig2
            ? {
                breakTandaOrden: breakAsig2.breakTandaOrden,
                breakInicio: breakAsig2.breakInicio,
                breakFin: breakAsig2.breakFin,
              }
            : {}),
        };
        loteParaDb.push({
          empleadoId: f.empleado.id,
          dia: d.dia,
          codigo: turnoAEvaluar,
          previsto: prev,
          esRotacion: f.esPersonalRotado,
          breakTandaOrden: breakAsig2?.breakTandaOrden ?? null,
          breakInicio: breakAsig2?.breakInicio ?? null,
          breakFin: breakAsig2?.breakFin ?? null,
        });

        // Auto-protección Post-Guardia si Fase 2 asignó nocturno pesado
        if (cfgTurno.esNocturnoPesado && d.dia < totalDias) {
          const celdaSig = fila[d.dia + 1];
          const sigActual = celdaSig?.codigo || '';
          const bloqueadaOtroSig =
            celdaSig?.servicioEjecutorId &&
            celdaSig.servicioEjecutorId !== srv.id &&
            sigActual !== '' &&
            sigActual !== 'L';
          if (!celdaSig?.fijada && (!sigActual || sigActual === 'L') && !bloqueadaOtroSig) {
            const prevSig = enBorradorGlobal ? 'S' : (celdaSig?.previsto || 'S');
            fila[d.dia + 1] = {
              codigo: 'S',
              previsto: prevSig,
              esRotacion: f.esPersonalRotado,
              servicioEjecutorId: srvId,
              ...(celdaSig?.nota ? { nota: celdaSig.nota } : {}),
            };
            loteParaDb.push({
              empleadoId: f.empleado.id,
              dia: d.dia + 1,
              codigo: 'S',
              previsto: prevSig,
              esRotacion: f.esPersonalRotado,
              breakTandaOrden: null,
              breakInicio: null,
              breakFin: null,
            });
          }
        }

        horasAsignadas = r2(
          horasAsignadas + horasLiquidadasCelda(cfgTurno, d.fechaIso, esDescansoPred, reglasEmp, fila[d.dia])
        );
        totalAsignados++;
        actualMap[f.empleado.id] = fila;
      }
    }

    // =========================================================================
    // FASE 3: ASIGNAR 'L' (LIBRE PROGRAMADO) EN TODAS LAS CELDAS VACÍAS DE PLANTA BASE
    // =========================================================================
    for (const f of filasBase) {
      if (f.esPersonalRotado) continue;
      if (filtroCategoriaActiva !== 'TODAS' && f.empleado.categoria !== filtroCategoriaActiva) continue;
      const fila = { ...(actualMap[f.empleado.id] || {}) };
      let modificada = false;
      for (const d of dias) {
        const celdaActual = fila[d.dia];
        if (celdaActual?.fijada) continue;
        const codActual = celdaActual?.codigo || '';
        if (codActual === '') {
          const prevLibre = enBorradorGlobal ? 'L' : (celdaActual?.previsto || 'L');
          fila[d.dia] = {
            codigo: 'L',
            previsto: prevLibre,
            esRotacion: false,
            servicioEjecutorId: undefined,
            ...(celdaActual?.nota ? { nota: celdaActual.nota } : {}),
          };
          loteParaDb.push({
            empleadoId: f.empleado.id,
            dia: d.dia,
            codigo: 'L',
            previsto: prevLibre,
            esRotacion: false,
            breakTandaOrden: null,
            breakInicio: null,
            breakFin: null,
          });
          modificada = true;
        }
      }
      if (modificada) {
        actualMap[f.empleado.id] = fila;
      }
    }

    const cambiosAutocompletar: CambioCeldaHistorial[] = loteParaDb.map((c) => {
      const celdaAntes = prevMapSnapshot[c.empleadoId]?.[c.dia];
      return {
        empId: c.empleadoId,
        dia: c.dia,
        turnoAnterior: (celdaAntes?.codigo || '') as CodigoTurno,
        turnoNuevo: c.codigo as CodigoTurno,
        previstoAnterior: (celdaAntes?.previsto || '') as CodigoTurno,
        esRotacion: c.esRotacion,
        breakTandaOrdenAnterior: celdaAntes?.breakTandaOrden ?? null,
        breakInicioAnterior: celdaAntes?.breakInicio ?? null,
        breakFinAnterior: celdaAntes?.breakFin ?? null,
        breakTandaOrdenNuevo: c.breakTandaOrden ?? null,
        breakInicioNuevo: c.breakInicio ?? null,
        breakFinNuevo: c.breakFin ?? null,
      };
    });

    return {
      actualMap,
      loteParaDb,
      cambiosAutocompletar,
      totalAsignados,
    };
  }
}
