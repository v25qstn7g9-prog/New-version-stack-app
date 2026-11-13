// 讀檔損壞時不可把預設空值寫回：原 key 不動、另存 <key>_corrupt_<時間戳>、這次執行暫停自動存檔、顯示中文提示。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

const source = readAppSource();
const guard = source.match(/\/\/ <load-corrupt-guard>([\s\S]*?)\/\/ <\/load-corrupt-guard>/)[1];
const saveFn = source.match(/async function saveKey\(key, value\) \{[\s\S]*?\n\}/)[0];
const NOW = new Date(2026, 10, 11, 21, 34, 0); // 固定時間，不看真的時鐘

function memoryStorage(initial = {}, { failSet = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { if (failSet) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
  };
}

function makeEnv(window) {
  const ctx = { window, CustomEvent: class {}, console: { warn() {}, error() {} } };
  return vm.runInNewContext(`${guard}\n${saveFn}\n({ loadKeyGuarded, saveKey, corruptStampNow })`, ctx);
}

// 模擬 App 的初始載入＋持久化 effect：損壞的 key 這次執行不寫回（與 src/app.jsx 的 canPersist 同邏輯）。
async function bootAndPersist(env, defaults) {
  const corruptKeys = new Set();
  const state = {};
  const results = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const r = await env.loadKeyGuarded(key, fallback, NOW);
    results[key] = r;
    if (r.corrupt) corruptKeys.add(r.key);
    state[key] = r.value;
  }
  for (const key of Object.keys(defaults)) {
    if (!corruptKeys.has(key)) await env.saveKey(key, state[key]);
  }
  return { state, results, corruptKeys };
}

test('corrupt holdings/trades JSON is never overwritten with [] and the raw string is backed up', async () => {
  const badHoldings = '[{"symbol":"0050","initialShares":1000},';
  const badTrades = '{"oops": [1,2';
  const ls = memoryStorage({ holdings: badHoldings, trades: badTrades });
  const env = makeEnv({ localStorage: ls });
  const { state, results, corruptKeys } = await bootAndPersist(env, { holdings: [], trades: [] });

  assert.equal(JSON.stringify(state.holdings), '[]');
  assert.equal(JSON.stringify(state.trades), '[]');
  assert.ok(corruptKeys.has('holdings') && corruptKeys.has('trades'));
  assert.equal(ls.getItem('holdings'), badHoldings, 'original holdings string must stay untouched');
  assert.equal(ls.getItem('trades'), badTrades, 'original trades string must stay untouched');
  assert.equal(results.holdings.backupKey, 'holdings_corrupt_20261111T213400');
  assert.equal(results.trades.backupKey, 'trades_corrupt_20261111T213400');
  assert.equal(ls.getItem('holdings_corrupt_20261111T213400'), badHoldings);
  assert.equal(ls.getItem('trades_corrupt_20261111T213400'), badTrades);
});

test('reloading while still corrupt keeps protecting and does not duplicate the backup', async () => {
  const bad = '[{"symbol":"2330"';
  const ls = memoryStorage({ holdings: bad });
  const env = makeEnv({ localStorage: ls });
  await bootAndPersist(env, { holdings: [] });
  const later = await env.loadKeyGuarded('holdings', [], new Date(2026, 10, 12, 8, 0, 0));
  assert.equal(later.corrupt, true);
  assert.equal(later.backupKey, 'holdings_corrupt_20261111T213400');
  assert.equal([...ls.map.keys()].filter((k) => k.startsWith('holdings_corrupt_')).length, 1);
  assert.equal(ls.getItem('holdings'), bad);
});

test('corrupt value coming from window.storage is backed up from that raw string', async () => {
  const bad = '[{"symbol":"006208",';
  const ls = memoryStorage({ trades: '[]' });
  const env = makeEnv({ localStorage: ls, storage: { get: async (k) => (k === 'trades' ? { value: bad } : null), set: async () => { throw new Error('should not write'); } } });
  const r = await env.loadKeyGuarded('trades', [], NOW);
  assert.equal(r.corrupt, true);
  assert.equal(ls.getItem('trades_corrupt_20261111T213400'), bad);
  assert.equal(ls.getItem('trades'), '[]');
});

test('window.storage read failure is protected and keeps the localStorage data', async () => {
  const ls = memoryStorage({ holdings: '[{"symbol":"0050"}]' });
  const env = makeEnv({ localStorage: ls, storage: { get: async () => { throw new Error('read failed'); } } });
  const r = await env.loadKeyGuarded('holdings', [], NOW);
  assert.equal(r.corrupt, true);
  assert.equal(JSON.stringify(r.value), '[{"symbol":"0050"}]');
  assert.equal(ls.getItem('holdings'), '[{"symbol":"0050"}]');
});

test('backup save failure (quota) does not crash and the original key is still untouched', async () => {
  const bad = '[{"symbol":"0056"';
  const ls = memoryStorage({ holdings: bad }, { failSet: true });
  const env = makeEnv({ localStorage: ls });
  const { results, corruptKeys } = await bootAndPersist(env, { holdings: [] });
  assert.equal(results.holdings.corrupt, true);
  assert.equal(results.holdings.backupKey, null);
  assert.ok(corruptKeys.has('holdings'));
  assert.equal(ls.getItem('holdings'), bad);
});

test('missing keys (new user) still return defaults and are saved normally', async () => {
  const ls = memoryStorage();
  const env = makeEnv({ localStorage: ls });
  const { state, corruptKeys } = await bootAndPersist(env, { holdings: [], trades: [], dailyRecords: [], dividends: [] });
  assert.equal(corruptKeys.size, 0);
  assert.equal(JSON.stringify(state), '{"holdings":[],"trades":[],"dailyRecords":[],"dividends":[]}');
  assert.equal(ls.getItem('holdings'), '[]');
  assert.equal(ls.getItem('trades'), '[]');
  assert.equal([...ls.map.keys()].some((k) => k.includes('_corrupt_')), false);
});

test('valid stored data loads normally and is not flagged', async () => {
  const ls = memoryStorage({ holdings: '[{"symbol":"0050"}]' });
  const env = makeEnv({ localStorage: ls });
  const r = await env.loadKeyGuarded('holdings', [], NOW);
  assert.equal(r.corrupt, false);
  assert.equal(JSON.stringify(r.value), '[{"symbol":"0050"}]');
});

