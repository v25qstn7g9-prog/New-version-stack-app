import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 進階使用：預設關閉；有目標／定期定額／本金計畫的人（含舊使用者）自動視為進階；
// 沒進階就隱藏「計畫進度」頁和所有跟目標有關的畫面。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <advanced-mode>([\s\S]*?)\/\/ <\/advanced-mode>/)?.[1];
assert.ok(block, 'advanced-mode block must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.detect=detectAdvancedUse;this.initial=initialAdvancedMode;this.tabs=visibleTabsFor;', ctx);
const { detect, initial, tabs } = ctx;
const dflt = { goal: { targetAmount: 10000000, targetYear: 2035 }, planItems: [], planSchedule: { initialPrincipal: 0, initialAssets: 0, initialCapital: 0, monthlyAmount: 0, annualReturn: 11, horizonMonths: 120 } };

test('a fresh install with only defaults is a basic user', () => {
  assert.equal(detect(dflt), false);
  assert.equal(detect({}), false);
  assert.equal(detect(), false);
});

test('any real plan data makes an advanced user', () => {
  assert.equal(detect({ ...dflt, goal: { targetAmount: 20000000, targetYear: 2035 } }), true);
  assert.equal(detect({ ...dflt, goal: { targetAmount: 10000000, targetYear: 2040 } }), true);
  assert.equal(detect({ ...dflt, planItems: [{ id: 'a', symbol: '0050', amount: 5000 }] }), true);
  for (const k of ['initialPrincipal', 'initialAssets', 'initialCapital', 'monthlyAmount']) {
    assert.equal(detect({ ...dflt, planSchedule: { ...dflt.planSchedule, [k]: 1000 } }), true, k);
  }
  // string numbers from old backups
  assert.equal(detect({ ...dflt, planSchedule: { ...dflt.planSchedule, monthlyAmount: '5000' } }), true);
});

test('first load: a saved choice always wins', () => {
  assert.equal(initial({ saved: false, hadStoredGoal: true, ...dflt, planItems: [{ id: 1 }] }), false);
  assert.equal(initial({ saved: true, hadStoredGoal: false, ...dflt }), true);
});

test('first load: existing users (goal already stored) are advanced even with default numbers', () => {
  assert.equal(initial({ saved: null, hadStoredGoal: true, ...dflt }), true);
});

test('first load: brand-new install stays basic unless a plan exists', () => {
  assert.equal(initial({ saved: null, hadStoredGoal: false, ...dflt }), false);
  assert.equal(initial({ saved: null, hadStoredGoal: false, ...dflt, planItems: [{ id: 1 }] }), true);
});

test('the Progress tab is hidden for basic users and everything else stays', () => {
  const all = [{ id: 'dashboard' }, { id: 'holdings' }, { id: 'progress' }, { id: 'plan' }];
  assert.deepEqual(JSON.parse(JSON.stringify(tabs(all, false))).map((t) => t.id), ['dashboard', 'holdings', 'plan']);
  assert.deepEqual(JSON.parse(JSON.stringify(tabs(all, true))).map((t) => t.id), ['dashboard', 'holdings', 'progress', 'plan']);
});

test('wiring: every goal surface is gated by the advanced flag', () => {
  assert.ok(html.includes('showGoal && goal?.targetAmount > 0 && (() => {'), 'goal bar');
  assert.ok(html.includes('{showGoal && goal?.targetAmount > 0 && <ReferenceLine'), 'chart goal line');
  assert.ok(html.includes('if (!ready || !advanced || celebratedMilestones === null'), 'milestone toast');
  assert.ok(html.includes('{advanced && (<>\n      <Panel title="退休目標設定">'), 'goal + recurring panels');
  assert.ok(html.includes('visibleTabs.findIndex'), 'tap navigation uses visible tabs');
  assert.ok(html.includes('visibleTabsRef.current'), 'swipe uses visible tabs');
  assert.ok(html.includes('<TabBar tabs={visibleTabs}'), 'tab bar uses visible tabs');
  assert.ok(/!advanced && tab === "progress"\) setTab\("dashboard"\)/.test(html), 'leaving the progress tab when switched off');
  assert.ok(html.includes('perf, advancedUse);'), 'AI context knows whether goals are on');
});

test('wiring: restore never downgrades, AI goal edits switch it on, and it is saved/exported', () => {
  assert.ok(html.includes('setAdvancedMode((cur) => cur || data.advancedMode === true || detectAdvancedUse('));
  assert.ok(html.includes('setGoal={(v) => { setGoal(v); setAdvancedMode(true); }}'));
  assert.ok(html.includes('saveKey("advancedMode", advancedMode)'));
});
