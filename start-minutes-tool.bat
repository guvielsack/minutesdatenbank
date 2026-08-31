@echo off
setlocal EnableExtensions

cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
    echo Python wurde nicht gefunden. Bitte Python 3.11+ installieren.
    goto :error
)

if not exist ".venv\Scripts\python.exe" (
    echo Erstelle virtuelle Umgebung ^(.venv^) ...
    python -m venv .venv
    if errorlevel 1 goto :error
)

echo Installiere/aktualisiere Abhaengigkeiten ...
".venv\Scripts\python.exe" -m pip install --upgrade pip -q
".venv\Scripts\python.exe" -m pip install -r requirements.txt -q
if errorlevel 1 goto :error

echo Beende eventuell laufenden Server auf Port 8000 ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

set HOST=127.0.0.1
set PORT=8000
set URL=http://%HOST%:%PORT%/

echo.
echo Minutes-Tool startet unter: %URL%
echo Beenden mit Strg+C
echo.

start /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"
".venv\Scripts\uvicorn.exe" app.main:app --reload --host %HOST% --port %PORT%
goto :end

:error
echo.
echo Start fehlgeschlagen.
pause
exit /b 1

:end
endlocal
