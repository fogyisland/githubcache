$ErrorActionPreference = 'Stop'

# Kill any lingering tsx/node processes from previous dev:server
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {
  $_.CommandLine -like '*src/server.ts*' -or $_.CommandLine -like '*tsx*server*'
} | ForEach-Object {
  Write-Host "Killing pid=$($_.Id)"
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# Also kill anything bound to port 3000/5002
foreach ($port in @(3000, 5002)) {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conn) {
    Write-Host "Port $port occupied by pid=$($c.OwningProcess)"
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "done cleanup"