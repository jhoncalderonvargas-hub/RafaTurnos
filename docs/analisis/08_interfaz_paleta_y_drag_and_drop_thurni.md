# 08. Interfaz con Paleta de Turnos y Drag & Drop (Paridad Thurni)

## 1. Principio de Adopción: Cero Curva de Aprendizaje
Para que el equipo de **Gestión Humana y las Supervisoras de Enfermería** no sufran fricción en la transición desde Thurni, la interfaz de **Rafa Turnos** replica fielmente el modelo mental al que ya están acostumbrados: **la Paleta de Turnos interactiva y el arrastre (Drag & Drop) sobre el cuadrante**.

---

## 2. Componentes de la Interfaz Estilo Thurni

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  🏥 RAFA TURNOS  |  Servicio: [ UCI Adultos ▼ ]   Mes: [ Agosto 2026 ▼ ]   [⬅ Volver a la Intranet]    │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  PALETA DE TURNOS RÁPIDA (Arrastra hacia el cuadrante o selecciona para pintar)                        │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌──────┐ ┌─────┐  [ 🧽 Borrador ] [ 🤖 Auto ] │
│  │  M  │ │  T  │ │  N  │ │ G12 │ │  S  │ │  L  │ │ VAC │ │ INC  │ │ ... │                             │
│  │ 07- │ │ 13- │ │ 19- │ │Guard│ │Salie│ │Libre│ │Vaca-│ │Incap│ │     │                             │
│  │ 13h │ │ 19h │ │ 07h │ │ 12h │ │ nte │ │     │ │ción │ │ acid │ │     │                             │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └──────┘ └─────┘                             │
├──────────────────────────────────┬───┬───┬───┬───┬───┬───┬───┬───┬─────────┬────────┬───────────────────┤
│ Personal / Cargo                 │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ ... 31  │ Horas  │ Noches / Domin.   │
│                                  │ S │ D │ L │ M │ M │ J │ V │ S │         │ Totales│                   │
├──────────────────────────────────┼───┼───┼───┼───┼───┼───┼───┼───┼─────────┼────────┼───────────────────┤
│ 👩‍⚕️ Enf. Diana Mora (Jefe)        │[N]│[S]│[M]│[M]│[T]│[L]│[L]│[M]│ ...     │ 176 h  │ 🌙 4  | ☀️ 2      │
│ 👨‍⚕️ Enf. Camilo López (Jefe)     │[M]│[M]│[T]│[T]│ ⬇ │[L]│[L]│[N]│ ...     │ 168 h  │ 🌙 3  | ☀️ 2      │
│                                  │   │   │   │   │[N]│   │   │   │         │        │ (Arrastrando [N]) │
├──────────────────────────────────┼───┼───┼───┼───┼───┼───┼───┼───┼─────────┼────────┼───────────────────┤
│ 🟢 COBERTURA MAÑANA (Req: 3)     │ 3 │ 3 │ 3 │ 3 │ 3 │ 3 │ 3 │ 3 │ ...     │ ✅ 100% Cubierto          │
│ 🔴 COBERTURA NOCHE  (Req: 2)     │ 2 │ 2 │ 2 │ 2 │ 1 │ 2 │ 2 │ 2 │ ...     │ ⚠️ Día 5: Falta 1 [N]     │
└──────────────────────────────────┴───┴───┴───┴───┴───┴───┴───┴───┴─────────┴────────┴───────────────────┘
```

---

## 3. Modos de Asignación y Mecánicas de Arrastre

### Modo 1: Arrastre Directo desde la Paleta (Drag & Drop Individual)
- La paleta se ubica en la parte superior fija (o panel lateral flotante conmutador).
- El usuario hace clic sostenido en una ficha de la paleta (ej. `N` Noche) y la suelta en la celda del empleado y día deseado.
- **Validación al vuelo (DragOver)**:
  - Mientras el cursor pasa por encima de las celdas, la celda destino reacciona:
    - **Aura Verde**: Asignación perfecta (cumple descanso y no tiene incompatibilidades).
    - **Aura Ámbar/Roja**: Infracción potencial (ej. *"Solo 7h de descanso desde el turno previo"* o *"Colaborador con vacaciones en esa fecha"*).
  - Al soltar (Drop), la celda se actualiza instantáneamente en el estado de Angular Signals sin refrescar la página.

### Modo 2: Arrastre Múltiple / Modo Pincel (Multi-cell Drag)
- En Thurni es común querer asignar `M` (Mañana) de lunes a viernes a un mismo colaborador:
  - Se selecciona la ficha `M` en la paleta (queda en estado activo "Pincel").
  - El usuario hace clic en el día Lunes y arrastra horizontalmente el ratón hasta el Viernes; las 5 celdas se colorean y asignan simultáneamente al soltar el ratón.

### Modo 3: Reubicación o Duplicación de Turno entre Celdas
- **Mover**: Arrastrar un turno ya colocado en el día 4 hacia el día 5 del mismo empleado para cambiarlo de fecha.
- **Copiar**: Mantener presionada la tecla `Ctrl` mientras se arrastra un turno de una celda para duplicarlo a otra celda o a otro compañero.

### Modo 4: Borrado Rápido (Goma / Tecla Supr)
- Arrastrar la herramienta "Goma" desde la paleta hacia cualquier celda para dejarla en blanco (`Libre no programado`), o seleccionar una o varias celdas y presionar `Delete` / `Backspace`.

---

## 4. Código Cromático y Fichas de Turno (Inspirado en Thurni)

Para que el personal identifique los cuadrantes de un vistazo:

| Código | Turno | Color Distintivo | Franja Horaria | Horas Efectivas |
|---|---|---|---|---|
| **`M`** | Mañana | Azul Cielo (`#E0F2FE` / texto `#0369A1`) | 07:00 – 13:00 / 15:00 | 6h u 8h |
| **`T`** | Tarde | Amarillo Ámbar (`#FEF3C7` / texto `#B45309`) | 13:00 – 19:00 / 22:00 | 6h u 7h |
| **`N`** | Noche | Púrpura / Azul Noche (`#EDE9FE` / texto `#6D28D9`) | 19:00 – 07:00 | 12h (con recargo nocturno) |
| **`G12`** | Guardia 12h | Naranja Intenso (`#FFEDD5` / texto `#C2410C`) | 07:00 – 19:00 | 12h diurnas |
| **`G24`** | Guardia 24h | Rojo Coral (`#FEE2E2` / texto `#B91C1C`) | 07:00 – 07:00 (+1) | 24h continuas médicas |
| **`S`** | Saliente | Cian Suave (`#ECFEFF` / texto `#0E7490`) | Todo el día | 0h (Descanso post-noche) |
| **`L`** | Libre | Gris Neutro (`#F3F4F6` / texto `#4B5563`) | Todo el día | 0h (Descanso programado) |
| **`VAC`** | Vacaciones | Verde Esmeralda (`#D1FAE5` / texto `#047857`) | Periodo continuo | Bloqueo por RRHH |
| **`INC`** | Incapacidad | Magenta Claro (`#FCE7F3` / texto `#BE185D`) | Periodo médico | Bloqueo por ARL/EPS |

