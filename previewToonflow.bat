@echo off
setlocal
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
set "TOONFLOW_SERVER_PORT=3000"
set "TOONFLOW_DATA_DIR=%CD%\data"

echo Toonflow - built frontend preview
echo.
echo 1. Open the existing preview
echo 2. Rebuild the frontend from source and open
echo.
echo Frontend edits appear here after rebuilding, not automatically.
echo Node/tool changes still require: bun run dev:plugins
choice /c 12 /n /m "Choose [1/2]: "
if errorlevel 2 goto rebuild
goto open

:rebuild
call bun run --cwd apps/web build
if errorlevel 1 goto failed

:open
if not exist "build\web\index.html" (
  echo No frontend build found. Run this launcher again and choose 2.
  goto failed
)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -and $r.Content -match 'id=.app.' -and $r.Content.Contains('/assets/index-')) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 goto browser
powershell -NoProfile -Command "$port = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($port) { exit 1 }; exit 0"
if errorlevel 1 (
  echo Port 3000 is occupied but the Toonflow preview is not ready.
  echo Check the existing server window before trying again.
  goto failed
)
start "Toonflow Preview Backend" "%ComSpec%" /d /k "bun run dev:server"
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { $r = Invoke-WebRequest 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200 -and $r.Content -match 'id=.app.' -and $r.Content.Contains('/assets/index-')) { exit 0 } } catch {}; Start-Sleep -Seconds 1 }; exit 1"
if errorlevel 1 goto failed

:browser
start "" "http://localhost:3000"
exit /b 0

:failed
echo Preview could not be opened. See the message above.
pause
exit /b 1
