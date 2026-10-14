import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../forecast-core.js';

// 因子回測全面盤查（10/14）：資料明明有抓，卻沒進紀錄的因子。
const F = globalThis.ZinfForecast;
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('RVOL / VWAP: Yahoo Taiwan minute data is 20 minutes behind, so the 3-minute model gate rejects it all session', () => {
  const now = new Date('2026-10-14T01:30:00Z'); // 09:30 台北
  const delayed = { day: '2026-10-14', lastMinute: 9 * 60 + 10 }; // Yahoo 09:30 時只到 09:10
  assert.equal(F.metricsFresh(delayed, now), false, 'model gate unchanged (prediction unaffected)');
  assert.equal(F.metricsFresh(delayed, now, 25), true, 'the research record accepts the 20-minute-delayed feed');
  assert.equal(F.metricsFresh({ day: '2026-10-13', lastMinute: 800 }, now, 25), false, 'never yesterday’s metrics');
  assert.equal(F.metricsFresh({ day: '2026-10-14', lastMinute: 9 * 60 }, now, 25), false, 'more than 25 minutes behind is not used');
});

test('radar records store the record-only volume/price signal and fill it once it loads; the model keeps the strict one', () => {
  assert.match(html, /intradayMetricsRecord=.*F\.metricsFresh\(m,now,25\)/);
  assert.match(html, /const volumePrice=volumePriceSignal\(h\.symbol,q,stockPct\);/, 'model input unchanged');
  assert.equal((html.match(/volumePrice:r\.volumePriceRecord\|\|r\.volumePrice/g) || []).length, 2, 'morning + closeLock records');
  assert.match(html, /rec\.volumePrice\?\.rvol==null&&rec\.volumePrice\?\.distPct==null&&r\.volumePriceRecord\?\.available&&stamp\.getTime\(\)-Date\.parse\(rec\.ts\)<=30\*60000/);
});

test('factor backtest ignores institutional zeros written before the institutional data loaded', () => {
  assert.match(html, /const instOf = \(r, k\) => \(r\.instLoaded === false \? null : r\.inst\?\.\[k\]\);/);
  for (const k of ['f1', 'f3', 'f5', 't1', 't3', 't5', 'd1', 'd3', 'd5']) assert.ok(html.includes(`instOf(r, "${k}")`), k);
});
