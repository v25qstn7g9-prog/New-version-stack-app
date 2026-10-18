import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 2026-10-18 兩次複查：今日變化標籤、英文介面固定標籤要有英文。
const src = readAppSource();
const fnSrc = (name) => { const a = src.indexOf(`function ${name}(`); return src.slice(a, src.indexOf('\n}\n', a) + 2); };

test('總覽今日變化：交易日標「今日」，休市日標「較 M/D」（今天之前最近一筆紀錄）', () => {
  const ctx = {}; vm.createContext(ctx); vm.runInContext(fnSrc('changeLabelDate'), ctx);
  const recs = [{ date: '2026-09-22' }, { date: '2026-09-23' }];
  assert.equal(ctx.changeLabelDate(recs, '2026-09-24', false), null, 'trading day, today not saved yet: still today');
  assert.equal(ctx.changeLabelDate([...recs, { date: '2026-09-24' }], '2026-09-24', false), null);
  assert.equal(ctx.changeLabelDate(recs, '2026-09-26', true), '9/23', 'weekend: compare with the last record');
  assert.equal(ctx.changeLabelDate([...recs, { date: '2026-09-26' }], '2026-09-26', true), '9/23', 'a record dated today is not the baseline');
  assert.equal(ctx.changeLabelDate([], '2026-09-26', true), null);
  assert.match(src, /changeDateLabel \? `較 \$\{changeDateLabel\}` : "今日"/);
  assert.doesNotMatch(src, /\$\{changeDateLabel\} 紀錄/);
});

test('英文介面：固定的中文標籤（UiLabel / Field / Panel / uiText）都要有英文', () => {
  const a = src.indexOf('const UI_EN = {'), b = src.indexOf('\n};', a);
  const dict = new Function('return ' + src.slice(a + 'const UI_EN = '.length, b + 2))();
  const lits = new Set();
  const res = [/<UiLabel zh="([^"]+)"/g, /<Field label="([^"]+)"/g, /<Panel title="([^"]+)"/g, /uiText\("([^"]+)"\)/g,
    /<UiLabel zh=\{[^}]*?\?\s*"([^"]+)"\s*:\s*"([^"]+)"\s*\}/g];
  for (const re of res) { let m; while ((m = re.exec(src))) for (const g of m.slice(1)) if (g && /[一-鿿]/.test(g)) lits.add(g); }
  const missing = [...lits].filter((x) => !dict[x]);
  assert.deepEqual(missing, []);
  assert.ok(dict['每股配息（新台幣）'], 'ternary Field label');
});
