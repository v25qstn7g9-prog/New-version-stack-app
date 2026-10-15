/**
 * spider.js — GET /api/spider（唯讀）：給「蜘蛛圖」分頁，每檔持股 6 個參數。
 *
 * 權限：跟 /api/portfolio-sync GET 完全一樣（直接呼叫它的 handler 讀快照）：
 *   Authorization: Bearer <App 同步 token 或 SI_HUB_READ_TOKEN>。沒帶／格式不對 → 401，不回任何持股。
 *   不接受 ?token=（避免 token 進網址／log）。合法但沒快照的 token → ok:true, found:false, holdings:[]。
 *
 * 資料來源（全部沿用既有 handler；沒有真實來源就回 null，不補數字）：
 *   持股      portfolio-sync 快照 summary.holdings（symbol/name/shares）
 *   價格      /quote handler（price, prevClose）
 *   日K       /daily-history handler（close）
 *   配息紀錄  快照 summary.dataset.dividends（App 使用者實際登錄的 {symbol,date,perShare}）
 *   P/E、P/B  TWSE OpenAPI BWIBBU_ALL（上市個股；ETF/上櫃沒有 → null）。8 秒 timeout、caches.default 4 小時、失敗 → null。
 *
 * 公式（raw）與分數（score，0–100，越高越「好」，一律 clamp 到 0–100、raw 為 null 時 score 也是 null）：
 *   weight       市值占比 % = shares×price ÷ 有報價持股總市值 ×100。score = raw（占比本身，不代表好壞）。
 *   yield        近 365 天配息 Σ perShare ÷ 現價 ×100（%）；沒有配息紀錄時改用 BWIBBU DividendYield。
 *                score = yield ÷ 8% ×100（≥8% 滿分）。
 *   pe           BWIBBU PEratio；虧損/空白 → null。越低越好（便宜）：≤10 →100、≥40 →0、線性。
 *   pb           BWIBBU PBratio。越低越好（便宜）：≤1 →100、≥5 →0、線性。
 *   volatility   近 60 個交易日日報酬（對數）標準差 ×√252 ×100（年化 %），至少要 20 根。
 *                越低越好（穩）：0% →100、≥50% →0、線性。
 *   divStability 用配息紀錄的「每年 Σ perShare」，從第一筆配息年份到去年（完整年度，最多 5 年），沒配的年份算 0；
 *                raw = 100 ×(1 − min(1, 變異係數 CV))，至少 2 個完整年度，否則 null。score = raw。
 * mood：有報價持股的今日總市值漲跌 % = Σshares×(price−prevClose) ÷ Σshares×prevClose。
 *   > +0.3% → "up"，< −0.3% → "down"，其他或算不出來 → "flat"。
 */
import { onRequestGet as portfolioSyncGet } from "./portfolio-sync.js";
import { onRequestGet as quoteGet } from "./quote.js";
import { onRequestGet as dailyHistoryGet } from "./daily-history.js";
import { bearerToken } from "./request-guard.js";

export const AXES = ["yield", "pe", "pb", "volatility", "divStability", "weight"];
export const MOOD_THRESHOLD_PCT = 0.3;
const BWIBBU_URL = "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL";
const BWIBBU_CACHE_KEY = "https://internal-cache.example/spider-bwibbu-v1";
const BWIBBU_TTL_SECONDS = 4 * 60 * 60;
const FETCH_TIMEOUT_MS = 8000;
const VOL_WINDOW = 60, VOL_MIN_BARS = 20;

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
});
const num = (v) => { if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
export const clamp = (x) => (x == null || !Number.isFinite(x) ? null : Math.max(0, Math.min(100, x)));
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const linearLowBetter = (x, best, worst) => (x == null ? null : clamp(((worst - x) / (worst - best)) * 100));

export function taipeiIso(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().replace(/\.\d{3}Z$/, "+08:00");
}

export function moodFromPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct > MOOD_THRESHOLD_PCT) return "up";
  if (pct < -MOOD_THRESHOLD_PCT) return "down";
  return "flat";
}

