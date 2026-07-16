@echo off
setlocal enabledelayedexpansion

set "FOUND=0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo Stopping process on port 5000 (PID %%P)...
  taskkill /PID %%P /F >nul 2>&1
)

if "%FOUND%"=="0" (
  echo No process is listening on port 5000.
) else (
  echo Done.
)

endlocal
