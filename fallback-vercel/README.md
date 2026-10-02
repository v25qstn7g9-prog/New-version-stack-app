# Vercel Gemini 備援

這個資料夾是存股 App 的獨立 AI 備援，可直接部署到 Vercel。

- `api/ask.js`：Gemini 3.6 Flash 備援入口（把主程式呼叫的 `env.AI.run()` 轉成 Gemini 原生 API）
- `api/health.js`：健康檢查
- `lib/ask-core.js`：**`functions/ask.js` 的原封複本**，提示詞、工具、限制都跟主程式一樣
- 預設模型：`gemini-3.6-flash`，`thinkingLevel: minimal`
- Tavily 搜尋仍在伺服器端執行

## 維護方式

不要直接改 `lib/ask-core.js`。改主程式 `functions/ask.js` 之後，在專案根目錄執行：

```
npm run sync:fallback
npm run check:version
```

`npm test` 會檢查兩份是否一致，不一致就失敗。

必要環境變數：
- `GEMINI_API_KEY`

選用：
- `GEMINI_MODEL`
- `TAVILY_API_KEY`
- `APP_ORIGIN`
- `FALLBACK_ACCESS_TOKEN`

若 `GEMINI_MODEL` 還殘留 Gemini 2.x，`api/ask.js` 與 health 會自動回到 Gemini 3.6 Flash。
