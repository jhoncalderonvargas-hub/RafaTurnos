# 19. Gestión de Festivos Oficiales de Colombia, Persistencia y Estrategia de Caché en Memoria

## 1. Visión General y Contexto Legal Colombiano
En Colombia, los domingos y los días festivos oficiales generan un **recargo del 75% sobre la hora ordinaria** (según el Código Sustantivo del Trabajo - CST). Por ello, el motor de cuadrantes y liquidación de horas de **Rafa Turnos** requiere una identificación certera e instantánea de cada día festivo para calcular los conceptos `HDFD` (Horas Dominicales/Festivas Diurnas) y `HDFN` (Nocturnas).

### La Ley 51 de 1983 (Ley Emiliani)
Colombia cuenta con 18 días festivos anuales clasificados en tres naturalezas:
1. **Fijos e Inamovibles**: 1 de enero, 1 de mayo, 20 de julio, 7 de agosto, 8 de diciembre y 25 de diciembre.
2. **Móviles por Ley Emiliani**: Se trasladan al lunes siguiente cuando caen en día hábil o fin de semana (Reyes Magos, San José, San Pedro y San Pablo, Asunción de la Virgen, Día de la Raza, Todos los Santos, Independencia de Cartagena).
3. **Móviles Vinculados a la Pascua (Semana Santa y Religiosos)**: Jueves Santo, Viernes Santo, Ascensión del Señor, Corpus Christi y Sagrado Corazón.

---

## 2. Decisión Arquitectónica: Modelo Híbrido Resiliente
Para conciliar **autonomía técnica absoluta**, **velocidad en tiempo real** y **seguridad de persistencia ante reinicios**, se descartan librerías de terceros y servicios web externos, implementando una arquitectura de 3 capas:

```mermaid
flowchart TD
    subgraph Arranque [1. Arranque de NestJS - onApplicationBootstrap]
        A[Inicialización del Servidor] --> B[FestivosColombiaService]
        B --> C{¿Año en curso en PostgreSQL?}
        C -->|No| D[Ejecuta Algoritmo Meeus/Emiliani propio]
        D --> E[INSERT 18 festivos en tabla festivos_colombia]
        C -->|Sí| F[Lee registros de BD con ajustes manuales]
        E --> G[Precarga en Memoria RAM - Cache Warmup]
        F --> G
    end

    subgraph Operacion [2. Operación y Planificador]
        H[Supervisor arrastra turno en Angular] --> I[Consulta de Festivo en Memoria RAM O(1)]
        I --> J[Cálculo de Recargo HDFD / HDFN en 0.0001 ms]
        J --> K[Cero consultas SQL a PostgreSQL]
    end

    subgraph Excepcion [3. Ajuste Manual Institucional]
        L[Gestión Humana decreta 'Día Cívico'] --> M[Guarda en tabla festivos_colombia]
        M --> N[Invalida y refresca Map en Memoria RAM]
    end
```

---

## 3. Resiliencia ante Reinicios y Volatilidad de la Memoria RAM

### A. La Memoria RAM como Acelerador Volátil
La memoria RAM almacena un `Map<number, Set<string>>` indexado por año, donde cada elemento es la fecha en formato ISO `YYYY-MM-DD`:
- **Ventaja**: Tiempo de respuesta $O(1)$ (< 0.001 ms). Al arrastrar turnos masivamente o computar liquidaciones mensuales, no se genera tráfico ni contención sobre PostgreSQL.
- **Volatilidad**: Al reiniciar la máquina virtual, actualizar el backend o reiniciar un contenedor Docker, la memoria RAM se borra por completo.

### B. PostgreSQL como Fuente Única de la Verdad (Master of Record)
La tabla `festivos_colombia` conserva de manera inmutable y permanente todos los días festivos oficiales y los días cívicos creados manualmente:
- **Sobrevivencia a Reinicios**: Ningún reinicio, caída eléctrica o mantenimiento nocturno afecta los registros.
- **Calentamiento Automático (`onApplicationBootstrap`)**: Al iniciar NestJS, el servicio ejecuta la rutina de precarga en memoria para el año corriente y el año siguiente. Si el servidor se reinicia a las 03:00 AM, a las 03:01 AM la memoria RAM ya se encuentra 100% caliente y lista antes de recibir la primera petición del personal médico.

---

## 4. Algoritmo Propio Interno (Sin Dependencias Externas)

El servicio `FestivosColombiaService` en NestJS implementa el cálculo matemático directo en ~45 líneas de TypeScript:
1. **Cálculo de la Pascua**: Implementación del **Algoritmo de Butcher / Meeus** para determinar el Domingo de Resurrección para cualquier año $Y$.
2. **Cálculo de Fiestas de Pascua**:
   * Jueves Santo: Domingo de Pascua $- 3$ días.
   * Viernes Santo: Domingo de Pascua $- 2$ días.
   * Ascensión del Señor: Domingo de Pascua $+ 43$ días (trasladado al siguiente lunes).
   * Corpus Christi: Domingo de Pascua $+ 64$ días (trasladado al siguiente lunes).
   * Sagrado Corazón: Domingo de Pascua $+ 71$ días (trasladado al siguiente lunes).
3. **Regla de Traslado Emiliani**:
   * Si el día de la semana no es Lunes ($1$), la fecha se traslada al lunes inmediatamente siguiente:
   $$\text{diasHastaLunes} = (8 - \text{diaSemana}) \pmod 7$$

---

## 5. Esquema de Base de Datos (Prisma / PostgreSQL)

```prisma
model FestivoColombia {
  id              String   @id @default(uuid())
  fecha           DateTime @db.Date // YYYY-MM-DD
  anio            Int
  nombre          String   // Ej. "Independencia de Cartagena", "Día Cívico Institucional"
  esIrrenunciable Boolean  @default(true)
  esOficialLey    Boolean  @default(true) // False si fue creado manualmente por el hospital
  creadoEn        DateTime @default(now())

  @@unique([fecha])
  @@index([anio])
  @@map("festivos_colombia")
}
```

---

## 6. Rendimiento y Caché en el Frontend (Angular)

Para garantizar paridad de agilidad con Thurni en el cliente:
1. **Payload Unificado de Cuadrante**: Al abrir el mes (ej. `GET /api/v1/cuadrantes/2026/07`), el backend adjunta el array de festivos del mes: `festivos: ['2026-07-20']`.
2. **Set Reactivo en Signals**: Angular almacena las fechas en un `Set<string>`.
3. **Renderizado Visual Inmediato**: Las columnas correspondientes a domingos y festivos se pintan con un sombreado distintivo. Al arrastrar un turno sobre esa celda, el selector aplica el recargo festivo inmediatamente sin emitir peticiones HTTP adicionales.
