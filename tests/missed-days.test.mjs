import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 自動補記做不到的缺漏日（期間有買賣等）：請使用者按一下，用「當天持股 × 當天收盤價」補。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <missed-days>([\s\S]*?)\/\/ <\/missed-days>/)?.[1];
assert.ok(block, 'missed-days block must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.missedWeekdays=missedWeekdays;this.planMissedDays=planMissedDays;', ctx);
const { missedWeekdays, planMissedDays } = ctx;
const plain = (v) => JSON.parse(JSON.stringify(v));
const rec = (date) => ({ date, twValue: 1 });

test('missedWeekdays: weekdays between the last record and today, never today, weekends or known holidays', () => {
  // last record Fri 10/2, today Thu 10/8 -> Mon..Wed
  assert.deepEqual(plain(missedWeekdays([rec('2026-10-02')], '2026-10-08', () => false)), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepEqual(plain(missedWeekdays([rec('2026-10-02')], '2026-10-08', (d) => d === '2026-10-06')), ['2026-10-05', '2026-10-07']);
  assert.deepEqual(plain(missedWeekdays([rec('2026-10-02'), rec('2026-10-06')], '2026-10-08', () => false)), ['2026-10-07'], 'only after the LAST record; a day with a record is never listed');
  assert.deepEqual(plain(missedWeekdays([rec('2026-10-07')], '2026-10-08', () => false)), []);
  assert.deepEqual(plain(missedWeekdays([], '2026-10-08', () => false)), [], 'no anchor, no prompt');
  assert.deepEqual(plain(missedWeekdays([rec('2026-10-07')], '2026-10-12', () => false)), ['2026-10-08', '2026-10-09']);
});

test('missedWeekdays caps a very long absence', () => {
  assert.equal(missedWeekdays([rec('2026-01-02')], '2026-10-08', () => false).length, 20);
});

// holdingCostAt stand-in: shares by date, cost proportional
const costFn = (h, trades, d) => {
  const bought = (trades || []).filter((t) => t.symbol === h.symbol && t.date <= d).reduce((s, t) => s + t.shares, 0);
  const shares = h.initialShares + bought;
  return { current: shares, estCostBasis: shares * h.unitCost };
};
const holdings = [{ symbol: '0050', initialShares: 1000, unitCost: 100 }, { symbol: '0056', initialShares: 5000, unitCost: 30 }];
const closes = { '0050': { '2026-10-05': 200, '2026-10-06': 202, '2026-10-07': 204 }, '0056': { '2026-10-05': 36, '2026-10-06': 36.5, '2026-10-07': 37 } };
const last = { date: '2026-10-02', usValue: 7000, usCost: 6000 };

test('plan uses the shares held on each date, so a buy in the gap only counts from its own day', () => {
  const trades = [{ symbol: '0050', date: '2026-10-06', shares: 500, action: 'buy' }];
  const p = plain(planMissedDays({ days: ['2026-10-05', '2026-10-06', '2026-10-07'], holdings, trades, closes, last, costFn }));
  assert.deepEqual(p.records.map((r) => [r.date, r.twValue, r.twCost]), [
    ['2026-10-05', 1000 * 200 + 5000 * 36, 1000 * 100 + 5000 * 30],
    ['2026-10-06', 1500 * 202 + 5000 * 36.5, 1500 * 100 + 5000 * 30],
    ['2026-10-07', 1500 * 204 + 5000 * 37, 1500 * 100 + 5000 * 30],
  ]);
  assert.ok(p.records.every((r) => r.source === 'auto' && r.usValue === 7000 && r.usCost === 6000), 'US figures carry over from the last record');
  assert.deepEqual(p.closed, []);
  assert.deepEqual(p.partial, []);
});

test('a day with no closing price for any holding is "closed" (holiday), not filled and not a gap to nag about', () => {
  const p = plain(planMissedDays({ days: ['2026-10-05', '2026-10-09'], holdings, trades: [], closes, last, costFn }));
  assert.deepEqual(p.records.map((r) => r.date), ['2026-10-05']);
  assert.deepEqual(p.closed, ['2026-10-09']);
});

test('a day where only some holdings have a price is "partial" and is never recorded with a short total', () => {
  const c = { ...closes, '0056': { '2026-10-05': 36 } };
  const p = plain(planMissedDays({ days: ['2026-10-05', '2026-10-06'], holdings, trades: [], closes: c, last, costFn }));
  assert.deepEqual(p.records.map((r) => r.date), ['2026-10-05']);
  assert.deepEqual(p.partial, ['2026-10-06']);
});

test('holdings not yet owned on a date (bought later) are ignored for that date', () => {
  const hs = [...holdings, { symbol: '2330', initialShares: 0, unitCost: 1000 }];
  const trades = [{ symbol: '2330', date: '2026-10-07', shares: 10, action: 'buy' }];
  const c = { ...closes, '2330': { '2026-10-07': 1100 } };
  const p = plain(planMissedDays({ days: ['2026-10-05', '2026-10-07'], holdings: hs, trades, closes: c, last, costFn }));
  assert.equal(p.records[0].twValue, 1000 * 200 + 5000 * 36, '10/5: 2330 not held yet and has no price, still recorded');
  assert.equal(p.records[1].twValue, 1000 * 204 + 5000 * 37 + 10 * 1100);
});

test('wiring: banner mounted after the auto backfill settles, US holders excluded, one prompt per day', () => {
  assert.ok(html.includes('<MissedDaysBanner days={missedHiddenDay === todayStr() ? [] : missedDays}'));
  assert.ok(html.includes('(ready && backfillSettled && !usHoldings.some((h) => h.shares > 0))'));
  assert.ok(html.includes('costFn: holdingCostAt'));
  assert.ok(html.includes('{ setBackfillSettled(true); return; }'));
  assert.ok(html.includes('finally { setBackfillSettled(true); }'));
});
