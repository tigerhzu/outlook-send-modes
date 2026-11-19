# 部署任務：寄信模式 1.7（給 IT 的 AI agent）

你要協助 IT 管理員（以下稱「管理員」）把 Outlook 增益集「寄信模式」部署到公司主機，先開放給試行同事使用。依序執行下方各階段。每階段結束時，向管理員回報結果再繼續下一階段。

## 這包已經決定好的事

- **範本庫放 SharePoint**（`CATALOG_PROVIDER=sharepoint`）。建議開一個專用、不公開的網站，例如 `/sites/SendModes`。只有主機透過後端 App 讀寫範本，同事不直接存取這個網站。
- **公司範本起始草稿已準備好**：`catalog/catalog-state.json` 有 4 份未發布的範本草稿（不含收件者），由需求者原本自用的範本轉換而來。直接上傳到 SharePoint 文件庫即可，不要另外執行 `init:company`。要發布哪些、怎麼修改，由管理員決定。「內部 IT 需求／權限申請」的主旨結尾寫死了一個人名，發布前要提醒管理員修改。
- **Entra 設定用腳本**：`entra/setup-entra.ps1` 建立範本 API、登入 SPA、`Templates.Read`、管理員同意、角色和試行指派。`entra/setup-sharepoint.ps1` 建立第 3 個 App（SharePoint 後端），授與 `Sites.Selected`，並只授權寫入指定網站。
- **SharePoint 授權若卡住**：可以先改用主機檔案（`CATALOG_PROVIDER=file`）讓試行開始，之後再搬到 SharePoint，同事不用重裝。這個切換要經管理員同意。
- **圖示已內建**：圖示放在網站的 `dist/icons/`，XML 會指到這些圖示。`logo/` 只用於 Entra App 的顯示 Logo。

## 資料包內容

| 路徑 | 內容 |
| --- | --- |
| `runtime/SendModes-Company-1.7.0.zip` | 正式主機執行包（已建置的 `dist/`、Node 服務、XML 產生器、技術文件 `docs/`） |
| `catalog/catalog-state.json` | 4 份公司範本草稿；含公司內部範本內容，視同內部資料 |
| `config/company.env.pilot` | `.env` 範本，填入「待填」的值 |
| `entra/setup-entra.ps1` | Entra 登入與範本 API 設定腳本，必須由管理員本人登入執行 |
| `entra/setup-sharepoint.ps1` | SharePoint 後端 App 與網站授權腳本，必須由管理員本人登入執行；只接收公開憑證 |
| `tools/check-deploy.mjs` | 正式網址的自動檢查 |
| `logo/` | Entra App Logo（215px，小於 100KB）與增益集圖示 |
| `docs/` | 詳細文件；本文件沒寫到的細節，以 `docs/IT-DEPLOYMENT.md`、`docs/COMPANY-SERVICE.md` 為準 |

## 絕對不要做

- 不要要求管理員把密碼、MFA 碼、權杖或私鑰貼給你，也不要寫進任何檔案或報告。需要登入時，請管理員本人在自己的視窗操作。
- 不要新增 client secret，不要加 Graph `Mail.Read`／`Mail.Send` 或任何信箱權限。SharePoint 後端只能有 `Sites.Selected`，不要改用 `Sites.ReadWrite.All`、`Sites.FullControl.All` 等全租戶權限。
- SharePoint 私鑰只存在主機上。不要複製到管理員電腦、聊天、郵件或 SharePoint。
- 不要寄信，不要替同事發布範本。發布由 Publisher 在增益集介面中自己操作。
- 不要把 `.env`、`catalog-state.json`、備份放在 `dist/` 或任何可從網站讀到的位置。
- 不要上傳 `manifest.xml`（指向 localhost）或 `manifest.company.example.xml`（示意檔）。只上傳正式產生的 `manifest.production.xml`。
- 不要為了能登入而停用 MFA／Conditional Access，不要把一般同事設成 Publisher，也不要分配給全公司。
- 不要修改程式碼。遇到文件與實際行為不一致時，記錄下來並回報管理員。

