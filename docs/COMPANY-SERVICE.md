# 公司範本服務

首次交接給 IT 時，先使用 [公司部署交接單](IT-DEPLOYMENT.md) 收集資料並依序設定；本文件提供服務、儲存與 API 細節。

公司版由同一個 HTTPS 網站提供 Windows／Mac Outlook 工作窗格與 API。範本發布在中央庫，程式與範本分開更新。API 只接收範本定義與版本操作；客戶欄位值、目前草稿、收件者及寄信內容不會傳到伺服器。

程式已提供可執行的服務、編輯／發布／下架／回復流程、檔案庫與 SharePoint REST 儲存介面。公司租戶、HTTPS 網址、Entra 應用程式及 SharePoint 授權仍需公司 IT 設定；尚未宣稱實際租戶或 Mac Outlook 驗收通過。

## Entra 設定

建立兩個同租戶應用程式：

1. **範本 API**：單一租戶，設定 `api.requestedAccessTokenVersion: 2`，Application ID URI 為 `api://<API 應用程式 GUID>`，公開委派 scope `Templates.Read`。此應用程式不需要任何 Microsoft Graph 或信箱權限。
2. **工作窗格登入用 SPA**：單一租戶，在 Single-page application redirect URI 加入 `https://<公司主機>/auth.html`，取得上述自訂 API 的 `Templates.Read` 委派權限。登入使用 MSAL PKCE 與 Office Dialog，不放 client secret，不使用停用的 Exchange identity／callback token。

在 **API 應用程式**建立 `Template.Editor`、`Template.Publisher` 使用者／群組 app roles，並透過 Enterprise applications 指派。Editor 可儲存草稿；Publisher 可儲存、發布、下架及回復。角色可分開指派，但本版本不強制「編輯者與發布者必須是不同人」的雙人覆核。

範本 `audience` 可填其他 API app role，例如 `Department.IT`。空陣列表示所有取得此 API scope 的同租戶使用者可讀；非空陣列至少須符合一個角色。部門角色也需在 API app roles 定義並指派。若公司只允許特定員工使用，IT 應在企業應用程式啟用適當的使用者指派與同意政策；不要將「同租戶」誤當成「只限員工」，租戶也可能包含來賓。

伺服器驗證 RS256 簽章、發行者、租戶、API audience、SPA client ID、有效期限、委派 scope 與使用者 ID。管理角色與部門範圍每次由 API 驗證。只有隱藏管理按鈕不算授權；直接呼叫 API 也會被拒絕。不得將此服務替換成信任任意 `X-User`／`X-Roles` 標頭的代理。

## 執行與部署

先依根目錄腳本建立公司版，再部署 `dist/`、`server/`、`package.json`、`package-lock.json`。在伺服器使用 Node.js 22.12+，安裝執行相依套件：

```text
npm ci --omit=dev
```

將 `server/company.env.example` 複製為伺服器上的 `.env`，填入真實的 `PUBLIC_ORIGIN`、`ENTRA_TENANT_ID`、`ENTRA_CLIENT_ID`、`ENTRA_API_AUDIENCE`。GUID 範例不是可用的公司設定。設定檔、私鑰、範本資料與備份必須位於公開 `dist/` 目錄以外，且不可加入版控。

```text
npm run start:company
```

預設只監聽 `127.0.0.1:8080`，由公司 HTTPS 反向代理轉送。`PUBLIC_ORIGIN` 是員工看到的完整 HTTPS origin，不含路徑；需有效受信任憑證。正式部署不需在每台 Mac／Windows 安裝 Node 或 EXE。若使用容器，可明確設定 `HOST=0.0.0.0`，並由平台限制網路入口與提供 TLS。

反向代理需保留 `Authorization`、`If-Match`、`ETag`，API 不得快取。不要追加 `X-Frame-Options: DENY/SAMEORIGIN`，這會阻止 Outlook 載入工作窗格；若公司另設 CSP `frame-ancestors`，需以實際 Windows、Mac 與網頁版宿主驗證。服務沒有設定跨來源 CORS，前端與 API 必須同 origin。`/api/config` 僅公開必要的租戶與應用程式識別碼；`/api/catalog` 和所有管理 API 需要存取權杖。

