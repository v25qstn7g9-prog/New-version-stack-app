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
