# Shared helpers for the operations scripts. Requires PowerShell 7+.
Set-StrictMode -Version Latest

$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
$script:EnvFile = Join-Path $script:RepoRoot '.env'

function Get-RepoRoot { $script:RepoRoot }

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Get-EnvValue([string]$Name, [string]$Default = '') {
    if (-not (Test-Path $script:EnvFile)) { throw ".env not found. Run: pwsh ./scripts/init-env.ps1" }
    $line = Get-Content $script:EnvFile | Where-Object { $_ -match "^$Name=" } | Select-Object -Last 1
    if ($line) { return $line.Substring($Name.Length + 1) }
    return $Default
}

function Set-EnvValue([string]$Name, [string]$Value) {
    $lines = @(Get-Content $script:EnvFile)
    if ($lines -match "^$Name=") {
        $lines = $lines | ForEach-Object { if ($_ -match "^$Name=") { "$Name=$Value" } else { $_ } }
    } else {
        $lines += "$Name=$Value"
    }
    Set-Content -Path $script:EnvFile -Value $lines -Encoding utf8NoBOM
}

# Runs a native command and throws if it fails (PowerShell does not do this by default).
function Invoke-Native {
    param([Parameter(Mandatory)][string]$FilePath, [string[]]$ArgumentList = @())
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) { throw "'$FilePath $($ArgumentList -join ' ')' failed with exit code $LASTEXITCODE" }
}

# HTTP status code of a URL; 0 if unreachable. Accepts the local self-signed certificate.
function Get-HttpStatus([string]$Url) {
    try {
        $r = Invoke-WebRequest -Uri $Url -SkipCertificateCheck -SkipHttpErrorCheck -TimeoutSec 5
        return [int]$r.StatusCode
    } catch {
        return 0
    }
}

function Get-BaseUrl {
    $port = Get-EnvValue 'HTTPS_PORT' '443'
    if ($port -eq '443') { return 'https://localhost' }
    return "https://localhost:$port"
}

function Wait-HttpStatus([string]$Url, [int]$Expected, [int]$TimeoutSec = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Get-HttpStatus $Url) -eq $Expected) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Waits for Docker's HEALTHCHECK status of a container to become "healthy".
function Wait-ContainerHealthy([string]$Container, [int]$TimeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $status = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $Container 2>$null
        if ($status -eq 'healthy') { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Runs a mongosh script from /opt/scripts inside the Mongo container as the backup user.
# Credentials come from the container's own environment, never from this shell.
function Invoke-MongoScript([string]$ScriptName) {
    $cmd = 'mongosh --quiet -u $MONGO_BACKUP_USERNAME -p $MONGO_BACKUP_PASSWORD --authenticationDatabase admin /opt/scripts/' + $ScriptName
    $out = docker exec ecommerce-mongo sh -c $cmd
    if ($LASTEXITCODE -ne 0) { throw "mongosh script $ScriptName failed" }
    return ($out | Select-Object -Last 1)
}

Export-ModuleMember -Function *
