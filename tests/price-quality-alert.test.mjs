// 盤中報價品質警示：持股連續 5 分鐘不是真實成交價就開一張系統健康卡，恢復就關（2026-10-27）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { priceQuality, nextQuality, recordIntradayMinute, QUALITY_STREAK } from '../functions/intraday.js';

const day = '2026-10-27';
const q = (priceSource, extra = {}) => ({ price: 100, isStale: false, asOfDate: '2026-10-27T02:00:00.000Z', priceSource, ...extra });

test('only real last trades count as good', () => {
  assert.deepEqual(priceQuality({ quotes: { a: q('last'), TAIEX: q('last') } }, ['a', 'TAIEX'], day), []);
  const bad = priceQuality({ quotes: { a: q('open'), b: q('last-seen'), c: q('last', { isStale: true }), d: q('mid') } }, ['a', 'b', 'c', 'd', 'e'], day);
  assert.deepEqual(bad, ['a 只有開盤價', 'b 一直沿用之前的成交價', 'c 過期（待更新）', 'd 來源 mid', 'e 沒有報價']);
});

test('the card opens once after 5 bad minutes in a row, and closes when prices are real again', () => {
  let st = undefined, actions = [];
  for (let i = 0; i < 7; i++) { const r = nextQuality(st, ['0050 只有開盤價'], `10:0${i}`); st = r.state; actions.push(r.action); }
  assert.deepEqual(actions, [null, null, null, null, 'open', null, null]);
  assert.equal(st.since, '10:00');
  const ok = nextQuality(st, [], '10:07');
  assert.equal(ok.action, 'close');
  assert.equal(ok.state.streak, 0);
  assert.equal(nextQuality(ok.state, [], '10:08').action, null);
  assert.equal(QUALITY_STREAK, 5);
});

test('runs inside the minute cron: 5 bad minutes call the card once, a good minute closes it', async () => {
  const data = new Map();
  const kv = { get: async (k) => data.get(k) ?? null, put: async (k, v) => { data.set(k, v); } };
  const calls = [];
  const run = (min, src) => recordIntradayMinute({ health_kv: kv, INTRADAY_SYMBOLS: '0050' }, {
    now: () => new Date(`2026-10-27T10:${String(min).padStart(2, '0')}:05+08:00`), marketClosed: async () => false, scanSymbols: async () => [],
    fetchQuotes: async () => ({ quotes: { '0050': { price: 107.1, isStale: false, asOfDate: `2026-10-27T02:${String(min).padStart(2, '0')}:00.000Z`, priceSource: src } } }),
    priceCard: async (open, detail) => { calls.push([open, detail]); },
  });
  for (let m = 0; m < 6; m++) await run(m, 'open');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], true);
  assert.match(calls[0][1], /10:00 起連續 5 分鐘：0050 只有開盤價/);
  await run(6, 'last');
  assert.deepEqual(calls[1], [false, '']);
});
