#Requires -Version 7.0
<#
.SYNOPSIS  Deploys an app image tag with health verification and AUTOMATIC rollback.
.DESCRIPTION
  1. (-Build) builds ecommerce-api:<Tag> from the current commit
  2. records APP_IMAGE_TAG=<Tag> in .env and recreates ONLY the app container
  3. waits for the Docker health check and /ready through Nginx
  4. on failure: restores the previous tag and redeploys it
  Successful deployments are appended to .deploy-history (used by rollback.ps1).
.EXAMPLE   pwsh ./scripts/deploy.ps1 -Tag 1.0.0 -Build
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$Tag,
    [switch]$Build,
    [int]$TimeoutSec = 90
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force
Set-Location (Get-RepoRoot)

$image = Get-EnvValue 'APP_IMAGE' 'ecommerce-api'
$previous = Get-EnvValue 'APP_IMAGE_TAG' 'local'
$history = Join-Path (Get-RepoRoot) '.deploy-history'

if ($Build) {
    $sha = (git rev-parse --short HEAD 2>$null) ?? 'unknown'
    Write-Step "Building ${image}:$Tag (commit $sha)"
    Invoke-Native docker @('build', '-t', "${image}:$Tag", '--build-arg', "APP_VERSION=$Tag", '--build-arg', "GIT_SHA=$sha", '.')
}
docker image inspect "${image}:$Tag" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Step "Image ${image}:$Tag not found locally - pulling"
    Invoke-Native docker @('pull', "${image}:$Tag")
}

function Switch-AppTo([string]$TargetTag) {
    Set-EnvValue 'APP_IMAGE_TAG' $TargetTag
    Invoke-Native docker @('compose', 'up', '-d', '--no-deps', '--no-build', 'app')
    $healthy = Wait-ContainerHealthy 'ecommerce-app' $TimeoutSec
    $ready = $healthy -and (Wait-HttpStatus "$(Get-BaseUrl)/ready" 200 30)
    return $ready
}

Write-Step "Deploying ${image}:$Tag (currently running: $previous)"
if (Switch-AppTo $Tag) {
    "$((Get-Date).ToUniversalTime().ToString('o'))`t$Tag" | Add-Content -Path $history
    $version = (Invoke-RestMethod -Uri "$(Get-BaseUrl)/health" -SkipCertificateCheck).version
    Write-Ok "Deployed $Tag - healthy, /ready=200, /health reports version '$version'"
    return
}

Write-Fail "$Tag did not become healthy within ${TimeoutSec}s. Last app logs:"
docker logs --tail 15 ecommerce-app 2>&1 | Write-Host
Write-Step "AUTOMATIC ROLLBACK to $previous"
if (Switch-AppTo $previous) {
    Write-Ok "Rolled back to $previous - service healthy again"
} else {
    Write-Fail "Rollback to $previous ALSO failed - follow docs/runbook.md"
}
exit 1
