# Vercel Gemini 備援 v2.21.4

這個資料夾是存股 App 的獨立 AI 備援，可直接部署到 Vercel。

- `api/ask.js`：Gemini 3.5 Flash-Lite 備援入口
- `api/health.js`：健康檢查
- `lib/ask-core.js`：v2.21.4 工具呼叫核心
- 預設模型：`gemini-3.5-flash-lite`
- `thinkingBudget: 0`
- 保留 `query_app_data`、`get_live_quotes`、`web_search` 等工具流程
- Tavily 搜尋仍在伺服器端執行

必要環境變數：
- `GEMINI_API_KEY`

選用：
- `GEMINI_MODEL`
- `TAVILY_API_KEY`
- `APP_ORIGIN`
- `FALLBACK_ACCESS_TOKEN`

若 `GEMINI_MODEL` 還殘留 Gemini 2.x，`api/ask.js` 與 health 會自動回到 Gemini 3.5 Flash-Lite。
