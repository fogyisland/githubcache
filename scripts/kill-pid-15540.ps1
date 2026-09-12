Stop-Process -Id 15540 -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Write-Host "--- after kill ---"
Get-Process -Id 15540 -ErrorAction SilentlyContinue | Format-Table Id, WorkingSet64
Write-Host "--- port 5002 ---"
Get-NetTCPConnection -LocalPort 5002 -ErrorAction SilentlyContinue |
  Where-Object { $_.OwningProcess -ne 0 } |
  Format-Table LocalPort, OwningProcess, State