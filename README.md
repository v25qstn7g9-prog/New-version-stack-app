# 存股資產追蹤 v2.21 — 獨立 AI 備援版

這包直接以你上傳的 **「存股App_最終版_無備援有搜尋」** 為底修改。原本的持股、交易、配息、即時股價、新聞、Tavily 網路搜尋、備份與計畫進度都保留；主 AI 仍是 Cloudflare Workers AI `@cf/openai/gpt-oss-120b`。

這版只做一個核心改變：**Gemini 備援不再放在 Cloudflare Worker 裡，而是放到另一個平台（Vercel）**。

## 為什麼這次是真正「不同條線」

原本同一個 Cloudflare Worker 裡：

`手機 → Cloudflare /ask → Workers AI`

即使再從 Cloudflare `/ask` 去叫 Gemini，入口仍然是 Cloudflare。

v2.21 改成：

`手機 → Cloudflare /ask → GPT-OSS`

Cloudflare `/ask` 額度用完、429、5xx、逾時或網路失敗時：

`手機 → Vercel /api/ask → Gemini 3.5 Flash-Lite`

因此 Gemini 備援的模型呼叫不會再經過 Cloudflare Workers AI。

---

## 專案結構

Cloudflare 主 App：

- `index.html`
- `worker.js`
- `wrangler.jsonc`
- `functions/ask.js`
- `functions/quote.js`
- `functions/news.js`
- `manifest.webmanifest`
- `_routes.json`

獨立備援：

- `fallback-vercel/api/ask.js`
- `fallback-vercel/api/health.js`
- `fallback-vercel/lib/ask-core.js`
- `fallback-vercel/package.json`
- `fallback-vercel/vercel.json`
- `fallback-vercel/.env.example`

---

# 第一步：Cloudflare 主 App

照你現在原本的方法部署根目錄即可。

Cloudflare 需要：

- AI Binding：`AI`
- Secret：`TAVILY_API_KEY`（若要網路搜尋）

`wrangler.jsonc` 的 Worker 名稱仍是：

`new-version-stack-app`

不用再放任何 Gemini API Key 到 Cloudflare。

---

# 第二步：部署 Vercel 備援

把 **`fallback-vercel` 資料夾本身** 當成一個獨立 Vercel Project 部署。

Vercel Environment Variables：

## 必填

`GEMINI_API_KEY`

到 Google AI Studio 建立 Gemini API Key。

## 建議保留預設

`GEMINI_MODEL=gemini-3.5-flash-lite`

這版預設使用正式版 `gemini-3.5-flash-lite`。

## 若要備援 AI 也能上網搜尋

`TAVILY_API_KEY`

如果不設定，Gemini 一般聊天／App 工具仍能用，但遇到 `web_search` 會提示 Tavily 未設定。

## 強烈建議：保護公開備援網址

在 Vercel 設定一段你自己產生的長字串：

`FALLBACK_ACCESS_TOKEN=你的長亂碼`

然後到 App：

**計畫設定 → AI 獨立備援 → 備援存取 Token**

填入完全相同的值。

這個 Token 只存在你的瀏覽器儲存空間，不會被放進 JSON 投資資料備份。

## 選填：限制來源網址

`APP_ORIGIN=https://你的Cloudflare網址`

例如：

`APP_ORIGIN=https://new-version-stack-app.workers.dev`

若你有自訂網域，可填自訂網域；多個網址用逗號分隔。

---

# 第三步：App 裡設定 Vercel 網址

Vercel 部署完成後會得到類似：

`https://stockapp-ai-fallback.vercel.app`

到 App：

**計畫設定 → AI 獨立備援**

把這個網址貼進「備援網址」。

不用自己補 `/api/ask`，App 會自動補。

然後按：

**測試獨立備援連線**

成功會看到：

`✓ 備援後端正常 · gemini-3.5-flash-lite`

---

# 私人資產資料保護

預設：

**「允許 Gemini 備援讀取 App 的持股／成本／資產資料」關閉。**

這時候 Gemini 備援可以：

- 一般聊天
- 公開時事
- Tavily 網路搜尋
- 公開個股即時價（仍透過 App 的 `/quote`）

但如果問題需要 `query_app_data` 把你的資產歷史送給 Gemini，App 會直接阻擋，不會偷偷傳送。

你若接受 Gemini 處理自己的投資資料，再把該選項打開即可。

注意：Google Gemini API 免費層依官方目前政策，免費層內容可能用於改善 Google 產品；這也是為什麼本版預設關閉私人資產資料備援。

---

# 實際切換邏輯

App 每一次問答都先試：

`/ask`（Cloudflare GPT-OSS）

只有以下狀況才改走 Vercel：

- Cloudflare /ask 網路失敗
- 401 / 403（AI 設定或授權問題）
- 408
- 429
- 5xx
- quota / neuron / 額度 / binding / timeout 類錯誤

正常回答時不會碰 Gemini。

AI 視窗上方會顯示：

- `GPT-OSS`
- 或 `Gemini 獨立備援`

---

# 功能相容性

Gemini 獨立備援保留跟 Cloudflare AI 相同的工具介面：

- `query_app_data`
- `get_live_quotes`
- `web_search`
- `add_trade`
- `update_holding_target`
- `update_manual_avg_cost`
- `update_goal`

所以不是另一個「只能聊天的 AI」。

它仍能要求 App 查自己的歷史資料、即時股價，也能提出記交易／改目標的工具動作；所有寫入動作仍必須由你按確認卡才會真正寫入。

---

# 已完成的離線驗證

本包製作時已測試：

- Cloudflare `functions/ask.js` JavaScript 語法
- Vercel `api/ask.js` JavaScript 語法
- Vercel `api/health.js` JavaScript 語法
- Gemini 一般文字回答回傳格式
- Gemini function calling → `get_live_quotes`
- Gemini → `web_search` → Tavily → Gemini 第二輪回答
- Provider 標記回傳為 `gemini-external`
- ZIP 完整性

未在本環境直接使用你的真正 API Key 呼叫 Google／Vercel，因此第一次部署後請先按 App 裡的「測試獨立備援連線」。
