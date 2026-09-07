# Vercel 獨立 Gemini 備援

這個資料夾要單獨部署成一個 Vercel Project。

必要環境變數：

- `GEMINI_API_KEY`

建議：

- `GEMINI_MODEL=gemini-3.5-flash-lite`
- `TAVILY_API_KEY=...`
- `FALLBACK_ACCESS_TOKEN=一段長亂碼`
- `APP_ORIGIN=https://你的Cloudflare網址`

部署後先開：

`https://你的Vercel網址/api/health`

如果有設定 `FALLBACK_ACCESS_TOKEN`，直接用瀏覽器開 health 會得到 401，這是正常的；請回 App「計畫設定 → AI 獨立備援」填 Token，再按「測試獨立備援連線」。

`api/ask.js` 不另外重寫投資邏輯，而是直接重用 `lib/ask-core.js`，再用一個相容的 `AI.run()` 介面把模型呼叫轉成 Google Gemini OpenAI-compatible API。因此工具規則、Tavily 搜尋迴圈、聊天人格與 Cloudflare 主 AI 保持同一套。
