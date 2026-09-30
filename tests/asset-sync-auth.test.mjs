import assert from 'node:assert/strict';
import test from 'node:test';
import * as oauth from '../functions/asset-mcp-oauth.js';
import worker from '../worker.js';
import { handlePreparedAssetMcp } from '../functions/ai-connector-prepared.js';
const { handleAssetOAuth, verifyAssetAccessToken } = oauth;

const origin = 'https://assets.example';
const password = 'a-really-long-private-password';
const tokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const verifier = 'a-very-long-pkce-verifier-for-tests-1234567890';

function env() {
  const data = new Map();
  return {
    data,
    ASSET_MCP_PASSWORD: password,
    health_kv: {
      get: async key => data.get(key) ?? null,
      put: async (key, value) => data.set(key, value),
    },
  };
}

async function connect(environment, syncToken, redirect) {
  const registration = await handleAssetOAuth(new Request(`${origin}/oauth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: redirect, redirect_uris: [redirect] }),
  }), environment);
  assert.equal(registration.status, 201);
  const { client_id } = await registration.json();
  const challengeBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = Buffer.from(challengeBytes).toString('base64url');
  const auth = new URLSearchParams({
    response_type: 'code', client_id, redirect_uri: redirect,
    code_challenge: challenge, code_challenge_method: 'S256',
    password, sync_token: syncToken,
  });
  const authorized = await handleAssetOAuth(new Request(`${origin}/oauth/authorize`, {
    method: 'POST', body: auth,
  }), environment);
  if (authorized.status !== 302) return { authorized };
  const code = new URL(authorized.headers.get('location')).searchParams.get('code');
  const exchanged = await handleAssetOAuth(new Request(`${origin}/oauth/token`, {
    method: 'POST', body: new URLSearchParams({
      grant_type: 'authorization_code', client_id, code,
      redirect_uri: redirect, code_verifier: verifier,
    }),
  }), environment);
  assert.equal(exchanged.status, 200);
  const { access_token } = await exchanged.json();
  const access = await verifyAssetAccessToken(environment, access_token, origin);
  assert.ok(access);
  return { access, access_token, client_id };
}

test('two OAuth clients keep their own synchronized portfolios', async () => {
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ holdings: [{ symbol: '0050' }] }));
  e.data.set(`portfolio-sync:${tokenB}`, JSON.stringify({ holdings: [{ symbol: '0056' }] }));
  const a = await connect(e, tokenA, 'https://claude.ai/api/mcp/auth_callback');
  const b = await connect(e, tokenB, 'https://grok.com/connectors-oauth-exchange-code/');
  assert.notEqual(a.access.cid, b.access.cid);
  assert.equal(await oauth.readAssetMcpSyncToken(e, a.access), tokenA);
  assert.equal(await oauth.readAssetMcpSyncToken(e, b.access), tokenB);
});

test('a syntactically valid token with no snapshot is rejected at login', async () => {
  const e = env();
  const result = await connect(e, tokenA, 'https://grok.com/connectors-oauth-exchange-code/');
  assert.equal(result.authorized.status, 401);
  assert.match(await result.authorized.text(), /尚無同步快照/);
  assert.equal(e.data.size, 0);
});

test('old access tokens retain their one-hour legacy lookup without leaking it to new clients', async () => {
  const e = env();
  e.data.set('zinf:asset-mcp-sync-token', tokenA);
  assert.equal(await oauth.readAssetMcpSyncToken(e, {}), tokenA);
  assert.equal(await oauth.readAssetMcpSyncToken(e, { cid: 'new-client-with-no-snapshot' }), '');
});

test('the MCP route reads each client portfolio without sharing another client token', async () => {
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ holdings: [{ symbol: '0050' }] }));
  e.data.set(`portfolio-sync:${tokenB}`, JSON.stringify({ holdings: [{ symbol: '0056' }] }));
  const a = await connect(e, tokenA, 'https://claude.ai/api/mcp/auth_callback');
  const b = await connect(e, tokenB, 'https://grok.com/connectors-oauth-exchange-code/');
  const read = async accessToken => {
    const res = await worker.fetch(new Request(`${origin}/mcp`, {
      method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'asset_summary', arguments: {} } }),
    }), e);
    assert.equal(res.status, 200);
    return (await res.json()).result.structuredContent.summary.holdings[0].symbol;
  };
  assert.equal(await read(a.access_token), '0050');
  assert.equal(await read(b.access_token), '0056');
});

test('an old refresh token keeps the legacy portfolio until that client reconnects', async () => {
  const e = env();
  e.data.set(`portfolio-sync:${tokenB}`, JSON.stringify({ holdings: [{ symbol: '0056' }] }));
  e.data.set('zinf:asset-mcp-sync-token', tokenA);
  const connected = await connect(e, tokenB, 'https://grok.com/connectors-oauth-exchange-code/');
  const cid = connected.client_id.slice(-43);
  const key0 = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', key0, new TextEncoder().encode('zinf-assets-mcp-oauth-v1'));
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = Buffer.from(JSON.stringify({ typ: 'refresh', cid, exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url');
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64url');
  const response = await handleAssetOAuth(new Request(`${origin}/oauth/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: connected.client_id, refresh_token: `${body}.${mac}` }),
  }), e);
  assert.equal(response.status, 200);
  const { access_token } = await response.json();
  const access = await verifyAssetAccessToken(e, access_token, origin);
  assert.equal(await oauth.readAssetMcpSyncToken(e, access), tokenA);
});

test('missing sync snapshot is reported as a source failure, not a missing daily record', async () => {
  const e = env();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ rows: [] });
  try {
    const response = await handlePreparedAssetMcp(new Request(`${origin}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'today_asset_status', arguments: {} } }),
    }), e, { syncToken: tokenA });
    const result = (await response.json()).result.structuredContent;
    assert.equal(result.status, 'snapshot_unavailable');
    assert.equal(result.hasTodayRecord, null);
    assert.match(result.message, /自動同步/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('the agent brief names automatic recovery when the snapshot is unavailable', async () => {
  const e = env();
  const response = await handlePreparedAssetMcp(new Request(`${origin}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'asset_agent_brief', arguments: {} } }),
  }), e, { syncToken: tokenA });
  const brief = (await response.json()).result.structuredContent;
  assert.equal(brief.today.status, 'snapshot_unavailable');
  assert.equal(brief.today.hasTodayRecord, null);
  assert.match(brief.nextActions.join(' '), /自動同步/);
  assert.equal(brief.live, null);
});