export function annualizedVolatility(closes) {
  const c = (closes || []).map(Number).filter((x) => Number.isFinite(x) && x > 0).slice(-(VOL_WINDOW + 1));
  if (c.length < VOL_MIN_BARS + 1) return null;
  const r = [];
  for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const variance = r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function trailingDividendPerShare(dividends, symbol, today) {
  const since = new Date(Date.parse(today + "T00:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
  const rows = (dividends || []).filter((d) => String(d?.symbol || "").trim().toUpperCase() === symbol && String(d?.date || "") > since && String(d?.date || "") <= today && num(d?.perShare) > 0);
  return rows.length ? rows.reduce((s, d) => s + Number(d.perShare), 0) : null;
}

export function dividendStability(dividends, symbol, today) {
  const lastYear = Number(today.slice(0, 4)) - 1;
  const byYear = new Map();
  for (const d of dividends || []) {
    if (String(d?.symbol || "").trim().toUpperCase() !== symbol) continue;
    const y = Number(String(d?.date || "").slice(0, 4)), ps = num(d?.perShare);
    if (!Number.isFinite(y) || ps == null || ps <= 0 || y > lastYear) continue;
    byYear.set(y, (byYear.get(y) || 0) + ps);
  }
  if (!byYear.size) return null;
  const first = Math.max(Math.min(...byYear.keys()), lastYear - 4);
  const years = [];
  for (let y = first; y <= lastYear; y++) years.push(byYear.get(y) || 0);
  if (years.length < 2) return null;
  const mean = years.reduce((s, x) => s + x, 0) / years.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(years.reduce((s, x) => s + (x - mean) ** 2, 0) / years.length);
  return 100 * (1 - Math.min(1, sd / mean));
}

export function scoreAxes(raw) {
  return {
    yield: raw.yield == null ? null : clamp((raw.yield / 8) * 100),
    pe: raw.pe == null || raw.pe <= 0 ? null : linearLowBetter(raw.pe, 10, 40),
    pb: raw.pb == null || raw.pb <= 0 ? null : linearLowBetter(raw.pb, 1, 5),
    volatility: linearLowBetter(raw.volatility, 0, 50),
    divStability: clamp(raw.divStability),
    weight: clamp(raw.weight),
  };
}

async function fetchWithTimeout(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; StockTracker/1.0)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// { code: { pe, pb, yield } }；任何失敗回 null（呼叫端全部當 null 處理）。
export async function readValuation(fetchImpl = fetch) {
  const cache = globalThis.caches?.default;
  const key = new Request(BWIBBU_CACHE_KEY);
  try { const hit = cache && (await cache.match(key)); if (hit) return await hit.json(); } catch { /* 快取可有可無 */ }
  try {
    const rows = await fetchWithTimeout(BWIBBU_URL, fetchImpl);
    if (!Array.isArray(rows) || !rows.length) return null;
    const map = {};
    for (const r of rows) {
      const code = String(r?.Code || "").trim().toUpperCase();
      if (code) map[code] = { pe: num(r.PEratio), pb: num(r.PBratio), yield: num(r.DividendYield) };
    }
    try { if (cache) await cache.put(key, new Response(JSON.stringify(map), { headers: { "content-type": "application/json", "cache-control": `max-age=${BWIBBU_TTL_SECONDS}` } })); } catch { /* 略過 */ }
    return map;
  } catch { return null; }
}

function defaultDeps(env) {
  const call = async (handler, url) => {
    const res = await handler({ request: new Request(url), env, ctx: { waitUntil() {} } });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  };
  return {
    readPortfolio: async (token) => {
      const res = await portfolioSyncGet({ request: new Request("https://asset-app.local/api/portfolio-sync", { headers: { authorization: `Bearer ${token}` } }), env });
      return { status: res.status, data: await res.json().catch(() => null) };
    },
    readQuotes: (symbols) => call(quoteGet, `https://asset-app.local/quote?symbols=${encodeURIComponent(symbols.join(","))}`),
    readHistory: (symbols) => call(dailyHistoryGet, `https://asset-app.local/daily-history?symbols=${encodeURIComponent(symbols.join(","))}`),
    readValuation: () => readValuation(),
    now: () => new Date(),
  };
}

const safe = async (fn) => { try { return await fn(); } catch { return null; } };

export async function buildSpider(token, deps) {
  const now = deps.now ? deps.now() : new Date();
  const asOf = taipeiIso(now), today = asOf.slice(0, 10);
  const base = { ok: true, asOf, mood: "flat", axes: AXES };
  const p = await deps.readPortfolio(token);
  if (p.status >= 400 || !p.data) return { status: p.status === 400 ? 401 : p.status || 500, body: { ok: false, error: p.data?.error || "portfolio unavailable" } };
  if (!p.data.found || !p.data.summary) return { status: 200, body: { ...base, found: false, reason: p.data.reason || null, holdings: [] } };

  const summary = p.data.summary;
  const list = (Array.isArray(summary.holdings) ? summary.holdings : [])
    .map((h) => ({ code: String(h?.symbol || "").trim().toUpperCase(), name: String(h?.name || ""), shares: num(h?.shares) }))
    .filter((h) => /^[0-9]{4,6}[A-Z]?$/.test(h.code) && h.shares > 0);
  const codes = [...new Set(list.map((h) => h.code))].slice(0, 30);
  const dividends = Array.isArray(summary?.dataset?.dividends) ? summary.dataset.dividends : [];
  const [q, hist, val] = codes.length
    ? await Promise.all([safe(() => deps.readQuotes(codes)), safe(() => deps.readHistory(codes)), safe(() => deps.readValuation())])
    : [null, null, null];
  const quotes = q?.quotes && typeof q.quotes === "object" ? q.quotes : {};
  const bars = hist?.bars && typeof hist.bars === "object" ? hist.bars : {};

  let totalMv = 0, chg = 0, prevMv = 0;
  for (const h of list) {
    const price = num(quotes[h.code]?.price), prev = num(quotes[h.code]?.prevClose);
    h.price = price != null && price > 0 ? price : null;
    if (h.price != null) totalMv += h.shares * h.price;
    if (h.price != null && prev != null && prev > 0) { chg += h.shares * (h.price - prev); prevMv += h.shares * prev; }
  }

  const holdings = list.map((h) => {
    const v = val?.[h.code] || null;
    const dps = trailingDividendPerShare(dividends, h.code, today);
    const raw = {
      yield: dps != null && h.price != null ? (dps / h.price) * 100 : (v?.yield ?? null),
      pe: v?.pe != null && v.pe > 0 ? v.pe : null,
      pb: v?.pb != null && v.pb > 0 ? v.pb : null,
      volatility: annualizedVolatility((bars[h.code] || []).map((b) => b?.close)),
      divStability: dividendStability(dividends, h.code, today),
      weight: h.price != null && totalMv > 0 ? ((h.shares * h.price) / totalMv) * 100 : null,
    };
    const score = scoreAxes(raw);
    const r = {}, s = {};
    for (const k of AXES) { r[k] = round(raw[k]); s[k] = score[k] == null ? null : Math.round(score[k]); }
    return {
      code: h.code, name: h.name, raw: r, score: s,
      sources: { yield: dps != null && h.price != null ? "dividends" : (raw.yield != null ? "twse-bwibbu" : null) },
    };
  });
  const changePct = prevMv > 0 ? (chg / prevMv) * 100 : null;
  return { status: 200, body: { ...base, mood: moodFromPct(changePct), found: true, changePct: round(changePct, 3), syncedAt: summary.syncedAt || null, holdings } };
}

export async function onRequestGet({ request, env }, overrides = {}) {
  const token = bearerToken(request);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return json({ ok: false, error: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  try {
    const { status, body } = await buildSpider(token, { ...defaultDeps(env), ...overrides });
    return json(body, status);
  } catch (e) {
    return json({ ok: false, error: "spider unavailable", detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}
