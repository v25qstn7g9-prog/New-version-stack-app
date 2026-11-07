import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  COOLDOWN_MS, RETRY_GAP_MS, STATE_KEY, STATE_TTL_SECONDS, SUMMARIES, SOURCE,
  HOOK_AFTER_CLOSE, HOOK_DAILY_HEALTH, MAX_STATE_INCIDENTS,
  parseOptInNumber, readThresholds, webhookConfig, portfolioPriceChange,
  evaluateDeclines, evaluateSnapshot, buildPayload, postWebhook, deliveryDecision,
  boundIncidents, runProactiveAnomalies, pendingIdsFromRaw,
} from "../functions/proactive-anomaly.js";

const KEY = "test-proactive-key-0123456789";
const HOOK_URL = "https://receiver.example/hook";
const TOKEN = "abcdefghijklmnop1234";
const CLOSE = new Date("2026-10-05T06:00:00.000Z"); // Monday 14:00 Taipei
const AS_OF = "2026-10-05T05:40:00.000Z"; // 13:40 Taipei
const ID = "11111111-1111-4111-8111-111111111111";
const GATES = (portfolioPct = null, stockPct = null, portfolioTwd = null, stockTwd = null) => ({
  portfolio: { pct: portfolioPct, twd: portfolioTwd, enabled: portfolioPct != null || portfolioTwd != null },
  stock: { pct: stockPct, twd: stockTwd, enabled: stockPct != null || stockTwd != null },
});

