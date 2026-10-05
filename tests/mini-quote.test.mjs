import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { currentShares, activeHoldings, buildView, quoteUrl, readJsonKey } from '../mini-quote-core.js';

const holdings = [
  { symbol: '0050', name: '元大台灣50', initialShares: 1000 },
  { symbol: '2330', name: '台積電', initialShares: 0 },
  { symbol: 'AAPL', name: 'Apple', initialShares: 5 },
];
const trades = [
  { symbol: '0050', action: 'buy', shares: 200 },
  { symbol: '0050', action: 'sell', shares: 50 },
  { symbol: '2330', action: 'buy', shares: 40 },
];

test('share count matches the main app: initial + buys - sells', () => {
  assert.equal(currentShares(holdings[0], trades), 1150);
});

test('only Taiwan symbols with positive shares are tracked', () => {
  assert.deepEqual(activeHoldings(holdings, trades).map((h) => h.symbol), ['0050', '2330']);
  assert.deepEqual(activeHoldings(null, trades), []);
});

test('buildView computes index, per-holding move and total P&L', () => {
  const v = buildView(activeHoldings(holdings, trades), {
    TAIEX: { price: 110, prevClose: 100 },
    '0050': { price: 102, prevClose: 100 },
    '2330': { price: 1010, prevClose: 1000 },
  });
  assert.equal(v.index.change, 10);
  assert.equal(v.index.pct, 10);
  assert.equal(v.rows[0].pnl, 2 * 1150);
  assert.equal(v.rows[1].change, 10);
  assert.equal(v.totalPnl, 2 * 1150 + 10 * 40);
  assert.deepEqual(v.missing, []);
});

test('a missing quote is reported, never invented', () => {
  const v = buildView(activeHoldings(holdings, trades), { '0050': { price: 102, prevClose: 100 } });
  assert.deepEqual(v.missing, ['2330']);
  assert.equal(v.index, null);
  assert.equal(v.rows[1].hasQuote, false);
  assert.equal(v.rows[1].pnl, null);
});

test('quote with no usable prevClose is treated as missing', () => {
  const v = buildView(activeHoldings(holdings, trades), { '0050': { price: 102, prevClose: null } });
  assert.ok(v.missing.includes('0050'));
});

test('quote url asks for holdings plus TAIEX from the same /quote API', () => {
  const u = quoteUrl(activeHoldings(holdings, trades), true, 1);
  assert.match(u, /^\/quote\?symbols=0050%2C2330%2CTAIEX&force=1&_ts=1$/);
});

test('readJsonKey survives bad JSON and missing storage', () => {
  assert.deepEqual(readJsonKey({ getItem: () => '{bad' }, 'x', []), []);
  assert.deepEqual(readJsonKey(undefined, 'x', 7), 7);
});

test('mini.html is a static page not blocked by .assetsignore and only calls /quote', () => {
  const html = fs.readFileSync('mini.html', 'utf8');
  assert.match(html, /mini-quote-core\.js/);
  const ignore = fs.readFileSync('.assetsignore', 'utf8');
  assert.doesNotMatch(ignore, /^mini/m);
  assert.doesNotMatch(html, /setItem|removeItem|localStorage\.clear/, 'mini page must be read-only on app data');
});

test('main app links to /mini.html and the mini page links back', () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /href="\/mini\.html"/);
  assert.match(fs.readFileSync('mini.html', 'utf8'), /href="\/"/);
});
