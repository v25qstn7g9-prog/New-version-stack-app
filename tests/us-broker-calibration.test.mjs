import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('index.html','utf8');

test('US broker calibration stores a factor tied to the current symbol/share composition', () => {
  assert.match(html, /function usHoldingsCalibrationKey\(holdings\)/);
  assert.match(html, /calibration\?\.activeKey === activeKey/);
  assert.match(html, /factor >= 0\.9 && factor <= 1\.1/);
  assert.match(html, /brokerValue \/ rawValue/);
  assert.match(html, /setUsBrokerCalibration/);
  assert.match(html, /loadKey\("usBrokerCalibration", null\)/);
  assert.match(html, /saveKey\("usBrokerCalibration", usBrokerCalibration\)/);
});

test('calibrated US market value feeds the asset live object used by dashboard and Daily record', () => {
  assert.match(html, /const calibratedUsTotalNtd = applyUsBrokerCalibration\(usLive\.totalNtd, usBrokerCalibration, usCalibrationKey\)/);
  assert.match(html, /const usAssetLive = \{[\s\S]*totalNtd: calibratedUsTotalNtd/);
  assert.match(html, /rawTotalNtd: usLive\.totalNtd/);
  assert.match(html, /brokerCalibrationActive: usCalibrationActive/);
  assert.match(html, /const currentUsValue = [\s\S]*usAssetLive\.totalNtd/);
  const dailyStart = html.indexOf('function DailyPanel');
  const dailyEnd = html.indexOf('\nfunction ', dailyStart + 20);
  const daily = html.slice(dailyStart, dailyEnd);
  assert.match(daily, /usLive\?\.totalNtd/);
});

test('US market-value rows apply calibration while quoted per-share prices stay market quotes', () => {
  const liveStart = html.indexOf('function LivePricePanel');
  const liveEnd = html.indexOf('\nfunction ', liveStart + 20);
  const live = html.slice(liveStart, liveEnd);
  assert.match(live, /brokerCalibrationActive/);
  assert.match(live, /l\.price \* h\.current \* rate \* calibrationFactor/);
  assert.match(live, /quoteNtd\(r, r\.price\)/);
});

test('US holdings page exposes one-time calibration UI and warns when holdings change', () => {
  assert.match(html, /function UsBrokerCalibrationCard/);
  assert.match(html, /<Panel title="美股市值自動校準">/);
  assert.match(html, /<Field label="券商目前美股總市值">/);
  assert.match(html, /<UiLabel zh="套用校準"/);
  assert.match(html, /<UiLabel zh="持股或股數已變動，請重新校準"/);
});

test('backup includes optional US broker calibration', () => {
  assert.match(html, /data: \{ dailyRecords, holdings, trades, dividends, planItems, goal, planSchedule, costBasis, usBrokerCalibration \}/);
  assert.match(html, /isObject\(data\.usBrokerCalibration\)/);
});
