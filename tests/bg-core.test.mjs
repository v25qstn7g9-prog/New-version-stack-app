import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { self: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('bg-core.js', 'utf8'), ctx);
const Z = ctx.self.ZinfBg;
const plain = (v) => JSON.parse(JSON.stringify(v));
const at = (iso) => new Date(iso);
const mirror = { holdings: [{ symbol: '0050', shares: 1000, costBasis: 150000 }, { symbol: '00878', shares: 5000, costBasis: 100000 }], recordDates: ['2026-10-02'], prior: { twCost: 240000, usValue: 5000, usCost: 4000 } };
const fresh = (price) => ({ price, isStale: false, asOfDate: '2026-10-05T05:30:00.000Z' });

test('13:45 is a reminder, 14:00 is the record round; already-recorded days only get a confirmation', () => {
  assert.equal(Z.decide(mirror, at('2026-10-05T13:45:00+08:00')).mode, 'reminder');
  assert.equal(Z.decide(mirror, at('2026-10-05T14:00:00+08:00')).mode, 'record');
  assert.equal(Z.decide(mirror, at('2026-10-05T14:00:00+08:00')).recorded, false);
  assert.equal(Z.decide({ ...mirror, recordDates: ['2026-10-05'] }, at('2026-10-05T14:00:00+08:00')).recorded, true);
  assert.equal(Z.decide(null, at('2026-10-05T14:00:00+08:00')).mode, 'no_data');
  assert.match(Z.message(Z.decide({ ...mirror, recordDates: ['2026-10-05'] }, at('2026-10-05T14:00:00+08:00'))).title, /已記錄/);
  assert.match(Z.message(Z.decide(null, at('2026-10-05T14:00:00+08:00'))).body, /打開 App/);
});

test('auto record uses shares x today close, keeps cost and carries US values; any stale/missing quote means no record', () => {
  const quotes = Z.quoteMap({ quotes: { '0050': fresh(190), '00878': fresh(22) } });
  const r = Z.buildRecord(mirror, quotes, '2026-10-05');
  assert.equal(r.ok, true);
  assert.equal(r.record.twValue, 190 * 1000 + 22 * 5000);
  assert.equal(r.record.twCost, 250000);
  assert.deepEqual([r.record.usValue, r.record.usCost, r.record.source], [5000, 4000, 'auto']);
  assert.equal(Z.buildRecord(mirror, Z.quoteMap({ quotes: [{ symbol: '0050', ...fresh(190) }] }), '2026-10-05').ok, false, 'a missing holding quote blocks the record');
  assert.equal(Z.buildRecord(mirror, Z.quoteMap({ quotes: { '0050': fresh(190), '00878': { ...fresh(22), isStale: true } } }), '2026-10-05').ok, false);
  assert.equal(Z.buildRecord(mirror, Z.quoteMap({ quotes: { '0050': fresh(190), '00878': { ...fresh(22), asOfDate: '2026-10-02T05:30:00.000Z' } } }), '2026-10-05').ok, false, 'yesterday quote is not today');
  assert.match(Z.message({ mode: 'record', recorded: false }, { ok: false }).title, /沒能自動記錄/);
  assert.match(Z.message({ mode: 'record', recorded: false }, r).body, /NT\$ 305,000/);
});

test('backfill fills only missing trading days after the last record, never today, and never when trades happened since', () => {
  const closes = { '0050': { '2026-09-30': 100, '2026-10-01': 101, '2026-10-02': 102, '2026-10-05': 103 }, '00878': { '2026-09-30': 20, '2026-10-01': 21, '2026-10-02': 22, '2026-10-05': 23 } };
  const base = { today: '2026-10-05', closes, holdings: [{ symbol: '0050', shares: 10 }, { symbol: '00878', shares: 100 }], trades: [], dailyRecords: [{ date: '2026-09-30', twValue: 3000, twCost: 2500, usValue: 7, usCost: 6 }] };
  const plan = Z.planBackfill(base);
  assert.deepEqual(plain(plan.records.map((r) => r.date)), ['2026-10-01', '2026-10-02']);
  assert.equal(plan.records[0].twValue, 101 * 10 + 21 * 100);
  assert.deepEqual([plan.records[0].twCost, plan.records[0].usValue], [2500, 7]);
  assert.equal(Z.planBackfill({ ...base, trades: [{ date: '2026-10-01' }] }).reason, 'trades_since_last_record');
  assert.equal(Z.planBackfill({ ...base, dailyRecords: [...base.dailyRecords, { date: '2026-10-01', twValue: 1 }] }).records.length, 1, 'a manual record on a day is never replaced');
  assert.equal(Z.planBackfill({ ...base, dailyRecords: [] }).reason, 'no_anchor');
  const partial = { ...base, closes: { ...closes, '00878': { '2026-10-02': 22 } } };
  assert.deepEqual(plain(Z.planBackfill(partial).records.map((r) => r.date)), ['2026-10-02'], 'a day missing any holding close is skipped');
});

test('weekday-gap check avoids network when nothing can be missing (e.g. Friday record, Monday open)', () => {
  assert.equal(Z.hasWeekdayGap('2026-10-02', '2026-10-05'), false);
  assert.equal(Z.hasWeekdayGap('2026-10-01', '2026-10-05'), true);
  assert.equal(Z.hasWeekdayGap('2026-10-04', '2026-10-05'), false);
});

test('index.html, sw.js and worker wiring are all in place', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(html, /<script src="\/bg-core\.js\?v=3"><\/script>/);
  assert.match(html, /register\("\/sw\.js"\)/);
  assert.match(html, /bgSet\("mirror"/);
  assert.match(html, /bgGet\("pendingAuto"\)/);
  assert.match(html, /\/api\/closes\?days=45/);
  assert.match(html, /function PushReminderPanel\(\)/);
  assert.match(html, /<PushReminderPanel \/>/);
  const app = html.slice(html.indexOf('function PushReminderPanel'), html.indexOf('function AddButton'));
  assert.match(app, /useState\("unknown"\)/, 'push state lives inside its own component, not the App body');
  assert.match(sw, /importScripts\("\/bg-core\.js\?v=3"\)/);
  assert.equal((sw.match(/showNotification/g) || []).length >= 2, true);
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /\.catch\(\(e\) => self\.registration\.showNotification/, 'a failing handler still shows a notification (iOS requires one per push)');
});

