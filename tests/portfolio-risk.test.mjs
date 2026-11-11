import test from "node:test";
import assert from "node:assert/strict";
import { calculateConcentration } from "../functions/concentration.js";
import { onRequestGet, RISK_PREFIX } from "../functions/portfolio-risk.js";
import { runProactiveAnomalies, HOOK_AFTER_CLOSE, HOOK_DAILY_HEALTH, COOLDOWN_MS } from "../functions/proactive-anomaly.js";
import { handlePreparedAssetMcp } from "../functions/ai-connector-prepared.js";
import worker from "../worker.js";

const TOKEN = "test_owner_sync_12345678";
const OTHER = "test_other_sync_12345678";
const CLOSE = new Date("2026-11-11T06:00:00.000Z"); // 台北 14:00
const ASOF = "2026-11-11T05:40:00.000Z";
function snapshot(values = [30, 15, 15, 20, 20]) {
  const holdings = values.map((v, i) => ({ symbol: String(1000 + i), shares: 1 }));
  return { syncedAt: ASOF, holdings, dataset: { livePrices: { at: ASOF, failedSymbols: [], map: Object.fromEntries(holdings.map((h, i) => [h.symbol, { price: values[i], prevClose: values[i], asOfDate: ASOF, isStale: false, priceSource: "last" }])) } } };
}
function kv(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const writes = [];
  return { map, writes, async get(k) { return map.get(k) ?? null; }, async put(k, v) { writes.push(k); map.set(k, v); }, async list({ prefix }) { return { list_complete: true, keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; } };
}
const req = (token = TOKEN) => new Request("https://example.test/api/portfolio-risk", { headers: { authorization: `Bearer ${token}` } });
const envFor = (store, line = true) => ({ health_kv: store, LINE_REMINDER_SYNC_TOKEN: TOKEN, ...(line ? { LINE_CHANNEL_ACCESS_TOKEN: "test-line-token", LINE_USER_ID: "test-line-user" } : {}) });
const deps = (calls, overrides = {}) => ({ hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => false, fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; }, ...overrides });

