/**
 * 既有 08:00／14:00 排程的主動異常偵測。
 * 14:00：擁有者 App 內＋既有 LINE 推播；百分比跌幅預設 3%。
 * 舊 webhook 仍為選用，摘要只含事件類別，不帶代號、金額或個資。
 * 不新增 cron、不使用盤中每分鐘資料；通知失敗不影響自動記帳。
 * KV 非交易儲存，lease/cooldown 為 best effort，並非 exactly-once。
 */
import { marketClosed as defaultMarketClosed } from "./market-calendar.js";
import { lineConfigured, pushLine } from "./auto-daily.js";
import { calculateConcentration } from "./concentration.js";
import { RISK_PREFIX } from "./portfolio-risk.js";

export const SOURCE = "New-version-stack-app";
export const SCHEMA_VERSION = 1;
export const HOOK_DAILY_HEALTH = "daily_health";
export const HOOK_AFTER_CLOSE = "after_close";

export const STATE_KEY = "proactive-anomaly:v1";
export const STATE_TTL_SECONDS = 14 * 24 * 60 * 60;
export const MAX_STATE_INCIDENTS = 40;
export const MAX_SEEN_PENDING = 20;
export const MAX_SCAN_KEYS = 20;
export const MAX_SENDS_PER_RUN = 12;
export const MAX_ATTEMPTS = 3;
/** 成功送出後，同一個 event_id 多久內不再送。兩個每日排程相隔 6 小時，20 小時可避開同一天連送兩次。 */
export const COOLDOWN_MS = 20 * 60 * 60 * 1000;
/** 失敗後至少隔這麼久才再試。排程本身間隔更長；這是避免同一次執行裡緊接著重試。 */
export const RETRY_GAP_MS = 15 * 60 * 1000;
export const LEASE_MS = 45 * 1000;
export const WEBHOOK_TIMEOUT_MS = 3000;
/** 與 ai-connector-prepared.js 的 SYNC_STALE_MINUTES 相同：超過 72 小時才算同步過舊。 */
export const SYNC_STALE_MINUTES = 72 * 60;
/** 收盤後才把報價當成「單日」：13:30 台北，對齊 App 收盤提醒。 */
export const CLOSE_FRESH_MINUTE = 13 * 60 + 30;
export const PCT_MAX = 100;
export const DEFAULT_DECLINE_PCT = 3;
/** 輸入檢查上限，不是風險承受度。超過視為設定無效。 */
export const MONEY_MAX = 1e12;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID_RE = /^[a-z0-9:_-]{8,80}$/i;
const CARD_ID_RE = /^hc_[A-Za-z0-9_-]{1,40}$/;
const SYNC_KEY_RE = /^portfolio-sync:[A-Za-z0-9_-]+$/;
const PENDING_KEY_RE = /^pending-trades:[A-Za-z0-9_-]+$/;

export const SUMMARIES = Object.freeze({
  portfolio_day_decline: "Portfolio same-day price change crossed a configured decline threshold.",
  stock_day_decline: "An individual holding's same-day price change crossed a configured decline threshold.",
  concentration_single: "A holding crossed the single-position concentration threshold.",
  concentration_top3: "The top three holdings crossed the concentration threshold.",
  pending_trade_open: "A trade is waiting for confirmation in the app.",
  pending_trade_cleared: "A trade left the pending-confirmation queue.",
  system_ai_health: "The AI health check has an open system card.",
  system_price_quality: "Intraday quote quality has an open system card.",
  system_intraday_collector: "The intraday collector reported a failed run.",
  sync_stale: "A portfolio sync snapshot is older than the freshness window.",
});

const PAYLOAD_KEYS = ["schema_version", "event_id", "source", "event_type", "severity", "summary", "occurred_at"];

export function taipeiParts(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: t.toISOString().slice(0, 10),
    weekday: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

function freshClock(iso, day) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return false;
  const p = taipeiParts(new Date(ms));
  return p.date === day && p.minuteOfDay >= CLOSE_FRESH_MINUTE;
}

/** 正數、十進位。空值是「沒設定」；其他不合格是「設定無效」。都不會改成預設門檻。 */
export function parseOptInNumber(raw, { max = MONEY_MAX } = {}) {
  if (raw == null) return { ok: false, reason: "unset" };
  const text = String(raw).trim();
  if (!text) return { ok: false, reason: "unset" };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, reason: "invalid" };
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > max) return { ok: false, reason: "invalid" };
  return { ok: true, value: n };
}

