import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// App 收在背景時，伺服器代收分 K；打開 App 後補回錯過的上午 / 收盤前因子樣本。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <server-bars-import>([\s\S]*?)\/\/ <\/server-bars-import>/)?.[1];
assert.ok(block, 'server-bars-import block must exist');
const importer = html.match(/async function importServerBarSamples[\s\S]*?\n}\n/)?.[0];
assert.ok(importer, 'importServerBarSamples must exist');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load(env = {}) {
  const ctx = { ...env };
  vm.createContext(ctx);
  vm.runInContext(block + '\n' + importer + '\nthis.api={serverImportDays,serverBarAt,buildServerSamples,fillMissingDailyKd,importServerBarSamples,kdFromBars,monthlyFromDaily};', ctx);
  return ctx.api;
}

// 日線：9/1～10/7 每個平日一根，收盤 100 起每天 +1，另有 10/8 當天。
function dailyBars(sym, upToDay) {
  const bars = []; let px = 100;
  for (let d = new Date('2026-09-01T12:00:00Z'); d.toISOString().slice(0, 10) <= upToDay; d = new Date(d.getTime() + 86400000)) {
    if ([0, 6].includes(d.getUTCDay())) continue;
    px += 1;
    bars.push({ day: d.toISOString().slice(0, 10), open: px - 0.5, high: px + 1, low: px - 1, close: px });
  }
  return bars;
}
const bar = (time, close) => ({ time, open: close, high: close, low: close, close, samples: 4, minutes: 5 });
const dayBars = (a, b) => [bar('09:00', a), bar('09:25', a), bar('13:20', b), bar('13:25', b)];

