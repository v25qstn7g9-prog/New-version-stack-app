import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/portfolio-sync.js';

test('sync refuses to overwrite when the existing snapshot cannot be read', async () => {
  const original = JSON.stringify({ holdings: [{ symbol: '0050', shares: 1000 }], dataset: { trades: [], dailyRecords: [] } });
  const data = new Map([['portfolio-sync:acceptance_test_token', original]]);
  const env = { health_kv: {
    get: async key => { if (key.startsWith('portfolio-sync:')) throw new Error('KV unavailable'); return data.get(key) || null; },
    put: async (key, value) => data.set(key, value),
  } };
  const response = await onRequestPost({ env, request: new Request('https://test/api/portfolio-sync', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer acceptance_test_token' },
    body: JSON.stringify({ summary: { holdings: [], dataset: { trades: [], dailyRecords: [] } } }),
  }) });
  assert.equal(response.status, 503);
  assert.equal(data.get('portfolio-sync:acceptance_test_token'), original);
});

test('sync refuses malformed or non-object stored snapshots without any writes', async () => {
  for (const raw of ['{broken', 'null', '[]', '42', '"text"', '']) {
    let writes = 0;
    const env = { health_kv: { get: async () => raw, put: async () => { writes++; } } };
    const response = await onRequestPost({ env, request: new Request('https://test/api/portfolio-sync', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer acceptance_test_token' },
      body: JSON.stringify({ summary: { holdings: [], dataset: { trades: [], dailyRecords: [] } } }),
    }) });
    assert.equal(response.status, 503, raw);
    assert.equal(writes, 0, raw);
  }
});
