# 寄信模式：公司部署交接單

適用版本：1.7.0。核對日期：2026-11-16。

目標：公司維護一個 HTTPS 網站與中央範本庫，由 Microsoft 365 管理員將同一份 XML 增益集分配給 Mac／Windows 同事。使用者從 Outlook 撰寫郵件的「應用程式」開啟，不需個別安裝 EXE、Node 或開發憑證。公司登入仍可能顯示登入／MFA 視窗；本版不保證無提示 SSO。

程式與部署包已完成；公司主機、租戶授權及跨平台實機驗收尚未完成。現有程式固定使用 Microsoft 公有雲 Entra／SharePoint Online 端點；特殊或主權雲租戶須先調整程式。

**請 IT 回覆以下資料**

| 項目 | 請提供或確認 | 用途 |
| --- | --- | --- |
| 正式網址 | 一個固定 HTTPS origin，例如 `https://templates.company.example`；確認辦公室與遠端同事的連線方式 | `PUBLIC_ORIGIN`；網站、API、登入回呼及 XML 必須一致，不使用子路徑 |
| 常駐主機 | 主機／平台、部署窗口、維護人；可執行符合專案 `>=22.12` 要求的受支援 Node.js 版本 | 提供前端及 API；程序要有自動啟動、故障重啟與監測 |
| Microsoft 365 環境 | 試行者有有效 Exchange Online 信箱、可用授權、Windows／Mac Outlook 版本；租戶允許 Office 增益集 | 集中部署與實機測試 |
| 租戶 ID | Directory／Tenant ID（GUID） | `ENTRA_TENANT_ID` |
| 登入應用程式 ID | 下方 SPA 應用程式的 Application／Client ID（GUID） | `ENTRA_CLIENT_ID` |
| 範本 API 應用程式 ID | 下方 API 應用程式的 Application／Client ID（GUID） | `ENTRA_API_AUDIENCE`；填 GUID，不是 `api://...` |
| 使用者與管理者 | 試行使用者／群組、正式使用範圍、範本編輯者、發布者；是否區分部門、是否包含來賓 | Outlook 分發及 Entra 指派；這兩套指派都要設定 |
| 範本庫 | 正式採 SharePoint，或先用持久化檔案做試行；指定備份及還原負責人 | `CATALOG_PROVIDER=sharepoint` 或 `file` |
| SharePoint 資料（採用時） | 網站 URL、服務專用文件庫／檔案路徑、後端應用程式 ID、憑證掛載位置與到期日 | 見步驟 3；私鑰由 IT 放在伺服器祕密儲存，不貼進聊天或郵件 |
| 上線與維運窗口 | M365 部署管理員、Entra 管理員、主機／DNS／TLS 管理人、SharePoint 管理人、故障聯絡方式 | 可由同一位 IT 承擔；確認憑證續期、備份及回復程序 |

集中部署的 Microsoft 365 授權、Exchange Online 信箱與客戶端需求，請 IT 以公司實際方案核對。[Microsoft 集中部署條件](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/centralized-deployment-of-add-ins?view=o365-worldwide)

**1. 準備公司 HTTPS 主機**

採現有公司核准的 Node 主機／容器平台即可，SharePoint 僅負責範本儲存，不能代替本版的 Node API 主機。

- 公司 DNS 與有效 TLS 憑證指向正式網站；遠端若需 VPN，應納入同事操作說明及試行。
- Node 服務預設監聽 `127.0.0.1:8080`，前方 HTTPS 反向代理轉送至它。容器可由 IT 配合網路隔離設定 `HOST=0.0.0.0`。
- 前端、`/auth.html` 與 `/api/*` 維持同一 origin；不把工作窗格外殼整站導向 Entra 登入頁。外殼及 `/api/config` 可讀，真正範本與管理 API 必須驗證 bearer token。
- 代理保留 `Authorization`、`If-Match`、`ETag`；API 不快取。請勿記錄 Authorization 或請求本文。
- 嵌入政策須允許 Outlook 工作窗格；不要用 `X-Frame-Options: DENY/SAMEORIGIN` 阻擋本服務。公司 CSP 若限制來源，要允許本服務、Office.js 官方來源及實際 Microsoft 登入流程，並在兩平台驗證。
- 同事端須能連到正式 origin、Office.js CDN（`appsforoffice.microsoft.com`）及公司 Microsoft 登入所需端點；伺服器須能連到 `login.microsoftonline.com`，採 SharePoint 時另需指定租戶的 SharePoint origin。若公司使用身分聯盟，網路團隊也要涵蓋其登入端點。
- 設定常駐服務及重啟策略；關掉 IT 的終端機不能讓服務停止。專案不會自行建立 Windows Service、systemd 或雲端服務。