function fakeKv(initial = {}) {
  const map = new Map(Object.entries(initial));
  const puts = [];
  return {
    map, puts,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async put(k, v, opts) { puts.push({ k, v, opts }); map.set(k, v); },
    async list({ prefix }) {
      return { keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

function compactQuote(symbol, price, extra = {}) {
  return {
    syncedAt: extra.syncedAt ?? AS_OF,
    liveAt: extra.liveAt ?? AS_OF,
    failedSymbols: extra.failedSymbols ?? [],
    holdings: extra.holdings ?? [{ symbol, shares: extra.shares ?? 10 }],
    quotes: {
      [symbol]: {
        price,
        prevClose: extra.prevClose ?? 100,
        stale: extra.stale === true,
        asOfDate: extra.asOf ?? AS_OF,
        last: extra.last !== false,
        noPrev: extra.noPrev === true,
      },
    },
  };
}

function declines(snap, thresholds, opts = {}) {
  return evaluateDeclines({
    now: opts.now ?? CLOSE,
    marketClosed: Object.prototype.hasOwnProperty.call(opts, "marketClosed") ? opts.marketClosed : false,
    thresholds,
    snapshots: Array.isArray(snap) ? snap : [snap],
    hook: opts.hook ?? HOOK_AFTER_CLOSE,
  });
}

function rawSnapshot({ symbol = "2330", price = 97, shares = 10, prevClose = 100, asOf = AS_OF, syncedAt = AS_OF, liveAt = AS_OF, priceSource = "last", isStale = false, warning = "", failedSymbols = [], extraHoldings = [] } = {}) {
  return JSON.stringify({
    totalAssets: 888888,
    dailyChange: -999999,
    dailyChangePct: -50,
    syncedAt,
    holdings: [{ symbol, name: "CANARY-NAME", shares, costBasis: 888888 }, ...extraHoldings],
    dataset: {
      trades: [{ symbol, price: 888888, shares: 888888, note: "CANARY-TRADE" }],
      livePrices: {
        at: liveAt,
        failedSymbols,
        marketIndex: { symbol: "TAIEX", price: 888888 },
        map: { [symbol]: { price, prevClose, isStale, asOfDate: asOf, priceSource, warning, name: "CANARY-NAME" } },
      },
    },
  });
}

function enabled(kv, extra = {}) {
  return { PROACTIVE_WEBHOOK_URL: HOOK_URL, PROACTIVE_WEBHOOK_KEY: KEY, health_kv: kv, ...extra };
}

async function withWarns(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...args) => lines.push(args.map((x) => String(x)).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.warn = orig;
  }
}

function assertClean(text) {
  assert.doesNotMatch(text, /CANARY|2330|VOO|888888|999999|test-proactive-key|receiver\.example/);
}

test("opt-in numbers: unset and invalid stay off, exact bounds stay on", () => {
  assert.equal(parseOptInNumber(undefined).reason, "unset");
  assert.equal(parseOptInNumber("").reason, "unset");
  assert.equal(parseOptInNumber("  ").reason, "unset");
  for (const bad of ["0", "-3", "3%", "1e2", "nope-SECRET", "100.01"]) {
    assert.equal(parseOptInNumber(bad, { max: 100 }).reason, "invalid", bad);
  }
  assert.equal(parseOptInNumber("3").value, 3);
  assert.equal(parseOptInNumber(" 3.5 ").value, 3.5);
  assert.equal(parseOptInNumber("100", { max: 100 }).value, 100);
  assert.equal(parseOptInNumber("1000000000000").value, 1e12);
  assert.equal(parseOptInNumber("1000000000001").reason, "invalid");
  const none = readThresholds({});
  assert.equal(none.portfolio.enabled, false);
  assert.equal(none.stock.enabled, false);
  assert.deepEqual(none.invalid, []);
  const mixed = readThresholds({ PROACTIVE_PORTFOLIO_DECLINE_PCT: "nope-SECRET", PROACTIVE_STOCK_DECLINE_TWD: "30" });
  assert.equal(mixed.portfolio.enabled, false);
  assert.equal(mixed.stock.enabled, true);
  assert.equal(mixed.stock.twd, 30);
  assert.deepEqual(mixed.invalid, ["PROACTIVE_PORTFOLIO_DECLINE_PCT"]);
  assert.doesNotMatch(JSON.stringify(mixed), /nope-SECRET/);
});

test("webhook target rejects missing secrets, http, credentials and query strings", () => {
  assert.equal(webhookConfig({}).reason, "disabled");
  assert.equal(webhookConfig({ PROACTIVE_WEBHOOK_URL: HOOK_URL }).reason, "disabled");
  assert.equal(webhookConfig({ PROACTIVE_WEBHOOK_URL: HOOK_URL, PROACTIVE_WEBHOOK_KEY: "short" }).reason, "invalid_secret");
  assert.equal(webhookConfig({ PROACTIVE_WEBHOOK_URL: "http://receiver.example/hook", PROACTIVE_WEBHOOK_KEY: KEY }).reason, "not_https");
  assert.equal(webhookConfig({ PROACTIVE_WEBHOOK_URL: "https://user:CANARY-PASS@receiver.example/hook", PROACTIVE_WEBHOOK_KEY: KEY }).reason, "url_credentials");
  assert.equal(webhookConfig({ PROACTIVE_WEBHOOK_URL: "https://receiver.example/hook?k=CANARY-QUERY", PROACTIVE_WEBHOOK_KEY: KEY }).reason, "url_query_or_hash");
  const ok = webhookConfig({ PROACTIVE_WEBHOOK_URL: HOOK_URL, PROACTIVE_WEBHOOK_KEY: KEY });
  assert.equal(ok.ok, true);
  assert.equal(ok.url, HOOK_URL);
});

test("portfolio price change matches the per-holding formula, not a record delta", () => {
  const r = portfolioPriceChange([{ price: 97, prevClose: 100, shares: 10 }]);
  assert.equal(r.change, -30);
  assert.equal(r.pct, -3);
  assert.equal(portfolioPriceChange([{ price: 0, prevClose: 100, shares: 10 }]), null);
});

test("decline thresholds: exact boundary fires, the next milder value does not", () => {
  const at = compactQuote("2330", 97);
  const milder = compactQuote("2330", 98);
  assert.equal(declines(at, GATES(3)).incidents[0].event_type, "portfolio_day_decline");
  assert.equal(declines(milder, GATES(3)).incidents.length, 0);
  assert.equal(declines(at, GATES(null, null, 30)).incidents[0].event_type, "portfolio_day_decline");
  assert.equal(declines(compactQuote("2330", 91), GATES(null, null, 100)).incidents.length, 0);
  assert.equal(declines(compactQuote("2330", 90), GATES(null, null, 100)).incidents.length, 1);
  // 百分比沒到、金額有到：有設的那個就算。
  assert.equal(declines(at, GATES(10, null, 30)).incidents.length, 1);
  assert.equal(declines(at, GATES(10, null, 1000)).reason, "no_breach");
  assert.equal(declines(compactQuote("2330", 50), GATES()).reason, "thresholds_disabled");
});

test("portfolio and individual-stock declines are separate events", () => {
  const snap = {
    syncedAt: AS_OF, liveAt: AS_OF, failedSymbols: [],
    holdings: [{ symbol: "2330", shares: 1 }, { symbol: "0050", shares: 1 }],
    quotes: {
      2330: { price: 90, prevClose: 100, stale: false, asOfDate: AS_OF, last: true, noPrev: false },
      "0050": { price: 108, prevClose: 100, stale: false, asOfDate: AS_OF, last: true, noPrev: false },
    },
  };
  const stockOnly = declines(snap, GATES(3, 5));
  assert.deepEqual(stockOnly.incidents.map((i) => i.event_type), ["stock_day_decline"]);
  const bothDown = {
    ...snap,
    quotes: {
      2330: { price: 96, prevClose: 100, stale: false, asOfDate: AS_OF, last: true, noPrev: false },
      "0050": { price: 96, prevClose: 100, stale: false, asOfDate: AS_OF, last: true, noPrev: false },
    },
  };
  const portfolioOnly = declines(bothDown, GATES(3, 10));
  assert.deepEqual(portfolioOnly.incidents.map((i) => i.event_type), ["portfolio_day_decline"]);
  assert.equal(portfolioOnly.incidents[0].event_id, "portfolio-day-decline:2026-10-05");
  assert.notEqual(SUMMARIES.portfolio_day_decline, SUMMARIES.stock_day_decline);
});

test("US holdings are not reported as a portfolio decline", () => {
  const snap = {
    syncedAt: AS_OF, liveAt: AS_OF, failedSymbols: [],
    holdings: [{ symbol: "2330", shares: 1 }, { symbol: "VOO", shares: 2 }],
    quotes: { 2330: { price: 90, prevClose: 100, stale: false, asOfDate: AS_OF, last: true, noPrev: false } },
  };
  const result = declines(snap, GATES(1, 5));
  assert.deepEqual(result.incidents.map((i) => i.event_type), ["stock_day_decline"]);
  assert.equal(evaluateSnapshot(snap, "2026-10-05", GATES(1, 50)).reason, "us_holdings_not_in_snapshot");
});

test("weekends, holidays, unknown calendars and stale quotes do not alert", () => {
  const crash = compactQuote("2330", 50);
  const gates = GATES(3, 3);
  assert.equal(declines(crash, gates, { now: new Date("2026-10-04T06:00:00.000Z") }).reason, "weekend");
  assert.equal(declines(crash, gates, { marketClosed: true }).reason, "holiday");
  assert.equal(declines(crash, gates, { marketClosed: null }).reason, "calendar_unknown");
  assert.equal(declines(crash, gates, { hook: HOOK_DAILY_HEALTH }).reason, "not_close_hook");
  assert.equal(declines(crash, gates, { now: new Date("2026-10-05T02:00:00.000Z") }).reason, "before_close_window");
  const early = "2026-10-05T05:29:00.000Z";
  assert.equal(declines(compactQuote("2330", 50, { asOf: early, syncedAt: early, liveAt: early }), gates).reason, "stale_snapshot");
  const atClose = "2026-10-05T05:30:00.000Z";
  assert.equal(declines(compactQuote("2330", 50, { asOf: atClose, syncedAt: atClose, liveAt: atClose }), GATES(3)).incidents.length, 1);
  assert.equal(declines(compactQuote("2330", 50, { asOf: "2026-10-05T02:00:00.000Z" }), gates).reason, "incomplete_quotes");
  assert.equal(declines(compactQuote("2330", 50, { stale: true }), gates).reason, "incomplete_quotes");
  assert.equal(declines(compactQuote("2330", 50, { last: false }), gates).reason, "incomplete_quotes");
  assert.equal(declines(compactQuote("2330", 50, { noPrev: true }), gates).reason, "incomplete_quotes");
  assert.equal(declines(compactQuote("2330", 50, { failedSymbols: ["2330"] }), gates).reason, "incomplete_quotes");
  assert.equal(declines(compactQuote("2330", 50, { syncedAt: "2026-10-04T05:40:00.000Z" }), gates).reason, "stale_snapshot");
});

test("disabled mode does not read the store or call the network", async () => {
  const kv = { get() { throw new Error("kv"); }, list() { throw new Error("kv"); }, put() { throw new Error("kv"); } };
  const { result, lines } = await withWarns(() => runProactiveAnomalies(
    { health_kv: kv, PROACTIVE_PORTFOLIO_DECLINE_PCT: "nope-SECRET" },
    { hook: HOOK_AFTER_CLOSE, now: () => CLOSE, fetch: () => { throw new Error("network"); }, marketClosed: async () => { throw new Error("calendar"); } },
  ));
  assert.equal(result.skipped, "disabled");
  assert.deepEqual(result.sent, []);
  assert.equal(lines.length, 0);
  const http = await runProactiveAnomalies(
    { PROACTIVE_WEBHOOK_URL: "http://receiver.example/hook", PROACTIVE_WEBHOOK_KEY: KEY, health_kv: kv },
    { hook: HOOK_AFTER_CLOSE, fetch: () => { throw new Error("network"); } },
  );
  assert.equal(http.skipped, "not_https");
  const creds = await withWarns(() => runProactiveAnomalies(
    { PROACTIVE_WEBHOOK_URL: "https://user:CANARY-PASS@receiver.example/hook", PROACTIVE_WEBHOOK_KEY: KEY, health_kv: kv },
    { hook: HOOK_DAILY_HEALTH, fetch: () => { throw new Error("network"); } },
  ));
  assert.equal(creds.result.skipped, "url_credentials");
  assert.doesNotMatch(creds.lines.join("\n"), /CANARY-PASS/);
  const unused = await runProactiveAnomalies(enabled(kv), { hook: "intraday_minute", fetch: () => { throw new Error("network"); } });
  assert.equal(unused.skipped, "hook_not_used");
  const noKv = await runProactiveAnomalies(
    { PROACTIVE_WEBHOOK_URL: HOOK_URL, PROACTIVE_WEBHOOK_KEY: KEY },
    { hook: HOOK_AFTER_CLOSE, fetch: () => { throw new Error("network"); }, marketClosed: async () => { throw new Error("calendar"); } },
  );
  assert.equal(noKv.skipped, "no_kv");
});

test("a real decline payload is category-only and uses the contract", async () => {
  const kv = fakeKv({ [`portfolio-sync:${TOKEN}`]: rawSnapshot() });
  const calls = [];
  const { result, lines } = await withWarns(() => runProactiveAnomalies(enabled(kv, { PROACTIVE_PORTFOLIO_DECLINE_PCT: "3" }), {
    hook: HOOK_AFTER_CLOSE,
    now: () => CLOSE,
    marketClosed: async () => false,
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return { status: 200 };
    },
  }));
  assert.deepEqual(result.sent, ["portfolio_day_decline"]);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, HOOK_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.equal(init.headers["X-Proactive-Key"], KEY);
  assert.deepEqual(Object.keys(body).sort(), ["event_id", "event_type", "occurred_at", "schema_version", "severity", "source", "summary"]);
  assert.equal(body.schema_version, 1);
  assert.equal(body.source, SOURCE);
  assert.equal(body.event_type, "portfolio_day_decline");
  assert.equal(body.event_id, "portfolio-day-decline:2026-10-05");
  assert.equal(body.severity, "warning");
  assert.equal(body.summary, SUMMARIES.portfolio_day_decline);
  assert.equal(body.occurred_at, CLOSE.toISOString());
  assertClean(JSON.stringify(body));
  assertClean(kv.map.get(STATE_KEY));
  assertClean(lines.join("\n"));
  assert.equal(kv.puts[0].opts.expirationTtl, STATE_TTL_SECONDS);
  assert.doesNotMatch(JSON.stringify(result), /2330|888888/);
});

test("runner keeps portfolio and stock apart, including when US shares are present", async () => {
  const book = JSON.parse(rawSnapshot({ price: 90, shares: 1 }));
  book.holdings.push({ symbol: "0050", name: "CANARY-NAME", shares: 1, costBasis: 888888 });
  book.dataset.livePrices.map["0050"] = { price: 108, prevClose: 100, isStale: false, asOfDate: AS_OF, priceSource: "last", warning: "" };
  const kv = fakeKv({ [`portfolio-sync:${TOKEN}`]: JSON.stringify(book) });
  const calls = [];
  const fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200 }; };
  const stockOnly = await runProactiveAnomalies(enabled(kv, {
    PROACTIVE_PORTFOLIO_DECLINE_PCT: "3",
    PROACTIVE_STOCK_DECLINE_PCT: "5",
  }), { hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => false, fetch });
  assert.deepEqual(stockOnly.sent, ["stock_day_decline"]);
  assert.equal(calls[0].summary, SUMMARIES.stock_day_decline);
  assertClean(JSON.stringify(calls));

  book.holdings.push({ symbol: "VOO", shares: 2, name: "CANARY-NAME" });
  book.dataset.livePrices.map["2330"].price = 90;
  const kvUs = fakeKv({ [`portfolio-sync:${TOKEN}`]: JSON.stringify(book) });
  const usCalls = [];
  const us = await runProactiveAnomalies(enabled(kvUs, { PROACTIVE_PORTFOLIO_DECLINE_PCT: "1", PROACTIVE_STOCK_DECLINE_PCT: "5" }), {
    hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => false,
    fetch: async (url, init) => { usCalls.push(JSON.parse(init.body)); return { status: 200 }; },
  });
  assert.deepEqual(us.sent, ["stock_day_decline"]);
  assertClean(JSON.stringify(usCalls));
});

