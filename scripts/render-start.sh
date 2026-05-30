#!/bin/sh
set -e
# Render internal Postgres: DIRECT_URL often unset — use DATABASE_URL for migrations.
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
echo "Running prisma migrate deploy..."
npx prisma migrate deploy
echo "Starting API..."
exec node dist/main.js
