import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost, onRequestResolve } from '../functions/pending-trades.js';

// 待確認交易佇列：Atlas 中控台在聊天裡幫使用者送出的股票交易，先放這裡等使用者
// 自己打開 App 按「加入」才真正計入持股。這支 API 全程不會碰使用者的完整持股資料。
const token = 'a'.repeat(40);
const trade = { date: '2026-09-28', symbol: '0056', action: 'buy', shares: 30, price: 50, fee: 1, tax: 0, note: '來自 Atlas' };

function environment() {
  const records = new Map();
  return { health_kv: {
    get: async key => records.get(key) || null,
    put: async (key, value) => { records.set(key, value); },
  } };
}

function post(env, body) {
  return onRequestPost({ env, request: new Request('https://example.com/api/pending-trades', {
    method: 'POST', body: JSON.stringify(body),
  }) });
}

test('a proposed trade can be read back by token and then resolved away', async () => {
  const env = environment();
  const added = await post(env, { token, trade });
  assert.equal(added.status, 200);
  const addedBody = await added.json();
  assert.ok(addedBody.pending.id);
  assert.equal(addedBody.pending.symbol, '0056');

  const list = await onRequestGet({ env, request: new Request(`https://example.com/api/pending-trades?token=${token}`) });
  const listBody = await list.json();
  assert.equal(listBody.pending.length, 1);
  assert.equal(listBody.pending[0].id, addedBody.pending.id);

  const resolved = await onRequestResolve({ env, request: new Request('https://example.com/api/pending-trades/resolve', {
    method: 'POST', body: JSON.stringify({ token, id: addedBody.pending.id }),
  }) });
  assert.equal(resolved.status, 200);
  const after = await onRequestGet({ env, request: new Request(`https://example.com/api/pending-trades?token=${token}`) });
  assert.deepEqual((await after.json()).pending, []);
});

test('anonymous callers cannot read or add pending trades without the token', async () => {
  const env = environment();
  const denied = await onRequestGet({ env, request: new Request('https://example.com/api/pending-trades') });
  assert.equal(denied.status, 400);
  const deniedPost = await post(env, { token: '', trade });
  assert.equal(deniedPost.status, 400);
});

test('invalid trade fields (bad date, non-buy/sell action, negative shares) are rejected', async () => {
  const env = environment();
  for (const bad of [
    { ...trade, date: '2026/09/28' },
    { ...trade, action: 'hold' },
    { ...trade, shares: -1 },
    { ...trade, price: 0 },
    { ...trade, symbol: '' },
  ]) {
    const res = await post(env, { token, trade: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  const list = await onRequestGet({ env, request: new Request(`https://example.com/api/pending-trades?token=${token}`) });
  assert.deepEqual((await list.json()).pending, []);
});

test('the pending list is capped so it cannot grow without bound', async () => {
  const env = environment();
  for (let i = 0; i < 25; i++) {
    await post(env, { token, trade: { ...trade, note: `#${i}` } });
  }
  const list = await onRequestGet({ env, request: new Request(`https://example.com/api/pending-trades?token=${token}`) });
  const pending = (await list.json()).pending;
  assert.equal(pending.length, 20);
  assert.equal(pending[0].note, '#24'); // 最新的排最前面
});

test('a KV write failure surfaces the real reason, not a bare 500', async () => {
  const env = { health_kv: {
    get: async () => null,
    put: async () => { throw new Error('KV put() limit exceeded for the day.'); },
  } };
  const response = await post(env, { token, trade });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.detail, /KV put\(\) limit exceeded/);
});

test('resolving a trade for one token never touches another token\'s pending list', async () => {
  const env = environment();
  const otherToken = 'b'.repeat(40);
  const mine = await (await post(env, { token, trade })).json();
  await post(env, { token: otherToken, trade });

  await onRequestResolve({ env, request: new Request('https://example.com/api/pending-trades/resolve', {
    method: 'POST', body: JSON.stringify({ token, id: mine.pending.id }),
  }) });

  const others = await onRequestGet({ env, request: new Request(`https://example.com/api/pending-trades?token=${otherToken}`) });
  assert.equal((await others.json()).pending.length, 1);
});
