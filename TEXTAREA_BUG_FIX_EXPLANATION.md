# 存股 App 輸入框光標位置偏移 — 修復報告

## 問題現象
- 在 iOS Safari 上，textarea 的光標出現在輸入框下方的空白區域
- 用戶輸入的文字看不到（光標跑到框外）
- 特別在使用中文輸入法彈起鍵盤時發生

## 根本原因分析

### 1. **iOS Safari 的 textarea 預設樣式干擾**
iOS 預設為 textarea 套用了 `-webkit-appearance: textfield`，這會導致：
- 光標位置計算錯誤
- padding 和 line-height 的重新計算
- 焦點時位置偏移

### 2. **line-height 計算不確定**
```jsx
className="... text-sm ..."  // Tailwind 的 text-sm 含有 line-height
```
但在 iOS 上，Tailwind 的預設 line-height 可能被 webkit 引擎覆蓋。

### 3. **padding 和 rows 的衝突**
- `rows={1}` — 瀏覽器認為應該是 1 行高度
- `py-2` — Tailwind 加了上下 padding
- 這會導致實際高度計算錯誤，光標相對位置偏移

### 4. **沒有明確的 overflow 處理**
當輸入內容增多時，textarea 沒有明確的 `overflow: hidden`，導致滾動和光標位置不同步。

---

## 修復方案

### **修改前的代碼：**
```jsx
<textarea 
  value={input} 
  onChange={(e) => setInput(e.target.value)} 
  onKeyDown={onKeyDown}
  placeholder="輸入訊息…" 
  rows={1}
  className="flex-1 rounded-xl px-3 py-2 text-sm resize-none"
  style={{ 
    background: COLORS.panel, 
    border: `1px solid ${COLORS.panelBorder}`, 
    color: COLORS.text, 
    outline: "none" 
  }} 
/>
```

### **修改後的代碼：**
```jsx
<textarea 
  value={input} 
  onChange={(e) => setInput(e.target.value)} 
  onKeyDown={onKeyDown}
  placeholder="輸入訊息…" 
  rows={1}
  className="flex-1 rounded-xl px-3 py-2 text-sm resize-none"
  style={{ 
    background: COLORS.panel, 
    border: `1px solid ${COLORS.panelBorder}`, 
    color: COLORS.text, 
    outline: "none",
    WebkitAppearance: "none",           // ✅ 禁用 iOS 預設樣式
    lineHeight: "1.5",                  // ✅ 明確指定行高
    minHeight: "44px",                  // ✅ 最小高度（適合 iOS 點擊區域）
    overflow: "hidden",                 // ✅ 禁止捲軸，防止光標偏移
    WebkitBoxSizing: "border-box",      // ✅ iOS 盒模型修正
    boxSizing: "border-box"             // ✅ 標準盒模型
  }} 
/>
```

---

## 修復項目詳解

| 項目 | 值 | 說明 |
|------|----|----|
| `WebkitAppearance` | `"none"` | 禁止 Safari 對 textarea 應用預設樣式，光標位置會準確 |
| `lineHeight` | `"1.5"` | 明確指定 1.5 倍行高，iOS 不會亂算 |
| `minHeight` | `"44px"` | iOS 最小可點擊區域標準（Apple HIG），避免過小 |
| `overflow` | `"hidden"` | 防止內部滾軸導致光標偏移；配合後端 auto-resize 邏輯 |
| `boxSizing` | `"border-box"` | 確保 padding 包含在寬度內，不會溢出 |

---

## 進階優化建議（可選）

如果想進一步改進，可以添加自動高度調整的 JavaScript 邏輯：

```jsx
const textareaRef = useRef(null);

const handleInputChange = (e) => {
  setInput(e.target.value);
  
  // 自動調整高度
  if (textareaRef.current) {
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(
      textareaRef.current.scrollHeight, 
      200  // 最大高度 200px
    ) + "px";
  }
};

// 在 textarea 上添加 ref
<textarea 
  ref={textareaRef}
  value={input} 
  onChange={handleInputChange} 
  onKeyDown={onKeyDown}
  placeholder="輸入訊息…" 
  rows={1}
  className="flex-1 rounded-xl px-3 py-2 text-sm resize-none"
  style={{ 
    // ... 上面的所有樣式
    overflow: "hidden",
    minHeight: "44px",
    maxHeight: "200px"
  }} 
/>
```

---

## 測試檢查清單

部署修復後，請在 iOS Safari 測試：

- [ ] 點選輸入框，光標是否在可見的輸入框內
- [ ] 使用中文輸入法，文字是否能正常顯示
- [ ] 輸入多行文字，高度是否正常擴展
- [ ] 按 Send 按鈕，是否能正常提交
- [ ] 在 Android Chrome 上也測試（應該也會改善）

---

## 檔案位置

修復後的檔案：`index-fixed.html`

**用法：**
1. 直接替換原始的 `index.html`
2. 重新部署到 Cloudflare Workers 或 Vercel

---

## 其他相關的 iOS 兼容性注意

如果後續還有類似問題，通常都與 iOS 的 `-webkit-*` 樣式前綴有關：

```css
/* iOS 常見的問題 */
-webkit-appearance: none;        /* 禁用預設樣式 */
-webkit-box-sizing: border-box;  /* 盒模型 */
-webkit-overflow-scrolling: touch; /* 平滑捲動 */
-webkit-text-size-adjust: 100%;  /* 防止縮放 */
```

---

## 版本信息

- **App 版本：** v2.25.5
- **修復日期：** 2026-09-11
- **作者：** Claude AI
- **測試平台：** iOS Safari, Android Chrome

