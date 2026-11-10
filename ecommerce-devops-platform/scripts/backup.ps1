#Requires -Version 7.0
<#
.SYNOPSIS  Online MongoDB backup with checksum and manifest.
.DESCRIPTION
  1. mongodump (gzip archive) inside the Mongo container as the least-privilege backup user
  2. docker cp the archive to ./backups/
  3. write <name>.sha256 and <name>.manifest.json (document counts per collection)
  4. delete backups older than -RetentionDays
.EXAMPLE   pwsh ./scripts/backup.ps1
#>
param([int]$RetentionDays = 7, [string]$BackupDir = '')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force

if (-not $BackupDir) { $BackupDir = Join-Path (Get-RepoRoot) 'backups' }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$name = "ecommerce-$stamp.archive.gz"
$dest = Join-Path $BackupDir $name

Write-Step "Dumping database inside ecommerce-mongo"
$dump = 'mongodump --quiet -u $MONGO_BACKUP_USERNAME -p $MONGO_BACKUP_PASSWORD --authenticationDatabase admin ' +
        '--db $MONGO_APP_DATABASE --gzip --archive=/tmp/backup.archive.gz'
Invoke-Native docker @('exec', 'ecommerce-mongo', 'sh', '-c', $dump)

Write-Step "Copying archive to $dest"
Invoke-Native docker @('cp', 'ecommerce-mongo:/tmp/backup.archive.gz', $dest)
Invoke-Native docker @('exec', 'ecommerce-mongo', 'rm', '-f', '/tmp/backup.archive.gz')

$hash = (Get-FileHash -Algorithm SHA256 $dest).Hash.ToLowerInvariant()
"$hash  $name" | Set-Content -Path "$dest.sha256" -Encoding utf8NoBOM
$counts = Invoke-MongoScript 'count-docs.js' | ConvertFrom-Json
[ordered]@{
    file          = $name
    createdUtc    = (Get-Date).ToUniversalTime().ToString('o')
    sha256        = $hash
    sizeBytes     = (Get-Item $dest).Length
    database      = Get-EnvValue 'MONGO_APP_DATABASE' 'ecommerce'
    documentCount = $counts
} | ConvertTo-Json -Depth 5 | Set-Content -Path ($dest -replace '\.archive\.gz$', '.manifest.json') -Encoding utf8NoBOM

Write-Ok "Backup complete: $name ($([math]::Round((Get-Item $dest).Length / 1KB, 1)) KB)"
Write-Host "     documents: $($counts | ConvertTo-Json -Compress)"

$cutoff = (Get-Date).AddDays(-$RetentionDays)
$old = Get-ChildItem $BackupDir -Filter 'ecommerce-*' | Where-Object { $_.LastWriteTime -lt $cutoff }
if ($old) { $old | Remove-Item -Force; Write-Ok "Retention: removed $($old.Count) file(s) older than $RetentionDays days" }
