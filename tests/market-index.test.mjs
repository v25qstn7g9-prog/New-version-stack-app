import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuoteSymbol, isIndexAlias, marketSessionAt, buildMarketIndex, readMarketIndex,
} from '../functions/market-index.js';
import { handlePreparedAssetMcp, stockQuoteSymbols, PREPARED_ASSET_TOOLS } from '../functions/ai-connector-prepared.js';

// 大盤（加權指數 TAIEX）經由 MCP 唯讀提供：別名、盤別、過期判斷、抓不到時回 null + reason（不補猜）。

// quote.js / holiday-schedule.js 用 caches.default；Node 沒有 → 永遠 miss，避免測試互相影響。
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const origin = 'https://assets.example';

// ── 純函式 ─────────────────────────────────────────────

test('index aliases normalize to TAIEX; normal symbols pass through', () => {
  for (const a of ['TAIEX', 'taiex', '^TWII', '^twii', 'TWII', 't00', 'T00', 'tse_t00.tw', 'IX0001', '加權指數', '大盤', ' 加權 ']) {
    assert.equal(normalizeQuoteSymbol(a), 'TAIEX', a);
    assert.ok(isIndexAlias(a), a);
  }
  assert.equal(normalizeQuoteSymbol('2330'), '2330');
  assert.equal(normalizeQuoteSymbol('00878'), '00878');
  assert.equal(normalizeQuoteSymbol('spx'), 'SPX');
  assert.equal(isIndexAlias('2330'), false);
  assert.equal(normalizeQuoteSymbol(''), '');
});

test('stock_quote symbol parsing: aliases, singular `symbol`, comma lists, never a silent default', () => {
  assert.deepEqual(stockQuoteSymbols({ symbols: ['^TWII', '2330', '加權指數'] }), { symbols: ['TAIEX', '2330'], aliases: { '^TWII': 'TAIEX', '加權指數': 'TAIEX' } });
  assert.deepEqual(stockQuoteSymbols({ symbol: 'TAIEX' }), { symbols: ['TAIEX'], aliases: {} });
  assert.deepEqual(stockQuoteSymbols({ symbols: '0050, t00' }), { symbols: ['0050', 'TAIEX'], aliases: { t00: 'TAIEX' } });
  assert.deepEqual(stockQuoteSymbols({}), { symbols: [], aliases: {} });
  assert.deepEqual(stockQuoteSymbols({ symbols: [] }), { symbols: [], aliases: {} });
});

// 2026-10-01 是週四；時間用 UTC（台北 = UTC+8）。
const OPEN = { closed: false, reason: null };

test('marketSessionAt: weekend / holiday / unknown calendar / pre-market / trading / post-close', () => {
  assert.equal(marketSessionAt(new Date('2026-10-03T02:00:00Z'), OPEN).session, 'weekend');
  const hol = marketSessionAt(new Date('2026-10-01T02:00:00Z'), { closed: true, reason: '中秋節' });
  assert.deepEqual([hol.session, hol.marketDay, hol.holiday], ['holiday', false, '中秋節']);
  const unk = marketSessionAt(new Date('2026-10-01T02:00:00Z'), { closed: null, reason: null });
  assert.deepEqual([unk.session, unk.marketDay], ['unknown', null]);
  assert.equal(marketSessionAt(new Date('2026-10-01T00:30:00Z'), OPEN).session, 'pre_market');
  assert.equal(marketSessionAt(new Date('2026-10-01T02:00:00Z'), OPEN).session, 'trading');
  assert.equal(marketSessionAt(new Date('2026-10-01T06:00:00Z'), OPEN).session, 'post_close');
  assert.equal(marketSessionAt(new Date('2026-10-01T06:00:00Z'), OPEN).today, '2026-10-01');
});

const raw = (over = {}) => ({ price: 48026.8, prevClose: 47940.13, high: 48181.49, low: 47961.98, isStale: false, asOfDate: '2026-10-01T01:32:00.000Z', source: 'TWSE', priceSource: 'last', ...over });

