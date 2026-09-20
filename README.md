# 存股 App v2.28.0 | Gemini 3.5 完整升級版 ✨

**最後更新**: 2026年9月18日  
**狀態**: ✅ 生產穩定版 | Gemini 內建 fallback  
**架構**: Cloudflare Workers（主力）→ Gemini 3.5 Flash-Lite（同 Worker 內建備援）→ 舊 Vercel 備援（可選）

---

## 🚀 快速開始

**首次部署?** 看這個：[QUICKSTART.md](./QUICKSTART.md) (5分鐘指南)

**需要完整步驟?** 看這個：[DEPLOYMENT.md](./DEPLOYMENT.md) (詳細部署清單)

---

## 主 App
- App：`4.6-personal-v2.28.0-gemini35`
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
- `functions/health-check.js`：`4.6-health-check-2`
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
- thinking 關閉：`thinkingLevel: minimal`
- 保留 function calling、App 資料查詢、即時股價與 Tavily web search

## 📁 檔案結構

### 根目錄 (設定 & 文檔)
```
├── 🟦 index.html                    # Vite 進入頁（極簡殼層，掛載 src/main.jsx）
├── 🟦 vite.config.js                # Vite 建置設定
├── 🟦 tailwind.config.js            # Tailwind CLI 設定
├── 🟦 postcss.config.js             # PostCSS 設定
├── 🟦 eslint.config.js              # ESLint 設定（含 no-undef 檢查）
├── 📁 src/                          # 前端原始碼（build 前）
├── 📁 public/                       # 原樣複製進 dist/ 的靜態檔（manifest.webmanifest 等）
├── 📁 test/                         # vitest 單元測試
├── 📁 dist/                         # `npm run build` 產物，實際部署的靜態資源（gitignore）
├── 📝 README.md                    # 本檔案
├── 📝 QUICKSTART.md                # 快速啟動指南
├── 📝 DEPLOYMENT.md                # 完整部署檢查清單
├── 📋 VERSION.json                 # 版本資訊追蹤
├── 📋 package.json                 # 專案設定 & 命令
├── 🔑 .env.example                 # 環境變數範本 (Cloudflare)
├── 🚫 .gitignore                   # Git 忽略規則
├── ⚙️  wrangler.jsonc              # assets.directory 指向 dist/
├── ⚙️  _routes.json                # 路由配置
├── ⚙️  worker.js                   # Cloudflare Worker 進入點
├── 📁 functions/                   # Cloudflare 函式
├── 📁 .github/workflows/           # CI（lint / test / build / check:version）
└── 📁 fallback-vercel/            # Vercel 備援
```

### src/ (前端，Vite 建置)
```
├── main.jsx                 # 掛載進入點（ReactDOM.createRoot）
├── App.jsx                  # 根元件（原 AssetTracker）
├── index.css                # Tailwind 指令
├── components/               # 每個分頁/區塊各一個檔案
└── lib/
    ├── constants.js          # APP_VERSION、COLORS、TABS 等常數
    ├── icons.jsx             # lucide-react 圖示別名
    └── helpers.js             # 純函式（排程試算、備份驗證、AI 工具呼叫驗證…）
```
**部署前一定要先 `npm run build`**（`npm run deploy` / `deploy:prod` / `preview:worker` 已自動幫你串好這一步，直接打 `wrangler deploy` 會用到舊的或不存在的 dist/）。

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


## Static Assets 安全

專案目前使用 Workers Static Assets；`.assetsignore` 會排除 `worker.js`、`functions/`、`fallback-vercel/`、設定檔與文件，避免後端原始碼被當成公開靜態資產發布。
