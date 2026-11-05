# Guía de Despliegue en Docker — Rafa Turnos Hospitalarios

Este repositorio contiene la arquitectura completa empaquetada en contenedores Docker para su integración con la **Intranet Hospitalaria** y demás aplicativos satélite.

---

## 1. Despliegue Inmediato (1 Solo Paso)

Para poner en marcha todo el ecosistema (Base de Datos PostgreSQL 16 + Backend NestJS + Frontend Angular con Nginx):

```bash
# 1. Clonar el repositorio
git clone https://github.com/jhoncalderonvargas-hub/RafaTurnos.git
cd RafaTurnos

# 2. Levantar los 3 contenedores en segundo plano
docker compose up -d --build
```

### ¿Qué hace automáticamente `docker compose up`?
1. **`db`**: Levanta PostgreSQL 16 y espera a que el servicio esté saludable (*healthcheck*).
2. **`backend`**: Compila NestJS, ejecuta automáticamente `npx prisma db push` para crear las tablas e índices en PostgreSQL y arranca la API en el puerto `3000`.
3. **`frontend`**: Compila Angular en producción, lo monta sobre Nginx en el puerto `4200` y activa el proxy inverso transparente para `/api/v1/`.

---

## 2. Acceso a la Aplicación

- **Frontend Web**: [http://localhost:4200](http://localhost:4200) (o `http://<IP-DEL-SERVIDOR>:4200`)
- **Backend API**: [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health)
- **Feeds iCal móviles**: [http://localhost:3000/api/v1/calendario/feed/:token.ics](http://localhost:3000/api/v1/calendario/feed/:token.ics)

---

## 3. Cargar el Catálogo Hospitalario Inicial (Siembra / Seed)

Si la base de datos está vacía y deseas cargar los 14 servicios hospitalarios (Urgencias, Maternidad, Quirófanos, UCI, etc.), categorías y tipos de turno:

```bash
docker compose exec backend npm run prisma:seed
```

---

## 4. Conectar con la Red Existente de la Intranet Hospitalaria

Si la **Intranet Hospitalaria** u otros sistemas satélite ya corren dentro de una red Docker existente (por ejemplo, llamada `red-hospital`):

1. Abre `docker-compose.yml`.
2. Al final del archivo, en la sección `networks`, descomenta la configuración de red externa:

```yaml
networks:
  rafa-net:
    external: true
    name: red-hospital
```

3. Ajusta las variables de entorno para apuntar al contenedor de la intranet:
   - `INTRANET_JWT_SECRET`: La clave compartida con la Intranet.
   - `INTRANET_RETURN_URL`: `http://intranet-contenedor:puerto`

---

## 5. Comandos Útiles de Mantenimiento

```bash
# Ver logs en vivo de todos los servicios
docker compose logs -f

# Ver logs únicamente del backend
docker compose logs -f backend

# Reiniciar los servicios
docker compose restart

# Detener los servicios conservando los datos de PostgreSQL
docker compose down

# Detener y borrar volúmenes de prueba (¡Precaución: borra los datos de PostgreSQL!)
docker compose down -v
```
