import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../worker.js';
import { holidayStatusFromRows } from '../functions/twse-holiday.js';
import { handlePreparedAssetMcp, describeSync } from '../functions/ai-connector-prepared.js';
import { onRequestGet as syncGet, onRequestPost as syncPost } from '../functions/portfolio-sync.js';

// 休市判斷、同步時間回報、同步 token header、寫入限流、健康檢查保護、OAuth 硬化，以及
// Claude 的完整 /mcp + OAuth 流程（DCR → authorize → token(PKCE) → tools/list → refresh）。

const origin = 'https://assets.example';
const password = 'a-really-long-private-password';
const toolToken = 'zinf-tool-token-abcdefghijkl';
const tokenA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const tokenB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function env(extra = {}) {
  const data = new Map();
  const puts = [];
  return {
    data, puts,
    ASSET_MCP_PASSWORD: password,
    health_kv: {
      get: async key => data.get(key) ?? null,
      put: async (key, value) => { puts.push(key); data.set(key, value); },
      delete: async key => { data.delete(key); },
    },
    ...extra,
  };
}

// holiday-schedule.js 用 caches.default；Node 沒有，給一個空的。
globalThis.caches ??= { default: { match: async () => null, put: async () => {} } };

function withHolidayFeed(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('twse') ? handler() : original(url, init);
  return fn().finally(() => { globalThis.fetch = original; });
}

const taipeiToday = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const isWeekend = () => [0, 6].includes(new Date(Date.now() + 8 * 3600e3).getUTCDay());

async function callTool(e, name, args = {}, syncToken = tokenA) {
  const res = await handlePreparedAssetMcp(new Request(`${origin}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }), e, { syncToken });
  return (await res.json()).result.structuredContent;
}

// ── 休市 ──────────────────────────────────────────────

test('TWSE 開始交易日／最後交易日 are trading days; real holidays are closed; empty feed is unknown', () => {
  const rows = [
    { Name: '中華民國開國紀念日', Date: '1150101', Description: '依規定放假1日。' },
    { Name: '國曆新年開始交易日', Date: '1150102', Description: '國曆新年開始交易。' },
    { Name: '農曆春節前最後交易日', Date: '1150211', Description: '農曆春節前最後交易日。' },
    { Name: '農曆除夕及春節', Date: '1150216', Description: '依規定放假。' },
    { Name: '農曆春節後開始交易日', Date: '1150223', Description: '農曆春節後開始交易。' },
  ];
  assert.deepEqual(holidayStatusFromRows(rows, '2026-01-02'), { closed: false, reason: null });
  assert.deepEqual(holidayStatusFromRows(rows, '2026-02-11'), { closed: false, reason: null });
  assert.deepEqual(holidayStatusFromRows(rows, '2026-02-23'), { closed: false, reason: null });
  assert.equal(holidayStatusFromRows(rows, '2026-01-01').closed, true);
  assert.equal(holidayStatusFromRows(rows, '2026-02-16').reason, '依規定放假。');
  assert.deepEqual(holidayStatusFromRows([{ Name: 'x', Date: '1150110', Description: '提到 1150102' }], '2026-01-02'), { closed: false, reason: null });
  assert.deepEqual(holidayStatusFromRows([], '2026-01-02'), { closed: null, reason: null });
  assert.deepEqual(holidayStatusFromRows(null, '2026-01-02'), { closed: null, reason: null });
});

test('today_asset_status reports market_status_unknown when the TWSE calendar cannot be fetched', async (t) => {
  if (isWeekend()) return t.skip('weekends short-circuit to market_closed');
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ syncedAt: new Date().toISOString(), dataset: { dailyRecords: [{ date: '2026-01-05', totalAsset: 100 }] } }));
  const result = await withHolidayFeed(() => new Response('down', { status: 503 }), () => callTool(e, 'today_asset_status'));
  assert.equal(result.status, 'market_status_unknown');
  assert.equal(result.marketDay, null);
  assert.match(result.message, /無法取得 TWSE 休市行事曆/);
});

test("today's 開始交易日 row does not make today a holiday", async (t) => {
  if (isWeekend()) return t.skip('weekends short-circuit to market_closed');
  const [y, m, d] = taipeiToday().split('-').map(Number);
  const roc = `${y - 1911}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ syncedAt: new Date().toISOString(), dataset: { dailyRecords: [] } }));
  const result = await withHolidayFeed(() => Response.json([{ Name: '國曆新年開始交易日', Date: roc, Description: '開始交易' }]), () => callTool(e, 'today_asset_status'));
  assert.notEqual(result.status, 'market_closed');
  assert.equal(result.marketDay, true);
});

