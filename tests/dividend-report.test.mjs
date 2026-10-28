import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 股息報表（參考 Sharesight）：只讀配息紀錄與持有成本算出來，不改任何既有數字。
const src = readAppSource();
const block = src.match(/\/\/ <dividend-report>([\s\S]*?)\/\/ <\/dividend-report>/)[1];
const ctx = { normalizeStockSymbol: (s) => String(s || '').trim().toUpperCase() }; vm.createContext(ctx);
vm.runInContext(block + ';this.dividendReport=dividendReport;', ctx);
const { dividendReport } = ctx;

const divs = [
  { date: '2024-11-20', symbol: '0056', amount: 5000 },   // 前 12 個月
  { date: '2025-01-16', symbol: '0056', amount: 40000 },  // 去年同期、前 12 個月
  { date: '2025-10-20', symbol: '0056', amount: 50000 },  // 去年同期、前 12 個月（10/28 以前）
  { date: '2025-11-18', symbol: '0050', amount: 7000 },   // 近 12 個月（10/28 之後），不算去年同期
  { date: '2026-01-15', symbol: '0056', amount: 60000 },
  { date: '2026-07-17', symbol: '0050', amount: 8000 },
  { date: '2026-10-21', symbol: '0056', amount: 70000 },
  { date: '2026-12-01', symbol: '0056', amount: 999 },    // 未來的不算進今年已領
];
const holdings = [
  { symbol: '0056', name: '元大高股息', estCostBasis: 3372460 },
  { symbol: '0050', name: '元大台灣50', estCostBasis: 406665 },
  { symbol: '2330', name: '台積電', estCostBasis: 83492 },   // 沒有配息紀錄：不列
];

test('今年已領對比去年同一段時間，近 12 個月對比前 12 個月', () => {
  const r = dividendReport(divs, holdings, '2026-10-28');
  assert.equal(r.year, 2026);
  assert.equal(r.thisYear, 138000);
  assert.equal(r.lastYearSame, 90000);
  assert.equal(r.lastYearFull, 97000);
  assert.ok(Math.abs(r.ytdGrowthPct - 53.333) < 0.01);
  assert.equal(r.ttm, 7000 + 138000);
  assert.equal(r.ttmPrev, 5000 + 40000 + 50000);
});

test('今年每月入帳：12 格，照入帳月份加總', () => {
  const r = dividendReport(divs, holdings, '2026-10-28');
  assert.equal(r.months.length, 12);
  assert.equal(r.months[0], 60000);
  assert.equal(r.months[6], 8000);
  assert.equal(r.months[9], 70000);
  assert.equal(r.months[11], 999, '已輸入的未來配息仍顯示在月份格');
});

test('成本殖利率 = 近 12 個月股息 ÷ 目前持股的持有成本；沒配息的持股不列', () => {
  const r = dividendReport(divs, holdings, '2026-10-28');
  assert.deepEqual(r.rows.map((x) => x.symbol), ['0056', '0050']);
  assert.ok(Math.abs(r.rows[0].yoc - (130000 / 3372460) * 100) < 1e-9);
  assert.ok(Math.abs(r.rows[1].yoc - (15000 / 406665) * 100) < 1e-9);
  assert.ok(Math.abs(r.yocPct - (145000 / (3372460 + 406665)) * 100) < 1e-9);
});

test('去年同期是 0 時不顯示成長率；沒有配息紀錄就不顯示報表', () => {
  const r = dividendReport([{ date: '2026-01-15', symbol: '0056', amount: 100 }], [], '2026-10-28');
  assert.equal(r.ytdGrowthPct, null);
  assert.equal(r.yocPct, null);
  assert.equal(dividendReport([], holdings, '2026-10-28').hasData, false);
});

test('股息報表放在配息頁的歷史圖表上方', () => {
  assert.match(src, /<DividendReport dividends=\{dividends\} holdings=\{holdings\} \/>\s*\n\s*<DividendHistoryChart/);
});
