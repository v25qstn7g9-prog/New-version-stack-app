# 5 分鐘快速啟動 🚀

## 你需要什麼

- Cloudflare 帳號 (免費)
- Vercel 帳號 (免費)
- Google AI Studio API key (免費)
- Tavily API key (免費選用)

---

## 1️⃣ 複製環境變數範本

```bash
cp .env.example .env.local
```

編輯 `.env.local` (可選，先跳過也行):
```
TAVILY_API_KEY=...  # 若不填就沒新聞搜尋
ASK_RATE_LIMITER=100:1800
```

---

## 2️⃣ 設定 Cloudflare Workers

### 2-1: 安裝 Wrangler
```bash
npm install -g wrangler
wrangler login  # 用瀏覽器登入
```

### 2-2: 建立 KV Namespace
```bash
wrangler kv:namespace create "health_kv"
```

複製輸出的 ID，例如：
```
id = dac5ef4cc5414ad982cb1c135c8abe39
```

編輯 `wrangler.jsonc`，找到這一行：
```jsonc
"kv_namespaces": [
  { "binding": "health_kv", "id": "改成_上面_複製的_ID" }
]
```

### 2-3: 在 Cloudflare Dashboard 啟用 AI Binding
1. 進入 Cloudflare Dashboard
2. Workers & Pages → 你的 project (尚未建立)
3. Settings → Bindings → 建立新 Binding
4. 選 **AI** → 命名為 `AI` → 儲存

### 2-4: 本地測試
```bash
wrangler dev
```

測試這些 URL：
- http://localhost:8787/ (看到首頁)
- http://localhost:8787/quote?code=2330 (股價查詢)
- http://localhost:8787/ask (POST 詢問 - 開發環境用 `curl` 測試)

### 2-5: 部署
```bash
wrangler deploy
```

記下輸出的 URL，例如 `https://your-worker.your-domain.workers.dev`

✅ **Cloudflare 完成！**

---

## 3️⃣ 設定 Vercel 備援 (可選但強烈建議)

### 3-1: 取得 Gemini API Key
1. 進入 [Google AI Studio](https://aistudio.google.com)
2. 建立新 API key → 複製

### 3-2: 在 Vercel 建立 Project
```bash
cd fallback-vercel
vercel
```

按照提示完成設定，記下 URL，例如 `https://stock-app-backup.vercel.app`

### 3-3: 設定環境變數

在 Vercel Dashboard 或 CLI:
```bash
vercel env add GEMINI_API_KEY  # 貼上上面複製的 key
vercel env add TAVILY_API_KEY  # 可選
```

### 3-4: 部署
```bash
vercel --prod
```

✅ **Vercel 完成！**

---

## 4️⃣ 連接備援 (可選)

編輯 Cloudflare 的 `.env.local`:
```
FALLBACK_URL=https://stock-app-backup.vercel.app/api/ask
```

重新部署：
```bash
wrangler deploy
```

✅ **全部完成！**

---

## 驗證一切正常

### Cloudflare 測試
```bash
WORKER_URL="https://your-worker-url.workers.dev"

# 股價查詢
curl "$WORKER_URL/quote?code=2330"

# AI 詢問
curl -X POST "$WORKER_URL/ask" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"今年台積電報酬率多少?"}'

# 健康檢查
curl "$WORKER_URL/api/health-check"
```

### Vercel 測試 (若部署)
```bash
VERCEL_URL="https://your-vercel-app.vercel.app"

# AI 詢問
curl -X POST "$VERCEL_URL/api/ask" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"台股今年表現如何?"}'
```

看到 JSON 回應就表示成功！ ✅

---

## 下一步

- 詳細文件請看 `README.md`
- 完整部署步驟看 `DEPLOYMENT.md`
- 版本資訊在 `VERSION.json`

---

## 🆘 快速排查

| 問題 | 解決方案 |
|------|---------|
| Wrangler 找不到 | `npm install -g wrangler` |
| KV namespace 錯誤 | 確認 `wrangler.jsonc` 的 ID 正確 |
| AI binding 失敗 | Cloudflare Dashboard 確認已建立 Binding |
| Gemini API 錯誤 | 檢查 Google AI Studio 的 API key |
| Vercel 部署失敗 | 確認環境變數都已設定 |

更詳細的排查步驟見 `DEPLOYMENT.md` 的常見問題章節。
