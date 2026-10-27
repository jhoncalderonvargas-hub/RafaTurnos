# 10. Reporte de Tipos de Horas y Recargos para Nómina (Desacoplamiento Financiero)

## 1. Principio Clave: Cero Lógica de Pagos o Valores Monetarios
Un principio arquitectónico fundamental definido para **Rafa Turnos** es el **desacoplamiento financiero estricto**:
- **Rafa Turnos NO calcula sueldos, tarifas por hora ni valores monetarios en pesos ($)**. Toda la valorización salarial, deducciones de seguridad social, retención en la fuente y pagos reales son responsabilidad exclusiva del software de nómina de la institución (Novasoft, Siigo, Kactus, SAP, etc.).
- **Responsabilidad de Rafa Turnos**: Medir con precisión quirúrgica el **volumen de horas y días por tipo de concepto y recargo legal**, generando el reporte en Excel consolidado que Gestión Humana entrega a Nómina.

---

## 2. Clasificación de Conceptos de Tiempo (Horas Reportadas)

El sistema clasifica las horas laboradas en los conceptos legales estándar según el Código Sustantivo del Trabajo (CST) en Colombia:

| Código | Concepto Reportado | Franja Horaria / Naturaleza | Unidad de Medida |
|---|---|---|:---:|
| **HOD** | Horas Ordinarias Diurnas | 06:00 a 21:00 (Lunes a Sábado) | Cantidad de horas |
| **HON** | Horas Ordinarias Nocturnas | 21:00 a 06:00 (Lunes a Sábado) | Cantidad de horas |
| **HDFD** | Horas Dominicales / Festivas Diurnas | 06:00 a 21:00 en Domingos o Festivos | Cantidad de horas |
| **HDFN** | Horas Dominicales / Festivas Nocturnas | 21:00 a 06:00 en Domingos o Festivos | Cantidad de horas |
| **HED** | Horas Extras Diurnas | Exceso de jornada en día hábil | Cantidad de horas |
| **HEN** | Horas Extras Nocturnas | Exceso de jornada en noche hábil | Cantidad de horas |
| **HEDDF** | Horas Extras Dominicales/Festivas Diurnas | Exceso en domingo o festivo | Cantidad de horas |
| **HENDF** | Horas Extras Dominicales/Festivas Nocturnas | Exceso nocturno en domingo o festivo | Cantidad de horas |
| **DOM_HAB** | Domingos Habituales Laborados | Conteo de domingos laborados en el mes | Cantidad de días |
| **COMP_DOM** | Días Compensatorios Causados | Derecho a libre compensatorio (si DOM_HAB >= 3) | Cantidad de días |
| **DIAS_INC** | Días de Incapacidad Médica | Ausencias justificadas por salud | Cantidad de días |
| **DIAS_VAC** | Días de Vacaciones | Periodo de descanso anual remunerado | Cantidad de días |

---

## 3. Estructura Lógica del Archivo Excel para Nómina (Estilo Thurni)

Actualmente, Thurni genera un archivo de Excel para el área de Nómina. Dicho archivo contiene una estructura lógica en **dos pestañas/vistas**:

### Pestaña A: "Resumen_Nomina" (Consolidado por Colaborador)
Es la matriz directa que el equipo de nómina importa o utiliza para calcular la planilla de pago mensual:

```text
┌────────────┬──────────────────┬────────────────┬──────────┬──────┬──────┬──────┬──────┬──────┬─────────┬─────────┐
│ Documento  │ Colaborador      │ Categoría      │ Servicio │ HOD  │ HON  │ HDFD │ HDFN │ HED  │ DOM_HAB │ COMP_DOM│
├────────────┼──────────────────┼────────────────┼──────────┼──────┼──────┼──────┼──────┼──────┼─────────┼─────────┤
│ 1098765432 │ Diana Mora       │ Enf. Jefe      │ Urgencia │ 120  │ 36   │ 12   │ 8    │ 0    │ 2       │ 0       │
│ 1012345678 │ Camilo López     │ Enf. Jefe      │ Urgencia │ 96   │ 48   │ 24   │ 16   │ 8    │ 3       │ 1       │
│ 1087654321 │ Carlos Ruiz      │ Médico Esp.    │ Urgencia │ 140  │ 24   │ 12   │ 0    │ 0    │ 1       │ 0       │
└────────────┴──────────────────┴────────────────┴──────────┴──────┴──────┴──────┴──────┴──────┴─────────┴─────────┘
```

### Pestaña B: "Cuadrante_Extendido_Detallado" (Día a Día 1..31)
En el mismo archivo se incluye la vista extendida día por día del cuadrante realmente ejecutado, de modo que el analista de nómina pueda auditar cualquier fecha en caso de dudas:

```text
┌────────────┬──────────────────┬───┬───┬───┬───┬───┬───┬───┬───┬─────────┬───────┐
│ Documento  │ Colaborador      │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ ... 31  │ Total │
│            │                  │ S │ D │ L │ M │ M │ J │ V │ S │         │ Horas │
├────────────┼──────────────────┼───┼───┼───┼───┼───┼───┼───┼───┼─────────┼───────┤
│ 1098765432 │ Diana Mora       │ N │ S │ M │ M │ T │ L │ L │ M │ ...     │ 176 h │
│ 1012345678 │ Camilo López     │ M │ M │ T │ T │ N │ S │ L │ N │ ...     │ 192 h │
└────────────┴──────────────────┴───┴───┴───┴───┴───┴───┴───┴───┴─────────┴───────┘
```

---

## 4. Cálculo en el Mismo Campo (Segmentación de Turnos Cruzados)

Cuando un turno cruza el corte de horario (ej. turno `N` de 12 horas, 19:00 a 07:00), el sistema no necesita campos separados en la interfaz del cuadrante:
- En la celda del cuadrante se sigue viendo de forma limpia y única: **`[ N ]`**.
- Pero el motor interno en NestJS desglosa internamente la celda en sus respectivos acumuladores de horas para el reporte de nómina:
  - 2 horas `HOD` (19:00 a 21:00)
  - 3 horas `HON` (21:00 a 24:00)
  - 6 horas `HDFN` si cruzó a domingo festivo (00:00 a 06:00)
  - 1 hora `HDFD` (06:00 a 07:00)

De esta forma:
1. **La supervisora no se enreda**: solo asigna `N`.
2. **Nómina recibe el reporte exacto**: con las columnas de horas exactas para liquidar la nómina legalmente en su propio sistema.

---

## 5. Proceso de Cierre y Descarga para Gestión Humana
1. La supervisora valida que no haya turnos pendientes ni sustituciones sin registrar en su servicio.
2. Gestión Humana hace la revisión general del mes y hace clic en **"Cerrar Periodo de Cuadrantes"**.
3. Gestión Humana hace clic en **"Exportar Reporte a Nómina (.xlsx)"**.
4. Se descarga el archivo de Excel formateado exactamente según la estructura acordada, listo para ser entregado o importado en el software de nómina.
