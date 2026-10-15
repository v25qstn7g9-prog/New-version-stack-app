import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onRequestGet, buildSpider, moodFromPct, scoreAxes, clamp, AXES, readValuation, annualizedVolatility } from '../functions/spider.js';
import { onRequestPost as syncPost } from '../functions/portfolio-sync.js';

const token = 'b'.repeat(40);
const NOW = new Date('2026-10-15T03:00:00Z'); // 11:00 +08:00
const closes = Array.from({ length: 61 }, (_, i) => 100 * (1 + 0.01 * Math.sin(i)));
const summary = {
  syncedAt: '2026-10-15T02:00:00Z',
  holdings: [{ symbol: '2330', name: '台積電', shares: 100 }, { symbol: '0056', name: '元大高股息', shares: 1000 }],
  dataset: { dividends: [
    { symbol: '0056', date: '2026-07-16', perShare: 0.8 }, { symbol: '0056', date: '2026-01-16', perShare: 0.7 },
    { symbol: '0056', date: '2025-07-16', perShare: 0.9 }, { symbol: '0056', date: '2024-07-16', perShare: 1.0 },
  ] },
};
const deps = (o = {}) => ({
  now: () => NOW,
  readPortfolio: async () => ({ status: 200, data: { ok: true, found: true, summary } }),
  readQuotes: async () => ({ quotes: { 2330: { price: 1000, prevClose: 990 }, '0056': { price: 30, prevClose: 30 } } }),
  readHistory: async () => ({ bars: { 2330: closes.map((close) => ({ close })), '0056': closes.map((close) => ({ close })) } }),
  readValuation: async () => ({ 2330: { pe: 20, pb: 5.5, yield: 1.5 } }),
  ...o,
});

test('shape and axes', async () => {
  const { status, body } = await buildSpider(token, deps());
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
  assert.equal(body.asOf, '2026-10-15T11:00:00+08:00');
  assert.deepEqual(body.axes, ['yield', 'pe', 'pb', 'volatility', 'divStability', 'weight']);
  assert.ok(['up', 'flat', 'down'].includes(body.mood));
  assert.equal(body.holdings.length, 2);
  for (const h of body.holdings) {
    assert.deepEqual(Object.keys(h.raw), AXES); assert.deepEqual(Object.keys(h.score), AXES);
    for (const k of AXES) if (h.score[k] != null) assert.ok(h.score[k] >= 0 && h.score[k] <= 100);
  }
  const tsmc = body.holdings.find((h) => h.code === '2330'), etf = body.holdings.find((h) => h.code === '0056');
  assert.equal(tsmc.raw.pe, 20); assert.equal(tsmc.score.pe, 67); assert.equal(tsmc.score.pb, 0);
  assert.equal(tsmc.raw.yield, 1.5); assert.equal(tsmc.sources.yield, 'twse-bwibbu');
  assert.equal(tsmc.raw.divStability, null);
  assert.equal(etf.raw.pe, null); assert.equal(etf.raw.pb, null);
  assert.equal(etf.raw.yield, 5); assert.equal(etf.sources.yield, 'dividends');
  assert.ok(etf.raw.divStability > 80 && etf.raw.divStability <= 100);
  assert.equal(Math.round(tsmc.raw.weight + etf.raw.weight), 100);
  assert.ok(tsmc.raw.volatility > 0);
});

test('null fallback when every outside source fails', async () => {
  const boom = async () => { throw new Error('down'); };
  const { status, body } = await buildSpider(token, deps({ readQuotes: boom, readHistory: boom, readValuation: boom }));
  assert.equal(status, 200);
  assert.equal(body.mood, 'flat');
  for (const h of body.holdings) for (const k of ['pe', 'pb', 'volatility', 'weight']) { assert.equal(h.raw[k], null); assert.equal(h.score[k], null); }
  const tsmc = body.holdings.find((h) => h.code === '2330');
  assert.equal(tsmc.raw.yield, null); assert.equal(tsmc.score.yield, null);
});

test('BWIBBU fetch failure / bad payload falls back to null', async () => {
  assert.equal(await readValuation(async () => { throw new Error('timeout'); }), null);
  assert.equal(await readValuation(async () => new Response('x', { status: 503 })), null);
  const ok = await readValuation(async () => new Response(JSON.stringify([{ Code: '2330', PEratio: '', PBratio: '5.1', DividendYield: '1.4' }])));
  assert.deepEqual(ok['2330'], { pe: null, pb: 5.1, yield: 1.4 });
});

