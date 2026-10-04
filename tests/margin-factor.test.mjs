import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 融資融券是「只記錄、不計入機率」的因子（shadow mode）：
// 先存進歷史紀錄、讓因子回測去量它有沒有用，確認有效前不得影響分數。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <margin-helpers>([\s\S]*?)\/\/ <\/margin-helpers>/)?.[1];
assert.ok(block, 'margin-helpers block must exist in index.html');
const ctx = {};
vm.runInNewContext(block + '\nthis.parseMarginRows=parseMarginRows;this.marginStats=marginStats;this.marginForRecord=marginForRecord;', ctx);
const { parseMarginRows, marginStats, marginForRecord } = ctx;

const FIELDS = ['代號', '名稱', '買進', '賣出', '現金償還', '前日餘額', '今日餘額', '限額', '買進', '賣出', '現券償還', '前日餘額', '今日餘額', '限額', '資券互抵', '註記'];
const row = (sym, mPrev, mNow, sPrev, sNow) => [sym, 'x', '1', '1', '0', mPrev, mNow, '9,999', '1', '1', '0', sPrev, sNow, '9,999', '0', ''];
const resp = (data, fields = FIELDS) => ({ stat: 'OK', tables: [{ title: '信用交易統計', fields: ['項目', '買進', '賣出', '現金(券)償還', '前日餘額', '今日餘額'], data: [] }, { title: '融資融券彙總', fields, data }] });

test('parses 融資 and 融券 balances from the per-stock table by header name', () => {
  const map = parseMarginRows(resp([row('2330', '10,000', '10,500', '200', '250'), row('0056', '5,000', '4,900', '10', '12'), row('9999', '1', '1', '1', '1')]), ['2330', '0056']);
  assert.deepEqual(JSON.parse(JSON.stringify(map)), {
    2330: { marginBal: 10500, marginPrev: 10000, shortBal: 250, shortPrev: 200 },
    '0056': { marginBal: 4900, marginPrev: 5000, shortBal: 12, shortPrev: 10 },
  });
});

test('still reads the right columns when the table gets an extra leading column', () => {
  const fields = ['市場', ...FIELDS];
  const data = [['tse', ...row('2330', '100', '110', '5', '6')]];
  assert.equal(parseMarginRows(resp(data, fields), ['2330'])['2330'].marginBal, 110);
});

test('unusable responses return null; rows with missing numbers are skipped', () => {
  for (const bad of [null, {}, { tables: [] }, { stat: '很抱歉，沒有符合條件的資料!' }, { tables: [{ fields: ['代號'], data: [] }] }]) {
    assert.equal(parseMarginRows(bad, ['2330']), null);
  }
  const map = parseMarginRows(resp([row('2330', '--', '10', '1', '1')]), ['2330']);
  assert.deepEqual(Object.keys(map), []);
});

test('marginStats computes 1日/3日 change and 券資比', () => {
  const mk = (date, now, prev) => ({ date, map: { 2330: { marginBal: now, marginPrev: prev, shortBal: 50, shortPrev: 40 } } });
  const s = marginStats([mk('d3', 1100, 1050), mk('d2', 1050, 1000), mk('d1', 1000, 900)], '2330');
  assert.equal(s.date, 'd3');
  assert.equal(s.marginBal, 1100);
  assert.ok(Math.abs(s.chg1 - (50 / 1050) * 100) < 1e-9);
  assert.ok(Math.abs(s.chg3 - ((1100 - 900) / 900) * 100) < 1e-9);
  assert.ok(Math.abs(s.shortRatio - (50 / 1100) * 100) < 1e-9);
});

test('marginStats degrades gracefully: unknown stock → null, fewer than 3 days → chg3 null, zero base → null', () => {
  assert.equal(marginStats([], '2330'), null);
  assert.equal(marginStats(undefined, '2330'), null);
  const one = [{ date: 'd', map: { 2330: { marginBal: 0, marginPrev: 0, shortBal: 5, shortPrev: 5 } } }];
  assert.equal(marginStats(one, '2330').chg3, null);
  assert.equal(marginStats(one, '2330').chg1, null);
  assert.equal(marginStats(one, '2330').shortRatio, null);
  assert.equal(marginStats(one, '2317'), null);
  assert.equal(marginForRecord(null), null);
});

test('shadow mode: margin never feeds the probability computation', () => {
  const start = html.indexOf('const margin=marginStats(');
  const end = html.indexOf('return {symbol:h.symbol', start);
  assert.ok(start > 0 && end > start, 'row-building region must be found');
  const afterDecl = html.slice(start, end).split('\n').slice(1).join('\n');
  assert.ok(!/\bmargin/i.test(afterDecl), 'score code between the margin declaration and the row object must not reference margin');
  // the only consumers are the row object, the two history records and the snapshot
  assert.equal((html.match(/margin:marginForRecord\(r\.margin\)/g) || []).length, 3);
});

test('both history records and the current snapshot carry the margin field', () => {
  assert.equal((html.match(/phase:"(morning|closeLock)"[^\n]*margin:marginForRecord\(r\.margin\)/g) || []).length, 2);
});
