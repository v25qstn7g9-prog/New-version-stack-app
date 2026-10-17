import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAppSource } from './_app-source.mjs';

// 10/14 回報：改了持股成本後，在「每日紀錄」按「重新抓報價」，成本欄還是舊的（只重抓了市值），要重開 App 才更新。
const html = readAppSource();
const panel = html.slice(html.indexOf('function DailyPanel('), html.indexOf('<UiLabel zh="重新抓報價" inline />'));

test('the refresh button also re-reads both costs from the holdings page', () => {
  const btn = panel.slice(panel.lastIndexOf('<button onClick={() => {'));
  assert.match(btn, /twValue: "", usValue: "", twCost: "", usCost: ""/);
  assert.match(btn, /twCost: "wantHoldings", usCost: "wantHoldings"/);
});

test('a requested cost refresh fills from holdings before the saved same-day record can refill the old value', () => {
  const want = panel.indexOf('const wantCost = (k) => isToday && autoFrom[k] === "wantHoldings" && form[k] === "";');
  const saved = panel.indexOf('if (sameDayRecord) {');
  assert.ok(want > 0 && want < saved);
  assert.match(panel, /if \(wantCost\("twCost"\)[^\n]*fills\.twCost = String\(autoTwCost\)/);
  assert.match(panel, /if \(wantCost\("usCost"\)[^\n]*fills\.usCost = String\(autoUsCost\)/);
  // 同一天已存的紀錄只補「還沒有值」的欄位，不會蓋掉剛帶入的新成本
  assert.match(panel, /canFill\(k\) && fills\[k\] == null && sameDayRecord\[k\] != null/);
});
