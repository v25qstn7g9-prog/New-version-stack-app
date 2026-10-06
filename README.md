# 存股 App v2.47.3 | Personal Advisor + Gemini 3.6 ✨

**最後更新**: 2026年10月5日  
**狀態**: 主線更新已驗證；線上版本以部署結果為準 | Gemini 內建 fallback  
**架構**: Cloudflare Workers（主力）→ Gemini 3.6 Flash（同 Worker 內建備援）→ 舊 Vercel 備援（可選）

---

## 🚀 快速開始

**首次部署?** 看這個：[QUICKSTART.md](./QUICKSTART.md) (5分鐘指南)

**需要完整步驟?** 看這個：[DEPLOYMENT.md](./DEPLOYMENT.md) (詳細部署清單)

---

## 主 App
- App：`4.7-personal-advisor-v2.47.3-final-ui-ntd`
- 左右滑頁與穩定化手勢保留
- 台股／美股共用持股、交易、配息、定期定額、每日紀錄與首頁行情模板；不另設美股專區
- 舊美股持股在載入或匯入時整合進同一份持股資料，保留股數並避免舊交易重複計算
- 新增買進交易會同步建立缺少的持股並查詢名稱，不必再新增一次標的
- 美股交易與配息以美元輸入，儲存成交／入帳匯率與台幣金額；補記過去日期需填寫當時匯率
- 每日資產同一筆紀錄帶入兩個市場；美股報價開盤每30秒更新，總資產與配置依USD/TWD換算
- 台股法人、雷達、除息公告沿用原本的台股資料來源；美股配息可在共用表單填寫
- 持股頁沿用首頁即時報價
- 加權指數 TAIEX 已恢復
- `今日 vs 大盤` 已恢復
- 備份／匯入、交易、持股、配息、計畫、資產曲線保留

## Cloudflare
- `functions/quote.js`：`4.7-quote-schedule-6-us-live`
- 支援一般台股代號 + `TAIEX`
- TAIEX 使用 TWSE `tse_t00.tw`，Yahoo fallback 使用 `^TWII`
- `functions/ask.js`：`4.7-personal-advisor-v3.2-bounded-learning`（Cloudflare GPT-OSS 20B + Gemini 3.6 Flash fallback）
- `functions/news.js`：`4.6-news-stable-6`
- `functions/health-check.js`：`4.6-health-check-2`
- Workers with Static Assets：`worker.js`

## Gemini 內建自動備援
- `GEMINI_API_KEY`：Cloudflare Worker Secret
- `GEMINI_MODEL`：`gemini-3.6-flash`
- Cloudflare AI 額度用完、429、逾時或 5xx 時，直接在 Worker 伺服器端切 Gemini。
- Gemini Key 不會送到瀏覽器。
- 私人持股 context 預設不送 Gemini；可在 App「AI 雙層備援」勾選後允許。

## 舊版 Vercel AI 備援（相容保留）
- fallback package：`2.22.0`
- `api/ask.js`：Gemini 3.6 Flash
- `api/health.js`：Gemini 3.6 Flash 健康檢查
- `lib/ask-core.js`：`4.7-personal-advisor-v3.2-bounded-learning`
- thinking 關閉：`thinkingLevel: minimal`
- 保留 function calling、App 資料查詢、即時股價與 Tavily web search

## 📁 檔案結構

### 根目錄 (設定 & 文檔)
```
├── 🟦 index.html                    # 前端主程式
├── 🟦 manifest.webmanifest         # PWA 配置
├── 📝 README.md                    # 本檔案
├── 📝 QUICKSTART.md                # 🆕 快速啟動指南
├── 📝 DEPLOYMENT.md                # 🆕 完整部署檢查清單
├── 📋 VERSION.json                 # 版本資訊追蹤
├── 🛡️ .assetsignore                 # Static Assets 公開檔案排除清單
├── 📋 package.json                 # 🆕 專案設定 & 命令
├── 🔑 .env.example                 # 🆕 環境變數範本 (Cloudflare)
├── 🚫 .gitignore                   # 🆕 Git 忽略規則
├── ⚙️  wrangler.jsonc              # 🆕 改進版 (支援 dev/prod)
├── ⚙️  _routes.json                # 路由配置
├── ⚙️  worker.js                   # Cloudflare Worker 進入點
├── 📁 functions/                   # Cloudflare 函式
└── 📁 fallback-vercel/            # Vercel 備援
```

### functions/ (Cloudflare Workers)
```
├── ask.js                  # 主 AI 助手 (Cloudflare GPT-OSS 20B)
├── quote.js                # 股價查詢 (TAIEX + 台股)
├── news.js                 # 市場新聞
├── health-check.js         # 自動健康檢查卡片
└── portfolio-sync.js       # 持股摘要同步（供 Z∞ 中控查詢）
```

## Z∞ 同步