export function readThresholds(env) {
  const specs = [
    ["portfolio", "pct", "PROACTIVE_PORTFOLIO_DECLINE_PCT", PCT_MAX],
    ["portfolio", "twd", "PROACTIVE_PORTFOLIO_DECLINE_TWD", MONEY_MAX],
    ["stock", "pct", "PROACTIVE_STOCK_DECLINE_PCT", PCT_MAX],
    ["stock", "twd", "PROACTIVE_STOCK_DECLINE_TWD", MONEY_MAX],
  ];
  const out = {
    portfolio: { pct: null, twd: null, enabled: false },
    stock: { pct: null, twd: null, enabled: false },
    invalid: [],
  };
  for (const [group, field, name, max] of specs) {
    const parsed = parseOptInNumber(env?.[name], { max });
    if (parsed.ok) out[group][field] = parsed.value;
    else if (parsed.reason === "invalid") out.invalid.push(name);
  }
  out.portfolio.enabled = out.portfolio.pct != null || out.portfolio.twd != null;
  out.stock.enabled = out.stock.pct != null || out.stock.twd != null;
  return out;
}

/** App／LINE 預設 3%；舊 webhook 保持 opt-in，不做門檻遷移。 */
export function readOwnerThresholds(env) {
  const overrides = {};
  for (const name of ["PROACTIVE_PORTFOLIO_DECLINE_PCT", "PROACTIVE_STOCK_DECLINE_PCT"]) {
    overrides[name] = env?.[name] == null || String(env[name]).trim() === "" ? DEFAULT_DECLINE_PCT : env[name];
  }
  return readThresholds(overrides);
}

export function webhookConfig(env) {
  const urlRaw = String(env?.PROACTIVE_WEBHOOK_URL || "").trim();
  const key = String(env?.PROACTIVE_WEBHOOK_KEY || "").trim();
  if (!urlRaw || !key) return { ok: false, reason: "disabled" };
  if (key.length < 16 || key.length > 256 || /\s/.test(key)) return { ok: false, reason: "invalid_secret" };
  let parsed;
  try { parsed = new URL(urlRaw); } catch { return { ok: false, reason: "invalid_url" }; }
  if (parsed.protocol !== "https:") return { ok: false, reason: "not_https" };
  if (parsed.username || parsed.password) return { ok: false, reason: "url_credentials" };
  if (parsed.search || parsed.hash) return { ok: false, reason: "url_query_or_hash" };
  if (!parsed.hostname) return { ok: false, reason: "invalid_url" };
  return { ok: true, url: parsed.origin + parsed.pathname, key };
}

/**
 * 與 src/app.jsx quoteDayChange 相同的加減：每檔 (現價 − 昨收) × 股數，再除以昨收市值。
 * 不是「今天總資產 − 昨天每日紀錄」（那個會把出入金算進去）。
 */
export function portfolioPriceChange(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let change = 0;
  let base = 0;
  for (const it of items) {
    const p = Number(it?.price);
    const pc = Number(it?.prevClose);
    const n = Number(it?.shares);
    if (!(p > 0) || !(pc > 0) || !(n > 0)) return null;
    change += (p - pc) * n;
    base += pc * n;
  }
  if (!(base > 0)) return null;
  return { change, base, pct: (change / base) * 100 };
}

function crossesPct(change, base, thresholdPct) {
  if (thresholdPct == null || !(base > 0)) return false;
  return change * 100 <= -thresholdPct * base;
}

function crossesMoney(change, thresholdTwd) {
  if (thresholdTwd == null) return false;
  return change <= -thresholdTwd;
}

function gateHit(change, base, gates) {
  if (!gates?.enabled) return false;
  return crossesPct(change, base, gates.pct) || crossesMoney(change, gates.twd);
}

function makeIncident(eventType, eventId, severity) {
  return { event_type: eventType, event_id: eventId, severity };
}

function isTwSymbol(symbol) {
  return /^[0-9]/.test(symbol || "");
}

function quoteFresh(q, day, failed) {
  if (!q || failed || q.stale || q.noPrev || !q.last) return false;
  if (!(Number(q.price) > 0) || !(Number(q.prevClose) > 0)) return false;
  return freshClock(q.asOfDate, day);
}

