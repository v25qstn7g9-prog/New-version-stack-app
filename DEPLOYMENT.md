# 部署檢查清單 📋

## 概述

存股 App 是**雙層架構**：
- **主力**：Cloudflare Workers (快速、全球 CDN)
- **備援**：Vercel Functions (當 Cloudflare 故障時自動切換)

兩者都需要部署，但可以獨立操作。

---

## Cloudflare Workers 部署

### 前置準備
- [ ] 安裝 Wrangler CLI: `npm install -g wrangler`
- [ ] 登入 Cloudflare: `wrangler login`
- [ ] 有 Cloudflare 帳號且設好域名或 Workers subdomain

### 步驟 1：建立 KV Namespace
```bash
# 建立 namespace 用於存放健康檢查卡片
wrangler kv:namespace create "health_kv"
wrangler kv:namespace create "health_kv" --preview  # 如果要用預覽環境

# 記下輸出的 ID，例如：
# 🎉 Successfully created a new namespace binding!
# id = dac5ef4cc5414ad982cb1c135c8abe39
```

- [ ] 複製 KV ID，貼入 `wrangler.jsonc` 的 `kv_namespaces[0].id`

### 步驟 2：設定環境變數
```bash
# 複製範本
cp .env.example .env.local

# 編輯 .env.local，填入：
# - TAVILY_API_KEY (若要新聞搜尋功能)
# - 其他選用變數
```

- [ ] `.env.local` 已填入 (確認 .gitignore 會忽略它)

### 步驟 3：啟用 AI Binding
在 Cloudflare Dashboard:
1. 進入 Workers & Pages → 你的 project
2. 進入 Settings → Bindings
3. 建立新 Binding → AI (Cloudflare AI)
4. 命名為 `AI` (要與 wrangler.jsonc 的 binding 名稱一致)
5. 選擇模型（預設 `@cf/mistral/mistral-7b-instruct-v0.1`）

- [ ] AI binding 已在 Dashboard 建立
- [ ] wrangler.jsonc 的 binding 名稱是 `AI`

### 步驟 4：部署
```bash
# 開發環境測試
wrangler dev

# 測試 URL:
# - http://localhost:8787/         (靜態首頁)
# - http://localhost:8787/quote?code=2330  (股價查詢)
# - http://localhost:8787/ask      (POST AI 詢問)
# - http://localhost:8787/health-check (健康檢查)

# 驗證無誤後，部署到生產
wrangler deploy --env production

# 或直接部署（不指定環境則用 default）
wrangler deploy
```

- [ ] `wrangler dev` 測試通過
- [ ] `wrangler deploy` 成功
- [ ] 訪問 Workers URL 確認可用

### 步驟 5：測試端點
```bash
# 取得實際的 Workers URL (從 Cloudflare Dashboard 或部署輸出)
WORKER_URL="https://your-worker-name.your-domain.workers.dev"

# 測試 quote
curl "$WORKER_URL/quote?code=2330"

# 測試 ask (POST)
curl -X POST "$WORKER_URL/ask" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"今天台股開盤多少?"}'

# 測試 health-check
curl "$WORKER_URL/api/health-check"

# 測試靜態檔案
curl "$WORKER_URL/"
```

- [ ] `/quote` 回傳股價 JSON
- [ ] `/ask` 回傳 AI 回應
- [ ] `/health-check` 回傳健康檢查狀態
- [ ] `/` 回傳 index.html 首頁

### 步驟 6：設定定時健康檢查 (可選)
健康檢查已在 wrangler.jsonc 設定 `*/30 * * * *`（每 30 分鐘自動跑一次），無需手動操作。

- [ ] 確認 wrangler.jsonc 的 `triggers.crons` 已設定
- [ ] 在 Dashboard 確認 Cron trigger 已激活

---

## Vercel 備援部署

### 前置準備
- [ ] 有 Vercel 帳號
- [ ] 安裝 Vercel CLI: `npm install -g vercel`

### 步驟 1：準備 Vercel 項目
```bash
# 進入 fallback-vercel 資料夾
cd fallback-vercel

# 初始化 Vercel 項目（第一次）
vercel

# 或者直接在 Vercel Dashboard 建立新 project，連接到 GitHub repo
```

