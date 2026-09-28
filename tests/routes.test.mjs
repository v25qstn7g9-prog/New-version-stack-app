import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequestGet as taifexTxHandler } from '../functions/taifex-tx.js';

// 迴歸測試：這個 App 從舊式 Pages Functions（資料夾自動路由）搬到 worker.js 手動路由之後，
// functions/taifex-tx.js 被漏掉，沒有掛上 /taifex-tx。
// 結果前端照常打 /taifex-tx，但一直打到靜態資源、拿不到真正的台指近月報價，
// 全域訊號因此惄惄少了 TAIFEX TX 這個訊號來源，也沒有任何錯誤訊息會顯示出來。
// 這裡直接檢查 worker.js 原始碼，確保每個被 functions/*.js 匯出、且前端有在打的
// 路徑都真的掛了路由，不會再靠人工肉眼核對漏掉。
test('worker.js routes /taifex-tx to functions/taifex-tx.js', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /from ["']\.\/functions\/taifex-tx\.js["']/, 'worker.js must import the taifex-tx handler');
  assert.match(worker, /url\.pathname === ["']\/taifex-tx["']/, 'worker.js must route GET /taifex-tx');
});

test('every functions/*.js file that index.html actually fetches is wired into worker.js', () => {
  const worker = fs.readFileSync('worker.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  // 前端會打的頂層（非 /api/）路徑；/api/* 由各自的 API 測試涵蓋。
  const topLevelRoutes = ['/quote', '/news', '/ask', '/dividend-schedule', '/daily-history', '/holiday-schedule', '/taifex-tx'];
  for (const route of topLevelRoutes) {
    const usedByFrontend = html.includes(`\`${route}?`) || html.includes(`"${route}"`) || html.includes(`= "${route}"`);
    assert.ok(usedByFrontend, `expected index.html to call ${route}`);
    assert.match(worker, new RegExp(`url\\.pathname === ["']${route.replace('/', '\\/')}["']`), `expected worker.js to route ${route}`);
  }
});

test('the taifex-tx handler is a real, callable async function with no required arguments', () => {
  assert.equal(typeof taifexTxHandler, 'function');
  assert.equal(taifexTxHandler.constructor.name, 'AsyncFunction');
  assert.equal(taifexTxHandler.length, 0);
});