// ── syncedAt / 新鮮度 ─────────────────────────────────

test('today_asset_status and asset_agent_brief return syncedAt and its age; stale snapshots are flagged', async () => {
  const e = env();
  const syncedAt = new Date(Date.now() - 5 * 86400e3).toISOString();
  const today = taipeiToday();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ syncedAt, dataset: { dailyRecords: [{ date: today, totalAsset: 123 }] } }));
  const status = await callTool(e, 'today_asset_status');
  assert.equal(status.status, 'recorded');
  assert.equal(status.sync.syncedAt, syncedAt);
  assert.ok(status.sync.syncAgeMinutes >= 5 * 1440 - 1);
  assert.equal(status.sync.stale, true);
  assert.match(status.message, /可能不是最新持股/);
  const brief = await callTool(e, 'asset_agent_brief', { includeLive: false });
  assert.equal(brief.sync.syncedAt, syncedAt);
  assert.match(brief.attention.join(' '), /資產同步快照最後更新在約 5 天前/);
});

test('describeSync handles fresh, missing and legacy (no syncedAt) snapshots', () => {
  const now = new Date('2026-09-30T08:00:00Z');
  assert.deepEqual(describeSync({ found: true, summary: { syncedAt: '2026-09-30T07:30:00Z' } }, now), { found: true, syncedAt: '2026-09-30T07:30:00Z', syncAgeMinutes: 30, stale: false, reason: null });
  assert.deepEqual(describeSync({ found: true, summary: {} }, now), { found: true, syncedAt: null, syncAgeMinutes: null, stale: null, reason: null });
  assert.deepEqual(describeSync({ found: false, reason: 'expired', lastSyncedAt: '2026-09-01T00:00:00Z' }, now).reason, 'expired');
});

// ── portfolio-sync：header token、原因、meta ────────────

const post = (e, { token, header = true, summary = { holdings: [] } } = {}) => syncPost({ env: e, request: new Request(`${origin}/api/portfolio-sync`, {
  method: 'POST',
  headers: header ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
  body: JSON.stringify(header ? { summary } : { token, summary }),
}) });
const get = (e, token, { query = false } = {}) => syncGet({ env: e, request: new Request(`${origin}/api/portfolio-sync${query ? `?token=${token}` : ''}`, query ? {} : { headers: { authorization: `Bearer ${token}` } }) }).then(r => r.json());

test('sync token is accepted in the Authorization header; old body/query forms keep working', async () => {
  const e = env();
  assert.equal((await post(e, { token: tokenA })).status, 200);
  assert.equal((await get(e, tokenA)).found, true);
  assert.equal((await post(e, { token: tokenB, header: false })).status, 200, 'old app versions put the token in the body');
  assert.equal((await get(e, tokenB, { query: true })).found, true, 'old ?token= readers still work');
});

test('missing snapshots say why: never_synced, token_mismatch, expired (with lastSyncedAt)', async () => {
  const e = env();
  assert.equal((await get(e, tokenA)).reason, 'never_synced');
  await post(e, { token: tokenB });
  const mismatch = await get(e, tokenA);
  assert.equal(mismatch.found, false);
  assert.equal(mismatch.reason, 'token_mismatch');
  // 快照 14 天後被 KV 清掉，meta 還在 → expired。
  e.data.delete(`portfolio-sync:${tokenB}`);
  const expired = await get(e, tokenB);
  assert.equal(expired.reason, 'expired');
  assert.ok(Date.parse(expired.lastSyncedAt));
  // 找得到時回應格式跟以前一樣。
  await post(e, { token: tokenA });
  const found = await get(e, tokenA);
  assert.deepEqual(Object.keys(found).sort(), ['found', 'ok', 'summary']);
});

test('the non-expiring meta record is written at most every 6 hours (KV write budget)', async () => {
  const e = env();
  await post(e, { token: tokenA });
  await post(e, { token: tokenA });
  await post(e, { token: tokenA });
  const count = (k) => e.puts.filter(p => p === k).length;
  assert.equal(count(`portfolio-sync:${tokenA}`), 3);
  assert.equal(count(`portfolio-sync-meta:${tokenA}`), 1);
  assert.equal(count('portfolio-sync-last-writer'), 1);
  assert.equal(JSON.stringify([...e.data.values()]).includes(tokenA), false, 'the token itself is never stored as a value');
});

