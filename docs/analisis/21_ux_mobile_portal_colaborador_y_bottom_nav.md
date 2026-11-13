# 21. Experiencia Móvil, Portal del Colaborador Responsive y Barra de Navegación Inferior

## 1. Contexto y Justificación Clínica

En el entorno de la **ESE Hospital San Rafael Yolombó**, el personal asistencial (médicos generales, especialistas, enfermeras jefes y auxiliares de enfermería) consulta su programación de turnos predominantemente desde teléfonos celulares personales durante sus guardias o en tránsito.

Un análisis comparativo frente a soluciones existentes en el mercado hospitalario (como **Thurni**) evidenció fricciones críticas en dispositivos móviles:
1. **Pérdida de espacio por barras laterales de escritorio:** El menú lateral clásico de escritorio (rail de 62px) consumía hasta el 18% del ancho horizontal disponible en smartphones (360px–412px), apretando el contenido y forzando scrolls laterales incómodos.
2. **Textos y turnos truncados en celular:** En cuadrículas mensuales comprimidas, los códigos de turno aparecían incompletos (ej: `« N -`, `TN -`), sin horarios explícitos y con bajo contraste.
3. **Ergonomía deficiente en pantallas táctiles (Thumb Zone):** El botón de hamburguesa (`☰`) ubicado en la esquina superior izquierda obliga a utilizar ambas manos para navegar en teléfonos modernos (pantallas de 6.1" a 6.7").
4. **Falta de acciones inmediatas:** Para solicitar un cambio o permuta de turno, el usuario se veía obligado a desplazarse entre múltiples pantallas y formularios desacoplados.

---

## 2. Arquitectura de la Solución Móvil

### A. Barra de Navegación Inferior (*Bottom Navigation Bar*) y Cajón Deslizante (*Bottom Sheet*)

Para garantizar una experiencia móvil moderna y ergonómica, se implementó una estrategia responsiva diferenciada por tamaño de pantalla (`<= 768px`):

```text
┌─────────────────────────────────────────────────────────────┐
│                      PANTALLA MÓVIL                         │
│                                                             │
│       Contenido a 100% de ancho sin barra lateral           │
│       (Selector Agenda/Mes, Tarjetas de Turnos, KPIs)       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│   [ 👩‍⚕️ ]           [ 🔄 ]           [ 📲 ]          [ ☰ ]   │
│  Mi Turno        Permutas (1)       Celular         Más     │
└─────────────────────────────────────────────────────────────┘
```

#### Características Clave:
1. **Ocultamiento Total del Rail Lateral:** En pantallas `<=` 768px, `.side-nav-rail` se oculta por completo (`display: none !important;`), entregando el **100% del ancho del viewport** al calendario y las métricas.
2. **Barra Inferior Fija (`.bottom-nav-bar`):**
   - Altura de 60px fija en la parte inferior con sombra suave y soporte nativo para *safe-area-inset-bottom* (iPhone con notch o barra de inicio).
   - Acciones prioritarias para el **Colaborador Asistencial**:
     - **`👩‍⚕️ Mi Turno`**: Activa la vista del calendario personal (resaltado morado institucional `#4a2096`).
     - **`🔄 Permutas`**: Lleva al panel de solicitudes de intercambio con badge numérico en tiempo real (`.bottom-badge`).
     - **`📲 Celular`**: Dispara el modal de suscripción RFC 5545 iCal para Google Calendar y Apple Calendar.
     - **`☰ Más`**: Abre el cajón deslizable con opciones secundarias y perfil del usuario.
   - Para **Coordinadores y Administradores TH**, la barra ofrece accesos rápidos a `📅 Turnos`, `🔄 Permutas`, `📊 Nómina` y `☰ Más`.
