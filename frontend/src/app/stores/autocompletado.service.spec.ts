import { TestBed } from '@angular/core/testing';
import {
  CATALOGO_TURNOS,
  CeldaAsignacion,
  DiaColumna,
  EmpleadoHospital,
  ServicioHospitalario,
} from '../models';
import { AutocompletadoService, FilaAutocompletadoBase } from './autocompletado.service';

function diasNoviembre2026(): DiaColumna[] {
  const letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const list: DiaColumna[] = [];
  for (let d = 1; d <= 30; d++) {
    const dt = new Date(Date.UTC(2026, 10, d));
    const dow = dt.getUTCDay();
    const fechaIso = `2026-11-${String(d).padStart(2, '0')}`;
    const esFestivo = fechaIso === '2026-11-02' || fechaIso === '2026-11-16';
    list.push({
      dia: d,
      fechaIso,
      letraDia: letras[dow],
      esSabado: dow === 6,
      esDomingo: dow === 0,
      festivo: esFestivo ? { fecha: fechaIso, nombre: 'Festivo', esOficialLey: true } : undefined,
    });
  }
  return list;
}

describe('AutocompletadoService', () => {
  let service: AutocompletadoService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AutocompletadoService);
  });

  const makeFila = (
    id: string,
    opts?: { ultimoMesPrevio?: string; horasContrato?: number; esRotado?: boolean }
  ): FilaAutocompletadoBase => ({
    empleado: {
      id,
      documento: `doc-${id}`,
      nombre: `Colab ${id}`,
      categoria: 'Enfermero(a) Jefe',
      servicioBaseId: opts?.esRotado ? 'srv-mat' : 'srv-urg',
      horasContratoMes: opts?.horasContrato ?? 168,
      saldoBancoAnterior: 0,
      ultimoTurnoMesPrevio: opts?.ultimoMesPrevio ?? 'L',
    } as EmpleadoHospital,
    esPersonalRotado: Boolean(opts?.esRotado),
    conteoNoches: 0,
    conteoDomFest: 0,
    nuevoSaldoBanco: 0,
  });

  it('alterna M8/T8, asigna S tras G24, protege celda espejo y completa vacios con L en Fase 3', () => {
    const srv: ServicioHospitalario = {
      id: 'srv-urg',
      codigo: 'URG',
      nombre: 'Urgencias',
      tipoAsistencia: 'URGENCIAS',
      reqDia: 2,
      reqNoche: 1,
      modalidadDias: 'TODOS_24_7',
      turnosHabilitados: ['M8', 'T8', 'N8', 'S', 'L'],
    };

    const filas = [
      makeFila('e1', { ultimoMesPrevio: 'G24' }), // Empalme post-guardia bloquea dia 1
      makeFila('e2', { ultimoMesPrevio: 'L' }),
      makeFila('e3', { ultimoMesPrevio: 'L' }),
      makeFila('e4', { ultimoMesPrevio: 'L' }),
    ];

    // e2 ya tiene una Celda Espejo en srv-mat el dia 1 y una G24 manual en srv-urg el dia 10
    const prevMap: Record<string, Record<number, CeldaAsignacion>> = {
      e1: {},
      e2: {
        1: { codigo: 'M8', previsto: 'M8', servicioEjecutorId: 'srv-mat', esRotacion: true },
        10: { codigo: 'G24', previsto: 'G24', servicioEjecutorId: 'srv-urg' },
      },
      e3: {},
      e4: {},
    };

    const res = service.generarAutocompletadoCuadrante({
      srv,
      srvId: 'srv-urg',
      dias: diasNoviembre2026(),
      catalogo: CATALOGO_TURNOS,
      listaTurnosCatalogo: Object.values(CATALOGO_TURNOS).filter((t) => t.visibleEnPaleta !== false),
      prevMapSnapshot: prevMap,
      filasBase: filas,
      filtroCategoriaActiva: 'TODAS',
      enBorradorGlobal: true,
      obtenerMetasDiaServicio: () => ({ reqDia: 2, reqNoche: 1, cerrado: false }),
    });

    // e1 no debe recibir turno operativo el dia 1 por haber cerrado mes en G24
    expect(['L', '']).toContain(res.actualMap['e1'][1]?.codigo || '');
    // Celda espejo de e2 en srv-mat el dia 1 permanece intacta
    expect(res.actualMap['e2'][1]).toEqual(
      jasmine.objectContaining({ codigo: 'M8', servicioEjecutorId: 'srv-mat' })
    );
    // e2 tenia G24 el dia 10 -> dia 11 debe quedar protegido sin turno operativo encima (S o L)
    expect(CATALOGO_TURNOS[res.actualMap['e2'][11]?.codigo || 'L'].horasOrdinarias).toBe(0);

    // Deben aparecer ambos M8 y T8 gracias a alternancia de slots
    const codigosAsignados = new Set(res.loteParaDb.map((c) => c.codigo));
    expect(codigosAsignados.has('M8')).toBeTrue();
    expect(codigosAsignados.has('T8')).toBeTrue();

    // Fase 3 llena toda celda vacia de planta base con L sin servicioEjecutorId
    for (const f of filas) {
      for (let d = 1; d <= 30; d++) {
        const celda = res.actualMap[f.empleado.id][d];
        expect(celda?.codigo).toBeTruthy();
        if (celda?.codigo === 'L') {
          expect(celda.servicioEjecutorId).toBeUndefined();
        }
      }

      // Respeta <= 6 dias consecutivos y <= 3 noches consecutivas en todo el mes
      let rachaLaborada = 0;
      let rachaNoches = 0;
      for (let d = 1; d <= 30; d++) {
        const cfg = CATALOGO_TURNOS[res.actualMap[f.empleado.id][d].codigo];
        if (cfg && cfg.horasOrdinarias > 0 && !cfg.esAusencia) {
          rachaLaborada++;
          if (cfg.horasNocturnas >= 6) {
            rachaNoches++;
          } else {
            rachaNoches = 0;
          }
        } else {
          rachaLaborada = 0;
          rachaNoches = 0;
        }
        expect(rachaLaborada).toBeLessThanOrEqual(6);
        expect(rachaNoches).toBeLessThanOrEqual(3);
      }
    }
  });

  it('prorratea meta contractual en Fase 2 cuando hay novedades VAC/FAM y autoasigna S tras G24', () => {
    const srv: ServicioHospitalario = {
      id: 'srv-cir',
      codigo: 'CIR',
      nombre: 'Cirugia',
      tipoAsistencia: 'QUIRURGICO',
      reqDia: 0,
      reqNoche: 0,
      modalidadDias: 'TODOS_24_7',
      turnosHabilitados: ['G24', 'S', 'L', 'VAC', 'FAM'],
    };

    const filas = [makeFila('e-guardia', { horasContrato: 150 })];
    // 10 dias de VAC/FAM exoneran 50h -> meta efectiva = 100h -> máx ~5 G24 (120h) y auto-S tras cada G24
    const prevMap: Record<string, Record<number, CeldaAsignacion>> = {
      'e-guardia': {
        1: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        2: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        3: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        4: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        5: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        6: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        7: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        8: { codigo: 'VAC', servicioEjecutorId: 'srv-cir' },
        9: { codigo: 'FAM', servicioEjecutorId: 'srv-cir' },
        10: { codigo: 'FAM', servicioEjecutorId: 'srv-cir' },
      },
    };

    const res = service.generarAutocompletadoCuadrante({
      srv,
      srvId: 'srv-cir',
      dias: diasNoviembre2026(),
      catalogo: CATALOGO_TURNOS,
      listaTurnosCatalogo: Object.values(CATALOGO_TURNOS).filter((t) => t.visibleEnPaleta !== false),
      prevMapSnapshot: prevMap,
      filasBase: filas,
      filtroCategoriaActiva: 'TODAS',
      enBorradorGlobal: true,
      obtenerMetasDiaServicio: () => ({ reqDia: 0, reqNoche: 0, cerrado: false }),
    });

    const fila = res.actualMap['e-guardia'];
    const g24Dias = Object.entries(fila)
      .filter(([, c]) => c.codigo === 'G24')
      .map(([d]) => Number(d));
    expect(g24Dias.length).toBeGreaterThanOrEqual(4);
    expect(g24Dias.length).toBeLessThanOrEqual(5);
    for (const d of g24Dias) {
      if (d < 30) {
        expect(fila[d + 1].codigo).toBe('S');
      }
    }
  });
});