// ── worker 路由保護 ─────────────────────────────────────

const call = (e, path, init = {}) => worker.fetch(new Request(`${origin}${path}`, init), e, { waitUntil() {} });

test('/api/health-check (triggers an AI call) needs the admin token; /api/health-cards GET stays public', async () => {
  const e = env({ ZINF_TOOL_TOKEN: toolToken });
  assert.equal((await call(e, '/api/health-check')).status, 401);
  assert.equal((await call(e, '/api/health-check', { headers: { authorization: 'Bearer wrong-token-1234567890' } })).status, 401);
  assert.equal((await call(e, '/api/health-check', { headers: { authorization: `Bearer ${toolToken}` } })).status, 200);
  assert.equal((await call(e, '/api/health-check', { headers: { authorization: `Bearer ${password}` } })).status, 200);
  assert.equal((await call(e, '/api/health-cards')).status, 200);
});

test('dismissing health cards needs a sync token that has uploaded before (or the admin token)', async () => {
  const e = env();
  e.data.set('health:cards', JSON.stringify([{ id: 'hc_1', status: 'pending', summary: 'x' }]));
  const dismiss = (auth) => call(e, '/api/health-cards', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify({ id: 'hc_1', action: 'dismiss' }) });
  assert.equal((await dismiss()).status, 401);
  assert.equal((await dismiss(tokenA)).status, 401, 'a well-formed but never-synced token is not enough');
  await post(e, { token: tokenA });
  assert.equal((await dismiss(tokenA)).status, 200);
});

test('writes are rate-limited by IP when WRITE_RATE_LIMITER is bound; a broken limiter lets writes through', async () => {
  const limited = env({ WRITE_RATE_LIMITER: { limit: async () => ({ success: false }) } });
  const res = await call(limited, '/api/portfolio-sync', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ summary: {} }) });
  assert.equal(res.status, 429);
  const broken = env({ WRITE_RATE_LIMITER: { limit: async () => { throw new Error('down'); } } });
  const ok = await call(broken, '/api/portfolio-sync', { method: 'POST', headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' }, body: JSON.stringify({ summary: {} }) });
  assert.equal(ok.status, 200);
  const reads = await call(limited, '/api/portfolio-sync', { headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(reads.status, 200, 'reads are never limited');
});

// ── Claude 的 /mcp + OAuth 完整流程（經過 worker.fetch）──────────

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const verifier = 'a-very-long-pkce-verifier-for-tests-1234567890';
const form = (data, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(data).toString() });

async function challenge() {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return Buffer.from(bytes).toString('base64url');
}

async function claudeLogin(e, loginPassword = password, headers = {}) {
  const reg = await call(e, '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' }) });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();
  const params = { response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: await challenge(), code_challenge_method: 'S256', state: 'xyz' };
  const page = await call(e, `/oauth/authorize?${new URLSearchParams(params)}`);
  assert.equal(page.status, 200);
  const authorized = await call(e, '/oauth/authorize', form({ ...params, password: loginPassword, sync_token: tokenA }, headers));
  if (authorized.status !== 302) return { authorized, client_id, params };
  const location = new URL(authorized.headers.get('location'));
  assert.equal(location.origin + location.pathname, CALLBACK);
  assert.equal(location.searchParams.get('state'), 'xyz');
  const tokenRes = await call(e, '/oauth/token', form({ grant_type: 'authorization_code', code: location.searchParams.get('code'), redirect_uri: CALLBACK, client_id, code_verifier: verifier }));
  assert.equal(tokenRes.status, 200);
  return { client_id, params, ...(await tokenRes.json()) };
}

