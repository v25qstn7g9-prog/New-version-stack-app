import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAssetOAuth, verifyAssetAccessToken } from '../functions/asset-mcp-oauth.js';

// Cursor（含 Cursor 上的 Grok Bot）遠端 MCP OAuth 回呼網址：只接受完全相同的網址。
const origin = 'https://assets.example';
const password = 'a-really-long-private-password';
const syncToken = 'cccccccccccccccccccccccccccccccc';
const verifier = 'a-very-long-pkce-verifier-for-cursor-tests-123456';
const CURSOR_CALLBACKS = [
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'https://www.cursor.com/bot/mcp/oauth/callback',
  'cursor://anysphere.cursor-mcp/oauth/callback',
];

function env() {
  const data = new Map();
  data.set(`portfolio-sync:${syncToken}`, JSON.stringify({ holdings: [{ symbol: '0050' }] }));
  return {
    ASSET_MCP_PASSWORD: password,
    health_kv: { get: async key => data.get(key) ?? null, put: async (key, value) => data.set(key, value) },
  };
}

const register = (e, redirects) => handleAssetOAuth(new Request(`${origin}/oauth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'Cursor', redirect_uris: redirects }),
}), e);

test('Cursor callbacks register by exact match; existing callbacks still pass', async () => {
  for (const callback of [
    ...CURSOR_CALLBACKS,
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'https://grok.com/connectors-oauth-exchange-code/',
    'https://manus.im/api/webhook/mcp/callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc_DEF-123',
    'https://www.perplexity.ai/rest/connections/oauth_callback',
  ]) {
    assert.equal((await register(env(), [callback])).status, 201, callback);
  }
  // Cursor 的動態註冊會一次送出全部回呼網址（含桌面版 loopback），整組要能通過。
  const all = await register(env(), [...CURSOR_CALLBACKS, 'http://localhost:8787/callback']);
  assert.equal(all.status, 201);
  assert.deepEqual((await all.json()).redirect_uris, [...CURSOR_CALLBACKS, 'http://localhost:8787/callback']);
  for (const callback of [
    'https://evil.example/cb',
    'https://www.cursor.com/agents/mcp/oauth/callback.evil.com',
    'https://www.cursor.com/agents/mcp/oauth/callback/x',
    'https://www.cursor.com/agents/mcp/oauth/callback?x=1',
    'https://www.cursor.com.evil.example/agents/mcp/oauth/callback',
    'https://cursor.com/agents/mcp/oauth/callback',
    'http://www.cursor.com/agents/mcp/oauth/callback',
    'https://www.cursor.com/bot/mcp/oauth/callback/x',
    'cursor://anysphere.cursor-mcp/oauth/callback/x',
    'cursor://evil/oauth/callback',
  ]) {
    const res = await register(env(), [callback]);
    assert.equal(res.status, 400, callback);
    assert.equal((await res.json()).error, 'invalid_redirect_uri');
  }
  assert.equal((await register(env(), [...CURSOR_CALLBACKS, 'https://evil.example/cb'])).status, 400);
});

test('Cursor callbacks complete authorize + PKCE token exchange, and PKCE S256 is required', async () => {
  const challenge = Buffer.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))).toString('base64url');
  for (const callback of CURSOR_CALLBACKS) {
    const e = env();
    const { client_id } = await (await register(e, [...CURSOR_CALLBACKS, 'http://localhost:8787/callback'])).json();
    const base = { response_type: 'code', client_id, redirect_uri: callback, state: 'st' };
    const authorize = (params, method = 'GET') => handleAssetOAuth(method === 'GET'
      ? new Request(`${origin}/oauth/authorize?${new URLSearchParams(params)}`)
      : new Request(`${origin}/oauth/authorize`, { method: 'POST', body: new URLSearchParams(params) }), e);
    const noPkce = await authorize(base);
    assert.equal(noPkce.status, 302);
    assert.equal(new URL(noPkce.headers.get('location')).searchParams.get('error'), 'invalid_request');
    const plain = await authorize({ ...base, code_challenge: verifier, code_challenge_method: 'plain' });
    assert.equal(new URL(plain.headers.get('location')).searchParams.get('error'), 'invalid_request');

    const ok = await authorize({ ...base, code_challenge: challenge, code_challenge_method: 'S256', password, sync_token: syncToken }, 'POST');
    assert.equal(ok.status, 302);
    const location = new URL(ok.headers.get('location'));
    assert.equal(location.href.split('?')[0], callback);
    assert.equal(location.searchParams.get('state'), 'st');
    const code = location.searchParams.get('code');
    const token = (code_verifier) => handleAssetOAuth(new Request(`${origin}/oauth/token`, {
      method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id, code, redirect_uri: callback, code_verifier }),
    }), e);
    assert.equal((await token('not-the-verifier-not-the-verifier-1234567')).status, 400);
    const exchanged = await token(verifier);
    assert.equal(exchanged.status, 200);
    assert.ok(await verifyAssetAccessToken(e, (await exchanged.json()).access_token, origin));
  }
});
