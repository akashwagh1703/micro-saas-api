# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# OpenSSL is required by the Prisma engine.
RUN apk add --no-cache openssl

# Copy the Prisma schema before install so the postinstall `prisma generate` hook works.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package*.json ./

EXPOSE 3000

# Apply pending migrations on boot, then start the API + in-process queue worker.
# Render Postgres is not pooled — default DIRECT_URL to DATABASE_URL when unset.
CMD ["sh", "-c", "export DIRECT_URL=\"${DIRECT_URL:-$DATABASE_URL}\" && npx prisma migrate deploy && node dist/main.js"]
