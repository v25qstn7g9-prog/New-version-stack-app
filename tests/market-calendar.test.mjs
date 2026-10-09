import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const { marketClosedStatus, officeStatusFromRows, readOfficeCalendar, runCalendarCheck } = await import('../functions/market-calendar.js');
const { holidayStatusFromRows, rowsCoverYear } = await import('../functions/twse-holiday.js');

// 證交所 115 年（2026）的部分休市表
const twse2026 = [
  { Name: '國慶日', Date: '1151009', Description: '國慶日為10月10日適逢星期六，於10月9日（星期五）補假。' },
  { Name: '市場無交易，僅辦理結算交割作業', Date: '1150212', Description: '' },
  { Name: '國曆新年開始交易日', Date: '1150102', Description: '國曆新年開始交易。' },
];
// 人事總處辦公日曆（ruyut/TaiwanCalendar 格式）
const office2027 = [
  { date: '20270101', week: '五', isHoliday: true, description: '開國紀念日' },
  { date: '20270104', week: '一', isHoliday: false, description: '' },
];

test('TWSE schedule: a year it does not cover is unknown, not "open"', () => {
  assert.equal(rowsCoverYear(twse2026, 2026), true);
  assert.equal(rowsCoverYear(twse2026, 2027), false);
  assert.equal(holidayStatusFromRows(twse2026, '2026-10-09').closed, true);
  assert.equal(holidayStatusFromRows(twse2026, '2026-10-08').closed, false);
  assert.equal(holidayStatusFromRows(twse2026, '2027-01-04').closed, null);
});

test('TWSE wins when it covers the year, including settlement-only days that are office work days', async () => {
  const readOffice = async () => { throw new Error('office calendar should not be needed'); };
  const s = await marketClosedStatus('2026-02-12', { readTwse: async () => twse2026, readOffice });
  assert.equal(s.closed, true);
  assert.equal(s.source, 'twse');
  const open = await marketClosedStatus('2026-10-08', { readTwse: async () => twse2026, readOffice });
  assert.deepEqual([open.closed, open.source], [false, 'twse']);
});

test('falls back to the DGPA office calendar when TWSE has not published the year or cannot be read', async () => {
  const readOffice = async (year) => (year === 2027 ? office2027 : null);
  const holiday = await marketClosedStatus('2027-01-01', { readTwse: async () => twse2026, readOffice });
  assert.deepEqual([holiday.closed, holiday.reason, holiday.source], [true, '開國紀念日', 'office']);
  const workday = await marketClosedStatus('2027-01-04', { readTwse: async () => null, readOffice });
  assert.deepEqual([workday.closed, workday.source], [false, 'office']);
  const unknown = await marketClosedStatus('2028-01-03', { readTwse: async () => null, readOffice });
  assert.deepEqual([unknown.closed, unknown.source], [null, null]);
});

test('office calendar parsing and download (cached, bad responses ignored)', async () => {
  assert.equal(officeStatusFromRows(office2027, '2027-01-01').closed, true);
  assert.equal(officeStatusFromRows(office2027, '2027-01-02').closed, null);
  let url = '';
  const rows = await readOfficeCalendar(2027, async (u) => { url = u; return new Response(JSON.stringify(office2027)); });
  assert.match(url, /TaiwanCalendar\/data\/2027\.json$/);
  assert.equal(rows.length, 2);
  assert.equal(await readOfficeCalendar(2027, async () => new Response('nope', { status: 404 })), null);
});

test('December check: LINE reminder only when next year\'s TWSE schedule is missing, and only on check days', async () => {
  const kv = new Map(); const sent = [];
  const env = { health_kv: { put: async (k, v) => kv.set(k, v) }, LINE_CHANNEL_ACCESS_TOKEN: 't', LINE_USER_ID: 'u' };
  const deps = (twseRows, officeRows) => ({ readTwse: async () => twseRows, readOffice: async () => officeRows, pushLine: async (e, text) => { sent.push(text); return { ok: true }; } });
  const decFirst = () => new Date('2026-12-01T00:00:00Z');
  assert.deepEqual(await runCalendarCheck(env, { ...deps(twse2026, null), now: () => new Date('2026-11-01T00:00:00Z') }), { skipped: 'not_check_day' });
  assert.deepEqual(await runCalendarCheck(env, { ...deps(twse2026, null), now: () => new Date('2026-12-02T00:00:00Z') }), { skipped: 'not_check_day' });
  const missing = await runCalendarCheck(env, { ...deps(twse2026, new Array(365).fill({})), now: decFirst });
  assert.equal(missing.twseReady, false);
  assert.equal(missing.officeReady, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /還沒公布 2027 年/);
  assert.match(sent[0], /人事行政總處/);
  assert.equal(JSON.parse(kv.get('calendar:next-year')).year, 2027);
  const ready = await runCalendarCheck(env, { ...deps([...twse2026, { Name: '開國紀念日', Date: '1160101' }], null), now: decFirst });
  assert.equal(ready.twseReady, true);
  assert.equal(sent.length, 1, 'no reminder once TWSE has published');
});
