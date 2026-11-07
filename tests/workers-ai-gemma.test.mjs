// Gemma 4 取代 GLM-5.3 Flash 後：輕／重都打同一顆主模型，請求欄位跟官方輸入相容，
// gpt-oss-20b 備援的請求維持 max_tokens、不帶 Gemma 專用欄位。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIGHT_MODEL, HEAVY_MODEL, FALLBACK_MODEL, chooseAssetModel, workersAiRunInput, onRequestPost,
} from '../functions/ask.js';
import { runHealthCheck } from '../functions/health-check.js';
import { workersOutputTokenCap } from '../fallback-vercel/api/ask.js';

const GEMMA = '@cf/google/gemma-4-26b-a4b-it';
const OSS = '@cf/openai/gpt-oss-20b';

function assertGemmaInput(input, { tools = true } = {}) {
  assert.equal(input.max_completion_tokens, 1000);
  assert.equal(input.max_tokens, undefined);
  assert.equal(input.chat_template_kwargs, undefined);
  assert.equal(input.temperature, undefined);
  assert.ok(Array.isArray(input.messages) && input.messages.length >= 1);
  assert.ok(input.messages.every((m) => typeof m.role === 'string' && (typeof m.content === 'string' || m.content === null || Array.isArray(m.content) || m.tool_calls)));
  if (tools) {
    assert.ok(Array.isArray(input.tools) && input.tools.length > 0);
    for (const tool of input.tools) {
      assert.equal(tool.type, 'function');
      assert.equal(typeof tool.function.name, 'string');
      assert.equal(tool.function.parameters.type, 'object');
    }
  } else {
    assert.equal(input.tools, undefined);
  }
  const keys = Object.keys(input).sort();
  assert.deepEqual(keys, tools ? ['max_completion_tokens', 'messages', 'tools'] : ['max_completion_tokens', 'messages']);
}

function assertOssInput(input, { tools = true } = {}) {
  assert.equal(input.max_tokens, 1000);
  assert.equal(input.max_completion_tokens, undefined);
  assert.equal(input.chat_template_kwargs, undefined);
  assert.equal(input.enable_thinking, undefined);
  if (tools) assert.ok(Array.isArray(input.tools) && input.tools.length > 0);
  else assert.equal(input.tools, undefined);
  const keys = Object.keys(input).sort();
  assert.deepEqual(keys, tools ? ['max_tokens', 'messages', 'tools'] : ['max_tokens', 'messages']);
}

test('light and heavy selections are both Gemma 4; fallback stays GPT-OSS 20B', () => {
  assert.equal(LIGHT_MODEL, GEMMA);
  assert.equal(HEAVY_MODEL, GEMMA);
  assert.equal(FALLBACK_MODEL, OSS);
  assert.equal(chooseAssetModel('你好'), LIGHT_MODEL);
  assert.equal(chooseAssetModel('為什麼這檔有風險'), HEAVY_MODEL);
  assert.equal(chooseAssetModel('你好', '', [{ calls: [{ name: 'query_app_data' }] }]), HEAVY_MODEL);
  assert.equal(chooseAssetModel('你好', 'x'.repeat(16001)), HEAVY_MODEL);
  assert.equal(chooseAssetModel(''), LIGHT_MODEL);
});

test('Gemma input uses max_completion_tokens; GPT-OSS fallback input stays on max_tokens', () => {
  const messages = [{ role: 'user', content: 'ping' }];
  const tools = [{ type: 'function', function: { name: 'add_trade', parameters: { type: 'object' } } }];
  const gemma = workersAiRunInput(GEMMA, messages, { tools });
  const oss = workersAiRunInput(OSS, messages, { tools });
  const ossPlain = workersAiRunInput(OSS, messages);
  assertGemmaInput(gemma);
  assertOssInput(oss);
  assertOssInput(ossPlain, { tools: false });
  assert.equal(gemma.tools, tools);
  assert.equal(oss.tools, tools);
  assert.deepEqual(workersOutputTokenCap({ max_completion_tokens: 1000 }), 1000);
  assert.deepEqual(workersOutputTokenCap({ max_tokens: 1000 }), 1000);
  assert.deepEqual(workersOutputTokenCap({ max_completion_tokens: 800, max_tokens: 1000 }), 800);
  assert.deepEqual(workersOutputTokenCap({}), 1000);
});

async function ask(message, run, extra = {}) {
  const calls = [];
  const res = await onRequestPost({
    env: {
      AI: { run: async (model, input) => { calls.push({ model, input }); return run(model, input, calls.length); } },
      GEMINI_API_KEY: 'test-key',
    },
    request: new Request('https://app/ask', {
      method: 'POST',
      body: JSON.stringify({ message, context: '持股 0050', ...extra }),
    }),
  });
  return { body: await res.json(), calls };
}

