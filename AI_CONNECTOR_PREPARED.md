# 獨立 AI 資產連接器（預備完成，尚未啟用）

目前狀態：**PREPARED / OFF**

目的：未來讓 Claude／其他 AI 直接把「資產存股 App」當成獨立工具，不再必須經過 Atlas／訓練 App 中轉。

已準備：
- `functions/ai-connector-prepared.js`
- MCP-style 唯讀工具 `asset_summary`
- MCP-style 唯讀工具 `portfolio_live_snapshot`
- `portfolio_live_snapshot` 會把同步持股與現有 `/quote` 行情合併，回傳各股最新價、市值、當日漲跌與可計算的合計。
- 缺報價時明確標記 partial，不補猜數字。
- 不硬編 token / secret。

刻意尚未做：
- **沒有** import 到 `worker.js`
- **沒有**新增 `/mcp` 或任何公開路由
- **沒有** OAuth metadata / authorize / token endpoint
- **沒有**連 Claude
- **沒有**改 Atlas 現有中控路線

未來啟用順序：
1. 加獨立 OAuth/授權 adapter。
2. adapter 驗證後，把使用者的 portfolio sync token 以 `context.syncToken` 傳給 `handlePreparedAssetMcp()`。
3. 才在 `worker.js` 掛獨立 MCP 路由。
4. 先以第二條 Claude connector 測試；Atlas 原路線保留。
5. 確認穩定後，才考慮移除 Atlas 的資產中轉。

安全原則：未經授權不可直接讀 `portfolio-sync`；不要為了方便把私人資產 API 改成公開。
