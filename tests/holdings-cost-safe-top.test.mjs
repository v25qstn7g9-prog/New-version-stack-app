import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');

test('holding cost card keeps total and per-share average on one mobile row', () => {
  const start = html.indexOf('className="holding-cost-summary text-xs mono mt-2"');
  const end = html.indexOf('<div className="flex justify-between text-xs mono mt-2">', start);
  const block = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(block, /holding-cost-primary grid grid-cols-2 gap-2/);
  assert.match(block, /<UiLabel zh="總持有成本" inline \/>/);
  assert.match(block, /<UiLabel zh="每股平均成本" inline \/>/);
  assert.doesNotMatch(block, /sm:grid-cols-2/);
});

test('transaction average is merged inside the same holding cost card', () => {
  const start = html.indexOf('className="holding-cost-summary text-xs mono mt-2"');
  const end = html.indexOf('<div className="flex justify-between text-xs mono mt-2">', start);
  const block = html.slice(start, end);
  assert.match(block, /holding-trade-average/);
  assert.match(block, /成交均價（不含手續費）/);
  assert.match(block, /—（尚無交易紀錄）/);
});

test('fullscreen app shell reserves iPhone top safe area globally', () => {
  assert.match(html, /className="min-h-screen font-sans premium-app-shell"/);
  assert.match(html, /\.premium-app-shell\{[\s\S]*padding-top:max\(env\(safe-area-inset-top, 0px\), 18px\)/);
  assert.match(html, /\.premium-header\{padding-top:12px!important\}/);
});
