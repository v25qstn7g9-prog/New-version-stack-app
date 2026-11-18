# Claude 自動接手開發（@claude）

和 ota-report-tool 同一套流程（2026-11-06 使用者「全裝」）。main 後續加上的權限、Claude App 驗證、分支保護與短效 token 都保留；這裡只補本 repo 的 Node、依賴安裝與除錯輸出。

## 一次性設定（擁有者在 GitHub 網頁上做）

1. **分支保護**：Settings → Branches（或 Rules）替 `main` 加規則：須經 PR、必須通過 `test`，不需他人核准。沒開時 workflow 會拒絕啟動 Claude。
2. **Claude GitHub App**：在 https://github.com/apps/claude 的安裝設定把 `new-version-stack-app` 加入可存取的 repository。
3. **金鑰**：Settings → Secrets and variables → Actions → Repository secrets，新增 `ANTHROPIC_API_KEY`（console.anthropic.com 建的 API 金鑰）。不要貼在 Issue。訂閱用的 `CLAUDE_CODE_OAUTH_TOKEN` 若有設定，workflow 會優先用它，不把 API 金鑰傳進 action。

計費：Anthropic 的促銷額度只適用 API／Agent SDK 等，不含 Claude Code；`@claude` 扣的是自行加值的餘額（2026-11-06 實測）。

## 使用

擁有者在自己的 Issue（本文或留言）寫 `@claude` 加上要做的事。Claude 讀 `CLAUDE.md`、在 `claude/` 分支修改並跑檢查；有提交時另一個乾淨的 job 建立**草稿 PR**，只回答問題時不建 PR。這條 workflow **不推 main、不自動合併**。`CLAUDE.md` 裡「測試通過後直接合併」只適用人工對話，不適用這條自動路徑。

只接受擁有者自己的 Issue／留言；每個 Issue 串行，最多 60 turns、45 分鐘。`show_full_output` 為 true，Actions 日誌會留下較完整的執行輸出以便除錯；不要把金鑰寫進 Issue。

## 本 repo 的執行環境

- **Node 20**。根目錄 `package.json` 的 `engines.node` 是範圍 `>=18.0.0`，沒有釘死次版本。已核對目前 main：`test` workflow 用 Node 20，並用 `ci/package-lock.json` 執行 `npm ci`。`fallback-vercel/package.json` 的 engines 是 `>=20`，Node 20 同時滿足。不沿用舊 `feat/claude-auto-trigger` 未再核對的假設，也不沿用從 ota-report-tool 抄來的 Node 22。
- 啟動 Claude 前的安裝指令與 `test` workflow 相同：`cp ci/package-lock.json package-lock.json && npm ci --no-audit --no-fund`。根目錄 `package-lock.json` 被 gitignore，不要提交。
- 改 `src/app.jsx` 後跑 `npm run build:app`；改到 Tailwind class 再跑 `npm run build:css`；改 `functions/ask.js` 後跑 `npm run sync:fallback`；提交前跑 `npm test`。
- 開 PR 的 job 只用 Node 跑 `.github/scripts/ensure-claude-pr.mjs`，不安裝 npm 套件、不接收 API 金鑰。

## 安全邊界

Claude 執行 job 能用 node／npm／git 與 App token；「不要推 main、不要合併、不要讀憑證」是指令，不是技術隔離，主線靠伺服器端分支保護。PR 建立在另一個 job，用另取的短效 token（contents:read、pull_requests:write），用完撤銷；不接收 API 金鑰。workflow 不使用 `pull_request_target`，不執行外部 PR 的程式碼。