「計畫」分頁裡的「Z∞ 同步」可以貼上一組 token（跟你給 Z∞ 中控的同一組）；填了之後 App 會在持股/交易/成本資料變動時，把持股、交易、配息、每日資產、計畫與模型快照推到 `/api/portfolio-sync`，存進既有的 `health_kv`（key 是 `portfolio-sync:<token>`，兩週沒同步會自動過期）。留空就完全不會對外送出任何資料。因為大家共用同一個部署網址、資料各自存在自己瀏覽器的 localStorage，token 就是唯一能分辨「這是誰的資料」的依據，請不要把自己的 token 分享給別人。

### fallback-vercel/ (獨立備援)
```
├── api/
│   ├── ask.js              # 備援 AI 助手 (Gemini 3.6 Flash)
│   └── health.js           # 備援健康檢查
├── lib/
│   └── ask-core.js         # 備援核心引擎（functions/ask.js 的同步複本，用 npm run sync:fallback 更新）
├── 🔑 .env.example         # 環境變數範本 (Vercel)
├── package.json            # Node.js 相依
├── vercel.json             # Vercel 設定
└── README.md               # 備援說明
```

## 部署提醒
Cloudflare 與 Vercel 是兩個獨立部署目標。不要把 API Key 寫進 GitHub。

Cloudflare 視你的設定需要：
- AI binding
- `TAVILY_API_KEY`（若使用公開網路搜尋）
- 選用 `ASK_RATE_LIMITER`

Vercel 備援需要：
- `GEMINI_API_KEY`
- 選用 `GEMINI_MODEL`
- 選用 `TAVILY_API_KEY`
- 選用 `APP_ORIGIN`
- 選用 `FALLBACK_ACCESS_TOKEN`

## 封存前版本檢查

在專案根目錄可執行：

```bash
npm run check:version
```

會核對 `index.html`、Cloudflare functions、Vercel fallback 與 `VERSION.json` 是否一致。


## Static Assets 安全

專案目前使用 Workers Static Assets；`.assetsignore` 會排除 `worker.js`、`functions/`、`fallback-vercel/`、設定檔與文件，避免後端原始碼被當成公開靜態資產發布。

## Z∞ 完整資料快照

在「計畫 → Z∞ 同步」填入私人同步 token 後，瀏覽器同步持股、交易、配息、每日資產紀錄、計畫與 Trend Radar／即時行情快照。頁面會顯示最近一次成功同步或失敗原因。Z∞ 中控按問題的日期、股票代號與資料種類擷取紀錄；超出單次模型上下文的資料會標示截斷，不能宣稱已完成全期間計算。原始資料仍以 App 瀏覽器本機為主，Z∞ 中控使用的是最後同步快照。完整資料同步限制為 1 MiB，超出會顯示同步失敗。

`GET /api/portfolio-sync` 可用 `Authorization: Bearer <token>` 讀取；舊版 query token 方式暫保留相容。請勿把 token 放在公開網址、程式碼或日誌。

## 美股自動報價

每日紀錄勾選美股，設定股票代號與持有股數後，App 在美股一般交易時段、畫面可見時每 30 秒讀取 Yahoo 報價與 USD/TWD 匯率。換頁持續更新，回到前景會補抓；市值直接反映在目前總資產與損益。資料可能延遲，面板顯示來源報價時間。部分查詢失敗保留上次價格，不以不完整報價覆蓋總資產。每日歷史紀錄仍透過「帶入今日美股市值」後儲存，買賣後請更新股數。

## 複委託記帳幣別

美股市值、成本、成交價、手續費、交易稅與配息均以新台幣輸入及顯示。即時美元報價僅在行情層換算一次；新交易與配息儲存為 TWD。舊 USD 紀錄保留原始資料，顯示、均價與 Excel 匯出沿用原保存匯率，不使用今日匯率重新估算成交成本。

## 預測資料與驗證 v2.47

新報價直接触發雷達計算，日線、量價、廣度、法人及海外訊號於背景獨立更新，不阻塞報價反應。全程使用台北市場日期；舊報價、缺少來源時間、未滿真實 1／3／8 分鐘的樣本及過期量價不作即時證據。Vercel 同步提供量價與廣度轉接。日線快取依盤前／盤中／盤後區分，盤後每三分鐘可補新資料。

今日預測只允許於盤中記錄，13:25–13:30 可鎖定，收盤後開啟不補造盤前預測。收盤結果需同日 13:30 以後來源報價，或下午兩點後取得的完整日線；平盤不算方向命中。下一交易日遵循已快取的官方休市日期，夜間及翌日盤前延續同一目標日，盤後才建立的預測獨立標記 postClose。

趨勢百分比不代表已驗證胜率；至少 40 筆同股票、同版本、同時段、同分數區間的較早已驗證紀錄才保守校準。舊模型資料保留但不混算新版成效。出手覆蓋、同批全猜漲基準與 Brier 機率誤差一起檢視。價格區間使用較早完成日線的報酬分布，排除拆股等異常斷層（來源有還原價格則採還原報酬），只是波動參考，並非確定目標價或已證實的 80% 未來覆蓋。
