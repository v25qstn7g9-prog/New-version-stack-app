import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePreparedAssetMcp } from '../functions/ai-connector-prepared.js';

// portfolio_live_snapshot：美股（VOO 等）要乘 USD→TWD 換成台幣，純台股維持原公式與原輸出結構。
// 全部用 mock 的 KV / fetch / caches，不需要任何 secret 或網路。

const token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const origin = 'https://assets.example';

// quote.js 用 caches.default：預設永遠 miss；順便記下回應快取的鍵（= 實際送出的 /quote symbols，排序後）。
// injectedQuote 有值時，/response/ 快取直接命中這份資料 → 快照層收到的就是我們指定的報價（可塞 0／負匯率）。
const cachePuts = [];
let injectedQuote = null;
globalThis.caches = { default: {
  match: async (req) => {
    const u = String(req?.url || req);
    if (injectedQuote && u.includes('/response/')) return Response.json({ ...injectedQuote, fetchedAt: new Date().toISOString() });
    return null;
  },
  put: async (req) => { cachePuts.push(String(req?.url || req)); },
} };

const VOO = { price: 677.042, prevClose: 673.97 };
const USDTWD = 32.803;
const TW = {
  '2330': { z: '1000.50', y: '990.00' },
  '0056': { z: '38.12', y: '38.00' },
};

function env(holdings) {
  const data = new Map([[`portfolio-sync:${token}`, JSON.stringify({ syncedAt: new Date().toISOString(), holdings, totalAssets: 500000 })]]);
  return { health_kv: { get: async k => data.get(k) ?? null, put: async (k, v) => data.set(k, v), delete: async k => data.delete(k) } };
}

function yahooUs({ price, prevClose }) {
  const nowSec = Math.floor(Date.now() / 1000) - 60;
  return { chart: { result: [{
    meta: { regularMarketPrice: price, regularMarketTime: nowSec, regularMarketPreviousClose: prevClose },
    timestamp: [nowSec - 86400, nowSec],
    indicators: { quote: [{ close: [prevClose, price], high: [price], low: [prevClose] }] },
  }] } };
}

function yahooFx(rate) {
  const nowSec = Math.floor(Date.now() / 1000) - 3600;
  return { chart: { result: [{ timestamp: [nowSec - 86400, nowSec], indicators: { quote: [{ close: [32.7, rate] }] } }] } };
}

async function withFeeds({ fx = 'ok' } = {}, fn) {
  const original = globalThis.fetch;
  const seen = [];
  cachePuts.length = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    seen.push(u);
    if (u.includes('openapi.twse.com.tw')) return Response.json([{ Name: '開國紀念日', Date: '1150101', Description: '放假' }]);
    if (u.includes('mis.twse.com.tw')) {
      const exCh = decodeURIComponent(new URL(u).searchParams.get('ex_ch') || '');
      const tlong = String(Date.now() - 30_000);
      const msgArray = exCh.split('|').map(x => x.replace(/^(tse|otc)_|\.tw$/g, '')).map(c => c === 't00'
        ? { c: 't00', z: '48026.80', y: '47940.13', h: '48181.49', l: '47961.98', tlong }
        : { c, z: TW[c]?.z || '100.00', y: TW[c]?.y || '100.00', h: TW[c]?.z || '100.00', l: TW[c]?.y || '100.00', tlong });
      return Response.json({ msgArray });
    }
    if (u.includes('finance.yahoo.com')) {
      if (u.includes('/chart/VOO')) return Response.json(yahooUs(VOO));
      if (u.includes('/chart/TWD%3DX')) {
        if (fx === 'fail') return new Response('down', { status: 503 });
        return Response.json(yahooFx(fx === 'zero' ? 0 : USDTWD));
      }
      return new Response('down', { status: 503 });
    }
    return new Response('unexpected', { status: 599 });
  };
  try { return await fn(seen); } finally { globalThis.fetch = original; }
}

