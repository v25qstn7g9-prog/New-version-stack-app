import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 首次使用引導：空帳戶首頁有「新增第一筆持股」按鈕、備份提醒等有資料才出現、
// 趨勢雷達沒內容時說明缺哪些資料。
const src = readAppSource();
const slice = (name) => {
  const a = src.indexOf(`function ${name}(`);
  assert.ok(a > 0, `${name} exists`);
  return src.slice(a, src.indexOf('\nfunction ', a + 10));
};

test('empty account: dashboard shows the first-holding guide with a real button', () => {
  assert.match(src, /const firstRun = holdings\.length === 0 && dailyRecords\.length === 0;/);
  assert.match(slice('Dashboard'), /\{firstRun && onAddHolding && <FirstRunGuide /);
  const guide = slice('FirstRunGuide');
  assert.match(guide, /<button type="button" onClick=\{onAddHolding\}/);
  assert.match(guide, /新增第一筆持股/);
  // 按鈕要帶到台股的新增表單代號欄
  assert.match(src, /setHoldingsMarket\("tw"\); goToTab\("holdings"\);/);
  assert.match(src, /document\.querySelector\("\[data-add-holding-symbol\]"\)/);
  assert.match(slice('HoldingsPanel'), /<input value=\{form\.symbol\} data-add-holding-symbol/);
});

test('backup banner waits until there is data to back up', () => {
  assert.match(src, /const showBackupBanner = backupOverdue && hasUserData;/);
  assert.match(src, /<Header [^>]*backupOverdue=\{showBackupBanner\}/);
  // 計畫設定的備份卡仍用原本的 backupOverdue
  assert.match(src, /lastBackupAt=\{lastBackupAt\} backupAgeDays=\{backupAgeDays\} backupOverdue=\{backupOverdue\}/);
});

test('trend radar explains what is missing instead of rendering blank', () => {
  assert.match(slice('TrendRadar'), /if\(!embedded\) return null;\s*return <TrendRadarEmpty /);
  const fnSrc = slice('trendRadarMissing');
  const ctx = { isTaiwanSymbol: (s) => /^\d/.test(String(s)) };
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);
  assert.deepEqual({ ...ctx.trendRadarMissing([]) }, { reason: 'no-holdings', count: 0 });
  assert.deepEqual({ ...ctx.trendRadarMissing([{ symbol: 'VOO', current: 5 }]) }, { reason: 'no-holdings', count: 0 });
  assert.deepEqual({ ...ctx.trendRadarMissing([{ symbol: '0056', current: 0 }]) }, { reason: 'no-shares', count: 1 });
  assert.deepEqual({ ...ctx.trendRadarMissing([{ symbol: '0056', current: 10 }, { symbol: '2330', current: 0 }]) }, { reason: 'loading', count: 1 });
});
