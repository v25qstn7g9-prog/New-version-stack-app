# 存股 App — 輸入框修復快速部署指南

## 🎯 30 秒快速版

**問題**：iOS 上輸入框光標跑到下面看不到  
**解決**：用 `index-fixed.html` 替換 `index.html`，重新部署

```bash
# 1. 備份原檔案
cp index.html index.html.backup

# 2. 使用修復版本
cp index-fixed.html index.html

# 3. 部署到 Cloudflare Workers
wrangler deploy

# 完成！✅
```

---

## 📱 測試（重要）

修復部署後，**必須**在 iPhone 上測試：

1. 用 Safari 打開你的應用
2. 進入 AI 對話頁面
3. 點選下方輸入框
4. 用中文輸入法輸入
5. ✅ 確認光標和文字都在框內（不在下面空白區）

---

## 📁 檔案清單

| 檔案 | 用途 |
|-----|------|
| `index-fixed.html` | **必要**：直接替換原 index.html |
| `DEPLOYMENT_CHECKLIST.md` | 詳細部署步驟 |
| `TEXTAREA_BUG_FIX_EXPLANATION.md` | 技術原理（想了解的話讀這個） |
| `TEXTAREA_BEFORE_AFTER_CODE.md` | 代碼對比 |

---

## ⚡ Vercel 備援也要修

如果有 Vercel 備援版本：

```bash
# 複製修復檔案到 Vercel 目錄
cp index-fixed.html fallback-vercel/public/index.html

# 推送部署
cd fallback-vercel
git add .
git commit -m "fix: iOS textarea issue"
git push origin main
```

---

## 🆘 問題排查

### 修復後光標還是不對？
- 清瀏覽器快取：長按重新整理（iPhone Safari）
- 檢查 Cloudflare Workers 確實部署了新版本
- 試試 Incognito/Private 模式

### 改不了原始檔案？
- 確保有寫入權限
- 檢查是否是符號連結

### 想回到原版本？
```bash
cp index.html.backup index.html
wrangler deploy
```

---

## ✨ 修復內容簡述

在 textarea 的樣式加了這 6 個 CSS 屬性：

```javascript
{
  WebkitAppearance: "none",        // 禁用 iOS 預設樣式
  lineHeight: "1.5",               // 明確行高
  minHeight: "44px",               // 最小高度
  overflow: "hidden",              // 禁用捲軸
  WebkitBoxSizing: "border-box",   // iOS 盒模型
  boxSizing: "border-box"          // 標準盒模型
}
```

就這樣 🎉

---

## 📞 完成後

- ✅ 光標和文字都在框內
- ✅ 可以正常輸入中文
- ✅ Send 按鈕可以提交
- ✅ 其他功能不受影響

如果都正常，修復成功！🚀

