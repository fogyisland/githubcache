$port = 5002
Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess |
  ForEach-Object {
    Write-Host "killing PID $_"
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
# also kill any lingering node processes that might be the dev server
Get-Process -Name node -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*next*' -or $_.CommandLine -like '*dev*' } |
  ForEach-Object {
    Write-Host "killing node PID $($_.Id) — $($_.CommandLine.Substring(0, [Math]::Min(80, $_.CommandLine.Length)))"
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
Write-Host "done"