test('serverImportDays: past weekdays missing a morning/closeLock record, newest 8 within 3 weeks, oldest first', () => {
  const syms = ['2330'];
  const days = api().serverImportDays([], '2026-10-13', syms, () => false, []);
  assert.deepEqual(plain(days), ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12']);
  // 已有兩個時間點的紀錄 → 不用補；只缺一個仍要補
  const both = ['morning', 'closeLock'].map((p) => ({ key: `2026-10-12|2330|${p}` }));
  assert.ok(!api().serverImportDays(both, '2026-10-13', syms, () => false, []).includes('2026-10-12'));
  assert.ok(api().serverImportDays([both[0]], '2026-10-13', syms, () => false, []).includes('2026-10-12'));
  // 休市日與已查過的日子不再查；今天永遠不補（App 開著時雷達自己會記）
  const d2 = api().serverImportDays([], '2026-10-13', syms, (d) => d === '2026-10-09', ['2026-10-08']);
  assert.deepEqual(plain(d2), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-12']);
  assert.ok(!api().serverImportDays([], '2026-10-13', syms, () => false, []).includes('2026-10-13'));
});
function api() { return load(); }

test('serverBarAt: last bar not after the target, and nothing when the gap is too big', () => {
  const { serverBarAt } = api();
  assert.equal(serverBarAt(dayBars(1, 2), '09:25').time, '09:25');
  assert.equal(serverBarAt(dayBars(1, 2), '13:25').time, '13:25');
  assert.equal(serverBarAt([bar('10:30', 5)], '09:25'), null);
  assert.equal(serverBarAt([bar('09:00', 5)], '13:25'), null, 'a bar 4 hours earlier is not a 13:25 sample');
});

test('buildServerSamples reconstructs index %, stock %, daily/monthly KD as known that morning, and the actual', () => {
  const { buildServerSamples, kdFromBars, monthlyFromDaily } = api();
  const day = '2026-10-08';
  const daily = { 2330: dailyBars('2330', day), TAIEX: dailyBars('TAIEX', day) };
  const prev = daily['2330'].filter((b) => b.day < day).pop().close; // 10/7 收盤
  const iprev = daily.TAIEX.filter((b) => b.day < day).pop().close;
  const serverBars = { 2330: dayBars(prev * 1.01, prev * 1.02), TAIEX: dayBars(iprev * 1.005, iprev * 0.99) };
  const out = plain(buildServerSamples({ day, symbols: ['2330'], serverBars, daily, modelVersion: 'M', existingKeys: new Set() }));
  assert.equal(out.length, 2);
  const [m, c] = out;
  assert.equal(m.key, '2026-10-08|2330|morning');
  assert.equal(c.key, '2026-10-08|2330|closeLock');
  assert.ok(Math.abs(m.stockPct - 1) < 1e-9 && Math.abs(c.stockPct - 2) < 1e-9);
  assert.ok(Math.abs(m.indexPct - 0.5) < 1e-9 && Math.abs(c.indexPct + 1) < 1e-9);
  const actualPct = (daily['2330'].find((b) => b.day === day).close / prev - 1) * 100;
  assert.ok(Math.abs(m.actual.pct - actualPct) < 1e-9);
  assert.equal(m.actual.source, 'completed-daily-bar');
  assert.equal(m.actual.hit, null);
  // KD 只用「當天以前」的日線（不能偷看當天收盤）
  const prior = daily['2330'].filter((b) => b.day < day);
  assert.equal(m.kd.kDaily, kdFromBars(prior).K);
  assert.equal(m.kd.kMonthly, kdFromBars(monthlyFromDaily(prior))?.K ?? null);
  // 還原不了的欄位保持空白，不補猜；沒有機率 → 不會進命中率 / 校準
  assert.equal(m.probability, null);
  assert.equal(m.direction, null);
  assert.equal(m.newsScore, null);
  assert.equal(m.kd.k5, null);
  assert.equal(m.source, 'server');
  assert.equal(m.modelVersion, 'M');
});

test('buildServerSamples skips existing keys, missing bars, and days whose daily close is not available yet', () => {
  const { buildServerSamples } = api();
  const day = '2026-10-08';
  const daily = { 2330: dailyBars('2330', day), TAIEX: dailyBars('TAIEX', day) };
  const sb = { 2330: dayBars(100, 101), TAIEX: dayBars(100, 101) };
  const some = plain(buildServerSamples({ day, symbols: ['2330'], serverBars: sb, daily, modelVersion: 'M', existingKeys: new Set(['2026-10-08|2330|morning']) }));
  assert.deepEqual(some.map((r) => r.phase), ['closeLock']);
  assert.equal(buildServerSamples({ day, symbols: ['2330', '0050'], serverBars: sb, daily, modelVersion: 'M', existingKeys: new Set() }).every((r) => r.symbol === '2330'), true);
  const noClose = { 2330: dailyBars('2330', '2026-10-07'), TAIEX: dailyBars('TAIEX', '2026-10-07') };
  assert.equal(buildServerSamples({ day, symbols: ['2330'], serverBars: sb, daily: noClose, modelVersion: 'M', existingKeys: new Set() }).length, 0);
});

test('these samples never count toward hit-rate or calibration (no probability) but do count for factor correlation', async () => {
  const core = fs.readFileSync(new URL('../forecast-core.js', import.meta.url), 'utf8');
  const g = {}; vm.createContext(g); vm.runInContext(core.replace(/globalThis|window/g, 'this'), g);
  const F = g.ZinfForecast || vm.runInContext('this.ZinfForecast', g);
  const { buildServerSamples } = api();
  const day = '2026-10-08';
  const daily = { 2330: dailyBars('2330', day), TAIEX: dailyBars('TAIEX', day) };
  const recs = plain(buildServerSamples({ day, symbols: ['2330'], serverBars: { 2330: dayBars(100, 101), TAIEX: dayBars(100, 101) }, daily, modelVersion: 'M', existingKeys: new Set() }));
  assert.equal(F.calibrate(60, recs, { symbol: '2330', phase: 'morning', modelVersion: 'M', beforeDay: '2026-10-13' }).n, 0);
  assert.equal(F.auditStats(recs, { modelVersion: 'M', phase: 'morning', beforeDay: '2026-10-13' }), null);
  assert.ok(recs.every((r) => Number.isFinite(r.stockPct) && Number.isFinite(r.actual.pct)));
});

function harness({ history, intraday, daily, checked = [] }) {
  const store = { trendRadarHistory: history, serverBarsImport: { checked } };
  const calls = [];
  const env = {
    loadKey: async (k, fb) => JSON.parse(JSON.stringify(store[k] ?? fb)),
    saveKey: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    fetchWithTimeout: async (url) => {
      calls.push(url);
      if (url.startsWith('/daily-history')) return Response.json({ ok: true, bars: daily });
      const day = /date=([\d-]+)/.exec(url)[1];
      const r = intraday(day);
      return r === 'down' ? new Response('x', { status: 503 }) : Response.json(r);
    },
  };
  return { env, store, calls };
}

test('importServerBarSamples: merges into history, keeps the app’s own records, remembers checked days', async () => {
  const daily = { 2330: dailyBars('2330', '2026-10-12'), TAIEX: dailyBars('TAIEX', '2026-10-12') };
  const own = { key: '2026-10-12|2330|morning', day: '2026-10-12', symbol: '2330', phase: 'morning', probability: 61, modelVersion: 'M' };
  const h = harness({
    history: { records: [own] }, daily,
    intraday: (day) => day === '2026-10-09' ? { ok: true, found: false } : { ok: true, found: true, bars: { 2330: dayBars(100, 101), TAIEX: dayBars(100, 101) } },
  });
  const { importServerBarSamples } = load(h.env);
  const n = await importServerBarSamples({ symbols: ['2330'], today: '2026-10-13', isClosedDay: () => false, modelVersion: 'M' });
  assert.ok(n > 0);
  const recs = h.store.trendRadarHistory.records;
  assert.equal(recs.find((r) => r.key === own.key).probability, 61, 'the app’s own record is never replaced');
  assert.ok(recs.some((r) => r.key === '2026-10-12|2330|closeLock' && r.source === 'server'));
  assert.ok(recs.some((r) => r.key === '2026-10-08|2330|morning' && r.source === 'server'));
  assert.ok(!recs.some((r) => r.day === '2026-10-09'), 'a day with no server record adds nothing');
  assert.deepEqual(recs.map((r) => r.day), [...recs.map((r) => r.day)].sort(), 'history stays in chronological order');
  assert.ok(h.store.serverBarsImport.checked.includes('2026-10-09'), 'empty days are remembered so they are not asked again');
  // 再開一次：查過的日子不重抓，也不重複寫入（每次最多補 4 天，所以只會往更早的日子推進）
  const firstRun = h.calls.filter((u) => u.startsWith('/intraday-bars')).map((u) => /date=([\d-]+)/.exec(u)[1]);
  h.calls.length = 0;
  const keysBefore = new Set(recs.map((r) => r.key));
  await importServerBarSamples({ symbols: ['2330'], today: '2026-10-13', isClosedDay: () => false, modelVersion: 'M' });
  const again = h.calls.filter((u) => u.startsWith('/intraday-bars')).map((u) => /date=([\d-]+)/.exec(u)[1]);
  assert.ok(again.every((d) => !firstRun.includes(d)), 'already-checked days are not requested again');
  const after = h.store.trendRadarHistory.records.map((r) => r.key);
  assert.equal(new Set(after).size, after.length, 'no duplicate keys');
  assert.ok([...keysBefore].every((k) => after.includes(k)));
});

test('importServerBarSamples: a failed server read changes nothing and is retried next time', async () => {
  const daily = { 2330: dailyBars('2330', '2026-10-12'), TAIEX: dailyBars('TAIEX', '2026-10-12') };
  const h = harness({ history: { records: [] }, daily, intraday: () => 'down' });
  const { importServerBarSamples } = load(h.env);
  const n = await importServerBarSamples({ symbols: ['2330'], today: '2026-10-13', isClosedDay: () => false, modelVersion: 'M' });
  assert.equal(n, 0);
  assert.deepEqual(h.store.trendRadarHistory.records, []);
  assert.deepEqual(h.store.serverBarsImport.checked, []);
});

test('the server-bars import is wired into the app and the backtest explains the source', () => {
  assert.match(html, /importServerBarSamples\(\{/);
  assert.match(html, /serverSampleN > 0/);
  // 用「算好股數的持股」(holdingsWithShares) 取代號，而且不能被「補記完成」旗標卡住（沒有缺漏日時那個旗標永遠不會設）。
  const hook = html.match(/⑤ App 收在背景時[\s\S]*?\}, \[ready\]\);/)?.[0];
  assert.ok(hook, 'the import hook must depend only on [ready]');
  assert.match(hook, /holdingsWithShares\.filter/);
  assert.doesNotMatch(hook, /backfillSettled/);
});

test('fillMissingDailyKd restores empty daily/monthly KD on past records from the daily bars known that day, nothing else', () => {
  const { fillMissingDailyKd, kdFromBars } = api();
  const daily = { 2330: dailyBars('2330', '2026-10-12') };
  const old = { key: 'a', day: '2026-10-08', symbol: '2330', phase: 'morning', kd: { k5: 40, d5: 45, kDaily: null, dDaily: null } };
  const have = { key: 'b', day: '2026-10-08', symbol: '2330', phase: 'closeLock', kd: { kDaily: 11, dDaily: 12 } };
  const today = { key: 'c', day: '2026-10-13', symbol: '2330', phase: 'morning', kd: {} };
  const idx = { key: 'd', day: '2026-10-08', symbol: 'TAIEX', phase: 'morning' };
  const recs = [old, have, today, idx];
  assert.equal(fillMissingDailyKd(recs, daily, '2026-10-13'), 1);
  assert.equal(old.kd.kDaily, kdFromBars(daily['2330'].filter((b) => b.day < '2026-10-08')).K);
  assert.equal(old.kd.k5, 40, 'existing intraday fields are untouched');
  assert.equal(have.kd.kDaily, 11, 'a filled value is never overwritten');
  assert.deepEqual(plain(today.kd), {}, 'today is left to the radar');
  assert.equal(idx.kd, undefined);
});

test('factor backtest: raw market factors count records from before the model change; model-dependent ones do not', () => {
  for (const label of ['大盤 %', '個股 %', 'KD 日線 (K-D)', 'KD 月線 (K-D)']) {
    assert.match(html, new RegExp(`\\["${label.replace(/[()]/g, '\\$&')}", \\(r\\) => [^\\n]*, true\\],`), label);
  }
  assert.match(html, /\.filter\(\(r\) => anyVersion \|\| r\.modelVersion === TREND_MODEL_VERSION\)/);
  for (const label of ['新聞分數', 'RVOL', '融資 1日增減 %']) {
    const line = html.split('\n').find((l) => l.includes(`["${label}"`) && l.includes('(r) =>'));
    assert.ok(line && !/, true\],/.test(line), label + ' stays current-version only');
  }
});
