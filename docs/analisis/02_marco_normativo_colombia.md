# 02. Marco Normativo Laboral Colombiano (Sector Salud)

## 1. Contexto Jurídico Laboral
El aplicativo incorpora las reglas estipuladas en el **Código Sustantivo del Trabajo (CST)** de Colombia, con especial atención a las actividades continuas de salud pública y la legislación reciente:

### A. Reducción Gradual de la Jornada Laboral (Ley 2101 de 2021)
- Establece la reducción paulatina de la jornada máxima legal semanal:
  - Hasta 2023: 48 horas semanales.
  - Desde julio 2023: 47 horas semanales.
  - Desde julio 2024: 46 horas semanales.
  - Desde julio 2025: 44 horas semanales.
  - Desde julio 2026 en adelante: 42 horas semanales.
- El sistema debe ser parametrizable para definir el tope de horas semanales/mensuales de cada contrato según el año en curso.

### B. Trabajo Nocturno y Diurno (Art. 160 CST)
- **Jornada Diurna**: Comprendida entre las 06:00 y las 21:00 horas (a la espera de reformas que pudieran ampliar el horario nocturno a partir de las 19:00).
- **Jornada Nocturna**: Comprendida entre las 21:00 y las 06:00 horas.
- **Recargo Nocturno Ordinario**: 35% sobre el valor de la hora diurna ordinaria.

### C. Descanso Dominical y Festivo (Art. 172 - 181 CST)
- **Recargo Dominical/Festivo**: 75% sobre la hora ordinaria por laborar en domingos o días feriados.
- **Descanso Compensatorio Remunerado**:
  - Trabajo habitual en domingo (tres o más domingos en el mes): da derecho a un día de descanso compensatorio remunerado en la semana siguiente.
  - Trabajo ocasional (uno o dos domingos): el trabajador puede optar entre el pago del recargo o el descanso compensatorio.

### D. Turnos Sucesivos en Labores Continuas (Art. 165 y 166 CST)
- En empresas o servicios cuya actividad no pueda interrumpirse (caso de las IPS y hospitales):
  - Se permite la fijación de turnos sucesivos de trabajo.
  - La jornada semanal promedio calculada en periodos de hasta 3 semanas no debe exceder los topes legales.
  - Se debe garantizar un descanso ininterrumpido entre el fin de una jornada y el inicio de la siguiente (mínimo técnico recomendado: 11 a 12 horas para preservar la salud ocupacional y prevenir eventos adversos clínicos).

---

## 2. Parámetros del Sistema derivados de la Ley

| Parámetro | Valor por Defecto | Configurable | Justificación |
|---|---|---|---|
| **Límite Horas Semanales** | 42 - 46 h (según vigencia) | Sí | Ley 2101 de 2021 |
| **Descanso Mínimo entre Turnos** | 12 horas | Sí | Salud laboral y seguridad del paciente |
| **Horario Inicio Nocturno** | 21:00 | Sí | Art. 160 CST |
| **Horario Fin Nocturno** | 06:00 | Sí | Art. 160 CST |
| **Descanso Post-Guardia (12h/24h)** | Día Saliente (`S`) obligatorio | Sí | Prevención de fatiga en personal médico/enfermería |
| **Máximo Noches Consecutivas** | 2 a 3 noches | Sí | Buenas prácticas de bioseguridad clínica |
