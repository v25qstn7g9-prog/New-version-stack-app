import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, pickGeminiKey } from '../functions/ask.js';

// Owner (the sync token) uses the paid GEMINI_API_KEY; everyone else uses GEMINI_API_KEY_FREE when it is set.
const OWNER = 'owner-sync-token-abcdefghijklmnop';

test('pickGeminiKey: owner always gets the paid key; others get the free key only when it is set', () => {
  const both = { GEMINI_API_KEY: 'paid', GEMINI_API_KEY_FREE: 'free' };
  assert.equal(pickGeminiKey(both, true).key, 'paid');
  assert.equal(pickGeminiKey(both, undefined).key, 'paid');   // callers that do not say who is asking keep the old behaviour
  assert.equal(pickGeminiKey(both, false).key, 'free');
  assert.equal(pickGeminiKey({ GEMINI_API_KEY: 'paid' }, false).key, 'paid'); // no free key configured: unchanged
  assert.equal(pickGeminiKey({ GEMINI_API_KEY_FREE: 'free' }, true).key, '');  // owner never silently falls onto the free key
});

let n = 0; // 每次問不同的問題，避免命中回答快取而沒打到 Gemini
async function askAs(headers, env) {
  const original = globalThis.fetch;
  const used = [];
  globalThis.fetch = async (url, init) => {
    used.push(init.headers['x-goog-api-key']);
    return Response.json({ candidates: [{ content: { parts: [{ text: 'backup answer' }] } }] });
  };
  try {
    const res = await onRequestPost({
      env: { AI: { run: async () => { throw new Error('503 unavailable'); } }, LINE_REMINDER_SYNC_TOKEN: OWNER, GEMINI_API_KEY: 'PAID-KEY', GEMINI_API_KEY_FREE: 'FREE-KEY', ...env },
      request: new Request('https://app/ask', { method: 'POST', headers, body: JSON.stringify({ message: 'hello ' + (++n), context: '' }) }),
    });
    return { body: await res.json(), used };
  } finally { globalThis.fetch = original; }
}

test('the owner request is sent to Gemini with the paid key', async () => {
  const { body, used } = await askAs({ authorization: 'Bearer ' + OWNER });
  assert.match(body.provider, /gemini/i);
  assert.deepEqual(used, ['PAID-KEY']);
});

test('a family member (no owner token) is sent to Gemini with the free key', async () => {
  const { body, used } = await askAs({});
  assert.match(body.provider, /gemini/i);
  assert.deepEqual(used, ['FREE-KEY']);
});

test('a wrong bearer token is not the owner', async () => {
  const { used } = await askAs({ authorization: 'Bearer something-else-entirely-0123456789' });
  assert.deepEqual(used, ['FREE-KEY']);
});

test('without GEMINI_API_KEY_FREE nothing changes: everyone uses GEMINI_API_KEY', async () => {
  const { used } = await askAs({}, { GEMINI_API_KEY_FREE: '' });
  assert.deepEqual(used, ['PAID-KEY']);
});
