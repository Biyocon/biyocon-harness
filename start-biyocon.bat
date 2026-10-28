@echo off
title Biyocon Harness Desktop
set DSH_HOME=C:\Users\Biyocon\.dsh
set DSH_PORT=10822
cd /d "C:\Users\Biyocon\biyocon-harness"

REM Check if server is already listening on the port
echo Checking if Biyocon Harness is already running...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":%DSH_PORT% " ^| findstr "LISTENING"') do (
    echo Biyocon Harness is already running on port %DSH_PORT%, PID %%p
    start http://127.0.0.1:%DSH_PORT%
    exit /b
)

echo Starting Biyocon Harness Web UI...
start http://127.0.0.1:%DSH_PORT%

REM Launch the server in its own window
start "Biyocon Server" cmd /c "cd /d C:\Users\Biyocon\biyocon-harness && pnpm dsh web --port %DSH_PORT%"

echo Biyocon Harness started at http://127.0.0.1:%DSH_PORT%
echo Press any key to close this window...
pause