export function evaluateSnapshot(snap, day, thresholds) {
  if (!freshClock(snap?.syncedAt, day) || !freshClock(snap?.liveAt, day)) {
    return { portfolio: false, stock: false, reason: "stale_snapshot" };
  }
  const holdings = Array.isArray(snap.holdings) ? snap.holdings : [];
  const tw = holdings.filter((h) => isTwSymbol(h.symbol) && Number(h.shares) > 0);
  const us = holdings.some((h) => h.symbol && !isTwSymbol(h.symbol) && Number(h.shares) > 0);
  const failed = new Set(snap.failedSymbols || []);
  let stock = false;
  let incomplete = false;
  const items = [];
  for (const h of tw) {
    const q = snap.quotes?.[h.symbol];
    if (!quoteFresh(q, day, failed.has(h.symbol))) {
      incomplete = true;
      continue;
    }
    const price = Number(q.price);
    const prevClose = Number(q.prevClose);
    const shares = Number(h.shares);
    const change = (price - prevClose) * shares;
    const base = prevClose * shares;
    if (gateHit(change, base, thresholds.stock)) stock = true;
    items.push({ price, prevClose, shares });
  }
  if (us) return { portfolio: false, stock, reason: stock ? null : "us_holdings_not_in_snapshot" };
  if (!tw.length) return { portfolio: false, stock: false, reason: "no_tw_holdings" };
  if (incomplete || items.length !== tw.length) {
    return { portfolio: false, stock, reason: stock ? null : "incomplete_quotes" };
  }
  if (!thresholds.portfolio.enabled) {
    return { portfolio: false, stock, reason: stock ? null : "portfolio_thresholds_disabled" };
  }
  const dayChange = portfolioPriceChange(items);
  if (!dayChange) return { portfolio: false, stock, reason: stock ? null : "incomplete_quotes" };
  const portfolio = gateHit(dayChange.change, dayChange.base, thresholds.portfolio);
  return { portfolio, stock, reason: portfolio || stock ? null : "no_breach" };
}

export function evaluateDeclines({ now, marketClosed, thresholds, snapshots, hook }) {
  const t = taipeiParts(now);
  if (hook !== HOOK_AFTER_CLOSE) return { reason: "not_close_hook", incidents: [] };
  if (t.weekday === 0 || t.weekday === 6) return { reason: "weekend", incidents: [] };
  if (marketClosed === true) return { reason: "holiday", incidents: [] };
  if (marketClosed !== false) return { reason: "calendar_unknown", incidents: [] };
  if (t.minuteOfDay < CLOSE_FRESH_MINUTE) return { reason: "before_close_window", incidents: [] };
  if (!thresholds?.portfolio?.enabled && !thresholds?.stock?.enabled) {
    return { reason: "thresholds_disabled", incidents: [] };
  }
  const incidents = [];
  let portfolio = false;
  let stock = false;
  let reason = snapshots?.length ? "no_breach" : "no_snapshot";
  for (const snap of snapshots || []) {
    const result = evaluateSnapshot(snap, t.date, thresholds);
    if (result.portfolio) portfolio = true;
    if (result.stock) stock = true;
    if (!result.portfolio && !result.stock && result.reason) reason = result.reason;
  }
  if (portfolio) incidents.push(makeIncident("portfolio_day_decline", `portfolio-day-decline:${t.date}`, "warning"));
  if (stock) incidents.push(makeIncident("stock_day_decline", `stock-day-decline:${t.date}`, "warning"));
  return { reason: incidents.length ? null : reason, incidents };
}

export function systemIncidents({ now, cards, intradayStatus }) {
  const day = taipeiParts(now).date;
  const out = [];
  for (const card of cards || []) {
    if (card?.status !== "pending" || !CARD_ID_RE.test(card.id || "")) continue;
    if (card.kind === "price") out.push(makeIncident("system_price_quality", `health-price:${card.id}`, "warning"));
    else if (card.kind === "ai") out.push(makeIncident("system_ai_health", `health-ai:${card.id}`, "warning"));
  }
  const kind = String(intradayStatus?.kind || "");
  const last = Date.parse(intradayStatus?.lastAt || "");
  if ((kind === "error" || kind.startsWith("failed:")) && Number.isFinite(last) && taipeiParts(new Date(last)).date === day) {
    out.push(makeIncident("system_intraday_collector", `intraday-collector:${day}`, "warning"));
  }
  return out;
}

export function syncIncidents(snapshots, now) {
  const stale = (snapshots || []).some((s) => {
    const at = Date.parse(s?.syncedAt || "");
    if (!Number.isFinite(at)) return false;
    const ageMinutes = Math.round((now.getTime() - at) / 60000);
    return ageMinutes > SYNC_STALE_MINUTES;
  });
  if (!stale) return [];
  return [makeIncident("sync_stale", `sync-stale:${taipeiParts(now).date}`, "warning")];
}

export function pendingIdsFromRaw(raw) {
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const ids = [];
  for (const item of list) {
    const id = item && typeof item.id === "string" ? item.id : "";
    if (UUID_RE.test(id)) ids.push(id);
  }
  return ids;
}

