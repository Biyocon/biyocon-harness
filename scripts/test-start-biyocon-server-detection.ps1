# Verify the actual matcher without loading the launcher or starting a server.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$matcher = @(Get-Content (Join-Path $repo 'start-biyocon.ps1') | Where-Object { $_.Contains('CommandLine -match') })
if ($matcher.Count -ne 1) { throw "Expected one server CommandLine matcher, found $($matcher.Count)" }
$pattern = $matcher[0].Split("'")[1]
$sourceCommand = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).scripts.dsh
$builtEntry = (Get-Content (Join-Path $repo 'apps/cli/package.json') -Raw | ConvertFrom-Json).bin.dsh
$builtPath = Join-Path (Join-Path $repo 'apps/cli') $builtEntry
$cases = @(
    @{ Name = 'legacy bin.ts (observed PID 48504)'; Command = 'node  --import tsx/esm apps/cli/src/bin.ts "web" "--port" "10822"'; Expected = $true },
    @{ Name = 'source-launch.ts (current package script)'; Command = "$sourceCommand web --port 3090"; Expected = $true },
    @{ Name = 'built lib/bin.js (current package bin)'; Command = "node `"$builtPath`" `"web`" --port 3090"; Expected = $true },
    @{ Name = 'source informational command'; Command = "$sourceCommand --version"; Expected = $false },
    @{ Name = 'unrelated node process'; Command = 'node other.js web --port 3090'; Expected = $false }
)
foreach ($case in $cases) {
    $matched = $case.Command -match $pattern
    if ($matched -ne $case.Expected) { throw "$($case.Name): expected $($case.Expected), got $matched; $($case.Command)" }
    Write-Output "PASS $($case.Name): $($case.Command)"
}