Office 登入採另外開啟的對話窗，第一個頁面及回傳頁面必須與工作窗格同 origin。[Microsoft Office Dialog 登入流程](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/auth-with-office-dialog-api)

將 `release/SendModes-Company-1.7.0.zip` 交給主機管理者，解壓至正式部署目錄。此包已有公司版 `dist/`，不需在員工電腦或正式主機重新建置前端。先在解壓根目錄安裝相依套件，後面的初始化工具也需要它們：

```text
npm ci --omit=dev
```

**2. 建立 Entra 登入與範本 API**

建立兩個單一租戶 App registration，以下名稱可自訂，ID 與 scope／role 值須符合程式設定：

| 設定 | 範本 API，例如 SendModes API | 登入 SPA，例如 SendModes Client |
| --- | --- | --- |
| 帳號類型 | 僅此公司租戶 | 僅此公司租戶 |
| 權杖／平台 | Manifest：`api.requestedAccessTokenVersion = 2` | Authentication → Add platform → **Single-page application** |
| URI | Expose an API：`api://<API 應用程式 GUID>` | Redirect URI：`https://<正式主機>/auth.html` |
| Scope | 新增並啟用 `Templates.Read`；可設為僅管理員同意 | API permissions → My APIs → 該 API → Delegated → `Templates.Read`，由管理員完成同意 |
| 角色 | App roles 的 allowed member types 選 Users/Groups；值為 `Template.Editor`、`Template.Publisher` | 不在 SPA 建立範本管理角色 |
| 密鑰 | 本 API 驗證使用者權杖，不需要 client secret | 公開 SPA 使用 PKCE，不建立或嵌入 client secret |
| 寫入環境設定 | Application／Client ID → `ENTRA_API_AUDIENCE` | Application／Client ID → `ENTRA_CLIENT_ID` |

`Template.Editor` 可儲存管理草稿；`Template.Publisher` 可儲存、發布、下架及回復。本版沒有強制雙人覆核。角色須指派在 **API 對應的 Enterprise application**，才能出現在供 API 驗證的權杖中。部門隔離可另建 `Department.IT` 等角色，對應範本 `audience`。[Microsoft API scope 設定](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis)、[App roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps)

