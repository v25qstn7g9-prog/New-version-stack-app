# Claude 自動接手開發（@claude）

和 ota-report-tool 同一套流程（2026-11-06 使用者「全裝」）。

## 一次性設定（擁有者在 GitHub 網頁上做）

1. **分支保護**：Settings → Branches（或 Rules）替 `main` 加規則：須經 PR、必須通過 `test`，不需他人核准。沒開時 workflow 會拒絕啟動 Claude。
2. **Claude GitHub App**：在 https://github.com/apps/claude 的安裝設定把 `new-version-stack-app` 加入可存取的 repository。
3. **金鑰**：Settings → Secrets and variables → Actions → Repository secrets，新增 `ANTHROPIC_API_KEY`（console.anthropic.com 建的 API 金鑰）。不要貼在 Issue。

計費：Anthropic 的促銷額度只適用 API／Agent SDK 等，不含 Claude Code；`@claude` 扣的是自行加值的餘額（2026-11-06 實測）。

## 使用

擁有者在自己的 Issue（本文或留言）寫 `@claude` 加上要做的事。Claude 讀 `CLAUDE.md`、在 `claude/` 分支修改並跑檢查；有提交時另一個乾淨的 job 建立**草稿 PR**，只回答問題時不建 PR。不自動合併，合併照本 repo 的 `CLAUDE.md`。

只接受擁有者自己的 Issue／留言；每個 Issue 串行，最多 60 turns、45 分鐘。

## 安全邊界

Claude 執行 job 能用 node／npm／git 與 App token；「不要推 main、不要合併、不要讀憑證」是指令，不是技術隔離，主線靠伺服器端分支保護。PR 建立在另一個 job，用另取的短效 token（contents:read、pull_requests:write），用完撤銷；不接收 API 金鑰。workflow 不使用 `pull_request_target`，不執行外部 PR 的程式碼。