test("invalid thresholds and closed or stale sessions do not send", async () => {
  const kv = fakeKv({ [`portfolio-sync:${TOKEN}`]: rawSnapshot({ price: 50 }) });
  const fetch = async () => { throw new Error("should not send"); };
  const invalid = await runProactiveAnomalies(enabled(kv, { PROACTIVE_PORTFOLIO_DECLINE_PCT: "nope-SECRET" }), {
    hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => false, fetch,
  });
  assert.equal(invalid.decline, "thresholds_disabled");
  assert.deepEqual(invalid.invalidThresholds, ["PROACTIVE_PORTFOLIO_DECLINE_PCT"]);
  assert.doesNotMatch(JSON.stringify(invalid), /nope-SECRET/);
  const holiday = await runProactiveAnomalies(enabled(kv, { PROACTIVE_PORTFOLIO_DECLINE_PCT: "3" }), {
    hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => true, fetch,
  });
  assert.equal(holiday.decline, "holiday");
  const weekend = await runProactiveAnomalies(enabled(fakeKv({ [`portfolio-sync:${TOKEN}`]: rawSnapshot({ price: 50 }) }), { PROACTIVE_PORTFOLIO_DECLINE_PCT: "3" }), {
    hook: HOOK_AFTER_CLOSE, now: () => new Date("2026-10-04T06:00:00.000Z"), marketClosed: async () => false, fetch,
  });
  assert.equal(weekend.decline, "weekend");
  const stale = await runProactiveAnomalies(enabled(fakeKv({
    [`portfolio-sync:${TOKEN}`]: rawSnapshot({ price: 50, asOf: "2026-10-05T02:00:00.000Z" }),
  }), { PROACTIVE_PORTFOLIO_DECLINE_PCT: "3" }), {
    hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => false, fetch,
  });
  assert.equal(stale.decline, "incomplete_quotes");
  const unknown = await runProactiveAnomalies(enabled(kv, { PROACTIVE_PORTFOLIO_DECLINE_PCT: "3" }), {
    hook: HOOK_AFTER_CLOSE, now: () => CLOSE, marketClosed: async () => { throw new Error("calendar down"); }, fetch,
  });
  assert.equal(unknown.decline, "calendar_unknown");
});

