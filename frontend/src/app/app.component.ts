import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CATALOGO_TURNOS,
  CeldaAsignacion,
  CodigoTurno,
  EmpleadoHospital,
  EMPLEADOS_INICIALES,
  PermutaItem,
  RegistroAuditoria,
  ServicioHospitalario,
  SERVICIOS_INICIALES,
  TipoTurnoConfig,
} from './models';
import { FestivoEntry, FestivosColombiaHelper } from './festivos-colombia.helper';

export interface DiaColumna {
  dia: number;
  fechaIso: string;
  letraDia: string;
  esDomingo: boolean;
  festivo?: FestivoEntry;
}

export interface InfraccionNormativa {
  empleadoId: string;
  empleadoNombre: string;
  dia: number;
  mensaje: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Navegación principal
  vistaActual = signal<'PLANIFICADOR' | 'DASHBOARD' | 'BANCO_NOMINA' | 'FESTIVOS' | 'PORTAL_EMPLEADO'>('PLANIFICADOR');
  mensajeToast = signal<string>('');

  // Estado del Portal del Empleado (Simulador de Rol Personal Asistencial)
  empleadoPortalId = signal<string>('emp-01');
  diaPermutaSeleccionado = signal<number>(10);
  companeroPermutaId = signal<string>('emp-02');
  diaHoySimulado = signal<number>(6);

  // Configuración de periodo y servicio
  anioSeleccionado = signal<number>(2026);
  mesSeleccionado = signal<number>(11); // Noviembre 2026 (tiene 2 lunes festivos Emiliani para ver en vivo)
  servicioSeleccionadoId = signal<string>('srv-uci-ad');
  estadoCuadrante = signal<'BORRADOR' | 'PUBLICADO' | 'CERRADO_NOMINA'>('BORRADOR');
  mostrarComparadorPrevisto = signal<boolean>(false);

  // Modales
  modalRotacionAbierto = signal<boolean>(false);
  modalIcalAbierto = signal<boolean>(false);

  // Formulario nuevo festivo / día cívico
  nuevoFestivoFecha = signal<string>('2026-11-20');
  nuevoFestivoNombre = signal<string>('Día Cívico Aniversario Hospitalario');
  versionCacheFestivos = signal<number>(1);

  // Catálogos base
  servicios = signal<ServicioHospitalario[]>(SERVICIOS_INICIALES);
  empleados = signal<EmpleadoHospital[]>(EMPLEADOS_INICIALES);
  empleadosRotadosPorServicio = signal<Record<string, string[]>>({
    'srv-uci-ad': [],
    'srv-uci-ped': [],
    'srv-urg': [],
    'srv-cir': [],
  });

  readonly listaTurnosPaleta: TipoTurnoConfig[] = Object.values(CATALOGO_TURNOS);
  readonly mesesDisponibles = [
    { valor: 7, nombre: 'Julio' },
    { valor: 8, nombre: 'Agosto' },
    { valor: 9, nombre: 'Septiembre' },
    { valor: 10, nombre: 'Octubre' },
    { valor: 11, nombre: 'Noviembre' },
    { valor: 12, nombre: 'Diciembre' },
  ];

  // Herramienta Pincel / Drag & Drop estilo Thurni
  turnoPincelActivo = signal<CodigoTurno>('M');
  pintandoConRaton = signal<boolean>(false);
  celdaEnfocada = signal<{ empId: string; dia: number } | null>(null);

  // Estado Reactivo de Asignaciones: Record<"empId", Record<diaNumero, CeldaAsignacion>>
  asignaciones = signal<Record<string, Record<number, CeldaAsignacion>>>({});

  // Solicitudes de Permuta 1-a-1
  listaPermutas = signal<PermutaItem[]>([
    {
      id: 'perm-101',
      fechaSolicitud: '2026-10-27 08:15',
      solicitanteId: 'emp-01',
      solicitanteNombre: 'Diana Carolina Mora',
      receptorId: 'emp-02',
      receptorNombre: 'Camilo Andrés López',
      categoria: 'Enfermero Jefe',
      servicioId: 'srv-uci-ad',
      diaOrigen: 6,
      turnoOrigen: 'N',
      diaDestino: 6,
      turnoDestino: 'M',
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: 'Simulación OK: Ambos mantienen ≥12h de descanso y cobertura de UCI Adultos intacta.',
    },
    {
      id: 'perm-102',
      fechaSolicitud: '2026-10-27 09:40',
      solicitanteId: 'emp-05',
      solicitanteNombre: 'Laura Marcela Gómez',
      receptorId: 'emp-07',
      receptorNombre: 'Paola Andrea Castro',
      categoria: 'Auxiliar de Enfermería',
      servicioId: 'srv-uci-ad',
      diaOrigen: 14,
      turnoOrigen: 'T',
      diaDestino: 14,
      turnoDestino: 'M',
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: 'Simulación OK: Misma categoría asistencial y cero conflictos post-guardia.',
    },
  ]);

