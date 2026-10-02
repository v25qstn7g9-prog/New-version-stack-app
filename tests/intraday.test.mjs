import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTRADAY_CRON, isRecordingWindow, buildMinuteBar, mergeBar, aggregateBars,
  usablePrices, recordIntradayMinute, readIntradayBars, intradaySymbols, readIntradayHealth,
} from '../functions/intraday.js';
import { PREPARED_ASSET_TOOLS } from '../functions/ai-connector-prepared.js';
import { readFileSync } from 'node:fs';

// quote.js 用 caches.default；Node 沒有 → 永遠 miss。
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

// 2026-10-01 是週四；台北 = UTC+8。
const at = (iso) => () => new Date(iso);

function fakeKV() {
  const data = new Map();
  const puts = [];
  return {
    data, puts,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v, opts) => { data.set(k, v); puts.push({ k, opts }); },
  };
}

const q = (price, asOfDate, extra = {}) => ({ price, asOfDate, isStale: false, ...extra });

// ── 時間窗 ─────────────────────────────────────────────

test('recording window: Taipei Mon-Fri 09:00-13:30 only', () => {
  assert.equal(isRecordingWindow(new Date('2026-10-01T00:59:00Z')), false); // 08:59
  assert.equal(isRecordingWindow(new Date('2026-10-01T01:00:00Z')), true);  // 09:00
  assert.equal(isRecordingWindow(new Date('2026-10-01T05:30:00Z')), true);  // 13:30
  assert.equal(isRecordingWindow(new Date('2026-10-01T05:31:00Z')), false); // 13:31
  assert.equal(isRecordingWindow(new Date('2026-10-03T02:00:00Z')), false); // 週六
  assert.equal(isRecordingWindow(new Date('2026-10-04T02:00:00Z')), false); // 週日
});

test('cron string stays in sync with wrangler.jsonc (default and production)', () => {
  const wrangler = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const hits = wrangler.split(`"${INTRADAY_CRON}"`).length - 1;
  assert.equal(hits, 2, 'default + production triggers should both list the intraday cron');
});

// ── 純函式 ─────────────────────────────────────────────

test('buildMinuteBar: OHLC from samples, ignores invalid prices', () => {
  assert.deepEqual(buildMinuteBar('09:05', [56.7, 56.9, 56.5, 56.6]), ['09:05', 56.7, 56.9, 56.5, 56.6, 4]);
  assert.deepEqual(buildMinuteBar('09:05', [NaN, 0, 56.7]), ['09:05', 56.7, 56.7, 56.7, 56.7, 1]);
  assert.equal(buildMinuteBar('09:05', []), null);
  assert.equal(buildMinuteBar('09:05', [NaN, -1]), null);
});

test('mergeBar replaces the same minute and keeps time order', () => {
  let rows = [];
  rows = mergeBar(rows, ['09:02', 1, 1, 1, 1, 4]);
  rows = mergeBar(rows, ['09:00', 1, 1, 1, 1, 4]);
  rows = mergeBar(rows, ['09:02', 2, 2, 2, 2, 4]);
  assert.deepEqual(rows.map((r) => r[0]), ['09:00', '09:02']);
  assert.equal(rows[1][1], 2);
});

test('aggregateBars: 5-minute candles aligned to 09:00', () => {
  const rows = [
    ['09:00', 10, 11, 9, 10.5, 4],
    ['09:01', 10.5, 12, 10, 11, 4],
    ['09:04', 11, 11.5, 10.8, 11.2, 4],
    ['09:05', 11.2, 11.3, 10.9, 11.0, 4],
    ['09:09', 11.0, 11.1, 10.5, 10.6, 3],
  ];
  assert.deepEqual(aggregateBars(rows, 5), [
    { time: '09:00', open: 10, high: 12, low: 9, close: 11.2, samples: 12, minutes: 3 },
    { time: '09:05', open: 11.2, high: 11.3, low: 10.5, close: 10.6, samples: 7, minutes: 2 },
  ]);
  // 10 分 K 把兩根合成一根；15 分 K 同理
  const ten = aggregateBars(rows, 10);
  assert.equal(ten.length, 1);
  assert.deepEqual([ten[0].open, ten[0].high, ten[0].low, ten[0].close], [10, 12, 9, 10.6]);
  assert.equal(aggregateBars(rows, 15).length, 1);
  assert.equal(aggregateBars(rows, 1).length, 5);
  assert.deepEqual(aggregateBars([], 5), []);
});

test('aggregateBars: afternoon bucket keeps 09:00 alignment', () => {
  const rows = [['13:28', 5, 5, 5, 5, 4], ['13:30', 6, 6, 6, 6, 4]];
  // 13:30 剛好是下一個 15 分鐘格的起點（09:00 + 270 分鐘），收盤那一分鐘自成一根。
  assert.deepEqual(aggregateBars(rows, 15).map((b) => b.time), ['13:15', '13:30']);
  assert.deepEqual(aggregateBars(rows, 5).map((b) => b.time), ['13:25', '13:30']);
});