test("pending trades notify once and a removal notifies once, without trade fields", async () => {
  const key = `pending-trades:${TOKEN}`;
  const kv = fakeKv({
    [key]: JSON.stringify([{ id: ID, symbol: "2330", action: "buy", shares: 9, price: 888888, note: "CANARY-TRADE" }, { id: "not-a-uuid", symbol: "0050", price: 999999 }]),
  });
  const calls = [];
  const fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200 }; };
  const env = enabled(kv);
  const opts = (now) => ({ hook: HOOK_DAILY_HEALTH, now: () => now, marketClosed: async () => false, fetch });
  const open = await runProactiveAnomalies(env, opts(CLOSE));
  assert.deepEqual(open.sent, ["pending_trade_open"]);
  assert.equal(calls[0].event_id, `pending-open:${ID}`);
  assert.equal(calls[0].severity, "info");
  assertClean(JSON.stringify(calls[0]));
  const again = await runProactiveAnomalies(env, opts(new Date(CLOSE.getTime() + 60 * 60 * 1000)));
  assert.deepEqual(again.sent, []);
  assert.ok(again.withheld.includes("cooldown"));
  kv.map.set(key, "[]");
  const cleared = await runProactiveAnomalies(env, opts(new Date(CLOSE.getTime() + 60 * 60 * 1000 + 1000)));
  assert.deepEqual(cleared.sent, ["pending_trade_cleared"]);
  assert.equal(calls[1].summary, SUMMARIES.pending_trade_cleared);
  assert.doesNotMatch(calls[1].summary, /buy|sell|recorded|ledger/i);
  assertClean(JSON.stringify(calls[1]));
  const quiet = await runProactiveAnomalies(env, opts(new Date(CLOSE.getTime() + 2 * 60 * 60 * 1000)));
  assert.deepEqual(quiet.sent, []);
  assert.equal(calls.length, 2);
});

