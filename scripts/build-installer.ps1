param([string]$NsisDirectory = (Join-Path $PSScriptRoot '../.runtime/packaging-tools/nsis-3.11'))
$ErrorActionPreference = 'Stop'
$env:PSModulePath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules"
Import-Module "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1"
Import-Module "$env:WINDIR\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1"
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location $repo
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Application build failed' }
$stage = Join-Path $repo '.runtime/installer-stage'
if (Test-Path $stage) {
  if ([IO.Path]::GetFullPath($stage) -ne (Join-Path $repo '.runtime/installer-stage')) { throw 'Invalid staging path' }
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $repo 'release') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'dist') -Destination (Join-Path $stage 'web') -Recurse
Copy-Item installer/server.mjs,installer/service.ps1,manifest.xml -Destination $stage
# Windows PowerShell 5.1 must read scripts with a BOM when they contain Chinese.
$scriptPath = Join-Path $stage 'service.ps1'
[IO.File]::WriteAllText($scriptPath, [IO.File]::ReadAllText($scriptPath), (New-Object Text.UTF8Encoding($true)))
$node = (Get-Command node.exe).Source
$signature = Get-AuthenticodeSignature $node
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*OpenJS Foundation*') { throw 'Node runtime signature is invalid' }
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'node.exe')
$nodeLicense = Join-Path $repo '.runtime/packaging-tools/NODE-LICENSE.txt'
if (-not (Test-Path $nodeLicense)) { throw 'Download the matching Node LICENSE first; see installer/README.md' }
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $stage 'NODE-LICENSE.txt')
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ("/out:" + (Join-Path $stage 'SendModes.exe')) (Join-Path $repo 'installer\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
$support = @'
<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>寄信模式</title><style>body{font-family:system-ui;max-width:640px;margin:48px auto;padding:24px;line-height:1.8}</style><h1>寄信模式</h1><p>登入 Windows 後會自動啟動。若 Outlook 無法載入，請在開始功能表開啟「寄信模式」，按「診斷／測試本機」；未通過時請重新執行安裝程式。</p><p>首次加入 Outlook：請依安裝包內的「組員安裝說明.txt」操作。公司已集中部署時不需重複新增。</p><p>只修改目前草稿，不會寄出郵件。個人模板與簽章保存在 Outlook 的本機儲存空間。解除 Windows 安裝不會刪除這些設定；Outlook 的增益集項目可另行移除。</p></html>
'@
[IO.File]::WriteAllText((Join-Path $stage 'web/support.html'), $support, (New-Object Text.UTF8Encoding($false)))
$notices = "Third-party notices`r`n`r`nNode.js: see NODE-LICENSE.txt.`r`n`r`n"
foreach ($package in @('react','react-dom','scheduler','dompurify','parse5','entities')) {
  $packageRoot = Join-Path $repo ('node_modules/' + $package)
  $license = Get-ChildItem -LiteralPath $packageRoot -File | Where-Object { $_.Name -match '^licen[sc]e' } | Select-Object -First 1
  if (-not $license) { throw "Missing license: $package" }
  $notices += "==== $package ====`r`n" + [IO.File]::ReadAllText($license.FullName) + "`r`n`r`n"
}
[IO.File]::WriteAllText((Join-Path $stage 'THIRD-PARTY-NOTICES.txt'), $notices)
$deletes = @()
foreach ($file in Get-ChildItem -LiteralPath $stage -File -Recurse) {
  $relative = $file.FullName.Substring($stage.Length + 1)
  $deletes += 'Delete "$INSTDIR\' + $relative + '"'
}
foreach ($dir in Get-ChildItem -LiteralPath $stage -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending) {
  $deletes += 'RMDir "$INSTDIR\' + $dir.FullName.Substring($stage.Length + 1) + '"'
}
[IO.File]::WriteAllLines((Join-Path $repo '.runtime/installer-delete.nsh'), $deletes, (New-Object Text.UTF8Encoding($true)))
& (Join-Path $NsisDirectory 'makensis.exe') /V2 /INPUTCHARSET UTF8 (Join-Path $repo 'installer/setup.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed' }
$output = Join-Path $repo 'release/SendModes-Setup-1.6.2.exe'
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $repo 'release/SHA256SUMS.txt'), "$hash  SendModes-Setup-1.6.2.exe`r`n")
Copy-Item -LiteralPath (Join-Path $repo 'installer/組員安裝說明.txt') -Destination (Join-Path $repo 'release/組員安裝說明.txt') -Force
$bundle = Join-Path $repo 'release/SendModes-1.6.2.zip'
Compress-Archive -LiteralPath @($output, (Join-Path $repo 'release/SHA256SUMS.txt'), (Join-Path $repo 'release/組員安裝說明.txt')) -DestinationPath $bundle -Force
Get-Item -LiteralPath $output | Select-Object FullName, Length