存取權杖在工作窗格記憶體中使用；登入對話窗於登入往返暫用 sessionStorage，完成後清除 MSAL 快取。重新開啟工作窗格需重新取得登入權杖。使用者可從公司帳號的既有登入狀態完成登入，但不保證每個宿主都能無提示登入。

## 中央庫：檔案

`CATALOG_PROVIDER=file` 使用 `CATALOG_FILE`，預設 `.runtime/company/catalog-state.json`。檔案不存在時為空白庫，首次管理者儲存才建立。亦可先建立空白檔：

```text
node scripts/company-init.mjs .runtime/company/catalog-state.json
```

腳本不覆寫既有檔案。這個提供者適合單一主機、持久化磁碟；多程序須共用同一支援排他建立及原子 rename 的本機檔案系統，**不可讓每台伺服器各存一份**。對外寫入採 `If-Match`，內部使用排他 lock、完整寫入暫存檔、fsync 與 rename，避免多人覆蓋或讀到半份範本。

若要沿用原專案四份範本，在原始碼專案執行以下命令，產生新的非公開狀態檔（請在首次啟動服務前決定使用空白庫或匯入庫）：

```text
npm run import:company -- .runtime/company/catalog-state.json --owner "IT"
```

此工具不覆寫任何既有檔案，也不自動發布。輸出只有四份管理草稿，移除 To／CC／BCC，保留原文字、表格及工作清單四列。舊格式的日期／空白欄位先保留為可選文字，管理者應檢查後改成需要的必填、日期等規則，再發布。匯入檔可能含公司內部範本文字，只能放入受保護範本庫，不能放在 `dist/` 或公開下載目錄。公司 ZIP 不附原始內部範本；匯入應在原專案內進行。

如程序中斷留下 `.lock`，服務會拒絕後續更新，不會自行假設鎖已過期。IT 確認沒有寫入程序後，再清理鎖並檢查中央檔案。備份及還原需停寫或使用平台快照；禁止直接用編輯器改正在服務的狀態檔。唯讀 API 不會在損壞時退回舊內建範本。

## 中央庫：SharePoint

可切換為 `CATALOG_PROVIDER=sharepoint`，將完整範本狀態放在 SharePoint Online 的服務專用文件庫。文件內含草稿、已發布資料與版本快照；**一般同仁不可直接讀取此檔案或文件庫**，只能經範本 API 讀取授權後的已發布內容。這是「服務管理文件庫」設計，並非讓同仁直接存取含草稿的 SharePoint 清單。

1. IT 建立服務專用文件庫、啟用所需備份／版本保存政策，並上傳由 `company-init.mjs` 產生的空白 `catalog-state.json`。服務不自行建立網站、文件庫或擴大權限。
2. 為後端另建單一租戶 Entra 應用程式，使用憑證取得 **SharePoint REST** app-only 權杖。憑證公鑰登記於 Entra；私鑰 PEM 放入伺服器受保護的祕密掛載，從 `SHAREPOINT_CERT_PATH` 讀取，選用 `SHAREPOINT_CERT_PASSWORD`。
3. 由 IT 依公司治理提供限定範本網站的 SharePoint 應用程式權限與網站授權，例如 SharePoint `Sites.Selected` 搭配指定網站寫入授權。不要為了這個專案授予整個信箱讀取或 `Mail.Send`。網站授權的管理設定由 IT 執行，程式不實作 Graph 登入，也不呼叫 Graph。
4. 設定 `SHAREPOINT_SITE_URL`、`SHAREPOINT_FILE_PATH`、`SHAREPOINT_CLIENT_ID`；檔案路徑是該網站內的 server-relative path，例如 `/sites/Templates/ServiceOnly/catalog-state.json`。

服務透過 `https://<tenant>.sharepoint.com/.default` 取得權杖，再呼叫 SharePoint REST `GetFileByServerRelativePath(...)/$value`。讀取取得 SharePoint ETag，寫入以精確 `If-Match` 條件更新整份狀態；不使用 `*`，不追蹤重新導向。SharePoint 未提供 ETag、認證失敗或寫入衝突時停止操作並回報，避免讀到一半的新版本。

