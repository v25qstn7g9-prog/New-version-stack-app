import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';
import { metricsFromChart } from '../functions/intraday-metrics.js';

// RVOL／VWAP 事後補值（因子收集檢查發現三天都是 0 筆）。
const src = readAppSource();
const block = src.match(/\/\/ <volume-backfill>([\s\S]*?)\/\/ <\/volume-backfill>/)[1];
const ctx = {}; vm.createContext(ctx);
vm.runInContext(block.replace(/async function backfillVolumePrice[\s\S]*$/, '') + ';this.volumeFromMetrics=volumeFromMetrics;this.volumeBackfillGroups=volumeBackfillGroups;', ctx);

const tp = (day, hhmm) => Date.parse(`${day}T${hhmm}:00+08:00`) / 1000;
function chart(days) {
  const timestamp = [], close = [], high = [], low = [], volume = [];
  for (const [day, vol] of days) for (let m = 0; m < 60; m++) {
    const hh = String(9 + Math.floor(m / 60)).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
    timestamp.push(tp(day, `${hh}:${mm}`)); close.push(100 + m / 10); high.push(100 + m / 10); low.push(100 + m / 10); volume.push(vol);
  }
  return { chart: { result: [{ timestamp, indicators: { quote: [{ close, high, low, volume }] } }] } };
}

test('server computes volume/VWAP as of a past day and minute, using only bars up to that minute', () => {
  const j = chart([['2026-10-15', 10], ['2026-10-16', 10], ['2026-10-19', 10], ['2026-10-20', 20], ['2026-10-21', 99]]);
  const m = metricsFromChart(j, { day: '2026-10-20', minute: 9 * 60 + 25 });
  assert.equal(m.day, '2026-10-20');
  assert.equal(m.lastMinute, 565);
  assert.equal(m.comparisonDays, 3, 'only days before 10/20 are compared');
  assert.ok(Math.abs(m.rvol - 2) < 1e-9, 'twice the usual volume by 09:25');
  assert.ok(m.lastClose < 103, 'no bars after 09:25 are used');
  assert.equal(metricsFromChart(j, { day: '2026-10-10', minute: 565 }), null, 'day outside the range: no data');
  assert.equal(metricsFromChart(j).day, '2026-10-21', 'without asOf it stays the live (latest day) calculation');
});

test('records with empty volume factors are grouped by day and minute; too-new, TAIEX and tried ones are skipped', () => {
  const now = Date.parse('2026-10-21T15:00:00+08:00');
  const rec = (day, sym, phase, hhmm, extra = {}) => ({ key: `${day}|${sym}|${phase}`, day, symbol: sym, phase, ts: `${day}T${hhmm}:00+08:00`, ...extra });
  const recs = [
    rec('2026-10-20', '0050', 'morning', '09:30'), rec('2026-10-20', '0056', 'morning', '09:30'),
    rec('2026-10-20', 'TAIEX', 'morning', '09:30'),
    rec('2026-10-20', '2330', 'closeLock', '13:30', { volumePrice: { rvol: 1.2, distPct: 0.1 } }),
    rec('2026-10-21', '0050', 'closeLock', '14:50'),
    rec('2026-10-21', '0056', 'morning', '09:05'),
  ];
  const g = ctx.volumeBackfillGroups(recs, new Set(['2026-10-21|0056|morning']), now);
  assert.equal(g.length, 1);
  assert.equal(g[0].day, '2026-10-20'); assert.equal(g[0].minute, 570);
  assert.deepEqual([...g[0].symbols].sort(), ['0050', '0056']);
});

test('volume fields come out the same shape the factor backtest reads', () => {
  const v = ctx.volumeFromMetrics({ vwap: 100, lastClose: 101, rvol: 1.5, comparisonDays: 4, lastMinute: 565, vwapSlopePct: 0.2 });
  assert.equal(v.rvol, 1.5); assert.ok(Math.abs(v.distPct - 1) < 1e-9); assert.equal(v.backfilled, true);
  assert.equal(ctx.volumeFromMetrics({ vwap: 100, lastClose: 101, rvol: 1.5, comparisonDays: 1 }).rvol, null, 'RVOL needs 2+ comparison days');
  assert.equal(ctx.volumeFromMetrics({}), null);
});
