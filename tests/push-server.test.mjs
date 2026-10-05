import test from 'node:test';
import assert from 'node:assert/strict';
import { b64url, isAllowedEndpoint, getVapid, vapidHeader, onRequestPush, runPushRound } from '../functions/push.js';
import { parseCloses, onRequestGet as closesGet } from '../functions/closes.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';
const call = (env, path, body, method = 'POST') => onRequestPush({ request: new Request('https://x.test' + path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }), env });

test('only real browser push services are accepted as endpoints (no SSRF)', () => {
  assert.equal(isAllowedEndpoint(EP), true);
  assert.equal(isAllowedEndpoint('https://web.push.apple.com/Qabc'), true);
  assert.equal(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'), true);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'file:///etc/passwd', 'nonsense']) assert.equal(isAllowedEndpoint(bad), false, bad);
});

test('VAPID key is created once and the signed JWT verifies with the public key', async () => {
  const env = { health_kv: fakeKv() };
  const a = await getVapid(env);
  const b = await getVapid(env);
  assert.equal(a.publicKey, b.publicKey);
  const header = await vapidHeader(env, EP, Date.parse('2026-10-05T05:45:00Z'));
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, a.publicKey);
  const [h, p, sig] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.ok(claims.exp > Date.parse('2026-10-05T05:45:00Z') / 1000);
  const pub = await crypto.subtle.importKey('raw', Buffer.from(a.publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true);
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65);
});

test('subscribe stores only the endpoint; unsubscribe removes it; bad endpoints are rejected', async () => {
  const env = { health_kv: fakeKv() };
  assert.equal((await call(env, '/api/push/subscribe', { endpoint: 'https://evil.example.com/x' })).status, 400);
  assert.equal((await call(env, '/api/push/subscribe', { endpoint: EP, keys: { p256dh: 'x', auth: 'y' }, holdings: [{ symbol: '0050' }] })).status, 200);
  const stored = [...env.health_kv.m.entries()].filter(([k]) => k.startsWith('push-sub:'));
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(stored[0][1])).sort(), ['createdAt', 'endpoint'], 'nothing but the endpoint is kept');
  assert.equal((await call(env, '/api/push/unsubscribe', { endpoint: EP })).status, 200);
  assert.equal([...env.health_kv.m.keys()].filter((k) => k.startsWith('push-sub:')).length, 0);
  const key = await (await call(env, '/api/push/key', null, 'GET')).json();
  assert.equal(Buffer.from(key.publicKey, 'base64url').length, 65);
});

test('13:45 round pushes every subscriber, skips weekends and holidays, drops gone endpoints', async () => {
  const env = { health_kv: fakeKv() };
  await call(env, '/api/push/subscribe', { endpoint: EP });
  await call(env, '/api/push/subscribe', { endpoint: 'https://web.push.apple.com/gone' });
  const sent = [];
  const send = async (ep) => { sent.push(ep); return ep.includes('gone') ? { ok: false, gone: true, status: 410 } : { ok: true, status: 201 }; };
  const open = async () => false;
  const monday = (hhmm) => () => new Date(`2026-10-05T${hhmm}:00+08:00`);
  assert.deepEqual(await runPushRound(env, { now: monday('13:44'), send, marketClosed: open }), { skipped: 'not_push_minute' });
  const r = await runPushRound(env, { now: monday('13:45'), send, marketClosed: open });
  assert.deepEqual([r.sent, r.removed], [1, 1]);
  assert.equal([...env.health_kv.m.keys()].filter((k) => k.startsWith('push-sub:')).length, 1, 'gone endpoint removed');
  assert.deepEqual(await runPushRound(env, { now: () => new Date('2026-10-04T13:45:00+08:00'), send, marketClosed: open }), { skipped: 'weekend' });
  assert.deepEqual(await runPushRound(env, { now: monday('13:45'), send, marketClosed: async () => true }), { skipped: 'holiday' });
  sent.length = 0;
  await runPushRound(env, { now: monday('14:00'), force: true, send, marketClosed: open });
  assert.equal(sent.length, 1, 'the 14:00 cron forces a round');
});

test('closes endpoint parses Yahoo daily bars keyed by Taipei date and validates symbols', async () => {
  const payload = { chart: { result: [{ timestamp: [Date.parse('2026-10-01T01:00:00Z') / 1000, Date.parse('2026-10-02T01:00:00Z') / 1000, Date.parse('2026-10-03T01:00:00Z') / 1000], indicators: { quote: [{ close: [190, null, 192.5] }] } }] } };
  assert.deepEqual(parseCloses(payload), { '2026-10-01': 190, '2026-10-03': 192.5 });
  const fetchStub = async (u) => String(u).includes('0050.TW') ? new Response(JSON.stringify(payload)) : new Response('', { status: 404 });
  const r = await (await closesGet({ request: new Request('https://x.test/api/closes?symbols=0050,9999&days=30') }, { fetch: fetchStub })).json();
  assert.deepEqual(r.closes['0050'], { '2026-10-01': 190, '2026-10-03': 192.5 });
  assert.deepEqual(r.missing, ['9999']);
  assert.equal((await closesGet({ request: new Request('https://x.test/api/closes?symbols=../x') }, {})).status, 400);
  assert.equal((await closesGet({ request: new Request('https://x.test/api/closes') }, {})).status, 400);
});
