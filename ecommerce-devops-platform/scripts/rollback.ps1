#Requires -Version 7.0
<#
.SYNOPSIS  Rolls the app back to the previously deployed image tag (or -Tag).
.DESCRIPTION
  Images are immutable and versioned, so rolling back = redeploying an older
  tag. The database is NOT changed; for data rollback use restore.ps1.
.EXAMPLE   pwsh ./scripts/rollback.ps1
.EXAMPLE   pwsh ./scripts/rollback.ps1 -Tag 1.0.0
#>
param([string]$Tag = '')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force

$current = Get-EnvValue 'APP_IMAGE_TAG' 'local'
if (-not $Tag) {
    $history = Join-Path (Get-RepoRoot) '.deploy-history'
    if (-not (Test-Path $history)) { throw "No .deploy-history yet - pass -Tag explicitly" }
    $tags = Get-Content $history | ForEach-Object { $_.Split("`t")[1] }
    $Tag = $tags | Where-Object { $_ -ne $current } | Select-Object -Last 1
    if (-not $Tag) { throw "No earlier tag than '$current' in .deploy-history" }
}
Write-Step "Rolling back: $current -> $Tag"
& (Join-Path $PSScriptRoot 'deploy.ps1') -Tag $Tag
exit $LASTEXITCODE
