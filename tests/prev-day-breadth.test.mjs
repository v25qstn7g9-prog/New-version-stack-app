import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prevDayBreadth, onRequestGet } from '../functions/market-breadth.js';

// 當天的全市場廣度（TWSE MI_INDEX）收盤後才公布，上午與 13:25 的快照永遠拿不到 → 因子回測 n=0。
// 改記「開盤前已定案」的前一交易日廣度（研究用，不進模型）。
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('prevDayBreadth: most recent trading day strictly before the date, skipping weekends and holidays', async () => {
  const asked = [];
  const table = { '2026-10-12': { up: 600, down: 300, flat: 100, breadth: 0.6 } }; // 10/9 國慶補假：沒有表
  const out = await prevDayBreadth('2026-10-13', { breadthOn: async (d) => { asked.push(d); return table[d] || null; } });
  assert.equal(out.available, true);
  assert.equal(out.day, '2026-10-12');
  assert.equal(out.breadth, 0.6);
  assert.deepEqual(asked, ['2026-10-12'], 'never asks for the target day itself');
  const asked2 = [];
  const out2 = await prevDayBreadth('2026-10-12', { breadthOn: async (d) => { asked2.push(d); return d === '2026-10-08' ? { up: 1, down: 1, flat: 0, breadth: 0.5 } : null; } });
  assert.equal(out2.day, '2026-10-08');
  assert.deepEqual(asked2, ['2026-10-09', '2026-10-08'], 'weekend skipped, holiday 10/9 falls through to 10/8');
});

test('prevDayBreadth: TWSE unreachable → available:false (never a guessed value)', async () => {
  let n = 0;
  const out = await prevDayBreadth('2026-10-13', { breadthOn: async () => { n++; throw new Error('down'); } });
  assert.equal(out.available, false);
  assert.ok(n <= 2, 'gives up quickly instead of hammering TWSE');
});

test('/market-breadth?before= validates the date', async () => {
  const res = await onRequestGet({ request: new Request('https://x.test/market-breadth?before=10-13') });
  assert.equal(res.status, 400);
});

test('the radar records the prior-day breadth and the backtest uses it instead of the never-available same-day breadth', () => {
  assert.match(html, /\/market-breadth\?before=\$\{todayKey\}/);
  assert.equal((html.match(/breadthPrev:prevBreadth,/g) || []).length, 2, 'morning + closeLock');
  assert.match(html, /if\(!rec\.breadthPrev&&prevBreadth\) rec\.breadthPrev=prevBreadth;/);
  assert.match(html, /\["前日全市場廣度", \(r\) => r\.breadthPrev\?\.breadth\]/);
  assert.doesNotMatch(html, /\["市場廣度", \(r\) => r\.breadthSource==="market"/);
});
