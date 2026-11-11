# 主動異常 webhook

這份文件描述既有選用 webhook；第一階段新增的擁有者 App 內＋LINE 管線另見 [portfolio-risk.md](./portfolio-risk.md)。Webhook 接收端與正式通知尚未驗證，兩個 webhook Secret 缺一個時只停用 webhook，不影響 App／LINE 管線。

它不預測、不建議買賣、也不下單。既有 webhook 的跌幅通知保持 opt-in，投資組合與個股門檻獨立，可用百分比或 TWD 金額啟用；未設門檻不送該類跌幅事件。老大核准的預設 3% 只適用 App／LINE，不套用到舊 webhook，也不做門檻遷移。

## 共同契約

`POST` JSON，標頭 `X-Proactive-Key`（值是 Secret `PROACTIVE_WEBHOOK_KEY`）。

```json
{
  "schema_version": 1,
  "event_id": "stable-string",
  "source": "New-version-stack-app",
  "event_type": "portfolio_day_decline",
  "severity": "warning",
  "summary": "Portfolio same-day price change crossed a configured decline threshold.",
  "occurred_at": "2026-10-05T06:00:00.000Z"
}
```

- `severity` 只會是 `info`、`warning`、`critical`。這支 App 目前不送 `critical`。
- `source` 固定是 `New-version-stack-app`。
- `occurred_at` 是這次排程觀察到事件的 UTC 時間。
- `summary` 只描述類別。不含股票代號、股數、價格、金額、帳戶、同步 token、金鑰或原始交易內容。
- 正文也不含這些欄位。金鑰只放在標頭。

網址是 Secret `PROACTIVE_WEBHOOK_URL`。必須是 `https`。帳號密碼、`?query`、`#hash` 都會被拒。不跟隨重新導向（`redirect: manual`，3xx 當成失敗）。逾時 3 秒。不讀回應本文。

兩個 Secret 缺一個、金鑰短於 16 字、或網址不合格：webhook 掃描直接結束，不讀其 KV、不連線；擁有者管線獨立。

## 什麼時候會跑

只用已經存在的 Cloudflare cron，沒有新的排程；新增的 /api/portfolio-risk 是需要同步 Bearer token 的唯讀端點。

| 既有 cron | 台北時間 | 這支程式做什麼 |
| --- | --- | --- |
| `0 0 * * *` | 每天 08:00 | 待確認交易、AI／報價品質卡片、分 K 收集失敗、同步過舊 |
| `0 6 * * MON-FRI` | 週一到週五 14:00 | 上面全部，再加上單日跌幅 |
| `* 1-5 * * MON-FRI` | 盤中每分鐘 | 不跑。避免額外 KV 寫入，也不把盤中波動當成單日跌幅 |

呼叫放在該次排程原本的工作之後，自己的 `try/catch` 裡。Webhook 或掃描失敗只留下固定的一行日誌，不會讓自動記帳、推播、健康檢查或 `/api/portfolio-sync` 失敗。

待確認交易若在 08:00 之後才出現，最快要到當天 14:00 才看得到；週末則要到下一次 08:00。這不是即時通知。

## 單日跌幅

比較的是「每檔（現價 − 昨收）× 股數」的加總，和 App 首頁在報價完整時的今日損益同一套算法。不是「今天總資產 − 昨天那筆每日紀錄」，因為後者會把出入金算進去。

個別持股用同一套價差，單獨跟「個股門檻」比。投資組合過門檻、但沒有任何一檔個股過門檻時，只送投資組合事件；反過來只送個股事件。個股事件一天最多一筆，不寫出是哪一檔。

要同時成立才會評估：

- 這次是 14:00 的收盤排程，而且台北時間已過 13:30。
- 不是週末。證交所行事曆明確說休市，或行事曆查不到（`null`），都不猜、不送。
- 快照 `syncedAt` 與 `livePrices.at` 都是今天，而且不早於 13:30。
- 每一檔要通知的報價：`priceSource` 是 `last`、不是過期、有真正的昨收、成交時間也是今天 13:30 之後。
- 投資組合必須每一檔台股都通過上面的檢查。缺一檔就不送投資組合事件（個股仍可只通知有完整報價的那幾檔）。

目前同步快照沒有美股即時報價與匯率（`usLivePrices` 沒有上傳）。只要有美股股數，就不把台股小計稱作投資組合跌幅。美股個股也不在這次範圍內。

