import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveIntradayDay, readIntradayBars, aggregateBars } from '../functions/intraday.js';

globalThis.caches = { default: { match: async () => null, put: async () => {} } };

function fakeKV() {
  const data = new Map();
  const puts = [];
  return { data, puts,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v, opts) => { data.set(k, v); puts.push({ k, opts }); } };
}

// 2026-10-01 週四，台北 = UTC+8
const minutes = (from, to) => {
  const rows = [];
  for (let m = from; m <= to; m += 1) {
    const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    rows.push([label, 50 + m % 7, 51 + m % 7, 49 + m % 7, 50.5 + m % 7, 4]);
  }
  return rows;
};
const seed = (kv, day = '2026-10-01') => kv.data.set(`intraday:${day}`, JSON.stringify({ v: 1, day, bars: { '0056': minutes(540, 810) } }));

test('does not archive before 13:35 (the 13:30 bar may not have propagated yet)', async () => {
  const kv = fakeKV(); seed(kv);
  const r = await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-01T05:31:00Z')); // 13:31
  assert.notEqual(r.archived?.length, 1);
  assert.equal(kv.data.has('intraday5:2026-10-01'), false);
});

test('archives today from 13:35 with the full session incl. the 13:30 bar', async () => {
  const kv = fakeKV(); seed(kv);
  const r = await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-01T05:35:00Z'));
  assert.deepEqual(r.archived, ['0056']);
  const doc = JSON.parse(kv.data.get('intraday5:2026-10-01'));
  assert.equal(doc.bars['0056'].at(-1).time, '13:30');
  assert.equal(kv.puts[0].opts.expirationTtl, 90 * 24 * 3600);
  // 第二次不再寫
  const again = await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-01T05:36:00Z'));
  assert.equal(again.skipped, 'already_archived');
  assert.equal(kv.puts.length, 1);
});

test('daily 00:00Z cron (08:00 Taipei) archives the previous day instead of skipping', async () => {
  const kv = fakeKV(); seed(kv, '2026-09-30');
  const r = await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(r.archived, ['0056']);
  assert.equal(r.day, '2026-09-30');
  assert.ok(kv.data.has('intraday5:2026-09-30'));
});

test('holiday / weekend: nothing to archive, nothing written', async () => {
  const kv = fakeKV();
  assert.equal((await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-03T00:00:00Z'))).skipped, 'no_intraday');
  assert.equal((await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-03T06:00:00Z'))).skipped, 'weekend');
  assert.equal(kv.puts.length, 0);
});

test('reading 15-min K from the archive reports minutes in real minutes, not 5-min row counts', async () => {
  const kv = fakeKV(); seed(kv);
  await archiveIntradayDay({ health_kv: kv }, new Date('2026-10-01T05:35:00Z'));
  kv.data.delete('intraday:2026-10-01'); // 1 分 K 已過期，只剩封存
  const r = await readIntradayBars({ health_kv: kv }, { symbols: ['0056'], interval: 15, date: '2026-10-01' }, new Date('2026-10-02T02:00:00Z'));
  assert.equal(r.found, true);
  const first = r.bars['0056'][0];
  assert.equal(first.time, '09:00');
  assert.equal(first.minutes, 15);
  const five = (await readIntradayBars({ health_kv: kv }, { symbols: ['0056'], interval: 5, date: '2026-10-01' }, new Date('2026-10-02T02:00:00Z'))).bars['0056'][0];
  assert.equal(five.minutes, 5);
});

test('aggregateBars: optional 7th element weights minutes; default is 1', () => {
  const out = aggregateBars([['09:00', 1, 2, 0, 1, 4, 5], ['09:05', 1, 3, 1, 2, 4, 5]], 10);
  assert.equal(out[0].minutes, 10);
  assert.equal(aggregateBars([['09:00', 1, 1, 1, 1, 4], ['09:01', 1, 1, 1, 1, 4]], 5)[0].minutes, 2);
});