## 第 0 階段：向管理員確認 5 件事

1. **主機**：放在哪裡，例如公司 Windows Server（IIS 反向代理）、Linux（nginx + systemd）、容器，或 Azure App Service（Linux、Node 22）。需要 Node.js `>=22.12`，程序要能自動啟動、當掉自動重啟。
2. **正式網址**：固定的 HTTPS origin，不含路徑，例如 `https://mailtemplates.company.example`。需要 DNS 與受信任的 TLS 憑證。確認遠端同事是否需要 VPN。
3. **試行名單**：Windows、Mac Outlook 使用者各至少一位的 UPN（公司 email 帳號）。
4. **範本管理者**：Publisher（可發布）和 Editor（只能存草稿）的 UPN。
5. **SharePoint 網站**：要新開專用網站，還是用既有網站。建議新開一個不公開的網站，因為 `Sites.Selected` 是以「整個網站」為單位授權寫入。

缺的項目先標「待提供」，可以先做不依賴它的部分。

## 第 1 階段：架設網站與服務

1. 驗證並解壓執行包。將 `runtime/SendModes-Company-1.7.0.zip` 的 SHA256 與同目錄 `.sha256` 比對，然後解壓到私有部署目錄（以下稱「部署根目錄」）。
2. 在部署根目錄執行 `npm ci --omit=dev`。
3. 產生 SharePoint 憑證（在主機上）：在部署目錄以外的私有資料夾執行以下指令（Linux 內建 openssl；Windows 可用 Git for Windows 附的 openssl）：

   ```text
   openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 730 -subj "/CN=SendModes SharePoint Backend" -keyout sharepoint-key.pem -out sharepoint-public.pem
   ```

   再把私鑰和憑證合併成服務要用的檔案：Linux 用 `cat sharepoint-key.pem sharepoint-public.pem > sharepoint.pem`，Windows 用 `Get-Content sharepoint-key.pem, sharepoint-public.pem | Set-Content sharepoint.pem -Encoding ascii`。合併後刪除 `sharepoint-key.pem`。
   - `sharepoint.pem` 含私鑰：設定檔案權限只讓服務帳號可讀，納入公司祕密備份。
   - `sharepoint-public.pem` 只有公開憑證：交給管理員，在第 2 階段執行 `setup-sharepoint.ps1` 時使用。
   - 記下到期日（約 2 年），請管理員指定續期負責人。
4. 設定環境：把 `config/company.env.pilot` 複製為部署根目錄的 `.env`，先填 `PUBLIC_ORIGIN` 和 `SHAREPOINT_CERT_PATH`（用絕對路徑）。其他 ID 等第 2 階段完成後再填。
5. 設定 HTTPS 反向代理，把正式網址轉到 `127.0.0.1:8080`：
   - 保留 `Authorization`、`If-Match`、`ETag` 標頭；`/api/*` 不快取。
   - **不要**加 `X-Frame-Options`，也不要用 CSP `frame-ancestors 'none'/'self'`，否則 Outlook 無法嵌入工作窗格。
   - 不要把整個網站導向 Entra 登入頁；存取記錄不要記錄 `Authorization` 標頭或請求本文。
   - Azure App Service：在應用程式設定填入 `.env` 的值，設 `HOST=0.0.0.0`，`PORT` 交給平台，啟動命令用 `node server/index.mjs`。憑證檔放在 `/home/` 底下的私有目錄，或改用公司 Key Vault 掛載。
   - 主機要能連到 `login.microsoftonline.com` 和公司的 `<tenant>.sharepoint.com`。
6. 用公司標準方式建立常駐服務：Windows Service（如 NSSM、WinSW）、systemd、容器重啟策略或平台託管。工作目錄要設為部署根目錄。本地測試用 `npm run start:company`，它會讀取 `.env`。
   - Entra 與 SharePoint 尚未設定前服務無法啟動，這是正常的：服務啟動時會先讀取 SharePoint 範本庫，讀不到就停止。可以先把反向代理與服務定義準備好。

