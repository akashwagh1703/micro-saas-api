#Requires -Version 5.1
<#
.SYNOPSIS
  Release A smoke checks against live AutoWave API (post-deploy).

.EXAMPLE
  .\scripts\v4-release-a-smoke.ps1
  .\scripts\v4-release-a-smoke.ps1 -BaseUrl "https://api.autowave.playltp.in/api"
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

Write-Host "`n=== AutoWave v4 Release A smoke ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl`n"

# Health
try {
  $healthRoot = $BaseUrl -replace '/api$', ''
  $health = Invoke-RestMethod -Uri "$healthRoot/up" -Method Get -TimeoutSec 20
  Assert-Check "API health /up" ($health.status -eq 'ok') "status=$($health.status)"
} catch {
  Assert-Check "API health /up" $false $_.Exception.Message
}

# Catalog v2
try {
  $catalog = Invoke-RestMethod -Uri "$BaseUrl/platform/verticals" -Method Get -TimeoutSec 20
  Assert-Check "Catalog version is 2" ($catalog.version -eq 2) "version=$($catalog.version)"
  $salon = $catalog.verticals | Where-Object { $_.key -eq 'salon' }
  Assert-Check "Salon vertical present" ($null -ne $salon) ""
  Assert-Check "Salon max_use_cases=1" ($salon.max_use_cases -eq 1) ""
  $signup = $catalog.verticals | Where-Object { $_.visible_in_signup -ne $false }
  $deprecatedHidden = -not (($signup.key) -contains 'farmer')
  Assert-Check "Farmer hidden from signup" $deprecatedHidden "signup count=$($signup.Count)"
  $activeUseCases = $catalog.use_cases | Where-Object { $_.visible_in_signup -ne $false }
  Assert-Check "3 active signup use cases" ($activeUseCases.Count -eq 3) "count=$($activeUseCases.Count)"
} catch {
  Assert-Check "GET /platform/verticals" $false $_.Exception.Message
}

# Feature flags endpoint
try {
  $features = Invoke-RestMethod -Uri "$BaseUrl/platform/features" -Method Get -TimeoutSec 20
  Assert-Check "Features endpoint exists" $true ""
  Assert-Check "catalog_version=2" ($features.catalog_version -eq 2) "catalog_version=$($features.catalog_version)"
  Assert-Check "v4_catalog_enabled=true" ($features.v4_catalog_enabled -eq $true) "v4_catalog_enabled=$($features.v4_catalog_enabled)"
  Assert-Check "v4_availability_enabled=false" ($features.v4_availability_enabled -eq $false) ""
} catch {
  Assert-Check "GET /platform/features" $false $_.Exception.Message
}

Write-Host "`n--- Summary ---" -ForegroundColor Cyan
Write-Host "Passed: $passed  Failed: $failed"
if ($failed -gt 0) {
  Write-Host "`nDeploy v4 API code and set V4_CATALOG_ENABLED=true before re-running." -ForegroundColor Yellow
  exit 1
}
Write-Host "`nRelease A API smoke OK. Run manual salon signup in portal/mobile next." -ForegroundColor Green
exit 0
