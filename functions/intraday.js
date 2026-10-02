/**
 * functions/intraday.js — 盤中分時資料暫存（給 MCP 的 intraday_bars 用）
 *
 * 為什麼需要它：
 *   App 前端雖然每 15 秒讀一次價，但讀完就顯示、不保存；伺服器端也只有「最新一筆」
 *   的短暫快取，沒有任何分時歷史。這支模組讓 Cron Trigger 在台股盤中每分鐘醒來一次，
 *   在這一分鐘內每 15 秒取樣一次（共 4 筆），整理成 1 分鐘 K（開高低收）存進 KV。
 *   AI 要看 5／10／15 分 K 時，由 intraday_bars 從這些 1 分鐘 K 合成。
 *
 * 取樣只依賴既有的 /quote 邏輯（functions/quote.js，自帶 15 秒快取），不會多打證交所。
 *
 * KV：沿用 health_kv，不另外申請 namespace。
 *   intraday:<YYYY-MM-DD>   { v:1, day, bars:{ <代號>: [[HH:MM, o, h, l, c, n], ...] } }
 *   - 每天只有一個 key、每分鐘覆寫一次 → 一個交易日約 271 次寫入（帳號共用的 KV 每日寫入額度有限）
 *   - 36 小時 TTL：只暫存「今天（以及盤後／隔天早上還看得到昨天）」，之後自動消失
 *
 * 只寫在盤中（台北 09:00–13:30、週一到週五）；休市日抓到的報價不是今天的，會被丟掉、不寫入。
 */
import { onRequestGet as quoteGet } from "./quote.js";

// 每分鐘一次的盤中 cron（UTC 01:00–05:59 = 台北 09:00–13:59；程式內再收斂到 13:30）。
// 星期欄一定要用 MON-FRI：Cloudflare 的數字星期 1 = 週日，寫 1-5 會變成週日到週四、週五不跑。
// worker.js 用這個字串判斷是哪個 cron 觸發的，wrangler.jsonc 裡必須完全一樣。
export const INTRADAY_CRON = "* 1-5 * * MON-FRI";

export const DEFAULT_INTRADAY_SYMBOLS = ["0050", "0056", "2330", "TAIEX"];
export const ALLOWED_INTERVALS = [1, 5, 10, 15, 30, 60];

const KV_PREFIX = "intraday:";
const STATUS_KEY = "intraday-status";
// 同一種結果連續出現時，最多每 10 分鐘更新一次 lastAt，避免每分鐘多寫一次 KV。
const STATUS_REFRESH_MS = 10 * 60 * 1000;
const ARCHIVE_PREFIX = "intraday5:";
const TTL_SECONDS = 60 * 60 * 36;
// 90 個日曆天 ≈ 60 個交易日
const ARCHIVE_TTL_SECONDS = 90 * 24 * 60 * 60;
// 收盤後等幾分鐘再封存，讓最後一根 1 分 K（13:30）已寫進 KV 並傳播完成
const ARCHIVE_AFTER_MINUTE = 13 * 60 + 35;
const ARCHIVE_INTERVAL = 5;
const SAMPLES_PER_RUN = 4;
const SAMPLE_GAP_MS = 15 * 1000;
const OPEN_MINUTE = 9 * 60;
const CLOSE_MINUTE = 13 * 60 + 30;
const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;

// ── 時間 ────────────────────────────────────────────────

function taipei(now) {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    day: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    weekday: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
    label: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
}

/** 台北時間週一到週五 09:00–13:30（含）才記錄。 */
export function isRecordingWindow(now = new Date()) {
  const p = taipei(now);
  return p.weekday >= 1 && p.weekday <= 5 && p.minuteOfDay >= OPEN_MINUTE && p.minuteOfDay <= CLOSE_MINUTE;
}