async function snapshot(holdings, { force = true } = {}) {
  const res = await handlePreparedAssetMcp(new Request(`${origin}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'portfolio_live_snapshot', arguments: { force } } }),
  }), env(holdings), { syncToken: token });
  const r = (await res.json()).result;
  assert.equal(r.isError, false);
  return r.structuredContent;
}

// 直接把指定的 /quote 回應交給快照層（繞過 quote.js 的抓取與驗證），用來測快照層自己的匯率防護。
async function snapshotWithQuotes(holdings, quotes) {
  injectedQuote = { ok: true, status: 'complete', quotes, missing: [] };
  try {
    return await withFeeds({}, () => snapshot(holdings, { force: false }));
  } finally {
    injectedQuote = null;
  }
}

// 回應快取鍵裡的 symbols（quote.js 會排序）。
function requestedSymbolSets() {
  return cachePuts.filter(u => u.includes('/response/')).map(u => decodeURIComponent(u.split('/').pop()).split(','));
}

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);
const vooPct = ((VOO.price - VOO.prevClose) / VOO.prevClose) * 100;

// 修改前 liveSnapshot 的頂層與持股 key（依序）；純台股回應必須維持一模一樣。
const ORIGINAL_TOP_KEYS = ['ok', 'found', 'syncedAt', 'quoteFetchedAt', 'quoteStatus', 'coverage', 'totals', 'holdings', 'missingQuotes', 'index', 'note'];
const ORIGINAL_HOLDING_KEYS = ['symbol', 'name', 'shares', 'avgCost', 'latestPrice', 'prevClose', 'marketValue', 'dailyChange', 'dailyChangePct', 'quoteSource', 'quoteAsOf', 'stale'];

test('VOO：市值與當日漲跌乘 USDTWD 換成台幣，且有請求 USDTWD', async () => {
  await withFeeds({}, async (seen) => {
    const d = await snapshot([{ symbol: 'VOO', name: 'Vanguard S&P 500', shares: 4.43409, avgCost: 500 }]);
    const h = d.holdings[0];
    assert.equal(h.symbol, 'VOO');
    assert.equal(h.latestPrice, VOO.price);
    assert.equal(h.prevClose, VOO.prevClose);
    assert.equal(h.isUS, true);
    assert.equal(h.currency, 'USD');
    assert.equal(h.fxRate, USDTWD);
    near(h.marketValue, 98477, 1, 'marketValue');
    near(h.dailyChange, 447, 1, 'dailyChange');
    near(h.dailyChangePct, vooPct, 1e-9, 'dailyChangePct 不受匯率影響');
    near(d.totals.coveredMarketValue, 98477, 1, 'coveredMarketValue');
    near(d.totals.coveredDailyChange, 447, 1, 'coveredDailyChange');
    near(d.totals.coveredDailyChangePct, h.dailyChangePct, 1e-9, 'coveredDailyChangePct 用台幣前收市值');
    assert.deepEqual(d.missingQuotes, []);
    assert.equal(d.quoteStatus, 'complete');
    assert.equal(d.fx.rate, USDTWD);
    assert.equal(d.fx.missing, false);
    assert.ok(seen.some(u => u.includes('/chart/TWD%3DX')), '有向 Yahoo 要 USDTWD');
    const sets = requestedSymbolSets();
    assert.ok(sets.some(s => s.includes('USDTWD') && s.includes('VOO') && s.includes('TAIEX')), JSON.stringify(sets));
  });
});

test('純台股：整個回應結構與數值跟修改前完全相同，且不請求 USDTWD', async () => {
  await withFeeds({}, async (seen) => {
    const holdings = [
      { symbol: '2330', name: '台積電', shares: 1000, avgCost: 600 },
      { symbol: '0056', name: '元大高股息', shares: 3000, avgCost: 30 },
    ];
    const d = await snapshot(holdings);

    // 頂層 key 跟修改前一樣（沒有 fx）。
    assert.deepEqual(Object.keys(d), ORIGINAL_TOP_KEYS);
    assert.equal('fx' in d, false);

    // 每筆持股：用修改前的公式（shares*price 等）組出完整物件，deepEqual 整個物件（含 key 順序）。
    let mv = 0; let dc = 0; let pv = 0;
    const expectedHoldings = holdings.map((src, i) => {
      const got = d.holdings[i];
      const price = Number(TW[src.symbol].z); const prev = Number(TW[src.symbol].y);
      mv += src.shares * price; dc += src.shares * (price - prev); pv += src.shares * prev;
      return {
        symbol: src.symbol,
        name: src.name,
        shares: src.shares,
        avgCost: src.avgCost,
        latestPrice: price,
        prevClose: prev,
        marketValue: src.shares * price,
        dailyChange: src.shares * (price - prev),
        dailyChangePct: ((price - prev) / prev) * 100,
        // 報價來源欄位由 quote 層決定、跟這次修改無關；仍要求存在且型別合理。
        quoteSource: got.quoteSource,
        quoteAsOf: got.quoteAsOf,
        stale: got.stale,
      };
    });
    for (const h of d.holdings) {
      assert.deepEqual(Object.keys(h), ORIGINAL_HOLDING_KEYS, `${h.symbol} 的 key 集合不可改變`);
      assert.equal(typeof h.quoteSource, 'string');
    }
    assert.deepEqual(d.holdings, expectedHoldings);

    assert.deepEqual(d.totals, {
      syncedTotalAssets: 500000,
      coveredMarketValue: mv,
      coveredDailyChange: dc,
      coveredDailyChangePct: (dc / pv) * 100,
    });
    assert.deepEqual(d.coverage, { quotedHoldings: 2, totalHoldings: 2 });
    assert.deepEqual(d.missingQuotes, []);
    assert.equal(d.quoteStatus, 'complete');
    assert.equal(d.note, '全部持股皆有可用報價。');

    assert.ok(!seen.some(u => u.includes('TWD%3DX')), '純台股不要 USDTWD');
    // requestSymbols 跟修改前一樣：持股 + TAIEX（快取鍵不變）。
    assert.deepEqual(requestedSymbolSets(), [['0056', '2330', 'TAIEX']]);
  });
});

test('混合持股：covered 合計 = 台股原值 + 美股換算台幣；台股那幾筆不多欄位', async () => {
  await withFeeds({}, async () => {
    const d = await snapshot([
      { symbol: '2330', name: '台積電', shares: 1000, avgCost: 600 },
      { symbol: 'VOO', name: 'Vanguard S&P 500', shares: 4.43409, avgCost: 500 },
      { symbol: '0056', name: '元大高股息', shares: 3000, avgCost: 30 },
    ]);
    const tsmc = 1000 * 1000.5; const yld = 3000 * 38.12;
    const tsmcChg = 1000 * (1000.5 - 990); const yldChg = 3000 * (38.12 - 38);
    const vooMv = 4.43409 * VOO.price * USDTWD;
    const vooChg = 4.43409 * (VOO.price - VOO.prevClose) * USDTWD;
    const prevValue = 1000 * 990 + 3000 * 38 + 4.43409 * VOO.prevClose * USDTWD;
    const byS = Object.fromEntries(d.holdings.map(h => [h.symbol, h]));
    assert.equal(byS['2330'].marketValue, tsmc);
    assert.equal(byS['0056'].marketValue, yld);
    assert.deepEqual(Object.keys(byS['2330']), ORIGINAL_HOLDING_KEYS);
    assert.deepEqual(Object.keys(byS['0056']), ORIGINAL_HOLDING_KEYS);
    assert.deepEqual(Object.keys(byS.VOO), [...ORIGINAL_HOLDING_KEYS, 'isUS', 'currency', 'fxRate']);
    near(byS.VOO.marketValue, 98477, 1, 'VOO marketValue');
    near(d.totals.coveredMarketValue, tsmc + yld + vooMv, 1e-6, 'coveredMarketValue');
    near(d.totals.coveredDailyChange, tsmcChg + yldChg + vooChg, 1e-6, 'coveredDailyChange');
    near(d.totals.coveredDailyChangePct, ((tsmcChg + yldChg + vooChg) / prevValue) * 100, 1e-9, 'coveredDailyChangePct');
    assert.deepEqual(d.coverage, { quotedHoldings: 3, totalHoldings: 3 });
    assert.equal(d.quoteStatus, 'complete');
    assert.equal(d.fx.rate, USDTWD);
  });
});

function assertFxMissingMixed(d) {
  const byS = Object.fromEntries(d.holdings.map(h => [h.symbol, h]));
  assert.equal(byS.VOO.marketValue, null);
  assert.equal(byS.VOO.dailyChange, null);
  assert.equal(byS.VOO.fxRate, null);
  assert.equal(byS.VOO.currency, 'USD');
  assert.equal(byS.VOO.latestPrice, VOO.price, '原幣別報價仍保留');
  near(byS.VOO.dailyChangePct, vooPct, 1e-9, '百分比仍可算');
  assert.equal(d.totals.coveredMarketValue, 1000 * 1000.5);
  assert.equal(d.totals.coveredDailyChange, 1000 * (1000.5 - 990));
  assert.equal(d.totals.coveredDailyChangePct, ((1000 * (1000.5 - 990)) / (1000 * 990)) * 100);
  assert.deepEqual(d.coverage, { quotedHoldings: 1, totalHoldings: 2 });
  assert.ok(d.missingQuotes.includes('USDTWD'), JSON.stringify(d.missingQuotes));
  assert.notEqual(d.quoteStatus, 'complete');
  assert.equal(d.fx.rate, null);
  assert.equal(d.fx.missing, true);
  assert.match(d.note, /USDTWD/);
}

const MIXED = [
  { symbol: '2330', name: '台積電', shares: 1000, avgCost: 600 },
  { symbol: 'VOO', name: 'Vanguard S&P 500', shares: 4.43409, avgCost: 500 },
];

for (const [label, fx] of [['抓不到', 'fail'], ['上游回 0', 'zero']]) {
  test(`USDTWD ${label}（經 quote 層）：VOO 市值為 null、不計入合計、標示缺匯率`, async () => {
    await withFeeds({ fx }, async () => assertFxMissingMixed(await snapshot(MIXED)));
  });
}

// 快照層自己的防護：直接讓 liveSnapshot 收到 0／負數／非數字的 USDTWD。
const injectedBase = {
  '2330': { price: 1000.5, prevClose: 990, source: 'mock' },
  VOO: { price: VOO.price, prevClose: VOO.prevClose, source: 'mock' },
};
for (const [label, fxQuote] of [
  ['為 0', { price: 0, source: 'mock' }],
  ['為負數', { price: -32.803, source: 'mock' }],
  ['不是數字', { price: 'abc', source: 'mock' }],
  ['整筆缺少', undefined],
]) {
  test(`快照層：USDTWD ${label} → VOO 市值為 null、不計入合計、標示缺匯率`, async () => {
    const quotes = { ...injectedBase };
    if (fxQuote) quotes.USDTWD = fxQuote;
    const d = await snapshotWithQuotes(MIXED, quotes);
    assertFxMissingMixed(d);
    assert.equal(d.quoteStatus, 'partial', 'quote 層宣稱 complete 也要降為 partial');
  });
}

test('快照層：USDTWD 正常注入時照常換算（確認注入路徑有效）', async () => {
  const d = await snapshotWithQuotes(MIXED, { ...injectedBase, USDTWD: { price: USDTWD, source: 'mock' } });
  const voo = d.holdings.find(h => h.symbol === 'VOO');
  near(voo.marketValue, 98477, 1, 'marketValue');
  assert.equal(d.quoteStatus, 'complete');
});

test('只有美股且缺匯率：市值與合計都是 null、不偷用美元值、標示缺匯率', async () => {
  const check = (d) => {
    const h = d.holdings[0];
    assert.equal(h.marketValue, null);
    assert.equal(h.dailyChange, null);
    near(h.dailyChangePct, vooPct, 1e-9, '百分比仍可算');
    assert.deepEqual(d.totals, { syncedTotalAssets: 500000, coveredMarketValue: null, coveredDailyChange: null, coveredDailyChangePct: null });
    assert.deepEqual(d.coverage, { quotedHoldings: 0, totalHoldings: 1 });
    assert.ok(d.missingQuotes.includes('USDTWD'));
    assert.notEqual(d.quoteStatus, 'complete');
    assert.equal(d.fx.missing, true);
    assert.match(d.note, /報價涵蓋不完整/);
    assert.match(d.note, /USDTWD/);
  };
  const only = [{ symbol: 'VOO', name: 'Vanguard S&P 500', shares: 4.43409, avgCost: 500 }];
  await withFeeds({ fx: 'fail' }, async () => check(await snapshot(only)));
  check(await snapshotWithQuotes(only, { VOO: injectedBase.VOO, USDTWD: { price: -1, source: 'mock' } }));
});