test('usablePrices drops stale, invalid and not-today quotes (holiday guard)', () => {
  const data = { quotes: {
    '0056': q(56.7, '2026-10-01T04:13:28.000Z'),
    '0050': q(112, '2026-10-01T04:13:28.000Z', { isStale: true }),
    '2330': q(2500, '2026-09-30T05:30:00.000Z'),   // 昨天的資料
    TAIEX: q(0, '2026-10-01T04:13:28.000Z'),
    '1101': { price: 40 },                          // 沒有時間戳
  } };
  assert.deepEqual(usablePrices(data, '2026-10-01'), { '0056': 56.7 });
  assert.deepEqual(usablePrices(null, '2026-10-01'), {});
});

test('intradaySymbols: defaults, env override, sanitising', () => {
  assert.deepEqual(intradaySymbols({}), ['0050', '0056', '2330', 'TAIEX']);
  assert.deepEqual(intradaySymbols({ INTRADAY_SYMBOLS: '0056, 2317 ,bad symbol,0056' }), ['0056', '2317']);
  assert.deepEqual(intradaySymbols({ INTRADAY_SYMBOLS: '!!!' }), ['0050', '0056', '2330', 'TAIEX']);
});

// ── 寫入 ───────────────────────────────────────────────

test('recordIntradayMinute: one quote per run becomes one 1-minute bar, one KV write, no sleeping', async () => {
  const kv = fakeKV();
  let calls = 0; let slept = 0;
  const res = await recordIntradayMinute({ health_kv: kv, INTRADAY_SYMBOLS: '0056' }, {
    now: at('2026-10-01T04:13:05Z'), // 12:13
    sleep: async () => { slept += 1; },
    fetchQuotes: async () => { calls += 1; return { quotes: { '0056': q(56.7, '2026-10-01T04:13:00.000Z') } }; },
  });
  assert.deepEqual(res, { ok: true, recorded: ['0056'], minute: '12:13' });
  assert.equal(calls, 1);
  assert.equal(slept, 0); // cron 內不可 sleep，免費方案會在寫入前被中斷
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].k, 'intraday:2026-10-01');
  assert.equal(kv.puts[0].opts.expirationTtl, 60 * 60 * 36);
  const doc = JSON.parse(kv.data.get('intraday:2026-10-01'));
  assert.deepEqual(doc.bars['0056'], [['12:13', 56.7, 56.7, 56.7, 56.7, 1]]);
});

test('recordIntradayMinute: later minutes append, repeated minute overwrites', async () => {
  const kv = fakeKV();
  const run = (iso, price) => recordIntradayMinute({ health_kv: kv, INTRADAY_SYMBOLS: '0056' }, {
    now: at(iso), sleep: async () => {},
    fetchQuotes: async () => ({ quotes: { '0056': q(price, iso) } }),
  });
  await run('2026-10-01T04:13:05Z', 56.7);
  await run('2026-10-01T04:14:05Z', 56.8);
  await run('2026-10-01T04:14:30Z', 56.9); // 同一分鐘再跑 → 覆寫
  const rows = JSON.parse(kv.data.get('intraday:2026-10-01')).bars['0056'];
  assert.deepEqual(rows.map((r) => [r[0], r[4]]), [['12:13', 56.7], ['12:14', 56.9]]);
});

test('recordIntradayMinute: skips outside hours, on stale/holiday data, and without KV', async () => {
  const kv = fakeKV();
  const fetchQuotes = async () => ({ quotes: { '0056': q(56.7, '2026-09-30T05:30:00.000Z') } });
  assert.deepEqual(
    await recordIntradayMinute({ health_kv: kv }, { now: at('2026-10-01T09:00:00Z'), sleep: async () => {}, fetchQuotes }),
    { ok: true, skipped: 'outside_market_hours' },
  );
  assert.deepEqual(
    await recordIntradayMinute({ health_kv: kv }, { now: at('2026-10-01T04:13:05Z'), sleep: async () => {}, fetchQuotes }),
    { ok: true, skipped: 'no_fresh_quotes' },
  );
  assert.equal(kv.puts.length, 0);
  assert.deepEqual(await recordIntradayMinute({}, { now: at('2026-10-01T04:13:05Z') }), { ok: false, reason: 'no_kv' });
});

test('recordIntradayMinute: a failing quote fetch writes nothing and does not throw', async () => {
  const kv = fakeKV();
  const res = await recordIntradayMinute({ health_kv: kv, INTRADAY_SYMBOLS: '0056' }, {
    now: at('2026-10-01T04:13:05Z'), sleep: async () => {},
    fetchQuotes: async () => { throw new Error('boom'); },
  });
  assert.deepEqual(res, { ok: true, skipped: 'no_fresh_quotes' });
  assert.equal(kv.puts.length, 0);
});

// ── 讀取 ───────────────────────────────────────────────

