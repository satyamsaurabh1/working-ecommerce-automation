#Requires -Version 7.0
<#
.SYNOPSIS  Creates the local TLS certificate for Nginx in nginx/certs/.
.DESCRIPTION
  Default: a self-signed certificate generated inside a throwaway Docker
  container (no OpenSSL needed on Windows). Browsers will warn; curl needs -k.
  -UseMkcert: a locally-trusted certificate via mkcert (no browser warning).
  mkcert -install adds a local CA to YOUR trust store, so it is opt-in.
#>
param([switch]$UseMkcert, [switch]$Force)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib/common.psm1') -Force

$certDir = Join-Path (Get-RepoRoot) 'nginx/certs'
$crt = Join-Path $certDir 'localhost.crt'
$key = Join-Path $certDir 'localhost.key'
if ((Test-Path $crt) -and (Test-Path $key) -and -not $Force) { Write-Ok "Certificate already exists in nginx/certs"; return }

if ($UseMkcert) {
    if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) { throw "mkcert not found. Install: winget install FiloSottile.mkcert" }
    Invoke-Native mkcert @('-install')
    Invoke-Native mkcert @('-cert-file', $crt, '-key-file', $key, 'localhost', '127.0.0.1', '::1')
} else {
    # The key is made world-readable so the unprivileged nginx user (uid 101) can read
    # it through the read-only bind mount. Acceptable for a LOCAL development cert only.
    $cmd = 'apk add -q --no-cache openssl && openssl req -x509 -newkey rsa:2048 -nodes -days 365 ' +
           '-subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 ' +
           '-keyout /certs/localhost.key -out /certs/localhost.crt && chmod 644 /certs/localhost.key'
    Invoke-Native docker @('run', '--rm', '-v', "${certDir}:/certs", 'alpine:3.22', 'sh', '-c', $cmd)
}
Write-Ok "Certificate written to nginx/certs (localhost.crt, localhost.key)"
