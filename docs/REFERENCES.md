# Microsoft 官方文件依據

跨平台及公司部署文件重新查閱：2026-11-16；其餘既有 API 依據初查於 2026-11-13。Outlook 的 UI、帳號與租戶限制可能改變；安裝時若介面不一致，先核對相應官方頁面。

| 主題 | 本專案採用的設計 | 官方來源 |
| --- | --- | --- |
| 新版 Outlook | 使用 Office.js Web Add-in；不使用 COM 或 VSTO | [Develop Outlook add-ins for the new Outlook on Windows](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook) |
| Windows／Mac 共用 | 同一 Office.js 網頁工作窗格及 XML，依 API 能力啟用功能；不需要每個平台安裝本機程式 | [Outlook add-ins overview](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview) |
| 最低 API 能力 | 基礎 Mailbox 1.3，釘選 1.5，圖片功能 1.8；能力仍受用戶端、伺服器與個別 API 限制 | [Outlook API requirement sets](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/outlook/outlook-api-requirement-sets) |
| 組織分發 | Microsoft 365 管理中心 Integrated apps／Add-ins，先分發試行群組，再擴大公司使用；XML 不包含網站程式 | [Deploy Office Add-ins in the Microsoft 365 admin center](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-deployment-of-add-ins?view=o365-worldwide) |
| 增益集命令 | XML `VersionOverrides` 定義功能區命令，`ShowTaskpane` 開啟工作窗格 | [Create add-in commands with the add-in only manifest](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/create-addin-commands) |
| Outlook 撰寫命令表面 | `MessageComposeCommandSurface`，使用 Outlook 支援的 `TabDefault`，不指定任意螢幕位置 | [ExtensionPoint element](https://learn.microsoft.com/en-us/javascript/api/manifest/extensionpoint?view=common-js-preview) |
| 權限 | 只用 `ReadWriteItem`，讀寫目前郵件欄位；不要求 `ReadWriteMailbox`、Graph 或傳送權限 | [Understanding Outlook add-in permissions](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/understanding-outlook-add-in-permissions) |
| 收件者 | `Recipients.setAsync` 覆蓋完整名單；每次最多 100 位；`getAsync` 只回傳已解析收件者 | [Office.Recipients](https://learn.microsoft.com/en-us/javascript/api/outlook/office.recipients?view=outlook-js-1.5) |
| 主旨 | `Subject.getAsync` / `setAsync` 讀寫目前草稿主旨，最大 255 字元 | [Office.Subject](https://learn.microsoft.com/en-us/javascript/api/outlook/office.subject?view=office-js) |
| HTML 內文 | 檢查 `getTypeAsync`；首次 `prependAsync`；需要替換時先讀取並保留其他區域，`bodyMode` 使用一致的 `HostConfig` 範圍 | [Get or set the body](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/insert-data-in-the-body)、[Office.Body](https://learn.microsoft.com/en-us/javascript/api/outlook/office.body?view=office-js) |
| HTML 宿主正規化 | `getAsync` 回傳 HTML 不保證等於先前 `setAsync` 的原字串；定位失敗就停止，不假設任意 HTML 標記必然保留 | [Office.Body](https://learn.microsoft.com/en-us/javascript/api/outlook/office.body?view=office-js) |
| 每封草稿追蹤 | `loadCustomPropertiesAsync` 與 `CustomProperties.saveAsync` 保存目前郵件的模板辨識狀態 | [Office.CustomProperties](https://learn.microsoft.com/en-us/javascript/api/outlook/office.customproperties?view=office-js) |
| 釘選 | `VersionOverrides` 1.1 中 `SupportsPinning`；Mailbox 1.5；Microsoft 365 支援的 compose 模式，Outlook.com 不支援 | [Implement a pinnable task pane](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/pinnable-taskpane) |
| 切換草稿 | 釘選窗格以 `ItemChanged` 重新判斷當前項目，處理 null / 非撰寫狀態 | [Implement a pinnable task pane](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/pinnable-taskpane) |
| 一次性側載 | `aka.ms/olksideload` → My add-ins → Custom Addins → Add from File；不使用已移除的 Add from URL | [Sideload Outlook add-ins for testing](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/sideload-outlook-add-ins-for-testing) |
| 新版 Outlook 日常入口 | 撰寫郵件的 Message 頁籤，或 Apps 中選已安裝增益集；位置由 Outlook 控制 | [Use add-ins in Outlook](https://support.microsoft.com/en-us/outlook/getstarted/use-add-ins-in-outlook) |
| HTTPS 開發憑證 | 使用 Microsoft `office-addin-dev-certs` 工具生成並信任 localhost 憑證 | [Office Add-in localhost certificate sample](https://learn.microsoft.com/en-us/samples/officedev/office-add-in-samples/excel-add-in-hello-world/) |
| 正式部署 | 將網站資源部署到 HTTPS 主機，再更新 manifest URL 並分發；manifest 不會內含整個網站 | [Develop Office Add-ins with Visual Studio — Publish](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/develop-add-ins-visual-studio#publish-the-add-in) |

## 適用範圍與限制

本版 manifest 以 Mailbox 1.3 作為基本需求，釘選覆寫宣告 Mailbox 1.5。公司版目標為 Windows 新版 Outlook 與 Outlook for Mac，共用 XML 與 HTTPS 部署；Windows 傳統版與網頁版列入相容性測試。這不代表所有支援這些 requirement set 的用戶端已完成驗證，實機狀態見 [驗收表](OUTLOOK-ACCEPTANCE.md)。手機撰寫入口不在本版範圍。

`Body.getAsync`／`setAsync` 的 `bodyMode` 在 Mac 與傳統 Windows 被忽略。公司範本套用仍須保留 API 回傳的模板外內容，並在無法辨識受管理區域時停止；不得假設跨平台回覆的 HTML 範圍與標記一致。[Microsoft Body API](https://learn.microsoft.com/en-us/javascript/api/outlook/office.body?view=office-js)

Office.js 沒有跨所有草稿欄位的交易式提交，也不能鎖住使用者正在輸入的內容。程式用前後檢查、單次套用鎖定與逐項結果處理來降低衝突；套用期間仍應暫停手動編輯。`Recipients.getAsync` 無法列出尚未解析的輸入，故文件要求先按 Tab 完成輸入。

個人模式使用本機 `localStorage`，非 Microsoft 信箱漫遊設定；不宣稱跨裝置同步。公司範本則由中央服務提供已發佈版本，來源、權限與更新流程見 [公司服務](COMPANY-SERVICE.md)。草稿自訂屬性僅用於同封郵件追蹤。
