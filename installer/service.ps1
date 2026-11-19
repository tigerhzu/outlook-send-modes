param(
  [ValidateSet('Install','Start','Stop','Remove','Status')][string]$Action = 'Start',
  [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'SendModes'),
  [ValidateRange(1024,65535)][int]$Port = 3443,
  [string]$RunValueName = 'OutlookSendModes'
)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules"
Import-Module "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
$appDirectory = $PSScriptRoot
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$stateFile = Join-Path $DataDirectory 'state.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$state = $null
$mutex = New-Object Threading.Mutex($false, ('Local\SendModes-' + $RunValueName))
if (-not $mutex.WaitOne(30000)) { throw 'Another setup operation is running.' }

function Save-State {
  $json = $script:state | ConvertTo-Json
  [IO.File]::WriteAllText($stateFile + '.tmp', $json, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath ($stateFile + '.tmp') -Destination $stateFile -Force
}
function Get-OwnedProcess {
  if (-not $script:state -or -not $script:state.ProcessId) { return $null }
  $candidate = Get-Process -Id $script:state.ProcessId -ErrorAction SilentlyContinue
  if ($candidate -and $candidate.Path -eq (Join-Path $appDirectory 'node.exe') -and
      $candidate.StartTime.ToUniversalTime().Ticks.ToString() -eq $script:state.ProcessStarted) { return $candidate }
  return $null
}
function Stop-OwnedProcess {
  $owned = Get-OwnedProcess
  if ($owned) { Stop-Process -InputObject $owned -Force; $owned.WaitForExit(10000) | Out-Null }
  if ($script:state) { $script:state.ProcessId = 0; $script:state.ProcessStarted = ''; Save-State }
}
function Read-Health {
  try {
    # Never send loopback readiness traffic through a company proxy / VPN.
    $request = [Net.HttpWebRequest]::Create("https://localhost:$Port/health")
    $request.Proxy = $null
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    $response = $request.GetResponse()
    try {
      $reader = New-Object IO.StreamReader($response.GetResponseStream())
      try { $health = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    } finally { $response.Dispose() }
    return ($health.app -eq 'outlook-send-modes' -and $health.instance -eq $script:state.Instance)
  } catch { return $false }
}
function Remove-OwnedCertificate([string]$thumbprint) {
  if ($thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { return }
  foreach ($store in @('My','Root')) {
    $certPath = "Cert:\CurrentUser\$store\$thumbprint"
    $cert = Get-Item -LiteralPath $certPath -ErrorAction SilentlyContinue
    if ($cert -and $cert.FriendlyName -eq ('SendModes ' + $script:state.Instance)) {
      if ($store -eq 'My') { Remove-Item -LiteralPath $certPath -DeleteKey }
      else {
        & "$env:WINDIR\System32\certutil.exe" -user -delstore Root $thumbprint | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not remove the local HTTPS certificate.' }
      }
    }
  }
}
function Trust-Certificate([string]$thumbprint) {
  & "$env:WINDIR\System32\certutil.exe" -user -f -addstore Root (Join-Path $DataDirectory 'localhost.cer') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not trust the local HTTPS certificate. Check your company certificate policy.' }
  $trusted = Get-Item ("Cert:\CurrentUser\Root\" + $thumbprint)
  $trusted.FriendlyName = 'SendModes ' + $script:state.Instance
}
function Ensure-Certificate {
  $cert = $null
  if ($script:state.Thumbprint) { $cert = Get-Item ("Cert:\CurrentUser\My\" + $script:state.Thumbprint) -ErrorAction SilentlyContinue }
  $pfxPath = Join-Path $DataDirectory 'localhost.pfx'
  $passwordPath = Join-Path $DataDirectory 'password.dpapi'
  if ($cert -and $cert.NotAfter -gt (Get-Date).AddDays(30) -and
      (Test-Path $pfxPath) -and (Test-Path $passwordPath)) {
    if (-not (Test-Path ("Cert:\CurrentUser\Root\" + $cert.Thumbprint))) {
      if ($Action -ne 'Install') { throw 'Local certificate is not trusted. Run the installer again.' }
      Trust-Certificate $cert.Thumbprint
    }
    return
  }
  if ($Action -ne 'Install') { throw 'Local certificate is missing or expires soon. Run the installer again.' }
  $oldThumbprint = $script:state.Thumbprint
  $cert = New-SelfSignedCertificate -Subject 'CN=localhost' -FriendlyName ('SendModes ' + $script:state.Instance) `
    -CertStoreLocation Cert:\CurrentUser\My -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable -NotAfter (Get-Date).AddYears(2) `
    -TextExtension @('2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1&IPAddress=::1', '2.5.29.19={critical}{text}CA=false', '2.5.29.37={text}1.3.6.1.5.5.7.3.1')
  # Persist ownership before exporting/trusting so a failed setup remains removable.
  $script:state.PreviousThumbprint = $oldThumbprint
  $script:state.Thumbprint = $cert.Thumbprint
  Save-State
  $randomBytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($randomBytes); $rng.Dispose()
  $password = ConvertTo-SecureString ([Convert]::ToBase64String($randomBytes)) -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $password | Out-Null
  $password | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordPath -Encoding ASCII
  Export-Certificate -Cert $cert -FilePath (Join-Path $DataDirectory 'localhost.cer') | Out-Null
  Trust-Certificate $cert.Thumbprint
  Remove-OwnedCertificate $oldThumbprint
  $script:state.PreviousThumbprint = ''; Save-State
}
function Start-ServiceProcess {
  if ((Get-OwnedProcess) -and (Read-Health)) { return }
  Stop-OwnedProcess
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) { throw "Port $Port is occupied. Close the previous local add-in server and run the installer again. No other process was stopped." }
  Ensure-Certificate
  $protectedPassword = [IO.File]::ReadAllText((Join-Path $DataDirectory 'password.dpapi')).Trim()
  $secure = ConvertTo-SecureString $protectedPassword
  $credential = New-Object Management.Automation.PSCredential('local', $secure)
  $names = @('SENDMODES_PFX','SENDMODES_PFX_PASSWORD','SENDMODES_INSTANCE','SENDMODES_PORT')
  $oldEnv = @{}
  foreach ($name in $names) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
  try {
    $env:SENDMODES_PFX = Join-Path $DataDirectory 'localhost.pfx'
    $env:SENDMODES_PFX_PASSWORD = $credential.GetNetworkCredential().Password
    $env:SENDMODES_INSTANCE = $script:state.Instance
    $env:SENDMODES_PORT = $Port.ToString()
    $child = Start-Process -FilePath (Join-Path $appDirectory 'node.exe') -ArgumentList ('"' + (Join-Path $appDirectory 'server.mjs') + '"') `
      -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $DataDirectory 'server.log') -RedirectStandardError (Join-Path $DataDirectory 'server-error.log')
    $script:state.ProcessId = $child.Id
    $script:state.ProcessStarted = $child.StartTime.ToUniversalTime().Ticks.ToString()
    Save-State
  } finally { foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process') } }
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ($child.HasExited) { throw 'The local HTTPS service could not start. See server-error.log.' }
    if (Read-Health) { return }
  }
  Stop-OwnedProcess
  throw 'The HTTPS readiness check failed. Check certificate policy, then run the installer again.'
}
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.AppDirectory -ne $appDirectory) { throw 'This data directory belongs to another installation.' }
  }
  if ($Action -eq 'Status') {
    $expectedRun = '"' + (Join-Path $appDirectory 'SendModes.exe') + '" --background'
    $actualRun = (Get-ItemProperty -Path $runKey -Name $RunValueName -ErrorAction SilentlyContinue).$RunValueName
    if ($state -and (Get-OwnedProcess) -and (Read-Health) -and $actualRun -eq $expectedRun) { Write-Output 'READY'; exit 0 }
    Write-Output 'STOPPED'; exit 1
  }
  if ($Action -in @('Stop','Remove')) {
    Stop-OwnedProcess
    if ($Action -eq 'Remove' -and $state) {
      $expectedRun = '"' + (Join-Path $appDirectory 'SendModes.exe') + '" --background'
      $existingRun = (Get-ItemProperty -Path $runKey -Name $RunValueName -ErrorAction SilentlyContinue).$RunValueName
      if ($existingRun -eq $expectedRun) { Remove-ItemProperty -Path $runKey -Name $RunValueName }
      Remove-OwnedCertificate $state.Thumbprint
      Remove-OwnedCertificate $state.PreviousThumbprint
      foreach ($name in @('localhost.pfx','localhost.cer','password.dpapi','state.json','state.json.tmp','server.log','server-error.log','setup-error.txt')) {
        Remove-Item -LiteralPath (Join-Path $DataDirectory $name) -Force -ErrorAction SilentlyContinue
      }
      if ((Get-ChildItem -LiteralPath $DataDirectory -Force | Measure-Object).Count -eq 0) { Remove-Item -LiteralPath $DataDirectory }
    }
    exit 0
  }
  if (-not $state) {
    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    # Restrict TLS material to this user and SYSTEM; passwords are additionally protected by DPAPI.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18')) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $DataDirectory -AclObject $acl
    $state = [pscustomobject]@{ Instance = [guid]::NewGuid().ToString(); AppDirectory = $appDirectory; Thumbprint = ''; PreviousThumbprint = ''; ProcessId = 0; ProcessStarted = '' }
    Save-State
  }
  if ($Action -eq 'Install') {
    New-Item -Path $runKey -Force | Out-Null
    Set-ItemProperty -Path $runKey -Name $RunValueName -Value ('"' + (Join-Path $appDirectory 'SendModes.exe') + '" --background')
  }
  Start-ServiceProcess
  Remove-Item -LiteralPath (Join-Path $DataDirectory 'setup-error.txt') -Force -ErrorAction SilentlyContinue
  Write-Output 'READY'
} catch {
  if (Test-Path -LiteralPath $DataDirectory) { ($_.Exception.Message + "`r`n" + $_.ScriptStackTrace) | Set-Content -LiteralPath (Join-Path $DataDirectory 'setup-error.txt') -Encoding UTF8 }
  Write-Error $_ -ErrorAction Continue
  exit 1
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
