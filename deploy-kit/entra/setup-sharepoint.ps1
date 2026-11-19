<#
寄信模式 1.7：建立 SharePoint 範本庫的後端 App（第 3 個 App），並只授權它寫入一個指定網站。

先執行 setup-entra.ps1，再執行本腳本。必須由管理員本人登入：需要 Application Administrator
加上授與管理員同意的權限（Privileged Role Administrator 或 Global Administrator），
以及可授與網站權限的 SharePoint 管理員權限。

本腳本只接收「公開憑證」（不含私鑰）。私鑰留在主機上，不經過管理員電腦，也不貼到任何地方。

需求：
  Install-Module Microsoft.Graph.Applications, Microsoft.Graph.Sites -Scope CurrentUser

用法：
  ./setup-sharepoint.ps1 -SiteUrl https://contoso.sharepoint.com/sites/SendModes `
      -FilePath "/sites/SendModes/Shared Documents/catalog-state.json" `
      -PublicCertPath ./sharepoint-public.pem

-WhatIf 只顯示會做什麼，不寫入租戶。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$SiteUrl,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$PublicCertPath,
    [string]$TenantId,
    [string]$AppName = 'SendModes SharePoint Backend',
    [string]$OutputPath = (Join-Path (Get-Location) 'sharepoint-result.txt')
)
$ErrorActionPreference = 'Stop'
$sharePointAppId = '00000003-0000-0ff1-ce00-000000000000'

# --- 輸入檢查：與服務端 SharePointRepository 規則一致 ---
$site = [Uri]$SiteUrl.TrimEnd('/')
if ($site.Scheme -ne 'https' -or $site.Host -notmatch '^[a-z0-9-]+\.sharepoint\.com$' -or $site.Query -or $site.Fragment -or -not $site.IsDefaultPort) {
    throw 'SiteUrl 必須是 SharePoint Online 網站，例如 https://contoso.sharepoint.com/sites/SendModes'
}
$sitePath = $site.AbsolutePath.TrimEnd('/')
if ($sitePath -eq '' -or -not $FilePath.StartsWith("$sitePath/") -or $FilePath -match '[?#]|(^|/)\.\.?(/|$)') {
    throw "FilePath 必須是該網站內的 server-relative 路徑，以 $sitePath/ 開頭"
}

# --- 只接受公開憑證，避免私鑰被帶離主機 ---
$pem = Get-Content -LiteralPath $PublicCertPath -Raw
if ($pem -match 'PRIVATE KEY') { throw '這個檔案含有私鑰。請只提供公開憑證（sharepoint-public.pem），私鑰留在主機上。' }
$match = [regex]::Match($pem, '-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----')
if (-not $match.Success) { throw '找不到 PEM 格式的憑證（BEGIN CERTIFICATE）。' }
$certBytes = [Convert]::FromBase64String(($match.Groups[1].Value -replace '\s', ''))
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 (, $certBytes)
if ($cert.NotAfter -le (Get-Date).AddDays(30)) { throw "憑證將於 $($cert.NotAfter) 到期，請產生新的憑證。" }
Write-Host "憑證：$($cert.Subject)，到期 $($cert.NotAfter.ToString('yyyy-MM-dd'))，指紋 $($cert.Thumbprint)"

foreach ($module in 'Microsoft.Graph.Applications', 'Microsoft.Graph.Sites') {
    if (-not (Get-Module -ListAvailable -Name $module)) { throw "缺少 $module，請先 Install-Module $module -Scope CurrentUser" }
    Import-Module $module
}
$scopes = 'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'Sites.FullControl.All'
if ($TenantId) { Connect-MgGraph -TenantId $TenantId -Scopes $scopes -NoWelcome } else { Connect-MgGraph -Scopes $scopes -NoWelcome }
$tenant = (Get-MgContext).TenantId
Write-Host "已連線租戶：$tenant"

$escaped = $AppName.Replace("'", "''")
if (Get-MgApplication -Filter "displayName eq '$escaped'" -All) { throw "已存在名稱為「$AppName」的 App registration。請確認是否已建立過，不要重複執行。" }

$spoSp = Get-MgServicePrincipal -Filter "appId eq '$sharePointAppId'"
if (-not $spoSp) { throw '租戶中找不到 SharePoint Online 服務主體。' }
$sitesSelected = $spoSp.AppRoles | Where-Object { $_.Value -eq 'Sites.Selected' -and $_.AllowedMemberTypes -contains 'Application' }
if (-not $sitesSelected) { throw '找不到 SharePoint 的 Sites.Selected 應用程式權限。' }

$targetSite = Get-MgSite -SiteId "$($site.Host):$sitePath"
if (-not $targetSite) { throw "找不到網站：$SiteUrl" }
Write-Host "目標網站：$($targetSite.DisplayName)（$($targetSite.WebUrl)）"

if (-not $PSCmdlet.ShouldProcess($tenant, "建立「$AppName」，授與 SharePoint Sites.Selected，並只允許寫入 $SiteUrl")) { return }

# --- 1. 後端 App：只有 SharePoint Sites.Selected，用憑證驗證，無 client secret ---
$app = New-MgApplication -DisplayName $AppName -SignInAudience 'AzureADMyOrg' -RequiredResourceAccess @(
    @{ ResourceAppId = $sharePointAppId; ResourceAccess = @(@{ Id = $sitesSelected.Id; Type = 'Role' }) }
) -KeyCredentials @(
    @{ Type = 'AsymmetricX509Cert'; Usage = 'Verify'; Key = $certBytes; DisplayName = $cert.Subject }
)
$sp = New-MgServicePrincipal -AppId $app.AppId
Write-Host "已建立後端 App：$($app.AppId)"

# --- 2. 管理員同意 Sites.Selected（本身不含任何網站權限） ---
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -PrincipalId $sp.Id -ResourceId $spoSp.Id -AppRoleId $sitesSelected.Id | Out-Null
Write-Host '已完成 Sites.Selected 管理員同意。'

# --- 3. 只授權指定網站寫入 ---
New-MgSitePermission -SiteId $targetSite.Id -BodyParameter @{
    roles = @('write')
    grantedToIdentities = @(@{ application = @{ id = $app.AppId; displayName = $AppName } })
} | Out-Null
Write-Host "已授權寫入網站：$SiteUrl"

$result = @"
寄信模式 SharePoint 後端設定結果（$(Get-Date -Format 'yyyy-MM-dd HH:mm')）
這些都是公開識別碼，不含私鑰或密碼。

CATALOG_PROVIDER=sharepoint
SHAREPOINT_SITE_URL=$($site.GetLeftPart([UriPartial]::Authority))$sitePath
SHAREPOINT_FILE_PATH=$FilePath
SHAREPOINT_CLIENT_ID=$($app.AppId)
SHAREPOINT_CERT_PATH=（主機上 sharepoint.pem 的絕對路徑）

憑證：$($cert.Subject)
憑證指紋：$($cert.Thumbprint)
憑證到期：$($cert.NotAfter.ToString('yyyy-MM-dd'))（到期前要產生新憑證並登記到「$AppName」）
"@
$result | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host ''
Write-Host $result
Write-Host "已寫入 $OutputPath"
