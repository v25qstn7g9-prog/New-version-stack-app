# 存股 App 輸入框修復 — 部署清單

## 📋 修復概要

**問題**：iOS Safari 上 textarea 的光標和文字出現在輸入框下方的空白區域  
**原因**：iOS 預設 textarea 樣式干擾 + line-height 計算不準確  
**修復**：添加 6 個 CSS 屬性以禁用 iOS 預設樣式並明確指定尺寸

---

## 🔧 修復內容

### 修改的檔案
- **檔案名**：`index.html`
- **修改位置**：第 3773-3784 行（textarea 元素的 style 物件）
- **修改內容**：添加以下 6 個 CSS 屬性

### 新增的 CSS 屬性

```javascript
{
  WebkitAppearance: "none",       // ✅ 禁用 iOS 預設樣式
  lineHeight: "1.5",              // ✅ 明確行高
  minHeight: "44px",              // ✅ 最小高度
  overflow: "hidden",             // ✅ 禁用捲軸
  WebkitBoxSizing: "border-box",  // ✅ iOS 盒模型
  boxSizing: "border-box"         // ✅ 標準盒模型
}
```

### 對用戶的影響
- ✅ **正面**：光標位置準確，文字可見，輸入體驗改善
- ✅ **相容性**：對 Android、桌面瀏覽器無負面影響
- ⚠️ **無影響**：其他功能（AI 對話、股票追蹤）完全不變

---

## 🚀 部署步驟

### 步驟 1：備份原始檔案
```bash
# 保存一份原始檔案備份
cp index.html index.html.backup
```

### 步驟 2：替換檔案
使用 `index-fixed.html` 替換原始的 `index.html`：
```bash
cp index-fixed.html index.html
```

### 步驟 3：驗證檔案
確認檔案內容正確（檢查第 3775-3785 行）：
```bash
# 查看修復後的代碼
sed -n '3770,3790p' index.html
```

### 步驟 4：部署到 Cloudflare Workers

#### 方式 A：使用 Wrangler CLI
```bash
# 進入專案目錄
cd 存股App-v2.25.5-Gemini3.5完整升級版

# 部署
wrangler deploy

# 驗證部署成功
curl https://your-worker-domain.workers.dev | grep "WebkitAppearance"
```

#### 方式 B：手動上傳
1. 登入 Cloudflare Dashboard
2. 進入你的 Worker 專案
3. 上傳新的 `index.html`
4. 點擊「部署」

### 步驟 5：部署到 Vercel（如果有備援）

```bash
# 進入 fallback-vercel 目錄
cd fallback-vercel

# 複製修復後的 index.html 到正確位置
cp ../index.html ./public/index.html  # 或適當的靜態文件目錄

# 推送並部署
git add .
git commit -m "fix: iOS textarea cursor offset issue"
git push origin main

# Vercel 會自動部署
```

---

## ✅ 部署驗證

### 1️⃣ 驗證檔案內容
```bash
# 檢查是否包含修復
grep -n "WebkitAppearance" index.html

# 應該輸出：
# 3778:                  WebkitAppearance: "none",
```

### 2️⃣ 本地測試（在部署前）
```bash
# 在本地開啟 HTML 文件
open file:///path/to/index.html

# 或用簡單的 HTTP 伺服器
python3 -m http.server 8000
# 然後打開 http://localhost:8000
```

### 3️⃣ 生產環境測試

#### 在 iOS Safari 上測試（必做）：
- [ ] 打開應用 URL（如 `https://your-app.workers.dev`）
- [ ] 進入 AI 對話頁面
- [ ] 點擊輸入框
- [ ] 輸入中文文字
- [ ] ✅ 確認光標和文字都在可見範圍內
- [ ] ✅ 確認可以正常提交

#### 在 Android Chrome 上測試：
- [ ] 打開應用 URL
- [ ] 進入 AI 對話頁面
- [ ] 點擊輸入框並輸入
- [ ] ✅ 確認正常運作（應該更好或無差異）

