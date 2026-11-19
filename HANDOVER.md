# 接手說明（2026-11-19）

這份文件給接手「寄信模式」Outlook 增益集的同事。先讀這份，再依需要看 [README](README.md) 與 `docs/`。

## 這是什麼

Outlook 撰寫郵件時的工作窗格增益集。同事選公司範本、填欄位、預覽，插入**目前草稿**，最後自己按「傳送」。

- 前端：Office.js + TypeScript + React（Vite 建置），一份 XML manifest，目標為 Windows 新版 Outlook、Mac Outlook、Outlook 網頁版。
- 後端：Node.js 範本服務（`server/`），驗證 Entra 公司帳號，範本庫存在 SharePoint（或主機檔案）。
- 兩種模式並存：
  - **公司範本（1.7，主線）**：中央發布，所有人共用。
  - **個人模式（1.6 以前）**：每台電腦 localStorage，不跨裝置同步。

架構圖：[docs/diagrams/寄信模式_部署架構圖_v1.png](docs/diagrams/寄信模式_部署架構圖_v1.png)

```
同事 Outlook → HTTPS 公司主機上的面板 → Entra 公司帳號登入
  → Node 範本服務驗證 token → 用憑證（Sites.Selected）讀 SharePoint 的 catalog-state.json
  → 插入目前草稿 → 同事自己寄出
```

## 目前進度

| 項目 | 狀態 |
|---|---|
| 1.7 程式與自動化測試 | 完成（單元、server、Playwright e2e 皆用 Office.js 模擬） |
| 部署資料包 `SendModes-Deploy-1.7.0.zip` | 已交給公司 IT（Hank Yu），由他的 AI 照 `deploy-kit/AI-TASK.md` 執行 |
| 真實租戶部署（Entra、SharePoint、主機、M365 分配） | **尚未完成**；`deploy-kit/entra/*.ps1` 未在真實租戶跑過 |
| Windows／Mac Outlook 實機驗收 | **尚未完成**，依 [docs/OUTLOOK-ACCEPTANCE.md](docs/OUTLOOK-ACCEPTANCE.md) |

只有 IT 能設定 Entra、M365 與主機；範本要不要發布由 IT 決定。

## 待辦

1. 等 IT 選部署方案（見下表）。
2. 「內部 IT 需求／權限申請」範本主旨結尾寫死了原需求者名字，發布前要改（`outlook-templates/templates.json`）。
3. 真實租戶部署後，做 Windows 新版 Outlook 與 Mac Outlook 試行驗收，結果更新到 [docs/VERIFICATION.md](docs/VERIFICATION.md)。
4. 若 IT 選方案 C，需新做「範本內建、免伺服器」版本與新資料包（尚未開始）。

| 方案 | 成本 | 取捨 |
|---|---|---|
| A. 完整版 + 公司內網主機（IIS/nginx） | 不額外付費 | IT 要顧主機；外出需 VPN |
| B. 完整版 + Azure App Service（Linux B1） | 約台幣 400–600／月 | 不用顧主機；預設對外 |
| C. 簡化版：範本內建、Azure Static Web Apps 免費版 | 0 元 | 無登入權限控管；改範本要換檔案；需改程式 |

已回答過 IT 的問題（反向代理、內網外出、App Service 費用）記錄在 [docs/對話交接-2026-11-19.md](docs/對話交接-2026-11-19.md)。

## 開發環境

需要 Node.js 22.12 以上（建議 24 LTS）與 npm。

```powershell
npm ci
npm run typecheck
npm test                 # vitest 單元測試
npm run test:server      # 範本服務測試
npx playwright install chromium
npm run test:e2e         # 瀏覽器 UI 測試（模擬 Office）
```

不需公司帳號就能試跑公司版（真實 API、模擬登入與草稿）：

```powershell
npm run build:company
npm run demo:company     # 開 http://127.0.0.1:4175
```

在真的 Outlook 裡側載開發版（`https://localhost:3443`）：

```powershell
npm run certs:install
npm start
```

再到 <https://aka.ms/olksideload> → Add from File → 選 `manifest.xml`。詳見 [docs/INSTALL.md](docs/INSTALL.md)。

## 打包給 IT

```powershell
npm run build:company
powershell -File scripts/package-company.ps1 -ProductionOrigin https://正式網址   # 產生 release/SendModes-Company-1.7.0.zip
powershell -File scripts/package-deploy-kit.ps1                                  # 產生 release/SendModes-Deploy-1.7.0.zip
```

`release/`、`dist/` 是建置產物，不進 git。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `src/` | 工作窗格前端（React）。`company-*.ts`、`components/Company*.tsx` 是公司版；`draft.ts`、`body.ts` 處理草稿插入 |
| `server/` | Node 範本服務：Entra token 驗證、角色權限、範本庫（file／SharePoint） |
| `outlook-templates/` | 4 份原始範本（HTML + `templates.json`），`npm run build:company` 與 `import:company` 會讀 |
| `deploy-kit/` | 給 IT 的部署包原始檔：`AI-TASK.md`、Entra／SharePoint 設定腳本、部署檢查工具、設定檔範本、Entra 用 logo |
| `scripts/` | 建置、打包、本機示範、manifest 產生工具 |
| `installer/` | 1.6 舊版 Windows 本機安裝包（NSIS + 內建 Node）。公司版不需要；保留給仍在用舊版的人 |
| `tests/` | 單元、server、e2e 測試；`tests/local-demo/` 是本機示範用的模擬 Outlook |
| `docs/` | 部署、驗收、設計與驗證紀錄 |
| `public/` | 靜態資源與圖示（目前使用 `mail-felt-*`） |
| `manifest.xml` | 開發用 manifest（localhost）。正式版用 `npm run manifest:production` 產生，不要直接上傳這份 |

## 不能改變的規則

完整版本見 [AGENTS.md](AGENTS.md)（若用 AI coding agent，它會自動讀取）。

- 只操作目前草稿；**絕不寄信**；不加 Graph 讀信／寄信權限。登入只取得本專案範本 API 的 scope。
- 公司範本與個人 localStorage 設定分開；插入前重新確認範本仍已發布；角色與閱讀範圍由伺服器檢查。
- 不上傳已填欄位或草稿內容到範本 API。
- 保留簽名、既有內容與回覆歷史；找不到安全位置就停止，不猜測。
- 回報時區分「模擬測試通過」與「真實 Outlook 驗收」。
- 繁體中文介面保持精簡。

## 注意

- 此 repo 包含公司同事的 Email（範本收件者、測試資料），請保持**私人 repo**。
- 不要把 `.env`、`*.pem`、`*.pfx` 或任何真實租戶 ID 以外的祕密放進 repo（`.gitignore` 已排除）。
- `.memory/` 是原作者的 AI 記憶檔，不在 repo 裡；接手後不需要。