如果只允許特定員工使用，IT 應對相關 Enterprise applications 啟用 **Assignment required** 並指派使用者／群組，完成管理員同意。API 可另建 `Template.Reader` 作一般使用者的指派角色；目前程式讀取仍驗證 `Templates.Read` 與範本 audience，Reader 不會取得管理權限。不要將一般同仁指派為 Publisher 來讓他們登入。使用者／群組指派方式須符合公司現有 Entra 授權。[Microsoft 指派限制](https://learn.microsoft.com/en-us/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users)

既有 MFA／Conditional Access 應保留並實測 Office 對話窗；不能把停用安全政策當成部署步驟。正式驗收用一般使用者、Editor、Publisher 三種帳號測試，不只用高權限管理帳號。

Office XML 內的固定增益集 ID 為 `11d02175-05e1-4798-9724-ea05d5e29566`，與上述兩個 Entra App ID 是不同東西。此版不要求 Graph `Mail.Read`／`Mail.Send`；Office.js 使用 `ReadWriteItem` 操作目前草稿。

**3. 準備中央範本庫**

若公司要沿用 Hank 建議的 SharePoint 管理來源，請 IT 準備：

- 一個限定管理／服務使用的 SharePoint Online 網站或文件庫，提供完整網站網址及 server-relative 檔案路徑。狀態檔同時含管理草稿與已發布版本，一般同仁不能直接存取它。
- 第三個後端 App registration，設定 **SharePoint** 的 `Sites.Selected` application permission，完成管理員同意，再授予這個應用程式指定範本網站的寫入權限。僅加 Sites.Selected 還不足以讀寫，必須另做指定網站授權；IT 可依公司核准的管理工具完成。不要把管理工具的高權限留給日常服務。[Microsoft SharePoint 特定網站授權](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins-modernize/understanding-rsc-for-msgraph-and-sharepoint-online)
- 在 Entra 登記後端憑證公鑰，私鑰 PEM 安全掛載至伺服器，提供路徑、到期日及續期負責人。這是 SharePoint REST app-only 驗證所用憑證，與網站 HTTPS 憑證不同。[Microsoft SharePoint app-only 憑證要求](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly-azuread)
- 先建立空白 `catalog-state.json` 並放入服務專用文件庫；本程式不會替 IT 建立網站或文件庫。檔案必須可讀取 ETag 並用精確 If-Match 更新；簽出／核准政策若阻擋更新，要先與治理規則協調後實測。

建立空白檔（在部署根目錄，路徑須位於非公開目錄）：

```text
npm run init:company -- .runtime/company/catalog-state.json
```

如果 SharePoint 授權尚未備妥，可先用 `CATALOG_PROVIDER=file` 在單一主機試行；範本檔必須在持久化、可備份的私有目錄。不可用容器暫存磁碟，也不可讓多台主機各存一份。後續移轉至 SharePoint 時先停寫、備份，再搬移完整狀態及確認版本；不需要重新安裝同事的增益集，只要正式 origin 維持不變。

要沿用原專案四份範本，應在**原始碼專案**用 `npm run import:company -- <新私有檔案路徑> --owner "IT"` 產生未發布草稿；它不包含 To／CC／BCC，也不自動發布。部署 ZIP 沒有原內部範本，不在網站公開目錄散發匯入檔。

空白初始化與四範本匯入擇一；兩者皆拒絕覆寫既有同名狀態檔。不要先建立空白檔，再對同一路徑執行匯入。

**4. 啟動公司服務**

在步驟 1 已解壓、安裝相依套件的目錄，複製 `server/company.env.example` 成根目錄 `.env`，填入下列值。所有 `待填` 都必須換成 IT 提供的實際內容；以下不是可直接啟動的設定：

```dotenv
PUBLIC_ORIGIN=https://templates.company.example
ENTRA_TENANT_ID=待填租戶GUID
ENTRA_CLIENT_ID=待填SPA應用程式GUID
ENTRA_API_AUDIENCE=待填API應用程式GUID
HOST=127.0.0.1
PORT=8080
DIST_DIR=dist
CATALOG_PROVIDER=sharepoint
SHAREPOINT_SITE_URL=https://待填租戶.sharepoint.com/sites/待填網站
SHAREPOINT_FILE_PATH=/sites/待填網站/待填文件庫/catalog-state.json
SHAREPOINT_CLIENT_ID=待填SharePoint後端應用程式GUID
SHAREPOINT_CERT_PATH=待填伺服器上的PEM絕對路徑
```

如果先用檔案庫，改成 `CATALOG_PROVIDER=file`，設定 `CATALOG_FILE` 為私有持久化狀態檔路徑，不需要 SharePoint 變數。憑證有密碼時，另以公司祕密管理方式提供 `SHAREPOINT_CERT_PASSWORD`。

```text
npm run start:company
```

IT 的常駐服務必須使用正確工作目錄；本指令會讀取根目錄 `.env`。`DIST_DIR`／`CATALOG_FILE` 可改成實際絕對路徑，避免重啟或新版程式目錄更換後找不到資料。設定、私鑰、範本庫及備份一律放在 `dist/` 以外。

確認正式 HTTPS 網址上：`/taskpane.html`、`/auth.html`、`/api/config` 可載入；未帶權杖的 `/api/catalog`、`/api/admin` 回傳 **401**。`/healthz` 只代表服務程序可回應，不能代替登入、中央庫或跨平台驗收。

**5. 產生正式 XML，再集中分配**

在部署根目錄執行（請替換真實 origin）：

```text
npm run manifest:production -- https://templates.company.example --output manifest.production.xml
```

交由開發／驗證工作站以專案相依套件執行 `npx office-addin-manifest validate manifest.production.xml`，並確認 XML 全部入口都指向正式 origin。正式主機安裝的是 `--omit=dev`，不必為驗證額外安裝開發工具。

ZIP 的 `manifest.company.example.xml` 是示意檔；原 `manifest.xml` 仍是 localhost 來源。**只部署新產生且驗證過的 `manifest.production.xml`**。只上傳 XML 不會部署網站或啟動服務。

Microsoft 365 管理員進入 **設定 → 整合式應用程式（Settings → Integrated apps）**，使用自訂 Office 增益集上傳流程；若使用頁面上的 Add-ins 子入口，依 **Deploy Add-in → Upload custom add-in** 選取正式 XML。先分配給含 Mac／Windows 同事的試行群組，再逐步擴大。分發不是即時；Microsoft 文件提醒功能區圖示可能需 24–72 小時及重新啟動 Office。[Microsoft 集中部署流程](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins?view=o365-worldwide)

分配增益集與 Entra 使用者／角色指派分開處理；「看得到按鈕」不表示「有範本權限」。一般同事不需要自己側載 XML。

**6. 試行通過後，才擴大公司部署**

建議至少一台 Windows 新版 Outlook、一台 Mac Outlook，另以網頁版協助排查。先發布一份無敏感資料的範本，分別驗證：

- 沒有本機 EXE／Node／localhost 服務仍能開啟；公司登入及既有 MFA 正常。
- 一般同事可讀取適用範本，不能讀管理草稿或發布；Editor 可存草稿不能發布；Publisher 可發布、下架及回復。部門範圍與未指派帳號要直接測 API 權限。
- 填欄位、HTML／純文字預覽及插入符合草稿格式；To／CC／BCC、原主旨、既有文字、簽名與回覆歷史保留。只在勾選時套用主旨。
- 更新／下架後重開面板取得最新發布狀態；預覽後版本變更會阻止插入；已插入的草稿不被背景更新。
- 切換草稿、重複點擊、網路中斷、取消登入、權杖過期與 SharePoint 衝突均有可理解的結果，不誤寫另一封信。
- 主機重啟能恢復服務；可從備份還原中央庫；監測與憑證續期已有負責人。

測試先用草稿完成，不需自動寄送任何郵件。若公司需要驗收實際收信排版，由試行同事依公司流程手動寄到指定測試信箱。完整記錄表見 [Outlook 實機驗收](OUTLOOK-ACCEPTANCE.md)。目前沒有宣稱這些真實租戶／Mac／Windows 驗收已完成。

撤銷 Entra 指派／角色後，已簽發權杖可能在到期前繼續有效；本版沒有每次請求向目錄查詢即時撤權。驗收要區分既有權杖與重新登入，緊急停用依 IT 的服務／租戶程序處理。

**已安裝舊 Windows 本機版的同事**

切換正式網址前先從舊版匯出個人設定，確認正式版載入正確 origin 後再匯入。個人模式、聯絡人與簽章仍是每個裝置的 localStorage，不會因集中部署而自動同步。公司範本則共用中央版本。

新舊版沿用相同增益集 ID；IT 須在試行帳號確認舊側載登記／快取的處理方式，不能只看「寄信模式」名稱就判定已切換。等正式版使用正常、資料已保留，再依公司流程移除舊登記或停止舊 EXE 的 localhost 服務。

**可直接給同事的使用說明**

> IT 已將「寄信模式」分配到你的公司 Outlook。更新／重新啟動 Outlook 後，在新郵件或回覆視窗開啟「應用程式／Apps → 寄信模式」。按「公司帳號登入」，選範本、填寫欄位、檢查預覽，再按「插入草稿」。確認郵件後自行按 Outlook「傳送」。不需安裝 EXE、Node 或本機憑證；使用時需能連到公司範本網站。找不到入口時請將 Outlook 版本及畫面提供給 IT。

本版公司範本支援文字與表格；圖片、一般附件、寄出前強制檢查及個人設定跨裝置同步不在 1.7 範圍。網站／API 運作與存取權杖、SharePoint 細節見 [公司服務技術說明](COMPANY-SERVICE.md)。

**IT 回覆格式**

```text
正式 HTTPS origin：
主機／平台與維護窗口：
Tenant ID：
SPA Application/Client ID：
API Application/Client ID：
試行使用者／群組（Mac、Windows）：
範本編輯者／發布者：
中央庫選擇（SharePoint／持久化檔案）：
SharePoint 網站 URL、server-relative 檔案路徑（如採用）：
SharePoint 後端 Application/Client ID（如採用）：
憑證已掛載及指定網站授權是否完成（只需狀態／到期日，不需私鑰）：
M365 集中部署窗口、預定試行日期：
備份、監測與故障聯絡窗口：
```
