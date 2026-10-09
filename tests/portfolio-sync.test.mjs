import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/portfolio-sync.js';

const token = 'a'.repeat(40);
function environment() {
  const records = new Map();
  return { health_kv: {
    get: async key => records.get(key) || null,
    put: async (key, value) => { records.set(key, value); },
  } };
}

test('full history is available to an authorized LINE client, not to anonymous callers', async () => {
  const env = environment();
  const summary = { dataset: { trades: [{ date: '2026-09-21', symbol: '0050', shares: 10 }] } };
  const post = await onRequestPost({ env, request: new Request('https://example.com/api/portfolio-sync', {
    method: 'POST', body: JSON.stringify({ token, summary }),
  }) });
  assert.equal(post.status, 200);
  const privateRequest = new Request('https://example.com/api/portfolio-sync', {
    headers: { authorization: `Bearer ${token}` },
  });
  const result = await onRequestGet({ env, request: privateRequest });
  assert.equal((await result.json()).summary.dataset.trades[0].shares, 10);
  const denied = await onRequestGet({ env, request: new Request('https://example.com/api/portfolio-sync') });
  assert.equal(denied.status, 400);
});

test('oversized snapshots are refused before they reach KV', async () => {
  const env = environment();
  const response = await onRequestPost({ env, request: new Request('https://example.com/api/portfolio-sync', {
    method: 'POST', body: JSON.stringify({ token, summary: { text: '大'.repeat(400000) } }),
  }) });
  assert.equal(response.status, 413);
});

test('a KV write failure (e.g. daily quota exceeded) surfaces the real reason, not a bare 500', async () => {
  const env = { health_kv: {
    get: async () => null,
    put: async () => { throw new Error('KV put() limit exceeded for the day.'); },
  } };
  const response = await onRequestPost({ env, request: new Request('https://example.com/api/portfolio-sync', {
    method: 'POST', body: JSON.stringify({ token, summary: { dataset: {} } }),
  }) });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.detail, /KV put\(\) limit exceeded/);
});

test('a KV read failure surfaces the real reason too', async () => {
  const env = { health_kv: {
    get: async () => { throw new Error('KV get() failed: boom'); },
  } };
  const response = await onRequestGet({ env, request: new Request('https://example.com/api/portfolio-sync', {
    headers: { authorization: `Bearer ${token}` },
  }) });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.detail, /boom/);
});

// ── SI Hub 唯讀金鑰 ──
import { onRequestGet as roGet, onRequestPost as roPost } from '../functions/portfolio-sync.js';
{
  const roEnv = (extra = {}) => { const d = new Map(); return { data: d, health_kv: { get: async k => d.get(k) ?? null, put: async (k, v) => { d.set(k, v); } }, ...extra }; };
  const owner = 'owner-sync-token-abcdefghijkl', ro = 'si-hub-read-token-abcdefghijklmn';
  const post = (env, token, summary = { holdings: [{ symbol: '0050' }] }) => roPost({ env, request: new Request('https://x/api/portfolio-sync', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify({ summary }) }) });
  const get = (env, token) => roGet({ env, request: new Request('https://x/api/portfolio-sync', { headers: { authorization: 'Bearer ' + token } }) });

  test('SI_HUB_READ_TOKEN reads the latest snapshot even after the sync token changes', async () => {
    const env = roEnv({ SI_HUB_READ_TOKEN: ro });
    assert.equal((await (await get(env, ro)).json()).reason, 'awaiting_first_sync');
    assert.equal((await post(env, owner)).status, 200);
    let data = await (await get(env, ro)).json();
    assert.equal(data.found, true);
    assert.equal(data.summary.holdings[0].symbol, '0050');
    const newOwner = 'rotated-sync-token-abcdefghijk';
    assert.equal((await post(env, newOwner, { holdings: [{ symbol: '2330' }] })).status, 200);
    data = await (await get(env, ro)).json();
    assert.equal(data.summary.holdings[0].symbol, '2330');
  });

  test('the read-only key cannot write and cannot read previous versions; without the secret nothing extra is stored', async () => {
    const env = roEnv({ SI_HUB_READ_TOKEN: ro });
    assert.equal((await post(env, ro)).status, 403);
    assert.equal(env.data.has('portfolio-sync:' + ro), false);
    await post(env, owner);
    const prev = await roGet({ env, request: new Request('https://x/api/portfolio-sync?prev=1', { headers: { authorization: 'Bearer ' + ro } }) });
    assert.equal((await prev.json()).found, false);
    const plain = roEnv();
    await post(plain, owner);
    assert.equal(plain.data.has('portfolio-sync-latest'), false);
    assert.equal((await (await get(plain, ro)).json()).found, false);
  });

  test('a wrong key does not see the latest snapshot', async () => {
    const env = roEnv({ SI_HUB_READ_TOKEN: ro });
    await post(env, owner);
    assert.equal((await (await get(env, 'wrong-token-abcdefghijklmnop')).json()).found, false);
  });
}
