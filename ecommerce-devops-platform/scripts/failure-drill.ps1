#Requires -Version 7.0
<#
.SYNOPSIS  ACCEPTANCE TEST 5: break MongoDB, show detection, recover, verify.
.EXAMPLE   pwsh ./scripts/failure-drill.ps1
#>
param([int]$OutageSec = 45)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force
$base = Get-BaseUrl

function Show-State([string]$Label) {
    $alerts = try { (Invoke-RestMethod 'http://127.0.0.1:9090/api/v1/alerts' -TimeoutSec 5).data.alerts |
        ForEach-Object { "$($_.labels.alertname)=$($_.state)" } } catch { 'prometheus-unreachable' }
    if (-not $alerts) { $alerts = 'none' }
    $mongo = docker inspect --format '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}' ecommerce-mongo 2>$null
    Write-Host ("{0,-22} /health={1} /ready={2} products={3} mongo={4} alerts={5}" -f $Label,
        (Get-HttpStatus "$base/health"), (Get-HttpStatus "$base/ready"), (Get-HttpStatus "$base/api/v1/products"), $mongo, ($alerts -join ','))
}

Show-State 'BEFORE'
if ((Get-HttpStatus "$base/ready") -ne 200) { throw "Service must be ready before the drill" }

Write-Step "FAILURE: docker stop ecommerce-mongo"
Invoke-Native docker @('stop', 'ecommerce-mongo') | Out-Null
$start = Get-Date
if (-not (Wait-HttpStatus "$base/ready" 503 30)) { throw "/ready did not detect the outage" }
Write-Ok ("Detected by /ready after {0:N0}s" -f ((Get-Date) - $start).TotalSeconds)
Start-Sleep -Seconds $OutageSec   # long enough for the 30 s alert hold period
Show-State 'DURING OUTAGE'
Write-Host "     App log during outage:"
docker logs --since 2m ecommerce-app 2>&1 | Select-String 'db_disconnected|DATABASE_UNAVAILABLE' | Select-Object -First 3 | ForEach-Object { "       $_" }

Write-Step "RECOVERY: docker start ecommerce-mongo"
Invoke-Native docker @('start', 'ecommerce-mongo') | Out-Null
$start = Get-Date
if (-not (Wait-HttpStatus "$base/ready" 200 120)) { throw "Service did not recover" }
Write-Ok ("Recovered (/ready=200) {0:N0}s after MongoDB restart - app container was NOT restarted" -f ((Get-Date) - $start).TotalSeconds)
Start-Sleep -Seconds 20
Show-State 'AFTER RECOVERY'
Write-Ok "FAILURE DRILL PASSED"
