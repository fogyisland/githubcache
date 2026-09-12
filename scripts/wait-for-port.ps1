$port = 5002
for ($i = 0; $i -lt 30; $i++) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($conn) {
    Write-Host "READY on $port"
    exit 0
  }
  Start-Sleep -Seconds 2
}
Write-Host "TIMEOUT waiting for $port"
exit 1