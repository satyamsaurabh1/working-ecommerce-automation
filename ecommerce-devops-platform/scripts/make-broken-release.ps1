#Requires -Version 7.0
<#
.SYNOPSIS  DEMO ONLY: creates a deliberately broken release that crashes on startup.
.DESCRIPTION
  Derives <image>:<Tag> from a good image but replaces its start command with one
  that exits immediately - like a release with a fatal startup bug. Use it to
  demonstrate deploy.ps1's automatic rollback.
.EXAMPLE   pwsh ./scripts/make-broken-release.ps1 -From 1.0.0 -Tag 1.1.0-broken
#>
param([Parameter(Mandatory)][string]$From, [string]$Tag = 'broken')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force
$image = Get-EnvValue 'APP_IMAGE' 'ecommerce-api'
$dockerfile = "FROM ${image}:$From`nCMD [""node"", ""-e"", ""console.error('simulated fatal startup bug'); process.exit(1)""]`n"
$dockerfile | docker build -t "${image}:$Tag" -
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Write-Ok "Created broken demo image ${image}:$Tag"
