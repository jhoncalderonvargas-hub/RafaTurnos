# 03. Requisitos Funcionales y No Funcionales

## 1. Requisitos Funcionales (RF)

### Módulo A: Configuración Hospitalaria y Estructura Organizativa
- **RF-A01**: El sistema debe permitir registrar y administrar Sedes y Dependencias/Servicios (ej. Urgencias Adultos, UCI Neonatal, Cirugía General).
- **RF-A02**: El sistema debe permitir configurar las Categorías Profesionales (Médico Especialista, Médico General, Jefe de Enfermería, Auxiliar de Enfermería, etc.).
- **RF-A03**: El sistema debe permitir parametrizar las Coberturas Mínimas por Dependencia, indicando cuántos colaboradores de cada categoría se requieren por tipo de turno y por día (laboral vs fin de semana/festivo).

### Módulo B: Gestión de Personal Asistencial
- **RF-B01**: El sistema debe permitir registrar la ficha del empleado: identificación, nombres, rol asistencial, dependencia principal, tipo de contrato y horas pactadas semanales/mensuales.
- **RF-B02**: El sistema debe registrar ausencias o novedades del personal: Incapacidades médicas, Vacaciones, Licencias de maternidad/paternidad y Permisos no remunerados.
- **RF-B03**: El sistema debe bloquear la asignación de turnos a empleados en estado de ausencia/incapacidad activa.

### Módulo C: Catálogo y Parametrización de Turnos
- **RF-C01**: El sistema debe permitir definir códigos de turno con su franja horaria (hora inicio, hora fin, duración efectiva en horas).
  - Ejemplos típicos:
    - `M`: 07:00 a 13:00 (6h) o 07:00 a 15:00 (8h)
    - `T`: 13:00 a 19:00 (6h) o 15:00 a 22:00 (7h)
    - `N`: 19:00 a 07:00 (12h) o 22:00 a 06:00 (8h)
    - `G12`: Guardia 12 horas diurna o nocturna
    - `L`: Libre programado
    - `S`: Saliente de guardia
- **RF-C02**: Cada turno debe clasificar el desglose de horas diurnas y horas con recargo nocturno (21:00 a 06:00).

### Módulo D: Planificador Visual de Cuadrantes (Matriz Interactiva)
- **RF-D01**: El sistema debe presentar una matriz mensual/semanal donde las filas sean los profesionales agrupados por categoría y las columnas los días del mes.
- **RF-D02**: El supervisor debe poder asignar, editar o eliminar turnos directamente en las celdas de la cuadrícula.
- **RF-D03**: El sistema debe calcular en tiempo real al pie de la cuadrícula la cobertura lograda vs. la cobertura requerida por turno (marcando en verde si cumple, o rojo si hay déficit).
- **RF-D04**: El sistema debe calcular en tiempo real por cada empleado la suma de horas programadas del mes vs. horas contratadas.
- **RF-D05**: Estados del cuadrante: `Borrador` (en edición interna por el supervisor), `Publicado` (visible para los empleados), `Cerrado/Consolidado` (bloqueado para modificaciones sin autorización de RRHH).

### Módulo E: Motor de Validaciones y Reglas Hospitalarias
- **RF-E01**: Validación de descanso mínimo: Notificar de inmediato si entre el fin del turno previo y el inicio del nuevo turno hay menos de 12 horas.
- **RF-E02**: Validación post-guardia: Si un colaborador hace un turno de 12h o más en la noche, el día siguiente debe obligatoriamente asignarse como Saliente (`S`) o Libre (`L`).
- **RF-E03**: Validación de concurrencia: Impedir que un mismo profesional tenga dos turnos superpuestos en la misma dependencia o en distintas dependencias.

### Módulo F: Portal del Empleado e Intercambio de Turnos (Fase 2)
- **RF-F01**: El empleado debe poder consultar su calendario personal desde su cuenta.
- **RF-F02**: El empleado debe poder solicitar permuta/cambio de turno con un compañero de su misma categoría.
- **RF-F03**: El sistema debe validar que el cambio propuesto no rompa las reglas de descanso ni coberturas antes de permitir enviarlo.
- **RF-F04**: El supervisor recibe la solicitud validada y aprueba o rechaza con justificación.

---

## 2. Requisitos No Funcionales (RNF)

- **RNF-01 (Rendimiento)**: La cuadrícula interactiva debe renderizar de forma fluida (menos de 500ms) plantillas de hasta 100 colaboradores en un mes con interacción de teclado/mouse.
- **RNF-02 (Seguridad y Privacidad)**: Autenticación mediante tokens JWT seguros; control de acceso basado en roles (RBAC: Admin, Supervisor, Empleado). Datos médicos e incapacidades protegidos bajo normativa de protección de datos (Habeas Data).
- **RNF-03 (Auditoría y Trazabilidad)**: Todo cambio en el cuadrante publicado debe guardar bitácora de auditoría (quién modificó, qué turno cambió, fecha y hora).
- **RNF-04 (Diseño Responsivo e Intuitivo)**: Interfaz de gestión en Angular optimizada para escritorio/pantalla ancha (para supervisores) y portal móvil adaptativo (para consulta y solicitudes de empleados).
- **RNF-05 (Interoperabilidad)**: API REST estructurada con NestJS bajo estándares OpenAPI (Swagger), facilitando futuras integraciones con software de nómina o ERPs hospitalarios.
