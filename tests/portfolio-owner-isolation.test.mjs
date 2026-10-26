import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, onRequestPost } from '../functions/portfolio-sync.js';

const owner = 'owner-sync-token-abcdefghijkl';
const attacker = 'attacker-sync-token-abcdefghijkl';
const reader = 'si-hub-read-token-abcdefghijkl';
function environment(extra = {}) {
  const records = new Map();
  return { records, SI_HUB_READ_TOKEN: reader, LINE_REMINDER_SYNC_TOKEN: owner,
    health_kv: { get: async key => records.get(key) ?? null, put: async (key, value) => records.set(key, value) }, ...extra };
}
const post = (env, token, symbol) => onRequestPost({ env, request: new Request('https://app/api/portfolio-sync', {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ summary: { holdings: [{ symbol }] } }),
}) });
const get = (env, token = reader) => onRequestGet({ env, request: new Request('https://app/api/portfolio-sync', {
  headers: { authorization: `Bearer ${token}` },
}) });

test('an arbitrary sync token remains isolated and cannot poison the owner feed', async () => {
  const env = environment();
  assert.equal((await post(env, owner, '0050')).status, 200);
  assert.equal((await post(env, attacker, 'ATTACK')).status, 200);
  assert.equal((await (await get(env)).json()).summary.holdings[0].symbol, '0050');
  assert.equal((await (await get(env, attacker)).json()).summary.holdings[0].symbol, 'ATTACK');
  assert.equal(env.records.has('portfolio-sync-latest'), false);
  assert.equal((await post(env, owner, '2330')).status, 200);
  assert.equal((await (await get(env)).json()).summary.holdings[0].symbol, '2330');
});

test('existing owner snapshots are readable immediately and poisoned legacy latest is ignored', async () => {
  const env = environment();
  env.records.set('portfolio-sync:' + owner, JSON.stringify({ holdings: [{ symbol: '0050' }] }));
  env.records.set('portfolio-sync-latest', JSON.stringify({ holdings: [{ symbol: 'ATTACK' }] }));
  assert.equal((await (await get(env)).json()).summary.holdings[0].symbol, '0050');
});

test('missing owner configuration fails closed without breaking independent sync', async () => {
  const env = environment({ LINE_REMINDER_SYNC_TOKEN: undefined });
  env.records.set('portfolio-sync-latest', JSON.stringify({ holdings: [{ symbol: 'ATTACK' }] }));
  assert.equal((await post(env, attacker, 'SELF')).status, 200);
  const response = await get(env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'owner_sync_token_not_configured');
  assert.equal((await (await get(env, attacker)).json()).summary.holdings[0].symbol, 'SELF');
});

test('read-only key cannot register itself as a writer', async () => {
  const env = environment();
  assert.equal((await post(env, reader, 'ATTACK')).status, 403);
  assert.equal(env.records.size, 0);
});
