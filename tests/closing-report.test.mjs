import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync('index.html', 'utf8');
function reportHarness(closed, marketPct) {
  const writes = [];
  const start=html.indexOf('function DailyClosingAiReport(');
  const source=html.slice(start,html.indexOf('  useEffect(() => {',start));
  const ctx = { Number, Date, console, Promise,
    useState: value => [value, () => {}],
    useTaipeiDayKey: () => '2026-10-04',
    taiwanDateParts: () => ({year:'2026',month:'10',day:'04',hour:22,minute:30}),
    isNonTradingDay: () => closed, refreshTwseHolidaySchedule: async () => ({}),
    isTaiwanSymbol: () => true, nf: String,
    loadKey: async (key, fallback) => key === 'trendRadarCurrentSnapshot' ? {market:{indexPct:marketPct}} : fallback,
    saveKey: async (key, value) => writes.push({key,value}),
    localStorage: {getItem: () => null},
  };
  vm.createContext(ctx);
  vm.runInContext(source+'\n return buildAndAsk; }\nrun=DailyClosingAiReport({holdings:[{symbol:"0050",current:1}],dailyRecords:[]});',ctx);
  return {run:ctx.run,writes};
}
test('closed days never write a closing report, including forced recalculation', async () => {
  for (const force of [false,true]) {
    const h=reportHarness(true,1);await h.run(force);
    assert.equal(h.writes.length,0);
  }
});
test('missing market and holding changes stay unknown rather than zero', async () => {
  for (const pct of [null,'',' ',undefined]) {
    const h=reportHarness(false,pct);await h.run(false);
    assert.equal(h.writes.length,1);
    assert.match(h.writes[0].value.text,/大盤 資料不足/);
    assert.match(h.writes[0].value.text,/0050 ：資料不足/);
    assert.doesNotMatch(h.writes[0].value.text,/大盤 \+0\.00%/);
  }
});
test('real zero and negative percentage remain valid closing data', async () => {
  for (const [pct,want] of [[0,'大盤 +0.00%'],[-1.2,'大盤 -1.20%']]) {
    const h=reportHarness(false,pct);await h.run(false);
    assert.equal(h.writes.length,1);
    assert.ok(h.writes[0].value.text.includes(want));
  }
});