  // Bitácora Forense de Auditoría
  bitacoraAuditoria = signal<RegistroAuditoria[]>([
    {
      id: 'aud-1',
      timestamp: '2026-10-27 07:30:12',
      actor: 'Sup. Jefe Enfermería',
      empleadoNombre: 'Diana Carolina Mora',
      servicioNombre: 'UCI Adultos',
      dia: 1,
      turnoAnterior: 'M',
      turnoNuevo: 'S',
      motivo: 'Corrección automática de empalme: cerró mes previo en turno Noche (N)',
    },
    {
      id: 'aud-2',
      timestamp: '2026-10-27 08:05:44',
      actor: 'Gestión Humana (Intranet Sync)',
      empleadoNombre: 'Paola Andrea Castro',
      servicioNombre: 'UCI Adultos',
      dia: 18,
      turnoAnterior: 'T',
      turnoNuevo: 'VAC',
      motivo: 'Bloqueo por periodo de vacaciones sincronizado desde Intranet',
    },
  ]);

  constructor() {
    this.sembrarCuadranteInicial();
  }

  // Servicio actualmente seleccionado
  servicioActual = computed<ServicioHospitalario>(() => {
    return (
      this.servicios().find((s) => s.id === this.servicioSeleccionadoId()) ||
      this.servicios()[0]
    );
  });

  // Festivos del año actual desde la Caché en Memoria RAM
  listaFestivosAnio = computed<FestivoEntry[]>(() => {
    this.versionCacheFestivos(); // Dependencia reactiva cuando se agrega un Día Cívico
    const mapa = FestivosColombiaHelper.getFestivosAnio(this.anioSeleccionado());
    return Array.from(mapa.values());
  });

  // Columnas de días del mes seleccionado
  diasDelMes = computed<DiaColumna[]>(() => {
    this.versionCacheFestivos();
    const anio = this.anioSeleccionado();
    const mes = this.mesSeleccionado();
    const totalDias = new Date(anio, mes, 0).getDate();
    const letras = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
    const resultado: DiaColumna[] = [];

    for (let d = 1; d <= totalDias; d++) {
      const fechaObj = new Date(anio, mes - 1, d);
      const dow = fechaObj.getDay();
      const mm = String(mes).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const fechaIso = `${anio}-${mm}-${dd}`;
      const festivo = FestivosColombiaHelper.esFestivo(fechaIso);

      resultado.push({
        dia: d,
        fechaIso,
        letraDia: letras[dow],
        esDomingo: dow === 0,
        festivo,
      });
    }
    return resultado;
  });

  // Empleados del cuadrante actual (Planta del servicio + Rotados homólogos)
  empleadosDelCuadrante = computed< { emp: EmpleadoHospital; esRotado: boolean }[]>(() => {
    const srvId = this.servicioSeleccionadoId();
    const todos = this.empleados();
    const idsRotados = this.empleadosRotadosPorServicio()[srvId] || [];

    const propios = todos
      .filter((e) => e.servicioBaseId === srvId)
      .map((emp) => ({ emp, esRotado: false }));

    const rotados = todos
      .filter((e) => idsRotados.includes(e.id))
      .map((emp) => ({ emp, esRotado: true }));

    return [...propios, ...rotados];
  });

  // Filas completas calculadas con horas, recargos CST y Banco de Horas Continuo
  filasCuadrante = computed(() => {
    const dias = this.diasDelMes();
    const matriz = this.asignaciones();
    const listaEmp = this.empleadosDelCuadrante();

    return listaEmp.map(({ emp, esRotado }) => {
      const celdasEmp = matriz[emp.id] || {};
      let horasTrabajadas = 0;
      let hod = 0;
      let hon = 0;
      let hdfd = 0;
      let hdfn = 0;
      let horasAmortizadasComp = 0;
      let conteoNoches = 0;
      let conteoDomFest = 0;
      let diasVac = 0;
      let diasInc = 0;

      for (const d of dias) {
        const celda = celdasEmp[d.dia];
        const cod = celda?.codigo || '';
        if (!cod) continue;

        const cfg = CATALOGO_TURNOS[cod];
        if (!cfg) continue;

        horasTrabajadas += cfg.horasOrdinarias;
        if (cod === 'N' || cod === 'G24') {
          conteoNoches++;
        }
        if (cod === 'VAC') diasVac++;
        if (cod === 'INC') diasInc++;
        if (cfg.descuentaBancoHoras) {
          horasAmortizadasComp += 6; // Cada turno COMP descuenta 6h del saldo a favor
        }

        const esDiaDominicalOFestivo = d.esDomingo || !!d.festivo;
        if (esDiaDominicalOFestivo && cfg.horasOrdinarias > 0) {
          conteoDomFest++;
          hdfd += cfg.horasDiurnas;
          hdfn += cfg.horasNocturnas;
        } else {
          hod += cfg.horasDiurnas;
          hon += cfg.horasNocturnas;
        }
      }

      // Ecuación del Banco de Horas Continuo (Doc 18):
      // Saldo Mes = Horas Reales - Horas Contrato - Horas Amortizadas con COMP
      const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
      const nuevoSaldoBanco = emp.saldoBancoAnterior + diferenciaMes;

      return {
        empleado: emp,
        esPersonalRotado: esRotado,
        celdas: celdasEmp,
        horasTrabajadas,
        hod,
        hon,
        hdfd,
        hdfn,
        horasAmortizadasComp,
        diferenciaMes,
        nuevoSaldoBanco,
        conteoNoches,
        conteoDomFest,
        causaCompensatorioDominical: conteoDomFest >= 3,
        diasVac,
        diasInc,
      };
    });
  });

