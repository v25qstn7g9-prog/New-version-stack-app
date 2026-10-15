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

test('沒有唯讀同步金鑰時回 503，不去讀資產', async () => {
  const res = await call('/openai/tools/asset_summary', { key: 'k-test', body: '{}', env: { OPENAI_ACTION_KEY: 'k-test' } });
  assert.equal(res.status, 503);
});
