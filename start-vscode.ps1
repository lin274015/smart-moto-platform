$ErrorActionPreference = "Stop"

$port = if ($env:PORT) { [int]$env:PORT } else { 4173 }
$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue

if ($existing) {
  Write-Host "MotoAI platform is already running on http://localhost:$port"
  Write-Host "Open the browser and continue using the existing server."
  exit 0
}

Write-Host "Starting MotoAI platform on http://localhost:4173"
node server.js
