/**
 * auto-daily.js — 每日資產紀錄全自動化（伺服器端）
 *
 * 1. 休市日（週末由 cron 排除；國定假日看 TWSE 休市表）完全不動作。
 * 2. 開盤日 13:36、13:45：如果今天還沒有每日紀錄，用 LINE 提醒（要設定下面三個值才會發）。
 * 3. 開盤日 14:00：還沒有今天紀錄的同步帳號，用「同步快照的股數、持有成本 × 今天收盤價」
 *    算出今天的紀錄，暫存在 KV（auto-daily:<token>）。App 下次打開時會把「還沒有紀錄的日期」
 *    收進每日紀錄並標示「自動」；使用者之後手動儲存同一天，就以手動為準（直接覆蓋）。
 *
 * 紀錄只存在使用者瀏覽器裡，伺服器不能直接寫進去，所以是「伺服器先算好暫存 → App 打開時收進去」。
 *
 * LINE 提醒（選用；三個都設了才會發，沒設就安靜跳過，不影響自動記帳）：
 *   wrangler secret put LINE_CHANNEL_ACCESS_TOKEN   ← J洛 的 LINE Messaging API channel access token
 *   wrangler secret put LINE_USER_ID                ← 要收提醒的 LINE userId（U 開頭那串）
 *   wrangler secret put LINE_REMINDER_SYNC_TOKEN    ← 你在存股 App「計畫 → Z∞ 同步」用的那組 token（用來判斷今天記了沒）
 *
 * KV（沿用 health_kv）：auto-daily:<token> = { records: { "YYYY-MM-DD": {...} }, updatedAt }，14 天 TTL。
 * 每個同步帳號每個交易日最多寫 1 次。
 */
import { onRequestGet as quoteGet } from "./quote.js";
import { marketClosed } from "./market-calendar.js";
import { usablePrices } from "./intraday.js";

// 台北 14:00（UTC 06:00），週一到週五。wrangler.jsonc 的 crons 必須有完全一樣的字串。
export const AUTO_DAILY_CRON = "0 6 * * MON-FRI";
// 盤中每分鐘的 cron 會在這兩個時間點順便檢查要不要提醒。
export const REMINDER_MINUTES = [13 * 60 + 36, 13 * 60 + 45];

const SYNC_PREFIX = "portfolio-sync:";
const AUTO_PREFIX = "auto-daily:";
const AUTO_TTL_SECONDS = 60 * 60 * 24 * 14;
const KEEP_DAYS = 14;
const APP_URL = "https://new-version-stack-app.9n94fh64jr.workers.dev/";

