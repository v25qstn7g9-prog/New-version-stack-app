import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/intraday-metrics.js';

// 迴歸測試：metricFor() 回傳時用了未定義的 `day`（應為 today），每個代號都丟 ReferenceError，
// /intraday-metrics 永遠回 {metrics:{}, errors:["2330: day is not defined", ...]}，
// 趨勢雷達的 RVOL / VWAP 因此一直是空的。
function yahooChart(days) {
  // days: [{ day:'2026-09-29', vol }]，每天 09:00–09:04 五根 1 分 K（台北時間）。
  const timestamp = [], close = [], high = [], low = [], volume = [];
  for (const { day, vol, px } of days) {
    for (let m = 0; m < 5; m++) {
      timestamp.push(Date.parse(`${day}T09:0${m}:00+08:00`) / 1000);
      close.push(px); high.push(px + 1); low.push(px - 1); volume.push(vol);
    }
  }
  return { chart: { result: [{ timestamp, indicators: { quote: [{ close, high, low, volume }] } }] } };
}

test('/intraday-metrics returns per-symbol metrics (day, vwap, rvol) instead of a ReferenceError', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(yahooChart([
    { day: '2026-09-29', vol: 100, px: 1000 },
    { day: '2026-09-30', vol: 100, px: 1000 },
    { day: '2026-10-01', vol: 200, px: 1010 },
  ]));
  try {
    const res = await onRequestGet({ request: new Request('https://x.test/intraday-metrics?symbols=2330') });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.errors, []);
    const m = body.metrics['2330'];
    assert.ok(m, 'expected metrics for 2330');
    assert.equal(m.day, '2026-10-01');
    assert.equal(m.lastMinute, 9 * 60 + 4);
    assert.equal(m.cumVolume, 1000);
    assert.equal(m.comparisonDays, 2);
    assert.equal(m.rvol, 2);
    assert.ok(Math.abs(m.vwap - 1010) < 1e-9);
  } finally {
    globalThis.fetch = original;
  }
});