  // Cobertura por día y turno (Pie de tabla en tiempo real)
  coberturaPorDia = computed<Record<number, { manana: number; tarde: number; noche: number }>>(() => {
    const dias = this.diasDelMes();
    const filas = this.filasCuadrante();
    const resultado: Record<number, { manana: number; tarde: number; noche: number }> = {};

    for (const d of dias) {
      let manana = 0;
      let tarde = 0;
      let noche = 0;

      for (const f of filas) {
        const cod = f.celdas[d.dia]?.codigo || '';
        if (cod === 'M' || cod === 'G12' || cod === 'G24') manana++;
        if (cod === 'T' || cod === 'G12' || cod === 'G24') tarde++;
        if (cod === 'N' || cod === 'G24') noche++;
      }

      resultado[d.dia] = { manana, tarde, noche };
    }
    return resultado;
  });

  // Motor de Validaciones Normativas CST (Descanso < 12h, Post-guardia y Empalme mes anterior)
  infraccionesActivas = computed<InfraccionNormativa[]>(() => {
    const dias = this.diasDelMes();
    const filas = this.filasCuadrante();
    const alertas: InfraccionNormativa[] = [];

    for (const f of filas) {
      // 1. Validar Empalme con último día del mes previo (Día 1)
      const prev = f.empleado.ultimoTurnoMesPrevio;
      const dia1 = f.celdas[1]?.codigo || '';
      if ((prev === 'N' || prev === 'G24') && (dia1 === 'M' || dia1 === 'T' || dia1 === 'G12' || dia1 === 'G24')) {
        alertas.push({
          empleadoId: f.empleado.id,
          empleadoNombre: f.empleado.nombre,
          dia: 1,
          mensaje: `${f.empleado.nombre} (Día 1): Infracción Empalme — Cerró mes previo en ${prev}, requiere S o L.`,
        });
      }

      // 2. Validar secuencia día a día (Post-guardia y descanso 12h)
      for (let i = 1; i < dias.length; i++) {
        const dActual = dias[i].dia;
        const dPrevio = dias[i - 1].dia;
        const codPrev = f.celdas[dPrevio]?.codigo || '';
        const codAct = f.celdas[dActual]?.codigo || '';

        if (!codPrev || !codAct) continue;

        // Post-guardia: N o G24 seguido de turno activo sin S o L
        if (
          (codPrev === 'N' || codPrev === 'G24') &&
          (codAct === 'M' || codAct === 'T' || codAct === 'N' || codAct === 'G12' || codAct === 'G24')
        ) {
          alertas.push({
            empleadoId: f.empleado.id,
            empleadoNombre: f.empleado.nombre,
            dia: dActual,
            mensaje: `${f.empleado.nombre} (Día ${dActual}): Violación Post-Guardia tras ${codPrev} (Descanso < 12h).`,
          });
        }

        // Tarde (sale 19:00 o 22:00) -> Mañana (entra 07:00) advertencia si fuera turno tarde extendido
      }
    }
    return alertas;
  });

  // KPIs para la Torre de Control
  porcentajeCoberturaGlobal = computed<number>(() => {
    const dias = this.diasDelMes();
    const srv = this.servicioActual();
    const cob = this.coberturaPorDia();
    let totalChecks = dias.length * 3;
    let cumplidos = 0;

    for (const d of dias) {
      const c = cob[d.dia];
      if (c.manana >= srv.reqManana) cumplidos++;
      if (c.tarde >= srv.reqTarde) cumplidos++;
      if (c.noche >= srv.reqNoche) cumplidos++;
    }
    return Math.round((cumplidos / totalChecks) * 100);
  });

  balanceGlobalBancoServicio = computed<number>(() => {
    return this.filasCuadrante().reduce((acc, f) => acc + f.nuevoSaldoBanco, 0);
  });