test("concentration: exactly 30% and exactly top-three 60% do not breach", () => {
  // 排序後前三大是 30+15+15，後四檔 15/15/15/15/10。
  const snap = snapshot([30, 15, 15, 15, 15, 10]);
  const before = JSON.stringify(snap);
  const r = calculateConcentration(snap);
  assert.equal(r.status, "complete");
  assert.equal(r.holdings[0].weightPct, 30);
  assert.equal(r.top3.weightPct, 60);
  assert.deepEqual(r.breaches, { single: false, top3: false });
  assert.equal(JSON.stringify(snap), before);
});
test("concentration: strict greater-than, TW/US in TWD and duplicate symbols aggregated", () => {
  const snap = snapshot([31, 19, 10, 10]);
  snap.holdings.push({ symbol: "AAPL", shares: 1 }, { symbol: "AAPL", shares: 1 });
  snap.dataset.livePrices.map.AAPL = { price: 0.5, asOfDate: ASOF };
  snap.dataset.livePrices.map.USDTWD = { price: 30 };
  const r = calculateConcentration(snap);
  assert.equal(r.totalMarketValueTwd, 100);
  assert.equal(r.holdings.length, 5);
  assert.equal(r.markets.twPct, 70);
  assert.equal(r.markets.usPct, 30);
  assert.equal(r.top3.weightPct, 80);
  assert.deepEqual(r.breaches, { single: true, top3: true });
});
for (const kind of ["missing", "zero", "negative", "infinite", "stale", "failed", "boolean", "array"]) {
  test(`concentration: ${kind} quote is insufficient, no fake proportions or alerts`, () => {
    const snap = snapshot();
    if (kind === "missing") delete snap.dataset.livePrices.map["1000"];
    else if (kind === "stale") snap.dataset.livePrices.map["1000"].isStale = true;
    else if (kind === "failed") snap.dataset.livePrices.failedSymbols = ["1000"];
    else snap.dataset.livePrices.map["1000"].price = { zero: 0, negative: -1, infinite: Infinity, boolean: true, array: [30] }[kind];
    snap.holdings[0].costBasis = 999999;
    const r = calculateConcentration(snap);
    assert.equal(r.status, "insufficient_data");
    assert.equal(r.label, "資料不足");
    assert.deepEqual(r.missingSymbols, ["1000"]);
    assert.equal(r.totalMarketValueTwd, null);
    assert.equal(r.top3.weightPct, null);
    assert.equal(r.markets.twPct, null);
    assert.equal(r.breaches.single, null);
    assert.ok(r.holdings.every((h) => h.weightPct === null));
  });
}
for (const fx of [null, 0, -1, Infinity, "stale", "failed"]) {
  test(`concentration: US FX ${fx} never treats dollars as TWD`, () => {
    const snap = snapshot();
    snap.holdings.push({ symbol: "VOO", shares: 1 });
    snap.dataset.livePrices.map.VOO = { price: 500 };
    if (fx !== null) snap.dataset.livePrices.map.USDTWD = { price: typeof fx === "string" ? 30 : fx, isStale: fx === "stale" };
    if (fx === "failed") snap.dataset.livePrices.failedSymbols.push("USDTWD");
    const r = calculateConcentration(snap);
    assert.equal(r.status, "insufficient_data");
    assert.ok(r.missingSymbols.includes("USDTWD"));
    assert.ok(r.missingSymbols.includes("VOO"));
    assert.equal(r.markets.twPct, null);
  });
}
test("concentration: saved market value is usable, explicit TWD only for pre-converted US value", () => {
  const snap = { syncedAt: ASOF, holdings: [{ symbol: "2330", shares: 1, marketValue: 60 }, { symbol: "VOO", shares: 1, currentValue: 40, marketValueCurrency: "TWD" }] };
  const r = calculateConcentration(snap);
  assert.equal(r.totalMarketValueTwd, 100);
  assert.deepEqual(r.markets, { twPct: 60, usPct: 40 });
  delete snap.holdings[1].marketValueCurrency;
  assert.equal(calculateConcentration(snap).status, "insufficient_data");
});
test("concentration: empty / invalid shares are not a zero-percent healthy portfolio", () => {
  for (const snap of [null, {}, { holdings: [] }, { holdings: [{ symbol: "2330", shares: -1 }] }, { holdings: [{ symbol: "2330", shares: false }] }]) assert.equal(calculateConcentration(snap).status, "insufficient_data");
});
test("read API and MCP share data, scoped tokens, no writes, network or AI calls", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot(), [`portfolio-sync:${OTHER}`]: snapshot([10]) });
  const env = envFor(store);
  const api = await onRequestGet({ request: req(), env });
  assert.equal(api.status, 200);
  assert.equal(api.headers.get("cache-control"), "no-store");
  const data = await api.json();
  const mcp = await handlePreparedAssetMcp(new Request("https://example.test/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "portfolio_risk", arguments: {} } }) }), env, { syncToken: TOKEN });
  assert.deepEqual((await mcp.json()).result.structuredContent, data);
  const other = await (await onRequestGet({ request: req(OTHER), env })).json();
  assert.equal(other.concentration.totalMarketValueTwd, 10);
  assert.equal(data.concentration.totalMarketValueTwd, 100);
  assert.equal(store.writes.length, 0);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(TOKEN));
});
test("risk route requires bearer, rejects writes, no OAuth or MCP authentication changes", async () => {
  const env = envFor(kv());
  assert.equal((await worker.fetch(new Request("https://example.test/api/portfolio-risk?token=" + TOKEN), env, {})).status, 401);
  assert.equal((await worker.fetch(new Request("https://example.test/api/portfolio-risk", { method: "POST" }), env, {})).status, 405);
  const unknown = await (await worker.fetch(req(OTHER), env, {})).json();
  assert.equal(unknown.found, false);
  assert.equal(unknown.concentration.status, "insufficient_data");
});
test("SI Hub risk view reads only the configured owner, not latest writer", async () => {
  const ro = "test_sihub_read_12345678";
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([10]), [`portfolio-sync:${OTHER}`]: snapshot([999]), [RISK_PREFIX + TOKEN]: { alerts: [{ event_type: "concentration_single" }] } });
  const data = await (await onRequestGet({ request: req(ro), env: { ...envFor(store), SI_HUB_READ_TOKEN: ro } })).json();
  assert.equal(data.concentration.totalMarketValueTwd, 10);
  assert.equal(data.notifications.alerts[0].event_type, "concentration_single");
});
test("owner close alerts: defaults, App + LINE, 20h dedup and privacy", async () => {
  const snap = snapshot([100]);
  snap.dataset.livePrices.map["1000"].price = 97;
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snap });
  const env = envFor(store);
  const calls = [];
  const first = await runProactiveAnomalies(env, deps(calls));
  assert.deepEqual(first.owner.sent, ["portfolio_day_decline", "stock_day_decline", "concentration_single", "concentration_top3"]);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.url === "https://api.line.me/v2/bot/message/push" && c.body.to === "test-line-user"));
  const lineText = calls.map((c) => c.body.messages[0].text).join("\n");
  assert.doesNotMatch(lineText, /1000|97|金額|test-line-token|test_owner_sync/);
  const before = JSON.parse(store.map.get(RISK_PREFIX + TOKEN));
  const again = await runProactiveAnomalies(env, deps(calls, { now: () => new Date(CLOSE.getTime() + 1000) }));
  assert.equal(calls.length, 4);
  assert.equal(again.owner.withheld.length, 4);
  const after = JSON.parse(store.map.get(RISK_PREFIX + TOKEN));
  assert.deepEqual(before.alerts, after.alerts);
  assert.equal(after.alerts.length, 4);
  const view = await (await onRequestGet({ request: req(), env })).json();
  assert.deepEqual(view.notifications.alerts, after.alerts);
  assert.doesNotMatch(JSON.stringify(view), /test-line-token|test-line-user/);
});
test("concentration alert resets after cooldown but same event before 20h does not resend", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
  const calls = [];
  const env = envFor(store);
  await runProactiveAnomalies(env, deps(calls));
  const next = new Date(CLOSE.getTime() + 24 * 3600000);
  const fresh = snapshot([100]);
  fresh.syncedAt = next.toISOString(); fresh.dataset.livePrices.at = next.toISOString(); fresh.dataset.livePrices.map["1000"].asOfDate = next.toISOString();
  store.map.set(`portfolio-sync:${TOKEN}`, JSON.stringify(fresh));
  await runProactiveAnomalies(env, deps(calls, { now: () => next }));
  assert.equal(calls.length, 4);
});
test("missing LINE config still saves App alerts, then adding config delivers once", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
  const calls = [];
  const result = await runProactiveAnomalies(envFor(store, false), deps(calls));
  assert.equal(result.owner.skipped, "line_not_configured");
  assert.equal(calls.length, 0);
  const saved = JSON.parse(store.map.get(RISK_PREFIX + TOKEN));
  assert.equal(saved.alerts.length, 2);
  assert.equal(saved.line.skipped, "line_not_configured");
  await runProactiveAnomalies(envFor(store), deps(calls));
  assert.equal(calls.length, 2);
});
test("LINE failure doesn't fail cron or App; retry gap and exhausted records are bounded", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
  const calls = [];
  const failDeps = deps(calls, { fetch: async () => { throw new Error("CANARY-SECRET"); } });
  const warnings = [];
  const original = console.warn; console.warn = (...xs) => warnings.push(xs.join(" "));
  try {
    const result = await runProactiveAnomalies(envFor(store), failDeps);
    assert.equal(result.ok, true);
    assert.equal(result.owner.failed.length, 2);
    const next = await runProactiveAnomalies(envFor(store), failDeps);
    assert.deepEqual(next.owner.withheld, ["retry_gap", "retry_gap"]);
    assert.equal(JSON.parse(store.map.get(RISK_PREFIX + TOKEN)).alerts.length, 2);
    assert.doesNotMatch(warnings.join(" "), /CANARY|test-line-token|1000/);
  } finally { console.warn = original; }
});
test("risk state write/read failures never send LINE, never throw through cron", async () => {
  for (const mode of ["write", "read", "corrupt"]) {
    const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
    if (mode === "write") store.put = async () => { throw new Error("private"); };
    if (mode === "read") { const get = store.get; store.get = async (key) => { if (key.startsWith(RISK_PREFIX)) throw new Error("private"); return get(key); }; }
    if (mode === "corrupt") store.map.set(RISK_PREFIX + TOKEN, "broken-json");
    const calls = [];
    const result = await runProactiveAnomalies(envFor(store), deps(calls));
    assert.equal(result.ok, true);
    assert.ok(["state_write_failed", "scan_error"].includes(result.owner.skipped));
    assert.equal(calls.length, 0);
  }
});
test("only explicit owner snapshot can cause LINE, never another sync account", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([30, 15, 15, 15, 15, 10]), [`portfolio-sync:${OTHER}`]: snapshot([100]) });
  const calls = [];
  await runProactiveAnomalies(envFor(store), deps(calls));
  assert.equal(calls.length, 0);
});
for (const scenario of ["minute", "daily", "holiday", "unknown", "weekend", "stale", "stale_quotes", "missing"]) {
  test(`owner alerts fail closed for ${scenario}`, async () => {
    const snap = snapshot([100]);
    if (scenario === "stale") snap.syncedAt = "2026-11-10T05:40:00.000Z";
    if (scenario === "stale_quotes") snap.dataset.livePrices.map["1000"].asOfDate = "2026-11-10T05:40:00.000Z";
    if (scenario === "missing") delete snap.dataset.livePrices.map["1000"];
    const store = kv({ [`portfolio-sync:${TOKEN}`]: snap });
    const calls = [];
    const extra = scenario === "minute" ? { hook: "intraday_minute" } : scenario === "daily" ? { hook: HOOK_DAILY_HEALTH } : scenario === "holiday" ? { marketClosed: async () => true } : scenario === "unknown" ? { marketClosed: async () => null } : scenario === "weekend" ? { now: () => new Date("2026-11-14T06:00:00.000Z") } : {};
    await runProactiveAnomalies(envFor(store), deps(calls, extra));
    assert.equal(calls.length, 0);
  });
}
test("mixed US portfolio missing price/FX never turns TW subtotal into whole-portfolio decline", async () => {
  const snap = snapshot([100]);
  snap.dataset.livePrices.map["1000"].price = 90;
  snap.holdings.push({ symbol: "VOO", shares: 1 });
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snap });
  const calls = [];
  await runProactiveAnomalies(envFor(store), deps(calls));
  const saved = JSON.parse(store.map.get(RISK_PREFIX + TOKEN));
  assert.deepEqual(saved.alerts.map((a) => a.event_type), ["stock_day_decline"]);
  assert.equal(calls.length, 1);
  const data = await (await onRequestGet({ request: req(), env: envFor(store) })).json();
  assert.equal(data.concentration.status, "insufficient_data");
  assert.ok(data.concentration.missingSymbols.includes("VOO"));
});

