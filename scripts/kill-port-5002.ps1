Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -ne 0 } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue |
  Format-Table LocalPort, OwningProcess, State