export function taipeiParts(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: t.toISOString().slice(0, 10),
    weekday: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const records = (summary) => (Array.isArray(summary?.dataset?.dailyRecords) ? summary.dataset.dailyRecords : []);

export function hasRecordFor(summary, date) {
  return records(summary).some((r) => r && r.date === date);
}

export function lastRecordBefore(summary, date) {
  return records(summary)
    .filter((r) => r && typeof r.date === "string" && r.date < date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop() || null;
}

/** 同步快照的持股（股數、持有成本）× 今天收盤價。任何一檔沒有今天的價格就不記，避免記到不完整的市值。 */
export function buildAutoRecord(summary, prices, date) {
  const holdings = (Array.isArray(summary?.holdings) ? summary.holdings : []).filter((h) => num(h?.shares) > 0 && h?.symbol);
  if (!holdings.length) return { ok: false, reason: "no_holdings" };
  const missing = holdings.filter((h) => !(num(prices?.[h.symbol]) > 0)).map((h) => h.symbol);
  if (missing.length) return { ok: false, reason: "missing_prices", missing };
  const prior = lastRecordBefore(summary, date);
  const tw = holdings.filter((h) => /^[0-9]/.test(h.symbol));
  const us = holdings.filter((h) => !/^[0-9]/.test(h.symbol));
  const fx = num(prices.USDTWD);
  if (us.length && !(fx > 0)) return { ok: false, reason: "missing_prices", missing: ["USDTWD"] };
  const twValue = Math.round(tw.reduce((s,h) => s + num(prices[h.symbol]) * num(h.shares),0));
  const usValue = us.length ? Math.round(us.reduce((s,h) => s + num(prices[h.symbol]) * num(h.shares) * fx,0)) : (summary?.dataset?.holdings?.some((h) => !/^[0-9]/.test(h.symbol)) ? 0 : (num(prior?.usValue) ?? 0));
  const costFor = (rows, fallback) => rows.length && rows.every((h) => h.costBasis != null && num(h.costBasis) != null) ? Math.round(rows.reduce((s,h) => s + num(h.costBasis),0)) : fallback;
  const twCost = costFor(tw, num(prior?.twCost) ?? 0);
  const usCost = costFor(us, !us.length && summary?.dataset?.holdings?.some((h) => !/^[0-9]/.test(h.symbol)) ? 0 : num(prior?.usCost) ?? 0);
  return {
    ok: true,
    record: {
      date, valuationVersion: 2,
      twValue,
      usValue,
      twCost,
      usCost,
      source: "auto",
      autoAt: new Date().toISOString(),
    },
  };
}

async function defaultMarketClosed(date) {
  return marketClosed(date);
}

async function defaultFetchPrices(env, symbols, date) {
  const url = new URL("https://asset-app.local/quote");
  url.searchParams.set("symbols", symbols.join(","));
  const res = await quoteGet({ request: new Request(url), env });
  const data = await res.json().catch(() => null);
  const prices = usablePrices(data, date);
  const end = Date.parse(date + "T16:00:00Z");
  const quotes = data?.quotes || {};
  for (const [symbol,q] of Object.entries(quotes)) {
    if (/^[0-9]/.test(symbol)) continue;
    const at = Date.parse(q?.asOfDate || "");
    if (Number(q?.price) > 0 && !q.isStale && q.intradayFresh !== false && Number.isFinite(at) && at <= end && end - at <= 4 * 86400000) prices[symbol] = Number(q.price);
  }
  return prices;
}

async function listSyncTokens(env) {
  const tokens = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const page = await env.health_kv.list({ prefix: SYNC_PREFIX, cursor });
    for (const k of page.keys || []) tokens.push(k.name.slice(SYNC_PREFIX.length));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return tokens;
}

async function readSnapshot(env, token) {
  const raw = await env.health_kv.get(SYNC_PREFIX + token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function lineConfigured(env) {
  return Boolean(env?.LINE_CHANNEL_ACCESS_TOKEN && env?.LINE_USER_ID);
}

export async function pushLine(env, text, fetchImpl = fetch) {
  if (!lineConfigured(env)) return { ok: false, skipped: "line_not_configured" };
  const res = await fetchImpl("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: "text", text }] }),
  });
  return { ok: res.ok, status: res.status };
}

/** 13:36、13:45：今天是開盤日、還沒記錄 → LINE 提醒。 */
export async function runDailyReminder(env, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const t = taipeiParts(now);
  if (!REMINDER_MINUTES.includes(t.minuteOfDay)) return { skipped: "not_reminder_minute" };
  if (t.weekday === 0 || t.weekday === 6) return { skipped: "weekend" };
  if (!lineConfigured(env) || !env.LINE_REMINDER_SYNC_TOKEN || !env.health_kv) return { skipped: "line_not_configured" };
  const marketClosed = deps.marketClosed || defaultMarketClosed;
  if ((await marketClosed(t.date)) === true) return { skipped: "holiday" };
  const snapshot = await readSnapshot(env, env.LINE_REMINDER_SYNC_TOKEN);
  if (snapshot && hasRecordFor(snapshot, t.date)) return { skipped: "already_recorded" };
  const hhmm = `${Math.floor(t.minuteOfDay / 60)}:${String(t.minuteOfDay % 60).padStart(2, "0")}`;
  const last = t.minuteOfDay >= 13 * 60 + 45;
  const text = `📒 記帳提醒（${hhmm}）\n今天還沒記錄每日資產。\n打開存股 App →「每日紀錄」，數字已自動帶好，確認後按一次儲存。`
    + (last ? `\n14:00 還沒記的話，系統會用收盤價自動幫你記，之後可以再改。` : "")
    + `\n${APP_URL}`;
  const sent = await pushLine(env, text, deps.fetch || fetch);
  return { ok: sent.ok, sent: true };
}

/** 14:00：每個還沒記錄今天的同步帳號，用收盤價算好今天的紀錄暫存起來。 */
export async function runAutoDaily(env, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const t = taipeiParts(now);
  if (!env?.health_kv) return { ok: false, reason: "no_kv" };
  if (t.weekday === 0 || t.weekday === 6) return { skipped: "weekend" };
  const marketClosed = deps.marketClosed || defaultMarketClosed;
  if ((await marketClosed(t.date)) === true) return { skipped: "holiday" };

  const tokens = deps.tokens ? await deps.tokens() : await listSyncTokens(env);
  const pending = [];
  for (const token of tokens) {
    const snapshot = await readSnapshot(env, token);
    if (!snapshot || hasRecordFor(snapshot, t.date)) continue;
    pending.push({ token, snapshot });
  }
  if (!pending.length) return { ok: true, written: 0 };

  const symbols = [...new Set(pending.flatMap(({ snapshot }) => (snapshot.holdings || []).map((h) => h?.symbol).filter(Boolean)))];
  const fetchPrices = deps.fetchPrices || ((syms) => defaultFetchPrices(env, syms, t.date));
  // usablePrices 只留「今天、非過期」的價格：休市日或報價還沒更新時會是空的，就不記。
  if (symbols.some((s) => !/^[0-9]/.test(s))) symbols.push("USDTWD");
  const prices = symbols.length ? await fetchPrices(symbols) : {};

  let written = 0;
  const results = [];
  for (const { token, snapshot } of pending) {
    const built = buildAutoRecord(snapshot, prices, t.date);
    if (!built.ok) { results.push({ reason: built.reason }); continue; }
    let stored = {};
    try { stored = JSON.parse((await env.health_kv.get(AUTO_PREFIX + token)) || "{}"); } catch { stored = {}; }
    const kept = Object.fromEntries(Object.entries(stored.records || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, KEEP_DAYS - 1));
    kept[t.date] = built.record;
    await env.health_kv.put(AUTO_PREFIX + token, JSON.stringify({ records: kept, updatedAt: new Date().toISOString() }), { expirationTtl: AUTO_TTL_SECONDS });
    written++;
    results.push({ ok: true });
    if (token === env.LINE_REMINDER_SYNC_TOKEN && lineConfigured(env)) {
      const r = built.record;
      await pushLine(env, `🤖 已用收盤價自動記錄今天的資產\n總資產 NT$ ${(r.twValue + r.usValue).toLocaleString("en-US")}\n打開 App 會自動收進「每日紀錄」，要改就直接改、再按更新。\n${APP_URL}`, deps.fetch || fetch).catch(() => null);
    }
  }
  return { ok: true, written, results };
}

/** GET /api/auto-daily（Authorization: Bearer <同步 token>）：App 打開時來拿伺服器暫存的自動紀錄。 */
export async function onRequestGet({ request, env }) {
  const auth = request.headers.get("authorization") || "";
  const token = /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return json({ error: "缺少或不合法的同步 token" }, 401);
  if (!env?.health_kv) return json({ error: "KV not configured" }, 500);
  let stored = {};
  try { stored = JSON.parse((await env.health_kv.get(AUTO_PREFIX + token)) || "{}"); } catch { stored = {}; }
  const list = Object.values(stored.records || {}).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  return json({ ok: true, records: list });
}