test('a simple question and a complex question both call Gemma 4 with a compatible payload', async () => {
  const reply = () => ({ choices: [{ message: { content: '可以' } }] });
  const light = await ask('今天天氣好嗎 ' + Date.now(), reply);
  assert.equal(light.body.provider, 'cloudflare');
  assert.equal(light.body.model, GEMMA);
  assert.equal(light.calls.length, 1);
  assert.equal(light.calls[0].model, LIGHT_MODEL);
  assertGemmaInput(light.calls[0].input);
  assert.equal(light.calls[0].input.messages[0].role, 'system');
  assert.equal(light.calls[0].input.messages.at(-1).role, 'user');

  const heavy = await ask('請做完整分析並比較風險 ' + Date.now(), reply);
  assert.equal(heavy.body.model, HEAVY_MODEL);
  assert.equal(heavy.calls.length, 1);
  assert.equal(heavy.calls[0].model, GEMMA);
  assertGemmaInput(heavy.calls[0].input);
  assert.equal(heavy.calls[0].input.messages.at(-1).role, 'user');
});

test('tool-turn messages stay in the OpenAI shape Gemma accepts', async () => {
  const { calls, body } = await ask('根據上面結果直接回答 ' + Date.now(), () => ({ response: '已看過持股' }), {
    toolTurns: [{
      calls: [{ id: 'call_1', name: 'query_app_data', arguments: { topic: 'holdings' } }],
      results: [{ id: 'call_1', content: '0050 100股' }],
    }],
  });
  assert.equal(body.model, HEAVY_MODEL);
  assertGemmaInput(calls[0].input);
  const assistant = calls[0].input.messages.find((m) => m.role === 'assistant');
  const tool = calls[0].input.messages.find((m) => m.role === 'tool');
  assert.equal(assistant.tool_calls[0].id, 'call_1');
  assert.equal(assistant.tool_calls[0].type, 'function');
  assert.equal(assistant.tool_calls[0].function.name, 'query_app_data');
  assert.equal(typeof assistant.tool_calls[0].function.arguments, 'string');
  assert.equal(JSON.parse(assistant.tool_calls[0].function.arguments).topic, 'holdings');
  assert.equal(tool.tool_call_id, 'call_1');
  assert.equal(tool.content, '0050 100股');
});

test('a primary model error retries GPT-OSS 20B with the old payload; quota errors do not', async () => {
  const failed = await ask('你好 ' + Date.now(), (model) => {
    if (model === GEMMA) throw new Error('model returned malformed output');
    return { response: '20b answer' };
  });
  assert.equal(failed.body.provider, 'cloudflare');
  assert.equal(failed.body.model, OSS);
  assert.equal(failed.body.reply, '20b answer');
  assert.equal(failed.calls.length, 2);
  assert.equal(failed.calls[0].model, GEMMA);
  assert.equal(failed.calls[1].model, OSS);
  assertGemmaInput(failed.calls[0].input);
  assertOssInput(failed.calls[1].input);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] });
  try {
    const quota = await ask('你好額度 ' + Date.now(), () => { throw new Error('429 quota exceeded'); });
    assert.match(quota.body.provider, /gemini/i);
    assert.equal(quota.calls.length, 1);
    assert.equal(quota.calls[0].model, GEMMA);
    assertGemmaInput(quota.calls[0].input);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an empty Gemma reply falls back to GPT-OSS without changing its payload', async () => {
  const { body, calls } = await ask('空白 ' + Date.now(), (model) => {
    if (model === GEMMA) return { choices: [{ message: { content: '<think>only</think>' } }] };
    return { response: 'fallback text' };
  });
  assert.equal(body.model, OSS);
  assert.equal(body.reply, 'fallback text');
  assert.equal(calls[1].model, OSS);
  assertOssInput(calls[1].input);
});

test('forceAnswer omits tools but still uses the model-specific token field', async () => {
  const { calls, body } = await ask('直接回答 ' + Date.now(), () => ({ response: '好' }), { forceAnswer: true });
  assert.equal(body.model, GEMMA);
  assertGemmaInput(calls[0].input, { tools: false });
});

test('health check calls Gemma 4 with max_completion_tokens and does not use the fallback model', async () => {
  const calls = [];
  const env = {
    AI: { run: async (model, input) => { calls.push({ model, input }); return { response: 'pong' }; } },
    health_kv: { get: async () => null, put: async () => {} },
  };
  const result = await runHealthCheck(env);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, GEMMA);
  assert.notEqual(calls[0].model, OSS);
  assert.deepEqual(calls[0].input, {
    messages: [{ role: 'user', content: 'ping' }],
    max_completion_tokens: 5,
  });
});
