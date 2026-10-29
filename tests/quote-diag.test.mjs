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
