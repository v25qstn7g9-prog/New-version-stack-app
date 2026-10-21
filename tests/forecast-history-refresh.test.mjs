import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

const source = readAppSource();
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('an open factor backtest reads newly saved samples and removes its listener on close', async () => {
  const body = source.slice(source.indexOf('function FactorBacktest()'));
  const effect = body.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[open\]\);/)[1];
  const target = new EventTarget();
  let rows = [], shown, reads = 0;
  const cleanup = vm.runInNewContext(`(function(){${effect}})()`, {
    open: true, window: target,
    loadKey: async () => { reads++; return { records: rows }; },
    setToday: value => { shown = value.records; }, setTomorrow() {},
  });
  await settle();
  assert.equal(shown.length, 0);
  rows = [{ key: 'new-sample', actual: { pct: 1 } }];
  target.dispatchEvent(new Event('forecastHistoryUpdated'));
  await settle();
  assert.equal(shown.length, 1, 'a new sample must appear without collapsing and reopening');
  cleanup();
  const before = reads;
  target.dispatchEvent(new Event('forecastHistoryUpdated'));
  await settle();
  assert.equal(reads, before);
});

test('saving a forecast history publishes an update only after a successful write', async () => {
  const fn = source.match(/async function saveKey\(key, value\) \{[\s\S]*?\n\}/)[0];
  const target = new EventTarget();
  let writes = 0, updates = 0;
  target.localStorage = { setItem() { writes++; } };
  target.addEventListener('forecastHistoryUpdated', () => { updates++; assert.ok(writes); });
  const save = vm.runInNewContext(`(${fn})`, { window: target, CustomEvent, console: { warn() {}, error() {} } });
  await save('other-key', {});
  assert.equal(updates, 0);
  await save('trendRadarHistory', { records: [] });
  await save('trendRadarTomorrowHistory', { records: [] });
  assert.equal(updates, 2);
  target.localStorage.setItem = () => { throw new Error('quota'); };
  await save('trendRadarHistory', {});
  assert.equal(updates, 2, 'a failed write cannot report success');
});

test('learning refreshes when verified history arrives after the initial startup timer', async () => {
  const section = source.slice(source.indexOf('// ⑥ 自主學習'), source.indexOf('// ⑤ App 收在背景時'));
  const effect = section.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[ready\]\);/)[1];
  const target = new EventTarget(), timers = new Map();
  let calls = 0, id = 0;
  const cleanup = vm.runInNewContext(`(function(){${effect}})()`, {
    ready: true, window: target, TREND_MODEL_VERSION: 'M',
    runSelfLearn: async () => { calls++; },
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: n => timers.delete(n),
  });
  const flush = async () => { const work = [...timers.values()]; timers.clear(); for (const fn of work) fn(); await settle(); };
  await flush();
  assert.equal(calls, 1);
  target.dispatchEvent(new Event('forecastHistoryUpdated'));
  await flush();
  assert.equal(calls, 2, 'late verification must trigger learning during the same session');
  cleanup();
  target.dispatchEvent(new Event('forecastHistoryUpdated'));
  assert.equal(timers.size, 0);
});

test('a failed forecast-history read cannot become an empty successful write', async () => {
  const read = source.match(/async function loadKey\(key, fallback[^)]*\) \{[\s\S]*?\n\}/)[0];
  const writer = source.match(/\/\/ <forecast-history-writer>([\s\S]*?)\/\/ <\/forecast-history-writer>/)[1];
  let writes = 0;
  const update = vm.runInNewContext(read + '\n' + writer + '\nupdateForecastHistory', {
    window: {localStorage: {getItem() { throw new Error('storage temporarily unavailable'); }}},
    saveKey: async () => { writes++; return true; },
  });
  await assert.rejects(update('trendRadarHistory', () => ({records:[]})), /storage/);
  assert.equal(writes, 0);
});
