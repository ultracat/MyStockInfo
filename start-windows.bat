@echo off
rem MyStock launcher for Windows - double-click this file.
rem Same steps as start.sh: check node/npm, npm install on first run, npm run dev.
rem Messages are in English on purpose: cmd.exe's default code page (cp949) garbles UTF-8 Korean.
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo [MyStock] node/npm not found. Install Node.js LTS from https://nodejs.org and try again.
  goto :fail
)

for /f "delims=" %%v in ('node -v') do echo [MyStock] node %%v

netstat -ano | findstr /r /c:":4317 .*LISTENING" /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo [MyStock] Port 4317 or 5173 is already in use - MyStock may already be running.
  goto :fail
)

if not exist node_modules (
  echo [MyStock] First run: installing dependencies ^(npm install^)...
  call npm install
  if errorlevel 1 goto :fail
)

echo [MyStock] Starting the app ^(npm run dev^). Close the app window or press Ctrl+C to stop.
call npm run dev
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
pause
exit /b 1