大盤指數、從高點拉回、每日紀錄差額，都不是這次的事件。

### 門檻

Webhook 環境變數（未設或空白不啟用該條件；格式錯誤時關閉該條件並只記變數名稱；投資組合與個股各自獨立）：

| 變數 | 意義 |
| --- | --- |
| `PROACTIVE_PORTFOLIO_DECLINE_PCT` | 投資組合跌幅百分比 |
| `PROACTIVE_STOCK_DECLINE_PCT` | 單一持股跌幅百分比 |
| `PROACTIVE_PORTFOLIO_DECLINE_TWD` | 投資組合價差損失金額（TWD） |
| `PROACTIVE_STOCK_DECLINE_TWD` | 單一持股價差損失金額（TWD） |

百分比只接受大於 0、至多 100，TWD 金額大於 0、至多 1e12 的一般十進位正數；不接受負數、百分號或科學記號。同類事件的百分比或 TWD 任一達門檻就通知，剛好達門檻也會通知。只設 portfolio 不會額外啟用 stock。App／LINE 另讀百分比覆蓋（未設／空白預設 3%，忽略 TWD），不影響此處 opt-in 行為。

沒有沿用計畫頁的年化報酬、雷達門檻或蜘蛛圖 0.3% 情緒線。那些不是通知設定。

## 待確認交易

資料在既有的 `pending-trades:<token>`。只讀每筆的 id。

- 佇列裡還有這筆：`pending_trade_open`（`info`）。`event_id` 是 `pending-open:<id>`。
- 這支程式上次看過、這次不見了：`pending_trade_cleared`（`info`）。

伺服器無法分辨使用者是按了「加入」還是「忽略」：兩種都會把同一筆從佇列刪掉。所以清除事件只表示「不再等待確認」，不表示已經寫進交易紀錄。

## 系統與同步

| 事件 | 來源 | 什麼時候算 |
| --- | --- | --- |
| `system_ai_health` | `health:cards` 裡待處理的 AI 卡 | 卡片還開著。不轉貼卡片內文 |
| `system_price_quality` | 同上，`kind: "price"` | 既有的「連續 5 分鐘沒有真實成交價」卡片。不轉貼代號 |
| `system_intraday_collector` | `intraday-status` 的 `error` / `failed:` | `lastAt` 是今天。不轉貼 `detail` |
| `sync_stale` | `portfolio-sync:` 的 `syncedAt` | 超過 72 小時。與中控「快照過舊」同一條線 |

不另判 `quote-diag`。單次報價失敗太吵，而且內容帶有代號；報價品質以已經開出來的卡片為準。

未知種類的健康卡、行事曆還查不到時的跌幅、盤中每分鐘路徑，都不宣稱已涵蓋。

同步掃描最多 20 個快照 key、20 個待確認佇列。這是個人部署的上限，不是全站保證。

## 去重、冷卻、重試

狀態存在既有的 `health_kv`，key 是 `proactive-anomaly:v1`，14 天過期。只記 event id、次數與時間，不記持股或金額。最多留 40 筆。

| 預設 | 值 | 為什麼 |
| --- | --- | --- |
| 成功後冷卻 | 20 小時 | 08:00 與 14:00 相隔 6 小時，避免同一天同一件事送兩次。條件還在，冷卻結束後可以用同一個 `event_id` 再送一次 |
| 失敗重試 | 最多 3 次，兩次至少相隔 15 分鐘 | 不在同一次排程裡連打。HTTP 失敗、逾時、3xx、連線錯誤都**不會**寫入 `deliveredAt` |
| 3 次都失敗 | 這個 `event_id` 停止 | 隔日的跌幅／同步事件會用新的日期 id。待確認交易的 id 不會變，所以不會無限重試 |
| 送出前租約 | 45 秒 | 降低兩個重疊執行一起送的機會 |

KV 的讀改寫不是交易。兩個重疊的執行仍可能在對方寫入租約前都通過檢查，各送一次。這裡是盡力而為，不是 exactly-once。

## 接收端

小助的接收端還沒做。在它完成、而且老大決定啟用並設定兩個 webhook Secret 之前，這條選用 webhook 管線維持關閉（不影響已核准的 App／LINE 管線）。不要用這份文件裡的範例網址做真的測試，也不要為了試送去讀或建立正式金鑰。
