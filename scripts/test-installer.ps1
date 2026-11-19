param([switch]$KeepExtraction, [switch]$KeepOnFailure, [string]$ResumeDirectory)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $repo ('.runtime/installer-test-' + [guid]::NewGuid().ToString('N'))
if ($ResumeDirectory) {
  $testRoot = [IO.Path]::GetFullPath($ResumeDirectory)
  if ([IO.Path]::GetDirectoryName($testRoot) -ne [IO.Path]::GetFullPath((Join-Path $repo '.runtime')) -or (Split-Path $testRoot -Leaf) -notlike 'installer-test-*') { throw 'Invalid fixture path' }
}
$install = Join-Path $testRoot 'app'
$data = Join-Path $testRoot 'data'
$runName = 'SendModesTest-' + [guid]::NewGuid().ToString('N')
if ($ResumeDirectory) { $runName = (Get-Content (Join-Path $testRoot 'test-options.json') -Raw | ConvertFrom-Json).RunName }
$port = 3444
$psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$checks = 0
$completed = $false
function Assert([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
  $script:checks++
  Write-Output "PASS $message"
}
function Service([string]$action, [int]$expectedExit = 0) {
  & $psExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $install 'service.ps1') -Action $action -DataDirectory $data -Port $port -RunValueName $runName
  Assert ($LASTEXITCODE -eq $expectedExit) "$action exit code $expectedExit"
}
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
@{RunName=$runName} | ConvertTo-Json | Set-Content (Join-Path $testRoot 'test-options.json')
try {
  if (-not $ResumeDirectory) {
    Assert (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'isolated test port available'
    $installer = Start-Process -FilePath (Join-Path $repo 'release/SendModes-Setup-1.6.2.exe') -ArgumentList ('/S /EXTRACTONLY /D=' + $install) -WindowStyle Hidden -Wait -PassThru
    Assert ($installer.ExitCode -eq 0) 'installer extracts silently'
  }
  foreach ($name in @('SendModes.exe','node.exe','manifest.xml','service.ps1','server.mjs','web/taskpane.html','NODE-LICENSE.txt','THIRD-PARTY-NOTICES.txt')) {
    Assert (Test-Path (Join-Path $install $name)) "packaged $name"
  }
  Assert (@(Get-ChildItem -LiteralPath $install -Recurse -File | Where-Object { $_.Extension -in @('.pfx','.key','.pem') }).Count -eq 0) 'no private keys in package'
  Service Install
  $state = Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json
  $originalPid = $state.ProcessId
  $thumbprint = $state.Thumbprint
  Assert (Test-Path "Cert:/CurrentUser/Root/$thumbprint") 'unique certificate trusted for current user'
  Assert ((Get-Item "Cert:/CurrentUser/My/$thumbprint").FriendlyName -eq ('SendModes ' + $state.Instance)) 'certificate ownership tagged'
  $startup = Get-ItemPropertyValue 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' $runName
  Assert ($startup -eq ('"' + (Join-Path $install 'SendModes.exe') + '" --background')) 'hidden login startup registered'
  Service Start
  $repeat = Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json
  Assert ($repeat.ProcessId -eq $originalPid) 'repeated start reuses existing service'
  Service Status
  $env:SENDMODES_TEST_BASE = $install
  $env:SENDMODES_TEST_CERT = Join-Path $data 'localhost.cer'
  $env:SENDMODES_TEST_PORT = $port.ToString()
  & (Join-Path $install 'node.exe') (Join-Path $repo 'scripts/test-local-server.mjs')
  Assert ($LASTEXITCODE -eq 0) 'HTTPS and static server checks'
  Service Stop
  Assert (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) 'stop releases both loopback ports'
  Service Start
  $restarted = Get-Content (Join-Path $data 'state.json') -Raw | ConvertFrom-Json
  Assert ($restarted.ProcessId -ne $originalPid) 'login start action launches a new process'
  Assert ($restarted.Thumbprint -eq $thumbprint) 'restart retains certificate'
  Service Stop
  $blocker = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
  $blocker.Start()
  try {
    Service Start 1
    Assert ($blocker.Server.IsBound) 'port conflict does not stop unrelated service'
  } finally { $blocker.Stop() }
  Service Install
  Service Remove
  Assert (-not (Test-Path "Cert:/CurrentUser/Root/$thumbprint")) 'uninstall removes only its root certificate'
  Assert (-not (Test-Path "Cert:/CurrentUser/My/$thumbprint")) 'uninstall removes private certificate'
  Assert (-not (Test-Path $data)) 'uninstall removes generated service data'
  Assert (-not (Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' -Name $runName -ErrorAction SilentlyContinue).$runName) 'uninstall removes its startup entry'
  $uninstall = Start-Process -FilePath (Join-Path $install 'Uninstall.exe') -ArgumentList ('/S _?=' + $install) -WindowStyle Hidden -Wait -PassThru
  Assert ($uninstall.ExitCode -eq 0) 'installer uninstall exits successfully'
  Assert (-not (Test-Path (Join-Path $install 'node.exe'))) 'uninstall deletes packaged runtime'
  Write-Output "Installer checks passed: $checks"
  $completed = $true
} finally {
  if ($completed -or -not $KeepOnFailure) {
    if (Test-Path (Join-Path $data 'state.json')) { Service Remove }
  } else { Write-Output "Preserved diagnostic fixture: $testRoot ; startup entry: $runName" }
  if (($completed -or -not $KeepOnFailure) -and -not $KeepExtraction -and (Test-Path $testRoot)) {
    $expectedParent = [IO.Path]::GetFullPath((Join-Path $repo '.runtime'))
    if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($testRoot)) -ne $expectedParent) { throw 'Unexpected cleanup path' }
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
