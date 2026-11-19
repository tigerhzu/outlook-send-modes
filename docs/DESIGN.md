# 介面與圖示

## 1.6 最新設計與圖片保存

「常用地址」改稱「常用聯絡人」，首頁入口使用 Save 同款藍底白字；簽章為綠底白字按鈕，鉛筆保留在右側。

簽章貼上與 Save 共用 captureSignatureImages：先保留 Outlook originalsrc／data-attachment-id，再以目前草稿唯一 CID／附件 ID 讀取 Base64；支援舊 Outlook 圖片 URL 的 ID。VML 轉為 img，重複 fallback 不新增第二張。公開 HTTPS 圖片用無帳號 cookies 的請求讀取成資料再保存；無法取得時明確失敗，不儲存失效的圖片 URL。只讀目前草稿圖片，不猜檔名、不讀其他信件、不新增 Graph 認證。簽章單張 500 KB、總 HTML 750,000 字元限制保留。

依據：[Microsoft 內嵌附件與 contentId 說明](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/add-and-remove-attachments-to-an-item-in-a-compose-form)。貼上修正由模擬案例驗證，使用者原始剪貼簿 HTML 未取得，不能宣稱其實機案例已驗收。

## 1.5 歷史設計

To／CC 改成每人一個 Email 欄位，右側「＋」開啟新增一人、常用地址、管理常用。新增後聚焦輸入，× 刪除；貼上多個地址會拆成多列。常用地址入口位於首頁與編輯選單，不是強制先建聯絡人。常用名單為可選 favorites，選取只複製地址，不建立連動參照。保留簡短文字、白底與深藍按鈕。

Logo 依使用者指定採 **#221 · Tactile Felt & Knitted 3D Puppet**，索引作者／風格標籤 **OscarAI**。使用內建 image_gen，模型識別未公開（unknown），按畫廊技能傳入並使用 `221_grid.jpg` 作純風格參考。輸出為橘色信封，沒有延用參考人物。原圖 `public/icons/mail-felt-original.png`；等比例縮小為 `mail-felt-{16,32,48,64,80,128}.png`，manifest 與 favicon 使用新 URL。

中文提示：

> 风格名称：#221 · Tactile Felt & Knitted 3D Puppet。参考作者/风格名称：OscarAI。為 Outlook 寄信增益集製作一個橘色信封 App Logo。信封作為唯一辨識主體，置中且適合縮小顯示，使用乾淨淺色中性方形底，沒有文字或人物。所附图片仅用于参考画风。只提取参考图的风格特征，例如线条、笔触、媒介、材质、色彩倾向和整体视觉语言；不要使用、复制或延续参考图中的任何主体、人物、动物、服装、道具、动作、姿态、场景、背景、构图、布局、文字或故事。最终画面内容完全以用户提供的主题为准。

實際英文生成提示：

> Style name: #221 · Tactile Felt & Knitted 3D Puppet. Reference author/style name: OscarAI. Create an app logo depicting one orange mail envelope, for the Outlook compose add-in. Use case: logo-brand. The orange envelope is the single recognizable symbol, large and centered, suitable for small app icon sizes, on a clean light neutral square background. No text or characters. Use the attached image only as a style reference. Extract only its stylistic qualities, such as linework, brushwork, medium, material texture, color tendencies, and overall visual language. Do not use, copy, or carry over any subject, person, animal, clothing, prop, action, pose, setting, background, composition, layout, text, or story from the reference image. The user's written theme is the sole source for the image content.

提示可供其他影像 AI 使用，結果由該模型控制；本版已使用內建工具實際生成並整合。


## 1.4 歷史設計

移除模式與簽章裝飾圖示、名稱下方的主旨預覽，不替換為新裝飾。保留指定黑白插畫 app Logo。編輯頁頂端直接輸入模式名稱，To／CC 為自動增高的 Email 文字欄位，接受分號、逗號及換行；不使用聯絡人下拉選單、不保留聯絡人管理頁或重新命名步驟。

Settings v2 的模式直接保存地址陣列。v1 載入／備份匯入時轉換參照，儲存 key 不變；不在載入時覆寫舊資料。空白舊收件者仍會阻擋套用，尤其不能默默漏掉 CC。重複地址不分大小寫去重、To 優先；各模式地址獨立。


## 1.3 歷史設計

使用者否定整片彩色底，並指定直接使用黑白溫室插畫作 Logo。原圖保存於 `public/icons/illustration-original.png`；不重繪、不拉伸、不裁掉構圖，以深灰留邊等比例輸出 `illustration-{16,32,48,64,80,128}.png`。manifest 和 favicon 改用全新圖示檔名以避開既有虎頭圖示網址快取。