test("cooldown suppresses the same incident and allows one later send", async () => {
  const kv = fakeKv({ [`pending-trades:${TOKEN}`]: JSON.stringify([{ id: ID }]) });
  const calls = [];
  const fetch = async (url, init) => { calls.push(JSON.parse(init.body).event_id); return { status: 200 }; };
  const env = enabled(kv);
  const run = (ms) => runProactiveAnomalies(env, { hook: HOOK_DAILY_HEALTH, now: () => new Date(ms), fetch });
  await run(CLOSE.getTime());
  await run(CLOSE.getTime() + COOLDOWN_MS - 1);
  await run(CLOSE.getTime() + COOLDOWN_MS);
  assert.deepEqual(calls, [`pending-open:${ID}`, `pending-open:${ID}`]);
});

test("HTTP failures retry on a later clock, then stop, and do not record delivery", async () => {
  const kv = fakeKv({ [`pending-trades:${TOKEN}`]: JSON.stringify([{ id: ID, symbol: "2330", price: 888888 }]) });
  let calls = 0;
  const fetch = async () => { calls += 1; return { status: 500 }; };
  const env = enabled(kv);
  const id = `pending-open:${ID}`;
  let now = CLOSE.getTime();
  const run = () => runProactiveAnomalies(env, { hook: HOOK_DAILY_HEALTH, now: () => new Date(now), fetch });
  await run();
  const read = () => JSON.parse(kv.map.get(STATE_KEY)).incidents[id];
  assert.equal(read().deliveredAt, null);
  assert.equal(read().attempts, 1);
  now += 60 * 1000;
  await run();
  assert.equal(calls, 1);
  now += RETRY_GAP_MS;
  await run();
  assert.equal(calls, 2);
  assert.equal(read().attempts, 2);
  assert.equal(read().deliveredAt, null);
  now += RETRY_GAP_MS;
  await run();
  assert.equal(calls, 3);
  assert.equal(read().attempts, 3);
  now += RETRY_GAP_MS;
  const stopped = await run();
  assert.equal(calls, 3);
  assert.ok(stopped.withheld.includes("exhausted"));
  assert.equal(read().deliveredAt, null);
});

