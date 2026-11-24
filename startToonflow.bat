@echo off
setlocal

cd /d "%~dp0"

set "bunExe=C:\Users\Administrator\.bun\bin\bun.exe"
if not exist "%bunExe%" set "bunExe=bun"
set "PATH=C:\Users\Administrator\.bun\bin;%PATH%"

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

echo Starting Toonflow Server...
start "Toonflow Server" "%ComSpec%" /k ""%bunExe%" run dev:server"

echo Starting Toonflow Web...
start "Toonflow Web" "%ComSpec%" /k ""%bunExe%" run dev:web"

echo Waiting for the Web development server...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $deadline) { try { Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:5173'; exit 0 } catch { Start-Sleep -Seconds 1 } }; Write-Host 'Web server did not become ready within 60 seconds.'; exit 1"

if errorlevel 1 (
  echo.
  echo The services may still be starting. Open http://localhost:5173 manually when the Web window reports that it is ready.
)

exit /b 0

:pluginBuildFailed
echo.
echo Plugin build failed and the existing plugin developer tool is unavailable.
pause
exit /b 1
