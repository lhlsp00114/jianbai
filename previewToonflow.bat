@echo off
setlocal

cd /d "%~dp0"
set "bunExe=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%bunExe%" set "bunExe=bun"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
set "TOONFLOW_SERVER_PORT=3000"
set "TOONFLOW_DATA_DIR=%CD%\data"

echo Toonflow - build and launch preview
echo.

if not exist "node_modules" (
  echo Installing dependencies...
  "%bunExe%" install --frozen-lockfile
  if errorlevel 1 goto failed
)

echo Building plugins and nodes...
"%bunExe%" run dev:plugins
if errorlevel 1 (
  if not exist "build\tools\pluginDeveloper.tool.js" goto failed
  echo Plugin rebuild failed. Using the existing plugin build.
)

echo Building Web frontend...
pushd apps\web
"%bunExe%" run build
set "buildResult=%errorlevel%"
popd
if not "%buildResult%"=="0" goto failed

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'id=.app.' -and $r.Content.Contains('/assets/index-')) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 goto browser

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($port) { exit 1 }; exit 0"
if errorlevel 1 (
  echo Port 3000 is occupied by another service. It was not stopped.
  goto failed
)

echo Starting Toonflow server...
start "Toonflow Preview Backend" "%ComSpec%" /d /k ""%bunExe%" run dev:server"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $r = Invoke-WebRequest 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match 'id=.app.' -and $r.Content.Contains('/assets/index-')) { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 goto failed

:browser
echo Opening Toonflow in your browser...
start "" "http://localhost:3000/?refresh=%RANDOM%"
exit /b 0

:failed
echo.
echo Toonflow could not be started. Review the error above.
pause
exit /b 1
