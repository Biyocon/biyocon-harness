@echo off
title Biyocon Harness Desktop
set DSH_PORT=10822
set DSH_START_TIMEOUT=120
set DSH_URL=http://127.0.0.1:%DSH_PORT%
cd /d "C:\Users\Biyocon\biyocon-harness"

REM A listener on the port counts as Biyocon Harness only when it is node.exe.
echo Checking if Biyocon Harness is already running...
set LISTEN_PID=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%DSH_PORT% " ^| findstr "LISTENING"') do set LISTEN_PID=%%p
if defined LISTEN_PID (
    tasklist /FI "PID eq %LISTEN_PID%" /NH | findstr /I "node.exe" >nul
    if errorlevel 1 (
        echo Port %DSH_PORT% is used by another program, PID %LISTEN_PID%. Change DSH_PORT in this file.
        pause
    ) else (
        echo Biyocon Harness is already running on port %DSH_PORT%, PID %LISTEN_PID%
        start %DSH_URL%
    )
    exit /b
)

echo Starting Biyocon Harness Web UI...
start "Biyocon Server" cmd /c "cd /d C:\Users\Biyocon\biyocon-harness && pnpm dsh web --port %DSH_PORT%"

REM Open the browser only after the server listens. ping sleeps one second
REM even when stdin is redirected, where timeout.exe exits immediately.
set READY=
for /l %%i in (1,1,%DSH_START_TIMEOUT%) do if not defined READY (
    ping -n 2 127.0.0.1 >nul
    netstat -ano | findstr /C:":%DSH_PORT% " | findstr "LISTENING" >nul && set READY=1
)

if defined READY (
    start %DSH_URL%
    echo Biyocon Harness started at %DSH_URL%
) else (
    echo Biyocon Harness did not listen on port %DSH_PORT% within %DSH_START_TIMEOUT% seconds. Check the Biyocon Server window.
)
echo Press any key to close this window...
pause
