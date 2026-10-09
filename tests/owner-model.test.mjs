import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as ask, normalizeModelName } from '../functions/ask.js';
import { onRequestGet, onRequestPost } from '../functions/owner-model.js';

const OWNER = 'owner-sync-token-abcdefghijklmnop';
function kv() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, m };
}
const mk = (method, token, body) => new Request('https://app/api/owner-model', {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('normalizeModelName only accepts simple gemini- names', () => {
  assert.equal(normalizeModelName(' gemini-3.8-flash '), 'gemini-3.8-flash');
  assert.equal(normalizeModelName('gemini-3.6-flash/../x'), '');
  assert.equal(normalizeModelName('gpt-5'), '');
  assert.equal(normalizeModelName(''), '');
});

test('/api/owner-model rejects non-owners for GET and POST', async () => {
  const env = { LINE_REMINDER_SYNC_TOKEN: OWNER, health_kv: kv() };
  assert.equal((await onRequestGet({ request: mk('GET'), env })).status, 403);
  assert.equal((await onRequestGet({ request: mk('GET', 'wrong-token-0123456789abcdef'), env })).status, 403);
  assert.equal((await onRequestPost({ request: mk('POST', null, { model: 'gemini-9' }), env })).status, 403);
  assert.equal(env.health_kv.m.size, 0);
  assert.equal((await onRequestGet({ request: mk('GET', OWNER), env: { health_kv: kv() } })).status, 403); // owner secret not configured
});

test('owner can set, read, reject bad names and clear', async () => {
  const env = { LINE_REMINDER_SYNC_TOKEN: OWNER, health_kv: kv(), GEMINI_MODEL: 'gemini-3.6-flash' };
  let r = await onRequestPost({ request: mk('POST', OWNER, { model: 'gemini-3.8-flash' }), env });
  assert.equal((await r.json()).model, 'gemini-3.8-flash');
  r = await onRequestGet({ request: mk('GET', OWNER), env });
  const got = await r.json();
  assert.equal(got.model, 'gemini-3.8-flash'); assert.equal(got.defaultModel, 'gemini-3.6-flash');
  assert.equal((await onRequestPost({ request: mk('POST', OWNER, { model: 'bad name!' }), env })).status, 400);
  assert.equal((await (await onRequestGet({ request: mk('GET', OWNER), env })).json()).model, 'gemini-3.8-flash');
  await onRequestPost({ request: mk('POST', OWNER, { model: '' }), env });
  assert.equal((await (await onRequestGet({ request: mk('GET', OWNER), env })).json()).model, '');
});

let n = 0;
async function askAs(headers, env, status = 200) {
  const original = globalThis.fetch; const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (status !== 200 && urls.length === 1) return Response.json({ error: { message: 'model not found' } }, { status });
    return Response.json({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  };
  try {
    const res = await ask({
      env: { AI: { run: async () => { throw new Error('503 unavailable'); } }, LINE_REMINDER_SYNC_TOKEN: OWNER, GEMINI_API_KEY: 'PAID', GEMINI_API_KEY_FREE: 'FREE', GEMINI_MODEL: 'gemini-3.6-flash', ...env },
      request: new Request('https://app/ask', { method: 'POST', headers, body: JSON.stringify({ message: 'owner model ' + (++n), context: '' }) }),
    });
    return { body: await res.json(), urls };
  } finally { globalThis.fetch = original; }
}
const modelOf = (u) => u.match(/models\/([^:]+):/)[1];

test('owner asks use the saved model; family keep the default', async () => {
  const health_kv = kv(); await health_kv.put('ask-owner-model', 'gemini-3.8-flash');
  const o = await askAs({ authorization: 'Bearer ' + OWNER }, { health_kv });
  assert.deepEqual(o.urls.map(modelOf), ['gemini-3.8-flash']);
  const f = await askAs({}, { health_kv });
  assert.deepEqual(f.urls.map(modelOf), ['gemini-3.6-flash']);
});

test('a wrong saved model falls back to the default once for the owner', async () => {
  const health_kv = kv(); await health_kv.put('ask-owner-model', 'gemini-9.9-nope');
  const o = await askAs({ authorization: 'Bearer ' + OWNER }, { health_kv }, 404);
  assert.deepEqual(o.urls.map(modelOf), ['gemini-9.9-nope', 'gemini-3.6-flash']);
  assert.match(o.body.provider, /gemini/i);
});

test('no saved model leaves the owner on the default', async () => {
  const o = await askAs({ authorization: 'Bearer ' + OWNER }, { health_kv: kv() });
  assert.deepEqual(o.urls.map(modelOf), ['gemini-3.6-flash']);
});
