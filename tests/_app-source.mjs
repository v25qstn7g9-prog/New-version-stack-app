// 前端 JSX 已從 index.html 搬到 src/app.jsx（再預先編譯成 app.js）。
// 原本直接讀 index.html 做字串檢查的測試改用這個：回傳 index.html + src/app.jsx 的內容。
import fs from 'node:fs';
export function readAppSource() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const jsx = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
  return html + '\n' + jsx;
}
