# 給 AI 開發者的規則：存股 App（New-version-stack-app）

## 這個 App

- Forma `portfolio` 主題（霧藍灰／Blueprint 風格的海軍藍）。
- **已核准例外**：密集的財務資料卡維持 **11px 字／17px 行距**，不可換成 Forma 預設的 14px。
- 漸層只用在重點大卡（hero），不要每一格資料都加。
- 正負數顏色只代表漲跌（`--forma-positive`／`--forma-negative`），不當裝飾。
- 外觀調整不可影響資產計算、交易紀錄與報價邏輯。

## 外觀與配色：照 Forma Design System

設計規範在 `v25qstn7g9-prog/forma-design-system`（`DESIGN_RULES.md`、`tokens.css`、`components.css`）。改任何外觀前，先讀那個 repo 的最新版。

- **只改外觀**：外觀調整不可順手改 API、資料庫、登入、AI 路由或任何計算。
- **不自創色碼**：顏色、字級、間距、圓角一律用 Forma 的 token；需要新顏色時，先在 Forma repo 改主題（見下方「怎麼改配色」），不要直接在 App 裡寫新的色碼。
- **範圍要小**：用 `[data-forma-theme]` 包住要套用的區塊、新元件用 `.forma-*` class；不加會影響整個 App 的全域覆蓋樣式。
- **手機優先**：320／375／430px 寬度都不能左右超出；可點的東西至少 44px；iOS 輸入框字至少 16px；支援減少動態效果（reduced motion）。
- **一區一個重點色**：紅／綠等狀態色只用在有意義的狀態，不當裝飾。
- **保留已核准的例外**（寫在下方「這個 App」段落），不要被「統一」掉。

### 怎麼改配色（流程）

1. 在 Forma repo 的 `tokens.css` 修改這個 App 的主題（或新增主題），並在 `DESIGN_RULES.md` 的 Themes 補一行說明。可以先用 Forma 色票庫（`data/palettes-500.json`、MCP `search_palettes`）找靈感，但色票只是靈感，要換成語意角色（背景、卡片、文字、次要文字、重點色、警示）。
2. 檢查對比：一般文字對背景至少 4.5:1，大字與圖示至少 3:1。
3. 同步到 App：把 Forma 檔案複製進 App（標上來源 commit），或改 App 對應的主題變數。
4. 截「改前／改後」手機截圖給使用者確認；**使用者同意後才合併到 main**（main 會自動部署）。

## 協作規則

- 同一時間只讓一個對話改這個 App 的外觀。開始前先 `git fetch origin main`，main 若有新的外觀改動，先合併再改，避免互相覆蓋。
- 推上去之前跑完這個 repo 的測試，失敗就不要推。
- 回覆使用者一律用繁體中文、先講結論；使用者用手機操作、不是工程師，不要叫他自己跑指令。