function labelToMinute(label) {
  const m = /^(\d{2}):(\d{2})$/.exec(label || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function minuteToLabel(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

// ── 代號 ────────────────────────────────────────────────

export function intradaySymbols(env) {
  const raw = String(env?.INTRADAY_SYMBOLS || "");
  const list = raw
    ? raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => SYMBOL_RE.test(s))
    : DEFAULT_INTRADAY_SYMBOLS;
  const unique = [...new Set(list)].slice(0, 12);
  return unique.length ? unique : DEFAULT_INTRADAY_SYMBOLS;
}

// ── 純函式：取樣 → 1 分鐘 K → 合成 N 分 K ───────────────────

/** 一分鐘內的幾筆價格 → [HH:MM, o, h, l, c, n]；沒有有效價格回 null。 */
export function buildMinuteBar(label, prices) {
  const valid = (prices || []).filter((p) => Number.isFinite(p) && p > 0);
  if (!valid.length) return null;
  return [label, valid[0], Math.max(...valid), Math.min(...valid), valid[valid.length - 1], valid.length];
}

/** 把一根分鐘 K 併進當天資料（同一分鐘會覆寫，結果依時間排序）。 */
export function mergeBar(rows, bar) {
  const next = (rows || []).filter((r) => r[0] !== bar[0]);
  next.push(bar);
  next.sort((a, b) => labelToMinute(a[0]) - labelToMinute(b[0]));
  return next;
}

/**
 * 1 分鐘 K → N 分 K。以 09:00 為起點對齊（例如 5 分 K = 09:00、09:05 …）。
 * 每根的 samples 是它包含的 15 秒取樣總數，用來看資料密不密（缺漏時會偏低）。
 */
export function aggregateBars(rows, interval) {
  const out = [];
  let cur = null;
  for (const [label, o, h, l, c, n, m = 1] of rows || []) {
    const minute = labelToMinute(label);
    if (!Number.isFinite(minute)) continue;
    const start = OPEN_MINUTE + Math.floor((minute - OPEN_MINUTE) / interval) * interval;
    if (!cur || cur.startMinute !== start) {
      cur = { startMinute: start, time: minuteToLabel(start), open: o, high: h, low: l, close: c, samples: n, minutes: m };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, h);
      cur.low = Math.min(cur.low, l);
      cur.close = c;
      cur.samples += n;
      cur.minutes += m;
    }
  }
  return out.map(({ startMinute, ...bar }) => bar);
}

// ── 取價 ────────────────────────────────────────────────

async function defaultFetchQuotes(env, symbols) {
  const url = new URL("https://asset-app.local/quote");
  url.searchParams.set("symbols", symbols.join(","));
  const res = await quoteGet({ request: new Request(url), env });
  const data = await res.json().catch(() => null);
  return data && data.quotes ? data : { quotes: {} };
}

/** 從 /quote 回應裡挑出「今天的、非過期」的價格；休市日／過期資料回空物件。 */
export function usablePrices(data, today) {
  const out = {};
  for (const [sym, q] of Object.entries(data?.quotes || {})) {
    if (!q || q.isStale === true) continue;
    const price = Number(q.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const asOf = q.asOfDate ? new Date(q.asOfDate) : null;
    if (!asOf || Number.isNaN(asOf.getTime())) continue;
    if (taipei(asOf).day !== today) continue;
    out[sym] = price;
  }
  return out;
}

// ── 寫入（cron 每分鐘呼叫一次）────────────────────────────────

/**
 * 在這一分鐘內每 15 秒取樣一次，合成 1 分鐘 K 後寫進 KV。
 * 可注入 fetchQuotes / sleep / now 方便測試。
 */
export async function recordIntradayMinute(env, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  if (!env?.health_kv) return { ok: false, reason: "no_kv" };
  if (!isRecordingWindow(now)) return { ok: true, skipped: "outside_market_hours" };

  const symbols = intradaySymbols(env);
  const fetchQuotes = deps.fetchQuotes || ((syms) => defaultFetchQuotes(env, syms));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = taipei(now);

  // 一次取價就寫。Cron 若在函式裡睡 45 秒，免費方案常在 put 之前被掐掉。
  const samples = Object.fromEntries(symbols.map((s) => [s, []]));
  try {
    const prices = usablePrices(await fetchQuotes(symbols), start.day);
    for (const [sym, price] of Object.entries(prices)) if (samples[sym]) samples[sym].push(price);
  } catch {
    // 取價失敗就不寫入。
  }

  const bars = {};
  for (const sym of symbols) {
    const bar = buildMinuteBar(start.label, samples[sym]);
    if (bar) bars[sym] = bar;
  }
  if (!Object.keys(bars).length) return { ok: true, skipped: "no_fresh_quotes" };

  const key = KV_PREFIX + start.day;
  let doc = null;
  try {
    const raw = await env.health_kv.get(key);
    doc = raw ? JSON.parse(raw) : null;
  } catch {
    doc = null;
  }
  if (!doc || doc.day !== start.day || typeof doc.bars !== "object") doc = { v: 1, day: start.day, bars: {} };
  for (const [sym, bar] of Object.entries(bars)) doc.bars[sym] = mergeBar(doc.bars[sym], bar);

  await env.health_kv.put(key, JSON.stringify(doc), { expirationTtl: TTL_SECONDS });
  return { ok: true, recorded: Object.keys(bars), minute: start.label };
}


// ── 收盤封存 5 分 K（留約 60 個交易日）────────────────────────

export async function archiveIntradayDay(env, now = new Date()) {
  if (!env?.health_kv) return { ok: false, reason: "no_kv" };
  const p = taipei(now);
  // 13:35 之後封存「今天」；更早（例如每日 08:00 的 cron）封存「前一個日曆日」當保險，
  // 休市日沒有 1 分 K，會回 no_intraday。
  const day = p.minuteOfDay >= ARCHIVE_AFTER_MINUTE ? p.day : taipei(new Date(now.getTime() - 24 * 60 * 60 * 1000)).day;
  if (day === p.day && (p.weekday < 1 || p.weekday > 5)) return { ok: true, skipped: "weekend" };
  const archiveKey = ARCHIVE_PREFIX + day;
  try {
    const existing = await env.health_kv.get(archiveKey);
    if (existing) return { ok: true, skipped: "already_archived", day };
  } catch {
    // 讀封存失敗就當沒有，下面再寫一次。
  }

  let doc = null;
  try {
    const raw = await env.health_kv.get(KV_PREFIX + day);
    doc = raw ? JSON.parse(raw) : null;
  } catch {
    doc = null;
  }
  if (!doc || !doc.bars || typeof doc.bars !== "object") {
    return { ok: true, skipped: "no_intraday", day };
  }

  const bars = {};
  for (const [sym, rows] of Object.entries(doc.bars)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    bars[sym] = aggregateBars(rows, ARCHIVE_INTERVAL);
  }
  if (!Object.keys(bars).length) return { ok: true, skipped: "empty_bars", day };

  await env.health_kv.put(archiveKey, JSON.stringify({
    v: 2,
    day,
    interval: ARCHIVE_INTERVAL,
    archivedAt: now.toISOString(),
    bars,
  }), { expirationTtl: ARCHIVE_TTL_SECONDS });
  return { ok: true, archived: Object.keys(bars), day };
}

function fromArchiveDoc(doc, interval, wanted, limit) {
  const bars = {};
  const recorded = {};
  const missing = [];
  for (const sym of wanted) {
    const rows = doc.bars[sym];
    if (!rows || !rows.length) {
      missing.push(sym);
      continue;
    }
    const asMinute = rows.map((b) => [b.time, b.open, b.high, b.low, b.close, b.samples || 1, b.minutes || 5]);
    const out = interval === 5 ? rows.map(({ time, open, high, low, close, samples, minutes }) => ({
      time, open, high, low, close, samples: samples || 0, minutes: minutes || 5,
    })) : aggregateBars(asMinute, interval);
    bars[sym] = out.slice(-limit);
    recorded[sym] = { firstMinute: rows[0].time, lastMinute: rows[rows.length - 1].time, fiveMinuteBars: rows.length, source: "archive5" };
  }
  return { bars, recorded, missing };
}

// ── Cron 心跳：記錄每次排程跑完的結果，沒資料時才看得出「為什麼」────────

/** 把 recordIntradayMinute 的回傳（或例外）整理成一個短標籤。 */
export function describeIntradayRun(result) {
  if (result && Array.isArray(result.recorded) && result.recorded.length) return { kind: "recorded", detail: null };
  if (result && result.skipped) return { kind: `skipped:${result.skipped}`, detail: null };
  if (result && result.error) return { kind: "error", detail: String(result.error).slice(0, 160) };
  if (result && result.ok === false) return { kind: `failed:${result.reason || "unknown"}`, detail: null };
  return { kind: "unknown", detail: null };
}

/**
 * 結果種類改變，或同一種結果超過 10 分鐘沒更新時才寫 KV（平常幾乎不增加寫入）。
 * 任何失敗都吞掉：心跳不能反過來拖垮分 K 記錄。
 */
export async function noteIntradayRun(env, result, now = new Date()) {
  if (!env?.health_kv) return { ok: false, reason: "no_kv" };
  try {
    const { kind, detail } = describeIntradayRun(result);
    let prev = null;
    try {
      const raw = await env.health_kv.get(STATUS_KEY);
      prev = raw ? JSON.parse(raw) : null;
    } catch {
      prev = null;
    }
    const nowIso = now.toISOString();
    const same = prev && prev.kind === kind;
    if (same && now.getTime() - Date.parse(prev.lastAt) < STATUS_REFRESH_MS) return { ok: true, wrote: false };
    const doc = { v: 1, kind, detail, since: same ? prev.since : nowIso, lastAt: nowIso };
    await env.health_kv.put(STATUS_KEY, JSON.stringify(doc), { expirationTtl: TTL_SECONDS });
    return { ok: true, wrote: true };
  } catch {
    return { ok: false, reason: "status_write_failed" };
  }
}

export async function readIntradayStatus(env) {
  if (!env?.health_kv) return null;
  try {
    const raw = await env.health_kv.get(STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── 健康狀態（公開 /api/health 使用；不含價格或持股）────────────────

function continuityStats(rows) {
  const valid = (Array.isArray(rows) ? rows : []).filter((r) => Array.isArray(r) && Number.isFinite(labelToMinute(r[0])));
  if (!valid.length) return { bars: 0, firstMinute: null, lastMinute: null, gaps: 0 };
  const minutes = [...new Set(valid.map((r) => labelToMinute(r[0])))].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < minutes.length; i += 1) gaps += Math.max(0, minutes[i] - minutes[i - 1] - 1);
  return {
    bars: minutes.length,
    firstMinute: minuteToLabel(minutes[0]),
    lastMinute: minuteToLabel(minutes[minutes.length - 1]),
    gaps,
  };
}

/**
 * 回傳分 K 收集器健康摘要。只暴露收集進度與連續性，不包含價格、持股或 token。
 * 盤中允許 Cron 最多落後 2 分鐘；超過就標記 degraded。
 */
async function readIntradayHealthCore(env, now = new Date()) {
  const p = taipei(now);
  const symbols = intradaySymbols(env);
  const base = {
    ok: true,
    day: p.day,
    recordingWindow: isRecordingWindow(now),
    expectedSymbols: symbols,
    observedAt: now.toISOString(),
  };
  if (!env?.health_kv) return { ...base, ok: false, status: "unavailable", reason: "no_kv" };

  let doc = null;
  try {
    const raw = await env.health_kv.get(KV_PREFIX + p.day);
    doc = raw ? JSON.parse(raw) : null;
  } catch {
    return { ...base, status: "unavailable", reason: "kv_read_failed" };
  }

  if (!doc || !doc.bars || typeof doc.bars !== "object") {
    const idle = p.weekday === 0 || p.weekday === 6 || p.minuteOfDay < OPEN_MINUTE;
    return {
      ...base,
      status: idle ? "idle" : "no_data",
      lastMinute: null,
      lagMinutes: null,
      missingSymbols: symbols,
      symbols: {},
    };
  }

  const symbolStats = {};
  const missingSymbols = [];
  let latest = null;
  let totalGaps = 0;
  for (const sym of symbols) {
    const stats = continuityStats(doc.bars[sym]);
    symbolStats[sym] = stats;
    if (!stats.bars) missingSymbols.push(sym);
    if (stats.lastMinute) {
      const m = labelToMinute(stats.lastMinute);
      latest = latest == null ? m : Math.max(latest, m);
    }
    totalGaps += stats.gaps;
  }

  const lastMinute = latest == null ? null : minuteToLabel(latest);
  const referenceMinute = p.minuteOfDay < OPEN_MINUTE
    ? null
    : Math.min(p.minuteOfDay, CLOSE_MINUTE);
  const lagMinutes = latest == null || referenceMinute == null ? null : Math.max(0, referenceMinute - latest);
  const postClose = p.minuteOfDay > CLOSE_MINUTE;
  const lagLimit = postClose ? 2 : 2;
  const degraded = missingSymbols.length > 0 || (lagMinutes != null && lagMinutes > lagLimit) || totalGaps > 0;

  return {
    ...base,
    status: degraded ? "degraded" : "healthy",
    lastMinute,
    lagMinutes,
    totalGaps,
    missingSymbols,
    symbols: symbolStats,
  };
}

/** 收集進度摘要 + 最近一次 Cron 執行結果（collector）。 */
export async function readIntradayHealth(env, now = new Date()) {
  const health = await readIntradayHealthCore(env, now);
  return { ...health, collector: await readIntradayStatus(env) };
}

// ── 讀取（MCP 工具 intraday_bars）────────────────────────────

export async function readIntradayBars(env, args = {}, now = new Date()) {
  const interval = Number(args.interval ?? 5);
  if (!ALLOWED_INTERVALS.includes(interval)) {
    return { ok: false, error: `interval 只能是 ${ALLOWED_INTERVALS.join("、")}（分鐘）` };
  }
  if (!env?.health_kv) return { ok: false, error: "沒有 KV 綁定，無法讀取盤中資料" };

  const today = taipei(now).day;
  const day = typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : today;
  let doc = null;
  try {
    const raw = await env.health_kv.get(KV_PREFIX + day);
    doc = raw ? JSON.parse(raw) : null;
  } catch {
    doc = null;
  }
  if (!doc || !doc.bars) {
    let archive = null;
    try {
      const raw = await env.health_kv.get(ARCHIVE_PREFIX + day);
      archive = raw ? JSON.parse(raw) : null;
    } catch {
      archive = null;
    }
    if (archive && archive.bars) {
      const wantedA = Array.isArray(args.symbols) && args.symbols.length
        ? args.symbols.map((s) => String(s).trim().toUpperCase())
        : Object.keys(archive.bars);
      const limitA = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 300) : 300;
      if (interval === 1) {
        return {
          ok: true,
          found: false,
          day,
          reason: "這一天只剩下收盤封存的 5 分 K，1 分 K 已過 36 小時暫存期限。",
        };
      }
      const packed = fromArchiveDoc(archive, interval, wantedA, limitA);
      return {
        ok: true,
        found: Object.keys(packed.bars).length > 0,
        day,
        interval,
        source: "archive5",
        bars: packed.bars,
        recorded: packed.recorded,
        missing: packed.missing,
        note: "這是收盤封存的 5 分 K（約留 60 日），不是當日 1 分暫存。",
      };
    }
    return {
      ok: true,
      found: false,
      day,
      reason: day === today
        ? "今天還沒有任何盤中紀錄（可能尚未開盤、今天休市，或排程剛啟用還沒累積資料）。不可用日 K 或即時報價冒充分 K。"
        : "這一天沒有盤中紀錄（1 分 K 只留約 36 小時；5 分 K 封存約 60 日）。",
      ...(day === today ? { collector: await readIntradayStatus(env) } : {}),
    };
  }

  const wanted = Array.isArray(args.symbols) && args.symbols.length
    ? args.symbols.map((s) => String(s).trim().toUpperCase())
    : Object.keys(doc.bars);
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, 300) : 300;

  const bars = {};
  const recorded = {};
  const missing = [];
  for (const sym of wanted) {
    const rows = doc.bars[sym];
    if (!rows || !rows.length) {
      missing.push(sym);
      continue;
    }
    bars[sym] = aggregateBars(rows, interval).slice(-limit);
    recorded[sym] = { firstMinute: rows[0][0], lastMinute: rows[rows.length - 1][0], oneMinuteBars: rows.length };
  }

  return {
    ok: true,
    found: Object.keys(bars).length > 0,
    day,
    interval,
    bars,
    recorded,
    missing,
    note: "分 K 由 Cron 每分鐘內 15 秒取樣合成（每根 1 分鐘 K 最多 4 筆取樣），不是逐筆成交；high/low 可能比真實值略窄。最後一根可能尚未收完。",
  };
}