test('app wires the guard into initial load, persistence and onboarding', () => {
  for (const key of ['holdings', 'trades', 'dailyRecords', 'dividends']) {
    assert.match(source, new RegExp(`loadKeyGuarded\\("${key}"`), `${key} must load through the guard`);
    const call = key === 'holdings' ? 'persistHoldingsThenClearLegacyUs\\(persistKey, holdings' : `persistKey\\("${key}"`;
    assert.match(source, new RegExp(`if \\(ready && canPersist\\("${key}"\\)\\) ${call}`), `${key} persistence must skip corrupt keys`);
  }
  // 舊版 usHoldings 不可再用只依賴 [ready] 的獨立 effect 清空（要等持股寫入成功）。
  assert.doesNotMatch(source, /persistKey\("usHoldings", \[\]\); \}, \[ready\]\)/);
  assert.doesNotMatch(source, /loadKey\("holdings", defaultHoldings\(\)\)/);
  assert.doesNotMatch(source, /loadKey\("trades", defaultTrades\(\)\)/);
  assert.match(source, /firstRun=\{firstRun && corruptLoads\.length === 0\}/);
});

test('corrupt-load banner shows the Chinese warning matching the JSON備份 button', () => {
  assert.match(source, /<CorruptLoadBanner items=\{corruptLoads\} onOpenBackup=\{openBackup\} syncPaused=\{!!zinfSyncToken\} \/>/);
  assert.ok(source.includes("本機紀錄讀取異常，已暫停雲端同步上傳，避免蓋掉雲端資料。"));
  assert.ok(source.includes('紀錄讀取失敗，已保留原始資料、暫停自動存檔；請先到設定按「JSON備份」，或聯絡工程師。這次的修改重開後可能不會保留。'));
  assert.ok(source.includes('<UiLabel zh="JSON備份" inline />'), 'the settings button the banner refers to must exist');
});

// ---- 以下實際執行 src/app.jsx 的程式碼片段（不是只 grep） ----
const jsxSrc = source;
function sliceBlock(startMarker) {
  const i = jsxSrc.indexOf(startMarker);
  assert.ok(i >= 0, `missing ${startMarker}`);
  const end = jsxSrc.indexOf('\n  };\n', i);
  return jsxSrc.slice(i, end + 5);
}
const runZinfSyncSrc = sliceBlock('  const runZinfSync = async');
const importBackupSrc = sliceBlock('  const importBackup = async');
const persistEffects = jsxSrc.match(/  \/\/ ---- persist on change \(after ready\) ----\n([\s\S]*?)\n\n/)[1];

function syncHarness({ corruptKeys = [], token = 'tok', summary = { holdings: [{ symbol: '0050' }], dataset: { dividends: [] } } } = {}) {
  const calls = { fetch: [], status: [] };
  const ctx = {
    console: { warn() {}, error() {} }, JSON, Date, Error, Promise, setTimeout: () => 1, clearTimeout() {},
    localStorage: memoryStorage(),
    ready: true, zinfSyncToken: token,
    corruptKeysRef: { current: new Set(corruptKeys) },
    zinfSyncInFlightRef: { current: false }, zinfSyncPendingRef: { current: false },
    zinfSyncPayloadRef: { current: null }, zinfSyncRetryTimerRef: { current: null },
    buildZinfSyncPayload: async () => ({ token, summary }),
    zinfLocalDataIsEmpty: () => false, zinfShouldSkipUpload: () => false, zinfSyncHash: async () => 'h',
    setZinfSyncStatus: (s) => calls.status.push(s),
    fetch: async (url, init) => { calls.fetch.push({ url, init }); return { ok: true, status: 200, json: async () => ({}) }; },
  };
  vm.runInNewContext(`${guard}\n${runZinfSyncSrc}\nthis.runZinfSync = runZinfSync;`, ctx);
  return { ctx, calls };
}

test('runZinfSync: any corrupt key pauses upload (startup/debounce/online/visible/timer/retry all share this entry)', async () => {
  for (const key of ['dividends', 'holdings', 'trades', 'dailyRecords']) {
    const { ctx, calls } = syncHarness({ corruptKeys: [key] });
    for (const opts of [{ rebuild: true }, { rebuild: false }, { rebuild: true, force: true }]) {
      assert.equal(await ctx.runZinfSync(opts), false);
    }
    assert.equal(calls.fetch.length, 0, `${key} corrupt must not upload`);
    assert.ok(calls.status.at(-1).includes('本機紀錄讀取異常，已暫停雲端同步上傳，避免蓋掉雲端資料'));
    assert.equal(ctx.zinfSyncPendingRef.current, true, 'keeps pending (upload resumes only after a reload with healthy data)');
    assert.equal(ctx.zinfSyncInFlightRef.current, false);
  }
});

test('runZinfSync: no corrupt keys uploads normally (payload untouched)', async () => {
  const summary = { holdings: [{ symbol: '2330' }], dataset: { dividends: [{ id: 1 }] } };
  const { ctx, calls } = syncHarness({ summary });
  assert.equal(await ctx.runZinfSync(), true);
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].init.body, JSON.stringify({ summary }));
});