## 第 2 階段：Entra（管理員本人登入）

請管理員在自己的 PowerShell 執行以下指令。第一次使用時，先執行第一行安裝模組：

```powershell
Install-Module Microsoft.Graph.Applications, Microsoft.Graph.Identity.SignIns, Microsoft.Graph.Users, Microsoft.Graph.Groups -Scope CurrentUser
./entra/setup-entra.ps1 -Origin https://<正式網址> -Publishers <UPN> -Editors <UPN> -PilotUsers <UPN1>,<UPN2> -LogoPath ./logo/寄信模式-logo-215.png -WhatIf
```

- 先用 `-WhatIf` 確認輸入，再拿掉 `-WhatIf` 正式執行。
- 執行帳號需要 Application Administrator（或 Cloud Application Administrator）。授與管理員同意還需要 Privileged Role Administrator 或 Global Administrator。
- `-PilotGroups` 可改用群組指派，但需要 Entra ID P1 以上；沒有的話用 `-PilotUsers`。
- 腳本遇到同名 App 會停止，不會重複建立。若之前已手動建立，改依 `docs/IT-DEPLOYMENT.md` 第 2 步逐項核對設定。
- 執行結果寫在 `entra-result.txt`，內容只有公開識別碼。把其中 4 行填入 `.env`：`PUBLIC_ORIGIN`、`ENTRA_TENANT_ID`、`ENTRA_CLIENT_ID`、`ENTRA_API_AUDIENCE`。

本腳本尚未在真實租戶執行過。執行完成後，請管理員在 Entra 介面核對以下設定：

- 範本 API：Expose an API 有 `api://<API ID>/Templates.Read`；Manifest 的 `api.requestedAccessTokenVersion` 為 `2`；App roles 有 `Template.Editor`、`Template.Publisher`。
- 登入 SPA：Authentication 的 Single-page application Redirect URI 為 `https://<正式網址>/auth.html`；API permissions 只有 `Templates.Read`，且已顯示管理員同意。
- 範本 API 對應的 Enterprise application → Users and groups：Publisher／Editor 的角色已指派。

如果腳本中途失敗，把錯誤訊息回報管理員，由管理員到 Entra 刪除不完整的 App 後再重跑。不要自行改用其他權限繞過。

## 第 2.5 階段：SharePoint 範本庫（管理員本人操作）

1. 建立網站：在 SharePoint 管理中心建立專用網站（例如 `SendModes`，團隊網站或通訊網站皆可）。成員只放 IT 管理者，**不要**加入一般同事或「組織中的每個人」。
2. 檢查文件庫設定：在網站預設文件庫（Documents，網址通常是 `Shared Documents`）的設定中，確認「需要簽出」是**關閉**的，也沒有內容核准，否則服務無法更新檔案。
3. 上傳範本：把 `catalog/catalog-state.json` 上傳到文件庫根目錄，不要改檔名，也不要用 Office 開啟或編輯。
4. 設定後端 App：在管理員自己的 PowerShell 執行（第一次使用先執行第一行安裝模組）：

   ```powershell
   Install-Module Microsoft.Graph.Applications, Microsoft.Graph.Sites -Scope CurrentUser
   ./entra/setup-sharepoint.ps1 -SiteUrl https://<tenant>.sharepoint.com/sites/SendModes -FilePath "/sites/SendModes/Shared Documents/catalog-state.json" -PublicCertPath ./sharepoint-public.pem -WhatIf
   ```

   - 先用 `-WhatIf` 確認網站和憑證，再拿掉它正式執行。
   - 腳本會拒絕含私鑰的檔案，只接受 `sharepoint-public.pem`。
   - `-FilePath` 必須和實際檔案位置完全一致。如果文件庫網址不是 `Shared Documents`，請改成在瀏覽器網址列看到的實際路徑。
   - 授與網站權限需要 `Sites.FullControl.All`（只在管理員這次登入時使用），服務本身只有 `Sites.Selected` 加上這一個網站的寫入權。