test('buildMarketIndex: fresh intraday quote → change / changePct, not stale', () => {
  const now = new Date('2026-10-01T01:33:00Z');
  const idx = buildMarketIndex(raw(), { fetchedAt: now.toISOString(), fromCache: false }, marketSessionAt(now, OPEN), now);
  assert.equal(idx.available, true);
  assert.equal(idx.symbol, 'TAIEX');
  assert.equal(idx.price, 48026.8);
  assert.equal(idx.prevClose, 47940.13);
  assert.equal(idx.change, 86.67);
  assert.equal(idx.changePct, 0.18);
  assert.equal(idx.tradeDate, '2026-10-01');
  assert.equal(idx.priceKind, 'intraday');
  assert.equal(idx.stale, false);
  assert.equal(idx.session, 'trading');
  assert.equal(idx.reason, null);
});

test('buildMarketIndex: holiday / weekend shows the last session close, flagged stale (previous_session)', () => {
  const now = new Date('2026-10-03T03:00:00Z');
  const idx = buildMarketIndex(raw({ asOfDate: '2026-10-02T05:30:00.000Z' }), {}, marketSessionAt(now, OPEN), now);
  assert.equal(idx.available, true);
  assert.equal(idx.tradeDate, '2026-10-02');
  assert.equal(idx.priceKind, 'close');
  assert.equal(idx.stale, true);
  assert.equal(idx.staleReason, 'previous_session');
  assert.equal(idx.session, 'weekend');
  assert.match(idx.note, /2026-10-02 的收盤指數/);
});

test('buildMarketIndex: delayed intraday tick and a cached pre-close snapshot after the close are stale', () => {
  const trading = new Date('2026-10-01T02:30:00Z');
  const delayed = buildMarketIndex(raw({ asOfDate: '2026-10-01T02:00:00Z' }), {}, marketSessionAt(trading, OPEN), trading);
  assert.deepEqual([delayed.stale, delayed.staleReason], [true, 'delayed']);
  const after = new Date('2026-10-01T06:30:00Z');
  const snap = buildMarketIndex(raw({ asOfDate: '2026-10-01T03:00:00Z' }), { fromCache: true }, marketSessionAt(after, OPEN), after);
  assert.deepEqual([snap.stale, snap.staleReason, snap.priceKind], [true, 'intraday_snapshot_not_close', 'intraday']);
  const close = buildMarketIndex(raw({ asOfDate: '2026-10-01T05:30:00Z' }), { fromCache: true }, marketSessionAt(after, OPEN), after);
  assert.deepEqual([close.stale, close.priceKind], [false, 'close']);
});

test('buildMarketIndex never fakes: prev-close stand-in, missing prevClose and missing quote → nulls + reason', () => {
  const now = new Date('2026-10-01T02:00:00Z');
  const s = marketSessionAt(now, OPEN);
  const prevOnly = buildMarketIndex(raw({ price: 47940.13, priceSource: 'prev', isStale: true }), {}, s, now);
  assert.equal(prevOnly.available, false);
  assert.equal(prevOnly.price, null);
  assert.equal(prevOnly.change, null);
  assert.equal(prevOnly.prevClose, 47940.13);
  assert.equal(prevOnly.reason, 'price_unavailable');

  const noPrev = buildMarketIndex(raw({ prevClose: 48026.8, warning: 'no_prevClose_available', source: 'Yahoo', priceSource: 'yahoo', asOfDate: '2026-10-01T01:59:00Z' }), {}, s, now);
  assert.equal(noPrev.available, true);
  assert.equal(noPrev.prevClose, null, 'Yahoo price copied into prevClose is not a real previous close');
  assert.equal(noPrev.change, null);
  assert.equal(noPrev.changePct, null);
  assert.equal(noPrev.reason, 'prev_close_unavailable');

  const missing = buildMarketIndex(null, { reason: 'index_fetch_failed', error: 'TWSE: HTTP 503' }, s, now);
  assert.equal(missing.available, false);
  assert.equal(missing.price, null);
  assert.equal(missing.reason, 'index_fetch_failed');
  assert.match(missing.detail, /503/);
});

