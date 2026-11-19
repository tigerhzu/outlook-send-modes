# 先在本機試跑公司版

可以先試跑，不必等 IT 建立 Entra 或 SharePoint。這個測試入口使用**實際公司版前端、Node API、檔案儲存及權限判斷**，只把 Microsoft 登入和 Outlook 草稿改成虛構測試環境。

它不連接真信箱、不寄信、不讀取公司租戶，也不能用來宣稱 Mac／Windows Outlook 已完成驗收。

## 開啟示範

需要 Node.js 22.12 以上與 npm。在專案根目錄執行。

```sh
npm ci
npm run build:company
npm run demo:company
```

用瀏覽器開啟 <http://127.0.0.1:4175>。命令列保持開啟，按 `Ctrl+C` 結束。

若 4175 已被使用：

```sh
npm run demo:company -- --port 4176
```

這個命令只監聽本機 `127.0.0.1`；同事無法從另一台電腦連入。不要把這個示範入口放到正式主機或反向代理後方。

## 可以親手試的流程

1. 選「一般同仁」，按工作窗格的「公司帳號登入」。此處會取得本次示範的虛構測試身分，不開啟 Microsoft 登入頁。
2. 選「維護通知」，填寫稱呼、日期及說明，查看預覽。
3. 按「插入草稿」。右側會出現結果，原本的 To／CC、主旨、內容、簽名及回覆歷史保留；下方顯示寄信次數為 0。
4. 選「編輯者」，重新登入，再按「管理公司範本」。可以修改並儲存草稿，沒有發布權限。
5. 選「發布者」，重新登入，在管理頁選剛儲存的範本，按「發布已存草稿」並確認。
6. 切回「一般同仁」並登入，確認能看到新版本。也可以用發布者測試下架、歷史版本回復。

角色切換會重新載入工作窗格、清除其記憶體中的測試權杖，再以所選角色登入。範本庫在同一次啟動期間共用；「重設模擬草稿」只清除右側測試草稿，保留本次範本修改。正常結束示範後，本次虛構範本庫會移除，下次啟動從範例開始。

所有範本、身分、收件者都是虛構資料。請使用虛構欄位測試；模擬草稿只保存在該瀏覽器分頁的 `sessionStorage`，填入內容不送到範本 API。

## 自動重跑這次整合驗證

開另一個終端機，在相同專案根目錄執行：

```sh
npx playwright install chromium
npm run test:company-local
```

若已安裝 Playwright Chromium，可省略第一行。測試使用隨機的本機連接埠，不影響仍在 4175 開啟的示範。

兩項整合測試涵蓋：

- 真實 Node API 與檔案儲存：RS256 測試權杖簽章驗證、未登入 401、一般同仁管理 403、編輯者不能發布、舊 ETag 衝突 412、儲存／發布／下架、關閉後停止監聽。
- Chromium 操作實際 `dist/`：登入、必填欄位與預覽、插入模擬草稿、原內容及簽名保留、角色切換、編輯者儲存、發布者確認發布、一般同仁看到新版本。測試同時確認未對外連線、沒有 JavaScript 執行錯誤、寄信次數為 0。

測試截圖放在 `docs/evidence/local-demo/`：`preview-mock.png`、`inserted-draft-mock.png`、`publisher-mock.png`。檔名中的 `mock` 表示 Office 與登入是模擬。

## 正式上線還要驗什麼

| 本地已能檢查 | 要等 IT 環境才能檢查 |
| --- | --- |
| 公司版能建置與啟動、頁面及 API 能運作 | 公司 HTTPS、反向代理、網路政策、服務自動啟動 |
| 角色與版本檢查、範本儲存／發布流程 | 真實 Entra 登入、MFA／條件式存取、租戶角色及群組指派 |
| FileRepository 的讀寫與衝突處理 | SharePoint 權限、憑證、讀寫、備份及還原 |
| 模擬草稿保留內容、簽名及歷史 | Mac／Windows／網頁 Outlook 的實際 Office.js 行為與排版 |

正式驗收請使用 [OUTLOOK-ACCEPTANCE.md](OUTLOOK-ACCEPTANCE.md)，公司部署步驟在 [IT-DEPLOYMENT.md](IT-DEPLOYMENT.md)。

## 測試入口與正式服務的界線

`scripts/company-local-demo.mjs` 是獨立啟動程式，沒有讀取正式 `.env`；`tests/local-demo/` 提供虛構 Office 宿主與顯示測試草稿的外框。每次啟動在記憶體產生新 RSA 金鑰，正式 API 驗證器以該測試公鑰驗證虛構 JWT。測試權杖不能用於真正 Entra 或正式服務。

正式部署使用 `npm run start:company`，只執行 `server/index.mjs`，從 Microsoft 金鑰端點驗證公司身分。正式服務沒有「切換角色」或免登入選項。不要把本地示範命令設定成正式服務。
