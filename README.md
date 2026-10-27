# Rafa Turnos 🏥

Sistema web integral para la **programación, gestión y optimización de turnos laborales hospitalarios** organizados directamente por **Servicios Asistenciales** (Urgencias, UCI, Cirugía, Hospitalización, Laboratorio, etc. — sin dependencias, procesos ni subprocesos), tomando como referente operativo a **Thurni** y adaptado a la **normativa laboral asistencial colombiana** (Ley 2101 de 2021 y Código Sustantivo del Trabajo).

---

## 🛠️ Stack Tecnológico
- **Backend**: [NestJS](https://nestjs.com/) (TypeScript, Arquitectura Modular, Prisma ORM, Swagger OpenAPI).
- **Frontend**: [Angular](https://angular.dev/) (TypeScript, Standalone Components, Signals, CDK Virtual Scroll).
- **Base de Datos**: [PostgreSQL](https://www.postgresql.org/) (Modelado relacional estricto, transacciones ACID).

---

## 📁 Documentación de Análisis (Paso a Paso)

Toda la fase de análisis de requisitos, reglas de negocio y arquitectura se encuentra documentada en la carpeta [`docs/analisis/`](./docs/analisis/):

1. **[01. Definición del Problema, Benchmark y Alcance](./docs/analisis/01_definicion_problema_y_alcance.md)**: Justificación del sistema, características clave inspiradas en Thurni y delimitación del MVP vs fases futuras.
2. **[02. Marco Normativo Laboral Colombiano](./docs/analisis/02_marco_normativo_colombia.md)**: Ley 2101 de 2021 (reducción de jornada), recargos nocturnos (21:00-06:00), recargos dominicales/festivos, descansos compensatorios y descansos entre turnos (12h).
3. **[03. Requisitos Funcionales y No Funcionales](./docs/analisis/03_requisitos_funcionales_y_no_funcionales.md)**: Catálogo detallado de RFs (organización, personal, catálogo de turnos, planificador interactivo, validaciones, portal de empleados) y RNFs.
4. **[04. Modelo Conceptual y Reglas de Negocio](./docs/analisis/04_modelo_conceptual_y_reglas_negocio.md)**: Diagrama ER conceptual, entidades del dominio hospitalario y matriz de reglas de validación (descansos, post-guardias, coberturas mínimas).
5. **[05. Arquitectura Técnica Propuesta](./docs/analisis/05_arquitectura_tecnica_propuesta.md)**: Estructura del repositorio, diseño modular de NestJS, componentes reactivos con Angular Signals y estrategia de cuadrante de alto rendimiento.
6. **[06. Integración con la Intranet Hospitalaria](./docs/analisis/06_integracion_intranet_hospitalaria.md)**: Integración satélite, Single Sign-On (SSO) transparente con JWT, consumo de API REST de personal/dependencias y persistencia con réplica local.
7. **[07. Automatización en la Programación y UX Mes a Mes](./docs/analisis/07_automatizacion_y_ux_mes_a_mes.md)**: Estrategia de transición continua entre meses (empalmes), ruedas cíclicas rotativas, asistente de 3 pasos, atajos de teclado y balance de coberturas en tiempo real.
8. **[08. Interfaz con Paleta de Turnos y Drag & Drop](./docs/analisis/08_interfaz_paleta_y_drag_and_drop_thurni.md)**: Paridad de uso con Thurni para Gestión Humana: barra/paleta superior de turnos, arrastre hacia celdas (individual y múltiple), código cromático hospitalario y rendimiento con Angular CDK.
9. **[09. Flujos de Incidencias, Permutas y Sustituciones](./docs/analisis/09_flujos_incidencias_permutas_y_sustituciones.md)**: Solicitud de permutas 1-a-1 entre pares con validación automática, manejo de incapacidades imprevistas y motor de recomendación de sustitutos libres.
10. **[10. Reporte de Tipos de Horas y Recargos para Nómina](./docs/analisis/10_liquidacion_horas_recargos_y_nomina.md)**: Desacoplamiento financiero estricto (cero valores en dinero/pesos); cálculo exclusivo de volúmenes de horas por recargo legal CST (HOD, HON, HDFD, HDFN, HED, HEN, compensatorios) y generación del Excel consolidado (resumen + cuadrante extendido 1..31) para Gestión Humana.
11. **[11. Matriz de Roles, Permisos y Seguridad RBAC](./docs/analisis/11_matriz_roles_permisos_y_seguridad_rbac.md)**: Alcance granular por dependencias hospitalarias, roles (Superadmin, Gestión Humana, Jefe Médico, Supervisora, Asistencial, Calidad) y protección de datos médicos sensibles (Habeas Data).
12. **[12. Versionado, Auditoría y Trazabilidad Legal](./docs/analisis/12_versionado_auditoria_y_trazabilidad.md)**: Importancia médico-legal del cuadrante, distinción entre Cuadrante Planificado vs Cuadrante Realmente Ejecutado, bitácora forense de auditoría y comparador visual de cambios (diff).
13. **[13. Sistema de Notificaciones, Comunicaciones y Alertas](./docs/analisis/13_sistema_notificaciones_y_alertas.md)**: Canales de alerta (campana unificada con la Intranet, correo, push web), alertas urgentes de vacantes asistenciales y suscripción iCal a calendarios móviles.
14. **[14. Arquitectura y Funcionamiento de la Sincronización Móvil](./docs/analisis/14_arquitectura_sincronizacion_movil.md)**: Detalle del estándar universal iCalendar (`webcal://`), sincronización automática bidireccional con Google Calendar y Apple Calendar (iOS), funcionamiento offline, tokens criptográficos de seguridad y experiencia PWA en el celular.
15. **[15. Puntos de Análisis Pendientes y Definiciones Abiertas](./docs/analisis/15_puntos_pendientes_y_definiciones_abiertas.md)**: Auditoría de puntos abiertos (personal flotante correturnos, contratos de planta vs OPS/honorarios, restricciones médicas de SST, mapeo físico del Excel de Thurni, festivos de Colombia y plazos de publicación).
16. **[16. Checklist Técnico para el Ingeniero de la Intranet](./docs/analisis/16_checklist_tecnico_ingeniero_intranet.md)**: Cuestionario técnico estructurado en 4 bloques (SSO con JWT, endpoints de API REST para empleados/dependencias, novedades de vacaciones e integración visual de retorno).
17. **[17. Modelo de Rotación de Personal entre Servicios Homólogos](./docs/analisis/17_rotacion_inter_servicios_asistenciales.md)**: Reglas clínicas de rotación por afinidad asistencial (`tipoAsistencia`: Cuidados Intensivos, Urgencias, Quirúrgico, Hospitalización), visualización de personal prestado y cómputo para centros de costo.
18. **[18. Modelo de Banco de Horas (Acumulación Continua)](./docs/analisis/18_modelo_banco_de_horas.md)**: Acumulación continua de horas a favor o en contra mes a mes sin periodicidad de caducidad, separación de recargos económicos CST, turno de compensación `COMP` y trazabilidad en el reporte de nómina.
19. **[19. Gestión de Festivos Oficiales de Colombia y Caché](./docs/analisis/19_gestion_festivos_colombia_y_cache.md)**: Algoritmo propio interno (Meeus/Ley Emiliani), persistencia en PostgreSQL (`festivos_colombia`), resiliencia ante reinicios, precarga en RAM (`onApplicationBootstrap`) y soporte de excepciones/días cívicos manuales.

---

## 🧪 Ejecutar en modo demostración

El frontend incluye datos ficticios para probar el dashboard, el planificador, los servicios, los empleados y el registro local de novedades. No necesita PostgreSQL ni conexión con la Intranet. Los cambios realizados durante la demostración no se guardan permanentemente.

```powershell
cd frontend
npm install
npm start
```

Abre `http://localhost:4200`. Las exportaciones de demostración se descargan como archivos CSV.

---

## 🚀 Hoja de Ruta del Proyecto
- [x] **Fase 1**: Análisis y Especificación de Requisitos (17 documentos clínicos y normativos).
- [x] **Fase 2**: Diseño del Modelo de Datos Relacional y Esquema Prisma.
- [x] **Fase 3**: Inicialización del Código Base (`backend/` NestJS 10+ y `frontend/` Angular 17+).
- [x] **Fase 4**: Semilla de Datos Hospitalarios (Servicios, Turnos, Categorías, Coberturas y Festivos 2026).
- [x] **Fase 5**: Módulos Backend Completos (Novedades, Cliente Intranet SSO + sincronización REST).
- [x] **Fase 6**: Frontend Completo: Dashboard Torre de Control, Planificador Drag & Drop, Servicios y Empleados/Novedades.
- [ ] **Fase 7**: Instalación de dependencias (npm install) y arranque del servidor de desarrollo.
- [ ] **Fase 8**: Conexión real con PostgreSQL (migración) y pruebas de integración con la Intranet.
#   R a f a T u r n o s  
 