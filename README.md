# Rafa Turnos 🏥

Sistema web integral para la **programación, gestión y optimización de turnos laborales hospitalarios** organizados por **Macroprocesos del Mapa de Procesos Hospitalario**, **Servicios Asistenciales** (Urgencias, UCI, Cirugía, Hospitalización, Laboratorio, Farmacia, etc.) y **Servicios Hermanos** con rotación de personal, adaptado a la **normativa laboral colombiana** (Ley 2101 de 2021, Ley 2466 de 2025 y Código Sustantivo del Trabajo).

---

## 🛠️ Stack Tecnológico
- **Backend**: [NestJS 10](https://nestjs.com/) (TypeScript, Arquitectura Modular, Prisma ORM 5, Jest + Supertest).
- **Frontend**: [Angular 18](https://angular.dev/) (TypeScript, Standalone Components, Signals modularizados por dominio, Jasmine + Karma).
- **Base de Datos**: [PostgreSQL 16](https://www.postgresql.org/) (Modelado relacional estricto, transacciones ACID y migraciones versionadas en `backend/prisma/migrations`).
- **SSO & Simulador**: Integración satélite JWT HMAC-SHA256 con la Intranet Hospitalaria (incluye `simulador-intranet/` para desarrollo y pruebas locales en `:4300`).

---

## 📁 Documentación de Análisis (Paso a Paso)

Toda la fase de análisis de requisitos, reglas de negocio y arquitectura se encuentra documentada en la carpeta [`docs/analisis/`](./docs/analisis/):

1. **[01. Definición del Problema, Benchmark y Alcance](./docs/analisis/01_definicion_problema_y_alcance.md)**: Justificación del sistema, características clave inspiradas en Thurni y delimitación del MVP vs fases futuras.
2. **[02. Marco Normativo Laboral Colombiano](./docs/analisis/02_marco_normativo_colombia.md)**: Ley 2101 de 2021 (reducción de jornada a 42h), recargos nocturnos vigentes (19:00-06:00), recargos dominicales/festivos, descansos compensatorios y descansos entre turnos (12h).
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
20. **[20. Arquitectura de Integración, Sincronización y Gobierno de Servicios](./docs/analisis/20_arquitectura_integracion_sincronizacion_y_gobierno_servicios.md)**: Delimitación de responsabilidades (Intranet provee identidad y perfil profesional; Rafa Turnos gobierna servicios, afinidad entre hermanos y adscripción), sincronización multi-canal (Webhooks en tiempo real, Cron 02:00 AM, SSO JIT y botón de contingencia) y ciclo de vida de vacaciones.

---

## 🚀 Ejecución Local y Flujo Completo (PostgreSQL + Intranet SSO)

Rafa Turnos opera como aplicación **satélite** conectada a PostgreSQL 16 y autenticada vía **SSO JWT** desde la Intranet Hospitalaria (`simulador-intranet/` en entorno local):

1. **Base de datos y migraciones** (en una terminal desde la raíz):
```powershell
docker compose up -d db
cd backend
npm install
npx prisma migrate deploy
```
> ⚠️ **Advertencia sobre `npm run prisma:seed`**: El script [`backend/prisma/seed.ts`](./backend/prisma/seed.ts) ejecuta `deleteMany()` sobre **todas las 16 tablas** de PostgreSQL antes de insertar los datos iniciales. Úsalo **únicamente** en bases vacías o entornos de desarrollo/pruebas; **nunca** en producción ni sobre datos reales.

2. **Arrancar Simulador Intranet (`:4300`), Backend (`:3000`) y Frontend (`:4200`)**:
   - **En Windows (automático)**: ejecuta [`iniciar.bat`](./iniciar.bat) (o [`iniciar_silencioso.vbs`](./iniciar_silencioso.vbs)) y detén los servicios con [`detener.bat`](./detener.bat).
   - **Manual en 3 terminales**:
     - `node simulador-intranet/server.js` → `http://localhost:4300`
     - `cd backend && npm run start:dev` → `http://localhost:3000/api/v1/health`
     - `cd frontend && npm install && npm start` → `http://localhost:4200`

Abre **[http://localhost:4300](http://localhost:4300)** en el navegador, selecciona el perfil SSO (`Talento Humano`, `Coordinador` o `Colaborador`) e ingresa automáticamente al aplicativo.

---

## 🧪 Pruebas Automatizadas y Validación

| Suite | Alcance | Comando |
|---|---|---|
| **Motor normativo CST / Ley 2101 / Ley 2466** | 45 pruebas puras sobre [`shared/liquidacion-horas.ts`](./shared/liquidacion-horas.ts) | `node scripts/verificar-liquidacion.mjs` |
| **Backend (Jest + Supertest)** | Guard SSO/RBAC, Cuadrantes, Permutas, iCal, Liquidación, Servicios y Festivos + verificación `sync:check` | `cd backend && npm run sync:check && npm test` |
| **Frontend (Jasmine + Karma ChromeHeadless)** | Helpers de cálculo, Signal Stores (`NotificacionStore`, `CatalogosSsoStore`, `CuadranteStore`, `PermutasAuditoriaStore`, `PortalReportesStore`) y `AutocompletadoService` | `cd frontend && npm run sync:check && npm test` |
| **E2E Ecosistema Completo (Idempotente)** | Planificación, Auditoría, Permutas, Feed `.ics` iCal y Cierre/Reapertura Nómina contra PostgreSQL + Intranet `:4300` + Backend `:3000` (limpia artefactos `2026-12` al terminar) | `node backend/test-e2e-ecosistema.js` |

---

## 🚀 Hoja de Ruta del Proyecto
- [x] **Fase 1**: Análisis y Especificación de Requisitos (20 documentos clínicos y normativos).
- [x] **Fase 2**: Diseño del Modelo de Datos Relacional y Esquema Prisma.
- [x] **Fase 3**: Inicialización del Código Base (`backend/` NestJS 10+ y `frontend/` Angular 18+ con Signals).
- [x] **Fase 4**: Semilla de Datos Hospitalarios (14 Servicios, Turnos, Categorías, Coberturas y Festivos Colombia 2026-2027).
- [x] **Fase 5**: Módulos Backend Completos (Novedades, Cliente Intranet SSO con firma criptográfica JWT + sincronización REST).
- [x] **Fase 6**: Frontend Completo: Dashboard Torre de Control, Planificador Drag & Drop, Servicios y Empleados/Novedades.
- [x] **Fase 7**: Instalación de dependencias (`npm install`) y deduplicación de lógica compartida en helpers.
- [x] **Fase 8**: Conexión real con PostgreSQL 16 (Prisma ORM) y pruebas de integración con el simulador de Intranet.
- [x] **Fase 9**: Optimización de Base de Datos y Rendimiento (Índices en PostgreSQL, eliminación de N+1 con batch lookups, transacciones atómicas `$transaction`, proyección estricta `select` y paginación `skip`/`take`).
- [x] **Fase 10**: Validación Integral de Extremo a Extremo (E2E) (Planificación, auditoría forense, permutas entre pares, feeds iCal móviles RFC 5545 y cierre/reapertura de nómina).
- [x] **Fase 11**: Empaquetado y Despliegue en Docker (Contenedores multi-stage para NestJS y Angular + Nginx reverse proxy, orquestados mediante `docker-compose.yml` y documentados en [**DEPLOY.md**](./DEPLOY.md)).

---

## 📦 Despliegue Rápido con Docker

Para poner en marcha todo el ecosistema (PostgreSQL 16 + Backend + Frontend Nginx) en un solo comando:

```bash
docker compose up -d --build
```

- **Frontend**: [http://localhost:4200](http://localhost:4200)
- **Backend API**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
- **Simulador Intranet**: [http://localhost:4300](http://localhost:4300)

Consulta la guía completa de integración hospitalaria en [**DEPLOY.md**](./DEPLOY.md).
