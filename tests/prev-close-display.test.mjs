import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 即時股價面板：每檔要看得到「昨收」與漲跌價差；大盤要看得到昨收點數與漲跌點數。
// quote.js 抓不到真正的前收時會把 prevClose 設成現價並加 warning，那個值不能當昨收顯示。
const html = fs.readFileSync('index.html', 'utf8');

test('each holding row shows previous close and the price difference', () => {
  assert.match(html, /<UiLabel zh="昨收" \/> \{r\.prevCloseOk \? Number\(r\.prevClose\)\.toFixed\(2\) : "--"\}/);
  assert.match(html, /\{r\.chg >= 0 \? "\+" : ""\}\{r\.chg\.toFixed\(2\)\}/);
  assert.match(html, /grid-rows-\[18px_18px_18px_18px\]/);
  assert.match(html, /row-start-4 col-start-2 col-span-3 h-\[18px\]/, 'sparkline moves below the new 昨收 line');
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
