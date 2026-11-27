// AI 問答讀資料（使用者 2026-11-18「內建 puter 無法正確讀取」）：零股不可被四捨五入（VOO 4.64047 股不是 5 股）、
// 交易要附實際付出的台幣金額、「查全部持股股價」要包含靠交易紀錄持有（期初 0 股、沒設目標）的股票。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert.ok(i >= 0 && j > i, from); return src.slice(i, j); };
const code = cut('const uid = ', 'function pickEvenTimeTicks(') + cut('const READ_TOOL_NAMES', 'async function executeAppSnapshotTool(');
const ctx = { Intl, Date, Math, JSON, Number, String, Object, Array, Set, Map, RegExp, Promise, window: {}, localStorage: { getItem() { return null; }, setItem() {} } };
vm.createContext(ctx);
vm.runInContext(code + '\n;globalThis.__t = { executeReadTool, executeLiveQuoteTool };', ctx);
const { executeReadTool } = ctx.__t;

const trades = [
  { id: 'a', date: '2026-10-07', symbol: 'VOO', action: 'buy', shares: 0.06876, price: 22731, amount: 1562.98, currency: 'TWD', fxRate: 1 },
  { id: 'b', date: '2026-11-17', symbol: 'VOO', action: 'buy', shares: 0.13676, price: 11428.78, amount: 1563, currency: 'TWD', fxRate: 1 },
  { id: 'c', date: '2026-11-17', symbol: '0056', action: 'buy', shares: 36, price: 50.35, amount: 1814 },
];
const holdings = [{ id: 'v', symbol: 'VOO', initialShares: 3.81853, target2035: 30 }, { id: 'z', symbol: '0056', initialShares: 0, target2035: 0 }];
const q = (a) => executeReadTool({ name: 'query_app_data', arguments: a }, { trades, dailyRecords: [], dividends: [{ date: '2026-10-20', symbol: 'VOO', shares: 4.2953, perShare: 50, amount: 215 }], holdings });

test('fractional shares stay fractional in every read result', () => {
  assert.match(q({ source: 'holding_cost', symbol: 'VOO' }), /股數4\.02405股/);
  assert.match(q({ source: 'trades', aggregation: 'summary', symbol: 'VOO' }), /買進2筆共0\.20552股/);
  assert.match(q({ source: 'trades', symbol: 'VOO' }), /買進 0\.06876股/);
  assert.match(q({ source: 'dividends' }), /VOO 4\.2953股/);
});

test('trade lines carry the NT$ amount actually paid, so a wrong unit price does not mislead', () => {
  const out = q({ source: 'trades', symbol: 'VOO' });
  assert.match(out, /0\.13676股 @NT\$ 11,428\.78，金額NT\$ 1,563/);
  assert.match(q({ source: 'trades', aggregation: 'summary' }), /金額NT\$ 4,940/);
});

test('"all holdings" quotes include stocks held through trades only (initial 0, no target)', () => {
  const live = cut('async function executeLiveQuoteTool(', 'async function executeAppSnapshotTool(');
  assert.match(live, /Number\(h\.current\) > 0 \|\| Number\(h\.initialShares\) > 0/);
});

test('the AI summary and snippets show the trade amount too', () => {
  assert.match(src, /amount: Number\.isFinite\(Number\(t\.amount \?\? tradeAmountNtd\(t, t\.fxRate\)\)\)/);
  assert.match(src, /（金額 NT\$ \$\{puterFmt\(t\.amount\)\}）/);
});
