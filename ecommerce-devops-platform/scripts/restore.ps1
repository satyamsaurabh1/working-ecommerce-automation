#Requires -Version 7.0
<#
.SYNOPSIS  Restores a backup made by backup.ps1 and VERIFIES the result.
.DESCRIPTION
  Verifies the SHA-256 checksum, restores with --drop (collections are replaced
  by the backup's contents), then compares document counts with the manifest.
  DESTRUCTIVE: data written after the backup is lost. Asks for confirmation unless -Force.
.EXAMPLE   pwsh ./scripts/restore.ps1                  # latest backup
.EXAMPLE   pwsh ./scripts/restore.ps1 -BackupFile backups/ecommerce-20261109-020000.archive.gz -Force
#>
param([string]$BackupFile = '', [switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force

if (-not $BackupFile) {
    $latest = Get-ChildItem (Join-Path (Get-RepoRoot) 'backups') -Filter '*.archive.gz' | Sort-Object Name | Select-Object -Last 1
    if (-not $latest) { throw "No backups found in ./backups. Run backup.ps1 first." }
    $BackupFile = $latest.FullName
}
$BackupFile = (Resolve-Path $BackupFile).Path
$name = Split-Path $BackupFile -Leaf
Write-Step "Restoring $name"

$checksumFile = "$BackupFile.sha256"
if (-not (Test-Path $checksumFile)) { throw "Checksum file missing: $checksumFile" }
$expected = (Get-Content $checksumFile).Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 $BackupFile).Hash.ToLowerInvariant()
if ($expected -ne $actual) { throw "Checksum mismatch - backup is corrupt. Expected $expected, got $actual" }
Write-Ok "Checksum verified ($actual)"

if (-not $Force) {
    $answer = Read-Host "This REPLACES the current database with $name. Type 'restore' to continue"
    if ($answer -ne 'restore') { Write-Host "Cancelled."; return }
}

Invoke-Native docker @('cp', $BackupFile, 'ecommerce-mongo:/tmp/restore.archive.gz')
$restore = 'mongorestore --quiet -u $MONGO_BACKUP_USERNAME -p $MONGO_BACKUP_PASSWORD --authenticationDatabase admin ' +
           '--nsInclude "$MONGO_APP_DATABASE.*" --drop --gzip --archive=/tmp/restore.archive.gz'
Invoke-Native docker @('exec', 'ecommerce-mongo', 'sh', '-c', $restore)
Invoke-Native docker @('exec', 'ecommerce-mongo', 'rm', '-f', '/tmp/restore.archive.gz')
Write-Ok "mongorestore finished"

Write-Step "Verifying restored data against the manifest"
$manifestFile = $BackupFile -replace '\.archive\.gz$', '.manifest.json'
$expectedCounts = (Get-Content $manifestFile -Raw | ConvertFrom-Json).documentCount
$actualCounts = Invoke-MongoScript 'count-docs.js' | ConvertFrom-Json
$ok = $true
foreach ($p in $expectedCounts.PSObject.Properties) {
    $got = $actualCounts.($p.Name)
    if ($got -eq $p.Value) { Write-Ok ("{0,-14} expected {1,5}  restored {2,5}" -f $p.Name, $p.Value, $got) }
    else { Write-Fail ("{0,-14} expected {1,5}  restored {2,5}" -f $p.Name, $p.Value, $got); $ok = $false }
}
if (-not $ok) { throw "Restore verification FAILED" }

$ready = Get-HttpStatus "$(Get-BaseUrl)/ready"
if ($ready -eq 200) { Write-Ok "API /ready = 200 after restore" } else { Write-Fail "API /ready = $ready after restore" }
Write-Ok "RESTORE VERIFIED"
