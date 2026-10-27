# 01. Definición del Problema, Benchmark y Alcance

## 1. Problema de Negocio
En las instituciones hospitalarias (clínicas, ESEs, hospitales de nivel II, III y IV), la programación de turnos asistenciales es uno de los procesos de mayor criticidad y fricción operativa:
- **Operación continua (24/7/365)**: Los servicios como Urgencias, UCI, Cirugía y Hospitalización no pueden quedar desatendidos bajo ninguna circunstancia.
- **Riesgo asistencial**: La falta de cobertura de una especialidad o un ratio insuficiente enfermero/paciente compromete la seguridad del paciente.
- **Sobrecarga y fatiga del personal**: Programaciones deficientes provocan turnos doblados no planificados, falta de descanso adecuado y "burnout".
- **Complejidad administrativa**: Cuadrantes realizados habitualmente en hojas de cálculo (Excel) descentralizadas, propensas a errores, difíciles de auditar y con nula trazabilidad ante cambios de última hora o incapacidades.

---

## 2. Benchmark de Referencia: Thurni
**Thurni** es un referente en el sector de gestión de cuadrantes y rotaciones sanitarias. Sus puntos fuertes a replicar y adaptar son:

1. **Visión por Dependencias / Servicios**:
   - Cada servicio (UCI, Urgencias, etc.) gestiona sus propias necesidades y plantillas, pero la dirección de enfermería / RRHH tiene visibilidad consolidada.
2. **Definición de Ratios y Coberturas Mínimas**:
   - Para cada turno (Mañana, Tarde, Noche) se parametriza la dotación requerida por categoría profesional (ej. Mínimo 3 Médicos Especialistas, 6 Jefes de Enfermería, 10 Auxiliares de Enfermería).
3. **Validación Automática de Reglas**:
   - Alerta visual instantánea cuando se viola una regla (ej. descanso menor a 12h, asignación durante vacaciones, personal sin cualificación requerida para el servicio).
4. **Gestión de Cambios entre Compañeros**:
   - Flujo digital donde dos empleados de igual perfil acuerdan permutar un turno y el supervisor lo autoriza en un clic, recalculando automáticamente el balance de horas.

---

## 3. Alcance del Proyecto (Fases)

### Fase 1: MVP (Producto Mínimo Viable)
- **Estructura Hospitalaria**: Sedes, dependencias/servicios y perfiles asistenciales.
- **Gestión de Personal**: Empleados (modelo unificado asistencial) y estados (activo, incapacidad, vacaciones). *(Nota: Se excluyen por el momento diferenciaciones de contratos OPS vs Planta y restricciones médicas SST)*.
- **Catálogo de Turnos**: M (Mañana), T (Tarde), N (Noche), G12 (Guardia 12h), L (Libre), S (Saliente).
- **Planificador Visual Interactivo**: Matriz mensual estilo cuadrante con vista por dependencia.
- **Motor de Validaciones**:
  - Detección de solapamientos y turnos continuos sin descanso.
  - Alerta de coberturas mínimas no satisfechas.
- **Autenticación y Roles**: Administrador, Jefe de Servicio/Supervisora, Personal Asistencial.

### Fase 2: Autoservicio y Flujos de Novedades
- Portal del empleado en Angular (móvil y web).
- Módulo de solicitud de intercambio de turnos con validaciones y aprobación jerárquica.
- Solicitud y registro de vacaciones, licencias e incapacidades médicas.

### Fase 3: Liquidación de Horas y Analítica
- Cálculo de horas según normativa colombiana: horas ordinarias, recargos nocturnos, dominicales y festivos.
- Exportación de reportes a Excel / PDF para el área de nómina.
- Indicadores de equidad (distribución equitativa de noches y festivos).
