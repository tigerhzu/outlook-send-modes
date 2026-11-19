# 寄信模式

> **接手的同事請先讀 [HANDOVER.md](HANDOVER.md)**：目前進度、待辦、資料夾說明與常用指令都在那裡。

1.7 公司版將範本與程式分開：管理者儲存草稿、預覽後發布，同仁在 Outlook 登入公司帳號，搜尋／分類、填寫欄位、預覽，再插入目前草稿。範本更新、下架與回復不需重新安裝增益集，也不改已插入的郵件。

採 **XML manifest + Office.js + TypeScript／React 共用工作窗格**，以 Windows 新版 Outlook、Mac Outlook 與網頁版為公司部署目標。正式版由公司 HTTPS 主機提供，同仁不需安裝 Node 或 Windows EXE。跨平台實機驗收仍須依 [驗收表](docs/OUTLOOK-ACCEPTANCE.md) 完成。

公司登入只取得自訂範本 API 的權限，不使用 Graph、信箱同步或自動寄送。最後由使用者按 Outlook 原本的「傳送」。

## 公司版

交給 IT 的資料清單、Entra／主機／SharePoint 設定順序與同事啟用流程，見 [公司部署交接單](docs/IT-DEPLOYMENT.md)。

給 IT 的部署資料包原始檔在 [`deploy-kit/`](deploy-kit/)（AI-TASK.md、Entra／SharePoint 設定腳本、部署檢查工具），以 `scripts/package-deploy-kit.ps1` 打包成 `release/SendModes-Deploy-1.7.0.zip`。

不需公司帳號即可先試跑：`npm ci` → `npm run build:company` → `npm run demo:company`，再開啟 `http://127.0.0.1:4175`。此入口使用真實本地範本 API 與模擬 Office 草稿，不連真實信箱；操作及驗證範圍見 [本地測試](docs/LOCAL-TEST.md)。

```text
npm ci
npm run build:company
npm run manifest:production -- https://templates.company.example --output manifest.production.xml
```

依 [公司服務部署說明](docs/COMPANY-SERVICE.md) 設定 Entra 與同 origin API，再由 Microsoft 365 管理員部署 XML。中央庫可選持久化檔案或 SharePoint REST；公司網域、應用程式 ID、憑證與授權需由 IT 提供。本專案沒有預填可用的公司租戶，也尚未部署到公司。

- 公司範本每次開啟／重新整理都從服務讀取；不保存離線副本。插入前與確認後再次檢查版本，更新或下架即停止，要求重新預覽。
- 預設只插入內文，不寫入 To／CC／BCC；「套用主旨」預設未勾選，已有主旨時另行確認。欄位只在本機填寫與轉義，不上傳客戶資料或整封郵件。
- HTML 首次插入在內文最前方；再次套用只替換可安全定位的管理區塊，需確認。簽名、其他內容與回覆紀錄保留；標記不完整就停止。純文字使用獨立純文字版本；因無可靠隱形標記，同草稿已有範本紀錄時停止再次插入。
- 管理端區分 Editor／Publisher，發布、下架、回復與部門閱讀範圍由後端檢查。多人儲存衝突不自動覆寫。
- 第一版公司範本支援文字與表格，暫不提供範本圖片、一般附件或強制寄出前檢查。原有個人簽章圖片仍保留。
- 個人模式、聯絡人、簽章仍存於各裝置，**不跨裝置同步**；公司範本才由 Mac／Windows 共用。公司建置不夾帶舊內建範本或收件者，新使用者的個人模式為空；既有設定不被中央發布覆寫。

驗證結果與實機限制見 [驗證報告](docs/VERIFICATION.md)。

## 本機開發與舊版個人模式

需 Windows 新版 Outlook、允許自訂增益集的信箱，以及 Node.js 22.12+ 或 24 LTS。

在專案資料夾執行：

```powershell
npm ci
npm run certs:install
npm start
```

