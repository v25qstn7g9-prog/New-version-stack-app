import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Vercel 備援曾經悄悄落後主程式好幾版（提示詞、工具、上下文長度都不同）。
// 這裡讓備援核心跟主程式強制一致，並確認轉接層真的能跑完一輪問答。

test("fallback core is an exact copy of functions/ask.js (run `npm run sync:fallback` to update)", () => {
  assert.equal(
    fs.readFileSync("fallback-vercel/lib/ask-core.js", "utf8"),
    fs.readFileSync("functions/ask.js", "utf8"),
  );
});

test("version tracking (VERSION.json vs the actual files) is consistent", () => {
  execFileSync("node", ["scripts/check-versions.js"], { stdio: "pipe" });
});

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: undefined };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}

async function callHandler(body, geminiParts) {
  const { default: handler } = await import("../fallback-vercel/api/ask.js");
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.APP_ORIGIN;
  delete process.env.FALLBACK_ACCESS_TOKEN;
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: geminiParts } }] }), { status: 200 });
  };
  try {
    const res = fakeRes();
    await handler({ method: "POST", headers: { origin: "https://app.example" }, body }, res);
    return { res, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("fallback handler answers through Gemini using the shared core", async () => {
  const { res, seen } = await callHandler({ message: "你好", context: "0050 1000股" }, [{ text: "哈囉" }]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.reply, "哈囉");
  assert.equal(res.body.provider, "gemini-external");
  assert.match(seen[0].url, /gemini-3\.6-flash:generateContent$/);
  assert.match(seen[0].body.systemInstruction.parts[0].text, /0050 1000股/);
});

test("fallback handler passes App tool calls back to the browser for the confirm card", async () => {
  const { res } = await callHandler(
    { message: "幫我記今天買 0050 100 股 150 元" },
    [{ functionCall: { name: "add_trade", args: { symbol: "0050", action: "buy", shares: 100, price: 150 } } }],
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.toolCalls?.[0]?.name, "add_trade");
});

// 2026-10：Gemini 3.x 對「重播」的 functionCall 要求 thoughtSignature，沒有就回
// 400 "Function call is missing a thought_signature ... query_app_data, position 2"。
// 瀏覽器送回來的工具回合（Cloudflare GPT-OSS 產生的，或簽章在 ask-core 被丟掉的）不可能有簽章，
// 所以備援要把它們當成純文字證據，而不是 functionCall／functionResponse。
const toolTurn = [{
  id: "call_1", name: "query_app_data", arguments: { topic: "daily_records" },
}];
const toolTurnResult = [{ id: "call_1", name: "query_app_data", content: "2026-09-30 資產 NT$ 5,900,000" }];

test("fallback never replays an unsigned functionCall to Gemini (it becomes plain-text evidence)", async () => {
  const { res, seen } = await callHandler(
    { message: "給我 9 月月報", toolTurns: [{ calls: toolTurn, results: toolTurnResult }] },
    [{ text: "這是 9 月月報" }],
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, "這是 9 月月報");
  const contents = seen[0].body.contents;
  const parts = contents.flatMap((c) => c.parts);
  assert.ok(!parts.some((p) => p.functionCall), "no functionCall may be replayed without a thoughtSignature");
  assert.ok(!parts.some((p) => p.functionResponse), "its functionResponse must not be orphaned either");
  const evidence = parts.map((p) => p.text || "").join("\n");
  assert.match(evidence, /【App 工具結果：query_app_data】\n2026-09-30 資產 NT\$ 5,900,000/);
});

test("fallback still replays a functionCall natively when it carries a thoughtSignature", async () => {
  // Only reachable if the signature survives (e.g. a future ask-core that forwards it).
  const mod = await import("../fallback-vercel/api/ask.js");
  assert.equal(typeof mod.default, "function");
  const src = fs.readFileSync("fallback-vercel/api/ask.js", "utf8");
  assert.match(src, /if \(!m\.tool_calls\.some\(\(tc\) => tc\?\._geminiThoughtSignature\)\)/);
  assert.match(src, /if \(tc\._geminiThoughtSignature\) part\.thoughtSignature = tc\._geminiThoughtSignature;/);
});
