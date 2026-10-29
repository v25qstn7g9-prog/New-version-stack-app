import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordQuoteDiag, QUOTE_DIAG_KEY } from '../functions/quote.js';

// 報價診斷：記下從哪個機房讀證交所、成功或失敗；失敗每分鐘最多記一次，成功每 30 分鐘一次。
test('records failures with the colo, throttled, newest first, at most 30', async () => {
  const m = new Map(); const kv = { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
  const t0 = Date.parse('2026-10-29T01:30:00Z');
  await recordQuoteDiag({ health_kv: kv }, { colo: 'TPE', ok: false, twseError: 'HTTP 403', nonLast: ['0050'] }, t0);
  await recordQuoteDiag({ health_kv: kv }, { colo: 'TPE', ok: false, twseError: 'HTTP 403' }, t0 + 10_000); // 同一分鐘內：不記
  await recordQuoteDiag({ health_kv: kv }, { colo: 'HKG', ok: false, twseError: 'timeout' }, t0 + 61_000);
  await recordQuoteDiag({ health_kv: kv }, { colo: 'TPE', ok: true }, t0 + 62_000);
  const d = JSON.parse(m.get(QUOTE_DIAG_KEY));
  assert.deepEqual(d.recent.map((r) => [r.colo, r.ok]), [['TPE', true], ['HKG', false], ['TPE', false]]);
  assert.equal(d.recent[2].twseError, 'HTTP 403');
});

test('system health shows the quote diagnosis', () => {
  const src = fs.readFileSync(new URL('../functions/ai-connector-prepared.js', import.meta.url), 'utf8');
  assert.match(src, /data\.quoteDiag = JSON\.parse\(\(await env\.health_kv\?\.get\("quote-diag"\)\)/);
  const q = fs.readFileSync(new URL('../functions/quote.js', import.meta.url), 'utf8');
  assert.match(q, /colo: context\.request\?\.cf\?\.colo/);
});

test('TWSE down: in market hours use a last trade seen within 10 minutes; older, other days or after hours fall through to Yahoo', async () => {
  const { fillWhenTwseDown } = await import('../functions/quote.js');
  const now = Date.parse('2026-10-29T01:32:00Z');
  const cache = { '0050': { price: 107.85, asOfDate: '2026-10-29T01:30:34Z' }, '0056': { price: 57.05, asOfDate: '2026-10-29T01:10:00Z' }, TAIEX: { price: 46563.79, asOfDate: '2026-10-28T05:30:00Z' } };
  const store = { read: async (s) => cache[s] || null };
  const q = await fillWhenTwseDown({}, ['0050', '0056', 'TAIEX', '2330'], '2026-10-29', store, now, () => true);
  assert.deepEqual(Object.keys(q), ['0050']);
  assert.equal(q['0050'].price, 107.85);
  assert.equal(q['0050'].priceSource, 'last-seen');
  assert.equal(q['0050'].isStale, false);
  const closed = await fillWhenTwseDown({}, ['0050'], '2026-10-29', store, now, () => false);
  assert.deepEqual(closed, {});
  const kept = await fillWhenTwseDown({ '0050': { price: 108 } }, ['0050'], '2026-10-29', store, now, () => true);
  assert.equal(kept['0050'].price, 108, 'real TWSE data is never replaced');
});

test('TWSE retries a third time on fast 5xx, inside the app 9-second budget', () => {
  const q = fs.readFileSync(new URL('../functions/quote.js', import.meta.url), 'utf8');
  assert.match(q, /\[500, 502, 503, 504, 522, 524\]\.includes\(status2\) && Date\.now\(\) - started < 3000/);
  assert.match(q, /if \(twseError\) await fillWhenTwseDown\(quotes, twseSymbols, day\);/);
});
