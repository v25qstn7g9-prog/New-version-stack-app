import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';
import { onRequestGet, fillTwseFromLastTrades } from '../functions/quote.js';

const DAY = '2026-11-11';
const at = time => Date.parse(`${DAY}T${time}:00+08:00`);
const snapshot = (time, price = 101) => ({ ok: true, day: DAY, fetchedAt: new Date(at(time)).toISOString(),
  status: 'complete', quotes: { '0050': { price, prevClose: 99.7, source: 'TWSE', priceSource: 'last',
    isStale: false, asOfDate: `${DAY}T05:30:00.000Z` } }, missing: [] });

async function quote(t, { time, cached, force = false, fail = false }) {
  const previous = { fetch: globalThis.fetch, caches: globalThis.caches };
  t.mock.timers.enable({ apis: ['Date'], now: at(time) });
  const entries = new Map(), upstream = [];
  const key = `https://quote-cache.local/response/4.7-quote-schedule-7-closing-sync/${DAY}/0050`;
  if (cached) entries.set(key, Response.json(cached));
  globalThis.caches = { default: {
    match: async request => entries.get(request.url)?.clone() || null,
    put: async (request, response) => entries.set(request.url, response.clone())
  } };
  globalThis.fetch = async url => {
    upstream.push(String(url));
    if (String(url).includes('mis.twse.com.tw')) return Response.json({ msgArray: fail ? [] : [{
      c: '0050', z: '103.2000', y: '99.7000', tlong: String(at('13:30'))
    }] });
    return new Response('unavailable', { status: 503 });
  };
  try {
    const response = await onRequestGet({ request: new Request(`https://app.test/quote?symbols=0050&force=${force ? 1 : 0}`), env: {} });
    return { status: response.status, body: await response.json(), upstream, cache: await entries.get(key)?.clone().json() };
  } finally {
    globalThis.fetch = previous.fetch; globalThis.caches = previous.caches;
  }
}