export function pendingIncidents(openIds, seenIds) {
  const open = [];
  const seenOpen = new Set();
  for (const id of openIds || []) {
    if (!UUID_RE.test(id) || seenOpen.has(id)) continue;
    seenOpen.add(id);
    open.push(id);
    if (open.length >= MAX_SEEN_PENDING) break;
  }
  const incidents = open.map((id) => makeIncident("pending_trade_open", `pending-open:${id}`, "info"));
  for (const id of seenIds || []) {
    if (!UUID_RE.test(id) || seenOpen.has(id)) continue;
    incidents.push(makeIncident("pending_trade_cleared", `pending-cleared:${id}`, "info"));
  }
  return { incidents, openIds: open };
}

export function buildPayload(incident, now) {
  const summary = SUMMARIES[incident?.event_type];
  if (!summary || !["info", "warning", "critical"].includes(incident?.severity)) return null;
  if (!EVENT_ID_RE.test(incident.event_id || "")) return null;
  const occurred = now instanceof Date ? now.toISOString() : "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurred)) return null;
  return {
    schema_version: SCHEMA_VERSION,
    event_id: incident.event_id,
    source: SOURCE,
    event_type: incident.event_type,
    severity: incident.severity,
    summary,
    occurred_at: occurred,
  };
}

function payloadSafe(payload, key) {
  if (!payload || typeof payload !== "object") return false;
  const keys = Object.keys(payload);
  if (keys.length !== PAYLOAD_KEYS.length || PAYLOAD_KEYS.some((k) => !Object.prototype.hasOwnProperty.call(payload, k))) return false;
  if (payload.schema_version !== 1 || payload.source !== SOURCE) return false;
  if (payload.summary !== SUMMARIES[payload.event_type]) return false;
  if (!["info", "warning", "critical"].includes(payload.severity)) return false;
  if (typeof payload.event_id !== "string" || payload.event_id.includes(key)) return false;
  return true;
}

