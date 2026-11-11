# 第一階段：集中度與收盤通知（後端契約）

## 範圍與護欄

- 集中度純函數：`functions/concentration.js::calculateConcentration(snapshot)`。
- 分母僅為**持股市值合計**，不含現金、不拿成本、總資產或每日紀錄差額代替市值。依代號合併重複持倉後排序。
- 單檔 **>30%** 或前三大 **>60%** 才超標，恰等於不警示。即使只有一檔，前三大就是現有持股的合計。
- 跌幅預設 **3%**（組合與個股各自設定）；恰等於會通知。不是投資建議，不交易、不修改持股。
- 不新增 cron、不動記帳或 14:00 自動記帳、不改 MCP／OAuth 驗證、不新增 AI 呼叫。

## 價格、幣別與資料不足

從 `portfolio-sync` 的 `summary.holdings`（symbol、shares）與 `dataset.livePrices.map` 計算；只讀快照，不額外打報價或付費服務。現價優先；缺價時可接受持倉的 `marketValue`／`currentValue`，但絕不使用 `costBasis`。

數字開頭為台股，其他為美股（沿用現有分類）。美股現價是 USD，必須有可用的 `USDTWD` 才換算。保存的美股市值只有明示 `marketValueCurrency: "TWD"` 才可直接使用，否則視為 USD 並要求匯率。

缺價、缺匯率、stale／failed 報價、無效股數：`status: "insufficient_data"`、`label: "資料不足"`，列出 `missingSymbols`，所有比例、完整總市值與 breach 均為 null。可列出已涵蓋持倉市值，但不能把它顯示為完整組合。空持股也不是健康的 0% 組合。

API 明示 snapshot／quote 時點；`complete` 只代表估值完整，不代表即時。集中度通知另外要求快照與各市值時點在當天台北 13:30 之後。沒有市值時間的保存值用同步時間作為快照時間，來源仍標示 `saved_market_value`。

**現有快照的限制**：App 的美股報價／匯率不一定同步在這個 map。此時明示資料不足，不拿其他來源偷偷補值。收盤跌幅沿用現有台股判斷：有美股持股即不發「全組合跌幅」，也不發美股個股跌幅；完整且新鮮的台股個股仍可發類別通知。擴充美股收盤資料屬後續工作。

## 唯讀 API／MCP（給 G洛）

`GET /api/portfolio-risk`，`Authorization: Bearer <App 同步 token>`；不接受 query token，不提供 POST。沿用 portfolio-sync 隔離；SI Hub 唯讀金鑰只映射明確設定的擁有者，不讀最新寫入者。回應 `Cache-Control: no-store`。

MCP 新工具 `portfolio_risk`，輸入 `{}`，`readOnlyHint: true`，`structuredContent` 與 API JSON 完全相同；既有 `/mcp` 路由與 OAuth 驗證不改。

以下全部是假資料範例（未連正式帳號）：

```json
{
  "ok": true,
  "found": true,
  "reason": null,
  "concentration": {
    "status": "complete", "label": "持股集中度", "reason": null,
    "source": "portfolio_sync", "asOf": "2026-11-11T05:40:00.000Z",
    "quoteAsOf": "2026-11-11T05:40:00.000Z",
    "currency": "TWD", "basis": "equity_holdings_market_value",
    "thresholds": {"singlePct": 30, "top3Pct": 60},
    "missingSymbols": [], "totalMarketValueTwd": 100,
    "holdings": [{"symbol": "2330", "market": "TW", "marketValueTwd": 100,
      "asOf": "2026-11-11T05:40:00.000Z", "source": "snapshot_quote", "weightPct": 100, "exceedsSingle": true}],
    "top3": {"symbols": ["2330"], "weightPct": 100, "exceeds": true},
    "markets": {"twPct": 100, "usPct": 0}, "breaches": {"single": true, "top3": true}
  },
  "notifications": {
    "updatedAt": "2026-11-11T06:00:00.000Z", "sourceSyncedAt": "2026-11-11T05:40:00.000Z",
    "alerts": [{"schema_version": 1, "event_id": "concentration:single", "source": "New-version-stack-app",
      "event_type": "concentration_single", "severity": "warning",
      "summary": "A holding crossed the single-position concentration threshold.", "occurred_at": "2026-11-11T06:00:00.000Z"},
      {"schema_version": 1, "event_id": "concentration:top3", "source": "New-version-stack-app",
       "event_type": "concentration_top3", "severity": "warning",
       "summary": "The top three holdings crossed the concentration threshold.", "occurred_at": "2026-11-11T06:00:00.000Z"}],
    "line": {"sent": ["concentration_single", "concentration_top3"], "withheld": [], "failed": [], "skipped": null},
    "decline": {"reason": "no_breach", "invalidThresholds": []}
  },
  "disclaimer": "僅供自我追蹤，非投資建議；快照非即時行情。"
}
```