const toolsList = (e, token) => call(e, '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });

test('Claude flow through worker.fetch: metadata → DCR → authorize → token → /mcp tools/list → refresh', async () => {
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ holdings: [] }));
  const unauth = await call(e, '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata="https:\/\/assets\.example\/\.well-known\/oauth-protected-resource"/);
  const prm = await (await call(e, '/.well-known/oauth-protected-resource')).json();
  assert.deepEqual(prm.authorization_servers, [origin]);
  const asm = await (await call(e, '/.well-known/oauth-authorization-server')).json();
  assert.equal(asm.registration_endpoint, `${origin}/oauth/register`);

  const login = await claudeLogin(e);
  assert.equal(login.token_type, 'Bearer');
  const list = await toolsList(e, login.access_token);
  assert.equal(list.status, 200);
  const names = (await list.json()).result.tools.map(t => t.name);
  for (const name of ['asset_summary', 'asset_agent_brief', 'today_asset_status', 'portfolio_live_snapshot', 'stock_quote', 'pending_trades']) assert.ok(names.includes(name), name);

  const refreshed = await call(e, '/oauth/token', form({ grant_type: 'refresh_token', refresh_token: login.refresh_token, client_id: login.client_id }));
  assert.equal(refreshed.status, 200);
  assert.equal((await toolsList(e, (await refreshed.json()).access_token)).status, 200);
});

test('/oauth/authorize locks an IP after 10 wrong passwords; other IPs and Claude logins are unaffected', async () => {
  const e = env();
  e.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ holdings: [] }));
  const ip = { 'cf-connecting-ip': '203.0.113.5' };
  const first = await claudeLogin(e, 'wrong-password-000000', ip);
  assert.equal(first.authorized.status, 401);
  for (let i = 1; i < 10; i++) {
    const r = await call(e, '/oauth/authorize', form({ ...first.params, password: `wrong-password-${i}xxxxx`, sync_token: tokenA }, ip));
    assert.equal(r.status, 401);
  }
  const blocked = await call(e, '/oauth/authorize', form({ ...first.params, password, sync_token: tokenA }, ip));
  assert.equal(blocked.status, 429);
  const other = await claudeLogin(e, password, { 'cf-connecting-ip': '198.51.100.9' });
  assert.ok(other.access_token);
});

test('setting ASSET_MCP_PASSWORD later keeps Claude tokens signed with ZINF_TOOL_TOKEN working', async () => {
  const before = env({ ASSET_MCP_PASSWORD: undefined, ZINF_TOOL_TOKEN: toolToken });
  before.data.set(`portfolio-sync:${tokenA}`, JSON.stringify({ holdings: [] }));
  const old = await claudeLogin(before, toolToken);
  const after = { ...before, ASSET_MCP_PASSWORD: password };
  assert.equal((await toolsList(after, old.access_token)).status, 200);
  const refreshed = await call(after, '/oauth/token', form({ grant_type: 'refresh_token', refresh_token: old.refresh_token, client_id: old.client_id }));
  assert.equal(refreshed.status, 200);
  const strict = { ...after, OAUTH_ACCEPT_LEGACY_SIGNING_KEY: 'false' };
  assert.equal((await toolsList(strict, (await refreshed.json()).access_token)).status, 200);
  assert.equal((await toolsList(strict, old.access_token)).status, 401);
});

// ── 前端：資料沒變就不重傳 ─────────────────────────────

test('client skips an upload only when the content hash is unchanged and the last upload is < 6h old', async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const pick = (name) => html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}\\n`))[0];
  const ctx = { Date, Number, String, TextEncoder, crypto: globalThis.crypto, globalThis: {}, Array };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`const ZINF_SYNC_HEARTBEAT_MS = 6 * 60 * 60 * 1000;\n${pick('zinfSyncHash')}\n${pick('zinfShouldSkipUpload')}`, ctx);
  const h1 = await ctx.zinfSyncHash('token\n{"summary":1}');
  const h2 = await ctx.zinfSyncHash('token\n{"summary":2}');
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, h2);
  const now = Date.parse('2026-09-30T08:00:00Z');
  assert.equal(ctx.zinfShouldSkipUpload({ hash: h1, lastHash: h1, lastOkAt: '2026-09-30T07:00:00Z', now }), true);
  assert.equal(ctx.zinfShouldSkipUpload({ hash: h2, lastHash: h1, lastOkAt: '2026-09-30T07:00:00Z', now }), false);
  assert.equal(ctx.zinfShouldSkipUpload({ hash: h1, lastHash: h1, lastOkAt: '2026-09-30T01:00:00Z', now }), false, 'heartbeat after 6h');
  assert.equal(ctx.zinfShouldSkipUpload({ hash: null, lastHash: null, lastOkAt: null, now }), false);
  assert.match(html, /authorization: "Bearer " \+ syncToken/);
  assert.doesNotMatch(html, /portfolio-sync\?token=/);
});
