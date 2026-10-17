import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 即時股價表：市值、損益一律整數；放進窄欄位不換行（≥1億改用「億」，≥1千萬縮小字）。
const html = readAppSource();
const block = html.match(/\/\/ <ntd-amount>([\s\S]*?)\/\/ <\/ntd-amount>/)?.[1];
assert.ok(block, 'ntd-amount block must exist');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(block + '\nthis.ntdAmount=ntdAmount;', ctx);
const a = (v, en) => JSON.parse(JSON.stringify(ctx.ntdAmount(v, en)));

test('amounts are whole numbers with thousands separators', () => {
  assert.deepEqual(a(5315602.5), { text: 'NT$ 5,315,603', small: false });
  assert.deepEqual(a(18173.0), { text: 'NT$ 18,173', small: false });
  assert.deepEqual(a(0), { text: 'NT$ 0', small: false });
  assert.deepEqual(a(-4706.4), { text: '-NT$ 4,706', small: false });
});

test('1千萬 and above use a smaller font so the number still fits one line', () => {
  assert.equal(a(9999999).small, false);
  assert.deepEqual(a(10000000), { text: 'NT$ 10,000,000', small: true });
  assert.deepEqual(a(99999999.4), { text: 'NT$ 99,999,999', small: true });
});

test('1億 and above are shown in 億 (M in English) instead of nine digits', () => {
  assert.deepEqual(a(100000000), { text: 'NT$ 1.00億', small: false });
  assert.deepEqual(a(123456789), { text: 'NT$ 1.23億', small: false });
  assert.deepEqual(a(-250000000), { text: '-NT$ 2.50億', small: false });
  assert.deepEqual(a(123456789, true), { text: 'NT$ 123.5M', small: false });
});

test('non-numbers do not throw', () => {
  assert.equal(a(undefined).text, 'NT$ —');
  assert.equal(a('abc').text, 'NT$ —');
});

test('wiring: live rows use it with nowrap, and the summary lines are integers', () => {
  assert.ok(html.includes('const a = ntdAmount(r.value, UI_SHOW_ENGLISH);'));
  assert.ok(html.includes('whitespace-nowrap" data-live-amount'));
  assert.ok(html.includes('NT$ {formatNtdPrice(twLiveValue, 0)}'));
  assert.ok(html.includes('NT$ {formatNtdPrice(totalValue, 0)}'));
  assert.ok(!html.includes('NT$ {formatNtdPrice(r.value, 1)}'), 'per-row market value must not show decimals');
});
