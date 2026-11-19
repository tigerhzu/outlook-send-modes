<#
寄信模式 1.7：建立 Entra「範本 API」與「登入 SPA」兩個 App registration。

必須由 Entra 管理員本人執行並登入（Application Administrator 或 Cloud Application
Administrator；授與管理員同意需 Privileged Role Administrator 或 Global Administrator）。
腳本不建立 client secret、不要求 Graph Mail.Read／Mail.Send，也不處理任何密碼。

需求：PowerShell 7+ 或 Windows PowerShell 5.1，以及 Microsoft Graph PowerShell SDK：
  Install-Module Microsoft.Graph.Applications, Microsoft.Graph.Identity.SignIns, Microsoft.Graph.Users, Microsoft.Graph.Groups -Scope CurrentUser

用法（-Origin 必填，其餘選填）：
  ./setup-entra.ps1 -Origin https://templates.company.example `
      -Publishers alice@company.example `
      -Editors bob@company.example `
      -PilotUsers alice@company.example,carol@company.example `
      -LogoPath ../logo/寄信模式-logo-215.png

-WhatIf 只顯示會做什麼，不寫入租戶。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [string]$TenantId,
    [string]$ApiName = 'SendModes Templates API',
    [string]$ClientName = 'SendModes Outlook Client',
    [string[]]$Publishers = @(),
    [string[]]$Editors = @(),
    [string[]]$PilotUsers = @(),
    [string[]]$PilotGroups = @(),
    [switch]$SkipAssignmentRequired,
    [string]$LogoPath,
    [string]$OutputPath = (Join-Path (Get-Location) 'entra-result.txt')
)
$ErrorActionPreference = 'Stop'

# --- 輸入檢查：與服務端 PUBLIC_ORIGIN 規則一致 ---
if ($Origin -notmatch '^https://[^/\\?#\s]+/?$') { throw 'Origin 必須是不含路徑的 HTTPS 網址，例如 https://templates.company.example' }
$Origin = ([Uri]$Origin).GetLeftPart([UriPartial]::Authority)
if (([Uri]$Origin).Host -match '(^|\.)localhost$' -or ([Uri]$Origin).HostNameType -ne 'Dns') { throw 'Origin 不可使用 localhost 或 IP。' }
$redirectUri = "$Origin/auth.html"
if ($LogoPath -and -not (Test-Path -LiteralPath $LogoPath)) { throw "找不到 Logo：$LogoPath" }

foreach ($module in 'Microsoft.Graph.Applications', 'Microsoft.Graph.Identity.SignIns', 'Microsoft.Graph.Users', 'Microsoft.Graph.Groups') {
    if (-not (Get-Module -ListAvailable -Name $module)) { throw "缺少 $module，請先 Install-Module $module -Scope CurrentUser" }
    Import-Module $module
}

$scopes = 'Application.ReadWrite.All', 'AppRoleAssignment.ReadWrite.All', 'DelegatedPermissionGrant.ReadWrite.All', 'User.Read.All', 'Group.Read.All'
if ($TenantId) { Connect-MgGraph -TenantId $TenantId -Scopes $scopes -NoWelcome } else { Connect-MgGraph -Scopes $scopes -NoWelcome }
$tenant = (Get-MgContext).TenantId
Write-Host "已連線租戶：$tenant"

# --- 避免重複建立：同名 App 已存在就停止，交由人工確認 ---
foreach ($name in $ApiName, $ClientName) {
    $escaped = $name.Replace("'", "''")
    if (Get-MgApplication -Filter "displayName eq '$escaped'" -All) { throw "已存在名稱為「$name」的 App registration。請確認是否已建立過；不要重複執行，或改用 -ApiName／-ClientName。" }
}

function Resolve-Principal([string]$value, [string]$kind) {
    if ($value -match '^[0-9a-fA-F-]{36}$') { return $value }
    if ($kind -eq 'user') {
        $u = Get-MgUser -UserId $value -ErrorAction SilentlyContinue
        if (-not $u) { throw "找不到使用者：$value" }
        return $u.Id
    }
    $escaped = $value.Replace("'", "''")
    $g = @(Get-MgGroup -Filter "displayName eq '$escaped'" -All)
    if ($g.Count -ne 1) { throw "群組「$value」找不到或名稱不唯一，請改用群組 Object ID。" }
    return $g[0].Id
}
# 先解析全部使用者／群組，避免建立到一半才失敗
$publisherIds = @($Publishers | Where-Object { $_ } | ForEach-Object { Resolve-Principal $_ 'user' })
$editorIds = @($Editors | Where-Object { $_ } | ForEach-Object { Resolve-Principal $_ 'user' })
$pilotUserIds = @($PilotUsers | Where-Object { $_ } | ForEach-Object { Resolve-Principal $_ 'user' })
$pilotGroupIds = @($PilotGroups | Where-Object { $_ } | ForEach-Object { Resolve-Principal $_ 'group' })

if (-not $PSCmdlet.ShouldProcess($tenant, "建立「$ApiName」與「$ClientName」，回呼網址 $redirectUri")) { return }

# --- 1. 範本 API ---
$scopeId = [guid]::NewGuid().ToString()
$editorRoleId = [guid]::NewGuid().ToString()
$publisherRoleId = [guid]::NewGuid().ToString()
$readerRoleId = [guid]::NewGuid().ToString()
$apiApp = New-MgApplication -DisplayName $ApiName -SignInAudience 'AzureADMyOrg' -Api @{
    RequestedAccessTokenVersion = 2
    Oauth2PermissionScopes = @(@{
        Id = $scopeId; Value = 'Templates.Read'; Type = 'Admin'; IsEnabled = $true
        AdminConsentDisplayName = 'Read company mail templates'
        AdminConsentDescription = 'Allows the Outlook add-in to read published company mail templates on behalf of the signed-in user.'
    })
} -AppRoles @(
    @{ Id = $readerRoleId; Value = 'Template.Reader'; DisplayName = 'Template Reader'; Description = 'Can use published company templates.'; AllowedMemberTypes = @('User'); IsEnabled = $true },
    @{ Id = $editorRoleId; Value = 'Template.Editor'; DisplayName = 'Template Editor'; Description = 'Can save company template drafts.'; AllowedMemberTypes = @('User'); IsEnabled = $true },
    @{ Id = $publisherRoleId; Value = 'Template.Publisher'; DisplayName = 'Template Publisher'; Description = 'Can save, publish, withdraw and roll back company templates.'; AllowedMemberTypes = @('User'); IsEnabled = $true }
)
Update-MgApplication -ApplicationId $apiApp.Id -IdentifierUris @("api://$($apiApp.AppId)")
$apiSp = New-MgServicePrincipal -AppId $apiApp.AppId
Write-Host "已建立範本 API：$($apiApp.AppId)"

# --- 2. 登入 SPA（PKCE，無 secret） ---
$clientApp = New-MgApplication -DisplayName $ClientName -SignInAudience 'AzureADMyOrg' -Spa @{ RedirectUris = @($redirectUri) } -RequiredResourceAccess @(
    @{ ResourceAppId = $apiApp.AppId; ResourceAccess = @(@{ Id = $scopeId; Type = 'Scope' }) }
)
$clientSp = New-MgServicePrincipal -AppId $clientApp.AppId
Write-Host "已建立登入 SPA：$($clientApp.AppId)"

# --- 3. 管理員同意 Templates.Read（只此一個委派權限） ---
New-MgOauth2PermissionGrant -ClientId $clientSp.Id -ConsentType 'AllPrincipals' -ResourceId $apiSp.Id -Scope 'Templates.Read' | Out-Null
Write-Host '已完成 Templates.Read 管理員同意。'

# --- 4. 限定試行對象（Assignment required）與角色指派 ---
$assignmentNote = '未設定 Assignment required（-SkipAssignmentRequired）；租戶內所有人都能登入，但只有 Publisher／Editor 能管理範本。'
if (-not $SkipAssignmentRequired) {
    Update-MgServicePrincipal -ServicePrincipalId $clientSp.Id -AppRoleAssignmentRequired:$true
    $assignmentNote = '登入 SPA 已啟用 Assignment required，只有下方指派的人能登入。'
}
function Add-Assignment($spId, $principalId, $roleId) {
    New-MgServicePrincipalAppRoleAssignedTo -ServicePrincipalId $spId -PrincipalId $principalId -ResourceId $spId -AppRoleId $roleId | Out-Null
}
$loginIds = @($pilotUserIds + $pilotGroupIds + $publisherIds + $editorIds | Select-Object -Unique)
foreach ($id in $loginIds) { Add-Assignment $clientSp.Id $id '00000000-0000-0000-0000-000000000000' }
foreach ($id in $publisherIds) { Add-Assignment $apiSp.Id $id $publisherRoleId }
foreach ($id in $editorIds) { if ($publisherIds -notcontains $id) { Add-Assignment $apiSp.Id $id $editorRoleId } }
Write-Host "已指派登入：$($loginIds.Count) 個對象；Publisher：$($publisherIds.Count)；Editor：$($editorIds.Count)。"

# --- 5. Logo（選用，失敗不影響功能） ---
if ($LogoPath) {
    foreach ($app in $apiApp, $clientApp) {
        try { Set-MgApplicationLogo -ApplicationId $app.Id -InFile $LogoPath -ContentType 'image/png' }
        catch { Write-Warning "Logo 上傳失敗（可在 Entra 介面 Branding 手動上傳）：$($_.Exception.Message)" }
    }
}

# --- 6. 輸出結果：只有識別碼，沒有任何密鑰 ---
$result = @"
寄信模式 Entra 設定結果（$(Get-Date -Format 'yyyy-MM-dd HH:mm')）
這些都是公開識別碼，不含密碼或密鑰。

PUBLIC_ORIGIN=$Origin
ENTRA_TENANT_ID=$tenant
ENTRA_CLIENT_ID=$($clientApp.AppId)
ENTRA_API_AUDIENCE=$($apiApp.AppId)

範本 API 名稱：$ApiName（scope：api://$($apiApp.AppId)/Templates.Read）
登入 SPA 名稱：$ClientName（Redirect URI：$redirectUri）
$assignmentNote
之後新增試行者：Entra → Enterprise applications → $ClientName → Users and groups。
之後新增管理者：Entra → Enterprise applications → $ApiName → Users and groups → 角色 Template.Editor／Template.Publisher。
"@
$result | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Host ''
Write-Host $result
Write-Host "已寫入 $OutputPath"
