# Apply business-scope columns to Render Postgres from your PC (free tier, External URL).
# Usage:
#   1. Render Dashboard -> PostgreSQL -> Connections -> copy "External Database URL"
#   2. In PowerShell:
#        $env:RENDER_EXTERNAL_DATABASE_URL = "postgresql://...region-postgres.render.com/...?sslmode=require"
#   3. Run this script from repo root:
#        .\scripts\apply-business-scope.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$url = $env:RENDER_EXTERNAL_DATABASE_URL
if (-not $url) {
  Write-Host ""
  Write-Host "ERROR: Set RENDER_EXTERNAL_DATABASE_URL first." -ForegroundColor Red
  Write-Host ""
  Write-Host "  Render -> PostgreSQL -> Connections -> External Database URL"
  Write-Host ""
  Write-Host '  $env:RENDER_EXTERNAL_DATABASE_URL = "postgresql://user:pass@dpg-xxx.region-postgres.render.com/dbname?sslmode=require"'
  Write-Host "  .\scripts\apply-business-scope.ps1"
  Write-Host ""
  exit 1
}

if ($url -match '@dpg-[^/]+/' -and $url -notmatch 'postgres\.render\.com') {
  Write-Host ""
  Write-Host "ERROR: This looks like Render INTERNAL URL (short hostname)." -ForegroundColor Red
  Write-Host "Use External Database URL from Render Postgres -> Connections." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

$env:DATABASE_URL = $url
$env:DIRECT_URL = $url

Write-Host "Applying SQL (business_category, use_case, is_archived)..." -ForegroundColor Cyan
npx prisma db execute --file prisma/scripts/apply-business-scope.sql --schema prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Marking Prisma migration as applied..." -ForegroundColor Cyan
npx prisma migrate resolve --applied 20260530120000_workflow_business_scope
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done. Guided Setup / setup-business should work on production now." -ForegroundColor Green
Write-Host ""
