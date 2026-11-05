// Owner 的 AI 問答先問 Claude（11/10 以前 Opus 5.5、11/11 起 Sonnet 5.5；使用者 2026-11-05 延長，沒有預設結束日）；
// 家人、關掉、沒金鑰都不碰 Claude；Claude 失敗就照原本順序（Cloudflare → Gemini）接手。
// 時間一律固定（ask 的 now），不看真的時鐘，過了 11/10 結果也一樣。
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, claudePrimaryActive, buildClaudeMessages, claudeTools, CLAUDE_PRIMARY_UNTIL } from '../functions/ask.js';

const OWNER = 'owner-sync-token-abcdefghijklmnop';
const at = (iso) => Date.parse(iso);
const PROMO_NOW = '2026-10-28T12:00:00+08:00'; // 預設固定在送的額度期間（Opus 5.5）
let n = 0;

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }

async function ask({ owner = true, env = {}, claude, body = {}, now = PROMO_NOW } = {}) {
  const original = globalThis.fetch, realNow = Date.now;
  if (now) Date.now = () => at(now);
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
  } finally { globalThis.fetch = original; Date.now = realNow; }
}
const ok = (content, model = 'claude-opus-5-5') => Response.json({ model, stop_reason: 'end_turn', content });

test('Claude 主力沒有預設結束日（使用者 2026-11-05 延長）；CLAUDE_PRIMARY=off 立即關、CLAUDE_PRIMARY_UNTIL 可設結束日', async () => {
  const core = await import('../fallback-vercel/lib/ask-core.js');
  for (const [f, until] of [[claudePrimaryActive, CLAUDE_PRIMARY_UNTIL], [core.claudePrimaryActive, core.CLAUDE_PRIMARY_UNTIL]]) {
    assert.equal(until, '');
    assert.equal(f({}, at('2026-11-10T15:59:00Z')), true);
    assert.equal(f({}, at('2026-11-10T16:00:00Z')), true);  // 台北 11/11 00:00 仍是主力
    assert.equal(f({}, at('2026-12-01T04:00:00Z')), true);
    assert.equal(f({ CLAUDE_PRIMARY: 'off' }, at('2026-10-28T00:00:00Z')), false);
    assert.equal(f({ CLAUDE_PRIMARY: ' OFF ' }, at('2026-12-01T04:00:00Z')), false);
    assert.equal(f({ CLAUDE_PRIMARY_UNTIL: '2026-11-30' }, at('2026-11-30T15:59:00Z')), true);
    assert.equal(f({ CLAUDE_PRIMARY_UNTIL: '2026-11-30' }, at('2026-11-30T16:00:00Z')), false);
  }
});

for (const day of ['2026-11-11T09:00:00+08:00', '2026-12-01T09:00:00+08:00']) {
  test(`${day.slice(0, 10)}：Owner 仍先問 Claude（Sonnet 5.5，一般金鑰 ANTHROPIC_API_KEY 優先）；失敗照原本順序接手；關掉就不碰`, async () => {
    const reply = (b) => ok([{ type: 'text', text: 'Claude 回答' }], b.model);
    const env = { ANTHROPIC_API_KEY: 'sk-regular' };
    const a = await ask({ now: day, env, claude: reply });
    assert.equal(a.body.reply, 'Claude 回答');
    assert.equal(a.body.provider, 'Claude Sonnet 5.5');
    assert.equal(a.hits.claude[0].body.model, 'claude-sonnet-5-5');
    assert.equal(a.hits.claude[0].headers['x-api-key'], 'sk-regular');
    assert.equal(a.hits.cloudflare, 0);
    const fb = await ask({ now: day, env: { ...env, health_kv: kv() }, claude: () => Response.json({ error: { message: 'Overloaded' } }, { status: 529 }) });
    assert.match(fb.body.provider, /cloudflare/i);
    assert.match(fb.body.fallbackFrom, /Claude/);
    const off = await ask({ now: day, env: { ...env, CLAUDE_PRIMARY: 'off' }, claude: reply });
    assert.equal(off.hits.claude.length, 0);
    assert.match(off.body.provider, /cloudflare/i);
  });
}

