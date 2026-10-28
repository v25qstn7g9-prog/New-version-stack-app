import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 台股、美股股價一律照實際成交價顯示，不四捨五入（2026-10-22）。
const src = readAppSource();
const fn = (name) => { const a = src.indexOf(`function ${name}(`); return src.slice(a, src.indexOf('\n}\n', a) + 2); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fn('formatQuotePrice') + fn('quotePriceText'), ctx);

test('prices keep their real decimals: no rounding to 1 decimal, float noise removed', () => {
  assert.equal(ctx.formatQuotePrice(196.35), '196.35');
  assert.equal(ctx.formatQuotePrice(58.150001525878906), '58.15');
  assert.equal(ctx.formatQuotePrice(2425), '2,425.00');
  assert.equal(ctx.formatQuotePrice(622.8350219726562), '622.835');
  assert.equal(ctx.formatQuotePrice(46962.74), '46,962.74');
  assert.equal(ctx.quotePriceText(622.84, true), 'US$ 622.84');
  assert.equal(ctx.quotePriceText(108.15, false), 'NT$ 108.15');
  assert.equal(ctx.formatQuotePrice(null), '—');
});

test('live price card shows actual TW prices and US prices in US$, TAIEX with its decimals', () => {
  assert.doesNotMatch(src, /formatNtdPrice\(quoteNtd\(r, r\.(price|high|low|prevClose)\), 1\)/);
  // 2026-10-28 總覽精簡：每檔一行摘要，現價仍是實際價格
  assert.match(src, /<span className="live-q-price mono">\s*\{quotePriceText\(r\.price, r\.isUS\)\}/);
  assert.match(src, /<span className="live-q-price mono">\{formatQuotePrice\(indexPrice\)\}<\/span>/);
  assert.doesNotMatch(src, /nf\(Math\.round\(indexPrice\)\)/);
});

test('server never invents a mid-price: last trade, then previous trade, else leave it to Yahoo / best bid', async () => {
  const fs = await import('node:fs');
  const q = fs.readFileSync(new URL('../functions/quote.js', import.meta.url), 'utf8');
  assert.doesNotMatch(q, /\(bid \+ ask\) \/ 2/);
  assert.match(q, /lastTrade\(item\.z\)/);
  assert.match(q, /lastTrade\(item\.pz\)/);
  assert.match(q, /delete quotes\[s\]\.bidFallback;/);
});

test('TAIEX high / low keep their decimals too', () => {
  assert.doesNotMatch(src, /nf\(Math\.round\(Number\(marketIndex\.(high|low)\)\)\)/);
  assert.match(src, /高 \{formatQuotePrice\(marketIndex\.high\)\}｜低 \{formatQuotePrice\(marketIndex\.low\)\}/);
});
