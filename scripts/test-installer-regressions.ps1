# Non-interactive tests: never install a trusted certificate or touch the real installation.
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot = Join-Path $repo ('.runtime/installer-regression-' + [guid]::NewGuid().ToString('N'))
$install = Join-Path $testRoot 'app'
$data = Join-Path $testRoot 'data'
$runName = 'SendModesTest-' + [guid]::NewGuid().ToString('N')
$psExe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$checks = 0
function Assert([bool]$ok, [string]$message) {
  if (-not $ok) { throw $message }; $script:checks++; Write-Output "PASS $message"
}
function Service([string]$action, [int]$code = 0) {
  & $psExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $install 'service.ps1') -Action $action -DataDirectory $data -Port 3444 -RunValueName $runName
  Assert ($LASTEXITCODE -eq $code) "$action exit $code"
}
$child = $null; $blocker = $null; $launcher = $null
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
try {
  $extract = Start-Process -FilePath (Join-Path $repo 'release/SendModes-Setup-1.6.2.exe') -ArgumentList ('/S /EXTRACTONLY /D=' + $install) -WindowStyle Hidden -PassThru
  Assert ($extract.WaitForExit(60000)) 'installer extraction completes within 60 seconds'
  Assert ($extract.ExitCode -eq 0) 'installer extraction succeeds'
  Copy-Item (Join-Path $install 'service.ps1') (Join-Path $install 'service.original.ps1')
  # Reproduce the long-lived child scenario through the packaged C# launcher.
  $stub = @'
param([string]$Action)
$child = Start-Process -FilePath (Join-Path $PSScriptRoot 'node.exe') -ArgumentList '-e "setInterval(()=>{},1000)"' -WindowStyle Hidden -PassThru
$child.Id | Set-Content (Join-Path $PSScriptRoot 'child.pid')
Write-Output 'READY'
exit 0
'@
  [IO.File]::WriteAllText((Join-Path $install 'service.ps1'), $stub)
  $launcher = Start-Process -FilePath (Join-Path $install 'SendModes.exe') -ArgumentList '--install' -WindowStyle Hidden -PassThru
  Assert ($launcher.WaitForExit(15000)) 'packaged launcher exits while its background child remains alive'
  Assert ($launcher.ExitCode -eq 0) 'packaged launcher returns success'
  $child = Get-Process -Id ([int](Get-Content (Join-Path $install 'child.pid')))
  Assert (-not $child.HasExited) 'background child survives installer completion'
  $child.Kill(); $child.WaitForExit(); $child = $null
  [IO.File]::WriteAllText((Join-Path $install 'service.ps1'), 'exit 7')
  $launcher = Start-Process -FilePath (Join-Path $install 'SendModes.exe') -ArgumentList '--status' -WindowStyle Hidden -PassThru
  Assert ($launcher.WaitForExit(15000)) 'failed service invocation returns promptly'
  Assert ($launcher.ExitCode -eq 7) 'launcher propagates service failure'
  Copy-Item (Join-Path $install 'service.original.ps1') (Join-Path $install 'service.ps1') -Force
  $blocker = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,3444); $blocker.Start()
  Service Install 1
  $entry = Get-ItemPropertyValue 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' $runName
  Assert ($entry -eq ('"' + (Join-Path $install 'SendModes.exe') + '" --background')) 'failed first startup still registers login recovery'
  Assert ($blocker.Server.IsBound) 'port conflict preserves unrelated service'
  Assert (Test-Path (Join-Path $data 'setup-error.txt')) 'failure diagnostic is saved'
  $blocker.Stop(); $blocker = $null
  Service Start 1
  Assert (-not (Test-Path (Join-Path $data 'localhost.pfx'))) 'background login does not request new certificate trust'
  Service Remove
  Assert (-not (Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' -Name $runName -ErrorAction SilentlyContinue).$runName) 'cleanup removes only test login entry'
  $uninstall = Start-Process -FilePath (Join-Path $install 'Uninstall.exe') -ArgumentList ('/S _?=' + $install) -WindowStyle Hidden -PassThru
  Assert ($uninstall.WaitForExit(30000)) 'packaged uninstaller completes'
  Assert ($uninstall.ExitCode -eq 0) 'packaged uninstaller succeeds'
  Assert (-not (Test-Path (Join-Path $install 'node.exe'))) 'uninstaller removes packaged runtime'
  Write-Output "Installer regression checks passed: $checks"
} finally {
  if ($blocker) { $blocker.Stop() }
  if ($launcher -and -not $launcher.HasExited) { $launcher.Kill(); $launcher.WaitForExit() }
  if (Test-Path (Join-Path $install 'child.pid')) {
    $candidate = Get-Process -Id ([int](Get-Content (Join-Path $install 'child.pid'))) -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.Path -eq (Join-Path $install 'node.exe')) { $candidate.Kill(); $candidate.WaitForExit() }
  }
  if (Test-Path (Join-Path $data 'state.json')) {
    Copy-Item (Join-Path $install 'service.original.ps1') (Join-Path $install 'service.ps1') -Force
    Service Remove
  }
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($testRoot)) -ne (Join-Path $repo '.runtime')) { throw 'Unexpected cleanup path' }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
