# Guía de Despliegue en Docker — Rafa Turnos Hospitalarios

Este repositorio contiene la arquitectura completa empaquetada en contenedores Docker para su integración con la **Intranet Hospitalaria** y demás aplicativos satélite.

---

## 1. Despliegue Inmediato

Para poner en marcha todo el ecosistema (Base de Datos PostgreSQL 16 + Backend NestJS + Frontend Angular con Nginx):

```bash
# 1. Clonar el repositorio
git clone https://github.com/jhoncalderonvargas-hub/RafaTurnos.git
cd RafaTurnos

# 2. (Recomendado en servidor) Definir secretos en archivo .env en la raíz del proyecto
# INTRANET_JWT_SECRET=<secreto_largo_compartido_con_intranet>
# INTRANET_API_KEY=<api_key_lectura_intranet>
# POSTGRES_PASSWORD=<clave_robusta_postgresql>
# CORS_ORIGIN=https://turnos.hospital.gov.co,https://intranet.hospital.gov.co
# INTRANET_RETURN_URL=https://intranet.hospital.gov.co
# INTRANET_API_URL=http://intranet-contenedor:puerto

# 3. Levantar los 3 contenedores en segundo plano
docker compose up -d --build
```

### ¿Qué hace automáticamente `docker compose up`?
1. **`db`**: Levanta PostgreSQL 16 vinculado exclusivamente a `127.0.0.1:5432` (interfaz local *loopback* del host) y espera a que el servicio esté saludable (*healthcheck*).
2. **`backend`**: Construye una imagen de producción sin `devDependencies` (`npm ci --omit=dev`), ejecuta **`prisma migrate deploy`** para aplicar las migraciones versionadas en PostgreSQL y arranca la API NestJS en el puerto `3000`.
3. **`frontend`**: Compila Angular en producción, lo monta sobre Nginx en el puerto `4200` con cabeceras de seguridad (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`) y activa el proxy inverso transparente para `/api/v1/` preservando `Host` y `X-Forwarded-Host` (`$http_host`) para enlaces iCal.

---

## 2. Acceso a la Aplicación

- **Frontend Web**: [http://localhost:4200](http://localhost:4200) (o `http://<IP-DEL-SERVIDOR>:4200`)
- **Backend API**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
- **Feeds iCal móviles**: [http://localhost:3000/api/v1/calendario/feed/:token.ics](http://localhost:3000/api/v1/calendario/feed/:token.ics) (también accesibles vía `/api/v1/calendario/feed/:token.ics` a través de Nginx)

---

## 3. Cargar el Catálogo Hospitalario Inicial (Siembra / Seed)

> ⚠️ **ADVERTENCIA DESTRUCTIVA**: El script [`backend/prisma/seed.ts`](./backend/prisma/seed.ts) ejecuta `deleteMany()` sobre **todas las 16 tablas** de PostgreSQL antes de insertar el catálogo base de prueba (~150 colaboradores, 14 servicios, categorías, turnos y festivos 2026). **Ejecútalo ÚNICAMENTE en bases de datos vacías o entornos de desarrollo/staging — NUNCA sobre una base de datos con programación o saldos reales.**

Si la base de datos está vacía y deseas cargar los 14 servicios hospitalarios y el catálogo base:

```bash
docker compose exec backend npx ts-node prisma/seed.ts
# O en desarrollo local desde backend/:
npm run prisma:seed
```

*(Nota: la imagen `runner` de producción omite `devDependencies` como `ts-node`, por lo que el sembrado inicial en staging se realiza antes de desplegar contra PostgreSQL o usando `npm run prisma:seed` desde `backend/` con `DATABASE_URL` apuntando a la BD).*

---

## 4. Conectar con la Red Existente de la Intranet Hospitalaria

Si la **Intranet Hospitalaria** u otros sistemas satélite ya corren dentro de una red Docker existente (por ejemplo, llamada `red-hospital`):

1. Abre [`docker-compose.yml`](./docker-compose.yml).
2. Al final del archivo, en la sección `networks`, descomenta la configuración de red externa:

```yaml
networks:
  rafa-net:
    external: true
    name: red-hospital
```

3. Ajusta las variables de entorno en el `.env` raíz o en `docker-compose.yml`:
   - `INTRANET_JWT_SECRET`: Secreto compartido para validar tokens JWT SSO.
   - `INTRANET_API_KEY`: Llave de API enviada en `x-api-key` hacia los endpoints de maestros de la Intranet.
   - `INTRANET_API_URL`: URL interna de la API REST de la Intranet (por ejemplo `http://intranet-contenedor:puerto`).
   - `INTRANET_RETURN_URL`: URL pública de retorno hacia el portal de la Intranet.
   - `CORS_ORIGIN`: Orígenes HTTP permitidos.

---

## 5. Comandos Útiles de Mantenimiento

```bash
# Ver logs en vivo de todos los servicios
docker compose logs -f

# Ver logs únicamente del backend
docker compose logs -f backend

# Aplicar nuevas migraciones Prisma sin reiniciar volúmenes
docker compose exec backend node node_modules/prisma/build/index.js migrate deploy

# Reiniciar los servicios
docker compose restart

# Detener los servicios conservando los datos de PostgreSQL
docker compose stop

# Detener y borrar volúmenes de prueba (¡Precaución: borra los datos de PostgreSQL!)
docker compose down -v
```
