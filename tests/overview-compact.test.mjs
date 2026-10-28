import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAppSource } from './_app-source.mjs';

// 2026-10-28 總覽精簡：大盤和各股留在第一屏，但每檔一行摘要、細節點開才看；重複的市值明細收起；小貓按鈕收成一顆。
const html = readAppSource();
const start = html.indexOf('function LivePricePanel(');
const panel = html.slice(start, html.indexOf('\nfunction ', start + 20));

test('每檔一行摘要（代號・現價・漲跌％・今日損益），高低昨收與市值點開才顯示', () => {
  assert.match(panel, /className="live-q-sum" onClick=\{\(\) => toggleRow\(r\.id\)\} aria-expanded=\{open\}/);
  assert.match(panel, /\{open && \(\s*<div className="live-quote-grid mono live-q-detail">/);
  assert.match(panel, /<UiLabel zh="高" inline \/> \{quotePriceText\(r\.high, r\.isUS\)\}/);
});

test('大盤也一行摘要＋漲跌點數＋贏輸大盤；高低昨收點開才顯示', () => {
  assert.match(panel, /onClick=\{\(\) => setIndexOpen\(\(v\) => !v\)\}/);
  assert.match(panel, /\{indexOpen && \(/);
});

test('「趨勢累積中」只在大盤寫一次，各股不重複', () => {
  assert.match(html, /function SessionSparkline\(\{[^}]*placeholder=true \}\)/);
  assert.match(panel, /<SessionSparkline points=\{rowSpark\}[^\n]*placeholder=\{false\}/);
  assert.match(panel, /\{rowSpark\.length >= 2 && \(/);
});

test('即時股價底下的市值明細預設收起；重新整理改成小圖示（仍保留說明文字給讀屏）', () => {
  assert.match(panel, /const \[summaryOpen, setSummaryOpen\] = useState\(false\)/);
  assert.match(panel, /\{summaryOpen && \(<>/);
  assert.match(panel, /className="forma-tap live-refresh-icon/);
  assert.match(panel, /aria-label=\{uiText\("抓取即時股價"\)\}/);
  assert.doesNotMatch(panel, /<UiLabel zh="抓取即時股價" \/>/);
});

test('頂端小貓只留一顆「小貓」按鈕，暫停／收起／叫醒收在裡面', () => {
  const life = fs.readFileSync(new URL('../za-catlife.js', import.meta.url), 'utf8');
  assert.match(life, /menu\.textContent='小貓 ▾'/);
  assert.match(life, /\.za-cat-pair-bar:not\(\.za-cat-open\) \.za-cat-opt\{display:none!important\}/);
  assert.match(life, /\[rt\.pause,hide,pet\]\.forEach/);
});
