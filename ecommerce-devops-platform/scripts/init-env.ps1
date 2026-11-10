#Requires -Version 7.0
<#
.SYNOPSIS  Creates .env from .env.example, replacing every CHANGE_ME with a random secret.
.EXAMPLE   pwsh ./scripts/init-env.ps1
#>
param([switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force

$root = Get-RepoRoot
$target = Join-Path $root '.env'
if ((Test-Path $target) -and -not $Force) {
    Write-Ok ".env already exists - keeping it (use -Force to regenerate; this breaks access to an existing database volume)"
    return
}

# Hex secrets: cryptographically random and safe in URIs and shell commands.
function New-Secret([int]$Bytes = 24) {
    $buffer = [byte[]]::new($Bytes)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

$content = Get-Content (Join-Path $root '.env.example') | ForEach-Object {
    if ($_ -match '^(\w+)=CHANGE_ME$') {
        $bytes = if ($Matches[1] -eq 'JWT_SECRET') { 48 } else { 24 }
        "$($Matches[1])=$(New-Secret $bytes)"
    } else { $_ }
}
Set-Content -Path $target -Value $content -Encoding utf8NoBOM
Write-Ok "Created .env with freshly generated secrets (never commit this file)"
Write-Host "     Admin login:   username=$(Get-EnvValue 'ADMIN_USERNAME'), password is ADMIN_PASSWORD in .env"
Write-Host "     Grafana login: username=$(Get-EnvValue 'GRAFANA_ADMIN_USER'), password is GRAFANA_ADMIN_PASSWORD in .env"