test("redirects, network errors, in-flight leases and store write failures do not mark delivered", async () => {
  const pending = { [`pending-trades:${TOKEN}`]: JSON.stringify([{ id: ID }]) };
  const redirectKv = fakeKv({ ...pending });
  let redirectCalls = 0;
  await runProactiveAnomalies(enabled(redirectKv), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE,
    fetch: async (url, init) => { redirectCalls += 1; assert.equal(init.redirect, "manual"); return { status: 302, ok: false }; },
  });
  assert.equal(redirectCalls, 1);
  const redirected = JSON.parse(redirectKv.map.get(STATE_KEY)).incidents[`pending-open:${ID}`];
  assert.equal(redirected.deliveredAt, null);
  assert.equal(redirected.attempts, 1);

  const throwKv = fakeKv({ ...pending });
  const thrown = await withWarns(() => runProactiveAnomalies(enabled(throwKv), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE,
    fetch: async () => { throw new Error(`down ${HOOK_URL} ${KEY}`); },
  }));
  assert.equal(thrown.result.ok, true);
  assert.equal(JSON.parse(throwKv.map.get(STATE_KEY)).incidents[`pending-open:${ID}`].deliveredAt, null);
  assert.doesNotMatch(thrown.lines.join("\n"), new RegExp(KEY));
  assert.doesNotMatch(thrown.lines.join("\n"), /receiver\.example/);
  assert.match(thrown.lines.join("\n"), /status=network/);

  const leaseUntil = new Date(CLOSE.getTime() + 30 * 1000).toISOString();
  const busy = fakeKv({
    ...pending,
    [STATE_KEY]: JSON.stringify({ v: 1, seenPending: [], incidents: { [`pending-open:${ID}`]: { event_type: "pending_trade_open", attempts: 0, leaseUntil, deliveredAt: null } } }),
  });
  let busyCalls = 0;
  const inflight = await runProactiveAnomalies(enabled(busy), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE, fetch: async () => { busyCalls += 1; return { status: 200 }; },
  });
  assert.equal(busyCalls, 0);
  assert.ok(inflight.withheld.includes("in_flight"));

  const block = fakeKv({ ...pending });
  block.put = async () => { throw new Error(`put ${KEY}`); };
  const blocked = await withWarns(() => runProactiveAnomalies(enabled(block), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE, fetch: async () => { throw new Error("sent"); },
  }));
  assert.equal(blocked.result.ok, true);
  assert.deepEqual(blocked.result.sent, []);
  assert.ok(blocked.result.failed.includes("pending_trade_open"));
  assert.doesNotMatch(blocked.lines.join("\n"), new RegExp(KEY));
});

