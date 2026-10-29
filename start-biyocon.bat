@echo off
REM Taskbar and desktop shortcuts target this file; the launcher logic lives in
REM start-biyocon.ps1 next to it.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-biyocon.ps1"