- [ ] Vercel project 已建立
- [ ] project 名稱記下來

### 步驟 2：設定環境變數

在 Vercel Dashboard 或 CLI:

**必要：**
```
GEMINI_API_KEY=your_gemini_api_key_from_google_ai_studio
```

**選用但強烈建議：**
```
TAVILY_API_KEY=your_tavily_key
APP_ORIGIN=https://your-original-app.example.com
FALLBACK_ACCESS_TOKEN=optional_secret_token
```

- [ ] GEMINI_API_KEY 已設定
- [ ] TAVILY_API_KEY 已設定 (若需要)
- [ ] APP_ORIGIN 已設定 (若需要)

### 步驟 3：部署
```bash
# CLI 部署
cd fallback-vercel
vercel --prod

# 或透過 GitHub 自動部署（推薦）
# 在 Vercel Dashboard 連接 GitHub repo，每次 push 自動部署
```

- [ ] Vercel 部署成功
- [ ] 記下 Vercel URL，例如 `https://stock-app-backup.vercel.app`

### 步驟 4：測試備援端點
```bash
VERCEL_URL="https://your-vercel-app.vercel.app"

# 測試 ask
curl -X POST "$VERCEL_URL/api/ask" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"今天台股指數多少?"}'

# 測試 health
curl "$VERCEL_URL/api/health"
```

- [ ] `/api/ask` 回傳 AI 回應
- [ ] `/api/health` 回傳健康狀態

---

## 連接主力與備援

### 在 Cloudflare 配置備援 URL

編輯 `.env.local`（Cloudflare）:
```
FALLBACK_URL=https://your-vercel-app.vercel.app/api/ask
```

- [ ] Cloudflare 環境變數 FALLBACK_URL 已設定

### 測試自動轉向
```bash
# 可以在本地臨時改掉 wrangler.jsonc 禁用 AI binding，驗證是否轉向 Vercel
# 或直接 mock 一個 AI binding 故障場景測試
```

- [ ] 確認備援機制正常工作

---

## 日常維護

### 監控
- [ ] 定期檢查 Cloudflare Dashboard 的 Analytics
- [ ] 檢查 Vercel Dashboard 的 Logs 和 Errors
- [ ] 訪問 `/api/health-check` 查看自動檢查的卡片狀態

### 更新
- [ ] 版本更新時修改 `VERSION.json`
- [ ] 重大變更記錄在本檔案的底部
- [ ] 每次部署前確認 `.env.local` 不會被上傳

### 備份
- [ ] 定期備份 KV namespace 資料（若有重要卡片狀態）
- [ ] GitHub 上 tag 重要版本

---

## 常見問題排查

### Cloudflare 問題

**Q: `wrangler deploy` 失敗，說 KV namespace 不存在**
```bash
# 確認 KV 已建立
wrangler kv:namespace list

# 確認 ID 在 wrangler.jsonc 中正確
cat wrangler.jsonc | grep health_kv
```

**Q: AI binding 故障或返回錯誤**
- 檢查 Cloudflare Dashboard → Settings → Bindings
- 確認模型選擇正確
- 查看 Worker Logs 尋找錯誤消息

**Q: `/ask` 返回 504 Timeout**
- 可能 Gemini API 過載或網路延遲
- 檢查自動轉向到 Vercel 是否生效
- 嘗試降低 timeout 等待時間

### Vercel 問題

**Q: GEMINI_API_KEY 無效**
- 確認 key 來自 Google AI Studio (https://aistudio.google.com)
- 確認 key 沒有過期或被撤銷
- 重新生成 key

**Q: `/api/ask` 返回 500**
- 檢查 Vercel Logs 尋找詳細錯誤
- 確認所有必要環境變數已設定
- 嘗試本地測試 (`cd fallback-vercel && npm run dev`)

---

## 變更日誌

### 2026-09-10
- ✅ 初始穩定版本 v2.25.3
- ✅ Cloudflare Workers with Static Assets
- ✅ Vercel Gemini 2.5 Flash-Lite 備援
- ✅ 自動健康檢查 (30 分鐘間隔)
