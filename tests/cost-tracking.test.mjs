import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 交易紀錄頁的成本追蹤：目前累積成本＝台股＋美股持有成本（跟持股進度同一個數字），
// 起始成本由它倒推。
const html = readAppSource();
const block = html.match(/\/\/ <cost-tracking>([\s\S]*?)\/\/ <\/cost-tracking>/)?.[1];
assert.ok(block, 'cost-tracking block must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.costTracking=costTracking;', ctx);
const plain = (v) => JSON.parse(JSON.stringify(v));
const ct = (o) => plain(ctx.costTracking(o));

test('with holding costs, cost = TW + US and the starting cost is back-calculated from the trades', () => {
  // TW 3,840,143 + US 86,504 = 3,926,647; trades net 3,372,728
  const r = ct({ holdingCost: 3840143 + 86504, tradesNet: 3372728, manualStartingCost: 468978 });
  assert.equal(r.derived, true);
  assert.equal(r.accumulatedCost, 3926647);
  assert.equal(r.startingCost, 3926647 - 3372728);
  assert.equal(r.startingCost + r.tradesNet, r.accumulatedCost, 'starting + trades always reproduces the accumulated cost');
});

test('the manually typed starting cost is ignored once holding costs exist', () => {
  assert.equal(ct({ holdingCost: 1000000, tradesNet: 400000, manualStartingCost: 1 }).startingCost, 600000);
});

test('sells reduce the trade net, so the back-calculated start goes up', () => {
  assert.equal(ct({ holdingCost: 500000, tradesNet: 100000 - 40000, manualStartingCost: 0 }).startingCost, 440000);
});

test('no holding cost at all falls back to the manual starting cost plus trades', () => {
  const r = ct({ holdingCost: 0, tradesNet: 25000, manualStartingCost: 100000 });
  assert.deepEqual(r, { derived: false, accumulatedCost: 125000, startingCost: 100000, tradesNet: 25000 });
  assert.equal(ct({}).accumulatedCost, 0);
});

test('wiring: the page, Excel export and the AI context all use the derived starting cost', () => {
  assert.ok(html.includes('const costTrack = costTracking({ holdingCost: currentHoldingCost, tradesNet: tradesInvested, manualStartingCost: costBasis.startingCost });'));
  assert.ok(html.includes('const accumulatedCost = costTrack.accumulatedCost;'));
  assert.ok(html.includes('資料: Number(costTrack.startingCost || 0)'));
  assert.ok(html.includes('startingCost: costTrack.startingCost,'));
  assert.ok(html.includes('data-cost-tracking="derived"'));
  assert.ok(!/const accumulatedCost = Number\(costBasis\.startingCost/.test(html), 'old startingCost + trades formula must be gone');
});
