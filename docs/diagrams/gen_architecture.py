# -*- coding: utf-8 -*-
"""寄信模式 1.7 公司部署架構圖。執行：python gen_architecture.py <out.svg>"""
import os
import sys

KIT = os.environ.get("ARCH_DIAGRAM_SCRIPTS")
if KIT:
    sys.path.insert(0, KIT)
from svgkit import Diagram

d = Diagram(1800, 1050, brand="Freedom Systems", date="2026-11")
C = d.C

d.header("寄信模式  Outlook 增益集公司部署架構",
         "同事在 Outlook 選公司範本、插入目前草稿｜範本集中存放於 SharePoint，由公司主機統一提供", logo=True)

# ---- 同事電腦 ----
d.container(60, 150, 400, 780, "同事電腦", theme="neutral")
d.group(85, 205, 350, 560, "Outlook", "Windows 新版 · Mac · 網頁版", theme="neutral")
d.box(105, 270, 310, 230, "寄信模式面板",
      ["撰寫郵件 → 應用程式 → 寄信模式", "選範本 · 填欄位 · 預覽", "範本管理者也在這裡發布"], C.web, 18)
d.box(105, 595, 310, 150, "目前草稿",
      ["插入範本內容", "保留簽名與回覆歷史", "同事自己按傳送"], C.client)
d.label(260, 815, ["不用安裝 EXE 或 Node.js", "增益集本身就是公司主機上的網頁"], bg=False)

# ---- Microsoft 365 租戶 ----
d.container(640, 150, 1100, 400, "公司 Microsoft 365 租戶", theme="customer", note="IT 管理員設定")
d.box(670, 380, 280, 110, "M365 管理中心", ["整合式應用程式", "XML 只分配給試行名單"], C.ms)
d.group(990, 205, 420, 325, "Microsoft Entra ID", "3 個 App · 不需要 client secret", icon="entra-id")
d.box(1010, 270, 380, 68, "登入 SPA", ["同事登入後發出通行證"], C.identity)
d.box(1010, 352, 380, 68, "範本 API", ["Templates.Read · Editor / Publisher 角色"], C.identity)
d.box(1010, 434, 380, 68, "SharePoint 後端", ["Sites.Selected · 只能寫一個網站"], C.identity)
d.box(1440, 250, 280, 210, "SharePoint 專用網站",
      ["catalog-state.json", "草稿 · 已發布 · 歷史版本", "只有 IT 成員能進入"], C.data)

# ---- 公司 HTTPS 主機 ----
d.container(640, 630, 1100, 300, "公司 HTTPS 主機（IT 架設）", theme="green", note="Node.js 22 · 開機自動啟動")
d.box(670, 700, 280, 130, "固定 HTTPS 網址", ["https://公司網址（待定）", "受信任憑證 · 反向代理"], C.web)
d.hero(1000, 690, 420, 150, "寄信模式 範本服務", ["面板網頁 · 範本 API", "核對身分與角色才給資料"], icon="cube", title_size=21)
d.box(1460, 700, 260, 130, "主機祕密", [".env 設定", "SharePoint 憑證私鑰", "只放主機，不外傳"], C.security)
d.footer_note(1190, 905, "同事只連這一個網址；範本由主機代為讀寫 SharePoint，同事不直接存取", theme="green")

# ---- 連線 ----
d.arrow([(670, 435), (415, 435)])
d.label(542, 418, ["① 分配 XML", "出現按鈕"])
d.arrow([(415, 304), (1010, 304)], dashed=True, both=True)
d.label(712, 292, ["③ 公司帳號登入 → 取得通行證"], future=True)
d.arrow([(415, 485), (550, 485), (550, 765), (670, 765)], both=True)
d.label(550, 610, ["② 開啟面板網頁", "④ 帶通行證讀範本"])
d.arrow([(260, 500), (260, 595)])
d.label(275, 553, ["⑤ 插入"], anchor="start")
d.arrow([(950, 765), (1000, 765)], both=True)
d.arrow([(1460, 765), (1420, 765)])
d.arrow([(1200, 690), (1200, 530)], dashed=True)
d.label(1215, 595, ["核對通行證", "用憑證換 SharePoint 權杖"], anchor="start", future=True)
d.arrow([(1400, 690), (1400, 600), (1580, 600), (1580, 460)], both=True)
d.label(1590, 588, ["④ 讀寫範本庫"], anchor="start")

d.legend(1300, 975, solid="資料 / 服務流向", dashed="登入與權杖（授權）", brand_line=False)
d.label(60, 985, ["XML 只是說明卡：告訴 Outlook 按鈕名稱、圖示，以及要開哪個網址"], anchor="start", bg=False)
d.save(sys.argv[1] if len(sys.argv) > 1 else "arch.svg")
print("ok")