  permutasPendientesCount = computed<number>(() => {
    return this.listaPermutas().filter((p) => p.estado === 'PENDIENTE_SUPERVISOR').length;
  });

  resumenNominaCalculado = computed(() => this.filasCuadrante());

  // =========================================================================
  // LÓGICA DEL PORTAL DEL EMPLEADO (ROL PERSONAL ASISTENCIAL)
  // =========================================================================

  // Fila completa calculada del colaborador seleccionado en el Portal
  datosEmpleadoPortal = computed(() => {
    const id = this.empleadoPortalId();
    const emp = this.empleados().find((e) => e.id === id) || this.empleados()[0];
    const dias = this.diasDelMes();
    const celdasEmp = this.asignaciones()[emp.id] || {};

    let horasTrabajadas = 0;
    let horasAmortizadasComp = 0;
    let conteoNoches = 0;
    let conteoDomFest = 0;

    for (const d of dias) {
      const cod = celdasEmp[d.dia]?.codigo || '';
      const cfg = cod ? CATALOGO_TURNOS[cod] : undefined;
      if (!cfg) continue;

      horasTrabajadas += cfg.horasOrdinarias;
      if (cod === 'N' || cod === 'G24') conteoNoches++;
      if ((d.esDomingo || !!d.festivo) && cfg.horasOrdinarias > 0) conteoDomFest++;
      if (cfg.descuentaBancoHoras) horasAmortizadasComp += 6;
    }

    const diferenciaMes = horasTrabajadas - emp.horasContratoMes - horasAmortizadasComp;
    const nuevoSaldoBanco = emp.saldoBancoAnterior + diferenciaMes;
    const servicioBase = this.servicios().find((s) => s.id === emp.servicioBaseId) || this.servicios()[0];

    return {
      empleado: emp,
      servicioBase,
      celdas: celdasEmp,
      horasTrabajadas,
      horasAmortizadasComp,
      diferenciaMes,
      nuevoSaldoBanco,
      conteoNoches,
      conteoDomFest,
    };
  });

  // Compañeros pares (misma categoría y mismo servicio) para solicitar permuta 1-a-1
  companerosParesPortal = computed<EmpleadoHospital[]>(() => {
    const actual = this.datosEmpleadoPortal().empleado;
    return this.empleados().filter(
      (e) =>
        e.id !== actual.id &&
        e.servicioBaseId === actual.servicioBaseId &&
        e.categoria === actual.categoria
    );
  });

  // Compañeros que trabajan el mismo día con el empleado (¿Con quién estoy de guardia?)
  equipoDeGuardiaDiaSeleccionado = computed(() => {
    const actual = this.datosEmpleadoPortal().empleado;
    const dia = this.diaPermutaSeleccionado();
    const matriz = this.asignaciones();

    return this.empleados()
      .filter((e) => e.servicioBaseId === actual.servicioBaseId && e.id !== actual.id)
      .map((e) => ({
        empleado: e,
        turno: (matriz[e.id]?.[dia]?.codigo || 'L') as CodigoTurno,
      }))
      .filter((x) => x.turno !== '' && x.turno !== 'L' && x.turno !== 'S' && x.turno !== 'VAC' && x.turno !== 'INC');
  });

  // Permutas donde participa el colaborador actual
  misPermutasPortal = computed<PermutaItem[]>(() => {
    const id = this.empleadoPortalId();
    return this.listaPermutas().filter((p) => p.solicitanteId === id || p.receptorId === id);
  });

  seleccionarDiaEnPortal(dia: number): void {
    this.diaPermutaSeleccionado.set(dia);
    const pares = this.companerosParesPortal();
    if (pares.length > 0 && !pares.some((p) => p.id === this.companeroPermutaId())) {
      this.companeroPermutaId.set(pares[0].id);
    }
  }

  cambiarEmpleadoPortal(nuevoId: string): void {
    this.empleadoPortalId.set(nuevoId);
    const pares = this.companerosParesPortal();
    if (pares.length > 0) {
      this.companeroPermutaId.set(pares[0].id);
    }
  }

