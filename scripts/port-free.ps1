Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -ne 0 } |
  Format-Table LocalPort, OwningProcess, State
$free = (Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 0 }).Count -eq 0
Write-Host "PORT_FREE=$free"