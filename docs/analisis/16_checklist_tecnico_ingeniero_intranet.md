# 16. Cuestionario y Checklist Técnico para el Ingeniero de la Intranet

Este documento contiene la lista exacta de requerimientos técnicos, preguntas y contratos de datos que debes solicitar al ingeniero o equipo desarrollador de la Intranet Hospitalaria para habilitar la integración fluida con **Rafa Turnos**.

---

## Bloque 1: Autenticación y Single Sign-On (SSO)
El objetivo es que los usuarios que ya iniciaron sesión en la Intranet ingresen a Rafa Turnos sin volver a pedir usuario y contraseña.

### Preguntas Técnicas:
1. **Mecanismo de Token**:
   - ¿Qué estándar utiliza la Intranet para la sesión? *(Se asume JWT - JSON Web Token)*.
   - ¿Qué algoritmo de firma utiliza? *(ej. `HS256` con clave secreta compartida, o `RS256` con par de claves pública/privada)*.
   - ¿Podemos disponer de la clave pública (o secreta) para que el backend de NestJS valide la firma de forma autónoma?
2. **Payload del Token (Claims)**:
   - ¿Qué información viaja dentro del token? Necesitamos idealmente:
     - Identificador de usuario (`sub` o `id`).
     - Cédula / Documento de identidad.
     - Nombres y Apellidos.
     - Rol en la Intranet (ej. `ADMIN`, `SUPERVISOR`, `EMPLEADO`).
     - ID de la dependencia a la que pertenece o tiene a cargo.
3. **Mecanismo de Paso del Token al satélite**:
   - Cuando el usuario hace clic en el menú "Gestión de Turnos":
     - ¿Cómo se transfiere la sesión? *(Opciones habituales: redirección con token temporal en query param `?token=...`, cookie `HttpOnly` compartida en el mismo dominio, o cabecera `Authorization: Bearer ...`)*.
4. **Endpoint de Validación / Introspección (Opcional si hay clave compartida)**:
   - ¿Tienen un endpoint como `GET /api/v1/auth/me` o `POST /api/v1/auth/verify` para validar un token y obtener los datos del usuario en sesión?

---

## Bloque 2: API REST de Maestros (Empleados y Dependencias)
Rafa Turnos consultará la Intranet para sincronizar los servicios del hospital y la lista de personal activo.

### Preguntas Técnicas:
1. **Credenciales de Integración Servidor a Servidor (M2M)**:
   - ¿Cómo se autentica el backend de NestJS contra la API de la Intranet para consultar datos en segundo plano? *(¿API Key en cabecera `X-API-KEY`, token Bearer de servicio, o credenciales Basic Auth?)*.
2. **Endpoint de Dependencias / Servicios**:
   - ¿Cuál es la ruta exacta? *(ej. `GET /api/v1/dependencias` o `/servicios`)*.
   - ¿Qué estructura JSON devuelve? (Requerido: `id`, `codigo`, `nombre`, `piso_ubicacion`, `estado`).
3. **Endpoint de Directorio de Empleados**:
   - ¿Cuál es la ruta exacta? *(ej. `GET /api/v1/empleados`)*.
   - ¿Soporta filtros? *(ej. filtrar por dependencia `?dependencia_id=12` o solo activos `?estado=ACTIVO`)*.
   - ¿Devuelve paginación o el listado completo?
   - ¿Qué estructura JSON entrega por colaborador? Necesitamos confirmar estos campos:
     - `id`: Identificador único en la intranet.
     - `tipo_documento` y `numero_documento` (Cédula).
     - `nombres` y `apellidos`.
     - `correo_electronico`: Correo institucional.
     - `cargo` / `categoria_profesional`: (Médico Especialista, Médico General, Enfermero Jefe, Auxiliar de Enfermería, Camillero, etc.).
     - `dependencia_id`: A qué servicio pertenece principalmente.
     - `estado`: `ACTIVO`, `INACTIVO`, etc.
4. **URLs de Entornos**:
   - URL base de la API en ambiente de **Desarrollo / Pruebas** (Staging).
   - URL base de la API en ambiente de **Producción**.

---

## Bloque 3: Novedades de Personal (Vacaciones e Incapacidades)
Para evitar que una supervisora programe turnos a alguien que está de vacaciones o incapacitado:

### Preguntas Técnicas:
1. **Gestión de Novedades**:
   - ¿La Intranet ya registra las solicitudes de vacaciones y las incapacidades médicas radicadas?
2. **Endpoint de Consulta**:
   - ¿Existe un endpoint para consultar las novedades por rango de fechas? *(ej. `GET /api/v1/novedades?desde=2026-08-01&hasta=2026-08-31` o `GET /api/v1/empleados/:id/novedades`)*.
   - Si no existe actualmente: ¿Pueden exponerlo, o prefieren que en el MVP las novedades se registren directamente en la paleta de Rafa Turnos con las fichas `VAC` e `INC`?

---

## Bloque 4: Integración Visual y Despliegue (UX)

### Preguntas Técnicas:
1. **Enlace en el Menú de la Intranet**:
   - ¿En qué sección del menú institucional ubicarán el botón de acceso? *(ej. Módulo "Gestión Asistencial" -> "Programación de Turnos")*.
2. **URL de Retorno**:
   - ¿Cuál es la URL exacta a la que debe redirigir el botón **"← Volver a la Intranet"** en la barra superior de Rafa Turnos? *(ej. `https://intranet.hospital.com/dashboard`)*.
3. **Dominio y Red**:
   - ¿Rafa Turnos se alojará en un subdominio (ej. `turnos.hospital.com`) o en una subruta gestionada por proxy inverso (ej. `intranet.hospital.com/turnos`)?
   - ¿El servidor de Rafa Turnos tiene acceso de red directo al servidor de la Intranet dentro de la red hospitalaria?

---

## Resumen en 1 Hoja (Para enviar por Correo o WhatsApp)

> **Hola [Nombre del Ingeniero],**  
> Estamos estructurando el nuevo aplicativo de **Gestión de Turnos Hospitalarios (Rafa Turnos)** como servicio satélite de la Intranet. Para conectar ambos sistemas de forma transparente, requerimos coordinar contigo los siguientes 4 puntos técnicos:
> 
> 1. **SSO con JWT**: Conocer el algoritmo de firma del token de sesión de la intranet (`HS256`/`RS256`), el payload que contiene (ID, cédula, nombre, cargo, rol) y la clave para validar la sesión sin pedir login de nuevo.
> 2. **API de Empleados y Dependencias**: Los endpoints REST (y credencial API Key/Token) para que nuestro backend consulte la lista de servicios y colaboradores activos.
> 3. **Novedades (Vacaciones/Incapacidades)**: Saber si la intranet expone las ausencias médicas aprobadas vía API o si las gestionamos localmente en el cuadrante.
> 4. **Navegación y Entornos**: La URL de pruebas de la API y la URL de retorno para el botón "Volver a la Intranet".
