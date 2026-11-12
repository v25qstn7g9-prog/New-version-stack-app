// 自動存檔寫入失敗（兩個儲存管道都失敗，例如 iPhone 空間不足 QuotaExceededError）時要顯示中文提示；
// 同一 key 連續失敗不重複、該 key 存成功就清除、全部恢復才消失。實際執行 src/app.jsx 的程式片段。
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readAppSource } from './_app-source.mjs';

const source = readAppSource();
const block = (name) => {
  const m = source.match(new RegExp(`// <${name}>([\\s\\S]*?)// </${name}>`));
  assert.ok(m, `missing <${name}> block`);
  return m[1];
};
const stateFns = block('autosave-fail-state');
const bannerJsx = block('save-fail-banner');
const saveFn = source.match(/async function saveKey\(key, value\) \{[\s\S]*?\n\}/)[0];
const trackedFn = source.match(/function trackedAutoSave\(key, value, restoringRef, pending, save\) \{[\s\S]*?\n\}/)[0];

const IS_CI = !!process.env.CI;
let Babel = null;
try { Babel = createRequire(import.meta.url)('@babel/standalone'); } catch {}
const needBabel = { skip: Babel || IS_CI ? false : '需要 npm install（@babel/standalone）' };

function quotaError() { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; return e; }
function memoryStorage() {
  const map = new Map();
  const s = {
    map, failing: new Set(), failAll: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { if (s.failAll || s.failing.has(k)) throw quotaError(); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
  };
  return s;
}

// 模擬 AssetTracker：saveFailKeys state（setState 用 updater）＋ persistKey（與 src/app.jsx 同樣的組合方式）。
function makeApp({ withWindowStorage = false, windowStorageFails = false } = {}) {
  const ls = memoryStorage();
  const window = { localStorage: ls, dispatchEvent() {} };
  if (withWindowStorage) window.storage = { set: async () => { if (windowStorageFails) throw new Error('storage down'); } };
  const ctx = { window, CustomEvent: class {}, console: { warn() {}, error() {} } };
  const env = vm.runInNewContext(`${stateFns}\n${trackedFn}\n${saveFn}\n({ applyAutoSaveResult, reportingSave, trackedAutoSave, saveKey })`, ctx);
  const app = { saveFailKeys: [], renders: 0, ls, env, window, restoringRef: { current: false }, pending: new Set(), seqs: new Map() };
  const setSaveFailKeys = (updater) => {
    const next = updater(app.saveFailKeys);
    if (next !== app.saveFailKeys) { app.saveFailKeys = next; app.renders++; }
  };
  const reportAutoSave = (key, saved) => setSaveFailKeys((prev) => env.applyAutoSaveResult(prev, key, saved));
  app.persistKey = (key, value) => env.trackedAutoSave(key, value, app.restoringRef, app.pending, env.reportingSave(env.saveKey, reportAutoSave, app.seqs));
  return app;
}

// 把 SaveFailBanner 的 JSX 轉成可執行的函式，用簡易 createElement 收集文字與按鈕。
function loadBanner(english = false) {
  const code = Babel.transform(bannerJsx + '\n;({ SaveFailBanner, saveFailLabels })', { presets: ['react'] }).code;
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
  const ctx = { React: { createElement: h, Fragment: 'Fragment' }, COLORS: { panel: '#fff', text: '#111', gold: '#123', bg: '#fff', sub: '#666' }, UI_SHOW_ENGLISH: english };
  return vm.runInNewContext(code, ctx);
}
const textOf = (n) => (n == null || n === false ? '' : typeof n !== 'object' ? String(n) : n.children.map(textOf).join(''));
const findAll = (n, pred, out = []) => { if (n && typeof n === 'object') { if (pred(n)) out.push(n); n.children.forEach((c) => findAll(c, pred, out)); } return out; };

test('QuotaExceeded on both storages → saveKey still returns false and the key is reported as failed', async () => {
  const app = makeApp({ withWindowStorage: true, windowStorageFails: true });
  app.ls.failAll = true;
  const saved = await app.persistKey('trades', [{ id: 1 }]);
  assert.equal(saved, false, 'saveKey 回傳語意不變');
  assert.deepEqual([...app.saveFailKeys], ['trades']);
});

test('banner shows Chinese notice with failed item names and a 44px button to JSON backup', needBabel, async () => {
  const { SaveFailBanner } = loadBanner();
  const app = makeApp();
  app.ls.failAll = true;
  await app.persistKey('holdings', []);
  await app.persistKey('trades', []);
  let opened = 0;
  const tree = SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup: () => { opened++; } });
  assert.ok(tree, 'banner should render');
  const text = textOf(tree);
  assert.match(text, /本機儲存失敗/);
  assert.match(text, /可能是手機空間不足/);
  assert.match(text, /JSON備份/);
  assert.match(text, /持股／交易/);
  assert.notEqual(tree.props.role, 'alertdialog');
  const buttons = findAll(tree, (n) => n.type === 'button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.style.minHeight, 44);
  buttons[0].props.onClick();
  assert.equal(opened, 1);
  // 英文模式也有對應文字
  const en = loadBanner(true).SaveFailBanner({ keys: ['trades'], onOpenBackup() {} });
  assert.match(textOf(en), /Couldn't save Trades/);
});

test('repeated failures of the same key do not stack or trigger re-renders', async () => {
  const app = makeApp();
  app.ls.failAll = true;
  for (let i = 0; i < 5; i++) await app.persistKey('trades', [{ id: i }]);
  assert.deepEqual([...app.saveFailKeys], ['trades']);
  assert.equal(app.renders, 1, '只有第一次失敗改變 state');
});

test('next successful save clears the key and the banner disappears', needBabel, async () => {
  const { SaveFailBanner } = loadBanner();
  const app = makeApp();
  app.ls.failAll = true;
  await app.persistKey('trades', [1]);
  assert.ok(SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup() {} }));
  app.ls.failAll = false;
  assert.equal(await app.persistKey('trades', [1, 2]), true);
  assert.equal(app.saveFailKeys.length, 0);
  assert.equal(SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup() {} }), null);
  assert.equal(app.ls.getItem('trades'), '[1,2]');
});

