import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  onRequestGet, onRequestPost, snapshotSize, isEmptySnapshotSize, shrinkReason,
} from '../functions/portfolio-sync.js';

// 防覆蓋保護：空的 App 副本帶著同一組 token 開啟，不能把中控裡的完整資料蓋成 0。

const token = 'a'.repeat(40);
const other = 'b'.repeat(40);

function environment() {
  const records = new Map();
  const puts = [];
  return {
    records, puts,
    health_kv: {
      get: async (key) => records.get(key) ?? null,
      put: async (key, value, opts) => { puts.push({ key, opts }); records.set(key, value); },
    },
  };
}

const rows = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: i, ...extra }));
const full = (over = {}) => ({
  totalAssets: 5910210,
  holdings: [{ symbol: '0056', shares: 90802 }, { symbol: '0050', shares: 4793 }],
  dataset: { holdings: rows(2), trades: rows(413), dailyRecords: rows(117), dividends: rows(37), ...over },
});
const empty = () => ({ totalAssets: 0, holdings: [], dataset: { holdings: [], trades: [], dailyRecords: [], dividends: [] } });

const post = (env, summary, t = token) => onRequestPost({ env, request: new Request('https://example.com/api/portfolio-sync', {
  method: 'POST',
  headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
  body: JSON.stringify({ summary }),
}) });
const get = (env, query = '', t = token) => onRequestGet({ env, request: new Request(`https://example.com/api/portfolio-sync${query}`, {
  headers: { authorization: `Bearer ${t}` },
}) });

// ── 純函式 ─────────────────────────────────────────────

test('snapshotSize counts holdings/trades/dailyRecords/dividends, tolerates old snapshots', () => {
  assert.deepEqual(snapshotSize(full()), { holdings: 2, trades: 413, dailyRecords: 117, dividends: 37 });
  assert.deepEqual(snapshotSize({ holdings: [{ symbol: '0050' }] }), { holdings: 1, trades: 0, dailyRecords: 0, dividends: 0 });
  assert.deepEqual(snapshotSize({}), { holdings: 0, trades: 0, dailyRecords: 0, dividends: 0 });
  assert.deepEqual(snapshotSize(null), { holdings: 0, trades: 0, dailyRecords: 0, dividends: 0 });
  assert.equal(isEmptySnapshotSize(snapshotSize(empty())), true);
  assert.equal(isEmptySnapshotSize(snapshotSize(full())), false);
});

test('shrinkReason: empty, zero holdings and big drops are refused; normal changes pass', () => {
  const old = snapshotSize(full());
  assert.equal(shrinkReason(old, snapshotSize(empty())), 'empty_over_existing');
  const noHoldings = { ...full(), holdings: [], dataset: { ...full().dataset, holdings: [] } };
  assert.equal(shrinkReason(old, snapshotSize(noHoldings)), 'holdings_dropped_to_zero');
  assert.equal(shrinkReason(old, snapshotSize(full({ trades: rows(100) }))), 'trades_shrunk');
  assert.equal(shrinkReason(old, snapshotSize(full({ dailyRecords: rows(20) }))), 'dailyRecords_shrunk');
  // 正常：小幅增減、持平、變多
  assert.equal(shrinkReason(old, snapshotSize(full({ trades: rows(410) }))), null);
  assert.equal(shrinkReason(old, snapshotSize(full({ trades: rows(414), dailyRecords: rows(118) }))), null);
  assert.equal(shrinkReason(old, old), null);
  // 原本就少（< 10 筆）不套用比例規則
  assert.equal(shrinkReason(snapshotSize(full({ trades: rows(6) })), snapshotSize(full({ trades: rows(1) }))), null);
  // 原本是空的：什麼都能寫（從空白救回來）
  assert.equal(shrinkReason(snapshotSize(empty()), snapshotSize(full())), null);
  assert.equal(shrinkReason(snapshotSize(empty()), snapshotSize(empty())), null);
});

// ── 伺服器端 ───────────────────────────────────────────

test('first upload for a token is always accepted, even if the data is empty', async () => {
  const env = environment();
  assert.equal((await post(env, empty())).status, 200);
  const env2 = environment();
  assert.equal((await post(env2, full())).status, 200);
});

test('the 2026-10-01 incident: an empty snapshot cannot overwrite a full one', async () => {
  const env = environment();
  assert.equal((await post(env, full())).status, 200);
  const before = env.records.get(`portfolio-sync:${token}`);

  const res = await post(env, empty());
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'snapshot_rejected');
  assert.equal(body.reason, 'empty_over_existing');
  assert.deepEqual(body.existing, { holdings: 2, trades: 413, dailyRecords: 117, dividends: 37 });
  assert.deepEqual(body.incoming, { holdings: 0, trades: 0, dailyRecords: 0, dividends: 0 });
  assert.match(body.detail, /沒有寫入/);

  assert.equal(env.records.get(`portfolio-sync:${token}`), before, 'stored snapshot is untouched');
  const read = await (await get(env)).json();
  assert.equal(read.summary.dataset.trades.length, 413);
});

test('a snapshot with 0 holdings or less than half the trades is refused', async () => {
  const env = environment();
  await post(env, full());
  const noHoldings = { ...full(), holdings: [], dataset: { ...full().dataset, holdings: [] } };
  assert.equal((await (await post(env, noHoldings)).json()).reason, 'holdings_dropped_to_zero');
  const fewTrades = full({ trades: rows(100) });
  const res = await post(env, fewTrades);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).reason, 'trades_shrunk');
});

