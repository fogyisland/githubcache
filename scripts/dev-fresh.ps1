# dev-fresh.ps1 — Windows counterpart of scripts/dev-fresh.sh.
#
# Use when `npm run dev` is wedged on Windows: cache pollution,
# port-in-use, MODULE_NOT_FOUND on .next\server\vendor-chunks.
#
#   pwsh scripts/dev-fresh.ps1
#
# After this, `npm run dev` boots clean in ~3s.

$ErrorActionPreference = 'Stop'

# 1. Find and kill anything on port 5002.
$conns = Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue
if ($conns) {
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  Write-Host "→ killing PIDs on :5002: $($pids -join ', ')"
  foreach ($pid in $pids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
}

# 2. Wipe .next cache.
if (Test-Path .next) {
  Write-Host '→ removing .next/'
  Remove-Item -Recurse -Force .next
}

# 3. Restart.
Write-Host '→ starting npm run dev'
npm run dev