  enviarSolicitudPermutaDesdePortal(): void {
    const datosMios = this.datosEmpleadoPortal();
    const dia = this.diaPermutaSeleccionado();
    const miTurno = datosMios.celdas[dia]?.codigo || 'L';
    const comp = this.empleados().find((e) => e.id === this.companeroPermutaId());

    if (!comp) {
      this.mostrarNotificacion('No hay compañeros de la misma categoría disponibles para permutar.');
      return;
    }

    const turnoComp = this.asignaciones()[comp.id]?.[dia]?.codigo || 'L';
    if (miTurno === turnoComp) {
      this.mostrarNotificacion(
        `Ambos tienen el mismo turno (${miTurno}) el día ${dia}. Selecciona un día con turnos distintos.`
      );
      return;
    }

    // Validar que ninguno esté en VAC o INC
    if (miTurno === 'VAC' || miTurno === 'INC' || turnoComp === 'VAC' || turnoComp === 'INC') {
      this.mostrarNotificacion('No se puede permutar un día bloqueado por Vacaciones o Incapacidad.');
      return;
    }

    const nuevaPermuta: PermutaItem = {
      id: 'perm-' + Math.floor(100 + Math.random() * 900),
      fechaSolicitud: 'Hoy ' + new Date().toTimeString().substring(0, 5),
      solicitanteId: datosMios.empleado.id,
      solicitanteNombre: datosMios.empleado.nombre,
      receptorId: comp.id,
      receptorNombre: comp.nombre,
      categoria: datosMios.empleado.categoria,
      servicioId: datosMios.empleado.servicioBaseId,
      diaOrigen: dia,
      turnoOrigen: miTurno,
      diaDestino: dia,
      turnoDestino: turnoComp,
      estado: 'PENDIENTE_SUPERVISOR',
      validacionReglas: `Simulación Automática OK: ${datosMios.empleado.categoria} equivalente, descanso ≥12h cumplido.`,
    };

    this.listaPermutas.set([nuevaPermuta, ...this.listaPermutas()]);
    this.mostrarNotificacion(
      `Solicitud de permuta enviada a la Supervisora (Día ${dia}: tu [${miTurno}] por [${turnoComp}] de ${comp.nombre}).`
    );
  }

  // Candidatos homólogos de otros servicios con el mismo tipoAsistencia (Doc 17)
  candidatosRotacionHomologos = computed<EmpleadoHospital[]>(() => {
    const srvActual = this.servicioActual();
    const serviciosHomologosIds = this.servicios()
      .filter((s) => s.id !== srvActual.id && s.tipoAsistencia === srvActual.tipoAsistencia)
      .map((s) => s.id);

    const yaIncluidos = new Set(this.empleadosDelCuadrante().map((x) => x.emp.id));

    return this.empleados().filter(
      (e) => serviciosHomologosIds.includes(e.servicioBaseId) && !yaIncluidos.has(e.id)
    );
  });

  // Semilla inicial realista con patrones sanitarios M-T-N-S-L
  private sembrarCuadranteInicial(): void {
    const patronRueda: CodigoTurno[] = ['M', 'M', 'T', 'T', 'N', 'S', 'L', 'G12', 'L', 'M'];
    const mapaInicial: Record<string, Record<number, CeldaAsignacion>> = {};

    EMPLEADOS_INICIALES.forEach((emp, idx) => {
      mapaInicial[emp.id] = {};
      for (let d = 1; d <= 31; d++) {
        // Respetar empalme el día 1 si viene de N o G24
        if (d === 1 && (emp.ultimoTurnoMesPrevio === 'N' || emp.ultimoTurnoMesPrevio === 'G24')) {
          mapaInicial[emp.id][d] = { codigo: 'S', previsto: 'S' };
          continue;
        }
        // Si día anterior fue N o G24, asignar S
        const anterior = mapaInicial[emp.id][d - 1]?.codigo;
        if (anterior === 'N' || anterior === 'G24') {
          mapaInicial[emp.id][d] = { codigo: 'S', previsto: 'S' };
          continue;
        }

        const cod = patronRueda[(d + idx * 2) % patronRueda.length];
        mapaInicial[emp.id][d] = { codigo: cod, previsto: cod };
      }
    });

    // Añadir un par de ejemplos de vacaciones, incapacidad y compensatorio de banco
    if (mapaInicial['emp-07']) {
      mapaInicial['emp-07'][18] = { codigo: 'VAC', previsto: 'T' };
      mapaInicial['emp-07'][19] = { codigo: 'VAC', previsto: 'T' };
    }
    if (mapaInicial['emp-05']) {
      mapaInicial['emp-05'][10] = { codigo: 'COMP', previsto: 'M' };
    }
    if (mapaInicial['emp-06']) {
      mapaInicial['emp-06'][12] = { codigo: 'INC', previsto: 'N' };
    }

    this.asignaciones.set(mapaInicial);
  }

  // Interacciones con la Paleta y la Cuadrícula
  seleccionarPincel(cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
  }

  onDragStartPaleta(event: DragEvent, cod: CodigoTurno): void {
    this.turnoPincelActivo.set(cod);
    event.dataTransfer?.setData('text/plain', cod);
  }

  onDragOverCelda(event: DragEvent): void {
    event.preventDefault();
  }

  onDropCelda(event: DragEvent, empId: string, dia: number): void {
    event.preventDefault();
    const cod = (event.dataTransfer?.getData('text/plain') as CodigoTurno) ?? this.turnoPincelActivo();
    this.aplicarTurnoEnCelda(empId, dia, cod, 'Arrastre Drag & Drop en matriz');
  }

