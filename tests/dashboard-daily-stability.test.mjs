import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html','utf8');

test('dashboard live quote refresh keeps a stable vertical footprint', () => {
  assert.match(html, /.premium-dashboard{gap:.46rem;--label-muted:#8390a6;overflow-anchor:none}/);
  const panelStart = html.indexOf('function LivePricePanel');
  const panelEnd = html.indexOf('\nfunction ', panelStart + 20);
  const panel = html.slice(panelStart, panelEnd);
  assert.doesNotMatch(panel, /Fetch failed: ${failedSymbols/);
  assert.doesNotMatch(panel, /顯示上次成功報價：/);
  assert.match(panel, /台股部分沿用上次報價/);
});

test('Daily record uses a fixed market-value and cost grid without transient helper blocks', () => {
  const start = html.indexOf('function DailyPanel');
  const end = html.indexOf('\nfunction ', start + 20);
  const panel = html.slice(start, end);
  assert.match(panel, /daily-fixed-values grid grid-cols-2 gap-2/);
  for (const label of ['台股市值','美股市值','台股成本','美股成本']) assert.match(panel, new RegExp(label));
  assert.doesNotMatch(panel, /現在是盤中，市值還會變動；收盤/);
  assert.doesNotMatch(panel, /報價暫時抓不到，台股市值請手動輸入/);
  assert.doesNotMatch(panel, /sourceNote\(key\) &&/);
  assert.match(panel, /<UiLabel zh="重新抓報價" inline \/>/);
});