test('金鑰：11/10 以前先用送的額度那把；11/11 起一般金鑰優先，失效（401）就同一題換 Anthropic_api_key', async () => {
  const both = { Anthropic_api_key: 'sk-test', ANTHROPIC_API_KEY: 'sk-regular' };
  const reply = (b) => ok([{ type: 'text', text: '好' }], b.model);
  const before = await ask({ now: '2026-11-10T23:59:00+08:00', env: both, claude: reply });
  assert.deepEqual(before.hits.claude.map((h) => h.headers['x-api-key']), ['sk-test']);
  const after = await ask({ now: '2026-11-11T00:00:00+08:00', env: { ...both, health_kv: kv() },
    claude: (b, i) => i === 1 ? Response.json({ error: { message: 'invalid x-api-key' } }, { status: 401 }) : reply(b) });
  assert.deepEqual(after.hits.claude.map((h) => h.headers['x-api-key']), ['sk-regular', 'sk-test']);
  assert.equal(after.body.reply, '好');
});

test('11/11 起只剩送的額度那把、而且額度沒了：乾淨地交給 Cloudflare，並暫停 Claude', async () => {
  const env = { health_kv: kv() };
  const now = '2026-11-12T09:00:00+08:00';
  const first = await ask({ now, env, claude: () => Response.json({ error: { message: 'Your credit balance is too low' } }, { status: 400 }) });
  assert.equal(first.hits.claude.length, 1);
  assert.match(first.body.provider, /cloudflare/i);
  const second = await ask({ now, env, claude: () => ok([{ type: 'text', text: 'should not be asked' }]) });
  assert.equal(second.hits.claude.length, 0);
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

test('系統健康的 Claude 狀態：說得出金鑰有沒有讀到、實測結果，但不帶金鑰內容', async () => {
  const { claudeAskStatus } = await import('../functions/ask.js');
  const st = await claudeAskStatus({ Anthropic_api_key: 'sk-secret-value', health_kv: kv() }, { probe: true, fetcher: async () => ok([{ type: 'text', text: 'OK' }]) });
  assert.equal(st.keyFound, true); assert.equal(st.keyName, 'Anthropic_api_key');
  assert.equal(st.probe.ok, true); assert.equal(st.probe.text, 'OK');
  assert.doesNotMatch(JSON.stringify(st), /sk-secret-value/);
  const none = await claudeAskStatus({}, { probe: true });
  assert.equal(none.keyFound, false); assert.equal(none.probe, undefined);
});

test('香港機房被擋（403 Request not allowed）不是額度問題：不暫停，下一題照樣先問 Claude', async () => {
  const env = { health_kv: kv() };
  const first = await ask({ env, claude: () => Response.json({ error: { type: 'forbidden', message: 'Request not allowed' } }, { status: 403 }) });
  assert.match(first.body.provider, /cloudflare/i);
  const second = await ask({ env, claude: () => ok([{ type: 'text', text: 'Claude 回來了' }]) });
  assert.equal(second.body.reply, 'Claude 回來了');
});

test('舊版誤記的「Request not allowed」暫停紀錄不再擋住 Claude', async () => {
  const store = kv();
  await store.put('ask-claude-cooldown', JSON.stringify({ until: at(PROMO_NOW) + 3600e3, reason: 'Claude HTTP 403：Request not allowed' }));
  const { body } = await ask({ env: { health_kv: store }, claude: () => ok([{ type: 'text', text: 'ok' }]) });
  assert.equal(body.reply, 'ok');
});

test('有 CLAUDE_RELAY 綁定時，Claude 走美國西部的 Durable Object，不直接從使用者附近的機房呼叫', async () => {
  const seen = [];
  const relay = {
    idFromName: (name) => ({ name }),
    get: (id, opts) => ({ fetch: async (url, init) => { seen.push({ id, opts, url, key: init.headers['x-api-key'] }); return ok([{ type: 'text', text: '從美國回答' }]); } }),
  };
  const { body, hits } = await ask({ env: { CLAUDE_RELAY: relay }, claude: () => { throw new Error('should not call api.anthropic.com directly'); } });
  assert.equal(body.reply, '從美國回答');
  assert.equal(hits.claude.length, 0);
  assert.equal(seen[0].opts.locationHint, 'wnam');
  assert.equal(seen[0].key, 'sk-test');
});

test('relay 類別有從主程式匯出，wrangler 也有綁定與 migration', async () => {
  const fs = await import('node:fs');
  const worker = fs.readFileSync('worker.js', 'utf8');
  assert.match(worker, /export \{ ClaudeRelay \} from "\.\/functions\/claude-relay\.js"/);
  const cfg = fs.readFileSync('wrangler.jsonc', 'utf8');
  assert.match(cfg, /"name": "CLAUDE_RELAY", "class_name": "ClaudeRelay"/);
  assert.match(cfg, /"new_sqlite_classes": \["ClaudeRelay"\]/);
  const { ClaudeRelay } = await import('../functions/claude-relay.js');
  const original = globalThis.fetch; let forwarded;
  globalThis.fetch = async (url, init) => { forwarded = { url, init }; return ok([{ type: 'text', text: 'x' }]); };
  try {
    const res = await new ClaudeRelay({}, {}).fetch(new Request('https://claude-relay.internal/v1/messages', { method: 'POST', headers: { 'x-api-key': 'k', 'anthropic-version': 'v' }, body: '{"a":1}' }));
    assert.equal(res.status, 200);
    assert.equal(forwarded.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(forwarded.init.headers['x-api-key'], 'k');
    assert.equal(forwarded.init.body, '{"a":1}');
  } finally { globalThis.fetch = original; }
});

// 使用者 2026-11-05「11/11 開始…其他都降到 Sonnet 5.5」：台北 11/11 起預設 Sonnet 5.5，每次呼叫才算；ANTHROPIC_MODEL 仍優先
test('Claude 模型：台北 11/10 23:59 用 Opus 5.5、11/11 00:00 起 Sonnet 5.5；ANTHROPIC_MODEL 仍優先', async () => {
  const { claudeModelFor } = await import('../functions/ask.js');
  const core = await import('../fallback-vercel/lib/ask-core.js');
  for (const f of [claudeModelFor, core.claudeModelFor]) {
    assert.equal(f({}, at('2026-11-10T23:59:00+08:00')), 'claude-opus-5-5');
    assert.equal(f({}, at('2026-11-11T00:00:00+08:00')), 'claude-sonnet-5-5');
    assert.equal(f({ ANTHROPIC_MODEL: ' claude-opus-5-5 ' }, at('2026-11-11T00:00:00+08:00')), 'claude-opus-5-5');
    assert.equal(f({ ANTHROPIC_MODEL: 'claude-x' }, at('2026-11-01T00:00:00+08:00')), 'claude-x');
  }
});

test('問答送出時才決定模型（11/11 起送 Sonnet 5.5，標籤跟著換）', async () => {
  const reply = (b) => ok([{ type: 'text', text: 'Claude 回答' }], b.model);
  const a = await ask({ now: '2026-11-10T23:59:00+08:00', claude: reply });
  assert.equal(a.hits.claude[0].body.model, 'claude-opus-5-5');
  assert.equal(a.body.provider, 'Claude Opus 5.5');
  const b = await ask({ now: '2026-11-11T00:00:00+08:00', claude: reply });
  assert.equal(b.hits.claude[0].body.model, 'claude-sonnet-5-5');
  assert.equal(b.body.provider, 'Claude Sonnet 5.5');
  const c = await ask({ now: '2026-11-11T00:00:00+08:00', env: { ANTHROPIC_MODEL: 'claude-opus-5-5' }, claude: reply });
  assert.equal(c.hits.claude[0].body.model, 'claude-opus-5-5');
});
