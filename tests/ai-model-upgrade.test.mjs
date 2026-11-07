import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GEMMA = "@cf/google/gemma-4-26b-a4b-it";
const OSS = "@cf/openai/gpt-oss-20b";

for (const f of ['functions/ask.js', 'fallback-vercel/lib/ask-core.js']) {
  test(f + ' uses Gemma 4 for light and heavy, and keeps GPT-OSS 20B as the Workers AI fallback', () => {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(s, new RegExp(`export const LIGHT_MODEL = "${GEMMA.replaceAll('/', '\\/')}";`));
    assert.match(s, new RegExp(`export const HEAVY_MODEL = "${GEMMA.replaceAll('/', '\\/')}";`));
    assert.match(s, new RegExp(`export const FALLBACK_MODEL = "${OSS.replaceAll('/', '\\/')}";`));
    assert.equal((s.match(/activeModel = FALLBACK_MODEL;/g) || []).length, 2);
    assert.equal((s.match(/glm-5\.3/g) || []).length, 0);
    assert.match(s, /if \(model === FALLBACK_MODEL\) \{\s*input\.max_tokens = maxTokens;/);
    assert.match(s, /input\.max_completion_tokens = maxTokens;\s*input\.chat_template_kwargs = \{ enable_thinking: false \};/);
    assert.doesNotMatch(s, /FALLBACK_MODEL\) \{\s*input\.max_tokens = maxTokens;\s*input\.chat_template_kwargs/);
    assert.match(s, /<think>/);
  });
}

test('health check probes the same Gemma 4 primary with max_completion_tokens', () => {
  const s = readFileSync(new URL('../functions/health-check.js', import.meta.url), 'utf8');
  assert.match(s, new RegExp(`const CLOUDFLARE_TEST_MODEL = "${GEMMA.replaceAll('/', '\\/')}";`));
  assert.match(s, /max_completion_tokens: 5/);
  assert.match(s, /chat_template_kwargs: \{ enable_thinking: false \}/);
  assert.equal((s.match(/glm-5\.3/g) || []).length, 0);
  assert.doesNotMatch(s, /max_tokens:\s*5/);
});
