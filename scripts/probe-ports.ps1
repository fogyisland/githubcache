$ErrorActionPreference = 'Stop'
foreach ($port in @(3000, 5002)) {
  try {
    $r = Invoke-WebRequest "http://localhost:$port/api/v1/status" -Headers @{'x-api-key'='ghc_live_ddd66d854f590db9633325996a3f2017'} -TimeoutSec 5 -UseBasicParsing
    Write-Host "PORT=$port STATUS=$($r.StatusCode) BODY=$($r.Content.Substring(0, [Math]::Min(300, $r.Content.Length)))"
  } catch {
    Write-Host "PORT=$port FAIL: $($_.Exception.Message)"
  }
}