@echo off
setlocal

cd /d "%~dp0"

set "bunExe=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%bunExe%" set "bunExe=bun"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
if not defined TOONFLOW_SERVER_PORT set "TOONFLOW_SERVER_PORT=3000"

if /i "%~1"=="server" goto runServer

echo Toonflow development launcher
echo Repository: %CD%
echo.

if not exist "node_modules" (
  echo Dependencies are missing. Installing them first...
  "%bunExe%" install --frozen-lockfile
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

if not exist "data\workspaces\myProject" mkdir "data\workspaces\myProject"

echo Building bundled plugins...
"%bunExe%" run dev:plugins
if errorlevel 1 (
  if not exist "build\tools\pluginDeveloper.tool.js" goto pluginBuildFailed
  if not exist "data\tools\pluginDeveloper.tool.js" goto pluginBuildFailed
  echo Plugin build failed, using the existing plugin developer tool. The remaining plugin outputs will still be used.
)

echo Starting Node Watch (auto-rebuild on change)...
start "Toonflow Node Watch" "%ComSpec%" /k ""%bunExe%" run --filter './packages/nodes/*' dev"

call :portListening %TOONFLOW_SERVER_PORT%
if errorlevel 1 (
  echo Starting Toonflow Server...
  start "Toonflow Server" "%ComSpec%" /d /k call "%~f0" server
)

call :portListening 5173
if errorlevel 1 (
  echo Starting Toonflow Web...
  start "Toonflow Web" "%ComSpec%" /d /k ""%bunExe%" run --cwd apps/web dev --port 5173 --strictPort"
)

echo Waiting for the Web client and workspace API...
powershell -NoProfile -Command "$origin = 'http://localhost:5173'; $directory = [uri]::EscapeDataString((Get-Location).Path); $headers = @{ Referer = $origin + '/'; 'x-toonflow-workspace' = '1' }; $deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $client = Invoke-WebRequest -Uri ($origin + '/@vite/client') -UseBasicParsing -TimeoutSec 2; $workspace = Invoke-RestMethod -Uri ($origin + '/api/workspaces/check?directory=' + $directory) -Headers $headers -TimeoutSec 2; if ($client.Content.Contains('vite-hmr') -and $workspace.code -eq 200) { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"

if errorlevel 1 (
  echo.
  echo The Web client or workspace API did not become ready. Check the server windows and port usage.
  pause
  exit /b 1
)

start "" "http://localhost:5173/#/workspace"
exit /b 0

:portListening
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %~1 -State Listen -ErrorAction SilentlyContinue) { exit 0 }; exit 1"
exit /b %errorlevel%

:runServer
rem ACT: Stop retrying after three quick failures so persistent startup errors stay visible.
powershell -NoProfile -Command "$failures = 0; while ($failures -lt 3) { $uptime = [Diagnostics.Stopwatch]::StartNew(); & $env:bunExe run dev:server; $result = $LASTEXITCODE; if ($result -eq 0) { exit 0 }; if ($uptime.Elapsed.TotalSeconds -ge 30) { $failures = 0 } else { $failures++ }; Write-Host ('Server exited with code ' + $result); if ($failures -lt 3) { Write-Host 'Restarting server in 3 seconds...'; Start-Sleep -Seconds 3 } }; exit $result"
exit /b %errorlevel%

:pluginBuildFailed
echo.
echo Plugin build failed and the existing plugin developer tool is unavailable.
pause
exit /b 1