UTC 字串由 UI 轉為台北時間顯示；上述快照為台北 13:40，排程為 14:00。

MCP request 範例：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"portfolio_risk","arguments":{}}}
```

缺資料例：`concentration.status = "insufficient_data"`、`missingSymbols = ["USDTWD", "VOO"]`、`totalMarketValueTwd = null`、`top3.weightPct = null`、`markets.twPct = null`、`breaches.single = null`。`found:false` 時也不能當 0%／沒有風險。

`notifications.alerts` 是**最後一次成功收盤掃描當時**的類別警示，不是即時推播串流；請同時顯示 `updatedAt`／`sourceSyncedAt`，不要把舊掃描當成今天。集中度當前狀態用 `concentration.breaches`。四種事件：`portfolio_day_decline`、`stock_day_decline`、`concentration_single`、`concentration_top3`。App 若需 toast 去重，以 event_id＋occurred_at 為鍵；冷卻內 occurred_at 不變。UI 仍待 G洛 接線，這個 PR 不改畫面。

## 通知與運維

僅既有 14:00 收盤 cron 處理擁有者 App／LINE；08:00 舊 webhook 與盤中 cron 行為不變。擁有者只由 `LINE_REMINDER_SYNC_TOKEN` 指定，不掃其他使用者資料後送到擁有者 LINE。

沿用 `auto-daily.js::pushLine` 與相同 LINE 收件人。不足設定時不送，將固定原因 `line_not_configured` 記在 App 可讀狀態；沒有 owner token 時回傳 `owner_not_configured`。LINE 摘要只說事件類別，不帶代號、金額、股數、帳戶或同步 token。是否擴大摘要內容需另請老大決定。

App／LINE 各有獨立冷卻，不因 App 已記錄就吞掉 LINE 重試。20 小時冷卻、45 秒 lease、失敗至少隔 15 分鐘重試、最多 3 次；集中度穩定 id 失敗滿 3 次後，下一個 20 小時週期可再試。每個通道最多保留 40 個事件紀錄，KV 14 天 TTL。送 LINE 前先存 lease；狀態寫入失敗不送。LINE timeout 3 秒／非 2xx／網路錯誤只記固定類別與狀態，不影響 App 或其他 cron。KV 不是交易，重疊 cron 仍可能重複，不保證 exactly-once。

### 部署前由老大確認（本 PR 未設定任何環境值）

- 既有 binding：`health_kv`。
- 沿用 LINE secrets：`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`、`LINE_REMINDER_SYNC_TOKEN`；確認指向正確擁有者與收件人。缺任一必要項目安全跳過。
- 可選門檻覆蓋名稱：`PROACTIVE_PORTFOLIO_DECLINE_PCT`、`PROACTIVE_STOCK_DECLINE_PCT`。未設／空白走核准預設；非正數、超過上限或格式不對則關閉該項並只記名稱。
- 舊金額門檻 `PROACTIVE_PORTFOLIO_DECLINE_TWD`、`PROACTIVE_STOCK_DECLINE_TWD` 不再觸發。
- 舊 webhook 的 `PROACTIVE_WEBHOOK_URL`、`PROACTIVE_WEBHOOK_KEY` 仍為選用，與 App／LINE 無關；若既有部署已啟用，跌幅預設會同時套到舊 webhook，部署前確認是否保留該通道。
- 不需要新增 OAuth secret。未讀取正式 secret、未試送正式 LINE、未部署，真實 LINE 及快照覆蓋率留待核准部署後驗證。

## 審查重點／回滾／未做

- 嚴格 >30/>60 與跌幅 >=3 的邊界、缺匯率／缺價 null、混合美股不冒充全組合跌幅。
- token 隔離、SI Hub 唯讀映射、僅 owner 推送、摘要隱私、通道獨立冷卻、KV 失敗 fail-closed。
- `/mcp`／OAuth、既有記帳和 14:00 順序完全不改。
- 回滾：由老大核准後 revert 此 PR 的 commit 並依既有流程部署；舊版不會讀 `portfolio-risk:v1:` key，其資料 14 天後自動到期，不需刪除既有資產資料。
- 未做 UI／樣式、新分頁、退休與現金流模擬、週報、盤中告警、美股收盤資料管線、LINE 正式試送與部署。退休假設仍未決定。

## 本機驗證

依 CI 使用 `ci/package-lock.json` 安裝相依套件後，`npm test`：**804 passed、0 failed、0 skipped**（Node v24.22.1）；`git diff --check` 通過。GitHub CI 使用 Node 20，PR 開立後另看 CI。測試涵蓋邊界、缺價／缺匯率、異常型別、權限隔離、App／MCP 一致、LINE 缺設定／失敗與冷卻；皆為假資料與 stub，未連正式 LINE。
