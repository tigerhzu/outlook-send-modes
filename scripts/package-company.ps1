param([string]$ProductionOrigin = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'zip-directory.ps1')
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$marker = Get-Content -LiteralPath (Join-Path $projectRoot 'dist/company-build.json') -Raw | ConvertFrom-Json
if (-not $marker.company -or $marker.version -ne $package.version -or $marker.bundledRecipientMatches -ne 0) { throw '請先執行 npm run build:company。' }
$releasePath = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $releasePath -Force | Out-Null
$stagePath = Join-Path $releasePath ('.company-package-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $stagePath | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination (Join-Path $stagePath 'dist') -Recurse
    $serverTarget = New-Item -ItemType Directory -Path (Join-Path $stagePath 'server')
    foreach ($name in @('auth.mjs','catalog.mjs','index.mjs','repository.mjs','service.mjs','company.env.example','template.example.json')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot ('server/' + $name)) -Destination $serverTarget.FullName
    }
    $scriptsTarget = New-Item -ItemType Directory -Path (Join-Path $stagePath 'scripts')
    foreach ($name in @('company-init.mjs','production-manifest.mjs')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('scripts/' + $name)) -Destination $scriptsTarget.FullName }
    foreach ($name in @('package.json','package-lock.json','manifest.xml')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stagePath }
    $docsTarget = New-Item -ItemType Directory -Path (Join-Path $stagePath 'docs')
    foreach ($name in @('IT-DEPLOYMENT.md','COMPANY-SERVICE.md','OUTLOOK-ACCEPTANCE.md','REFERENCES.md','VERIFICATION.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot ('docs/' + $name)) -Destination $docsTarget.FullName }
    $actual = -not [string]::IsNullOrWhiteSpace($ProductionOrigin)
    $origin = if ($actual) { $ProductionOrigin } else { 'https://templates.example.com' }
    $manifestName = if ($actual) { 'manifest.production.xml' } else { 'manifest.company.example.xml' }
    & node (Join-Path $projectRoot 'scripts/production-manifest.mjs') $origin --output (Join-Path $stagePath $manifestName)
    if ($LASTEXITCODE -ne 0) { throw 'Manifest 產生失敗。' }
    @'
寄信模式 1.7 公司部署包

這是伺服器部署包，不是每位同仁的安裝程式。
請先閱讀 docs/IT-DEPLOYMENT.md，再依 docs/COMPANY-SERVICE.md 設定服務。

1. IT 準備公司 HTTPS 主機、Entra SPA 與自訂範本 API 應用程式。
2. 在主機執行 npm ci --omit=dev。
3. 複製 server/company.env.example 為 .env，填入真實公司設定。
4. 執行 npm run start:company，讓 HTTPS 反向代理轉送至本機 8080。
5. npm run manifest:production -- https://公司實際主機
6. 驗證新產生的 manifest.production.xml，由 M365 管理員部署給試行群組。

manifest.company.example.xml 只有示意網址，不能用來正式安裝。
manifest.xml 是產生正式 manifest 的來源，仍指向 localhost，也不能當公司正式版本。
本包沒有憑證、密鑰、租戶權限、公司內部範本或個人收件者。
四份舊範本可從原始碼專案執行 import:company，產生未發布的私人範本庫；請勿放入 dist。
公司範本可跨 Mac／Windows 共用；個人設定仍留在各裝置。
正式 Entra、SharePoint 與 Outlook 跨平台實機驗收尚待部署後執行。
'@ | Set-Content -LiteralPath (Join-Path $stagePath '部署說明.txt') -Encoding utf8
    $archivePath = Join-Path $releasePath ('SendModes-Company-' + $package.version + '.zip')
    New-PortableZip -SourceDirectory $stagePath -DestinationPath $archivePath
    (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash | Set-Content -LiteralPath ($archivePath + '.sha256') -Encoding ascii
    Write-Output $archivePath
} finally {
    $resolvedStage = (Resolve-Path -LiteralPath $stagePath).ProviderPath
    $resolvedRelease = (Resolve-Path -LiteralPath $releasePath).ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedStage.StartsWith($resolvedRelease, [StringComparison]::OrdinalIgnoreCase)) { throw '封裝暫存路徑不在 release 內，停止清理。' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
