import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 2026-11-10：GLM-5.3 Flash 11-20 下架，Workers AI 主模型改 GPT-OSS 120B（推理 low），20B 仍是備援。
for (const f of ['functions/ask.js', 'fallback-vercel/lib/ask-core.js']) {
  test(f + ' uses GPT-OSS 120B (low reasoning) and falls back to GPT-OSS 20B inside Workers AI', () => {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.match(s, /const LIGHT_MODEL = "@cf\/openai\/gpt-oss-120b";/);
    assert.match(s, /const HEAVY_MODEL = "@cf\/openai\/gpt-oss-120b";/);
    assert.match(s, /const FALLBACK_MODEL = "@cf\/openai\/gpt-oss-20b";/);
    assert.match(s, /const CF_REASONING_EFFORT = "low";/);
    assert.match(s, /const MAX_TOKENS = 1600;/);
    assert.doesNotMatch(s, /glm-5\.3-flash"/);
    // 備援次數不變：輕量出錯升級一次、空回覆換一次
    assert.equal((s.match(/activeModel = FALLBACK_MODEL;/g) || []).length, 2);
    // 每一個 Workers AI 呼叫都經過 cloudflareInputs（帶 reasoning_effort）
    const runs = s.match(/ai\.run\(activeModel, [^)]*\)/g) || [];
    assert.equal(runs.length, 3);
    for (const r of runs) assert.match(r, /cloudflareInputs\(messages/);
    assert.match(s, /<think>/);
  });
}

test('health check pings GPT-OSS 120B with low reasoning', () => {
  const s = readFileSync(new URL('../functions/health-check.js', import.meta.url), 'utf8');
  assert.match(s, /const CLOUDFLARE_TEST_MODEL = "@cf\/openai\/gpt-oss-120b";/);
  assert.match(s, /reasoning_effort: "low"/);
  assert.match(s, /15000/);
});

function setup(run) {
  const calls = [];
  const sandbox = {
    Response, Request, Headers, TextEncoder, AbortController, AbortSignal, URL, console, Date,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), clearTimeout,
    fetch: async () => Response.json({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] }),
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../functions/ask.js', import.meta.url), 'utf8').replace(/export /g, ''), sandbox);
  const env = { AI: { run: async (model, inputs) => { calls.push({ model, inputs }); return run(model, inputs, calls.length); } }, GEMINI_API_KEY: 'k' };
  const ask = async (message) => (await sandbox.onRequestPost({ env, request: new Request('https://app/ask', { method: 'POST', body: JSON.stringify({ message }) }) })).json();
  return { ask, calls, sandbox };
}

test('ai.run receives reasoning_effort low and max_tokens 1600 for primary and 20B fallback', async () => {
  const s = setup((model) => { if (/120b/.test(model)) throw Error('model returned malformed output'); return { response: 'fallback answer' }; });
  const result = await s.ask('hello');
  assert.equal(result.provider, 'cloudflare');
  assert.equal(result.model, '@cf/openai/gpt-oss-20b');
  assert.equal(s.calls.length, 2);
  assert.deepEqual(s.calls.map((c) => c.model), ['@cf/openai/gpt-oss-120b', '@cf/openai/gpt-oss-20b']);
  for (const c of s.calls) {
    assert.equal(c.inputs.reasoning_effort, 'low');
    assert.equal(c.inputs.max_tokens, 1600);
  }
});

test('transient Workers AI error does not retry 20B (fallback order unchanged)', async () => {
  const s = setup(() => { throw Error('429 quota exceeded'); });
  const result = await s.ask('hello');
  assert.match(result.provider, /gemini/i);
  assert.equal(s.calls.length, 1);
});

test('Responses-style output never returns reasoning text as the reply', async () => {
  const s = setup(() => ({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'SECRET_REASONING' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '這是回答' }] },
    ],
  }));
  const result = await s.ask('hello');
  assert.equal(result.reply, '這是回答');
  assert.doesNotMatch(JSON.stringify(result), /SECRET_REASONING/);
});

test('Responses-style output keeps {type:"text"} answers next to reasoning', async () => {
  const s = setup(() => ({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'SECRET_REASONING' }] },
      { type: 'text', text: '文字型回答' },
    ],
  }));
  const result = await s.ask('hello');
  assert.equal(result.reply, '文字型回答');
  assert.equal(result.model, '@cf/openai/gpt-oss-120b');
  assert.equal(s.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_REASONING/);
});

test('Responses-style output keeps untyped items with content next to reasoning', async () => {
  const s = setup(() => ({
    output: [
      { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'SECRET_REASONING' }] },
      { role: 'assistant', content: [{ text: '無 type 回答' }, { type: 'reasoning_text', text: 'SECRET_REASONING_2' }] },
    ],
  }));
  const result = await s.ask('hello');
  assert.equal(result.reply, '無 type 回答');
  assert.equal(result.model, '@cf/openai/gpt-oss-120b');
  assert.equal(s.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_REASONING/);
});

test('reasoning-only output counts as empty and switches to 20B', async () => {
  const s = setup((model) => /120b/.test(model)
    ? { output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'SECRET_REASONING' }] }] }
    : { response: '20B 回答' });
  const result = await s.ask('hello');
  assert.equal(result.reply, '20B 回答');
  assert.equal(result.model, '@cf/openai/gpt-oss-20b');
});
