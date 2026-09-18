# 存股 App v2.25.5 | Gemini 3.5 完整升級版 ✨

**最後更新**: 2026年9月10日  
**狀態**: ✅ 生產穩定版 | Gemini 內建 fallback  
**架構**: Cloudflare Workers（主力）→ Gemini 3.5 Flash-Lite（同 Worker 內建備援）→ 舊 Vercel 備援（可選）

---

## 🚀 快速開始

**首次部署?** 看這個：[QUICKSTART.md](./QUICKSTART.md) (5分鐘指南)

**需要完整步驟?** 看這個：[DEPLOYMENT.md](./DEPLOYMENT.md) (詳細部署清單)

---

## 主 App
- App：`4.6-personal-v2.25.5-gemini35`
- 左右滑頁與穩定化手勢保留
- 持股頁沿用首頁即時報價
- 加權指數 TAIEX 已恢復
- `今日 vs 大盤` 已恢復
- 備份／匯入、交易、持股、配息、計畫、資產曲線保留

## Cloudflare
- `functions/quote.js`：`4.6-quote-stable-12-taiex`
- 支援一般台股代號 + `TAIEX`
- TAIEX 使用 TWSE `tse_t00.tw`，Yahoo fallback 使用 `^TWII`
- `functions/ask.js`：`4.6-ask-free-23-gemini35-direct-fallback`（Cloudflare GPT-OSS 20B + Gemini 3.5 Flash-Lite fallback）
- `functions/news.js`：`4.6-news-stable-6`
- `functions/health-check.js`：`4.6-health-check-1`
- Workers with Static Assets：`worker.js`

## Gemini 內建自動備援（新版）
- `GEMINI_API_KEY`：Cloudflare Worker Secret
- `GEMINI_MODEL`：`gemini-3.5-flash-lite`
- Cloudflare AI 額度用完、429、逾時或 5xx 時，直接在 Worker 伺服器端切 Gemini。
- Gemini Key 不會送到瀏覽器。
- 私人持股 context 預設不送 Gemini；可在 App「AI 雙層備援」勾選後允許。

## 舊版 Vercel AI 備援（相容保留）
- fallback package：`2.21.4`
- `api/ask.js`：Gemini 3.5 Flash-Lite
- `api/health.js`：Gemini 3.5 Flash-Lite 健康檢查
- `lib/ask-core.js`：`4.6-ask-free-21.4-gemini35-stable-tools`
- thinking 關閉：`thinkingBudget: 0`
- 保留 function calling、App 資料查詢、即時股價與 Tavily web search

## 📁 檔案結構

### 根目錄 (設定 & 文檔)
```
├── 🟦 index.html                    # 前端主程式
├── 🟦 manifest.webmanifest         # PWA 配置
├── 📝 README.md                    # 本檔案
├── 📝 QUICKSTART.md                # 🆕 快速啟動指南
├── 📝 DEPLOYMENT.md                # 🆕 完整部署檢查清單
├── 📋 VERSION.json                 # 🆕 版本資訊追蹤
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
└── health-check.js         # 自動健康檢查卡片
```

### fallback-vercel/ (獨立備援)
```
├── api/
│   ├── ask.js              # 備援 AI 助手 (Gemini 3.5)
│   └── health.js           # 備援健康檢查
├── lib/
│   └── ask-core.js         # 備援核心引擎
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
