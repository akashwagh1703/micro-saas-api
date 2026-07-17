#!/bin/sh
set -e
# Render internal Postgres: DIRECT_URL often unset — use DATABASE_URL for migrations.
export DIRECT_URL="${DIRECT_URL:-$DATABASE_URL}"
echo "Running prisma migrate deploy..."
npx prisma migrate deploy
echo "Repairing website_leads (demo form) if needed..."
npx prisma db execute --file prisma/repair-website-leads.sql --schema prisma/schema.prisma || echo "WARN: repair-website-leads.sql skipped (check logs)"
echo "Starting API..."
exec node dist/main.js