test('volatility needs enough history', () => {
  assert.equal(annualizedVolatility([100, 101, 102]), null);
  assert.equal(Math.round(annualizedVolatility(Array(30).fill(50))), 0);
});

test('mood thresholds (±0.3%, flat when unknown)', async () => {
  assert.equal(moodFromPct(0.31), 'up'); assert.equal(moodFromPct(0.3), 'flat');
  assert.equal(moodFromPct(-0.3), 'flat'); assert.equal(moodFromPct(-0.31), 'down');
  assert.equal(moodFromPct(null), 'flat'); assert.equal(moodFromPct(NaN), 'flat');
  const down = await buildSpider(token, deps({ readQuotes: async () => ({ quotes: { 2330: { price: 900, prevClose: 1000 } } }) }));
  assert.equal(down.body.mood, 'down');
  const up = await buildSpider(token, deps());
  assert.equal(up.body.mood, 'up'); // +1000 on 129000 ≈ +0.78%
});

test('scores are clamped to 0..100', () => {
  const hi = scoreAxes({ yield: 50, pe: 1, pb: 0.1, volatility: -5, divStability: 150, weight: 120 });
  const lo = scoreAxes({ yield: -1, pe: 999, pb: 99, volatility: 400, divStability: -10, weight: -1 });
  for (const k of AXES) { assert.equal(hi[k], 100, k); assert.equal(lo[k], 0, k); }
  assert.equal(clamp(null), null);
  const nul = scoreAxes({ yield: null, pe: -3, pb: null, volatility: null, divStability: null, weight: null });
  for (const k of AXES) assert.equal(nul[k], null, k);
});

function kvEnv() {
  const m = new Map();
  return { health_kv: { get: async (k) => m.get(k) || null, put: async (k, v) => { m.set(k, v); } } };
}

test('auth: no/invalid bearer → 401, ?token is not accepted, unknown token gets no holdings', async () => {
  const env = kvEnv();
  await syncPost({ env, request: new Request('https://x/api/portfolio-sync', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ summary }) }) });
  const anon = await onRequestGet({ env, request: new Request('https://x/api/spider') });
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).holdings, undefined);
  assert.equal((await onRequestGet({ env, request: new Request(`https://x/api/spider?token=${token}`) })).status, 401);
  assert.equal((await onRequestGet({ env, request: new Request('https://x/api/spider', { headers: { authorization: 'Bearer short' } }) })).status, 401);
  const stub = { readQuotes: async () => null, readHistory: async () => null, readValuation: async () => null };
  const other = await onRequestGet({ env, request: new Request('https://x/api/spider', { headers: { authorization: `Bearer ${'c'.repeat(40)}` } }) }, stub);
  const ob = await other.json();
  assert.equal(other.status, 200); assert.equal(ob.found, false); assert.deepEqual(ob.holdings, []);
  const mine = await onRequestGet({ env, request: new Request('https://x/api/spider', { headers: { authorization: `Bearer ${token}` } }) }, stub);
  const mb = await mine.json();
  assert.equal(mine.status, 200); assert.equal(mb.found, true); assert.equal(mb.holdings.length, 2);
  assert.equal(mine.headers.get('cache-control'), 'no-store');
});

test('worker wires GET /api/spider into routes and the method allow-list', () => {
  const w = fs.readFileSync('worker.js', 'utf8');
  assert.match(w, /\["\/api\/spider", \["GET"\]\]/);
  assert.match(w, /url\.pathname === "\/api\/spider" && request\.method === "GET"/);
  assert.ok(!/WRITE_PATHS = new Set\([^)]*\/api\/spider/.test(w));
});

test('500 does not leak internal error message in detail', async () => {
  const secret = 'SECRET_KV_KEY_portfolio:abc123 at /internal/path.js';
  const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(' '));
  try {
    const req = new Request('https://x/api/spider', { headers: { Authorization: `Bearer ${token}` } });
    const res = await onRequestGet({ request: req, env: {} }, { readPortfolio: async () => { throw new Error(secret); } });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(!text.includes('SECRET_KV_KEY'), 'body must not leak error');
    assert.equal(JSON.parse(text).detail, 'internal error');
    assert.ok(logged.some((l) => l.includes('SECRET_KV_KEY')), 'error logged server-side');
  } finally { console.error = orig; }
});
