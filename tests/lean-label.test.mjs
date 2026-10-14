import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 明日預測：46–54% 以前一律寫「方向不明」，微弱傾向被藏起來。改成顯示「略偏漲／跌（不確定）」，
// 但只改顯示，不動 pred.direction（命中率與校準的口徑不變）。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <lean-label>([\s\S]*?)\/\/ <\/lean-label>/)?.[1];
assert.ok(block);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(block + '\nthis.leanLabel=leanLabel;', ctx);
const { leanLabel } = ctx;
const P = (direction, probability) => ({ direction, probability });

test('weak leans are shown but flagged as uncertain; clear calls and exact 50 are untouched', () => {
  assert.equal(leanLabel(P('方向不明', 54)), '略偏漲（不確定）');
  assert.equal(leanLabel(P('方向不明', 51)), '略偏漲（不確定）');
  assert.equal(leanLabel(P('方向不明', 46)), '略偏跌（不確定）');
  assert.equal(leanLabel(P('方向不明', 49)), '略偏跌（不確定）');
  assert.equal(leanLabel(P('方向不明', 50)), '方向不明');
  assert.equal(leanLabel(P('稍偏漲', 57)), '稍偏漲');
  assert.equal(leanLabel(P('明顯偏跌', 30)), '明顯偏跌');
  assert.equal(leanLabel(P('方向不明', 54.4)), '略偏漲（不確定）', 'uses the same whole-percent the card shows');
  assert.equal(leanLabel(null), undefined);
  assert.equal(leanLabel(P('方向不明', NaN)), '方向不明');
});

test('display only: the stored direction and the hit-rate filters still use the original 方向不明', () => {
  assert.match(html, /const toLabel=\(p\)=>p>=64\?"明顯偏漲":p>=55\?"稍偏漲":p<=36\?"明顯偏跌":p<=45\?"稍偏跌":"方向不明";/);
  assert.ok((html.match(/r\.direction!=="方向不明"/g) || []).length >= 3, 'accuracy filters unchanged');
  // 標籤只出現在顯示處與報告文字
  assert.equal((html.match(/leanLabel\(/g) || []).length >= 6, true);
  assert.ok(!/direction:leanLabel\(/.test(html), 'never written into a record');
  assert.match(html, /"略偏漲（不確定）": "Slight lean up \(uncertain\)"/);
  assert.match(html, /"略偏跌（不確定）": "Slight lean down \(uncertain\)"/);
});
