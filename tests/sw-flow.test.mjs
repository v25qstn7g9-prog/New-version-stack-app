import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 用假的 IndexedDB／fetch／推播事件，把 sw.js 完整跑一遍（無法在真手機上測，至少把整條流程驗證到）。
function fakeIdb() {
  const data = new Map();
  const req = (fn) => { const r = {}; setTimeout(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }, 0); return r; };
  return {
    data,
    open() {
      const r = {};
      setTimeout(() => {
        r.result = {
          createObjectStore() {},
          transaction() {
            const tx = { objectStore: () => ({ get: (k) => req(() => data.get(k)), put: (v, k) => { data.set(k, v); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); } }) };
            return tx;
          },
        };
        r.onupgradeneeded && r.onupgradeneeded();
        r.onsuccess && r.onsuccess();
      }, 0);
      return r;
    },
  };
}

async function runPush({ now, mirror, pending, quotes, quoteOk = true }) {
  const idb = fakeIdb();
  if (mirror) idb.data.set('mirror', mirror);
  if (pending) idb.data.set('pendingAuto', pending);
  const shown = [];
  const listeners = {};
  const self = {
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    clients: { claim() {}, matchAll: async () => [], openWindow: async () => {} },
    skipWaiting() {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const RealDate = Date;
  const FakeDate = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return new RealDate(now).getTime(); } };
  const fetchCalls = [];
  const ctx = {
    self, Date: FakeDate, setTimeout, Promise, JSON, Math, Object, Array, Set, Map, console,
    indexedDB: idb,
    encodeURIComponent,
    fetch: async (url) => { fetchCalls.push(String(url)); if (!quoteOk) throw new Error('offline'); return { ok: true, json: async () => ({ quotes }) }; },
    importScripts: () => vm.runInContext(fs.readFileSync('bg-core.js', 'utf8'), ctx),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), ctx);
  let done;
  listeners.push({ waitUntil: (p) => { done = p; } });
  await done;
  return { shown, idb, fetchCalls };
}

const mirror = { holdings: [{ symbol: '0050', shares: 1000, costBasis: 150000 }], recordDates: ['2026-10-02'], prior: { twCost: 150000, usValue: 0, usCost: 0 } };
const q = (price, extra = {}) => ({ '0050': { price, isStale: false, asOfDate: '2026-10-05T05:30:00.000Z', ...extra } });

test('13:45 push shows the reminder and touches nothing', async () => {
  const r = await runPush({ now: '2026-10-05T13:45:00+08:00', mirror });
  assert.equal(r.shown.length, 1);
  assert.match(r.shown[0].title, /記帳提醒/);
  assert.equal(r.fetchCalls.length, 0);
  assert.equal(r.idb.data.get('pendingAuto'), undefined);
});

test('14:00 push without a record auto-records from live quotes and queues it for the app', async () => {
  const r = await runPush({ now: '2026-10-05T14:00:00+08:00', mirror, quotes: q(190) });
  assert.match(r.shown[0].title, /已自動記錄/);
  assert.match(r.shown[0].body, /190,000/);
  const pending = r.idb.data.get('pendingAuto');
  assert.equal(pending.length, 1);
  assert.deepEqual([pending[0].date, pending[0].twValue, pending[0].source], ['2026-10-05', 190000, 'auto']);
  assert.ok(r.idb.data.get('mirror').recordDates.includes('2026-10-05'), 'a repeat push will not record twice');
});

test('14:00 push when today is already recorded only confirms it', async () => {
  const r = await runPush({ now: '2026-10-05T14:00:00+08:00', mirror: { ...mirror, recordDates: ['2026-10-05'] }, quotes: q(190) });
  assert.match(r.shown[0].title, /已記錄好了/);
  assert.equal(r.fetchCalls.length, 0);
  assert.equal(r.idb.data.get('pendingAuto'), undefined);
});

test('14:00 push with stale quotes, no network, or no mirror still shows a notification and records nothing', async () => {
  const stale = await runPush({ now: '2026-10-05T14:00:00+08:00', mirror, quotes: q(190, { isStale: true }) });
  assert.match(stale.shown[0].title, /沒能自動記錄/);
  assert.equal(stale.idb.data.get('pendingAuto'), undefined);
  const offline = await runPush({ now: '2026-10-05T14:00:00+08:00', mirror, quoteOk: false });
  assert.match(offline.shown[0].title, /沒能自動記錄/);
  const none = await runPush({ now: '2026-10-05T14:00:00+08:00', mirror: null });
  assert.match(none.shown[0].title, /收盤提醒已開啟/);
});
