#Requires -Version 5.1
<#
.SYNOPSIS
  Release B smoke checks against live AutoWave API (post-deploy).

.EXAMPLE
  .\scripts\v4-release-b-smoke.ps1
  .\scripts\v4-release-b-smoke.ps1 -BaseUrl "https://api.autowave.playltp.in/api"
#>
param(
  [string]$BaseUrl = "https://api.autowave.playltp.in/api"
)

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0

function Assert-Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = "")
  if ($Ok) {
    Write-Host "[PASS] $Name" -ForegroundColor Green
    if ($Detail) { Write-Host "       $Detail" -ForegroundColor DarkGray }
    $script:passed++
  } else {
    Write-Host "[FAIL] $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "       $Detail" -ForegroundColor Yellow }
    $script:failed++
  }
}

function Get-StatusCode {
  param([string]$Uri, [string]$Method = "Get")
  try {
    Invoke-WebRequest -Uri $Uri -Method $Method -TimeoutSec 20 -UseBasicParsing | Out-Null
    return 200
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

Write-Host "`n=== AutoWave v4 Release B smoke ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl`n"

# Health
try {
  $healthRoot = $BaseUrl -replace '/api$', ''
  $health = Invoke-RestMethod -Uri "$healthRoot/up" -Method Get -TimeoutSec 20
  Assert-Check "API health /up" ($health.status -eq 'ok') "status=$($health.status)"
} catch {
  Assert-Check "API health /up" $false $_.Exception.Message
}

# Release A regression — catalog v2
try {
  $catalog = Invoke-RestMethod -Uri "$BaseUrl/platform/verticals" -Method Get -TimeoutSec 20
  Assert-Check "Catalog version is 2" ($catalog.version -eq 2) "version=$($catalog.version)"
  $salon = $catalog.verticals | Where-Object { $_.key -eq 'salon' }
  Assert-Check "Salon vertical present" ($null -ne $salon) ""
} catch {
  Assert-Check "GET /platform/verticals" $false $_.Exception.Message
}

# Feature flags — Release B target
try {
  $features = Invoke-RestMethod -Uri "$BaseUrl/platform/features" -Method Get -TimeoutSec 20
  Assert-Check "Features endpoint exists" $true ""
  Assert-Check "catalog_version=2" ($features.catalog_version -eq 2) ""
  Assert-Check "v4_catalog_enabled=true" ($features.v4_catalog_enabled -eq $true) "v4_catalog_enabled=$($features.v4_catalog_enabled)"
  Assert-Check "v4_availability_enabled=true" ($features.v4_availability_enabled -eq $true) "v4_availability_enabled=$($features.v4_availability_enabled)"
} catch {
  Assert-Check "GET /platform/features" $false $_.Exception.Message
}

# Availability routes registered (401 without token = route exists + auth required)
$resourcesStatus = Get-StatusCode -Uri "$BaseUrl/availability/resources"
Assert-Check "Availability /resources route (401 unauthenticated)" ($resourcesStatus -eq 401) "status=$resourcesStatus"

$bookingsStatus = Get-StatusCode -Uri "$BaseUrl/availability/bookings"
Assert-Check "Availability /bookings route (401 unauthenticated)" ($bookingsStatus -eq 401) "status=$bookingsStatus"

Write-Host "`n--- Summary ---" -ForegroundColor Cyan
Write-Host "Passed: $passed  Failed: $failed"
if ($failed -gt 0) {
  Write-Host "`nDeploy API with V4_CATALOG_ENABLED=true and V4_AVAILABILITY_ENABLED=true, then re-run." -ForegroundColor Yellow
  Write-Host "Optional authenticated E2E: .\scripts\v4-release-b-salon-api.ps1 -Token <bearer>" -ForegroundColor Yellow
  exit 1
}
Write-Host "`nRelease B API smoke OK. Run salon API E2E + portal/mobile manual checks next." -ForegroundColor Green
exit 0