5. 填入設定：把 `sharepoint-result.txt` 的 `SHAREPOINT_SITE_URL`、`SHAREPOINT_FILE_PATH`、`SHAREPOINT_CLIENT_ID` 填入 `.env`。

本腳本和 SharePoint 連線程式只用模擬回應測試過，尚未連到真實租戶。第一次啟動時請特別確認以下三點：

- 服務能讀到檔案。
- Publisher 存草稿後，SharePoint 上的檔案有更新（修改時間會變）。
- 兩個人同時儲存時，後存的人會看到「已有新版本」的提示，而不是覆蓋前一個人的修改。

## 第 3 階段：啟動與自動檢查

1. 啟動常駐服務，確認服務記錄出現「公司範本服務已啟動」。
2. 在任一台裝有 Node 22 的電腦執行 `node tools/check-deploy.mjs https://<正式網址>`。必須全部通過，重點包括：
   - `/taskpane.html`、`/auth.html`、`/api/config` 回 200。
   - `/api/catalog`、`/api/admin` 回 401。
   - `/.env` 回 404。
   - 沒有阻擋嵌入的標頭。
3. 重新啟動主機或服務，確認服務會自動恢復，範本庫內容也還在。
4. 確認一般同事開啟 SharePoint 網站網址時會被拒絕存取。

## 第 4 階段：產生 XML 並集中分配

1. 在部署根目錄產生正式 XML：

   ```text
   npm run manifest:production -- https://<正式網址> --output manifest.production.xml
   ```

2. 驗證 XML：`npx --yes office-addin-manifest@3.0.1 validate manifest.production.xml`。確認檔案內所有網址都是正式網址，增益集 ID 維持 `11d02175-05e1-4798-9724-ea05d5e29566`。
3. 請管理員到 Microsoft 365 管理中心 → 設定 → 整合式應用程式 → 上傳自訂增益集，上傳 `manifest.production.xml`，**只分配給試行名單**。Outlook 可能需要 24–72 小時才會出現按鈕，有時要重新啟動 Outlook。

## 第 5 階段：交給試行者驗收

這一階段由人操作，你只負責整理清單和記錄結果：

1. Publisher 在 Outlook 新郵件中開啟「應用程式 → 寄信模式」，按「公司帳號登入」，進入管理頁檢查 4 份草稿，自行發布 1 份。
2. 一般試行者（Windows、Mac 各一位）登入，選範本、填欄位、預覽並插入草稿。確認原有內容、簽名與回覆歷史都保留，再自行決定是否寄出。
3. 確認一般試行者看不到管理功能，Editor 不能發布，未指派的帳號無法登入。

完整清單見 `docs/OUTLOOK-ACCEPTANCE.md`。實機結果由試行者回報；不要把自動檢查通過寫成「Outlook 驗收通過」。

## 完成報告（IT 留存，供維護與憑證續期使用）

這份報告由 IT 留存，不需要交給需求者。

```text
寄信模式部署報告
正式網址：
主機／服務名稱／自動啟動方式：
範本庫：SharePoint 網站 URL、檔案路徑（或改用主機檔案的原因）：
SHAREPOINT_CLIENT_ID：
憑證到期日、續期負責人（不附私鑰）：
ENTRA_TENANT_ID：
ENTRA_CLIENT_ID（登入 SPA）：
ENTRA_API_AUDIENCE（範本 API）：
Publisher／Editor：
試行名單：
check-deploy.mjs 結果：全部通過／未通過項目：
manifest 驗證結果、M365 分配時間：
Outlook 實機：待測／Windows 結果／Mac 結果
未完成或待決定事項：
```

狀態要分開寫：「網站已部署」「Entra 已設定」「SharePoint 已連線」「已分配增益集」「Outlook 實機已驗收」。不要合併成一句「已完成」。
