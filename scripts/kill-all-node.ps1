Get-Process node -ErrorAction SilentlyContinue |
  Select-Object Id, WorkingSet64 |
  Format-Table -AutoSize
Write-Host '--- killing all node processes ---'
Get-Process node -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "kill PID $($_.Id) ($([math]::Round($_.WorkingSet64/1MB, 0)) MB)"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2
Write-Host '--- after kill ---'
Get-Process node -ErrorAction SilentlyContinue |
  Format-Table -AutoSize
Write-Host 'DONE'