#### 在桌面 Chrome 上測試：
- [ ] 打開應用 URL
- [ ] 進入 AI 對話頁面
- [ ] 點擊輸入框並輸入
- [ ] ✅ 確認正常運作

---

## 📦 檔案說明

### 提供的檔案

| 檔案名 | 說明 |
|------|------|
| `index-fixed.html` | 修復後的完整 HTML 檔案（直接替換用） |
| `TEXTAREA_BUG_FIX_EXPLANATION.md` | 詳細的問題分析和修復原理 |
| `TEXTAREA_BEFORE_AFTER_CODE.md` | 修復前後的代碼對比 |
| `DEPLOYMENT_CHECKLIST.md` | 本檔案，部署步驟清單 |

### 如何使用
1. **快速部署**：使用 `index-fixed.html`，直接替換原檔案
2. **詳細了解**：閱讀 `TEXTAREA_BUG_FIX_EXPLANATION.md`
3. **代碼對比**：查看 `TEXTAREA_BEFORE_AFTER_CODE.md`

---

## 🔄 回滾計畫（如有問題）

如果修復後出現意外問題，可以快速回滾：

```bash
# 回滾到備份
cp index.html.backup index.html

# 重新部署
wrangler deploy

# 驗證回滾
curl https://your-worker-domain.workers.dev | grep -c "WebkitAppearance"
# 應該輸出 0（表示已回滾）
```

---

## 🆘 如果問題依然存在

### 可能的原因

1. **檔案沒有真正部署**
   - 檢查瀏覽器快取（Ctrl+Shift+Delete 清快取）
   - 檢查 Cloudflare Workers 是否真的更新了
   - 查看 Cloudflare 的 KV Storage 是否有快取版本

2. **父容器的 CSS 干擾**
   - 檢查 `.flex.items-end` 容器是否有問題
   - 嘗試添加 `align-items: flex-end` 替代方案

3. **其他 JavaScript 邏輯衝突**
   - 檢查是否有其他腳本在修改 textarea 的樣式
   - 搜索 `setInput` 函數是否有額外的樣式修改

### 進階調試

```javascript
// 在瀏覽器控制台運行
const ta = document.querySelector('textarea');
console.log({
  computed: window.getComputedStyle(ta),
  bounds: ta.getBoundingClientRect(),
  value: ta.value
});
```

---

## 📱 測試環境推薦

### 最小測試配置
- ✅ iPhone 12+ 或 iPhone 13+ 的 Safari
- ✅ Android 11+ 的 Chrome
- ✅ macOS 的 Safari 或 Chrome

### 完整測試配置
- ✅ iOS 13, 14, 15, 16, 17 的 Safari
- ✅ Android 9, 10, 11, 12, 13 的 Chrome
- ✅ iPad (iPadOS) 的 Safari
- ✅ macOS/Windows 的主要瀏覽器

---

## 📞 支援資訊

### 遇到問題
1. 檢查本檔案的「如果問題依然存在」部分
2. 查看 Cloudflare Workers 的錯誤日誌
3. 在瀏覽器開發者工具中檢查網路請求和控制台錯誤

### 修復反饋
- 修復成功？ → 太好了！享受改善後的輸入體驗 🎉
- 修復失敗？ → 回滾並檢查上述調試步驟

---

## 📋 最終檢查清單

部署前，請確認以下事項：

- [ ] 已備份原始 `index.html`
- [ ] 已複製 `index-fixed.html` 為新的 `index.html`
- [ ] 已驗證第 3778 行包含 `WebkitAppearance: "none"`
- [ ] 已部署到 Cloudflare Workers（或 Vercel）
- [ ] 已在 iOS Safari 上測試
- [ ] 已在 Android Chrome 上測試
- [ ] 已驗證輸入框能正常使用

如果所有項目都打勾 ✅，修復部署完成！

---

## 📅 版本歷史

| 版本 | 日期 | 說明 |
|------|------|------|
| 1.0 | 2026-09-11 | 初版修復，針對 iOS textarea 光標偏移 |

---

## 許可証

此修復由 Claude AI 提供，供 Johnny 的存股 App 使用。

