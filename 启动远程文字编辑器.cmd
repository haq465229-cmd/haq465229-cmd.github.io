@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\start-remote-editor.ps1"
if errorlevel 1 (
  echo Unable to start the remote text editor. Please confirm Node.js is installed and port 4317 is available.
  pause
)
endlocal