test("LINE 3xx/5xx are failures, exhausted concentration recovers after 20h", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
  const old = new Date(CLOSE.getTime() - COOLDOWN_MS).toISOString();
  store.map.set(RISK_PREFIX + TOKEN, JSON.stringify({ lineIncidents: {
    "concentration:single": { event_type: "concentration_single", attempts: 3, lastAttemptAt: old },
    "concentration:top3": { event_type: "concentration_top3", attempts: 3, lastAttemptAt: old },
  } }));
  const calls = [];
  const result = await runProactiveAnomalies(envFor(store), deps(calls, { fetch: async (url, init) => { calls.push({ url, init }); return { ok: false, status: 302 }; } }));
  assert.equal(calls.length, 2);
  assert.equal(result.owner.failed.length, 2);
  assert.ok(calls.every((c) => c.init.redirect === "manual"));
  const state = JSON.parse(store.map.get(RISK_PREFIX + TOKEN));
  assert.equal(state.lineIncidents["concentration:single"].deliveredAt, null);
  assert.equal(state.lineIncidents["concentration:single"].attempts, 1);
});
test("LINE timeout is caught without leaking credentials or preventing App alerts", async () => {
  const store = kv({ [`portfolio-sync:${TOKEN}`]: snapshot([100]) });
  const calls = [];
  const result = await runProactiveAnomalies(envFor(store), deps(calls, { fetch: async (_url, init) => new Promise((_resolve, reject) => {
    // Simulate an aborted network request; never make an external request.
    assert.ok(init.signal);
    reject(new DOMException("aborted", "AbortError"));
  }) }));
  assert.equal(result.owner.failed.length, 2);
  assert.equal(JSON.parse(store.map.get(RISK_PREFIX + TOKEN)).alerts.length, 2);
});
