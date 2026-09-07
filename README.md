# 存股資產追蹤 v2.20 — 雙 AI 備援／安全備份版

這包是以你 2026-09-07 的「存股App_加網路搜尋」版本為底升級，保留原本的即時股價、持股新聞、Tavily 網路搜尋、AI 工具呼叫與全部資產資料邏輯。

## 這版新增

### 1. 雙 AI 自動備援

- 主力：Cloudflare Workers AI `@cf/openai/gpt-oss-120b`
- 備援：Google Gemini `gemini-3.5-flash-lite`
- Cloudflare 發生免費額度、429、暫時性 5xx、容量或逾時類錯誤時，會自動改走 Gemini。
- AI 視窗上方會顯示目前實際使用 `GPT-OSS` 或 `Gemini 備援`。

### 2. AI 額度節省

以前每句聊天都可能把完整持股摘要與全部工具 schema 一起送進模型。v2.20 會先做輕量分類：

- 純聊天：不送個人持股 context，也不送工具 schema。
- 一般最新資訊：只開 `web_search`。
- 公開市場／股價問題：只開 `get_live_quotes` + `web_search`。
- 個人資產查詢：才帶持股 context + 唯讀查詢工具。
- 記交易／改目標等動作：才開完整工具組。

目的不是改回答邏輯，而是減少不必要的輸入 token / neurons。

### 3. Gemini 私人資料保護

Gemini 免費層可能依 Google 當期政策將內容用於改善產品，因此本版預設：

- 一般聊天、公開市場、網路搜尋：可以自動 Gemini 備援。
- 你的持股、成本、資產等私人 context：**預設不送 Gemini**。

如果你自己接受 Gemini 處理私人資產資料，再把環境變數：

`GEMINI_ALLOW_PRIVATE_CONTEXT=true`

設上去即可；否則 Cloudflare 額度耗盡時，私人資產題目會停在 Cloudflare，不會偷偷轉送。

### 4. JSON 備份提醒

- App 會記住最後一次 JSON 備份時間。
- 超過 7 天或從未備份，首頁上方會出現提醒。
- 「計畫設定 → 資料備份與還原」也會顯示上次備份日期。

### 5. 備份深度驗證

JSON 還原前不再只檢查「欄位存在」，還會檢查：

- 日期格式
- 股數／金額／成本是否為合法非負數
- 交易股數與成交價是否 > 0
- 買賣方向
- 目標金額／年份
- planSchedule 參數
- schema 是否比 App 新
- 重複 ID 與重複每日日期（提醒，不直接擋掉）

驗證失敗時不會覆蓋目前資料。

---

## 專案結構

- `index.html` — 前端 App
- `worker.js` — Cloudflare Worker 進入點
- `wrangler.jsonc` — Workers with Static Assets 設定
- `manifest.webmanifest` — PWA
- `_routes.json` — 保留相容檔
- `functions/quote.js` — 即時股價
- `functions/news.js` — 持股新聞
- `functions/ask.js` — AI / Tavily / Gemini 備援

## Cloudflare 必要設定

### A. Cloudflare Workers AI

Binding 名稱必須是：

`AI`

### B. Gemini 備援

到 Google AI Studio 建立 Gemini API key，然後在 Cloudflare Worker 的 Variables / Secrets 加入：

`GEMINI_API_KEY`

請用 Secret，不要把 key 寫進任何 `.js` / `.html` 或 GitHub repo。

如果接受 Gemini 處理私人持股 context，再額外設定一般環境變數：

`GEMINI_ALLOW_PRIVATE_CONTEXT=true`

不設定或設為其他值 = 私人資料 Gemini 備援關閉。

### C. Tavily 網路搜尋

若要保留目前的「上網搜尋」功能，Secret：

`TAVILY_API_KEY`

不設定 Tavily 時，其他 AI 與資產功能仍可使用，只是 `web_search` 會提示尚未設定。

## Wrangler 部署

若使用 CLI：

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler deploy
```

私人 Gemini 備援若要開啟，可在 Cloudflare Dashboard 加 `GEMINI_ALLOW_PRIVATE_CONTEXT=true`，或自行加入 wrangler vars。

## GitHub 部署

把解壓後的內容放到 repo 根目錄，讓 Cloudflare Worker 連 GitHub 部署即可。這包是 **Workers with Static Assets** 架構，真正的入口是 `worker.js`，不是舊式 Pages Functions 自動偵測模式。

## 升級注意

- 不會改動你現有的 localStorage / window.storage 資料格式。
- `BACKUP_SCHEMA_VERSION` 維持 2，舊 schema 1 仍相容。
- 首次開 v2.20 看到「尚未記錄 JSON 備份」是正常的；按一次 JSON 備份後就會開始計時。
- ZIP 內沒有任何 API key。
