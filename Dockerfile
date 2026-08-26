# syntax=docker/dockerfile:1

########## Build stage ##########
FROM node:20-alpine AS builder

# openssl es requerido por los engines de Prisma
RUN apk add --no-cache openssl

# Alinea la npm de la imagen con la que generó package-lock.json,
# para que `npm ci` no falle por diferencias de resolución entre versiones de npm.
RUN npm install -g npm@11.6.2

WORKDIR /app

# Instala TODAS las dependencias (incluidas dev) para poder compilar
COPY package.json package-lock.json ./
RUN npm ci

# Codigo fuente
COPY . .

# Genera el cliente Prisma y compila la app
RUN npx prisma generate
RUN npm run build

# Elimina dependencias de desarrollo y regenera el cliente Prisma dentro
# del node_modules ya podado (asi el cliente viaja a la imagen final).
RUN npm prune --omit=dev && npx prisma generate

########## Runtime stage ##########
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Usuario sin privilegios
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nodejs

# Artefactos necesarios en runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

USER nodejs

EXPOSE 3000

# Aplica migraciones pendientes y arranca el servidor.
# migrate deploy es no destructivo: solo aplica migraciones no aplicadas.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
