# Starts every SchemaSync service as a detached process (survives the shell).
# Usage:  powershell -File infra\start-stack.ps1     (from the repo root or anywhere)
# Logs land in infra\logs\<service>.log. Skips anything already listening.

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Test-Port($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# NOTE: the parameter must not be named $args — that's a PowerShell automatic
# variable inside functions and silently shadows anything passed in.
function Start-Detached($name, $port, $file, $argList, $cwd) {
    if (Test-Port $port) {
        Write-Host "$name already listening on :$port - skipped"
        return
    }
    $log = Join-Path $logs "$name.log"
    Start-Process -WindowStyle Hidden -FilePath $file -ArgumentList $argList -WorkingDirectory $cwd `
        -RedirectStandardOutput $log -RedirectStandardError "$log.err"
    Write-Host "$name starting on :$port (log: $log)"
}

# Data stores first
Push-Location (Join-Path $root "infra")
docker compose up -d 2>$null | Out-Null
Pop-Location
Write-Host "docker: meta-db :5434, dryrun-db :5433, redis :6379, mongo :27017"

$py = Join-Path $root ".venv\Scripts\python.exe"
Start-Detached "vcs"      8000 $py "-m uvicorn vcs.main:app --port 8000 --log-level warning" $root
Start-Detached "agents"   8090 $py "-m uvicorn agents.main:app --port 8090 --log-level warning" $root
Start-Detached "migrator" 8081 "cmd" "/c go run ." (Join-Path $root "migrator")
Start-Detached "gateway"  3000 "cmd" "/c npm run dev" (Join-Path $root "gateway")
Start-Detached "web"      5173 "cmd" "/c npm run dev" (Join-Path $root "web")

Write-Host ""
Write-Host "Waiting for health..."
$services = @(
    @{ name = "vcs"; url = "http://127.0.0.1:8000/health" },
    @{ name = "agents"; url = "http://127.0.0.1:8090/health" },
    @{ name = "migrator"; url = "http://127.0.0.1:8081/health" },
    @{ name = "gateway"; url = "http://127.0.0.1:3000/health" },
    @{ name = "web"; url = "http://localhost:5173/" }
)
foreach ($svc in $services) {
    $ok = $false
    for ($i = 0; $i -lt 40; $i++) {
        try {
            Invoke-WebRequest -Uri $svc.url -UseBasicParsing -TimeoutSec 3 | Out-Null
            $ok = $true; break
        } catch { Start-Sleep -Seconds 2 }
    }
    Write-Host ("{0,-10} {1}" -f $svc.name, $(if ($ok) { "healthy" } else { "NOT RESPONDING - check infra\logs" }))
}
Write-Host ""
Write-Host "UI: http://localhost:5173  (keep the tab foregrounded during demos)"