test('readMarketIndex: reuses the caller quote payload, falls back to a TAIEX-only read, then one forced read after auto-stop', async () => {
  const now = new Date('2026-10-01T01:33:00Z');
  const calls = [];
  const okPayload = { ok: true, fetchedAt: now.toISOString(), quotes: { TAIEX: raw() } };
  const deps = (responses) => ({
    readQuotes: async (symbols, force) => { calls.push([symbols.join(','), force]); const r = responses.shift(); if (r instanceof Error) throw r; return r; },
    readHoliday: async () => OPEN,
  });

  calls.length = 0;
  let idx = await readMarketIndex(deps([]), { quoteData: okPayload, now });
  assert.equal(idx.available, true);
  assert.equal(calls.length, 0, 'no extra upstream call when the holdings payload already has TAIEX');

  calls.length = 0;
  idx = await readMarketIndex(deps([okPayload]), { quoteData: { ok: true, quotes: { '0050': {} } }, now });
  assert.equal(idx.available, true);
  assert.deepEqual(calls, [['TAIEX', false]]);

  calls.length = 0;
  idx = await readMarketIndex(deps([{ ok: false, autoStopped: true, error: 'auto stop' }, okPayload]), { now });
  assert.equal(idx.available, true);
  assert.equal(idx.forcedRefresh, true);
  assert.deepEqual(calls, [['TAIEX', false], ['TAIEX', true]]);

  calls.length = 0;
  idx = await readMarketIndex(deps([{ ok: false, autoStopped: true }]), { now, allowForcedFallback: false });
  assert.equal(idx.available, false);
  assert.equal(idx.reason, 'auto_refresh_stopped_no_cache');

  idx = await readMarketIndex(deps([new Error('quote HTTP 502')]), { now });
  assert.equal(idx.available, false);
  assert.equal(idx.reason, 'index_fetch_failed');
  assert.equal(idx.price, null);
});

test('readMarketIndex: an unreachable holiday calendar gives session "unknown" (not a guess) and never throws', async () => {
  const now = new Date('2026-10-01T02:00:00Z');
  const idx = await readMarketIndex({
    readQuotes: async () => ({ ok: true, quotes: { TAIEX: raw({ asOfDate: '2026-10-01T01:59:30Z' }) } }),
    readHoliday: async () => { throw new Error('down'); },
  }, { now });
  assert.equal(idx.available, true);
  assert.equal(idx.session, 'unknown');
  assert.equal(idx.marketDay, null);
});

// ── 經過 MCP handler（mock TWSE / Yahoo / 休市表）──────────────

function env(holdings = [{ symbol: '0050', name: '元大台灣50', shares: 1000, avgCost: 100 }]) {
  const data = new Map([[`portfolio-sync:${token}`, JSON.stringify({ syncedAt: new Date().toISOString(), holdings, totalAssets: 112000 })]]);
  return { health_kv: { get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k) } };
}

function withFeeds({ twse = 'ok', yahoo = 'fail' } = {}, fn) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('openapi.twse.com.tw')) return Response.json([{ Name: '開國紀念日', Date: '1150101', Description: '放假' }]);
    if (u.includes('mis.twse.com.tw')) {
      if (twse !== 'ok') return new Response('down', { status: 503 });
      const exCh = decodeURIComponent(new URL(u).searchParams.get('ex_ch') || '');
      const tlong = String(Date.now() - 30_000);
      const msgArray = exCh.split('|').map(x => x.replace(/^tse_|\.tw$/g, '')).map(c => c === 't00'
        ? { c: 't00', z: '48026.80', y: '47940.13', h: '48181.49', l: '47961.98', tlong }
        : { c, z: '112.10', y: '112.05', h: '112.45', l: '112.00', tlong });
      return Response.json({ msgArray });
    }
    if (u.includes('finance.yahoo.com')) {
      if (yahoo === 'fail') return new Response('down', { status: 503 });
    }
    return new Response('unexpected', { status: 599 });
  };
  return fn(seen).finally(() => { globalThis.fetch = original; });
}

