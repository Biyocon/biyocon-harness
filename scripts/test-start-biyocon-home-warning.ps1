# Exercise the launcher entry with isolated OS calls; no real app or listener is touched.
$ErrorActionPreference = 'Stop'
$launcher = Join-Path (Split-Path $PSScriptRoot -Parent) 'start-biyocon.ps1'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('biyocon-launcher-' + [guid]::NewGuid())
[System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
$wrapper = Join-Path $testRoot 'run.ps1'
@'
param([string]$Launcher, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$env:DSH_HOME = 'inherited-home-must-be-replaced'
$script:started = $false
function Get-Process {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -ne 'DeepSeek Harness') { throw "Unexpected process query: $Name" }
    if ($Scenario -eq 'official-running') { [pscustomobject]@{ Id = 123; ProcessName = $Name } }
}
function Get-CimInstance {
    param([string]$ClassName, [string]$Filter)
    if ($ClassName -ne 'Win32_Process' -or $Filter -ne "Name = 'node.exe'") { throw 'Unexpected CIM query' }
}
function Get-NetTCPConnection {
    [CmdletBinding()]
    param([int]$LocalPort, [string]$State)
    if ($LocalPort -ne 10822 -or $State -ne 'Listen') { throw 'Unexpected listener query' }
    if ($script:started) { [pscustomobject]@{ OwningProcess = 456 } }
}
function Start-Process {
    param([string]$FilePath, [string]$WorkingDirectory, [string]$ArgumentList)
    if ($env:DSH_HOME -ne "$HOME\.dsh") { throw 'Launcher did not replace inherited DSH_HOME' }
    if ($FilePath -eq 'cmd.exe') {
        if ($ArgumentList -notmatch 'pnpm dsh web --port 10822') { throw 'Unexpected server command' }
        $script:started = $true
        Write-Output 'TEST server launch inherits explicit DSH_HOME'
    } elseif ($FilePath -eq 'http://127.0.0.1:10822') {
        Write-Output 'TEST browser opened'
    } else { throw "Unexpected process launch: $FilePath" }
}
function Stop-Process { throw 'Launcher must not stop any process' }
function Start-Sleep { throw 'Synthetic server should already listen' }
function Read-Host { '' }
$source = [System.IO.File]::ReadAllText($Launcher)
$mutexName = 'Local\BiyoconHarnessLauncher'
if (-not $source.Contains($mutexName)) { throw 'Launcher mutex name was not found' }
# Use a private lock so the smoke cannot contend with an owner launch.
$source = $source.Replace($mutexName, "$mutexName-test-$([guid]::NewGuid())")
& ([scriptblock]::Create($source))
'@ | Set-Content -LiteralPath $wrapper -Encoding UTF8

$engine = (Get-Process -Id $PID).Path
foreach ($scenario in @('official-running', 'official-absent')) {
    $lines = @(& $engine -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $wrapper -Launcher $launcher -Scenario $scenario 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "${scenario}: launcher failed: $($lines -join [Environment]::NewLine)" }
    $output = $lines -join "`n"
    if ($output -notmatch 'TEST server launch inherits explicit DSH_HOME') { throw "${scenario}: no server launch" }
    if ($output -notmatch 'TEST browser opened') { throw "${scenario}: no browser open" }
    $warned = $output -match 'Both apps may use the same .dsh folder'
    if ($warned -ne ($scenario -eq 'official-running')) { throw "${scenario}: incorrect warning: $output" }
    Write-Output "PASS $scenario / explicit home / server and browser launch"
}
