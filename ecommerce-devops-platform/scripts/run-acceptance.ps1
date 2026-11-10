#Requires -Version 7.0
<#
.SYNOPSIS  Runs acceptance tests 1, 4, 5 and 6 against the running stack and writes an evidence report.
.DESCRIPTION
  Output: docs/evidence/acceptance-<timestamp>.md (full console transcript + summary).
  Test 2 = the stack came up from the documented commands; Test 3 = GitHub Actions run.
  Test 6 is DESTRUCTIVE to the local database (it deletes then restores data).
.EXAMPLE   pwsh ./scripts/run-acceptance.ps1
#>
param([switch]$SkipFailureDrill, [switch]$SkipRestore, [switch]$IncludeRollback)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force
Set-Location (Get-RepoRoot)

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$evidenceDir = Join-Path (Get-RepoRoot) 'docs/evidence'
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
$transcript = Join-Path $evidenceDir "acceptance-$stamp.log"
Start-Transcript -Path $transcript | Out-Null

$base = Get-BaseUrl
$results = [ordered]@{}
function Record([string]$Name, [scriptblock]$Body) {
    Write-Host "`n################ $Name ################" -ForegroundColor Yellow
    try { & $Body; $results[$Name] = 'PASS' } catch { Write-Fail $_; $results[$Name] = "FAIL: $_" }
}

Write-Host "Environment: $([System.Environment]::OSVersion.VersionString), PowerShell $($PSVersionTable.PSVersion)"
Write-Host "Docker: $(docker version --format '{{.Server.Version}}')   Compose: $(docker compose version --short)"
Write-Host "App image: $(Get-EnvValue 'APP_IMAGE'):$(Get-EnvValue 'APP_IMAGE_TAG')   git: $(git rev-parse --short HEAD 2>$null)"
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

Record 'TEST 1 - Idempotent checkout' {
    $env:BASE_URL = $base; $env:INSECURE_TLS = '1'
    node scripts/acceptance/idempotency-check.js
    if ($LASTEXITCODE -ne 0) { throw "idempotency check failed" }
}

Record 'TEST 4 - Health, readiness and logs' {
    $h = Invoke-RestMethod "$base/health" -SkipCertificateCheck
    $r = Invoke-RestMethod "$base/ready" -SkipCertificateCheck
    Write-Host "GET /health -> $($h | ConvertTo-Json -Compress)"
    Write-Host "GET /ready  -> $($r | ConvertTo-Json -Compress)"
    $redirect = Invoke-WebRequest "http://localhost:$(Get-EnvValue 'HTTP_PORT' '80')/health" -MaximumRedirection 0 -SkipHttpErrorCheck -ErrorAction SilentlyContinue
    Write-Host "HTTP -> HTTPS redirect: $($redirect.StatusCode) $($redirect.Headers.Location)"
    Write-Host "GET /metrics via Nginx (must be blocked): $(Get-HttpStatus "$base/metrics")"
    Write-Host "Prometheus target health: $((Invoke-RestMethod 'http://127.0.0.1:9090/api/v1/targets').data.activeTargets | ForEach-Object { "$($_.labels.job)=$($_.health)" })"
    Write-Host "`nLast 5 structured app log lines:"
    docker logs --tail 5 ecommerce-app 2>&1 | ForEach-Object { "  $_" }
    if ($h.status -ne 'ok' -or $r.status -ne 'ready') { throw "health/ready not OK" }
    if ((Get-HttpStatus "$base/metrics") -ne 404) { throw "/metrics is publicly reachable" }
}

if (-not $SkipFailureDrill) {
    Record 'TEST 5 - Failure detection and recovery' {
        & (Join-Path $PSScriptRoot 'failure-drill.ps1')
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "failure drill failed" }
    }
}

if (-not $SkipRestore) {
    Record 'TEST 6a - Backup, data loss, restore, verify' {
        & (Join-Path $PSScriptRoot 'backup.ps1')
        $before = Invoke-MongoScript 'count-docs.js'
        Write-Step "SIMULATED DATA LOSS: dropping products and orders"
        $drop = 'mongosh --quiet -u $MONGO_INITDB_ROOT_USERNAME -p $MONGO_INITDB_ROOT_PASSWORD --authenticationDatabase admin $MONGO_APP_DATABASE --eval "db.products.drop(); db.orders.drop()"'
        Invoke-Native docker @('exec', 'ecommerce-mongo', 'sh', '-c', $drop) | Out-Null
        Write-Host "Counts before loss: $before"
        Write-Host "Counts after loss:  $(Invoke-MongoScript 'count-docs.js')"
        Write-Host "Catalogue via API after loss: $((Invoke-RestMethod "$base/api/v1/products" -SkipCertificateCheck).pagination.total) products"
        & (Join-Path $PSScriptRoot 'restore.ps1') -Force
        $total = (Invoke-RestMethod "$base/api/v1/products" -SkipCertificateCheck).pagination.total
        Write-Host "Catalogue via API after restore: $total products"
        if ($total -lt 1) { throw "no products after restore" }
    }
}

if ($IncludeRollback) {
    Record 'TEST 6b - Application rollback' {
        $good = Get-EnvValue 'APP_IMAGE_TAG'
        & (Join-Path $PSScriptRoot 'make-broken-release.ps1') -From $good -Tag "$good-broken"
        Write-Step "Deploying the broken release (expect automatic rollback)"
        & (Join-Path $PSScriptRoot 'deploy.ps1') -Tag "$good-broken" -TimeoutSec 40
        if ((Get-EnvValue 'APP_IMAGE_TAG') -ne $good) { throw "did not roll back to $good" }
        if ((Get-HttpStatus "$base/ready") -ne 200) { throw "service not ready after rollback" }
        Write-Ok "Broken release rejected; still serving $good"
    }
}

Write-Host "`n================ SUMMARY ================"
$results.GetEnumerator() | ForEach-Object { Write-Host ("{0,-45} {1}" -f $_.Key, $_.Value) }
Stop-Transcript | Out-Null
Write-Host "Evidence written to $transcript"
if ($results.Values | Where-Object { $_ -ne 'PASS' }) { exit 1 }