async function mcp(e, method, params = {}) {
  const res = await handlePreparedAssetMcp(new Request(`${origin}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), e, { syncToken: token });
  return (await res.json()).result;
}
const tool = async (e, name, args) => (await mcp(e, 'tools/call', { name, arguments: args }));

test('stock_quote accepts 加權指數 / ^TWII / singular symbol and returns TAIEX (not the /quote default list)', async () => {
  await withFeeds({}, async (seen) => {
    for (const args of [{ symbols: ['加權指數'], force: true }, { symbols: ['^TWII'], force: true }, { symbol: 'TAIEX', force: true }]) {
      const r = await tool(env(), 'stock_quote', args);
      assert.equal(r.isError, false, JSON.stringify(args));
      const d = r.structuredContent;
      assert.deepEqual(Object.keys(d.quotes), ['TAIEX']);
      assert.equal(d.index.available, true);
      assert.equal(d.index.price, 48026.8);
      assert.equal(d.index.change, 86.67);
      assert.equal(d.index.source, 'TWSE');
      assert.ok(['trading', 'pre_market', 'post_close', 'weekend', 'holiday'].includes(d.index.session));
    }
    assert.ok(seen.some(u => u.includes('tse_t00.tw')), 'index comes from TWSE MIS t00, same as the web UI');
    assert.ok(!seen.some(u => /tse_0056/.test(u)), 'never falls back to the /quote default symbols');
  });
});

test('stock_quote without symbols is an explicit error instead of default quotes', async () => {
  const r = await tool(env(), 'stock_quote', {});
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.ok, false);
});

test('stock_quote for TAIEX when every source fails → index.available false with reason, values null', async () => {
  await withFeeds({ twse: 'fail', yahoo: 'fail' }, async () => {
    const r = await tool(env(), 'stock_quote', { symbols: ['TAIEX'], force: true });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.index.available, false);
    assert.equal(r.structuredContent.index.reason, 'index_fetch_failed');
    assert.equal(r.structuredContent.index.price, null);
    assert.equal(r.structuredContent.index.changePct, null);
  });
});

test('portfolio_live_snapshot adds `index` from the same /quote request; TAIEX never counts as a missing holding', async () => {
  await withFeeds({}, async (seen) => {
    const r = await tool(env(), 'portfolio_live_snapshot', { force: true });
    assert.equal(r.isError, false);
    const d = r.structuredContent;
    assert.equal(d.found, true);
    assert.equal(d.index.available, true);
    assert.equal(d.index.price, 48026.8);
    assert.equal(d.index.prevClose, 47940.13);
    assert.equal(d.index.changePct, 0.18);
    assert.deepEqual(d.holdings.map(h => h.symbol), ['0050']);
    assert.deepEqual(d.missingQuotes, []);
    assert.equal(d.quoteStatus, 'complete');
    assert.deepEqual(d.coverage, { quotedHoldings: 1, totalHoldings: 1 });
    const misCalls = seen.filter(u => u.includes('mis.twse.com.tw'));
    assert.equal(misCalls.length, 1, 'holdings and TAIEX share one TWSE call');
    assert.match(decodeURIComponent(misCalls[0]), /tse_0050\.tw\|tse_t00\.tw/);
  });
});

test('portfolio_live_snapshot still reports the index when there is no synced snapshot', async () => {
  await withFeeds({}, async () => {
    const e = { health_kv: { get: async () => null, put: async () => {}, delete: async () => {} } };
    const d = (await tool(e, 'portfolio_live_snapshot', { force: true })).structuredContent;
    assert.equal(d.found, false);
    assert.deepEqual(d.holdings, []);
    assert.equal(d.index.available, true);
  });
});

test('asset_agent_brief exposes `index`; includeLive:false skips all live quote calls', async () => {
  await withFeeds({}, async (seen) => {
    const off = (await tool(env(), 'asset_agent_brief', { includeLive: false })).structuredContent;
    assert.equal(off.index, null);
    assert.equal(seen.filter(u => u.includes('mis.twse.com.tw')).length, 0);
    const on = (await tool(env(), 'asset_agent_brief', { includeLive: true })).structuredContent;
    assert.ok(on.index && on.index.symbol === 'TAIEX');
    assert.equal(typeof on.index.available, 'boolean');
    if (!on.index.available) assert.ok(on.index.reason);
  });
});

test('tool list is unchanged (no new tool) and every tool stays read-only', async () => {
  const names = (await mcp(env(), 'tools/list')).tools.map(t => t.name);
  assert.deepEqual(names, ['asset_summary', 'asset_agent_brief', 'today_asset_status', 'portfolio_live_snapshot', 'stock_quote', 'stock_news', 'daily_history', 'dividend_schedule', 'holiday_schedule', 'taifex_tx', 'system_health', 'pending_trades']);
  for (const t of PREPARED_ASSET_TOOLS) assert.equal(t.annotations.readOnlyHint, true, t.name);
  const sq = PREPARED_ASSET_TOOLS.find(t => t.name === 'stock_quote');
  assert.deepEqual(sq.inputSchema.required, ['symbols'], 'stock_quote input schema is unchanged');
});
