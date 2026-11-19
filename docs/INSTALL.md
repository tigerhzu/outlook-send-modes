# 安裝、使用與部署

公司部署使用同一份 XML manifest 與 HTTPS 工作窗格，提供 Windows 與 Mac 使用。公司範本由中央服務提供，個人模式仍保存在各裝置；公司管理、身分驗證與範本發佈設定見 [公司部署](COMPANY-SERVICE.md)。沿用原 AppId 與 `ReadWriteItem` 草稿權限，manifest 版本為 1.7.0.0。

## 適用環境

- 公司正式目標為 Windows 新版 Outlook 與 Outlook for Mac，使用 Microsoft 365 / Exchange Online 工作或學校信箱；Windows 傳統版及網頁版列入相容性驗收。各平台的實測結果分開記錄，不能以其中一個平台通過推定其他平台通過。
- 管理員允許安裝自訂增益集。若看不到 Custom Addins，需由管理員開放或集中部署；這不是改用 COM/VSTO 的情境。
- 使用者只需 Outlook、網路連線及公司部署權限，不需安裝 Windows EXE、Node.js 或 localhost 憑證。Node.js 22.12+、npm 與 TCP 3443 只用於開發環境。
- 公司範本依目前草稿格式預覽並使用 HTML 或純文字版本；預覽後若格式改變會停止，需重新整理。舊個人模式只支援 HTML 表格。純文字公司範本只可在沒有範本紀錄的新草稿插入一次，避免無標記時猜測取代範圍。

新版 Outlook 支援 Office.js Web Add-in，COM/VSTO 不適用；網路中斷也會影響增益集啟用。[Microsoft 新版 Outlook 開發文件](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook)

XML 的 `DesktopFormFactor` 同時用於 Windows、Mac 及網頁版工作窗格，沒有另做 Mac 安裝程式。基礎草稿功能要求 Mailbox 1.3；釘選為 1.5，簽章圖片讀寫為 1.8。實際能力也受 Exchange 伺服器及個別 API 限制，請以功能檢查與實機驗收確認。本專案未宣告手機撰寫入口。[Microsoft 跨平台概覽](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview)、[API 需求集合](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/outlook/outlook-api-requirement-sets)

## 本機 HTTPS

以下為開發者流程。Windows 在專案根目錄開啟 PowerShell，Mac 使用 Terminal：

```powershell
npm ci
npm run certs:install
npm start
```

