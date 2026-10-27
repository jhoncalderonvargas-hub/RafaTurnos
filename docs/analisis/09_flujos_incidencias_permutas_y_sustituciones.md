# 09. Flujos de Incidencias, Permutas y Sustituciones

## 1. La Realidad Operativa: Lo que Sucede Durante el Mes
El cuadrante mensual planificado y publicado casi nunca se ejecuta al 100% como fue previsto. En el entorno hospitalario surgen eventos diarios:
- **Ausencias imprevistas de última hora**: Un enfermero amanece enfermo con incapacidad a las 05:30 AM para el turno de las 07:00 AM.
- **Intercambios acordados entre compañeros (Permutas)**: Un médico requiere cambiar su guardia del domingo por un compromiso personal.
- **Necesidades sobrevenidas de refuerzo**: Un pico epidemiológico en Urgencias exige abrir 3 camas adicionales de reanimación y sumar 2 auxiliares.

---

## 2. Flujo 1: Intercambio de Turnos 1-a-1 (Permutas entre Pares)

Este flujo empodera al personal y reduce drásticamente las llamadas y quejas a Gestión Humana:

```mermaid
sequenceDiagram
    autonumber
    actor A as Empleado Solicitante (Diana)
    actor B as Empleado Receptor (Camilo)
    participant Sys as Motor de Reglas Rafa Turnos
    actor Sup as Supervisora de Enfermería

    A->>Sys: Propone cambio: "Mi turno N del día 12 por tu turno M del día 15"
    Sys->>Sys: Simula ambos cuadrantes en segundo plano
    alt Infracción de Reglas (ej. Descanso < 12h o exceso de horas)
        Sys-->>A: Rechazo automático: "El cambio dejaría a Camilo con solo 6h de descanso el día 15"
    else Validación Exitosa
        Sys->>B: Notificación en Portal/Intranet: "Diana solicita permutar turno contigo"
        alt B Rechaza
            B-->>Sys: Rechaza solicitud
            Sys-->>A: Notifica: "Camilo ha declinado la permuta"
        else B Acepta
            B-->>Sys: Acepta solicitud
            Sys->>Sup: Pasa a bandeja de la Supervisora con semáforo verde (Validado)
            alt Sup Aprueba
                Sup-->>Sys: Aprueba con 1 clic
                Sys->>Sys: Aplica cambio en el Cuadrante Ejecutado
                Sys-->>A: Notifica: "Permuta aprobada y registrada"
                Sys-->>B: Notifica: "Permuta aprobada y registrada"
            else Sup Rechaza
                Sup-->>Sys: Rechaza con motivo ("Conflicto asistencial en la fecha")
                Sys-->>A: Notifica rechazo y motivo
            end
        end
    end
```

### Reglas Clave de la Permuta
1. **Misma Categoría Profesional y Servicio**: Una enfermera jefe solo puede permutar con otra enfermera jefe con competencias activas en el mismo servicio.
2. **Equilibrio de Horas**: El sistema advierte si el cambio genera un desbalance patrimonial de horas al cierre de mes entre ambos colaboradores.
3. **Plazo Límite de Solicitud**: Configurable (ej. mínimo 24 o 48 horas de antelación, salvo excepciones forzadas por la supervisora).

---

## 3. Flujo 2: Ausencias Imprevistas y Bolsa de Refuerzos

Cuando un colaborador notifica una baja médica repentina:

```mermaid
flowchart TD
    A[Notificación de Incapacidad Médica] --> B[Registro en el Cuadrante: Marca celda como INC]
    B --> C[Alerta Inmediata: Déficit de Cobertura en el Turno]
    C --> D[Motor de Búsqueda de Sustitutos]
    D --> E[Filtra candidatos disponibles:]
    E --> E1[1. Misma categoría asistencial]
    E --> E2[2. Estatus 'Libre' ese día]
    E --> E3[3. Cumple descanso >= 12h previo y posterior]
    E --> E4[4. Ordenados por menor número de horas acumuladas en el mes]
    D --> F[Supervisor selecciona candidato sugerido con 1 clic]
    F --> G[Sistema registra 'Turno de Refuerzo/Sustitución' y notifica al colaborador]
```

### Registro de la Sustitución
- El sistema no borra al empleado ausente: la celda original se marca con la novedad (`INC`), y el sistema inserta el turno de refuerzo al empleado disponible.
- Se preserva la causa: queda constancia de que fue un refuerzo de contingencia para justificar el pago de recargo u horas complementarias ante Gestión Humana.

---

## 4. Flujo 3: Solicitud de Vacaciones y Días de Libre Disposición

- El colaborador solicita su periodo de vacaciones desde el portal.
- El sistema proyecta el impacto en el cuadrante:
  - Muestra a la supervisora si en ese rango de fechas ya hay otros miembros del equipo en vacaciones (para evitar dejar el servicio sin masa crítica).
- Una vez aprobadas por RRHH en la Intranet, las fechas se bloquean con la ficha `VAC` en el cuadrante de Rafa Turnos de forma automática e irreversible para el planificador manual.
