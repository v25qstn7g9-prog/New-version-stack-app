import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const f of ['functions/ask.js', 'fallback-vercel/lib/ask-core.js']) {
  test(f + ' uses GLM-5.3 Flash and falls back to GPT-OSS 20B inside Workers AI', () => {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(s, /const LIGHT_MODEL = "@cf\/zai-org\/glm-5\.3-flash";/);
    assert.match(s, /const HEAVY_MODEL = "@cf\/zai-org\/glm-5\.3-flash";/);
    assert.match(s, /const FALLBACK_MODEL = "@cf\/openai\/gpt-oss-20b";/);
    assert.equal((s.match(/activeModel = FALLBACK_MODEL;/g) || []).length, 2);
    assert.match(s, /<think>/);
  });
}