`certs:install` 使用 Microsoft 的 `office-addin-dev-certs` 建立／安裝 localhost 開發憑證。依作業系統憑證信任提示操作；Mac 需確認 Keychain 信任。公司政策阻擋時請由 IT 協助。憑證及私鑰保存在開發者目錄，不放進 Git，也不要分享。[Microsoft 憑證工具示例](https://learn.microsoft.com/en-us/samples/officedev/office-add-in-samples/excel-add-in-hello-world/)

`npm start` 只讀取已產生的憑證檔，不會自動信任憑證。檔案存在並不表示 Windows 已信任；若信任視窗尚未完成或安裝命令中斷，請重新執行 `npm run certs:install`，完成 Windows 的信任確認，再執行 `npm run certs:verify`。

Windows 本機開發可執行 `npm run start:background`，以獨立隱藏程序啟動本機 HTTPS 服務，不需要保持命令視窗開啟。這個 PowerShell 輔助腳本及既有 EXE 僅限 Windows；公司跨平台部署不依賴它們。腳本會等待服務就緒並驗證面板、命令頁及圖示；再次執行會檢查已啟動服務，不重複占用埠。它不安裝憑證、不重新側載，也不修改 Outlook 資料。啟動記錄在已排除版本控制的 `.runtime/`。

背景服務不會自動隨 Windows 登入啟動；登出或重新啟動電腦後，需再次執行 `npm run start:background`。若面板與圖示同時空白，先執行這個命令，再關閉並重開 Outlook 的增益集面板，不必先重裝增益集。

開發時仍可用 `npm start` 啟動 `https://localhost:3443`，此方式需保持終端機開啟。另用瀏覽器檢查：

- [工作窗格](https://localhost:3443/taskpane.html)
- [命令頁](https://localhost:3443/commands.html)（此頁空白是正常的）
- [圖示](https://localhost:3443/icons/mail-felt-32.png)

網址應有有效 HTTPS，不能靠忽略憑證警告完成安裝。若憑證過期或不受信任，重新執行 `npm run certs:install`；需要時執行 `npx office-addin-dev-certs verify` 檢查，然後重新啟動 Outlook。若 3443 被占用，先查明是哪個程式；不要直接換埠而忘記修改 manifest。

一般瀏覽器沒有 Office.js 的草稿上下文。此檢查只能確認資源能載入，日常操作在 Outlook 桌面程式內進行。

開發時也可執行 `npm run verify:https`，以已生成的開發 CA 檢查伺服器 TLS 與資源 HTTP 200。它不會安裝憑證，也不能取代 Windows 的信任確認；Windows 信任狀態請用 `npm run certs:verify` 檢查輸出。

## 開發測試側載

本專案採用 **add-in only XML manifest**。依官方目前支援流程：

1. 保持本機 HTTPS 伺服器執行。
2. 在瀏覽器開啟 [https://aka.ms/olksideload](https://aka.ms/olksideload)，登入**桌面 Outlook 正在使用的同一個信箱**。稍候會開啟 Add-Ins for Outlook 對話框。
3. 點 **My add-ins / 我的增益集**。
4. 在底部 **Custom Addins / 自訂增益集** 選 **Add a custom add-in → Add from File / 從檔案新增**。
5. 選專案根目錄的 `manifest.xml`，檢閱權限後安裝。
6. 回到 Windows 新版 Outlook 或 Outlook for Mac，必要時重新啟動，新增一封郵件。Mac 也使用上述瀏覽器入口；Mac 16.85 起「Get Add-ins」會開啟 Marketplace，不是側載對話框。

瀏覽器登入是一次性的官方安裝登記步驟，完成後每天直接使用桌面 Outlook。**Add from URL 已不提供**；不要把 localhost 網址貼入不存在的 URL 側載入口。[Microsoft 側載文件](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing)

### 官方 CLI 側載（備用）

若瀏覽器的檔案選擇器無法操作，可改用 Microsoft 365 Agents Toolkit CLI 登記同一份 XML manifest。在專案根目錄的另一個 PowerShell 視窗執行，並保持 `npm start` 的 HTTPS 伺服器運作：

```powershell
npx --yes --package @microsoft/m365agentstoolkit-cli@1.1.19 atk auth list
npx --yes --package @microsoft/m365agentstoolkit-cli@1.1.19 atk auth login m365
npx --yes --package @microsoft/m365agentstoolkit-cli@1.1.19 atk install --xml-path .\manifest.xml --interactive false
```

確認 CLI 使用的帳號與新版 Outlook 相同；若已登入正確帳號，可略過 `auth login m365`。Windows 可能使用原生 WAM 帳號登入視窗，而沒有開啟瀏覽器分頁；請以 **Alt+Tab** 找到 Microsoft 登入視窗並完成登入。這個登入只用於安裝登記，不是增益集的日常登入系統。

`npm start` **只啟動 HTTPS 伺服器，不會自動側載**。等候 `atk install` 回報成功後，回到新版 Outlook 新增郵件，依下一節找到「寄信模式」；必要時重新啟動 Outlook。CLI 登記成功仍須確認桌面工作窗格實際可開啟。[Microsoft 官方 CLI 文件](https://learn.microsoft.com/en-us/microsoftteams/platform/toolkit/microsoft-365-agents-toolkit-cli#atk-install)

## 找到「寄信模式」與釘選

在**撰寫新郵件或回覆**時，開啟功能區的 **郵件 / 訊息 / Message** 頁籤，找「寄信模式」。若沒有直接顯示，點 **應用程式 / Apps**，從已安裝增益集中選「寄信模式」。這個命令只屬於郵件撰寫模式，不會在行事曆或單純閱讀郵件時顯示。按下後在右方開啟工作窗格。[Microsoft 使用說明](https://support.microsoft.com/en-us/outlook/getstarted/use-add-ins-in-outlook)

簡化功能區可能只顯示「應用程式」的四格方塊圖示，沒有文字；將滑鼠移上去確認提示名稱。若已開啟正確清單但沒有「寄信模式」，先確認桌面與側載使用同一信箱，等草稿儲存後關閉整個 Outlook 並重新開啟，再查一次。

Outlook 依版本、視窗寬度及功能區設定決定命令位置；manifest 不指定螢幕座標。在 Outlook 提供「釘選」的應用程式選單中，可對「寄信模式」按右鍵選「釘選」；是否提供此選項由當前 Outlook 介面決定。

工作窗格本身也宣告支援釘選：若窗格標題列有圖釘，可點圖釘讓後續撰寫郵件保持面板開啟。這項功能需支援 Mailbox 1.5 的 Microsoft 365 帳號／用戶端；**Outlook.com 不提供窗格釘選**。閱讀與撰寫的釘選狀態分開，本專案只啟用撰寫命令。未提供圖釘時仍可每次從 Apps 開啟。[Microsoft 工作窗格釘選文件](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/pinnable-taskpane)

## 個人模式設定與日常使用

**Save 會儲存並返回列表。**不用另外按返回，失敗時則保留編輯內容。

1. 點模式旁鉛筆，To／CC 每人一欄；按「＋ → 新增一人」或選常用聯絡人。「×」移除。首頁「常用聯絡人」或「＋ → 管理常用」可新增、修改及刪除常用 Email；各模式保存地址副本，不會連動修改。
2. 直接修改模式名稱、To／CC、主旨及內文，按 Save 返回列表。每欄最多 100 位；空白 To 可暫存但不能套用，錯誤地址會阻止儲存。
3. 模板編輯器可直接修改儲存格文字，也能編輯基本字體格式及插入表格。加班與居家的內文只是可修改的初始範本。儲存時只保留支援的基本 HTML 格式；不把貼入的程式、外部圖片或進階互動內容保存在模板裡。這項清理只處理模板，不清理 Outlook 原有內文與簽名。
4. 開一封草稿，從模式列表套用。若已有輸入中的收件者，先按 Tab 使 Outlook 完成解析。
5. 確認畫面會指出將取代的既有欄位或模板內容。取消不寫入；同意後等候完成訊息，再在 Outlook 填日期與內容。
6. 在 Outlook 內改的資料只影響這封草稿。下一封仍使用最後一次「Save」的預設。
7. 最後由你檢查並按 Outlook 的「傳送」。增益集只處理目前草稿，不建立自動寄送排程。

Office.js 可能重寫插入的 HTML。模板的安全基本樣式會轉換為限定模板範圍的樣式規則；實際表格線條、留白、文字格式、簽名圖片，以及回覆郵件排版仍需依驗收表在新版 Outlook 確認。[Microsoft Body API](https://learn.microsoft.com/en-us/javascript/api/outlook/office.body?view=office-js)

### 儲存位置與備份

模式是依信箱及部署 origin 分開的 `localStorage`，保存在這台電腦的 Outlook WebView 資料中，**不會同步到信箱**。以同一 Outlook 使用者環境、同一帳號及同一網址重新開啟仍會保留。一般瀏覽器與 Outlook 的儲存空間不保證共用。

管理頁提供 JSON 匯出／匯入備份。「⋯ → 匯出備份」匯出管理頁目前的編輯內容，**包含尚未儲存的變更**；儲存因另一工作窗格的更新而發生衝突時，可先匯出以保留修改。「⋯ → 匯入備份」先載入管理頁，檢查後再按「Save」才持久保存。換電腦、清除 Outlook WebView 資料、重設系統或變更 `https://localhost:3443` 為正式網址前，先匯出；在新環境匯入後儲存。備份內含 Email 與模板文字，請留在自己的受控位置。

設定可容納最多 100 個模式；主旨最多 255 字元，單一模板最多 100,000 字元，總儲存內容限制 1 MB。儲存空間不可用、超過容量或其他工作窗格已更新設定時會顯示失敗，不會假裝儲存成功。

每封草稿的套用追蹤使用 Office 自訂屬性，用來辨識同一封草稿已插入的區域，與模式設定本身分開。

### 個人模式替換與錯誤

- To / CC 是完整替換，不累加；同一地址去重，To 優先。BCC 不變。
- 新草稿直接套用；有簽名或既有內文時，首次插入在前方並保留原文。
- 重複套用不無限增加表格。切換模式或取代已填模板前，明確確認受影響內容。
- 若無法可靠辨識先前模板位置，停止並要求保留原稿、改用新草稿。這可能發生於 Outlook HTML 改寫、手動刪除外層標記或上次操作中斷；不會猜測刪除整封內文。
- Outlook 沒有跨 To、CC、主旨及內文的交易式寫入。遇到失敗／逾時，依畫面列出的完成部分檢查草稿，確認後再試。套用途中請暫停手動編輯。

## 簽章

1. 在列表點「簽章」，貼上自己的簽章，按 Save。也可用旁邊的鉛筆進入編輯。
2. 日後點「簽章」，就會加入目前草稿內文最下方。操作不會修改 To、CC、主旨或原有內容。
3. 圖片沒有跟著貼上時，按「圖片」選原檔。支援 PNG、JPG、GIF、WebP，單張上限 500 KB，簽章最多 20 張、HTML 總長 750,000 字元；全部設定仍受本機儲存容量限制。
4. 相同草稿再次點擊會保留已加入的簽章，不覆蓋手動修改。既有內文包含完整且至少 24 個非空白字元的相同簽章文字時也不重複加入。短簽章及圖片簽章主要依此增益集的追蹤標記去重。
5. 簽章加入中斷、追蹤標記被移除或讀回內容不符時停止；檢查草稿與附件，不盲目重試。圖片以內嵌附件方式加入，不使用 Graph、不寄信。
6. 編輯模式與簽章都可從右上角「⋯ → 匯出備份」保存目前未儲存的內容；JSON 包含簽章與圖片資料。外部 HTTPS 圖片必須能由 Outlook 存取；需登入的圖片若無法加入，改用原檔。

## 工具列與版本更新

目前 manifest 版本為 1.7.0.0，沿用相同 AppId 與毛氈橘色信封圖示。程式更新替換 HTTPS 站台資源；只有 manifest 宣告、版本或入口變更才需更新組織部署。公司範本發佈獨立於程式版本；重新開啟窗格取得已發佈內容，套用前再檢查所選版本。若宿主圖示仍舊，完全關閉再重開 Outlook。

1.1 版沿用相同 AppId 與設定儲存位置；manifest 版本為 1.1.0.0，圖示 URL 加上版本參數避免沿用舊快取。撰寫工具列入口已宣告 `MessageComposeCommandSurface` / `TabDefault`。在草稿的「訊息 → 應用程式」對「寄信模式」按右鍵，若有「釘選」即可釘選；命令順序與可見位置由 Outlook 決定，不能以 manifest 強制插入指定螢幕位置。右側面板標題的圖釘是另一項「保持面板開啟」功能。[Microsoft 使用說明](https://support.microsoft.com/en-us/outlook/getstarted/use-add-ins-in-outlook)

新版已用官方 CLI 重新登記 manifest。若仍顯示舊圖示，先關閉、重開面板；Outlook 的工具列快取可能需要關閉整個 Outlook 後再開啟。

## 正式 HTTPS 部署

正式版不必在使用者電腦執行 Node.js；公司 HTTPS 主機同時提供工作窗格靜態資源與範本 API，後端使用自己的 Entra 應用程式權限驗證公司使用者。SharePoint 作為中央範本來源，由伺服器連線；瀏覽器不持有服務端憑證，也不要求 Graph 信箱或寄信權限。詳見 [公司部署](COMPANY-SERVICE.md)。

1. 執行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`。
2. 將 `dist/` 與公司 API 部署至同一 HTTPS origin，例如 `https://mail-modes.your-company.example/`。此網址僅示意，必須換成 IT 確認的真實公司網域；目前沒有宣稱該範例已部署。
3. 使用有效、受信任且未過期的 TLS 憑證；所有 HTML、JavaScript、CSS 和 PNG 圖示均由 HTTPS 載入。
4. 主機需允許 Outlook 內嵌頁面載入，依公司實際 Outlook 宿主設定允許清單，避免以 `X-Frame-Options: DENY` / `SAMEORIGIN` 阻擋工作窗格。CSP 必須允許 Microsoft Office.js 官方 CDN。靜態入口不可被無法在 iframe 完成的登入頁攔住；API 必須獨立驗證 token、租戶、audience、scope 與角色。僅把增益集分配給員工不等於 API 已有存取控制。
5. 產生正式 manifest：

   ```powershell
   npm run manifest:production -- https://mail-modes.your-company.example
   ```

6. 上述命令產生 `manifest.production.xml`；可加 `--output 路徑` 指定另一個輸出檔。產生器拒絕 localhost、IP 位址、子路徑、帳密及殘留的其他資源 origin，不會覆蓋開發用 `manifest.xml`。執行 `npx office-addin-manifest validate manifest.production.xml`，並從 Windows、Mac 分別檢查 icon、support、commands、taskpane 及 API 可用。產生器不會驗證實際主機或部署租戶。
7. Microsoft 365 管理員到 **Settings → Integrated apps** 部署自訂 XML，先分配給含 Windows／Mac 使用者的試行群組。若使用 Add-ins 子入口，選 **Deploy Add-in → Upload custom add-in → manifest 檔案**。完成 [實機驗收](OUTLOOK-ACCEPTANCE.md) 再擴大至公司群組；可能需重新啟動 Outlook，官方提示命令分發可能需 24–72 小時。[Microsoft 集中部署文件](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins?view=o365-worldwide)
8. 正式站台 origin 與 localhost 不同，先從開發版匯出設定，再在正式版匯入。

公司範本的資料流程為「編輯草稿 → 發佈 → 使用者取得已發佈版本」，下架或回復版本也由中央管理。編輯與發佈角色由 API 強制檢查，不能只隱藏按鈕。公司範本只插入目前草稿的受管理區塊，預設保留 To／CC／BCC，主旨由使用者選擇是否套用；個人模式維持原本的收件者替換行為。未成功取得已發佈版本、版本已更新／下架或模板無法安全定位時應停止，不以舊快取悄悄代替。

公司正式上線仍需 IT 提供真實 HTTPS 網域、Entra tenant／應用程式設定、SharePoint 來源與授權，完成服務部署與 Windows／Mac 驗收。程式碼、XML 及 mock 測試完成不等於這些租戶步驟已完成。

Office Add-in 的 manifest 只登記入口，並不把整個網站安裝到 Outlook。**本機開發伺服器關閉後，指向 localhost 的增益集無法再載入或套用；既有草稿仍能在 Outlook 編輯。正式 HTTPS 主機正常運作時，就不需要本機開發伺服器。**[Microsoft 發佈說明](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/develop-add-ins-visual-studio)

## 常見問題

| 狀況 | 檢查方式 |
| --- | --- |
| 找不到自訂安裝入口 | 使用 `aka.ms/olksideload`，不是新版 Store 的搜尋頁；檢查信箱及租戶政策。 |
| 安裝後找不到按鈕 | 使用同一信箱、開啟撰寫草稿、查看 Message → Apps，必要時重啟 Outlook。 |
| 面板載入失敗 | 公司版確認 HTTPS 主機、Office.js CDN 與嵌入政策；本機開發版才檢查 `npm start`、3443 與 localhost 憑證。 |
| 只有姓名、不能套用 | 到管理頁補上該人的實際 Email，儲存後再試。 |
| 表格無法插入 | 將郵件改為 HTML 格式；不要以純文字郵件驗收表格。 |
| 重啟後設定不見 | 檢查信箱、部署網址和 Outlook 使用者環境是否變更，或 WebView 資料是否被清除；匯入備份。 |
| 窗格沒有圖釘 | 釘選依帳號／版本支援，不影響從 Apps 開啟及使用。 |
| 只套用部分欄位 | 依訊息檢查目前草稿，完成／失敗部分不會被誤報為全數成功。 |

## 移除

在 Outlook 的應用程式管理頁移除「寄信模式」，或回到官方側載頁的 My add-ins 移除。需要保留模式時先匯出 JSON。移除增益集不會自動清空已存在的草稿內容。

### 1.4 資料轉換

讀取舊版設定或匯入 version 1 備份時，會把每個模式的聯絡人 ID 轉成 Email。保留模式 ID、名稱、主旨、內文與簽章；無地址的舊項目保留為待填欄位，不能默默漏掉 CC。Save 才寫入 version 2，沿用同一個本機帳號儲存 key 與衝突檢查。新備份不再包含聯絡人清單。

### 1.5 常用聯絡人

Settings v2 新增可選 favorites 清單，舊設定不需補欄位即可載入。常用姓名可留空，Email 必須有效；同地址不分大小寫去重，最多 500 位。選取常用聯絡人只複製 Email 到模式，之後刪除／修改常用不連動模式。從編輯頁進入管理常用再返回，不丟失未儲存模式內容；Save 儲存整份設定並返回首頁。備份包含常用聯絡人。
