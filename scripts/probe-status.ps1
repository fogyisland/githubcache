$ErrorActionPreference = 'Stop'
try {
  $r = Invoke-WebRequest 'http://localhost:5002/api/v1/status' -Headers @{'x-api-key'='ghc_live_ddd66d854f590db9633325996a3f2017'} -TimeoutSec 5 -UseBasicParsing
  Write-Host "STATUS=$($r.StatusCode)"
  Write-Host "BODY=$($r.Content.Substring(0, [Math]::Min(500, $r.Content.Length)))"
} catch {
  Write-Host "FAIL: $($_.Exception.Message)"
}