// 使用者紀錄四個 key 的持久化 effect（持股那行改成「持股存成功並讀回確認後才清 usHoldings」）。
const RECORD_PERSIST_RE = /persistKey\("(dailyRecords|holdings|usHoldings|trades|dividends)"|persistHoldingsThenClearLegacyUs\(persistKey/;
const recordPersistLines = persistEffects.split('\n').filter((l) => RECORD_PERSIST_RE.test(l)).join('\n');

// 用真正的 src/app.jsx 片段（guard 內的 persistHoldingsThenClearLegacyUs／storedValueMatches ＋ saveKey ＋ effect 行）
// 跑一次持久化 effect；persistKey 直接用 saveKey（不經排隊），只為了看寫入順序與結果。
async function runPersist(corruptKeys, { window = { localStorage: memoryStorage() } } = {}) {
  const writes = [];
  const ctx = {
    window, console: { warn() {}, error() {} }, CustomEvent: class {}, JSON, Promise, String,
    ready: true, useEffect: (fn) => fn(),
    corruptKeysRef: { current: new Set(corruptKeys) },
    legacyUsMigrationRef: { current: { done: false } },
    dailyRecords: [], holdings: [{ symbol: 'AAPL' }], trades: [], dividends: [], planItems: [], goal: {}, planSchedule: {},
  };
  ctx.canPersist = (key) => !ctx.corruptKeysRef.current.has(key);
  vm.runInNewContext(`${guard}\n${saveFn}\nthis.saveKey = saveKey;`, ctx);
  ctx.persistKey = async (k, v) => { writes.push(k); return ctx.saveKey(k, v); };
  vm.runInContext(recordPersistLines, ctx);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { writes, ctx };
}

test('persist effects: corrupt holdings keeps legacy usHoldings (not cleared) and skips holdings', async () => {
  const { writes } = await runPersist(['holdings']);
  assert.ok(!writes.includes('usHoldings'), 'usHoldings must not be cleared while holdings is protected');
  assert.ok(!writes.includes('holdings'));
  assert.ok(writes.includes('trades') && writes.includes('dividends') && writes.includes('dailyRecords'));
});

test('persist effects: healthy load still migrates (clears) legacy usHoldings, only after holdings', async () => {
  const { writes } = await runPersist([]);
  assert.deepEqual([...writes].sort(), ['dailyRecords', 'dividends', 'holdings', 'trades', 'usHoldings']);
  assert.ok(writes.indexOf('holdings') < writes.indexOf('usHoldings'), 'usHoldings is cleared only after holdings was written');
  assert.ok((await runPersist(['dividends'])).writes.includes('usHoldings'), 'only holdings protection blocks the usHoldings cleanup');
});

// ---- 高 1：清空舊版 usHoldings 必須等「重新載入會讀到的管道」都寫好遷移後的持股 ----
const LEGACY = '[{"symbol":"AAPL","shares":3}]';
const MIGRATED = [{ symbol: 'AAPL', initialShares: 3 }];
function migrationEnv({ withAppStore = true, appFail = [], lsFail = [] } = {}) {
  const ls = memoryStorage({ holdings: '[]', usHoldings: LEGACY });
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k, v) => { if (lsFail.includes(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } realSet(k, v); };
  const appStore = withAppStore ? appStorage({ holdings: '[]', usHoldings: LEGACY }, { failSetKeys: appFail }) : null;
  const window = { localStorage: ls, dispatchEvent() {}, ...(appStore ? { storage: appStore } : {}) };
  const ctx = { window, console: { warn() {}, error() {} }, CustomEvent: class {}, JSON, Promise, String };
  const env = vm.runInNewContext(`${guard}\n${saveFn}\n({ saveKey, persistHoldingsThenClearLegacyUs, loadKeyGuarded })`, ctx);
  const writes = [];
  const persist = async (k, v) => { writes.push(k); return env.saveKey(k, v); };
  return { ls, appStore, env, writes, persist };
}

test('legacy migration: holdings write fails on both storages → usHoldings is kept', async () => {
  const m = migrationEnv({ appFail: ['holdings'], lsFail: ['holdings'] });
  const state = { done: false };
  assert.equal(await m.env.persistHoldingsThenClearLegacyUs(m.persist, MIGRATED, state), false);
  assert.deepEqual(m.writes, ['holdings'], 'usHoldings write is never sent');
  assert.equal(m.appStore.map.get('usHoldings'), LEGACY);
  assert.equal(m.ls.getItem('usHoldings'), LEGACY);
  assert.equal(state.done, false);
  // 只有 localStorage 的環境，寫入失敗也一樣保留
  const solo = migrationEnv({ withAppStore: false, lsFail: ['holdings'] });
  assert.equal(await solo.env.persistHoldingsThenClearLegacyUs(solo.persist, MIGRATED, { done: false }), false);
  assert.equal(solo.ls.getItem('usHoldings'), LEGACY);
});

test('legacy migration: window.storage holdings fails, localStorage succeeds → usHoldings is kept (reload reads window.storage first)', async () => {
  const m = migrationEnv({ appFail: ['holdings'] });
  const state = { done: false };
  assert.equal(await m.env.persistHoldingsThenClearLegacyUs(m.persist, MIGRATED, state), false);
  assert.equal(m.ls.getItem('holdings'), JSON.stringify(MIGRATED), 'saveKey still reports success (#88 semantics unchanged)');
  assert.equal(m.appStore.map.get('holdings'), '[]', 'window.storage still has the old holdings');
  assert.deepEqual(m.writes, ['holdings']);
  assert.equal(m.appStore.map.get('usHoldings'), LEGACY);
  assert.equal(m.ls.getItem('usHoldings'), LEGACY);
  // 重新載入：先讀 window.storage 的舊持股，舊版美股仍在 usHoldings，可再合併回來（沒有遺失）
  assert.equal((await m.env.loadKeyGuarded('holdings', [])).value.length, 0);
  // 反過來（window.storage 成功、localStorage 失敗）也保留，兩個管道都對才清
  const m2 = migrationEnv({ lsFail: ['holdings'] });
  assert.equal(await m2.env.persistHoldingsThenClearLegacyUs(m2.persist, MIGRATED, { done: false }), false);
  assert.equal(m2.appStore.map.get('usHoldings'), LEGACY);
});

test('legacy migration: both storages hold the migrated holdings → usHoldings is cleared once', async () => {
  const m = migrationEnv();
  const state = { done: false };
  assert.equal(await m.env.persistHoldingsThenClearLegacyUs(m.persist, MIGRATED, state), true);
  assert.deepEqual(m.writes, ['holdings', 'usHoldings']);
  assert.equal(m.appStore.map.get('holdings'), JSON.stringify(MIGRATED));
  assert.equal(m.ls.getItem('holdings'), JSON.stringify(MIGRATED));
  assert.equal(m.appStore.map.get('usHoldings'), '[]');
  assert.equal(m.ls.getItem('usHoldings'), '[]');
  assert.equal(state.done, true);
  // 之後的持股更新不再重複清
  await m.env.persistHoldingsThenClearLegacyUs(m.persist, [...MIGRATED, { symbol: '0050' }], state);
  assert.deepEqual(m.writes, ['holdings', 'usHoldings', 'holdings']);
});

test('legacy migration: first holdings save fails, a later successful one clears usHoldings', async () => {
  const m = migrationEnv({ appFail: ['holdings'] });
  const state = { done: false };
  await m.env.persistHoldingsThenClearLegacyUs(m.persist, MIGRATED, state);
  assert.equal(m.appStore.map.get('usHoldings'), LEGACY);
  m.appStore.failSetKeys.length = 0; // 空間恢復
  assert.equal(await m.env.persistHoldingsThenClearLegacyUs(m.persist, MIGRATED, state), true);
  assert.equal(m.appStore.map.get('usHoldings'), '[]');
  assert.equal(state.done, true);
});

test('empty string in localStorage is protected, not treated as a new user', async () => {
  const ls = memoryStorage({ dividends: '' });
  const env = makeEnv({ localStorage: ls });
  const { results, corruptKeys } = await bootAndPersist(env, { dividends: [] });
  assert.equal(results.dividends.corrupt, true);
  assert.ok(corruptKeys.has('dividends'));
  assert.equal(ls.getItem('dividends'), '', 'original key untouched');
});

test('window.storage {value:""} is protected; window.storage null / no value is a missing key', async () => {
  const ls = memoryStorage();
  const env = makeEnv({ localStorage: ls, storage: { get: async (k) => (k === 'trades' ? { value: '' } : k === 'holdings' ? {} : null) } });
  assert.equal((await env.loadKeyGuarded('trades', [], NOW)).corrupt, true);
  assert.equal((await env.loadKeyGuarded('holdings', [], NOW)).corrupt, false);
  assert.equal((await env.loadKeyGuarded('dividends', [], NOW)).corrupt, false);
});

const restoreSrc = sliceBlock('  const restoreBackupOverCorrupt = async');
const restoreLockSrc = source.match(/\/\/ <restore-lock>([\s\S]*?)\/\/ <\/restore-lock>/)[1];
const persistLines = persistEffects.split('\n').filter((l) => /persistKey\("/.test(l)).join('\n');

// window.storage 模擬：可指定某些 key 寫入失敗、或卡住直到放行（模擬還原途中背景寫入交錯）。
function appStorage(initial = {}, { failSetKeys = [] } = {}) {
  const map = new Map(Object.entries(initial));
  const gates = new Map();
  const log = [];
  return {
    map, log, failSetKeys,
    gate(key) { let release; const p = new Promise((r) => { release = r; }); gates.set(key, p); return () => { gates.delete(key); release(); }; },
    get: async (k) => (map.has(k) ? { value: map.get(k) } : null),
    async set(k, v) {
      log.push(['start', k, v]);
      if (gates.has(k)) await gates.get(k);
      if (failSetKeys.includes(k)) throw new Error('storage set failed');
      map.set(k, v);
      log.push(['done', k, v]);
    },
  };
}

// 實際執行 importBackup ＋ restoreBackupOverCorrupt ＋ runZinfSync ＋ saveKey，共用同一個 corruptKeysRef／localStorage。
function importHarness({ corruptLoads = [], payload, storage = {}, failSetKeys = [], advancedMode = false, appStore = null } = {}) {
  const alerts = [], confirms = [], reloads = [], setters = [], fetches = [], writes = [];
  const ls = memoryStorage(storage);
  const realSet = ls.setItem.bind(ls);
  ls.setItem = (k, v) => {
    if (failSetKeys.includes(k)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
    writes.push(k);
    realSet(k, v);
  };
  const window = {
    localStorage: ls,
    alert: (m) => alerts.push(m),
    confirm: (m) => { confirms.push(m); return true; },
    location: { reload: () => reloads.push(1) },
    dispatchEvent() {},
    ...(appStore ? { storage: appStore } : {}),
  };
  const ctx = {
    window, console: { warn() {}, error() {} }, JSON, Date, Number, Array, String, Map, Set, Promise, Error, CustomEvent: class {},
    setTimeout: (fn) => { Promise.resolve().then(fn); return 1; }, clearTimeout() {}, useRef: (v) => ({ current: v }),
    UI_SHOW_ENGLISH: false, uiText: (s) => s, BACKUP_SCHEMA_VERSION: 2,
    CORRUPT_LOAD_LABELS: { holdings: ['持股', 'Holdings'], trades: ['交易', 'Trades'], dailyRecords: ['每日紀錄', 'Daily Records'], dividends: ['配息', 'Dividends'] },
    inspectBackupPayload: (p) => ({ ok: true, errors: [], warnings: [], data: p.data, schemaVersion: 2 }),
    corruptLoads, corruptKeysRef: { current: new Set(corruptLoads.map((c) => c.key)) },
    setCorruptLoads: () => setters.push('setCorruptLoads'),
    reportAutoSave: () => {}, // 自動存檔失敗提示（save-fail-notice）的 state 更新，這裡不需要
    mergeLegacyUsHoldings: (h) => h, defaultPlanSchedule: () => ({}), detectAdvancedUse: () => false, isObject: (x) => !!x && typeof x === 'object',
    advancedMode,
    setLastBackupAt: () => setters.push('setLastBackupAt'),
    // runZinfSync 依賴（模擬初次載入時的舊 closure：ready/token 不變、資料是損壞載入的空值）
    ready: true, zinfSyncToken: 'tok',
    zinfSyncInFlightRef: { current: false }, zinfSyncPendingRef: { current: false },
    zinfSyncPayloadRef: { current: null }, zinfSyncRetryTimerRef: { current: null },
    buildZinfSyncPayload: async () => ({ token: 'tok', summary: { holdings: [], dataset: { dividends: [] } } }),
    zinfLocalDataIsEmpty: () => false, zinfShouldSkipUpload: () => false, zinfSyncHash: async () => 'h',
    setZinfSyncStatus() {},
    fetch: async (url) => { fetches.push(url); return { ok: true, status: 200, json: async () => ({}) }; },
  };
  for (const s of ['setDailyRecords', 'setHoldings', 'setTrades', 'setDividends', 'setPlanItems', 'setGoal', 'setAdvancedMode', 'setPlanSchedule', 'setCostBasis', 'setUsBrokerCalibration']) ctx[s] = () => setters.push(s);
  vm.runInNewContext(`${guard}\n${saveFn}\n${restoreLockSrc}\n${restoreSrc}\n${importBackupSrc}\n${runZinfSyncSrc}\nthis.importBackup = importBackup; this.runZinfSync = runZinfSync; this.persistKey = persistKey; this.restoringRef = restoringRef; this.pendingAutoSaves = pendingAutoSavesRef.current;`, ctx);
  // 以目前（可能是舊的）state 跑一次 src/app.jsx 的持久化 effect，使用真正的 canPersist／persistKey。
  const runPersistEffects = (state) => {
    Object.assign(ctx, { ready: true, useEffect: (fn) => fn(), dailyRecords: [], holdings: [], trades: [], dividends: [], planItems: [], goal: {}, planSchedule: {}, costBasis: {}, aiFallbackConfig: {}, showUsFields: false, usBrokerCalibration: {} }, state);
    vm.runInContext(persistLines, ctx);
  };
  const file = { text: async () => JSON.stringify(payload) };
  return { ctx, ls, alerts, confirms, reloads, setters, fetches, writes, runPersistEffects, run: () => ctx.importBackup(file) };
}
const sampleData = { dailyRecords: [{ date: '2026-11-10' }], holdings: [{ symbol: '0050' }], trades: [{ id: 't1' }], dividends: [{ id: 1 }], planItems: [], goal: {} };
const dividendsCorrupt = [{ key: 'dividends', backupKey: 'dividends_corrupt_x', raw: '[' }];

test('corrupt restore: writes every key in order, then reloads; protection is never lifted', async () => {
  const h = importHarness({ corruptLoads: dividendsCorrupt, storage: { dividends: '[', dividends_corrupt_x: '[' }, payload: { schemaVersion: 2, exportedAt: '2026-11-10T00:00:00.000Z', data: sampleData } });
  await h.run();
  assert.deepEqual(h.writes, ['dailyRecords', 'holdings', 'usHoldings', 'trades', 'dividends', 'planItems', 'goal', 'planSchedule', 'advancedMode', 'lastBackupAt']);
  assert.equal(h.ls.getItem('dividends'), '[{"id":1}]');
  assert.equal(h.ls.getItem('dividends_corrupt_x'), '[', 'raw backup copy is kept');
  assert.equal(h.reloads.length, 1);
  assert.equal(h.alerts.at(-1), '備份已還原並存回本機，即將重新載入');
  assert.deepEqual([...h.ctx.corruptKeysRef.current], ['dividends'], 'protection stays on for the rest of this run');
  assert.deepEqual(h.setters, [], 'no React state / auto-save path is used');
});

test('corrupt restore: no upload in the same run, including stale online / visible / timer callbacks', async () => {
  const h = importHarness({ corruptLoads: dividendsCorrupt, storage: { dividends: '[', dividends_corrupt_x: '[' }, payload: { schemaVersion: 2, data: sampleData } });
  const staleRun = h.ctx.runZinfSync; // 初次載入時就綁好的舊回呼
  await h.run();
  // 先模擬還原後使用者又改了資料（防抖上傳），再觸發 online／回前景／定時／重試
  h.ctx.zinfSyncPendingRef.current = true;
  for (const opts of [{ rebuild: true }, { rebuild: false }, { rebuild: true, force: true }]) assert.equal(await staleRun(opts), false);
  assert.equal(h.fetches.length, 0, 'nothing may be uploaded before the reload');
  // 自動存檔 effect（舊 closure 的空配息）也不會蓋掉剛寫好的還原資料
  const persistWrites = [];
  const pctx = { ready: true, useEffect: (fn) => fn(), corruptKeysRef: h.ctx.corruptKeysRef, persistKey: (k) => persistWrites.push(k), dailyRecords: [], holdings: [], trades: [], dividends: [] };
  pctx.canPersist = (key) => !pctx.corruptKeysRef.current.has(key);
  pctx.persistKey = (k) => { persistWrites.push(k); return Promise.resolve(true); };
  pctx.persistHoldingsThenClearLegacyUs = (persist, v) => persist('holdings', v);
  pctx.legacyUsMigrationRef = { current: { done: false } };
  vm.runInNewContext(recordPersistLines, pctx);
  assert.ok(!persistWrites.includes('dividends'));
  assert.equal(h.ls.getItem('dividends'), '[{"id":1}]');
});

test('corrupt restore: holdings restored → legacy usHoldings cleared', async () => {
  const h = importHarness({
    corruptLoads: [{ key: 'holdings', backupKey: 'holdings_corrupt_x', raw: '[' }],
    storage: { holdings: '[', holdings_corrupt_x: '[', usHoldings: '[{"symbol":"AAPL"}]' },
    payload: { schemaVersion: 2, data: sampleData },
  });
  await h.run();
  assert.equal(h.ls.getItem('holdings'), '[{"symbol":"0050"}]');
  assert.equal(h.ls.getItem('usHoldings'), '[]', 'AAPL must not be merged back after reload');
  assert.equal(h.reloads.length, 1);
});

test('corrupt restore: a failed write shows the reason, does not reload and keeps protection', async () => {
  const h = importHarness({
    corruptLoads: [{ key: 'holdings', backupKey: 'holdings_corrupt_x', raw: '[' }],
    storage: { holdings: '[', holdings_corrupt_x: '[', usHoldings: '[{"symbol":"AAPL"}]' },
    failSetKeys: ['holdings'],
    payload: { schemaVersion: 2, data: sampleData },
  });
  await h.run();
  assert.equal(h.reloads.length, 0);
  assert.ok(h.alerts.at(-1).includes('還原寫入「持股」時失敗'));
  assert.ok(!h.alerts.some((m) => m.includes('即將重新載入')));
  assert.deepEqual(h.writes, ['dailyRecords'], 'stops at the first failure');
  assert.equal(h.ls.getItem('usHoldings'), '[{"symbol":"AAPL"}]', 'legacy holdings kept when holdings write failed');
  assert.ok(h.ctx.corruptKeysRef.current.has('holdings'));
  await h.ctx.runZinfSync();
  assert.equal(h.fetches.length, 0);
});

test('corrupt restore: a key whose raw copy failed is never overwritten (nothing restored, no reload)', async () => {
  for (const corruptLoads of [
    [{ key: 'holdings', backupKey: null, raw: '[' }, { key: 'trades', backupKey: 'trades_corrupt_x', raw: '{' }],
    [{ key: 'holdings', backupKey: 'holdings_corrupt_gone', raw: '[' }], // 另存 key 不見了也視為失敗
  ]) {
    const h = importHarness({ corruptLoads, storage: { holdings: '[', trades: '{', trades_corrupt_x: '{' }, payload: { schemaVersion: 2, data: sampleData } });
    await h.run();
    assert.equal(h.ls.getItem('holdings'), '[');
    assert.deepEqual(h.writes, []);
    assert.equal(h.reloads.length, 0);
    assert.ok(h.alerts.at(-1).includes('「持股」的原始資料另存失敗') && h.alerts.at(-1).includes('請聯絡工程師'));
    assert.ok(h.ctx.corruptKeysRef.current.has('holdings'));
  }
});

test('corrupt restore: removed the old "unlock in the same run" code and messages', () => {
  assert.doesNotMatch(source, /corruptKeysRef\.current\.(delete|clear)\(/);
  assert.equal((source.match(/setCorruptLoads\(/g) || []).length, 1, 'only the initial load sets corruptLoads');
  assert.ok(!source.includes('雲端同步上傳已恢復'));
  assert.ok(!source.includes('Cloud sync upload has resumed'));
});

test('importBackup without corruption behaves like main (state setters, no reload)', async () => {
  const h = importHarness({ payload: { schemaVersion: 2, data: sampleData } });
  await h.run();
  assert.equal(h.reloads.length, 0);
  assert.ok(h.setters.includes('setHoldings') && h.setters.includes('setDividends'));
  assert.ok(h.alerts.at(-1).startsWith('備份已匯入完成'));
});

test('importBackup: a backup carrying corruptStorage warns that it will not be recovered automatically', async () => {
  const h = importHarness({ payload: { schemaVersion: 2, data: sampleData, corruptStorage: [{ key: 'dividends', backupKey: 'dividends_corrupt_x', raw: '[' }] } });
  await h.run();
  assert.ok(h.alerts[0].includes('這份備份含讀取失敗的原始資料（配息），還原不會自動救回該項，請聯絡工程師'));
  const plain = importHarness({ payload: { schemaVersion: 2, data: sampleData } });
  await plain.run();
  assert.ok(!plain.alerts.some((m) => m.includes('讀取失敗的原始資料')));
  assert.ok(plain.alerts.at(-1).startsWith('備份已匯入完成'));
});

test('portfolio-sync upload only happens inside the gated runZinfSync', () => {
  const jsx = jsxSrc.slice(jsxSrc.indexOf('function AssetTracker'));
  assert.equal((jsxSrc.match(/\/api\/portfolio-sync/g) || []).length, 1);
  assert.ok(runZinfSyncSrc.includes('/api/portfolio-sync'));
  assert.ok(runZinfSyncSrc.indexOf('zinfUploadPausedByCorrupt(corruptKeysRef.current)') < runZinfSyncSrc.indexOf('fetch('));
  assert.ok(jsx.length > 0);
});

test('restore lock: all persist effects and export go through persistKey (no direct saveKey auto-save)', () => {
  assert.doesNotMatch(persistEffects, /[^t]saveKey\(/, 'persist effects must not call saveKey directly');
  assert.match(source, /setLastBackupAt\(exportedAt\);\n    persistKey\("lastBackupAt", exportedAt\);/);
  assert.match(restoreLockSrc, /const canPersist = \(key\) => !restoringRef\.current && !corruptKeysRef\.current\.has\(key\);/);
  assert.ok(restoreSrc.indexOf('restoringRef.current = true') < restoreSrc.indexOf('saveKeyForRestore('));
  assert.ok(restoreSrc.indexOf('await waitForPendingAutoSaves(') < restoreSrc.indexOf('saveKeyForRestore('));
  assert.ok(!restoreSrc.includes('await saveKey('), 'restore uses the dual-source helper, not saveKey');
  assert.doesNotMatch(source, /restoringRef\.current = false/);
});

test('corrupt restore: background auto-save during the restore cannot overwrite restored dailyRecords', async () => {
  const appStore = appStorage({ dividends: '[', dailyRecords: '[{"date":"2026-11-01"}]' });
  const h = importHarness({ corruptLoads: dividendsCorrupt, appStore, storage: { dividends: '[', dividends_corrupt_x: '[', dailyRecords: '[{"date":"2026-11-01"}]' }, payload: { schemaVersion: 2, data: sampleData } });
  const release = appStore.gate('holdings');
  const done = h.run();
  for (let i = 0; i < 20 && !appStore.log.some(([t, k]) => t === 'start' && k === 'holdings'); i++) await new Promise((r) => setImmediate(r));
  assert.equal(appStore.map.get('dailyRecords'), JSON.stringify(sampleData.dailyRecords), 'dailyRecords already restored');
  // 還原卡在 holdings 時，背景自動記帳用舊 state 更新 → 所有持久化 effect 觸發（含非受保護 key）
  const before = h.writes.length, beforeLog = appStore.log.length;
  h.runPersistEffects({ dailyRecords: [{ date: '2026-11-01' }, { date: '2026-11-11', auto: true }], planItems: [{ stale: 1 }] });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.writes.length, before, 'no auto-save hits localStorage while restoring');
  assert.equal(appStore.log.length, beforeLog, 'no auto-save hits window.storage while restoring');
  release();
  await done;
  assert.equal(appStore.map.get('dailyRecords'), JSON.stringify(sampleData.dailyRecords));
  assert.equal(h.ls.getItem('dailyRecords'), JSON.stringify(sampleData.dailyRecords));
  assert.equal(h.reloads.length, 1);
  // 成功後重新載入前仍擋住
  assert.equal(h.ctx.restoringRef.current, true);
  h.runPersistEffects({ dailyRecords: [] });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.ls.getItem('dailyRecords'), JSON.stringify(sampleData.dailyRecords));
});

test('corrupt restore: waits for an auto-save already in flight before writing restored data', async () => {
  const appStore = appStorage({ dividends: '[' });
  const h = importHarness({ corruptLoads: dividendsCorrupt, appStore, storage: { dividends: '[', dividends_corrupt_x: '[' }, payload: { schemaVersion: 2, data: sampleData } });
  const release = appStore.gate('dailyRecords');
  const stale = h.ctx.persistKey('dailyRecords', [{ date: 'stale' }]); // 還原前就送出、還沒寫完的舊寫入
  assert.equal(h.ctx.pendingAutoSaves.size, 1);
  const done = h.run();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(h.writes, [], 'restore must not start writing while an old auto-save is pending');
  assert.equal(appStore.log.filter(([t, k]) => t === 'start' && k === 'dailyRecords').length, 1);
  release();
  await stale; await done;
  assert.equal(appStore.map.get('dailyRecords'), JSON.stringify(sampleData.dailyRecords), 'restored value wins in window.storage');
  assert.equal(h.ls.getItem('dailyRecords'), JSON.stringify(sampleData.dailyRecords), 'restored value wins in localStorage');
  assert.equal(h.reloads.length, 1);
});

test('corrupt restore: window.storage fails but localStorage succeeds → no reload, AAPL cannot come back', async () => {
  const appStore = appStorage({ holdings: '[', usHoldings: '[{"symbol":"AAPL"}]' }, { failSetKeys: ['usHoldings'] });
  const h = importHarness({
    corruptLoads: [{ key: 'holdings', backupKey: 'holdings_corrupt_x', raw: '[' }], appStore,
    storage: { holdings: '[', holdings_corrupt_x: '[', usHoldings: '[{"symbol":"AAPL"}]' },
    payload: { schemaVersion: 2, data: sampleData },
  });
  await h.run();
  assert.equal(h.reloads.length, 0, 'must not reload: reload reads window.storage first and AAPL would be merged back');
  assert.ok(h.alerts.at(-1).includes('還原寫入「舊版美股持股」時失敗（App 儲存區'));
  assert.ok(h.alerts.at(-1).includes('請重新整理頁面，或聯絡工程師'));
  assert.ok(!h.alerts.some((m) => m.includes('即將重新載入')));
  assert.ok(!h.writes.includes('trades'), 'stops at the first failed key');
  // 失敗後本次執行仍擋住所有自動存檔（含非受保護 key）
  assert.equal(h.ctx.restoringRef.current, true);
  const n = h.writes.length;
  h.runPersistEffects({ planItems: [{ x: 1 }], dailyRecords: [] });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.writes.length, n);
  await h.ctx.runZinfSync();
  assert.equal(h.fetches.length, 0);
});

test('corrupt restore: localStorage fails but window.storage succeeds → no reload, failure named', async () => {
  const appStore = appStorage({ dividends: '[' });
  const h = importHarness({ corruptLoads: dividendsCorrupt, appStore, failSetKeys: ['trades'], storage: { dividends: '[', dividends_corrupt_x: '[' }, payload: { schemaVersion: 2, data: sampleData } });
  await h.run();
  assert.equal(h.reloads.length, 0);
  assert.ok(h.alerts.at(-1).includes('還原寫入「交易」時失敗（瀏覽器本機儲存'));
  assert.equal(appStore.map.get('dividends'), '[', 'stopped before dividends');
});

test('corrupt restore: both sources succeed → reload, and window.storage holds the restored values', async () => {
  const appStore = appStorage({ holdings: '[', usHoldings: '[{"symbol":"AAPL"}]' });
  const h = importHarness({
    corruptLoads: [{ key: 'holdings', backupKey: 'holdings_corrupt_x', raw: '[' }], appStore,
    storage: { holdings: '[', holdings_corrupt_x: '[', usHoldings: '[{"symbol":"AAPL"}]' },
    payload: { schemaVersion: 2, data: sampleData },
  });
  await h.run();
  assert.equal(h.reloads.length, 1);
  assert.equal(appStore.map.get('usHoldings'), '[]');
  assert.equal(h.ls.getItem('usHoldings'), '[]');
  assert.equal(appStore.map.get('holdings'), '[{"symbol":"0050"}]');
});

test('importBackup without corruption does not engage the restore lock', async () => {
  const h = importHarness({ payload: { schemaVersion: 2, data: sampleData } });
  await h.run();
  assert.equal(h.ctx.restoringRef.current, false);
});

// ---- Codex 第 2 輪 高：舊版 usHoldings 讀取失敗（window.storage.get 拋錯）不可當成空陣列，之後也不可被清空 ----
// 用真正的 src/app.jsx 函式跑「初始載入 → 合併 → 持股自動存檔 → 清 usHoldings」整段流程。
const mergeSrc = [
  source.match(/const uid = \(\) => [^\n]*\n/)[0],
  source.match(/const normalizeStockSymbol = [^\n]*\n/)[0],
  source.match(/const isStockSymbol = [^\n]*\n/)[0],
  source.match(/function holdingShareCount\([\s\S]*?\n\}\n/)[0],
  source.match(/function mergeLegacyUsHoldings\([\s\S]*?\n\}\n/)[0],
].join('');
const LEGACY_US = '[{"id":"u1","symbol":"AAPL","name":"Apple","shares":3}]';

function legacyFlowEnv({ app = {}, local = {}, throwGet = [], throwLocalGet = [] } = {}) {
  const ls = memoryStorage(local);
  const realGet = ls.getItem;
  ls.getItem = (k) => { if (throwLocalGet.includes(k)) throw new Error('localStorage read failed'); return realGet(k); };
  const appStore = appStorage(app);
  const realAppGet = appStore.get;
  appStore.get = async (k) => { if (throwGet.includes(k)) throw new Error('storage get failed'); return realAppGet(k); };
  const window = { localStorage: ls, storage: appStore, dispatchEvent() {} };
  const ctx = { window, console: { warn() {}, error() {} }, CustomEvent: class {}, JSON, Promise, String, Math, Number };
  const env = vm.runInNewContext(`${guard}\n${saveFn}\n${mergeSrc}\n({ saveKey, loadKeyGuarded, loadLegacyUsHoldings, persistHoldingsThenClearLegacyUs, mergeLegacyUsHoldings })`, ctx);
  return { ls, appStore, env };
}

// 與 src/app.jsx 初始載入同邏輯：blocked = 舊版 usHoldings 讀取不可靠；corrupt 清單含 usHoldings 才會顯示保護提示。
async function bootLegacyFlow(m) {
  const hRes = await m.env.loadKeyGuarded('holdings', [], NOW);
  const tRes = await m.env.loadKeyGuarded('trades', [], NOW);
  const uhRes = await m.env.loadLegacyUsHoldings(NOW);
  const state = { done: false, blocked: uhRes.corrupt === true };
  const corrupt = [hRes, uhRes, tRes].filter((r) => r.corrupt).map((r) => r.key);
  const holdings = m.env.mergeLegacyUsHoldings(hRes.value, uhRes.value, tRes.value);
  const writes = [];
  const persist = async (k, v) => { writes.push(k); return m.env.saveKey(k, v); };
  let cleared = null;
  if (!corrupt.includes('holdings')) cleared = await m.env.persistHoldingsThenClearLegacyUs(persist, holdings, state);
  return { uhRes, state, corrupt, holdings, writes, cleared };
}

test('app wires legacy usHoldings through the guarded loader and blocks the cleanup when it is unreliable', () => {
  assert.doesNotMatch(source, /loadKey\("usHoldings"/, 'usHoldings must not use loadKey (read errors would look like [])');
  assert.match(source, /loadLegacyUsHoldings\(\),/);
  assert.match(source, /legacyUsMigrationRef\.current\.blocked = uhRes\.corrupt === true;/);
  assert.match(source, /const corrupt = \[drRes, hRes, uhRes, tRes, dvRes\]\.filter\(\(r\) => r\.corrupt\);/);
  assert.match(source, /setHoldings\(mergeLegacyUsHoldings\(h, uhRes\.value, t\)\);/);
  assert.match(source, /if \(saved !== true \|\| state\.done \|\| state\.blocked\) return false;/);
  assert.match(source, /CORRUPT_LOAD_LABELS = \{[^}]*usHoldings: \["舊版美股持股", "Legacy US holdings"\]/);
});

test('legacy flow: window.storage.get throws for usHoldings → merges the localStorage copy, saves holdings, keeps usHoldings', async () => {
  const m = legacyFlowEnv({ app: { holdings: '[]', usHoldings: LEGACY_US }, local: { holdings: '[]', usHoldings: LEGACY_US }, throwGet: ['usHoldings'] });
  const r = await bootLegacyFlow(m);
  assert.equal(r.uhRes.corrupt, true, 'read failure is not "no legacy data"');
  assert.deepEqual(r.corrupt, ['usHoldings'], 'protection banner lists usHoldings');
  assert.equal(r.state.blocked, true);
  assert.deepEqual(r.holdings.map((h) => [h.symbol, h.initialShares]), [['AAPL', 3]], 'merge used the localStorage legacy holdings');
  assert.deepEqual(r.writes, ['holdings'], 'usHoldings clear is never sent');
  assert.equal(r.cleared, false);
  assert.equal(JSON.parse(m.appStore.map.get('holdings'))[0].symbol, 'AAPL', 'holdings write succeeded');
  assert.equal(JSON.parse(m.ls.getItem('holdings'))[0].symbol, 'AAPL');
  assert.equal(m.appStore.map.get('usHoldings'), LEGACY_US, 'window.storage usHoldings kept');
  assert.equal(m.ls.getItem('usHoldings'), LEGACY_US, 'localStorage usHoldings kept');
  assert.equal(m.ls.getItem(r.uhRes.backupKey), LEGACY_US, 'raw copy also kept as usHoldings_corrupt_*');
  // 之後持股再變動也不清
  assert.equal(await m.env.persistHoldingsThenClearLegacyUs((k, v) => m.env.saveKey(k, v), r.holdings, r.state), false);
  assert.equal(m.ls.getItem('usHoldings'), LEGACY_US);
  // 下次重新開啟、讀取恢復正常：已合併的 AAPL 不重複，才清空 usHoldings
  m.appStore.get = async (k) => (m.appStore.map.has(k) ? { value: m.appStore.map.get(k) } : null);
  const r2 = await bootLegacyFlow(m);
  assert.equal(r2.uhRes.corrupt, false);
  assert.equal(r2.holdings.length, 1);
  assert.equal(r2.cleared, true);
  assert.equal(m.appStore.map.get('usHoldings'), '[]');
  assert.equal(m.ls.getItem('usHoldings'), '[]');
});

test('legacy flow: window.storage.get throws and only localStorage has legacy (app store empty) → still merged and kept', async () => {
  const m = legacyFlowEnv({ app: {}, local: { usHoldings: LEGACY_US }, throwGet: ['usHoldings'] });
  const r = await bootLegacyFlow(m);
  assert.equal(r.holdings[0].symbol, 'AAPL');
  assert.deepEqual(r.writes, ['holdings']);
  assert.equal(m.ls.getItem('usHoldings'), LEGACY_US);
  assert.equal(m.appStore.map.has('usHoldings'), false, 'no [] written into window.storage either');
});

test('legacy flow: both channels fail to read usHoldings → state unknown, never cleared', async () => {
  const m = legacyFlowEnv({ app: { usHoldings: LEGACY_US }, local: { usHoldings: LEGACY_US }, throwGet: ['usHoldings'], throwLocalGet: ['usHoldings'] });
  const r = await bootLegacyFlow(m);
  assert.equal(r.uhRes.corrupt, true);
  assert.equal(r.state.blocked, true);
  assert.deepEqual(r.writes, ['holdings']);
  assert.equal(m.appStore.map.get('usHoldings'), LEGACY_US);
  assert.equal(m.ls.map.get('usHoldings'), LEGACY_US);
});

test('legacy flow: corrupt or non-array usHoldings is kept (not cleared) and backed up', async () => {
  for (const bad of ['[{"symbol":"AAPL",', '{"symbol":"AAPL"}', '']) {
    const m = legacyFlowEnv({ local: { usHoldings: bad } });
    const r = await bootLegacyFlow(m);
    assert.equal(r.uhRes.corrupt, true, `${JSON.stringify(bad)} must be protected`);
    assert.deepEqual(r.corrupt, ['usHoldings']);
    assert.deepEqual(r.writes, ['holdings']);
    assert.equal(m.ls.getItem('usHoldings'), bad, 'original key untouched');
    assert.equal(m.ls.getItem(r.uhRes.backupKey), bad);
  }
});

test('legacy flow: new user without usHoldings still completes the migration normally', async () => {
  const m = legacyFlowEnv({ app: {}, local: {} });
  const r = await bootLegacyFlow(m);
  assert.equal(r.uhRes.corrupt, false);
  assert.deepEqual(r.corrupt, []);
  assert.equal(r.state.blocked, false);
  assert.deepEqual(r.holdings, []);
  assert.deepEqual(r.writes, ['holdings', 'usHoldings']);
  assert.equal(r.cleared, true);
  assert.equal(r.state.done, true);
  assert.equal(m.appStore.map.get('usHoldings'), '[]');
  assert.equal(m.ls.getItem('usHoldings'), '[]');
  assert.equal([...m.ls.map.keys()].some((k) => k.includes('_corrupt_')), false);
});