export async function postWebhook({ url, key, payload, fetchImpl, timeoutMs = WEBHOOK_TIMEOUT_MS }) {
  if (!payloadSafe(payload, key)) return { ok: false, status: 0, rejected: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "X-Proactive-Key": key,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const status = Number(res?.status) || 0;
    if (status < 200 || status >= 300) return { ok: false, status };
    return { ok: true, status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export function deliveryDecision(record, nowMs) {
  if (!record) return "send";
  const lease = Date.parse(record.leaseUntil || "");
  if (Number.isFinite(lease) && lease > nowMs) return "in_flight";
  // LINE 預先持久化的保守保留期：結果寫入遺失也不能只因 lease 到期就重送。
  const reserved = Date.parse(record.reservedUntil || "");
  if (Number.isFinite(reserved) && nowMs < reserved) return "cooldown";
  if ((Number(record.attempts) || 0) >= MAX_ATTEMPTS) return "exhausted";
  if (record.deliveredAt) {
    const parsed = Date.parse(record.cooldownUntil || "");
    const until = Number.isFinite(parsed) ? parsed : Date.parse(record.deliveredAt) + COOLDOWN_MS;
    if (Number.isFinite(until) && nowMs < until) return "cooldown";
  }
  const last = Date.parse(record.lastAttemptAt || "");
  if ((Number(record.attempts) || 0) > 0 && Number.isFinite(last) && nowMs - last < RETRY_GAP_MS) return "retry_gap";
  return "send";
}

function emptyState() {
  return { incidents: {}, seenPending: [], rotate: 0 };
}

function loadState(raw) {
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  const state = emptyState();
  if (!data || typeof data !== "object") return state;
  for (const [id, rec] of Object.entries(data.incidents || {})) {
    if (!EVENT_ID_RE.test(id) || !rec || typeof rec !== "object") continue;
    state.incidents[id] = {
      event_type: typeof rec.event_type === "string" && SUMMARIES[rec.event_type] ? rec.event_type : "",
      attempts: Number.isFinite(Number(rec.attempts)) ? Number(rec.attempts) : 0,
      lastAttemptAt: typeof rec.lastAttemptAt === "string" ? rec.lastAttemptAt : null,
      deliveredAt: typeof rec.deliveredAt === "string" ? rec.deliveredAt : null,
      cooldownUntil: typeof rec.cooldownUntil === "string" ? rec.cooldownUntil : null,
      leaseUntil: typeof rec.leaseUntil === "string" ? rec.leaseUntil : null,
      reservedUntil: typeof rec.reservedUntil === "string" ? rec.reservedUntil : null,
    };
  }
  state.seenPending = Array.isArray(data.seenPending)
    ? data.seenPending.filter((id) => UUID_RE.test(id)).slice(0, MAX_SEEN_PENDING)
    : [];
  state.rotate = Number.isFinite(Number(data.rotate)) ? Number(data.rotate) : 0;
  return state;
}

export function boundIncidents(incidents) {
  const entries = Object.entries(incidents || {});
  if (entries.length <= MAX_STATE_INCIDENTS) return { ...(incidents || {}) };
  entries.sort((a, b) => String(a[1]?.lastAttemptAt || "").localeCompare(String(b[1]?.lastAttemptAt || "")));
  return Object.fromEntries(entries.slice(-MAX_STATE_INCIDENTS));
}

function publicState(state) {
  return {
    v: 1,
    incidents: boundIncidents(state.incidents),
    seenPending: (state.seenPending || []).slice(0, MAX_SEEN_PENDING),
    rotate: Number(state.rotate) || 0,
  };
}

async function saveState(env, state) {
  try {
    await env.health_kv.put(STATE_KEY, JSON.stringify(publicState(state)), { expirationTtl: STATE_TTL_SECONDS });
    return true;
  } catch {
    console.warn("proactive webhook state write failed");
    return false;
  }
}

function noteLease(state, incident, now) {
  const prev = state.incidents[incident.event_id] || {};
  state.incidents[incident.event_id] = {
    event_type: incident.event_type,
    attempts: Number(prev.attempts) || 0,
    lastAttemptAt: prev.lastAttemptAt || null,
    deliveredAt: prev.deliveredAt || null,
    cooldownUntil: prev.cooldownUntil || null,
    leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(),
  };
}

function noteSuccess(state, incident, now) {
  const at = now.toISOString();
  state.incidents[incident.event_id] = {
    event_type: incident.event_type,
    attempts: 0,
    lastAttemptAt: at,
    deliveredAt: at,
    cooldownUntil: new Date(now.getTime() + COOLDOWN_MS).toISOString(),
    leaseUntil: null,
  };
}

function noteFailure(state, incident, now) {
  const prev = state.incidents[incident.event_id] || {};
  state.incidents[incident.event_id] = {
    event_type: incident.event_type,
    attempts: (Number(prev.attempts) || 0) + 1,
    lastAttemptAt: now.toISOString(),
    deliveredAt: prev.deliveredAt || null,
    cooldownUntil: prev.deliveredAt ? (prev.cooldownUntil || null) : null,
    leaseUntil: null,
  };
}

function selectBatch(incidents, state) {
  if (incidents.length <= MAX_SENDS_PER_RUN) return { batch: incidents, rotateChanged: false };
  const prev = Number(state.rotate) || 0;
  const offset = ((prev % incidents.length) + incidents.length) % incidents.length;
  const ordered = incidents.slice(offset).concat(incidents.slice(0, offset));
  const next = (offset + MAX_SENDS_PER_RUN) % incidents.length;
  state.rotate = next;
  return { batch: ordered.slice(0, MAX_SENDS_PER_RUN), rotateChanged: next !== prev };
}

function safeType(type) {
  return Object.prototype.hasOwnProperty.call(SUMMARIES, type) ? type : "unknown";
}

async function deliverAll(env, incidents, state, cfg, fetchImpl, now) {
  const sent = [];
  const withheld = [];
  const failed = [];
  const selected = selectBatch(incidents, state);
  for (const incident of selected.batch) {
    const decision = deliveryDecision(state.incidents[incident.event_id], now.getTime());
    if (decision !== "send") {
      withheld.push(decision);
      continue;
    }
    const payload = buildPayload(incident, now);
    if (!payload) {
      noteFailure(state, incident, now);
      await saveState(env, state);
      failed.push(safeType(incident.event_type));
      continue;
    }
    noteLease(state, incident, now);
    if (!(await saveState(env, state))) {
      failed.push(safeType(incident.event_type));
      continue;
    }
    const result = await postWebhook({ url: cfg.url, key: cfg.key, payload, fetchImpl, timeoutMs: WEBHOOK_TIMEOUT_MS });
    if (result.ok) {
      noteSuccess(state, incident, now);
      sent.push(incident.event_type);
    } else {
      noteFailure(state, incident, now);
      failed.push(safeType(incident.event_type));
      console.warn(`proactive webhook delivery failed type=${safeType(incident.event_type)} status=${result.status || "network"}`);
    }
    await saveState(env, state);
  }
  return { sent, withheld, failed, rotateChanged: selected.rotateChanged };
}

async function listKeys(kv, prefix) {
  if (!kv?.list) return [];
  const keys = [];
  let cursor;
  for (let page = 0; page < 5 && keys.length < MAX_SCAN_KEYS; page += 1) {
    const res = await kv.list({ prefix, cursor });
    for (const k of res?.keys || []) {
      if (keys.length >= MAX_SCAN_KEYS) break;
      keys.push(k.name);
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return keys;
}

async function readRaw(kv, key) {
  try { return await kv.get(key); } catch { return null; }
}

function compactSnapshot(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const holdings = [];
  for (const h of Array.isArray(data.holdings) ? data.holdings : []) {
    const symbol = typeof h?.symbol === "string" ? h.symbol : "";
    const shares = Number(h?.shares);
    if (symbol && shares > 0) holdings.push({ symbol, shares });
  }
  const lp = data.dataset?.livePrices;
  const quotes = {};
  if (lp?.map && typeof lp.map === "object") {
    for (const [sym, q] of Object.entries(lp.map)) {
      if (!q || typeof q !== "object") continue;
      quotes[sym] = {
        price: Number(q.price),
        prevClose: Number(q.prevClose),
        stale: q.isStale === true,
        asOfDate: typeof q.asOfDate === "string" ? q.asOfDate : "",
        last: q.priceSource === "last",
        noPrev: q.warning === "no_prevClose_available",
      };
    }
  }
  const failedSymbols = Array.isArray(lp?.failedSymbols) ? lp.failedSymbols.filter((s) => typeof s === "string") : [];
  return {
    syncedAt: typeof data.syncedAt === "string" ? data.syncedAt : "",
    liveAt: typeof lp?.at === "string" ? lp.at : "",
    holdings,
    quotes,
    failedSymbols,
  };
}

function sanitizeCards(data) {
  const list = Array.isArray(data) ? data : [];
  return list.map((c) => ({
    id: typeof c?.id === "string" ? c.id : "",
    kind: c?.kind === "price" ? "price" : (c?.kind == null || c?.kind === "ai" ? "ai" : "other"),
    status: c?.status === "pending" ? "pending" : "other",
  }));
}

function sanitizeStatus(data) {
  if (!data || typeof data !== "object") return null;
  return {
    kind: typeof data.kind === "string" ? data.kind.slice(0, 40) : "",
    lastAt: typeof data.lastAt === "string" ? data.lastAt : "",
  };
}

function clearsDone(id, state) {
  const rec = state.incidents[`pending-cleared:${id}`];
  if (!rec) return false;
  return Boolean(rec.deliveredAt) || (Number(rec.attempts) || 0) >= MAX_ATTEMPTS;
}

function nextSeen(openIds, previous, state) {
  const next = [...openIds];
  for (const id of previous || []) {
    if (openIds.includes(id) || clearsDone(id, state)) continue;
    next.push(id);
  }
  return [...new Set(next)].filter((id) => UUID_RE.test(id)).slice(0, MAX_SEEN_PENDING);
}

async function readSnapshots(kv) {
  const snapshots = [];
  let keys = [];
  try { keys = await listKeys(kv, "portfolio-sync:"); } catch { return snapshots; }
  for (const key of keys) {
    if (!SYNC_KEY_RE.test(key)) continue;
    const snap = compactSnapshot(await readRaw(kv, key));
    if (snap) snapshots.push(snap);
  }
  return snapshots;
}

async function readPendingIds(kv) {
  const ids = [];
  let keys = [];
  try { keys = await listKeys(kv, "pending-trades:"); } catch { return ids; }
  for (const key of keys) {
    if (!PENDING_KEY_RE.test(key) || ids.length >= MAX_SEEN_PENDING) break;
    for (const id of pendingIdsFromRaw(await readRaw(kv, key))) {
      if (ids.length >= MAX_SEEN_PENDING) break;
      ids.push(id);
    }
  }
  return ids;
}

async function runInner(env, deps) {
  const hook = deps.hook;
  if (hook !== HOOK_DAILY_HEALTH && hook !== HOOK_AFTER_CLOSE) {
    return { ok: true, skipped: "hook_not_used", sent: [], withheld: [], failed: [], decline: null, invalidThresholds: [] };
  }
  const cfg = webhookConfig(env);
  if (!cfg.ok) {
    return { ok: true, skipped: cfg.reason, sent: [], withheld: [], failed: [], decline: null, invalidThresholds: readThresholds(env).invalid };
  }
  if (!env?.health_kv) {
    return { ok: true, skipped: "no_kv", sent: [], withheld: [], failed: [], decline: null, invalidThresholds: [] };
  }
  const now = typeof deps.now === "function" ? deps.now() : new Date();
  const thresholds = readThresholds(env);
  const state = loadState(await readRaw(env.health_kv, STATE_KEY));
  const snapshots = await readSnapshots(env.health_kv);
  let market = null;
  if (hook === HOOK_AFTER_CLOSE) {
    try {
      market = await (deps.marketClosed || defaultMarketClosed)(taipeiParts(now).date);
    } catch {
      market = null;
    }
  }
  const decline = evaluateDeclines({ now, marketClosed: market, thresholds, snapshots, hook });
  let cards = [];
  let intradayStatus = null;
  try {
    const rawCards = await readRaw(env.health_kv, "health:cards");
    cards = sanitizeCards(rawCards ? JSON.parse(rawCards) : []);
  } catch { cards = []; }
  try {
    const rawStatus = await readRaw(env.health_kv, "intraday-status");
    intradayStatus = sanitizeStatus(rawStatus ? JSON.parse(rawStatus) : null);
  } catch { intradayStatus = null; }
  const openIds = await readPendingIds(env.health_kv);
  const pending = pendingIncidents(openIds, state.seenPending);
  const incidents = [
    ...decline.incidents,
    ...systemIncidents({ now, cards, intradayStatus }),
    ...syncIncidents(snapshots, now),
    ...pending.incidents,
  ];
  const fetchImpl = deps.fetch || fetch;
  const delivery = await deliverAll(env, incidents, state, cfg, fetchImpl, now);
  const seen = nextSeen(pending.openIds, state.seenPending, state);
  const seenChanged = JSON.stringify(seen) !== JSON.stringify(state.seenPending);
  state.seenPending = seen;
  if (seenChanged || delivery.rotateChanged) await saveState(env, state);
  return {
    ok: true,
    skipped: null,
    sent: delivery.sent,
    withheld: delivery.withheld,
    failed: delivery.failed,
    decline: decline.reason,
    invalidThresholds: thresholds.invalid,
  };
}

const LINE_SUMMARIES = Object.freeze({
  portfolio_day_decline: "⚠️ 投資組合收盤跌幅達設定門檻。",
  stock_day_decline: "⚠️ 有持股收盤跌幅達設定門檻。",
  concentration_single: "⚠️ 有單一持股集中度超過設定門檻。",
  concentration_top3: "⚠️ 前三大持股集中度超過設定門檻。",
});

async function saveRisk(env, key, state) {
  try {
    await env.health_kv.put(key, JSON.stringify(state), { expirationTtl: STATE_TTL_SECONDS });
    return true;
  } catch { console.warn("portfolio risk state write failed"); return false; }
}

/** 結果最多寫三次；即使遇 429／暫時失敗也不在一秒內連續寫同 key。 */
async function saveRiskResult(env, key, state, lastAttemptAt) {
  for (const gap of [1100, 1100, 2200]) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, gap - (Date.now() - lastAttemptAt))));
    if (await saveRisk(env, key, state)) return true;
    lastAttemptAt = Date.now();
  }
  return false;
}

async function sendRiskLine(env, incident, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    return await pushLine(env, LINE_SUMMARIES[incident.event_type] + "\n請開啟資產 App 查看。僅供自我追蹤，非投資建議。",
      (url, options) => fetchImpl(url, { ...options, signal: controller.signal, redirect: "manual" }));
  } catch { return { ok: false, status: 0 }; }
  finally { clearTimeout(timer); }
}