SharePoint connector 已用替身 HTTP 回應驗證 ETag 與錯誤處理，尚未連至公司租戶。正式啟用前，IT 需實際驗證憑證授權、`$value` 回應 ETag、條件更新、公司文件庫簽出／核准政策及多管理者競爭。伺服器需能連出 Microsoft Entra 與指定 SharePoint origin。

## 範本及發布規則

`server/template.example.json` 是不含公司實際收件者或客戶資料的範例。公司範本只有主旨、HTML／純文字內文、欄位、分類、標籤、語言、維護人與適用角色；`to`、`cc`、`bcc` 會被伺服器拒絕。

變數格式為 `{{customer}}`；key 以英文字母開頭，只含英數及底線。欄位支援文字、日期、數字、選單，可標為必填。變數只可放在文字節點，不能放 HTML 屬性、註解或樣式。第一版發布格式支援安全文字與表格；不接受 script、事件、iframe、連結、圖片、CSS URL／函數或一般附件。圖片與附件留待受控資產流程及實際跨平台驗證後加入。原有個人簽章圖片功能另行保留。

伺服器限制每份內文 100 KB、最多 40 個欄位、選單最多 50 項、每個庫最多 200 個草稿／200 個已發布範本，已發布總量最多 4 MB。所有 HTML 由 parse5 解析並採元素、屬性和 CSS 白名單；不安全內容明確拒絕發布，使用端仍再次清理及安全轉義。

儲存草稿不改已發布版本。發布時給予新的不可重用版本，整份主旨／內文／欄位同時生效；下架後 API 不再回傳該範本。回復取出先前已發布快照，以**新版本**重新發布，不會改動使用者已插入的草稿，也不會捨棄尚存的管理草稿。

中央檔案保留最近 200 次管理操作與對應快照，可回復其內的發布版本；整份狀態上限 30 MB，達上限會停止新增，需由 IT 備份及規劃較大型資料庫遷移，不能任意丟棄紀錄。更長保存應由 SharePoint／主機備份政策負責。管理紀錄含範本 ID、操作、時間與管理者 Entra object ID，不記錄使用者填入的客戶變數、郵件內容或權杖。這不是不可竄改的合規稽核庫；正式治理若要求另送稽核系統，需由 IT 補上受控儲存與保留政策。

## API

| 方法與路徑 | 權限與用途 |
| --- | --- |
| `GET /api/config` | 公開 `{enabled, tenantId, clientId, scope}` |
| `GET /api/catalog` | `Templates.Read`；只回傳符合 audience 的已發布範本 |
| `GET /api/admin` | Editor／Publisher；取得 `{revision,drafts,published,history,roles}` 與 ETag |
| `PUT /api/admin/drafts/:id` | Editor／Publisher；body 為完整範本 |
| `POST /api/admin/publish/:id` | Publisher；body `{}` |
| `POST /api/admin/withdraw/:id` | Publisher；body `{}` |
| `POST /api/admin/rollback/:id` | Publisher；body `{ "version": "先前發布版本" }` |

管理寫入須帶 `Content-Type: application/json` 及先前取得的精確 `If-Match` ETag。成功回傳最新管理資料與 ETag；`401` 要求重登、`403` 無權限、`409/412` 需重新讀取再決定、`428` 表示未帶版本。不要遇到衝突後自動覆寫或盲目重試。

## 驗證

```text
node --test tests/server.test.mjs
```

測試涵蓋實際簽章 JWT 的簽章／issuer／audience／租戶／client／scope／到期與 app-only 拒絕、未授權管理、部門過濾、草稿隔離、發布與下架／回復、版本衝突、惡意 HTML/CSS、檔案鎖與 SharePoint ETag。測試用身份僅透過測試程序注入，正式啟動一律使用 Entra 驗證；沒有公開的測試登入捷徑。

這些是自動化服務與替身連線測試，不等於公司 Entra／SharePoint 或 Windows／Mac Outlook 的實機驗收。部署後依 `docs/OUTLOOK-ACCEPTANCE.md` 執行實際驗收並記錄宿主版本。

官方依據：Microsoft 的[存取權杖驗證](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation)、[SharePoint Entra app-only 憑證](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/security-apponly-azuread)、[SharePoint REST 檔案與條件更新](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest)。查閱日期：2026-11-16；SharePoint Add-in 產品退役不代表 SharePoint REST API 退役，本服務使用 Entra 與 REST，不使用 ACS。
