// 首頁「今日」增減（使用者 2026-11-04「首頁的今日資產增減總數怪怪的」）：交易日用每檔「(現價 − 昨收) × 股數」加總，
// 和每檔一行的今日損益加起來一樣；不再用「現在市值 − 昨天存的每日紀錄」（紀錄若是盤中存的或之後又買了股，總數會對不上）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const fnSrc = src.slice(src.indexOf("function quoteDayChange("), src.indexOf("function changeLabelDate("));
const quoteDayChange = new Function(fnSrc + "\nreturn quoteDayChange;")();

test("today's change is the sum of every holding's (price − previous close) × shares, US in NTD", () => {
  // 2026-11-04 09:34: 0050 / 0056 / 2330 / VOO (fx 32.59)
  const r = quoteDayChange([
    { price: 100.35, prevClose: 100.6, shares: 5187 }, { price: 52.8, prevClose: 53.55, shares: 91403 },
    { price: 2290, prevClose: 2295, shares: 49 }, { price: 691.33, prevClose: 691.32, shares: 4.36369, rate: 32.59 },
  ]);
  assert.equal(Math.round(r.change), -70093);
  assert.equal(Math.round(r.base), 5627212, 'yesterday-close value of the same shares (the price card shows it as 昨收市值)');
  assert.equal(r.pct.toFixed(2), (r.change / r.base * 100).toFixed(2));
});

test("no answer (falls back to the daily record) when a holding has no price, no real previous close or is flagged", () => {
  assert.equal(quoteDayChange([]), null);
  assert.equal(quoteDayChange([{ price: 10, prevClose: 0, shares: 1 }]), null);
  assert.equal(quoteDayChange([{ price: 10, prevClose: 9, shares: 1 }, { price: 0, prevClose: 9, shares: 1 }]), null);
  assert.equal(quoteDayChange([{ price: 10, prevClose: 9, shares: 1, ok: false }]), null);
  assert.equal(quoteDayChange([{ price: 10, prevClose: 9, shares: 1, rate: 0 }]), null);
});

test("the overview total and the price card both use it on trading days; holidays and pre-open keep the record comparison", () => {
  assert.match(src, /const dailyChange = quoteDay \? Math\.round\(quoteDay\.change\) : totalPrev != null \? totalToday - totalPrev : 0;/);
  assert.match(src, /if \(isNonTradingDay\(\)\) return null;/);
  assert.match(src, /taipeiDateKey\(new Date\(t\)\) !== today\) return null;/, "only today's quotes");
  assert.match(src, /const diff = rowDay \? rowDay\.change : totalValue - recBase;/);
  assert.match(src, /const portfolioDayPct = twRowDay \? twRowDay\.pct : yesterdayTwValue/);
});
