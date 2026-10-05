import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function mergeUsQuoteSnapshot(');
const end = html.indexOf('function useUsLivePrices(', start);
const context = vm.createContext({});
if (start >= 0 && end > start) vm.runInContext(html.slice(start, end), context);
test('partial US refresh preserves missing holding and FX with original quote time', () => {
  assert.equal(typeof context.mergeUsQuoteSnapshot, 'function');
  const old = { quotes: { AAPL: { price: 100, asOfDate: 'old' }, MSFT: { price: 200, asOfDate: 'old' } }, fx: 32 };
  const next = context.mergeUsQuoteSnapshot(old, { AAPL: { price: 110, asOfDate: 'new' } }, ['AAPL', 'MSFT']);
  assert.equal(next.quotes.MSFT.price, 200);
  assert.equal(next.quotes.MSFT.asOfDate, 'old');
  assert.equal(next.fx, 32);
  assert.equal(context.usQuotePortfolioValue([{symbol:'AAPL', shares:2},{symbol:'MSFT',shares:1}], next), 13440);
  assert.deepEqual(Array.from(next.failed), ['MSFT', 'USD/TWD']);
});
test('incomplete first response cannot replace total assets with a partial sum', () => {
  assert.equal(typeof context.usQuotePortfolioValue, 'function');
  assert.equal(context.usQuotePortfolioValue([{symbol:'AAPL',shares:2},{symbol:'MSFT',shares:1}], {quotes:{AAPL:{price:100}},fx:32}), null);
});
test('changed holdings are valued from shares rather than a cached portfolio total', () => {
  assert.equal(typeof context.usQuotePortfolioValue, 'function');
  assert.equal(context.usQuotePortfolioValue([{symbol:' aapl ',shares:1.5}], {quotes:{AAPL:{price:100}},fx:32}), 4800);
});
test('US polling uses 30 seconds and pauses while hidden, then refreshes on return', async () => {
  const hooks = html.slice(html.indexOf('function mergeUsQuoteSnapshot('), html.indexOf('function UsLivePricePanel('));
  let state, tick, visible, interval, requests = 0, now = 100000;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const document = { visibilityState: 'visible', addEventListener: (_, fn) => {visible = fn;}, removeEventListener() {} };
  const ctx = vm.createContext({
    Date: Clock, document, useState: (initial) => { state = initial; return [initial, value => {state = typeof value === 'function' ? value(state) : value;}]; },
    useRef: value => ({current:value}), useEffect: fn => fn(),
    setInterval: (fn, ms) => {tick = fn; interval = ms; return 1;}, clearInterval() {},
    isUsRegularTradingHours: () => true, loadKey: async () => null, saveKey: async () => {},
    fetchQuotesWithFallback: async () => {requests++; return {quotes: {AAPL:{price:100},USDTWD:{price:32}}};}
  });
  vm.runInContext(hooks, ctx);
  ctx.useUsLivePrices([{symbol:'AAPL',shares:2}], true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(interval, 30000);
  assert.equal(ctx.usQuotePortfolioValue([{symbol:'AAPL',shares:2}], state), 6400);
  now += 30000; document.visibilityState = 'hidden'; tick();
  assert.equal(requests, 1);
  document.visibilityState = 'visible'; visible();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
});