test('readIntradayBars: aggregates stored 1-minute bars, reports coverage and missing symbols', async () => {
  const kv = fakeKV();
  kv.data.set('intraday:2026-10-01', JSON.stringify({ v: 1, day: '2026-10-01', bars: {
    '0056': [['09:00', 10, 11, 9, 10.5, 4], ['09:04', 10.5, 12, 10, 11, 4], ['09:05', 11, 11, 10, 10, 4]],
  } }));
  const res = await readIntradayBars({ health_kv: kv }, { symbols: ['0056', '2330'], interval: 5 }, new Date('2026-10-01T05:00:00Z'));
  assert.equal(res.ok, true);
  assert.equal(res.found, true);
  assert.equal(res.day, '2026-10-01');
  assert.deepEqual(res.bars['0056'].map((b) => [b.time, b.open, b.high, b.low, b.close]), [
    ['09:00', 10, 12, 9, 11], ['09:05', 11, 11, 10, 10],
  ]);
  assert.deepEqual(res.recorded['0056'], { firstMinute: '09:00', lastMinute: '09:05', oneMinuteBars: 3 });
  assert.deepEqual(res.missing, ['2330']);

  const limited = await readIntradayBars({ health_kv: kv }, { interval: 5, limit: 1 }, new Date('2026-10-01T05:00:00Z'));
  assert.equal(limited.bars['0056'].length, 1);
  assert.equal(limited.bars['0056'][0].time, '09:05');
});

test('readIntradayBars: no data → found:false with an explicit reason, never fabricated', async () => {
  const res = await readIntradayBars({ health_kv: fakeKV() }, {}, new Date('2026-10-01T05:00:00Z'));
  assert.equal(res.ok, true);
  assert.equal(res.found, false);
  assert.match(res.reason, /沒有任何盤中紀錄/);
  assert.equal(res.bars, undefined);
});

test('readIntradayBars: rejects bad interval and missing KV', async () => {
  assert.equal((await readIntradayBars({ health_kv: fakeKV() }, { interval: 7 })).ok, false);
  assert.equal((await readIntradayBars({}, {})).ok, false);
});

// ── 健康摘要 ────────────────────────────────────────────

test('readIntradayHealth: healthy when all symbols are current and continuous', async () => {
  const kv = fakeKV();
  kv.data.set('intraday:2026-10-01', JSON.stringify({ v: 1, day: '2026-10-01', bars: {
    '0050': [['09:00', 1,1,1,1,1], ['09:01', 1,1,1,1,1], ['09:02', 1,1,1,1,1]],
    '0056': [['09:00', 1,1,1,1,1], ['09:01', 1,1,1,1,1], ['09:02', 1,1,1,1,1]],
    '2330': [['09:00', 1,1,1,1,1], ['09:01', 1,1,1,1,1], ['09:02', 1,1,1,1,1]],
    TAIEX: [['09:00', 1,1,1,1,1], ['09:01', 1,1,1,1,1], ['09:02', 1,1,1,1,1]],
  } }));
  const h = await readIntradayHealth({ health_kv: kv }, new Date('2026-10-01T01:03:00Z')); // 09:03
  assert.equal(h.status, 'healthy');
  assert.equal(h.lastMinute, '09:02');
  assert.equal(h.lagMinutes, 1);
  assert.equal(h.totalGaps, 0);
  assert.deepEqual(h.missingSymbols, []);
  assert.equal(h.symbols['0050'].bars, 3);
});

test('readIntradayHealth: degraded on gaps, missing symbols or stale collection', async () => {
  const kv = fakeKV();
  kv.data.set('intraday:2026-10-01', JSON.stringify({ v: 1, day: '2026-10-01', bars: {
    '0050': [['09:00', 1,1,1,1,1], ['09:02', 1,1,1,1,1]],
  } }));
  const h = await readIntradayHealth({ health_kv: kv }, new Date('2026-10-01T01:10:00Z')); // 09:10
  assert.equal(h.status, 'degraded');
  assert.equal(h.lastMinute, '09:02');
  assert.equal(h.lagMinutes, 8);
  assert.equal(h.totalGaps, 1);
  assert.deepEqual(h.missingSymbols, ['0056', '2330', 'TAIEX']);
});

test('readIntradayHealth: pre-market without data is idle, missing KV is unavailable', async () => {
  const idle = await readIntradayHealth({ health_kv: fakeKV() }, new Date('2026-10-01T00:30:00Z'));
  assert.equal(idle.status, 'idle');
  const unavailable = await readIntradayHealth({}, new Date('2026-10-01T01:10:00Z'));
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 'unavailable');
});

// ── MCP 工具 ───────────────────────────────────────────

test('MCP exposes intraday_bars as a read-only tool with a bounded schema', () => {
  const tool = PREPARED_ASSET_TOOLS.find((t) => t.name === 'intraday_bars');
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.inputSchema.properties.interval.enum, [1, 5, 10, 15, 30, 60]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});