test('after close, an intraday cache is recalibrated instead of frozen for the rest of the day', async t => {
  const r = await quote(t, { time: '13:46', cached: snapshot('13:20') });
  assert.equal(r.body.quotes['0050'].price, 103.2);
  assert.equal(r.upstream.length, 1);
  assert.equal(r.cache.quotes['0050'].price, 103.2);
});
test('opening the app after close without a matching symbol-set cache can still obtain prices', async t => {
  const r = await quote(t, { time: '15:00' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.quotes['0050'].price, 103.2);
});
test('a recent closing read is cached without inventing a new fetch timestamp', async t => {
  const cached = snapshot('14:10', 103.2);
  const r = await quote(t, { time: '14:11', cached });
  assert.equal(r.upstream.length, 0);
  assert.equal(r.body.fromCache, true);
  assert.equal(r.body.fetchedAt, cached.fetchedAt);
  assert.equal(r.body.quotes['0050'].isStale, false);
});
test('late publication checkpoints and expired caches are allowed to correct an earlier closing read', async t => {
  const r = await quote(t, { time: '13:50', cached: snapshot('13:46') });
  assert.equal(r.body.quotes['0050'].price, 103.2);
  assert.equal(r.upstream.length, 1);
});
test('post-close cache lifetime is bounded rather than lasting until midnight', async t => {
  const r = await quote(t, { time: '15:00', cached: snapshot('14:10') });
  assert.equal(r.body.quotes['0050'].price, 103.2);
  assert.equal(r.upstream.length, 1);
});
test('a manual refresh bypasses the post-close cache', async t => {
  const r = await quote(t, { time: '14:02', cached: snapshot('14:01'), force: true });
  assert.equal(r.body.quotes['0050'].price, 103.2);
  assert.equal(r.upstream.length, 1);
});
test('failed closing sources do not overwrite the prior snapshot or pretend it was recalibrated', async t => {
  const cached = snapshot('13:20');
  const r = await quote(t, { time: '15:00', cached, fail: true });
  assert.equal(r.status, 502);
  assert.equal(r.cache.fetchedAt, cached.fetchedAt);
  assert.equal(r.cache.quotes['0050'].price, 101);
});

test('an old intraday last-seen price cannot block the closing-price fallback after hours', async () => {
  const quotes = { '0050': { source: 'TWSE', price: null, asOfDate: `${DAY}T05:45:00Z`, open: 101 } };
  await fillTwseFromLastTrades(quotes, DAY, { read: async () => ({ price: 102, asOfDate: `${DAY}T05:20:00Z` }), write: async () => {} }, () => false);
  assert.equal(quotes['0050'].price, null, 'leave the price missing so Yahoo closing data can be tried');
});
test('Yahoo closing auction metadata supersedes an older last one-minute bar', async t => {
  const original = { fetch: globalThis.fetch, caches: globalThis.caches };
  t.mock.timers.enable({ apis: ['Date'], now: at('14:00') });
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  globalThis.fetch = async url => {
    if (String(url).includes('mis.twse.com.tw')) return Response.json({ msgArray: [] });
    const minute = String(url).includes('interval=1m');
    return Response.json({ chart: { result: [{
      meta: { regularMarketPrice: 103.2, regularMarketTime: at('13:30') / 1000 },
      timestamp: minute ? [at('13:29') / 1000] : [at('09:00') / 1000 - 86400, at('09:00') / 1000],
      indicators: { quote: [{ close: minute ? [102.5] : [99.7, 103.2] }] }
    }] } });
  };
  try {
    const body = await (await onRequestGet({ request: new Request('https://app.test/quote?symbols=0050&force=1'), env: {} })).json();
    assert.equal(body.quotes['0050'].price, 103.2);
    assert.equal(body.quotes['0050'].asOfDate, `${DAY}T05:30:00.000Z`);
  } finally { globalThis.fetch = original.fetch; globalThis.caches = original.caches; }
});

const source = readAppSource();
const functionText = name => {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
};
test('frontend schedules bounded closing checkpoints, including reopening after the last checkpoint', () => {
  const context = vm.createContext({});
  vm.runInContext(functionText('twCloseRefreshDue'), context);
  const due = (time, last) => context.twCloseRefreshDue(last == null ? 0 : at(last), new Date(at(time)));
  assert.equal(due('13:44', '13:20'), false);
  assert.equal(due('13:45', '13:44'), true);
  assert.equal(due('13:46', '13:45'), true);
  assert.equal(due('13:46', '13:46'), false);
  assert.equal(due('13:50', '13:45'), true);
  assert.equal(due('14:00', '13:50'), true);
  assert.equal(due('16:00', '13:20'), true);
  assert.equal(due('13:57', '13:56'), true);
  assert.equal(due('14:05', '14:04'), true);
  assert.equal(due('16:00', '14:00'), true);
  assert.equal(due('16:00', '14:05'), false);
  assert.equal(context.twCloseRefreshDue(0, new Date('2026-11-14T15:00:00+08:00')), false);
});
test('the quote adapter preserves server fetch time and cache metadata', async () => {
  const fetchedAt = `${DAY}T05:46:00.000Z`;
  const context = vm.createContext({ fetchWithTimeout: async () => Response.json({
    ok: true, quotes: { '0050': { price: 103.2 } }, missing: [], fromCache: true, fetchedAt
  }) });
  vm.runInContext(functionText('fetchQuotesWithFallback'), context);
  const result = await context.fetchQuotesWithFallback(['0050']);
  assert.equal(result.fetchedAt, fetchedAt);
  assert.equal(result.fromCache, true);
});

test('the panel keeps reconciling after 13:45, pauses hidden/closed sessions and stops after the closing window', () => {
  const start = source.indexOf('  // Intraday refresh is every 15 seconds');
  const end = source.indexOf('\n  const todayClosure', start);
  assert.ok(start > 0 && end > start);
  let now = at('13:44'), tick, visible, cleanup, effect, closed = false, succeeds = true;
  const calls = [], lastFetchAtRef = { current: at('13:44') };
  const lastCompleteQuoteAtRef = { current: at('13:44') }, closingRetriesRef = { current: 0 };
  const checkedSymbolSetRef = { current: '0050' };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { visibilityState: 'visible', addEventListener: (_, fn) => { visible = fn; }, removeEventListener() {} };
  const context = vm.createContext({ Date: Clock, document, cacheLoaded: true, activeSymbolsKey: '0050',
    marketCalendarReady: true, marketClosure: null, dayKey: DAY, lastFetchAtRef, lastCompleteQuoteAtRef, closingRetriesRef, checkedSymbolSetRef,
    isMarketClosedToday: () => closed, taipeiDateKey: () => DAY,
    useEffect: fn => { effect = fn; cleanup = fn(); }, setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    fetchAllLive: force => { calls.push({ now, force }); lastFetchAtRef.current = now; if (succeeds) { lastCompleteQuoteAtRef.current = now; closingRetriesRef.current = 0; } }
  });
  vm.runInContext(functionText('isTwseTradingHours') + functionText('twCloseRefreshDue') + source.slice(start, end), context);
  assert.equal(calls.length, 0, 'a just-loaded fresh cache is not fetched twice');
  now = at('13:45'); tick();
  assert.equal(calls.at(-1).force, true);
  now = at('13:57'); tick();
  assert.equal(calls.at(-1).now, now, 'late closing publication is still picked up');
  const count = calls.length;
  now = at('13:58'); document.visibilityState = 'hidden'; tick();
  assert.equal(calls.length, count);
  document.visibilityState = 'visible'; visible();
  assert.equal(calls.length, count + 1);
  now = at('13:59'); closed = true; tick();
  assert.equal(calls.length, count + 1, 'a holiday/closure never starts reconciliation');
  closed = false; now = at('14:05'); tick();
  const finalCount = calls.length;
  now = at('14:10'); tick();
  assert.equal(calls.length, finalCount, 'closing checks are bounded');
  // A failed final read must not become the success watermark. Retries are
  // bounded, and returning to the tab lets a later source recovery succeed.
  succeeds = false; lastCompleteQuoteAtRef.current = at('14:04');
  lastFetchAtRef.current = at('14:04'); closingRetriesRef.current = 0;
  for (const time of ['14:05', '14:06', '14:07', '14:08']) { now = at(time); tick(); }
  assert.equal(calls.length, finalCount + 3);
  assert.equal(lastCompleteQuoteAtRef.current, at('14:04'));
  now = at('14:09'); succeeds = true; visible();
  assert.equal(calls.length, finalCount + 4);
  assert.equal(lastCompleteQuoteAtRef.current, at('14:09'));
  now = at('14:10'); tick();
  assert.equal(calls.length, finalCount + 4);
  context.activeSymbolsKey = '0050,2330'; now = at('14:12'); effect();
  assert.equal(calls.length, finalCount + 5, 'adding a holding invalidates the old complete-set watermark');
  assert.equal(typeof cleanup, 'function'); cleanup();
});

test('only complete same-day actual quotes mark a closing acquisition successful', () => {
  const context = vm.createContext({});
  vm.runInContext(functionText('twQuotesCompleteAt'), context);
  const stamp = `${DAY}T06:05:00Z`;
  const q = { price: 103.2, priceSource: 'last', asOfDate: `${DAY}T05:30:00Z`, isStale: false };
  const complete = quotes => context.twQuotesCompleteAt(quotes, ['0050', 'TAIEX'], stamp);
  assert.equal(complete({ '0050': q, TAIEX: q }), Date.parse(stamp));
  assert.equal(complete({ '0050': q }), 0);
  assert.equal(complete({ '0050': { ...q, isStale: true }, TAIEX: q }), 0);
  assert.equal(complete({ '0050': { ...q, priceSource: 'last-seen' }, TAIEX: q }), 0);
  assert.equal(complete({ '0050': { ...q, asOfDate: '2026-11-10T05:30:00Z' }, TAIEX: q }), 0);
});
