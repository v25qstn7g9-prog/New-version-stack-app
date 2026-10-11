import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 持股進度：台股、美股第一張卡都是「持股進度」；美股市值校準放在持股清單下面，
// 不再把美股頁頂部擠成跟台股不同的排版。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the US calibration card is no longer rendered above the holdings panel', () => {
  const ws = html.slice(html.indexOf('function HoldingsWorkspace('), html.indexOf('function HoldingsPanel('));
  assert.ok(!/\{activeMarket === "us" && \(\s*<UsBrokerCalibrationCard/.test(ws), 'calibration card must not precede HoldingsPanel');
  assert.ok(/afterList=\{activeMarket === "us" \? <UsBrokerCalibrationCard/.test(ws));
});

test('HoldingsPanel renders afterList between the holdings list and the add form', () => {
  const hp = html.slice(html.indexOf('function HoldingsPanel('));
  const list = hp.indexOf('<Panel title="持股進度">');
  const slot = hp.indexOf('{afterList}');
  const add = hp.indexOf('<Panel title="新增持股標的">');
  assert.ok(list > 0 && slot > list && add > slot, 'order must be 持股進度 → afterList → 新增持股標的');
});
