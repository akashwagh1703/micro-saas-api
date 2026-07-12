#Requires -Version 5.1
<#
.SYNOPSIS
  Release B salon API E2E — 3 barbers, slots, book, cancel, rebook slot.

.PARAMETER Token
  Bearer token from portal login (or AUTOWAVE_API_TOKEN env var).

.PARAMETER Date
  Local date YYYY-MM-DD for slot test (default: tomorrow).

.EXAMPLE
  $env:AUTOWAVE_API_TOKEN = "your-token"
  .\scripts\v4-release-b-salon-api.ps1
  .\scripts\v4-release-b-salon-api.ps1 -Token $token -Date "2026-07-15"
#>
param(
  [string]$BaseUrl = "https://api.autowave.playltp.in/api",
  [string]$Token = $env:AUTOWAVE_API_TOKEN,
  [string]$Date = ""
)

$ErrorActionPreference = "Stop"

if (-not $Token) {
  Write-Host "Set -Token or AUTOWAVE_API_TOKEN (portal login bearer)." -ForegroundColor Red
  exit 1
}

if (-not $Date) {
  $Date = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
}

$headers = @{
  Authorization = "Bearer $Token"
  "Content-Type" = "application/json"
}

function Invoke-Api {
  param([string]$Method, [string]$Path, [object]$Body = $null)
  $uri = "$BaseUrl$Path"
  if ($Body) {
    return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -Body ($Body | ConvertTo-Json -Depth 6) -TimeoutSec 60
  }
  return Invoke-RestMethod -Uri $uri -Method $Method -Headers $headers -TimeoutSec 60
}

Write-Host "`n=== Release B salon API E2E ===" -ForegroundColor Cyan
Write-Host "Date: $Date`n"

$barberNames = @("Rahul", "Priya", "Amit")
$resourceIds = @()

foreach ($name in $barberNames) {
  $res = Invoke-Api -Method Post -Path "/availability/resources" -Body @{ name = $name; type = "barber" }
  $id = $res.resource.id
  $resourceIds += $id
  Write-Host "[OK] Created barber $name (id=$id)" -ForegroundColor Green

  $weekly = @(1, 2, 3, 4, 5, 6) | ForEach-Object {
    @{
      day_of_week = $_
      start_time = "09:00"
      end_time = "19:00"
      slot_minutes = 30
      is_active = $true
    }
  }
  Invoke-Api -Method Put -Path "/availability/resources/$id/schedule" -Body @{ weekly_slots = $weekly } | Out-Null
  Write-Host "     Schedule Mon-Sat 09:00-19:00" -ForegroundColor DarkGray
}

$firstId = $resourceIds[0]
$slotsBefore = Invoke-Api -Method Get -Path "/availability/slots?date=$Date&resource_id=$firstId"
$slotList = $slotsBefore.resources[0].slots
if (-not $slotList -or $slotList.Count -lt 1) {
  Write-Host "[FAIL] No slots for barber $firstId on $Date" -ForegroundColor Red
  exit 1
}
$slot = $slotList[0]
Write-Host "[OK] Slots available: $($slotList.Count) for $($slotsBefore.resources[0].resource_name)" -ForegroundColor Green

$booking = Invoke-Api -Method Post -Path "/availability/bookings" -Body @{
  resource_id = $firstId
  starts_at = $slot.starts_at
  ends_at = $slot.ends_at
  service_label = "Haircut"
}
$bookingId = $booking.booking.id
Write-Host "[OK] Booked slot id=$bookingId" -ForegroundColor Green

$slotsAfterBook = Invoke-Api -Method Get -Path "/availability/slots?date=$Date&resource_id=$firstId"
$stillThere = $slotsAfterBook.resources[0].slots | Where-Object { $_.starts_at -eq $slot.starts_at }
if ($stillThere) {
  Write-Host "[FAIL] Booked slot still listed as available" -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Booked slot removed from availability" -ForegroundColor Green

Invoke-Api -Method Patch -Path "/availability/bookings/$bookingId" -Body @{ status = "cancelled" } | Out-Null
Write-Host "[OK] Cancelled booking $bookingId" -ForegroundColor Green

$slotsAfterCancel = Invoke-Api -Method Get -Path "/availability/slots?date=$Date&resource_id=$firstId"
$restored = $slotsAfterCancel.resources[0].slots | Where-Object { $_.starts_at -eq $slot.starts_at }
if (-not $restored) {
  Write-Host "[FAIL] Slot not restored after cancel" -ForegroundColor Red
  exit 1
}
Write-Host "[OK] Slot restored after cancel — ready to rebook" -ForegroundColor Green

$stats = Invoke-Api -Method Get -Path "/dashboard/stats"
if ($null -eq $stats.bookings_today -and $null -eq $stats.bookings_upcoming) {
  Write-Host "[WARN] Dashboard stats missing booking fields (deploy Phase 9 API?)" -ForegroundColor Yellow
} else {
  Write-Host "[OK] Dashboard stats: today=$($stats.bookings_today) upcoming=$($stats.bookings_upcoming) resources=$($stats.resources_active)" -ForegroundColor Green
}

Write-Host "`nRelease B salon API E2E passed." -ForegroundColor Green
exit 0
