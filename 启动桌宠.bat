@echo off
cd /d "%~dp0"
title DesktopPet

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Install LTS from https://nodejs.org/
  pause
  exit /b 1
)

echo [DesktopPet] Opening local app (no installer needed)...
echo [DesktopPet] First launch may build for a minute.
echo [DesktopPet] Keep this window open while the pet is running.
echo.

node "%~dp0scripts\open-local.cjs"
set EXITCODE=%ERRORLEVEL%

echo.
if not "%EXITCODE%"=="0" (
  echo [ERROR] Failed, exit code %EXITCODE%
)
pause
exit /b %EXITCODE%