test('normal updates still go through, including small shrinkage and growth', async () => {
  const env = environment();
  await post(env, full());
  assert.equal((await post(env, full({ trades: rows(414) }))).status, 200);
  assert.equal((await post(env, full({ trades: rows(405) }))).status, 200);
  const read = await (await get(env)).json();
  assert.equal(read.summary.dataset.trades.length, 405);
});

test('recovery works: after the server snapshot was emptied, restoring the full data is accepted', async () => {
  const env = environment();
  env.records.set(`portfolio-sync:${token}`, JSON.stringify({ ...empty(), syncedAt: '2026-10-01T04:45:19Z' }));
  assert.equal((await post(env, full())).status, 200);
  assert.equal((await (await get(env)).json()).summary.dataset.trades.length, 413);
});

test('guard is per token: another token with no snapshot is not affected', async () => {
  const env = environment();
  await post(env, full());
  assert.equal((await post(env, empty(), other)).status, 200);
  assert.equal((await (await get(env)).json()).summary.dataset.trades.length, 413);
});

test('previous version is kept before overwriting, at most once per 6 hours, and readable with ?prev=1', async () => {
  const env = environment();
  await post(env, full({ trades: rows(413) }));
  assert.equal(env.puts.filter((p) => p.key.startsWith('portfolio-sync-prev:')).length, 0, 'nothing to back up on the first write');

  await post(env, full({ trades: rows(414) })); // 覆蓋 413 這版 → 備份
  const prevPuts = () => env.puts.filter((p) => p.key === `portfolio-sync-prev:${token}`);
  assert.equal(prevPuts().length, 1);
  assert.equal(prevPuts()[0].opts.expirationTtl, 60 * 60 * 24 * 14);

  await post(env, full({ trades: rows(415) })); // 6 小時內：不再備份（省 KV 寫入）
  assert.equal(prevPuts().length, 1);

  const prev = await (await get(env, '?prev=1')).json();
  assert.equal(prev.ok, true);
  assert.equal(prev.found, true);
  assert.equal(prev.summary.dataset.trades.length, 413);
  assert.ok(prev.savedAt);

  // 超過 6 小時 → 會更新備份
  const doc = JSON.parse(env.records.get(`portfolio-sync-prev:${token}`));
  doc.savedAt = new Date(Date.now() - 7 * 3600e3).toISOString();
  env.records.set(`portfolio-sync-prev:${token}`, JSON.stringify(doc));
  await post(env, full({ trades: rows(416) }));
  assert.equal(prevPuts().length, 2);
  assert.equal((await (await get(env, '?prev=1')).json()).summary.dataset.trades.length, 415);
});

test('?prev=1 without a backup says so; a token never sees another token\'s backup', async () => {
  const env = environment();
  const none = await (await get(env, '?prev=1')).json();
  assert.equal(none.found, false);
  assert.equal(none.reason, 'no_previous_version');
  await post(env, full()); await post(env, full({ trades: rows(414) }));
  assert.equal((await (await get(env, '?prev=1', other)).json()).found, false);
});

test('a failing KV read does not block syncing (the guard fails open, never blocks normal use)', async () => {
  const env = { health_kv: {
    get: async () => { throw new Error('KV get() failed'); },
    put: async () => {},
  } };
  assert.equal((await post(env, full())).status, 200);
});

// ── 前端 ───────────────────────────────────────────────

test('client: zinfLocalDataIsEmpty is true only when there are no holdings, trades or daily records', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const fn = html.match(/function zinfLocalDataIsEmpty\([\s\S]*?\n}\n/)[0];
  const ctx = { Array };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  assert.equal(ctx.zinfLocalDataIsEmpty({ holdings: [], dataset: { holdings: [], trades: [], dailyRecords: [] } }), true);
  assert.equal(ctx.zinfLocalDataIsEmpty({}), true);
  assert.equal(ctx.zinfLocalDataIsEmpty(null), true);
  assert.equal(ctx.zinfLocalDataIsEmpty({ holdings: [{ symbol: '0050' }], dataset: {} }), false);
  assert.equal(ctx.zinfLocalDataIsEmpty({ holdings: [], dataset: { trades: [{ id: 1 }] } }), false);
  assert.equal(ctx.zinfLocalDataIsEmpty({ holdings: [], dataset: { dailyRecords: [{ date: '2026-09-30' }] } }), false);
});

test('client: runZinfSync checks for empty data before uploading and does not retry a 409', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const run = html.slice(html.indexOf('const runZinfSync'), html.indexOf('// 資料有任何實質變更：debounce 2 秒後推最新完整快照'));
  const emptyAt = run.indexOf('zinfLocalDataIsEmpty(syncSummary)');
  const fetchAt = run.indexOf('fetch("/api/portfolio-sync"');
  assert.ok(emptyAt > 0 && fetchAt > 0 && emptyAt < fetchAt, 'empty check comes before the upload');
  const status409 = run.indexOf('response.status === 409');
  const throwAt = run.indexOf('if (response.status === 413)');
  assert.ok(status409 > 0 && status409 < throwAt, '409 is handled before the generic error path');
  const block = run.slice(status409, throwAt);
  assert.doesNotMatch(block, /throw|setTimeout/, '409 never schedules a retry');
  assert.match(block, /return false/);
});
