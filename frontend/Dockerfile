# ========================================================
# ETAPA 1: Construcción de la aplicación Angular (Multi-stage)
# ========================================================
FROM node:20-alpine AS build
WORKDIR /app

# Instalar dependencias
COPY package*.json ./
RUN npm ci

# Copiar código fuente y compilar bundle de producción
COPY . .
RUN npm run build

# ========================================================
# ETAPA 2: Servidor Web Nginx de Producción
# ========================================================
FROM nginx:alpine
WORKDIR /usr/share/nginx/html

# Eliminar configuración predeterminada de Nginx
RUN rm -rf ./* /etc/nginx/conf.d/default.conf

# Copiar el bundle estático compilado desde la etapa de build
COPY --from=build /app/dist/rafa-turnos-frontend/browser ./

# Copiar la configuración personalizada de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
