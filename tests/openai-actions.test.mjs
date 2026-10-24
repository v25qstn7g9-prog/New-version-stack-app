import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOpenAiActions } from '../functions/openai-actions.js';

const call = (path, { method = 'POST', key, body, env = { OPENAI_ACTION_KEY: 'k-test', SI_HUB_READ_TOKEN: 'r'.repeat(32) } } = {}) =>
  handleOpenAiActions(new Request('https://app.example' + path, { method, headers: { ...(key ? { 'x-api-key': key } : {}), 'content-type': 'application/json' }, body }), env);

test('非 /openai 路徑不處理', async () => {
  assert.equal(await call('/mcp'), null);
});

test('OpenAPI 列出資產工具並宣告 x-api-key', async () => {
  const res = await call('/openai/openapi.json', { method: 'GET' });
  assert.equal(res.status, 200);
  const spec = await res.json();
  assert.ok(spec.paths['/openai/tools/asset_agent_brief']);
  assert.equal(spec.components.securitySchemes.ApiKeyAuth.name, 'x-api-key');
});

test('沒設金鑰 503、金鑰錯誤 401、未知工具 404、GET 405', async () => {
  assert.equal((await call('/openai/tools/asset_summary', { key: 'k-test', env: {} })).status, 503);
  assert.equal((await call('/openai/tools/asset_summary')).status, 401);
  assert.equal((await call('/openai/tools/asset_summary', { key: 'wrong' })).status, 401);
  assert.equal((await call('/openai/tools/nope', { key: 'k-test', body: '{}' })).status, 404);
  assert.equal((await call('/openai/tools/asset_summary', { method: 'GET' })).status, 405);
});

test('過大的工具參數直接拒絕，不讀進資產', async () => {
  const res = await call('/openai/tools/asset_summary', {
    key: 'k-test',
    body: 'x'.repeat(64 * 1024 + 1),
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error, 'Request too large');
});

test('沒有唯讀同步金鑰時回 503，不去讀資產', async () => {
  const res = await call('/openai/tools/asset_summary', { key: 'k-test', body: '{}', env: { OPENAI_ACTION_KEY: 'k-test' } });
  assert.equal(res.status, 503);
});

test('訓練 App 產生的外部 AI 金鑰（atl_）：要打開讀資產才可以；驗證走 ATLAS binding', async () => {
  const atlas = (scope) => ({ fetch: async (req) => {
    const { key } = await req.json();
    return key === 'atl_goodgoodgoodgoodgood' ? Response.json({ ok: true, scope, name: 'Cue' }) : Response.json({ ok: false }, { status: 401 });
  } });
  const env = (scope) => ({ ATLAS: atlas(scope) });   // 沒有 OPENAI_ACTION_KEY 也可以用 atl_ 金鑰
  assert.equal((await call('/openai/tools/asset_summary', { key: 'atl_badbadbadbadbadbad', body: '{}', env: env('all-read') })).status, 401);
  const blocked = await call('/openai/tools/asset_summary', { key: 'atl_goodgoodgoodgoodgood', body: '{}', env: env('training-read') });
  assert.equal(blocked.status, 403);
  assert.match((await blocked.json()).error, /也讓它讀資產/);
  // 權限對：過了金鑰這關，接著才檢查唯讀同步金鑰（測試環境沒設 → 503，代表金鑰已通過）
  assert.equal((await call('/openai/tools/asset_summary', { key: 'atl_goodgoodgoodgoodgood', body: '{}', env: env('all-read') })).status, 503);
});
