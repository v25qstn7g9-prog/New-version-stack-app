// 送的 Claude 額度期間（到 2026-11-10）：Owner 的 AI 問答先問 Claude Opus 5.5；
// 家人、過期、沒金鑰都不碰 Claude；Claude 失敗就照原本順序（Cloudflare → Gemini）接手。
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, claudePrimaryActive, buildClaudeMessages, claudeTools, CLAUDE_PRIMARY_UNTIL } from '../functions/ask.js';

const OWNER = 'owner-sync-token-abcdefghijklmnop';
const at = (iso) => Date.parse(iso);
let n = 0;

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }

async function ask({ owner = true, env = {}, claude, body = {} } = {}) {
  const original = globalThis.fetch;
  const hits = { claude: [], gemini: 0, cloudflare: 0 };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('anthropic.com')) { const b = JSON.parse(init.body); hits.claude.push({ body: b, headers: init.headers }); return claude(b, hits.claude.length); }
    hits.gemini++; return Response.json({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] });
  };
  try {
    const res = await onRequestPost({
      env: { AI: { run: async () => { hits.cloudflare++; return { response: 'cloudflare answer' }; } }, LINE_REMINDER_SYNC_TOKEN: OWNER, GEMINI_API_KEY: 'G', Anthropic_api_key: 'sk-test', health_kv: kv(), ...env },
      request: new Request('https://app/ask', { method: 'POST', headers: owner ? { authorization: 'Bearer ' + OWNER } : {}, body: JSON.stringify({ message: '0050 今天怎樣 ' + (++n), context: '持股：0050', ...body }) }),
    });
    return { body: await res.json(), hits };
  } finally { globalThis.fetch = original; }
}
const ok = (content, model = 'claude-opus-5-5') => Response.json({ model, stop_reason: 'end_turn', content });

test('期間只到 11/10（台北日期），也能用 CLAUDE_PRIMARY=off 關掉', () => {
  assert.equal(CLAUDE_PRIMARY_UNTIL, '2026-11-10');
  assert.equal(claudePrimaryActive({}, at('2026-11-10T15:59:00Z')), true);
  assert.equal(claudePrimaryActive({}, at('2026-11-10T16:00:00Z')), false);
  assert.equal(claudePrimaryActive({ CLAUDE_PRIMARY: 'off' }, at('2026-10-28T00:00:00Z')), false);
});

test('Owner 的問答先問 Claude，用 Secret「Anthropic_api_key」，回覆標成 Claude Opus 5.5', async () => {
  const { body, hits } = await ask({ claude: () => ok([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Claude 回答' }]) });
  assert.equal(body.reply, 'Claude 回答');
  assert.equal(body.provider, 'Claude Opus 5.5');
  assert.equal(hits.cloudflare, 0); assert.equal(hits.gemini, 0);
  assert.equal(hits.claude[0].headers['x-api-key'], 'sk-test');
  assert.equal(hits.claude[0].body.model, 'claude-opus-5-5');
  assert.match(hits.claude[0].body.system, /持股：0050/);
  assert.ok(hits.claude[0].body.tools.some((t) => t.name === 'get_live_quotes' && t.input_schema));
});

test('家人／朋友（沒有 Owner token）不用 Claude', async () => {
  const { body, hits } = await ask({ owner: false, claude: () => ok([{ type: 'text', text: 'no' }]) });
  assert.equal(hits.claude.length, 0);
  assert.match(body.provider, /cloudflare/i);
});

test('沒有金鑰就不碰 Claude', async () => {
  const { hits } = await ask({ env: { Anthropic_api_key: '' }, claude: () => ok([{ type: 'text', text: 'no' }]) });
  assert.equal(hits.claude.length, 0);
});

test('Claude 要用 App 工具時，照舊回給 App 執行', async () => {
  const { body } = await ask({ claude: () => ok([{ type: 'tool_use', id: 'toolu_1', name: 'get_live_quotes', input: { symbols: ['0050'] } }]) });
  assert.deepEqual(body.toolCalls, [{ id: 'toolu_1', name: 'get_live_quotes', arguments: { symbols: ['0050'] } }]);
});

test('App 送回工具結果時，用文字放進最後一則訊息；forceAnswer 不帶工具', async () => {
  const toolTurns = [{ calls: [{ id: 'call_0', name: 'get_live_quotes', arguments: {} }], results: [{ id: 'call_0', content: '0050 108.6' }] }];
  const { body, hits } = await ask({ body: { toolTurns, forceAnswer: true }, claude: () => ok([{ type: 'text', text: '依工具結果回答' }]) });
  assert.equal(body.reply, '依工具結果回答');
  const msgs = hits.claude[0].body.messages;
  assert.equal(msgs[msgs.length - 1].role, 'user');
  assert.match(msgs[msgs.length - 1].content, /App 工具結果：get_live_quotes[\s\S]*108\.6/);
  assert.equal(hits.claude[0].body.tools, undefined);
});

test('Claude 失敗就照原本順序接手，並說明原因；額度問題暫停 6 小時不再每題等它', async () => {
  const env = { health_kv: kv() };
  const first = await ask({ env, claude: () => Response.json({ error: { message: 'Your credit balance is too low' } }, { status: 400 }) });
  assert.match(first.body.provider, /cloudflare/i);
  assert.match(first.body.fallbackFrom, /Claude/);
  const second = await ask({ env, claude: () => ok([{ type: 'text', text: 'should not be asked' }]) });
  assert.equal(second.hits.claude.length, 0);
  assert.match(second.body.provider, /cloudflare/i);
});

test('網路搜尋在伺服器端做完再接著問 Claude（整段 content 原樣放回）', async () => {
  const { body, hits } = await ask({
    env: { TAVILY_API_KEY: '' },
    claude: (b, i) => i === 1
      ? ok([{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 'toolu_s', name: 'web_search', input: { query: '台積電 法說會' } }])
      : ok([{ type: 'text', text: '查完了' }]),
  });
  assert.equal(body.reply, '查完了');
  const m = hits.claude[1].body.messages;
  assert.equal(m[m.length - 2].role, 'assistant');
  assert.equal(m[m.length - 2].content[0].type, 'thinking');
  assert.equal(m[m.length - 1].content[0].tool_use_id, 'toolu_s');
});

test('對話紀錄整理成 user／assistant 交替、從 user 開始', () => {
  const msgs = buildClaudeMessages([{ role: 'assistant', content: '開場' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }], 'q');
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(msgs[0].content, 'a\n\nb');
  assert.equal(claudeTools([{ type: 'function', function: { name: 'x', description: 'd', parameters: { type: 'object', properties: {} } } }])[0].input_schema.type, 'object');
});
