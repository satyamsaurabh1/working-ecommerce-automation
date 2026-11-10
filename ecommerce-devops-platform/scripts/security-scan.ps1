#Requires -Version 7.0
<#
.SYNOPSIS  Scans the app image (and the repo's dependencies/config) with Trivy - same version as CI.
.EXAMPLE   pwsh ./scripts/security-scan.ps1 -Image ecommerce-api:1.0.0
#>
param([string]$Image = 'ecommerce-api:local', [string]$Severity = 'HIGH,CRITICAL')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force
$trivy = 'aquasec/trivy:0.76.0'   # pinned; keep in sync with .github/workflows/ci.yml

Write-Step "Image scan: $Image"
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache $trivy `
    image --severity $Severity --ignore-unfixed --exit-code 1 $Image
$imageResult = $LASTEXITCODE

Write-Step "Repository scan: dependencies, secrets, Dockerfile/Compose misconfiguration"
docker run --rm -v "$(Get-RepoRoot):/src:ro" -v trivy-cache:/root/.cache $trivy `
    fs --scanners vuln,secret,misconfig --severity $Severity --skip-dirs /src/node_modules --exit-code 1 /src
$fsResult = $LASTEXITCODE

if ($imageResult -eq 0 -and $fsResult -eq 0) { Write-Ok "No unfixed $Severity findings" } else { Write-Fail "Findings above need attention"; exit 1 }
