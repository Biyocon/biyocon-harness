# Biyocon Harness launcher: starts the Web UI on one port and opens it once the
# server listens. start-biyocon.bat runs this file for taskbar shortcuts.
$Port = 10822
$StartTimeoutSeconds = 120
$Checkout = 'C:\Users\Biyocon\biyocon-harness'
$Url = "http://127.0.0.1:$Port"
$Host.UI.RawUI.WindowTitle = 'Biyocon Harness Desktop'

# One launcher at a time. Windows releases the mutex when this process exits,
# including after a crash, so no stale lock can block a later launch.
$mutex = [System.Threading.Mutex]::new($false, 'Local\BiyoconHarnessLauncher')
try { $script:ownsMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $script:ownsMutex = $true }

function Exit-Launcher([string]$Message, [int]$Code) {
    if ($script:ownsMutex) { $mutex.ReleaseMutex() }
    Write-Host $Message
    Read-Host 'Press Enter to close this window' | Out-Null
    exit $Code
}

# A Biyocon Harness server is a node.exe process running the dsh CLI entry
# (apps/cli/src/bin.ts from source, lib/bin.js when built) with the web command.
function Get-HarnessServer {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match 'bin\.(ts|js)"?\s+(?:"web"|web)(\s|$)' }
}

function Get-ListenPort([int]$ProcessId) {
    @(Get-NetTCPConnection -OwningProcess $ProcessId -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty LocalPort -Unique)
}

if (-not $script:ownsMutex) {
    Exit-Launcher 'Another Biyocon Harness launcher is already starting the server.' 1
}

Write-Host 'Checking if Biyocon Harness is already running...'
$servers = @(Get-HarnessServer)
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

# Session persistence has no cross-process lock, so a second server sharing
# DSH_HOME could overwrite the running server's session data.
$otherServers = @($servers | Where-Object { -not $listener -or $_.ProcessId -ne $listener.OwningProcess })
if ($otherServers.Count -gt 0) {
    $running = foreach ($server in $otherServers) {
        $ports = Get-ListenPort $server.ProcessId
        $where = if ($ports.Count -gt 0) { "port $($ports -join ', ')" } else { 'no port yet' }
        "PID $($server.ProcessId) on $where"
    }
    Exit-Launcher "Another Biyocon Harness server is running: $($running -join '; '). Stop it before starting one on port $Port." 1
}

if ($listener) {
    if ($servers.ProcessId -contains $listener.OwningProcess) {
        $mutex.ReleaseMutex()
        Write-Host "Biyocon Harness is already running on port $Port, PID $($listener.OwningProcess)"
        Start-Process $Url
        exit 0
    }
    Exit-Launcher "Port $Port is used by another program, PID $($listener.OwningProcess). Change `$Port in start-biyocon.ps1." 1
}

Write-Host 'Starting Biyocon Harness Web UI...'
# /k keeps the server window open after a startup failure so its error stays readable.
Start-Process cmd.exe -WorkingDirectory $Checkout -ArgumentList "/k title Biyocon Server && pnpm dsh web --port $Port"

$deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
while (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
    if ((Get-Date) -ge $deadline) {
        Exit-Launcher "Biyocon Harness did not listen on port $Port within $StartTimeoutSeconds seconds. Check the Biyocon Server window." 1
    }
    Start-Sleep -Seconds 1
}

Start-Process $Url
Exit-Launcher "Biyocon Harness started at $Url" 0
