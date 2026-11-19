# Windows 安裝包

本機 HTTPS 方案，適用於 Windows 10/11 x64 與新版 Outlook。Node.js 與正式版前端皆隨安裝包附上，使用者不需安裝開發工具或打指令。這不是開機前執行的 Windows 系統服務：它是目前使用者登入後自動啟動的背景程式。

## 1.6.2 視窗簡化

只保留「診斷／測試本機」與旁邊的「關閉」。開啟時自動檢查，結果直接顯示在視窗；不開啟瀏覽器。關閉僅關閉視窗，背景服務繼續執行。首次加入 Outlook 的步驟留在隨附說明。

## 組員使用

**每台電腦都要執行完整安裝檔。** `manifest.xml` 只讓 Outlook 知道載入網址，不包含程式或服務；網址中的 `localhost` 指的是使用者當下的電腦。把 XML 傳給同事、或只在開發電腦啟動服務，都無法讓同事的電腦使用。

1. 執行 `SendModes-Setup-1.6.2.exe`。Windows 詢問信任本機新產生的 localhost 憑證時，核對後按「是」；若拒絕，服務會保持未就緒，可稍後修復。
2. 安裝完成會開啟設定視窗，確認「本機服務正常」。
3. 如果公司 IT 尚未部署此增益集，依「組員安裝說明.txt」開啟安裝入口，在「我的增益集 → 新增自訂增益集 → 從檔案新增」選擇 `manifest.xml`。公司不允許自行安裝時，請 IT 部署安裝目錄內同一份 XML。
4. 在 Outlook 撰寫郵件，從應用程式選擇「寄信模式」。

關閉設定視窗不會停止背景服務。下次登入 Windows 會自動啟動，前提是 Windows「啟動應用程式」及公司政策沒有停用它。發生載入問題時，從開始功能表開啟「寄信模式」並按「診斷／測試本機」，未通過時重新執行安裝程式。在 Windows 已安裝的應用程式中可以解除安裝。Outlook 帳號中的增益集項目需另外移除；既有模板與簽章設定不由解除安裝程式刪除。

### 1.6.1 故障修正

- 安裝器不再等待背景子程序的輸出管線關閉；安裝啟動最多等兩分鐘，失敗顯示修復入口。
- 安裝先登記自啟，再啟動服務。登入時最多嘗試三次；缺少或到期的憑證需在設定視窗按修復，不在登入背景彈出信任要求。
- 本機健康檢查略過代理伺服器，但仍驗證 HTTPS 憑證。PowerShell 使用 Windows 內建模組路徑。
- 設定視窗新增「測試本機連線」及「開啟診斷資料」。若瀏覽器正常而 Outlook 空白，請 IT 檢查 Outlook WebView 的 localhost 存取、Microsoft Office.js CDN、憑證及端點防護政策；不要停用公司防護。
- 郵件表格保留固定欄寬、長字串換行及空白格的游標位置，並提供不依賴外層 ID 的格式規則。先前已套用的草稿不會被背景重寫；請在新草稿套用新版驗證。

這仍是每台電腦執行的本機方案。若公司要免本機安裝、免開機服務與本機憑證，需 IT 提供持續可用的 HTTPS 網站並集中部署對應 manifest，不能只換一份 XML。

Windows 安裝無法在未取得帳號授權的情況下替 Outlook 登記增益集。本包不加入 Graph/OAuth，也不自動登入或寄信。IT 事先集中部署 manifest，可省去組員的首次 Outlook 新增步驟。參考 [Microsoft 側載說明](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing)。

## 部署內容

- 檔案：`%LOCALAPPDATA%\Programs\SendModes`。
- 執行資料：`%LOCALAPPDATA%\SendModes`，ACL 僅目前使用者與 SYSTEM。
- 登入自啟：HKCU `Software\Microsoft\Windows\CurrentVersion\Run\OutlookSendModes`，使用無主控台的 `SendModes.exe --background`。
- HTTPS：僅監聽 `127.0.0.1` 與 `::1` 的 3443 埠；manifest 保留 `https://localhost:3443` 與原本 AppId。
- TLS：每次首次安裝產生獨立 RSA 憑證，只含 localhost/loopback、僅 serverAuth、CA=false。公開憑證加入 CurrentUser Root；PFX 密碼以 Windows DPAPI 保護。安裝包不含任何使用者私鑰。
- 憑證效期兩年；下次啟動時若剩不到 30 天，產生新憑證並由 Windows 再次詢問信任。公司禁止憑證信任或 PowerShell 時會顯示失敗，需 IT 處理。
- 不會終止佔用 3443 的其他程式。更新或移除只終止執行路徑、PID、啟動時間皆符合的自身程序。
- 解除安裝只移除清單中的檔案、自己的自啟項與自己產生且標記相符的憑證，保留其他檔案。
- 前端包含專案內的公司預設模板，沒有打包目前使用者的個人簽章或 Outlook 本機設定。
- Office.js 由 Microsoft CDN 載入，因此不是完全離線版。Windows ARM 與 macOS 未驗證；此包只宣告支援 x64。
- 安裝檔與啟動器未做公司程式碼簽章。內附 Node.exe 有 OpenJS Foundation 簽章。正式大量派送前可由公司簽署最後產物。

## 開發者重建

1. 執行 `npm ci`，使用受支援且有 OpenJS 簽章的 Node x64。本次使用 v24.18.0。
2. 取得 NSIS 3.11 ZIP，解開至 `.runtime/packaging-tools/nsis-3.11`。官方 ZIP 的 SHA-256 為 `c7d27f780ddb6cffb4730138cd1591e841f4b7edb155856901cdf5f214394fa1`；來源：[NSIS 官方發行頁](https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11.zip/download)。下載後必須核對雜湊再執行。
3. 將對應 Node 版本的官方 LICENSE 存成 `.runtime/packaging-tools/NODE-LICENSE.txt`（本次取自 nodejs/node v24.18.0）。
4. `npm run build:installer`。使用 Windows 內建 .NET Framework C# 編譯器，不需 .NET SDK。
5. `pwsh -NoProfile -File scripts/test-installer.ps1`。測試在隔離目錄與 3444 埠執行，會建立再移除測試憑證與測試自啟項；需有人確認 Windows 憑證信任視窗。
6. 無互動回歸：`pwsh -NoProfile -File scripts/test-installer-regressions.ps1`，驗證安裝檔解壓、實際啟動器與長時間背景子程序、失敗碼、首次失敗的自啟登記及解除安裝；不建立受信任憑證。

產物為 `release/SendModes-Setup-1.6.2.exe` 與 `release/SHA256SUMS.txt`。不要把 `.runtime`、開發憑證、node_modules 或使用者資料交給組員。

## 測試範圍

`test-installer.ps1` 執行真正安裝檔的隔離解壓模式與解除安裝，並測試同一份服務腳本：憑證、Windows 信任驗證、雙 loopback 監聽、重複啟動、自啟登記、停止再啟動、埠衝突與清理。`test-local-server.mjs` 驗證 TLS/SAN、靜態檔、HTTP 方法、Host 與目錄穿越保護。這些測試不等於新組員 Outlook 帳號的實際側載驗證。