3. **Cajón Deslizante Inferior (*Bottom Sheet Drawer*):**
   - Se despliega desde la parte inferior con animación suave (`slideUpSheet`) y telón translúcido desenfocado (`backdrop-filter: blur(2px)`).
   - Muestra tirador de arrastre superior, logo del Hospital, tarjeta de usuario autenticado vía SSO (nombre, rol, documento) y enlaces a la Intranet Hospitalaria con confirmación.
   - Cierre táctil inmediato tocando el backdrop o el botón `✕`.
4. **Reserva de Espacio Inferior:** El contenedor de trabajo principal (`.main-workspace`) reserva `padding-bottom: 60px` para evitar que los botones inferiores o la última tarjeta de la agenda queden tapados.

---

### B. Selector Dual de Vista en el Portal del Colaborador: `[ 📋 Agenda | 📅 Mes ]`

En el componente [`PortalColaboradorComponent`](../../frontend/src/app/components/portal-colaborador/portal-colaborador.component.ts), se incorporó un selector segmentado accesible y reactivo mediante Angular Signals:

#### 1. Modo `📋 Agenda` (Optimizado para Celulares):
- Lista vertical continua día por día.
- **Detalle completo sin truncar:**
  - Número del día, día de la semana y badge destacado si es la fecha actual (`📍 Hoy`).
  - Distintivo normativo de festivos colombianos (`🇨🇴 Festivo: Nombre`).
  - Código y nombre completo del turno (`M8 · Mañana 8h`, `N8 · Noche 8h`, `🏖️ Descanso (Libre)`).
  - Horario de inicio y fin explícito (`07:00 – 15:00`, `23:00 – 07:00`).
  - Desglose de descansos intermedios y tandas (`🍽️ Break T1: 12:00–12:30`).
  - Etiqueta de rotación o apoyo de servicio (`🔄 Apoyo en Urgencias`).
  - Notas clínicas y fijación (`📌 Turno fijo`).
- **Botón `[ 🔄 Permutar ]` Directo:** Preselecciona el día y activa el panel de intercambio de forma instantánea.

#### 2. Modo `📅 Mes` (Cuadrícula Clásica + Ficha Inteligente Master-Detail):
- Cuadrícula de 7 columnas (Lunes a Domingo) con pastillas compactas de turnos y descansos.
- **Ficha Inteligente Master-Detail (`.dia-seleccionado-ficha`):**
  - Ubicada directamente debajo de la cuadrícula mensual.
  - Al hacer clic o tocar cualquier día, se actualiza al instante con los datos detallados del turno, descansos, notas y compañeros de guardia en ese servicio.

#### 3. Detección Inteligente y Persistencia:
- Al cargar en anchos menores a 768px, el sistema preselecciona automáticamente el modo **Agenda**.
- La elección del usuario se almacena en `localStorage` (`'rafa_portal_vista_modo'`) para recordar su preferencia entre sesiones.

---

## 3. Pruebas Automatizadas y Calidad

La implementación cuenta con cobertura de pruebas automatizadas:
- **Suite `SidebarNavegacionComponent` (6 pruebas):**
  - Renderizado de 4 botones para rol Colaborador.
  - Alternancia de clase `.active` según `vistaActual`.
  - Badges numéricos de notificaciones pendientes.
  - Apertura, contenido y cierre del Bottom Sheet Drawer al tocar `Más`, la `✕` o el backdrop.
  - Renderizado de opciones operativas para rol Administrador TH.
- **Suite `PortalColaboradorComponent` (5 pruebas):**
  - Renderizado del selector de vista `[ 📋 Agenda | 📅 Mes ]`.
  - Alternancia y persistencia en `localStorage`.
  - Renderizado de tarjetas completas en modo Agenda.
  - Emisión de evento al pulsar `[ 🔄 Permutar ]`.
  - Actualización de la Ficha Inteligente en modo Mes.
- **Total de pruebas Frontend:** **78 pruebas unitarias exitosas (Karma ChromeHeadless)**.
- **Total de pruebas de liquidación horaria:** **51 pruebas normativas OK**.