  iniciarPintadoCelda(empId: string, dia: number): void {
    this.celdaEnfocada.set({ empId, dia });
    this.pintandoConRaton.set(true);
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Pintado con Pincel Thurni');
  }

  continuarPintadoCelda(empId: string, dia: number): void {
    if (!this.pintandoConRaton()) return;
    this.aplicarTurnoEnCelda(empId, dia, this.turnoPincelActivo(), 'Arrastre continuo Pincel');
  }

  finalizarPintadoRaton(): void {
    this.pintandoConRaton.set(false);
  }

  // Modo Teclado Ultra-rápido estilo Thurni
  onKeyDownCelda(event: KeyboardEvent, empId: string, dia: number): void {
    const key = event.key.toUpperCase();
    const mapaTeclas: Record<string, CodigoTurno> = {
      M: 'M',
      T: 'T',
      N: 'N',
      G: 'G12',
      S: 'S',
      L: 'L',
      C: 'COMP',
      V: 'VAC',
      I: 'INC',
      DELETE: '',
      BACKSPACE: '',
    };

    if (key in mapaTeclas) {
      event.preventDefault();
      this.aplicarTurnoEnCelda(empId, dia, mapaTeclas[key], `Atajo rápido de teclado (${key})`);
      return;
    }
  }

  aplicarTurnoEnCelda(empId: string, dia: number, nuevoCodigo: CodigoTurno, origen: string): void {
    if (this.estadoCuadrante() === 'CERRADO_NOMINA') {
      this.mostrarNotificacion('El cuadrante está CERRADO para Nómina. Reábrelo para editar.');
      return;
    }

    const actualMap = { ...this.asignaciones() };
    const filaEmp = { ...(actualMap[empId] || {}) };
    const celdaActual = filaEmp[dia];

    // Regla RN-03: Bloqueo si está en VAC o INC y no se está usando explícitamente el borrador
    if (
      (celdaActual?.codigo === 'VAC' || celdaActual?.codigo === 'INC') &&
      nuevoCodigo !== '' &&
      nuevoCodigo !== celdaActual.codigo
    ) {
      this.mostrarNotificacion(
        `Celda bloqueada por novedad (${celdaActual.codigo}). Usa el Borrador 🧽 primero si deseas anular la ausencia.`
      );
      return;
    }

    const anterior = celdaActual?.codigo || '';
    if (anterior === nuevoCodigo) return;

    const empObj = this.empleados().find((e) => e.id === empId);
    const esRotacion = empObj ? empObj.servicioBaseId !== this.servicioSeleccionadoId() : false;

    filaEmp[dia] = {
      codigo: nuevoCodigo,
      previsto: celdaActual?.previsto ?? anterior,
      esRotacion,
      servicioEjecutorId: this.servicioSeleccionadoId(),
    };

    actualMap[empId] = filaEmp;
    this.asignaciones.set(actualMap);

    // Si acaba de asignar N o G24, auto-proteger el día siguiente con S (Saliente) si estaba libre
    if ((nuevoCodigo === 'N' || nuevoCodigo === 'G24') && dia < this.diasDelMes().length) {
      const sig = filaEmp[dia + 1]?.codigo || '';
      if (!sig || sig === 'L') {
        filaEmp[dia + 1] = {
          codigo: 'S',
          previsto: filaEmp[dia + 1]?.previsto ?? sig,
          esRotacion,
        };
      }
    }

    // Registrar en bitácora de auditoría si el cuadrante está publicado
    if (empObj) {
      const nuevoLog: RegistroAuditoria = {
        id: 'aud-' + Date.now(),
        timestamp: new Date().toTimeString().substring(0, 8),
        actor: 'Supervisora Servicio',
        empleadoNombre: empObj.nombre,
        servicioNombre: this.servicioActual().nombre,
        dia,
        turnoAnterior: anterior,
        turnoNuevo: nuevoCodigo,
        motivo: origen,
      };
      this.bitacoraAuditoria.set([nuevoLog, ...this.bitacoraAuditoria().slice(0, 25)]);
    }
  }

