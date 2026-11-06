# Claude 自動接手開發（New-version-stack-app）

這是 GitHub Actions 上的 `@claude` 自動觸發流程，對齊 ota-report-tool 的機制：只有 repository owner 在自己的 Issue／留言寫 `@claude` 才會啟動；Claude 在分支上實作並開**草稿 PR**；不推 main、不合併。

## 一次性設定

1. **啟用 main 分支保護**（必要）。目前 GitHub branch API 若回報 `protected:false`，workflow 的 preflight 會拒絕啟動 Claude。請至少要求 status check（例如 `test`），並確認 Claude GitHub App 不能繞過保護直接推 main。
2. 在 [Claude GitHub App](https://github.com/apps/claude) 安裝頁，授權這個 repository。
3. 在本專案 Actions Secrets 新增 `ANTHROPIC_API_KEY`（或訂閱用的 `CLAUDE_CODE_OAUTH_TOKEN`）。兩者都設時優先用訂閱 OAuth。不要把金鑰貼在 Issue。

官方 action 固定至已檢查的 `anthropics/claude-code-action` v1 commit；`show_full_output` 已開啟以便除錯。

## 每次交接

1. 由 repository 擁有者建立自己的 Issue，寫明範圍與驗收。
2. Issue 標題或本文含 `@claude`，或在既有 Issue 留言 `@claude`。
3. Actions 跑完後，另一個乾淨 job 透過官方 OIDC 交換短效 App token 建立草稿 PR；Claude job 本身不負責合併。
4. 本輪不自動合併。請確認 CI（test）通過後再由人工合併。

## 本 repo 注意

- Node 20。
- CI 與本地測試：`cp ci/package-lock.json package-lock.json && npm ci` 後 `npm test`。
- 改前端原始碼要重建 `app.js`／`tw.css`。
- 不安裝 Playwright（本 repo 測試不需要）。
- 即使 CLAUDE.md 對人工對話有「修完直接合併」的授權，本 workflow 路徑一律只開草稿 PR，不合併、不推 main。