test("system cards, collector failures and sync age stay category-only", async () => {
  const fresh = new Date(CLOSE.getTime() - 71 * 60 * 60 * 1000).toISOString();
  const old = new Date(CLOSE.getTime() - 73 * 60 * 60 * 1000).toISOString();
  const cards = JSON.stringify([
    { id: "hc_123", status: "pending", kind: "ai", summary: "CANARY-CARD 2330 lost 888888", rawError: "CANARY-RAW 999999" },
    { id: "hc_456", status: "pending", kind: "price", rawError: "2330 CANARY-PRICE" },
    { id: "hc_789", status: "resolved", kind: "ai", summary: "CANARY-RESOLVED" },
    { id: "not-a-card", status: "pending", kind: "ai", summary: "CANARY-BAD-ID" },
  ]);
  const status = JSON.stringify({ kind: "error", detail: "CANARY-DETAIL 2330", lastAt: CLOSE.toISOString() });
  const kv = fakeKv({
    "health:cards": cards,
    "intraday-status": status,
    [`portfolio-sync:${TOKEN}`]: rawSnapshot({ syncedAt: old, liveAt: old, asOf: old }),
  });
  const calls = [];
  const result = await runProactiveAnomalies(enabled(kv), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE,
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { status: 200 }; },
  });
  assert.deepEqual(result.sent.sort(), ["sync_stale", "system_ai_health", "system_intraday_collector", "system_price_quality"].sort());
  for (const body of calls) {
    assert.equal(body.summary, SUMMARIES[body.event_type]);
    assertClean(JSON.stringify(body));
  }
  const young = fakeKv({ [`portfolio-sync:${TOKEN}`]: rawSnapshot({ syncedAt: fresh, liveAt: fresh, asOf: fresh }) });
  const quiet = await runProactiveAnomalies(enabled(young), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE, fetch: async () => { throw new Error("sent"); },
  });
  assert.deepEqual(quiet.sent, []);
  const yesterday = fakeKv({ "intraday-status": JSON.stringify({ kind: "failed:no_kv", detail: "CANARY", lastAt: "2026-10-04T06:00:00.000Z" }) });
  const oldError = await runProactiveAnomalies(enabled(yesterday), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE, fetch: async () => { throw new Error("sent"); },
  });
  assert.deepEqual(oldError.sent, []);
  const skipped = fakeKv({ "intraday-status": JSON.stringify({ kind: "skipped:holiday", lastAt: CLOSE.toISOString(), detail: "CANARY" }) });
  const holidayStatus = await runProactiveAnomalies(enabled(skipped), {
    hook: HOOK_DAILY_HEALTH, now: () => CLOSE, fetch: async () => { throw new Error("sent"); },
  });
  assert.deepEqual(holidayStatus.sent, []);
});