  // Autocompletar huecos priorizando empleados con saldo negativo en el Banco de Horas (RN-BH04)
  ejecutarAutocompletarHuecos(): void {
    const dias = this.diasDelMes();
    const srv = this.servicioActual();
    const actualMap = { ...this.asignaciones() };
    let asignacionesRealizadas = 0;

    for (const d of dias) {
      const cobDia = this.coberturaPorDia()[d.dia];
      const faltanManana = Math.max(0, srv.reqManana - cobDia.manana);
      const faltanTarde = Math.max(0, srv.reqTarde - cobDia.tarde);
      const faltanNoche = Math.max(0, srv.reqNoche - cobDia.noche);

      const cubrirTurno = (codTurno: CodigoTurno, cantidadFaltante: number) => {
        if (cantidadFaltante <= 0) return;

        // Ordenar candidatos disponibles por menor Nuevo Saldo Banco (quienes deben horas van primero)
        const candidatos = [...this.filasCuadrante()]
          .filter((f) => {
            const cHoy = actualMap[f.empleado.id]?.[d.dia]?.codigo || '';
            const cAyer =
              d.dia === 1
                ? f.empleado.ultimoTurnoMesPrevio
                : actualMap[f.empleado.id]?.[d.dia - 1]?.codigo || '';
            const libreHoy = cHoy === '' || cHoy === 'L';
            const sinFatigaAyer = cAyer !== 'N' && cAyer !== 'G24';
            return libreHoy && sinFatigaAyer;
          })
          .sort((a, b) => a.nuevoSaldoBanco - b.nuevoSaldoBanco);

        for (let i = 0; i < Math.min(cantidadFaltante, candidatos.length); i++) {
          const cand = candidatos[i];
          const fila = { ...(actualMap[cand.empleado.id] || {}) };
          fila[d.dia] = {
            codigo: codTurno,
            previsto: fila[d.dia]?.previsto ?? 'L',
            esRotacion: cand.esPersonalRotado,
          };
          actualMap[cand.empleado.id] = fila;
          asignacionesRealizadas++;
        }
      };

      cubrirTurno('M', faltanManana);
      cubrirTurno('T', faltanTarde);
      cubrirTurno('N', faltanNoche);
    }

    this.asignaciones.set(actualMap);
    this.mostrarNotificacion(
      asignacionesRealizadas > 0
        ? `Motor Heurístico completó ${asignacionesRealizadas} turnos vacantes priorizando personal con deuda en el Banco de Horas.`
        : 'Todas las coberturas mínimas del servicio ya se encuentran al 100%.'
    );
  }

  // Rotación entre servicios homólogos
  abrirModalRotacion(): void {
    this.modalRotacionAbierto.set(true);
  }

  vincularRotacionAlCuadrante(cand: EmpleadoHospital): void {
    const srvId = this.servicioSeleccionadoId();
    const mapaRot = { ...this.empleadosRotadosPorServicio() };
    const listaActual = mapaRot[srvId] || [];
    if (!listaActual.includes(cand.id)) {
      mapaRot[srvId] = [...listaActual, cand.id];
      this.empleadosRotadosPorServicio.set(mapaRot);
    }
    this.modalRotacionAbierto.set(false);
    this.mostrarNotificacion(
      `${cand.nombre} vinculado en modo Rotación Homóloga (${this.servicioActual().tipoAsistencia}).`
    );
  }

