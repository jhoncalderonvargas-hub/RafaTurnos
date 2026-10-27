# 05. Arquitectura Técnica Propuesta

## 1. Visión General del Stack Tecnológico

```mermaid
graph TD
    subgraph Frontend [Frontend: Angular 17+]
        UI[Componentes Standalone & Signals]
        Grid[Matriz de Cuadrantes - Virtual Scroll / CDK]
        State[Servicios Reactivos & Signals State]
    end

    subgraph Backend [Backend: NestJS 10+]
        API[API REST & Swagger OpenAPI]
        Modules[Módulos: Auth, Dependencias, Personal, Cuadrantes, Reglas]
        ORM[Prisma ORM / TypeORM]
    end

    subgraph Database [Persistencia]
        DB[(PostgreSQL 15+)]
    end

    UI -->|HTTP / REST (RxJS)| API
    API --> Modules
    Modules --> ORM
    ORM --> DB
```

- **Frontend**: **Angular (17+)**
  - Componentes Standalone (arquitectura moderna sin NgModules redundantes).
  - Angular **Signals** para gestión de reactividad fina y cálculo en tiempo real de totales y coberturas.
  - **Angular CDK (Drag and Drop / Virtual Scroll)**: Fundamental para matrices grandes de cuadrantes mensuales con decenas de profesionales y días.
  - Librería de UI recomendada: **Tailwind CSS** o **PrimeNG / Angular Material** para controles de tablas, diálogos modales y selectores de fechas.

- **Backend**: **NestJS (10+)**
  - Arquitectura modular desacoplada: cada dominio de negocio en su propio módulo (`auth`, `dependencias`, `empleados`, `turnos`, `cuadrantes`, `reglas-motor`, `novedades`).
  - **Prisma ORM** (o **TypeORM**) con **PostgreSQL**: Modelado tipado de extremo a extremo en TypeScript, migraciones automáticas seguras y consultas relacionales eficientes.
  - Validación de entradas mediante `class-validator` y `class-transformer`.
  - Documentación viva e interactiva con **Swagger / OpenAPI** (`/api/docs`).

- **Base de Datos**: **PostgreSQL**
  - Base de datos relacional robusta, con soporte nativo para transacciones atómicas (crítico para cambios de turnos y aprobación concurrente), tipos de fecha/tiempo precisos con zona horaria (`timestamptz`) e índices compuestos.

---

## 2. Estructura de Proyecto Recomendada

Se propone una estructura clara con dos subproyectos (`backend` y `frontend`), compartiendo tipos comunes o contratos en un directorio compartido si se opta por monorepo:

```text
Rafa Turnos/
├── docs/                                # Documentación de análisis y diseño
│   ├── analisis/
│   │   ├── 01_definicion_problema_y_alcance.md
│   │   ├── 02_marco_normativo_colombia.md
│   │   ├── 03_requisitos_funcionales_y_no_funcionales.md
│   │   ├── 04_modelo_conceptual_y_reglas_negocio.md
│   │   └── 05_arquitectura_tecnica_propuesta.md
│   └── arquitectura/                    # Diagramas y contratos API
├── backend/                             # API NestJS
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/                    # Autenticación JWT y RBAC
│   │   │   ├── dependencias/            # Servicios hospitalarios y coberturas
│   │   │   ├── empleados/               # Fichas de personal y categorías
│   │   │   ├── turnos/                  # Tipos de turno y catálogos
│   │   │   ├── cuadrantes/              # Planificación mensual y asignaciones
│   │   │   ├── reglas/                  # Motor de validación de descansos y leyes
│   │   │   └── novedades/               # Incapacidades, vacaciones y cambios
│   │   ├── common/                      # Guards, decorators, filters e interceptores
│   │   ├── prisma/ o database/          # Esquema y migraciones de BD
│   │   └── main.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/                            # Aplicación Angular
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/                    # Guards de ruta, interceptor HTTP de token
│   │   │   ├── shared/                  # Componentes reutilizables, pipes, directivas
│   │   │   └── features/
│   │   │       ├── auth/                # Login y recuperación de clave
│   │   │       ├── dependencias/        # Gestión de servicios y ratios mínimos
│   │   │       ├── personal/            # Directorio de colaboradores y novedades
│   │   │       ├── planificador/        # Matriz visual interactiva (CORE)
│   │   │       │   ├── components/grid/ # Tabla de cuadrante mensual con CDK
│   │   │       │   ├── components/cell/ # Celda de turno con menú contextual
│   │   │       │   └── state/           # Signals para totales y alertas
│   │   │       └── portal-empleado/     # Vista de turnos personales y solicitudes
│   ├── package.json
│   └── angular.json
└── README.md
```

---

## 3. Diseño Clave: El Componente Planificador (Grid Tipo Thurni)

Para lograr la experiencia ágil de Thurni en el frontend con Angular:

1. **Estado en Memoria (Signals)**:
   - Los datos del mes seleccionado se cargan en un Signal central del cuadrante.
   - Cada edición de una celda actualiza el Signal de forma inmutable.
   - Dos Signals computados (`computed`):
     - `totalesPorEmpleado`: recalcula al instante las horas acumuladas del mes por persona.
     - `coberturaPorTurno`: recalcula en tiempo real los profesionales asignados en cada turno frente al requerimiento mínimo de la dependencia.
2. **Validación Instantánea en Cliente**:
   - Al seleccionar o cambiar un turno en la celda, el servicio de reglas en Angular evalúa si se infringe descanso de 12h o post-guardia.
   - Si hay conflicto, la celda parpadea con borde rojo y tooltip explicativo ("Descanso insuficiente: 8h transcurridas desde el turno anterior").
3. **Persistencia y Guardado**:
   - Estrategia de guardado con debounce automático o botón explícito de "Guardar cambios", enviando un lote optimizado de mutaciones al backend de NestJS mediante una transacción de base de datos.