首次信任開發憑證時依 Windows 提示操作。開啟 [本機工作窗格](https://localhost:3443/taskpane.html) 確認 HTTPS 沒有憑證警告；在一般瀏覽器開啟只是連線檢查，不能操作 Outlook 草稿。

保持伺服器執行，在瀏覽器進入 [Microsoft 官方側載入口](https://aka.ms/olksideload)，以和桌面 Outlook 相同的信箱登入。選 **My add-ins → Custom Addins → Add a custom add-in → Add from File**，安裝本專案的 `manifest.xml`。然後回到 **新版 Outlook 桌面程式**，新增郵件，在「郵件 / Message」頁籤或「應用程式 / Apps」中開啟「寄信模式」。

詳見 [安裝與正式部署](docs/INSTALL.md)。

## 1.6 版

1.6.1 修正安裝最後一步無限等待、首次啟動失敗未登記自啟及表格編輯容易撐寬的程式缺口。每台電腦仍須執行完整安裝包，只有 XML 不會啟動本機服務。新版含診斷與連線測試入口；見 [安裝及故障排查](installer/README.md)。自動化已驗證，受影響電腦仍須確認實際重開機及 Outlook 編輯結果。

Logo 為畫廊 #221 毛氈風格的橘色信封。首頁使用白色細框卡片，移除裝飾圖示及名稱下方的主旨小字，套用按鈕統一深藍；寬窗格採雙欄，窄窗格直排。沒有整片彩色底或內部重複品牌標題。列表下方為「設定」。

白底細線分隔的郵件編輯介面，採清楚偏粗的字體。編輯頁直接修改模式名稱、每人的 To／CC Email、主旨與內文；新增模式、常用聯絡人、備份及刪除收進右上角「⋯」，進階格式收進內文工具列的「⋯」。**Save** 儲存並返回列表；失敗時留在編輯頁。

「常用聯絡人」為藍色按鈕，簽章為綠色按鈕。

**簽章：**第一次點「簽章」開啟空白編輯區，貼上自己的文字、圖片與連結，再按 Save。之後點「簽章」會加在目前草稿可讀取內文的最底部；旁邊鉛筆可重新編輯。回覆草稿若包含歷史，也會放在歷史後方，符合「最下面」的指定。既有內容不會被清除。

圖片可直接貼上，或按「圖片」選擇原檔。Outlook 複製簽章時，會在清理 HTML 前讀取 originalsrc／CID／附件識別資訊並保存圖片資料，支援 VML 圖片轉換。公開 HTTPS 圖片需能讀取原檔才可保存；失敗時會提示並保留原編輯內容。先前已變空白而失去來源的圖片，需從目前草稿重新貼上。若來源是目前草稿的 CID 圖片，透過 Office.js 讀取後保存；無法解析的圖片會提示補上原檔，不會假裝保存成功。圖片使用內嵌附件加入郵件，不引用 localhost。簽章圖片需 Mailbox 1.8；文字模式仍保留原本的 Mailbox 1.3 相容性。

## 日常使用

1. 點模式旁鉛筆，在 To／CC 輸入 Email；按「＋ → 新增一人」增加欄位，或直接選常用聯絡人。「×」移除一人，Save 儲存並返回。首頁「常用聯絡人」可預存姓名與 Email（姓名可留空），也能從「＋ → 管理常用」進入。
2. 回到模式列表，選擇「加班」或「居家」套用至目前草稿。缺少地址時會指出缺少的人員，並阻止套用。
3. 四份範本保留新版欄位與預填內容；居家工作清單預設四列。日期、原因、工作內容及主旨直接在 Outlook 補填；要修改往後套用的預設，再按卡片鉛筆。
4. 如將取代草稿的既有收件者、主旨或模板內容，先檢閱確認資訊。模板以外的既有內容、簽名及回覆歷史予以保留。
5. 檢查內容後，自行按 Outlook 的「傳送」。

**修改這封草稿：**在 Outlook 直接改收件者、CC、主旨、儲存格文字，只改這封信。

**修改模式預設：**在管理頁新增、修改或刪除模式、調整多人 To / CC、主旨與內文。只有按「Save」才寫入預設設定。編輯器支援基本文字格式與可編輯表格。

To 與 CC 各最多 100 位，支援貼上以分號、逗號或換行分隔的多位地址。常用聯絡人最多 500 位；選取後是獨立副本，修改或刪除常用資料不會改動任何模式的既有地址。套用時重複地址不分大小寫去重，同址優先放在 To。空白 To 可暫存但不能套用；格式錯誤的地址會阻止 Save。舊版儲存與備份的聯絡人參照會轉成 Email，模式內容與簽章保留；原本未填地址的項目仍須補齊。

## 儲存與草稿保護

- 模式使用 `localStorage`，依信箱與增益集網址分開，保存在這台電腦的 Outlook WebView 儲存空間。關閉面板或重新啟動 Outlook 後仍保留，但**不會隨信箱同步到其他電腦**。更換部署網址、清除 WebView／應用程式資料、重設使用者環境都可能需要重新匯入備份。
- 管理頁的「⋯ → 匯出備份」會匯出目前編輯內容，包含尚未儲存的變更，可在儲存衝突時先保留副本。「⋯ → 匯入備份」後仍須按「Save」才更新預設。JSON 包含收件者地址與模板，請自行妥善保存。
- 草稿追蹤資訊另存於該郵件的 Office 自訂屬性，只記錄套用狀態，不作為模式設定儲存位置。
- To / CC 使用完整名單取代；地址不分大小寫去重，同時出現在兩欄時以 To 為優先。不修改 BCC。
- 第一次套用從內文最前方插入；再次套用只處理可辨識的本增益集模板區域，避免持續堆疊表格。若 Outlook 重寫或使用者移除標記而無法安全定位，停止操作並提示，不猜測刪除範圍。
- Office.js 並非交易式 API：各欄位可能先後完成。失敗訊息會如實列出已完成／失敗部分，不自動回寫舊資料來覆蓋使用者的新修改。
- 套用前先以 Tab 完成收件者輸入；套用過程請暫停手動編輯。Office.js 只回傳已解析收件者，也無法鎖住 Outlook 的編輯器；再次讀取可降低競態，無法提供跨欄位原子交易。

## 驗證

```powershell
npm run typecheck
npm test
npm run build
npm run validate:manifest
npx playwright install chromium
npm run test:e2e
```

自動化測試使用 Office.js 模擬環境驗證草稿行為；瀏覽器 UI 測試不是 Outlook 整合驗收。真正 Outlook 的安裝、命令位置、編輯儲存格、簽名與回覆保留、重啟持久性和釘選，需依 [Outlook 驗收表](docs/OUTLOOK-ACCEPTANCE.md) 在實機完成。已執行結果見 [驗證報告](docs/VERIFICATION.md)。

## 舊版 Windows 本機安裝方式

組員可使用 [Windows 安裝包](installer/README.md)：內附正式版與 Node 執行環境，安裝後隨 Windows 登入自動啟動，不需打指令。首次需確認 Windows 的 localhost 憑證信任；Outlook 帳號仍需新增 manifest，或由公司 IT 預先集中部署。產物位於 `release/SendModes-Setup-1.6.2.exe`。

開發版指向 `https://localhost:3443`，所以每次使用都必須有本機伺服器運作。日常可用 `npm run start:background` 啟動獨立背景服務，不需保持命令視窗開啟；電腦重新啟動或登出後需再執行一次。關閉伺服器後面板無法載入；已填入的草稿內容仍屬於 Outlook，可繼續編輯與傳送。

僅使用個人模式時，也可部署一般 `npm run build` 的靜態產物。1.7 公司範本版請使用 `npm run build:company` 及上述公司 API 服務。切換網址前先匯出個人設定，原網址的 localStorage 不會自動搬移。詳見 [部署需求](docs/INSTALL.md#正式-https-部署)。

Microsoft 官方依據與查閱日期見 [REFERENCES.md](docs/REFERENCES.md)。