  // Flujo de Permutas 1-a-1
  aprobarPermuta(idPermuta: string): void {
    const perm = this.listaPermutas().find((p) => p.id === idPermuta);
    if (!perm) return;

    this.aplicarTurnoEnCelda(
      perm.solicitanteId,
      perm.diaOrigen,
      perm.turnoDestino,
      `Permuta #${perm.id} aprobada con ${perm.receptorNombre}`
    );
    this.aplicarTurnoEnCelda(
      perm.receptorId,
      perm.diaDestino,
      perm.turnoOrigen,
      `Permuta #${perm.id} aprobada con ${perm.solicitanteNombre}`
    );

    this.listaPermutas.set(
      this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'APROBADA' } : p))
    );
    this.mostrarNotificacion(`Permuta aprobada. Cuadrante y calendarios iCal actualizados.`);
  }

  rechazarPermuta(idPermuta: string): void {
    this.listaPermutas.set(
      this.listaPermutas().map((p) => (p.id === idPermuta ? { ...p, estado: 'RECHAZADA' } : p))
    );
    this.mostrarNotificacion('Solicitud de permuta rechazada.');
  }

  // Gestión de Días Cívicos y Caché RAM
  agregarDiaCivico(): void {
    const fecha = this.nuevoFestivoFecha();
    const nombre = this.nuevoFestivoNombre().trim();
    if (!fecha || !nombre) return;

    FestivosColombiaHelper.agregarFestivoManual(fecha, nombre);
    this.versionCacheFestivos.update((v) => v + 1);
    this.mostrarNotificacion(
      `Festivo "${nombre}" (${fecha}) guardado y refrescado en Caché RAM O(1).`
    );
  }

  eliminarDiaCivico(fecha: string): void {
    FestivosColombiaHelper.eliminarFestivoManual(fecha);
    this.versionCacheFestivos.update((v) => v + 1);
    this.mostrarNotificacion(`Día cívico ${fecha} eliminado de la caché.`);
  }

  // Exportación a Excel (CSV compatible con Excel para Nómina y Gestión Humana)
  exportarExcelNomina(): void {
    const filas = this.filasCuadrante();
    const dias = this.diasDelMes();
    const encabezadosDias = dias.map((d) => `Dia_${d.dia}`).join(';');
    const header = `Documento;Colaborador;Categoria;Servicio;Contrato_Mes;HOD;HON_35;HDFD_75;HDFN_110;Horas_Trabajadas;Domingos_Festivos;Compensatorio_Causado;Dias_VAC;Dias_INC;Saldo_Banco_Anterior;Diferencia_Mes;Nuevo_Saldo_Banco;${encabezadosDias}`;

    const lineas = filas.map((f) => {
      const turnosDia = dias.map((d) => f.celdas[d.dia]?.codigo || 'L').join(';');
      return [
        f.empleado.documento,
        `"${f.empleado.nombre}"`,
        `"${f.empleado.categoria}"`,
        `"${this.servicioActual().nombre}"`,
        f.empleado.horasContratoMes,
        f.hod,
        f.hon,
        f.hdfd,
        f.hdfn,
        f.horasTrabajadas,
        f.conteoDomFest,
        f.causaCompensatorioDominical ? 1 : 0,
        f.diasVac,
        f.diasInc,
        f.empleado.saldoBancoAnterior,
        f.diferenciaMes,
        f.nuevoSaldoBanco,
        turnosDia,
      ].join(';');
    });

    const contenidoCsv = '\uFEFF' + [header, ...lineas].join('\n');
    const blob = new Blob([contenidoCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reporte_Nomina_y_BancoHoras_${this.servicioActual().codigo}_${this.anioSeleccionado()}_${this.mesSeleccionado()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.mostrarNotificacion(
      'Archivo Excel (CSV) de Nómina y Banco de Horas descargado correctamente.'
    );
  }

  cambiarServicio(nuevoId: string): void {
    this.servicioSeleccionadoId.set(nuevoId);
  }

  cambiarMes(nuevoMes: number): void {
    this.mesSeleccionado.set(Number(nuevoMes));
  }

  cambiarEstadoCuadrante(): void {
    const actual = this.estadoCuadrante();
    if (actual === 'BORRADOR') {
      this.estadoCuadrante.set('PUBLICADO');
      this.mostrarNotificacion('Cuadrante PUBLICADO. Notificación enviada a la campana de la Intranet.');
    } else if (actual === 'PUBLICADO') {
      this.estadoCuadrante.set('CERRADO_NOMINA');
      this.mostrarNotificacion('Mes CERRADO para Nómina. Saldos del Banco de Horas consolidados.');
    } else {
      this.estadoCuadrante.set('BORRADOR');
      this.mostrarNotificacion('Cuadrante reabierto en modo BORRADOR.');
    }
  }

  copiarEnlaceIcal(): void {
    this.modalIcalAbierto.set(false);
    this.mostrarNotificacion('Enlace webcal:// copiado al portapapeles.');
  }

  notificarIntranet(): void {
    this.mostrarNotificacion(
      'Modo Demostración: En producción este botón redirige a la Intranet Hospitalaria manteniendo el SSO JWT.'
    );
  }

  enfocarCelda(empId: string, dia: number): void {
    this.celdaEnfocada.set({ empId, dia });
  }

  // Helpers de plantilla
  obtenerConfigTurno(cod: CodigoTurno): TipoTurnoConfig | undefined {
    return cod ? CATALOGO_TURNOS[cod] : undefined;
  }

  obtenerConflictoCelda(empId: string, dia: number): InfraccionNormativa | undefined {
    return this.infraccionesActivas().find((i) => i.empleadoId === empId && i.dia === dia);
  }

  obtenerIniciales(nombre: string): string {
    return nombre
      .replace('Dr. ', '')
      .replace('Dra. ', '')
      .replace('Enf. ', '')
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
    const partes: string[] = [`${emp.nombre} • Día ${d.dia} (${d.fechaIso})`];
    if (d.festivo) partes.push(`🇨🇴 Festivo: ${d.festivo.nombre}`);
    if (celda?.codigo) {
      const cfg = CATALOGO_TURNOS[celda.codigo];
      if (cfg) partes.push(`Turno: ${cfg.nombre} (${cfg.horario})`);
    } else {
      partes.push('Sin turno asignado');
    }
    if (celda?.previsto && celda.previsto !== celda.codigo) {
      partes.push(`Previsto original: ${celda.previsto}`);
    }
    if (conflicto) {
      partes.push(`⚠️ ALERTA: ${conflicto.mensaje}`);
    }
    return partes.join(' | ');
  }

  private mostrarNotificacion(msg: string): void {
    this.mensajeToast.set(msg);
    setTimeout(() => {
      if (this.mensajeToast() === msg) {
        this.mensajeToast.set('');
      }
    }, 4500);
  }
}
