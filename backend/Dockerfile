# ========================================================
# ETAPA 1: Compilación de NestJS y generación de Prisma
# ========================================================
FROM node:20-alpine AS builder
WORKDIR /app

# OpenSSL requerido por el Query Engine de Prisma en Alpine Linux
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ========================================================
# ETAPA 2: Imagen de Ejecución con auto-sincronización de BD
# ========================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci && npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Al iniciar el contenedor:
# 1. Aplica el esquema e índices en PostgreSQL (npx prisma db push)
# 2. Inicia el servidor NestJS de producción (dist/src/main.js)
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/main.js"]
