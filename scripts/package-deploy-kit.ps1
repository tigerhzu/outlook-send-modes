$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'zip-directory.ps1')
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$releasePath = Join-Path $projectRoot 'release'
$kit = Join-Path $projectRoot 'deploy-kit'
$runtimeName = "SendModes-Company-$version.zip"
$runtimeZip = Join-Path $releasePath $runtimeName
$expected = (Get-Content -LiteralPath "$runtimeZip.sha256" -Raw).Trim().Split(' ')[0].ToLowerInvariant()
if ((Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '執行包 SHA256 不符，請先重新產生公司部署包。' }

$stage = Join-Path $releasePath ('.deploy-kit-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $kit 'AI-TASK.md') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $kit '給Hank-先看這裡.txt') -Destination $stage
    foreach ($dir in 'config', 'tools') { Copy-Item -LiteralPath (Join-Path $kit $dir) -Destination (Join-Path $stage $dir) -Recurse }
    # Windows PowerShell 5.1 needs a BOM to read the Chinese text in the script.
    New-Item -ItemType Directory -Path (Join-Path $stage 'entra') | Out-Null
    foreach ($script in Get-ChildItem -LiteralPath (Join-Path $kit 'entra') -Filter '*.ps1') {
        $ps = [IO.File]::ReadAllText($script.FullName, [Text.Encoding]::UTF8)
        [IO.File]::WriteAllText((Join-Path $stage "entra/$($script.Name)"), $ps, (New-Object Text.UTF8Encoding $true))
    }

    $runtimeTarget = (New-Item -ItemType Directory -Path (Join-Path $stage 'runtime')).FullName
    Copy-Item -LiteralPath $runtimeZip, "$runtimeZip.sha256" -Destination $runtimeTarget

    $logoTarget = (New-Item -ItemType Directory -Path (Join-Path $stage 'logo')).FullName
    Copy-Item -Path (Join-Path $kit 'logo/*.png') -Destination $logoTarget

    $docsTarget = (New-Item -ItemType Directory -Path (Join-Path $stage 'docs')).FullName
    foreach ($name in 'IT-DEPLOYMENT.md', 'COMPANY-SERVICE.md', 'COMPANY-TEMPLATES.md', 'OUTLOOK-ACCEPTANCE.md', 'REFERENCES.md') {
        Copy-Item -LiteralPath (Join-Path $projectRoot "docs/$name") -Destination $docsTarget
    }

    # Fresh unpublished drafts from the four approved templates; To/CC/BCC are never imported.
    $catalog = Join-Path $stage 'catalog/catalog-state.json'
    & node (Join-Path $projectRoot 'scripts/company-import.mjs') $catalog --owner '範本管理者'
    if ($LASTEXITCODE -ne 0) { throw '範本匯入失敗。' }

    $prefix = [IO.Path]::GetFullPath($stage).TrimEnd('\') + '\'
    $sums = foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File -Force | Sort-Object FullName) {
        $relative = $file.FullName.Substring($prefix.Length).Replace('\', '/')
        if ($relative -match '(^|/)(node_modules|\.memory|\.runtime|\.git|source|src)(/|$)' -or $file.Name -match '^\.env($|\.)' -or $file.Extension -in @('.pem', '.pfx', '.p12', '.key', '.log')) { throw "不應封裝的檔案：$relative" }
        (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
    }
    $sums | Set-Content -LiteralPath (Join-Path $stage 'FILELIST.sha256') -Encoding utf8
    $archive = Join-Path $releasePath "SendModes-Deploy-$version.zip"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    New-PortableZip -SourceDirectory $stage -DestinationPath $archive
    (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
    Write-Output $archive
} finally {
    $resolved = (Resolve-Path -LiteralPath $stage).ProviderPath
    if (-not $resolved.StartsWith((Resolve-Path -LiteralPath $releasePath).ProviderPath, [StringComparison]::OrdinalIgnoreCase)) { throw '暫存路徑異常，停止清理。' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
