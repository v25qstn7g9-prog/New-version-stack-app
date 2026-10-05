import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AUTO_DAILY_CRON, REMINDER_MINUTES, buildAutoRecord, runAutoDaily, runDailyReminder, onRequestGet, taipeiParts,
} from '../functions/auto-daily.js';

// 每日資產全自動化：休市不動、13:36/13:45 LINE 提醒、14:00 用收盤價自動記錄、App 拿暫存紀錄。
const TOKEN = 'abcdefghijklmnop1234';
const at = (taipeiHHMM, date = '2026-10-05') => () => new Date(`${date}T${taipeiHHMM}:00+08:00`);

function fakeKv(initial = {}) {
  const map = new Map(Object.entries(initial));
  const puts = [];
  return {
    map, puts,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v, opts) { puts.push({ k, v, opts }); map.set(k, v); },
    async list({ prefix }) { return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const snapshot = (records = []) => JSON.stringify({
  holdings: [
    { symbol: '0050', shares: 4823, costBasis: 393086 },
    { symbol: '0056', shares: 90834, costBasis: 3363586 },
  ],
  dataset: { dailyRecords: records },
});
const PRICES = { '0050': 115.93, '0056': 57.83 };
const yesterday = { date: '2026-10-02', twValue: 5826114, usValue: 84853, twCost: 3834000, usCost: 70000 };

test('buildAutoRecord: shares × close, holdings cost, US carried from the previous record', () => {
  const r = buildAutoRecord(JSON.parse(snapshot([yesterday])), PRICES, '2026-10-05');
  assert.equal(r.ok, true);
  assert.equal(r.record.twValue, Math.round(4823 * 115.93 + 90834 * 57.83));
  assert.equal(r.record.twCost, 393086 + 3363586);
  assert.equal(r.record.usValue, 84853);
  assert.equal(r.record.usCost, 70000);
  assert.equal(r.record.source, 'auto');
});

test('buildAutoRecord refuses when any holding has no price today', () => {
  const r = buildAutoRecord(JSON.parse(snapshot()), { '0050': 115.93 }, '2026-10-05');
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['0056']);
});

test('14:00 auto record: writes once for a synced account without today, skips recorded ones', async () => {
  const kv = fakeKv({
    [`portfolio-sync:${TOKEN}`]: snapshot([yesterday]),
    'portfolio-sync:recordedtoken12345': snapshot([{ ...yesterday, date: '2026-10-05' }]),
    'portfolio-sync-meta:ignored-key-123456': '{}',
  });
  const res = await runAutoDaily({ health_kv: kv }, { now: at('14:00'), marketClosed: async () => false, fetchPrices: async () => PRICES });
  assert.equal(res.written, 1);
  assert.equal(kv.puts.length, 1, 'one KV write per account per day');
  const stored = JSON.parse(kv.map.get(`auto-daily:${TOKEN}`));
  assert.equal(stored.records['2026-10-05'].source, 'auto');
  assert.equal(kv.map.has('auto-daily:recordedtoken12345'), false);
});

test('holidays, weekends and stale quotes never create a record', async () => {
  const kv = fakeKv({ [`portfolio-sync:${TOKEN}`]: snapshot([yesterday]) });
  assert.equal((await runAutoDaily({ health_kv: kv }, { now: at('14:00'), marketClosed: async () => true, fetchPrices: async () => PRICES })).skipped, 'holiday');
  assert.equal((await runAutoDaily({ health_kv: kv }, { now: at('14:00', '2026-10-04'), marketClosed: async () => false, fetchPrices: async () => PRICES })).skipped, 'weekend');
  // 報價過期 → usablePrices 會回空物件 → 不記
  const r = await runAutoDaily({ health_kv: kv }, { now: at('14:00'), marketClosed: async () => false, fetchPrices: async () => ({}) });
  assert.equal(r.written, 0);
  assert.equal(kv.puts.length, 0);
});

test('reminder: only at 13:36 and 13:45, only when not recorded, and only when LINE is configured', async () => {
  assert.deepEqual(REMINDER_MINUTES, [816, 825]);
  const sent = [];
  const fetchMock = async (url, init) => { sent.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization }); return { ok: true, status: 200 }; };
  const env = { health_kv: fakeKv({ [`portfolio-sync:${TOKEN}`]: snapshot([yesterday]) }), LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_USER_ID: 'U123', LINE_REMINDER_SYNC_TOKEN: TOKEN };
  const base = { marketClosed: async () => false, fetch: fetchMock };
  assert.equal((await runDailyReminder(env, { ...base, now: at('13:35') })).skipped, 'not_reminder_minute');
  await runDailyReminder(env, { ...base, now: at('13:36') });
  await runDailyReminder(env, { ...base, now: at('13:45') });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(sent[0].body.to, 'U123');
  assert.equal(sent[0].auth, 'Bearer line-token');
  assert.match(sent[1].body.messages[0].text, /14:00 還沒記的話/);
  // 已記錄 → 不提醒
  env.health_kv = fakeKv({ [`portfolio-sync:${TOKEN}`]: snapshot([{ ...yesterday, date: '2026-10-05' }]) });
  assert.equal((await runDailyReminder(env, { ...base, now: at('13:36') })).skipped, 'already_recorded');
  // 休市 → 不提醒
  assert.equal((await runDailyReminder(env, { ...base, marketClosed: async () => true, now: at('13:36') })).skipped, 'holiday');
  // 沒設定 LINE → 安靜跳過
  assert.equal((await runDailyReminder({ health_kv: env.health_kv }, { ...base, now: at('13:36') })).skipped, 'line_not_configured');
  assert.equal(sent.length, 2);
});

test('GET /api/auto-daily needs the sync token and returns stored auto records', async () => {
  const kv = fakeKv({ [`auto-daily:${TOKEN}`]: JSON.stringify({ records: { '2026-10-05': { date: '2026-10-05', twValue: 1, source: 'auto' } } }) });
  const no = await onRequestGet({ request: new Request('https://x/api/auto-daily'), env: { health_kv: kv } });
  assert.equal(no.status, 401);
  const res = await onRequestGet({ request: new Request('https://x/api/auto-daily', { headers: { authorization: `Bearer ${TOKEN}` } }), env: { health_kv: kv } });
  const data = await res.json();
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].source, 'auto');
});

test('cron string, worker route and scheduled hook stay wired', () => {
  assert.equal(AUTO_DAILY_CRON, '0 6 * * MON-FRI');
  assert.equal(taipeiParts(new Date('2026-10-05T06:00:00Z')).minuteOfDay, 14 * 60, 'UTC 06:00 is 14:00 Taipei');
  const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.equal(wrangler.split(`"${AUTO_DAILY_CRON}"`).length - 1, 3, 'comment + default + production crons');
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /url\.pathname === "\/api\/auto-daily" && request\.method === "GET"/);
  assert.match(worker, /event\.cron === AUTO_DAILY_CRON/);
  assert.match(worker, /await runDailyReminder\(env\)/);
});
