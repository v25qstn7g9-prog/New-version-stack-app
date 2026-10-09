import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 收盤提醒與自動記錄預設勾選。但通知權限瀏覽器規定要使用者自己同意，
// 所以「勾選」＝想開；真正開了才顯示「已開啟」，還沒開就請她按一下允許。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const block = html.match(/\/\/ <closing-reminder>([\s\S]*?)\/\/ <\/closing-reminder>/)?.[1];
assert.ok(block, 'closing-reminder block must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.wanted=closingReminderWanted;this.status=closingReminderStatus;', ctx);
const { wanted, status } = ctx;
const st = (o) => status({ wanted: true, pushState: 'off', permission: 'default', ios: false, standalone: false, ...o });
const store = (v) => ({ getItem: () => v });

test('wanted defaults to true; only an explicit "0" turns it off', () => {
  assert.equal(wanted(store(null)), true);
  assert.equal(wanted(store('1')), true);
  assert.equal(wanted(store('0')), false);
  assert.equal(wanted(undefined), true);
  assert.equal(wanted({ getItem() { throw new Error('blocked'); } }), true);
});

test('already subscribed is "on" regardless of the preference', () => {
  assert.equal(st({ pushState: 'on' }), 'on');
  assert.equal(st({ pushState: 'on', wanted: false }), 'on');
});

test('wanted but not allowed yet asks for a tap (never pretends it is on)', () => {
  assert.equal(st({}), 'needs_allow');
  assert.equal(st({ permission: 'default' }), 'needs_allow');
});

test('declined users are left alone', () => {
  assert.equal(st({ wanted: false }), 'declined');
  assert.equal(st({ wanted: false, pushState: 'unsupported' }), 'declined');
});

test('blocked, unsupported and iPhone-not-installed are explained instead', () => {
  assert.equal(st({ permission: 'denied' }), 'blocked');
  assert.equal(st({ pushState: 'unsupported' }), 'unsupported');
  assert.equal(st({ pushState: 'unsupported', ios: true, standalone: false }), 'needs_install');
  assert.equal(st({ pushState: 'unsupported', ios: true, standalone: true }), 'unsupported');
  assert.equal(st({ pushState: 'unknown' }), 'loading');
});

test('wiring: banner is mounted, panel uses a checkbox, and permission is only requested from a tap', () => {
  assert.ok(html.includes('<ClosingReminderBanner />'));
  assert.ok(html.includes('<input type="checkbox" checked={r.wanted} onChange={(e) => onToggle(e.target.checked)} />'));
  // requestPermission must stay inside enable(), which is only called from onClick/onChange handlers
  const calls = [...html.matchAll(/Notification\.requestPermission\(\)/g)].length;
  assert.equal(calls, 1);
  assert.ok(!/useEffect\([^)]*r\.enable\(\)/.test(html), 'no automatic permission request on load');
  assert.ok(html.includes('r.status !== "needs_allow" || hiddenDay === today'));
});
