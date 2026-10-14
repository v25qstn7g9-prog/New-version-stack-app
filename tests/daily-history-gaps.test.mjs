import test from 'node:test';
import assert from 'node:assert/strict';
import { findDailyGaps, onRequestGet } from '../functions/daily-history.js';

// 10/13 Yahoo 日K 缺了 0050、0056（台積電、大盤都有）→ 用伺服器自己記的盤中資料補。
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const bar = (day, c) => ({ day, open: c, high: c, low: c, close: c });

test('findDailyGaps: a day other symbols traded but this one is missing (recent, completed days only)', () => {
  const bars = {
    TAIEX: [bar('2026-10-08', 1), bar('2026-10-12', 1), bar('2026-10-13', 1), bar('2026-10-14', 1)],
    '2330': [bar('2026-10-08', 1), bar('2026-10-12', 1), bar('2026-10-13', 1)],
    '0050': [bar('2026-10-08', 1), bar('2026-10-12', 1)],
    'NEW1': [bar('2026-10-12', 1), bar('2026-10-13', 1)],
  };
  assert.deepEqual(findDailyGaps(bars, '2026-10-14'), [{ sym: '0050', day: '2026-10-13' }], 'today is never a gap; days before a listing are not gaps');
});

test('/daily-history fills the missing day from the recorded intraday bars, marked as such', async () => {
  const real = globalThis.fetch;
  const days = ['2026-10-08', '2026-10-12', '2026-10-13'];
  const chart = (closes) => ({ chart: { result: [{ timestamp: days.map((d) => Date.parse(d + 'T01:00:00Z') / 1000), indicators: { quote: [{ open: closes, high: closes, low: closes, close: closes, volume: closes.map((c) => (c ? 1000 : null)) }] } }] } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('%5ETWII')) return Response.json(chart([100, 101, 102]));
    if (u.includes('0050.TW')) return Response.json(chart([115, 114.8, null]));
    return new Response('x', { status: 503 });
  };
  const read = async (env, { symbols, date }) => ({
    found: true, bars: { '0050': [{ time: '09:00', open: 113, high: 113.5, low: 112, close: 112.5 }, { time: '13:00', open: 112.5, high: 112.6, low: 112.3, close: 112.4 }] },
    recorded: { '0050': { lastMinute: '13:45' } }, asked: { symbols, date },
  });
  try {
    const res = await onRequestGet({ request: new Request('https://x.test/daily-history?symbols=TAIEX,0050'), env: { health_kv: {} }, readIntradayBars: read });
    const body = await res.json();
    const b = body.bars['0050'].find((x) => x.day === '2026-10-13');
    assert.ok(b, 'gap filled');
    assert.deepEqual([b.open, b.high, b.low, b.close, b.source], [113, 113.5, 112, 112.4, 'intraday-archive']);
    assert.deepEqual(body.filled, ['0050@2026-10-13']);
    assert.deepEqual(body.bars['0050'].map((x) => x.day), days, 'kept in date order');
  } finally { globalThis.fetch = real; }
});

test('/daily-history leaves a gap alone when the recorded day is incomplete (never guesses)', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const ts = ['2026-10-12', '2026-10-13'].map((d) => Date.parse(d + 'T01:00:00Z') / 1000);
    const c = String(url).includes('%5ETWII') ? [100, 101] : [115, null];
    return Response.json({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: c, high: c, low: c, close: c, volume: [1, 1] }] } }] } });
  };
  const read = async () => ({ found: true, bars: { '0050': [{ time: '09:00', open: 1, high: 1, low: 1, close: 1 }] }, recorded: { '0050': { lastMinute: '11:00' } } });
  try {
    const body = await (await onRequestGet({ request: new Request('https://x.test/daily-history?symbols=TAIEX,0050'), env: { health_kv: {} }, readIntradayBars: read })).json();
    assert.ok(!body.bars['0050'].some((x) => x.day === '2026-10-13'));
    assert.equal(body.filled, undefined);
  } finally { globalThis.fetch = real; }
});
