param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$env:DSH_HOME = Join-Path $settings.stateRoot 'home'
$env:DSH_AGENTS_HOME = Join-Path $settings.stateRoot 'agents'
$env:HOME = Join-Path $settings.stateRoot 'profile'
$env:USERPROFILE = Join-Path $settings.stateRoot 'profile'
$env:TEMP = Join-Path $settings.stateRoot 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:DSH_TELEMETRY_DISABLED = '1'
$env:DSH_TOOLS_MODE = 'native'
Remove-Item Env:DSH_SNAPSHOT -ErrorAction SilentlyContinue
Remove-Item Env:DSH_EXAMPLE_MODE -ErrorAction SilentlyContinue
$driver = Join-Path $PSScriptRoot 'cost-run.mjs'
Push-Location -LiteralPath $settings.workspace
try { & node $driver $Manifest } finally { Pop-Location }
exit $LASTEXITCODE
