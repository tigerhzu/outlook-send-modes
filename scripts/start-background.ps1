$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$vitePath = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'
$verifyPath = Join-Path $PSScriptRoot 'verify-local-https.mjs'

if (-not (Test-Path -LiteralPath $vitePath)) {
    throw 'Dependencies are missing. Run npm ci first.'
}

# Never terminate an unknown listener or silently switch the manifest port.
$listener = Get-NetTCPConnection -LocalPort 3443 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    & $nodePath $verifyPath
    if ($LASTEXITCODE -ne 0) { throw 'Port 3443 is occupied, but HTTPS verification failed.' }
    Write-Output 'The Outlook add-in HTTPS server is already running.'
    exit 0
}

$logDirectory = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$oldTestMode = $env:ADDIN_TEST_HTTP
try {
    # The Outlook manifest always requires HTTPS, even after local HTTP tests.
    $env:ADDIN_TEST_HTTP = $null
    $server = Start-Process -FilePath $nodePath `
        -ArgumentList @(('"' + $vitePath + '"'), '--host', 'localhost', '--port', '3443', '--strictPort') `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDirectory 'server.stdout.log') `
        -RedirectStandardError (Join-Path $logDirectory 'server.stderr.log')
} finally {
    $env:ADDIN_TEST_HTTP = $oldTestMode
}

$deadline = (Get-Date).AddSeconds(20)
do {
    $server.Refresh()
    if ($server.HasExited) { throw "The HTTPS server exited. See $logDirectory/server.stderr.log" }
    $listener = Get-NetTCPConnection -LocalPort 3443 -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -eq $server.Id }
    if ($listener) { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
if (-not $listener) { throw "The HTTPS server did not start within 20 seconds. See $logDirectory" }

& $nodePath $verifyPath
if ($LASTEXITCODE -ne 0) { throw 'The server started, but HTTPS verification failed.' }
Write-Output "The Outlook add-in HTTPS server is running in the background (PID $($server.Id))."