/** 只處理明確設定的擁有者；絕不能把其他同步帳號的資料推到擁有者 LINE。 */
async function runOwnerAlerts(env, deps) {
  if (deps.hook !== HOOK_AFTER_CLOSE) return { skipped: "not_close_hook" };
  const token = String(env?.LINE_REMINDER_SYNC_TOKEN || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return { skipped: "owner_not_configured" };
  if (!env?.health_kv) return { skipped: "no_kv" };
  const now = deps.now ? deps.now() : new Date();
  const t = taipeiParts(now);
  if (t.weekday === 0 || t.weekday === 6 || t.minuteOfDay < CLOSE_FRESH_MINUTE) return { skipped: "outside_close_window" };
  let closed = null;
  try { closed = await (deps.marketClosed || defaultMarketClosed)(t.date); } catch { /* fail closed */ }
  if (closed !== false) return { skipped: closed === true ? "holiday" : "calendar_unknown" };
  // KV read failures must not be interpreted as an empty delivery ledger (would duplicate LINE).
  const raw = await env.health_kv.get(`portfolio-sync:${token}`);
  if (!raw) return { skipped: "no_snapshot" };
  const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  const concentration = calculateConcentration(snapshot);
  const thresholds = readOwnerThresholds(env);
  const compact = compactSnapshot(JSON.stringify(snapshot));
  const decline = evaluateDeclines({ now, marketClosed: false, thresholds, snapshots: compact ? [compact] : [], hook: deps.hook });
  const incidents = [...decline.incidents];
  // 舊快照可以在唯讀 API 明示來源，但不能拿來發今天的集中度超標通知。
  if (freshClock(snapshot.syncedAt, t.date) && concentration.status === "complete"
      && concentration.holdings.every((h) => freshClock(h.asOf, t.date))) {
    if (concentration.breaches.single) incidents.push(makeIncident("concentration_single", "concentration:single", "warning"));
    if (concentration.breaches.top3) incidents.push(makeIncident("concentration_top3", "concentration:top3", "warning"));
  }
  const key = RISK_PREFIX + token;
  const previous = await env.health_kv.get(key);
  const stored = previous ? JSON.parse(previous) : {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("invalid risk state");
  const app = loadState(JSON.stringify({ incidents: stored.appIncidents || {} }));
  const line = loadState(JSON.stringify({ incidents: stored.lineIncidents || {} }));
  const alerts = [];
  for (const incident of incidents) {
    if (deliveryDecision(app.incidents[incident.event_id], now.getTime()) === "send") noteSuccess(app, incident, now);
    // App 顯示當次偵測到的 active 類別，但冷卻內保留首次產生時間，不製造新事件。
    const occurred = app.incidents[incident.event_id]?.deliveredAt;
    alerts.push(buildPayload(incident, occurred ? new Date(occurred) : now));
  }
  const state = { updatedAt: now.toISOString(), sourceSyncedAt: snapshot.syncedAt || null,
    alerts, decline: { reason: decline.reason, invalidThresholds: thresholds.invalid },
    appIncidents: boundIncidents(app.incidents), lineIncidents: boundIncidents(line.incidents),
    line: { sent: [], withheld: [], failed: [], skipped: lineConfigured(env) ? null : "line_not_configured" } };
  const batch = [];
  for (const incident of lineConfigured(env) ? incidents : []) {
    const record = line.incidents[incident.event_id];
    // 集中度 event_id 是穩定類別；失敗三次後下一個冷卻週期仍可再試，不能永遠停送。
    if (record && Number(record.attempts) >= MAX_ATTEMPTS && now.getTime() - Date.parse(record.lastAttemptAt || "") >= COOLDOWN_MS) delete line.incidents[incident.event_id];
    const decision = deliveryDecision(line.incidents[incident.event_id], now.getTime());
    if (decision !== "send") { state.line.withheld.push(decision); continue; }
    noteLease(line, incident, now);
    // 不是 deliveredAt：先保留本次掃描起 20 小時，寧可漏報也不在結果遺失後重送。
    // 成功結果改存正式 cooldown；已知失敗結果則由 noteFailure 恢復原重試規則。
    line.incidents[incident.event_id].reservedUntil = new Date(now.getTime() + COOLDOWN_MS).toISOString();
    batch.push(incident);
  }
  // 重疊掃描若整批仍在發送，不能覆寫對方 ledger 或搶走其結果寫入的 KV 配額。
  if (incidents.length && state.line.withheld.length === incidents.length
      && state.line.withheld.every((decision) => decision === "in_flight")) return { skipped: null, ...state.line };
  // App 狀態與整批 lease 合併一次寫入；寫入成功前絕不送 LINE。
  state.lineIncidents = boundIncidents(line.incidents);
  if (!(await saveRisk(env, key, state))) return { skipped: "state_write_failed" };
  const leasedAt = Date.now();
  for (const incident of batch) {
    const sent = await sendRiskLine(env, incident, deps.fetch || fetch);
    if (sent.ok) { noteSuccess(line, incident, now); state.line.sent.push(incident.event_type); }
    else {
      noteFailure(line, incident, now);
      state.line.failed.push(incident.event_type);
      console.warn(`portfolio risk LINE delivery failed type=${safeType(incident.event_type)} status=${Number(sent.status) || "network"}`);
    }
  }
  if (batch.length) {
    state.lineIncidents = boundIncidents(line.incidents);
    if (!(await saveRiskResult(env, key, state, leasedAt))) return { skipped: "state_write_failed" };
  }
  return { skipped: null, ...state.line };
}

export async function runProactiveAnomalies(env, deps = {}) {
  let owner;
  try { owner = await runOwnerAlerts(env, deps); }
  catch { console.warn("portfolio risk scan failed"); owner = { skipped: "scan_error" }; }
  try {
    return { ...await runInner(env, deps), owner };
  } catch {
    console.warn("proactive anomaly scan failed");
    return { ok: false, skipped: "scan_error", sent: [], withheld: [], failed: [], decline: null, invalidThresholds: [], owner };
  }
}
