# 給 AI 開發者的規則：存股 App（New-version-stack-app）

## 這個 App

- Forma `portfolio` 主題（霧藍灰／Blueprint 風格的海軍藍）。
- **已核准例外**：密集的財務資料卡維持 **11px 字／17px 行距**，不可換成 Forma 預設的 14px。
- 漸層只用在重點大卡（hero），不要每一格資料都加。
- 正負數顏色只代表漲跌（`--forma-positive`／`--forma-negative`），不當裝飾。
- 外觀調整不可影響資產計算、交易紀錄與報價邏輯。
- **Claude 模型（使用者 2026-11-05「11/11 開始…其他都降到 Sonnet 5.5」；使用者 2026-11-08「延長到12/10」：第二筆促銷額度到 12/10，Opus 5.5 與先用 Anthropic_api_key 延到 12/10（含），12/11 起 Sonnet 5.5；之後若有新額度再延長）**：`functions/ask.js` 的 `claudeModelFor` 每次呼叫才依台北日期決定：2026-12-10（含）以前 `claude-opus-5-5`，2026-12-11 起 `claude-sonnet-5-5`；`ANTHROPIC_MODEL` 有設仍優先。**12/10 之後 Owner 問答仍以 Claude 為主力**（使用者 2026-11-05「延長，改用 Sonnet 5.5」，用每月 US$100 API 額度）：`claudePrimaryActive` 沒有預設結束日，`CLAUDE_PRIMARY=off` 立即關、`CLAUDE_PRIMARY_UNTIL=YYYY-MM-DD` 可設結束日；Claude 失敗仍照原本順序（Cloudflare → Gemini）接手。金鑰：台北 12/10（含）以前先用 `Anthropic_api_key`，12/11 起先用 `ANTHROPIC_API_KEY`／`ANTHROPIC_KEY`、沒有才用 `Anthropic_api_key`；一把回 401／402／403（地區被擋除外）或額度不足就同一題換下一把（`claudeKeyEntries`）。測試固定時間，不看真的時鐘。改完跑 `npm run sync:fallback` 同步 `fallback-vercel/lib/ask-core.js`。
- **Cloudflare Workers AI 模型**：主模型 `@cf/openai/gpt-oss-120b`、推理強度 low（`CF_REASONING_EFFORT`，三處 `ai.run` 都經 `cloudflareInputs`），備援 `@cf/openai/gpt-oss-20b`；2026-11-10 因 `glm-5.3-flash` 2026-11-20 下架而換。推理 token 算在 `MAX_TOKENS`（1600）內，不要調回 1000。
- **編譯**：前端原始碼是 `src/app.jsx`，改完跑 `npm run build:app`（產生最小化的 `app.js`，含用到的 lucide 圖示；新增圖示先跑 `node scripts/gen-icons.mjs`）；改到 Tailwind class 再跑 `npm run build:css`（產生 `tw.css`，不再用 cdn.tailwindcss.com）。兩者都有測試檢查是否同步。

## 外觀與配色：照 Forma Design System

設計規範在 `v25qstn7g9-prog/forma-design-system`（`DESIGN_RULES.md`、`tokens.css`）。Forma 是「共用規則＋各 App 的配色紀錄」，不是每次改色都要先過的關卡。

- **只改外觀**：外觀調整不可順手改 API、資料庫、登入、AI 路由或任何計算。
- **顏色用現有的**：優先用這個 App 已有的顏色變數或 Forma token，不要每處各寫一個新色碼。小改直接改 App，改完同一輪順手把新色碼記到 Forma 對應主題（見下方「怎麼改配色」）。
- **範圍要小**：用 `[data-forma-theme]` 包住要套用的區塊、新元件用 `.forma-*` class；不加會影響整個 App 的全域覆蓋樣式。
- **手機優先**：320／375／430px 寬度都不能左右超出；可點的東西至少 44px；iOS 輸入框字至少 16px；支援減少動態效果（reduced motion）。
- **一區一個重點色**：紅／綠等狀態色只用在有意義的狀態，不當裝飾。
- **保留已核准的例外**（寫在下方「這個 App」段落），不要被「統一」掉。

### 怎麼改配色

- **小改**（調亮／調暗、換一兩個顏色、修看不清楚的地方）：直接改 App → 檢查對比（一般文字對背景至少 4.5:1，大字與圖示至少 3:1）→ 跑完測試直接合併 → 回報時附「改前／改後」手機截圖 → 順手把新色碼記到 Forma `tokens.css` 對應主題。
- **大改**（換整套配色、新增主題）：才先在 Forma 定好主題（可用色票庫、MCP `search_palettes` 找靈感，再換成背景、卡片、文字、次要文字、重點色、警示這些角色），再套到 App。
- 不管大小，**修正完成、測試通過後直接合併到 main**（main 會自動部署；使用者 2026-10-11 授權「以後修正後直接合併」；這條優先於技能「Johnny 的專案發布流程」第 3 點的「合併前先得到同意」），合併後再回報並附截圖。只有會改資料或無法回復的操作（刪資料、換金鑰、改同步邏輯）才先問。

## 協作規則

- 同一時間只讓一個對話改這個 App 的外觀。開始前先 `git fetch origin main`，main 若有新的外觀改動，先合併再改，避免互相覆蓋。
- 推上去之前跑完這個 repo 的測試，失敗就不要推、不要合併。
- 回覆使用者一律用繁體中文、先講結論；使用者用手機操作、不是工程師，不要叫他自己跑指令。