---

## 5. Implementación Técnica en Angular (Alto Rendimiento)

Para soportar una grilla de 100 empleados x 31 días (3.100 celdas interactivas) sin degradar la fluidez del navegador:

1. **Angular CDK Drag and Drop (`@angular/cdk/drag-drop`)**:
   - Se utiliza `cdkDropList` conectado (`cdkDropListConnectedTo`) entre la barra de la paleta y la matriz.
   - Plantilla de arrastre ligera (`cdkDragPlaceholder` y `cdkDragPreview`) que evita recalcular el árbol DOM completo durante el movimiento del ratón.
2. **Signals y OnPush Change Detection**:
   - La matriz utiliza `ChangeDetectionStrategy.OnPush`.
   - Cada fila de empleado y cada celda está vinculada a un Signal específico; soltar un turno solo dispara la re-renderización de **esa celda individual** y de los dos acumuladores (el total del empleado y el total de la columna del día), logrando 60 FPS estables.
3. **Persistencia en Lote (Debounce Save)**:
   - Los cambios hechos con drag & drop se aplican de inmediato en memoria en el cliente.
   - Se encolan y se envían al backend de NestJS mediante un guardado automático con debounce (ej. 1 segundo tras la última modificación) o con un botón explícito de *"Guardar Borrador"*, evitando saturar la base de datos con una petición por cada arrastre individual.
