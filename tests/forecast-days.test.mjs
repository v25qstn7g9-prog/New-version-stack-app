import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 趨勢雷達的預測標籤要寫出是哪個交易日：週末／休市日／開盤前，
// 「今日」欄位其實是上個交易日的資料，不能只寫「今日」。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <forecast-days>([\s\S]*?)\/\/ <\/forecast-days>/)?.[1];
assert.ok(block, 'forecast-days block must exist in index.html');

function load({ holidays = [], english = false } = {}) {
  const key = (d) => d.toLocaleDateString('sv-SE');
  const ctx = {
    UI_SHOW_ENGLISH: english,
    cachedTwseHoliday: (d) => (holidays.includes(key(d)) ? { name: '假日' } : null),
    weekendClosure: (d) => (d.getDay() === 0 || d.getDay() === 6 ? { name: '例假日' } : null),
  };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.radarTodayContext=radarTodayContext;this.forecastDayLabel=forecastDayLabel;this.prevTradingDay=prevTradingDay;', ctx);
  return ctx;
}
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi);
const ctxOf = (lib, now, closed) => JSON.parse(JSON.stringify(lib.radarTodayContext(now, closed)));

test('during the session today is today', () => {
  const c = ctxOf(load(), at(2026, 10, 12, 10, 45), false);
  assert.deepEqual(c, { stale: false, phase: 'live', day: '2026-10-12' });
});

test('after the close it is still today', () => {
  assert.equal(ctxOf(load(), at(2026, 10, 9, 15, 0), false).day, '2026-10-09');
  assert.equal(ctxOf(load(), at(2026, 10, 9, 15, 0), false).stale, false);
});

test('Monday before the open: figures are Friday\'s', () => {
  const c = ctxOf(load(), at(2026, 10, 12, 8, 0), false);
  assert.deepEqual(c, { stale: true, phase: 'preOpen', day: '2026-10-09' });
});

test('weekend: figures are Friday\'s', () => {
  const c = ctxOf(load(), at(2026, 10, 11, 15, 0), true);
  assert.deepEqual(c, { stale: true, phase: 'closedDay', day: '2026-10-09' });
});

test('official holidays are skipped when finding the last session', () => {
  const lib = load({ holidays: ['2026-10-09', '2026-10-12'] });
  // Tue 10/13 morning: 10/12 and 10/9 are holidays, weekend before that → Thu 10/8
  assert.equal(ctxOf(lib, at(2026, 10, 13, 8, 0), false).day, '2026-10-08');
  // holiday on a weekday itself
  assert.equal(ctxOf(lib, at(2026, 10, 9, 11, 0), true).day, '2026-10-08');
});

test('day labels', () => {
  assert.equal(load().forecastDayLabel('2026-10-05'), '10/5（一）');
  assert.equal(load({ english: true }).forecastDayLabel('2026-10-04'), 'Sun 10/4');
  assert.equal(load().forecastDayLabel(null), '');
});

test('the radar never shows a bare 今日收盤預測 / 今日波動 label', () => {
  assert.ok(!html.includes('<UiLabel zh="今日收盤預測" />'));
  assert.ok(!html.includes('<UiLabel zh="今日波動" inline />'));
  assert.ok(html.includes('{todayCloseLabel}'));
  assert.ok(html.includes('{targetLabel(next)}'));
});