test('multiple failed keys: one recovering keeps the banner, all recovering hides it', needBabel, async () => {
  const { SaveFailBanner } = loadBanner();
  const app = makeApp();
  app.ls.failing = new Set(['holdings', 'trades', 'dividends']);
  await app.persistKey('holdings', []);
  await app.persistKey('trades', []);
  await app.persistKey('dividends', []);
  await app.persistKey('goal', 100); // 這個沒失敗
  assert.deepEqual([...app.saveFailKeys], ['holdings', 'trades', 'dividends']);

  app.ls.failing.delete('trades');
  await app.persistKey('trades', [1]);
  assert.deepEqual([...app.saveFailKeys], ['holdings', 'dividends']);
  const tree = SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup() {} });
  assert.ok(tree, 'banner stays while other keys still fail');
  assert.match(textOf(tree), /持股／配息/);
  assert.doesNotMatch(textOf(tree), /交易/);

  app.ls.failing.clear();
  await app.persistKey('holdings', [1]);
  assert.ok(SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup() {} }));
  await app.persistKey('dividends', [1]);
  assert.equal(app.saveFailKeys.length, 0);
  assert.equal(SaveFailBanner({ keys: app.saveFailKeys, onOpenBackup() {} }), null);
});

test('normal saves never show the banner', async () => {
  const app = makeApp({ withWindowStorage: true });
  for (const k of ['holdings', 'trades', 'dailyRecords', 'dividends', 'goal']) assert.equal(await app.persistKey(k, []), true);
  assert.equal(app.saveFailKeys.length, 0);
  assert.equal(app.renders, 0);
});

test('window.storage failing but localStorage succeeding is not a failure', async () => {
  const app = makeApp({ withWindowStorage: true, windowStorageFails: true });
  assert.equal(await app.persistKey('trades', [1]), true);
  assert.equal(app.saveFailKeys.length, 0);
});

test('saves skipped by the restore lock are not counted as failures', async () => {
  const app = makeApp();
  app.ls.failAll = true;
  app.restoringRef.current = true;
  assert.equal(await app.persistKey('trades', [1]), false);
  assert.equal(app.saveFailKeys.length, 0, '還原鎖跳過的寫入不算存檔失敗');
});