test("webhook client times out, refuses unsafe bodies, and a scan error cannot escape", async () => {
  let aborted = false;
  const payload = buildPayload({ event_type: "sync_stale", event_id: "sync-stale:2026-10-05", severity: "warning" }, CLOSE);
  const timed = await postWebhook({
    url: HOOK_URL, key: KEY, payload, timeoutMs: 20,
    fetchImpl: (url, init) => new Promise((resolve, reject) => {
      assert.equal(init.redirect, "manual");
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }),
  });
  assert.equal(timed.ok, false);
  assert.equal(aborted, true);
  let called = false;
  const tampered = { ...payload, summary: "2330 fell 888888" };
  const rejected = await postWebhook({
    url: HOOK_URL, key: KEY, payload: tampered, fetchImpl: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(rejected.rejected, true);
  assert.equal(called, false);
  const extra = await postWebhook({
    url: HOOK_URL, key: KEY, payload: { ...payload, amount: 888888 }, fetchImpl: async () => { called = true; return { status: 200 }; },
  });
  assert.equal(extra.ok, false);
  assert.equal(called, false);

  const steps = [];
  await (async () => {
    steps.push("primary");
    try {
      const scan = await runProactiveAnomalies({
        PROACTIVE_WEBHOOK_URL: HOOK_URL,
        PROACTIVE_WEBHOOK_KEY: KEY,
        health_kv: { get() { throw new Error("kv"); }, list() { throw new Error("kv"); }, put() { throw new Error("kv"); } },
      }, {
        hook: HOOK_AFTER_CLOSE,
        now: () => { throw new Error(`clock ${KEY}`); },
        marketClosed: async () => false,
        fetch: async () => { throw new Error("nope"); },
      });
      assert.equal(scan.skipped, "scan_error");
      assert.equal(scan.ok, false);
    } catch {
      steps.push("escaped");
    }
    steps.push("after");
  })();
  assert.deepEqual(steps, ["primary", "after"]);
});

test("pending ids ignore raw trades, and incident state stays bounded", () => {
  assert.deepEqual(pendingIdsFromRaw(JSON.stringify([{ id: ID, symbol: "2330", price: 1 }, { id: "x" }])), [ID]);
  assert.deepEqual(pendingIdsFromRaw("not-json"), []);
  const incidents = {};
  for (let i = 0; i < MAX_STATE_INCIDENTS + 5; i += 1) {
    incidents[`sync-stale:2026-01-${String(i).padStart(2, "0")}`] = { lastAttemptAt: `2026-01-${String(i).padStart(2, "0")}T00:00:00.000Z` };
  }
  const kept = boundIncidents(incidents);
  assert.equal(Object.keys(kept).length, MAX_STATE_INCIDENTS);
  assert.ok(kept["sync-stale:2026-01-44"]);
  assert.equal(deliveryDecision(null, 0), "send");
  assert.equal(deliveryDecision({ deliveredAt: CLOSE.toISOString(), cooldownUntil: new Date(CLOSE.getTime() + COOLDOWN_MS).toISOString(), attempts: 0 }, CLOSE.getTime() + 1000), "cooldown");
});

test("scheduled hooks stay on the existing daily crons and off the request path", () => {
  const worker = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
  const wrangler = fs.readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const scheduled = worker.slice(worker.indexOf("async scheduled"));
  const minute = scheduled.slice(0, scheduled.indexOf("AUTO_DAILY_CRON"));
  assert.doesNotMatch(minute, /runProactiveAnomalies/);
  assert.match(scheduled, /try \{ await runProactiveAnomalies\(env, \{ hook: HOOK_AFTER_CLOSE \}\); \}\s*catch \{ console\.warn\("proactive anomaly scan failed"\); \}/);
  assert.match(scheduled, /try \{ await runProactiveAnomalies\(env, \{ hook: HOOK_DAILY_HEALTH \}\); \}\s*catch \{ console\.warn\("proactive anomaly scan failed"\); \}/);
  const after = scheduled.indexOf("HOOK_AFTER_CLOSE");
  const daily = scheduled.indexOf("HOOK_DAILY_HEALTH");
  const closeBlock = scheduled.slice(scheduled.indexOf("AUTO_DAILY_CRON"), daily);
  assert.ok(closeBlock.indexOf("runAutoDaily") < after);
  assert.ok(closeBlock.indexOf("runPushRound") < closeBlock.indexOf("HOOK_AFTER_CLOSE"));
  assert.ok(scheduled.indexOf("runHealthCheck") < daily);
  assert.doesNotMatch(worker, /\/api\/proactive/);
  assert.doesNotMatch(wrangler, /proactive/i);
  assert.doesNotMatch(wrangler, /PROACTIVE_WEBHOOK/);
  for (const file of ["portfolio-sync.js", "pending-trades.js", "health-check.js", "auto-daily.js", "quote.js"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../functions/${file}`, import.meta.url), "utf8"), /proactive-anomaly/);
  }
  const src = fs.readFileSync(new URL("../functions/proactive-anomaly.js", import.meta.url), "utf8");
  assert.match(src, /redirect:\s*"manual"/);
  assert.match(src, /X-Proactive-Key/);
  assert.doesNotMatch(src, /dailyChangePct|totalAssets/);
  assert.doesNotMatch(src, /pending-trades\/resolve/);
});
