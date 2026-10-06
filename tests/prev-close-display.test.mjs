import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 即時股價面板：每檔要看得到「昨收」與漲跌價差；大盤要看得到昨收點數與漲跌點數。
// quote.js 抓不到真正的前收時會把 prevClose 設成現價並加 warning，那個值不能當昨收顯示。
const html = fs.readFileSync('index.html', 'utf8');

test('each holding card shows previous close and the converted TWD price difference', () => {
  assert.match(html, /NT\$ \{r\.prevCloseOk \? formatNtdPrice\(quoteNtd\(r, r\.prevClose\), 1\) : "—"\}/);
  assert.match(html, /NT\$ \{formatNtdPrice\(quoteNtd\(r, r\.chg\), 1\)\}/);
  assert.match(html, /SessionSparkline points=\{withLive\(sparkFor\(r\.symbol\)/);
});

test('a fake previous close (no_prevClose_available) is never shown as 昨收', () => {
  assert.match(html, /const prevCloseOk = l\.warning !== "no_prevClose_available"/);
  assert.match(html, /const indexPrevCloseOk = hasMarketIndex && marketIndex\?\.warning !== "no_prevClose_available"/);
});

test('TAIEX block shows previous close points and the point change', () => {
  assert.match(html, /\{indexPrevCloseOk && \(/);
  assert.match(html, /<UiLabel zh="昨收" inline \/> \{fmt2\(indexPrevClose\)\}/);
  assert.match(html, /<UiLabel zh="漲跌" inline \/> \{indexChange >= 0 \? "\+" : "−"\}\{fmt2\(Math\.abs\(indexChange\)\)\} <UiLabel zh="點" inline \/>/);
});

test('new labels have English translations', () => {
  for (const zh of ['昨收', '漲跌', '點']) assert.match(html, new RegExp(`"${zh}": "`));
});

test('compact quotes expand naturally without a nested scroll area', () => {
  const start = html.indexOf('<div className="live-quote-list">');
  const block = html.slice(start, html.indexOf('{/* One flat summary', start));
  assert.ok(start > 0);
  assert.doesNotMatch(block, /max-h-|overflow-y-auto|live-quote-card/);
  assert.match(block, /live-quote-grid/);
  assert.match(block, /formatNtdPrice\(r.value, 1\)/);
});