test('app wiring: persistKey reports results, corrupt-guarded keys still skip, banner rendered once', () => {
  assert.match(source, /const persistKey = \(key, value\) => trackedAutoSave\(key, value, restoringRef, pendingAutoSavesRef\.current, reportingSave\(saveKey, reportAutoSave, autoSaveSeqRef\.current\)\);/);
  assert.match(source, /const autoSaveSeqRef = useRef\(new Map\(\)\);/);
  assert.match(source, /useEffect\(\(\) => \{ if \(ready && canPersist\("trades"\)\) persistKey\("trades", trades\); \}/);
  assert.equal((source.match(/<SaveFailBanner /g) || []).length, 1);
  assert.doesNotMatch(bannerJsx, /alert\(|confirm\(|animation|animate-/);
});

// 亂序完成：用可控的 window.storage.set（每次呼叫回傳自己的 deferred），讓舊寫入比新寫入晚結束。
function makeDeferredApp() {
  const app = makeApp({ withWindowStorage: true });
  const calls = [];
  app.window.storage.set = (key, payload) => new Promise((resolve, reject) => calls.push({ key, payload, resolve, reject }));
  return { app, calls };
}
const flush = () => new Promise((r) => setImmediate(r));

test('out of order: older success finishing late does not clear a newer failure', async () => {
  const { app, calls } = makeDeferredApp();
  app.ls.failing = new Set(['trades']); // localStorage 一直失敗，結果只看 window.storage
  const a = app.persistKey('trades', ['A']);
  const b = app.persistKey('trades', ['B']);
  calls[1].reject(new Error('storage down')); // B 兩管道都失敗
  assert.equal(await b, false);
  assert.deepEqual([...app.saveFailKeys], ['trades']);
  calls[0].resolve(); // A（較舊）晚到且成功
  assert.equal(await a, true, 'saveKey 回傳值不變');
  await flush();
  assert.deepEqual([...app.saveFailKeys], ['trades'], '舊成功不可清掉較新失敗的提示');
});

test('out of order: older failure finishing late does not bring back a recovered notice', async () => {
  const { app, calls } = makeDeferredApp();
  app.ls.failing = new Set(['trades']);
  // 先讓 trades 處於失敗狀態
  const first = app.persistKey('trades', ['X']);
  calls[0].reject(new Error('storage down'));
  assert.equal(await first, false);
  assert.deepEqual([...app.saveFailKeys], ['trades']);
  const a = app.persistKey('trades', ['A']);
  const b = app.persistKey('trades', ['B']);
  calls[2].resolve(); // B（最新）成功 → 提示消失
  assert.equal(await b, true);
  assert.equal(app.saveFailKeys.length, 0);
  calls[1].reject(new Error('storage down')); // A（較舊）晚到且失敗
  assert.equal(await a, false, 'saveKey 回傳值不變');
  await flush();
  assert.equal(app.saveFailKeys.length, 0, '舊失敗不可讓已恢復的提示重新出現');
});

test('sequence is per key: a newer write on another key does not hide this key\'s result', async () => {
  const { app, calls } = makeDeferredApp();
  app.ls.failAll = true;
  const t = app.persistKey('trades', [1]);
  const h = app.persistKey('holdings', [1]);
  calls[1].resolve();
  assert.equal(await h, true);
  calls[0].reject(new Error('storage down'));
  assert.equal(await t, false);
  assert.deepEqual([...app.saveFailKeys], ['trades']);
});

test('regression: window.storage succeeds but localStorage fails → not a failure, existing notice clears', async () => {
  const app = makeApp({ withWindowStorage: true, windowStorageFails: true });
  app.ls.failAll = true;
  assert.equal(await app.persistKey('trades', [1]), false);
  assert.deepEqual([...app.saveFailKeys], ['trades']);
  app.window.storage.set = async () => {}; // window.storage 恢復，localStorage 仍 QuotaExceeded
  assert.equal(await app.persistKey('trades', [2]), true);
  assert.equal(app.saveFailKeys.length, 0);
  assert.equal(await app.persistKey('holdings', [1]), true);
  assert.equal(app.saveFailKeys.length, 0);
});
