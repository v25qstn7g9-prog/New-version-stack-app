import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAssetOAuth } from '../functions/asset-mcp-oauth.js';

test('Perplexity callback allowlist is exact and retains OAuth client authentication', async () => {
  const env = { ASSET_MCP_PASSWORD: 'test-password-long-enough' };
  const register = callback => handleAssetOAuth(new Request('https://assets.example/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Perplexity', redirect_uris: [callback] }),
  }), env);
  for (const callback of [
    'https://www.perplexity.ai/rest/connections/oauth_callback',
    'https://enterprise.perplexity.ai/rest/connections/oauth_callback',
  ]) {
    const response = await register(callback);
    assert.equal(response.status, 201);
    assert.ok((await response.json()).client_id);
  }
  for (const callback of [
    'https://www.perplexity.ai.evil.example/rest/connections/oauth_callback',
    'https://www.perplexity.ai/rest/connections/oauth_callback/extra',
    'http://www.perplexity.ai/rest/connections/oauth_callback',
  ]) {
    assert.equal((await register(callback)).status, 400);
  }
});