模式採白底細框卡片，小型鐘面／房屋／信件圖示提供用途辨識；標題維持深灰，按鈕統一深藍。To／CC 與套用並排，移除整片琥珀、綠、紫底色。600px 以上雙欄、以下直排；簽章為簡單白底操作列。編輯器工具列及模式選擇改中性色，維持簡短文字、偏粗正黑體和 Save 流程。

## 1.2 歷史設計（已替換）

使用者要求從自己的畫廊挑選風格重設 Logo，選用 **#062 Ultra-Geometric Nature Character / Charley Harper**，使用 `062.png` 作風格參考（unknown image model，依技能使用參考圖）。以內建 image_gen 生成；原圖存於 `public/icons/tiger-geometric.png`，發布圖示為 `public/icons/icon-{16,32,48,64,80,128}.png`。原 1.1 圖示原圖留存，但不再用於介面。

首頁不顯示 app 自己的品牌標題列，設定放在列表下方；宿主列屬 Outlook。少量功能配色：加班琥珀、居家綠、自訂藍、簽章紫。文字仍為主要標示，不僅依靠顏色。維持白底、小圓角及無玻璃效果。

中文提示：風格名稱：#062 · Ultra-Geometric Nature Character。參考作者／風格名稱：Charley Harper。為 Outlook 寄信模式設計幾何老虎頭 Logo，深綠底配琥珀色，縮小後仍能辨識。

實際英文生成提示：

> Style name: #062 · Ultra-Geometric Nature Character. Reference author/style name: Charley Harper. Create one production logo for a small tiger themed Outlook compose add-in. A highly simplified, confident, geometric tiger head emblem, centered, bold silhouette recognizable at 16px and 48px beside corporate software brand icons. Flat two-color design: deep forest teal square background (#164C48) with a warm amber (#F1B35B) tiger head symbol and deep teal negative-space stripes and facial marks. Broad geometry, no tiny details, no text. The tiger symbol fills about three quarters of the tile. A distinctive visual brand mark, not an emoji or a toy. Entire square tile is one solid color, with no white border, no bevel, no gradient, no glossy surfaces, no shadows, no 3D rendering. Output only the square app icon, no surrounding presentation. Use the attached image only as a style reference. Extract only its stylistic qualities, such as linework, brushwork, medium, material texture, color tendencies, and overall visual language. Do not use, copy, or carry over any subject, person, animal, clothing, prop, action, pose, setting, background, composition, layout, text, or story from the reference image. The user's written theme is the sole source for the image content.

## 先前版本紀錄

- 最新要求（2026-11-14）：使用者明確否定 iOS UI，先前玻璃／膠囊風格已淘汰。現在使用白底、細線分隔、小圓角矩形按鈕與微軟正黑體 UI 優先的字型；沒有漸層、霧面、光暈或動畫裝飾。小老虎圖示沿用。
- 編輯頁改成緊湊郵件格式：模式下拉選單 → To／CC 姓名選擇 → 主旨 → 內文。右上角「⋯」集中聯絡人、新增、重新命名、匯出／匯入與刪除；聯絡人另頁編輯，返回不丟失模式的未存變更。名稱欄位僅新增／重新命名時顯示。
- 內文工具列只保留 B／I／U（簽章另有圖片），其他表格及 HTML 操作收進「⋯」。編輯區的表格格線只作編輯輔助，不寫入模板或改動既有郵件。
- Save 固定於編輯頁頂端，成功返回列表，失敗保留內容。未儲存返回仍確認捨棄。
- 簽章容器預設空白，由使用者自行貼上，沒有內建個人或公司內容。
- 以內建 image_gen 生成圖示，未使用編號風格參考圖。原圖：`public/icons/tiger-original.png`；發布尺寸：`public/icons/icon-{16,32,64,80,128}.png`。尺寸衍生以 System.Drawing 高品質縮放，沒有重畫圖示。

生成提示：

> Create a finished app icon asset for an Outlook compose add-in. A small friendly tiger face, iconic and extremely simple, inspired by the polish and restraint of Apple iOS app icons. Centered frontal orange tiger cub head, two round ears, creamy muzzle, dark simple eyes and a few bold dark stripes. Gentle dimensional soft glass/clay rendering, refined subtle highlights, not furry, no realistic details. Light warm ivory rounded-square app tile, subtle translucent glass edge, fills nearly the entire square. Face large and clear even at 16px. No text, no letters, no Apple logo, no envelope, no extra objects. Square composition. This is the production app logo, not a mockup or a phone screen.

技術依據：

- [Microsoft 工具列命令變更](https://devblogs.microsoft.com/microsoft365dev/prepare-your-addin-for-outlook-ribbon-improvements/)
- [Microsoft 內嵌附件 API](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/add-and-remove-attachments-to-an-item-in-a-compose-form)
- [2026 內嵌附件 ID 行為](https://devblogs.microsoft.com/microsoft365dev/changes-to-attachment-ids-for-inline-images-in-outlook-add-ins/)
