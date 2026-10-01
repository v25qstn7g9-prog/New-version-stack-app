/**
 * market-index.js — 大盤（加權指數 TAIEX）給 MCP 工具用的唯讀整理層
 *
 * 前端 index.html 的「加權指數」是跟持股一起打同一支 /quote：
 *   /quote?symbols=<持股...>,TAIEX
 * quote.js 會把 TAIEX 換成 TWSE MIS 的 tse_t00.tw（失敗才退 Yahoo ^TWII），
 * 並沿用同一套 15 秒回應快取、prevClose 快取與 13:45 後自動停止查詢的規則。
 *
 * 這裡不另外抓資料，只是：
 * 1. 把各種大盤寫法（^TWII、加權指數、t00…）正規化成 quote.js 認得的 "TAIEX"。
 * 2. 把 /quote 回來的 TAIEX 報價整理成固定格式（漲跌、漲跌幅、交易日、是否過期、盤別）。
 * 3. 拿不到就回 available:false + reason，數值一律 null，絕不補猜。
 */

export const INDEX_SYMBOL = "TAIEX";
export const INDEX_NAME = "加權指數";

// 大寫比對（中文不受 toUpperCase 影響）。
const INDEX_ALIASES = new Set([
  "TAIEX", "^TWII", "TWII", "T00", "TSE_T00", "TSE_T00.TW", "IX0001",
  "加權指數", "加權", "大盤", "台股大盤", "臺股大盤", "台灣加權指數", "臺灣加權指數",
  "發行量加權股價指數", "集中市場加權指數",
]);

export function isIndexAlias(raw) {
  return INDEX_ALIASES.has(String(raw ?? "").trim().toUpperCase());
}

// 把使用者／模型給的代號轉成 quote.js 認得的格式；大盤一律變成 "TAIEX"。
export function normalizeQuoteSymbol(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  return INDEX_ALIASES.has(s) ? INDEX_SYMBOL : s;
}

const num = (v) => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

function taipeiParts(date) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  return {
    date: t.toISOString().slice(0, 10),
    weekday: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

const OPEN_MINUTE = 9 * 60;
const CLOSE_MINUTE = 13 * 60 + 30;
// 收盤指數大約 13:30 定案；asOf 早於 13:25 的就只是盤中快照，不是收盤價。
const CLOSE_SNAPSHOT_MINUTE = 13 * 60 + 25;
// 盤中超過 10 分鐘沒更新視為延遲。
const INTRADAY_DELAY_MS = 10 * 60 * 1000;

/**
 * 台股盤別（純函式）：holiday = { closed: true|false|null, reason }，由 TWSE 休市行事曆來。
 * 回傳 session：weekend / holiday / pre_market / trading / post_close / unknown（行事曆抓不到就不猜）。
 */
export function marketSessionAt(now = new Date(), holiday = { closed: false, reason: null }) {
  const p = taipeiParts(now);
  if (p.weekday === 0 || p.weekday === 6) {
    return { session: "weekend", marketDay: false, today: p.date, holiday: p.weekday === 6 ? "週六休市" : "週日休市" };
  }
  if (holiday?.closed === true) {
    return { session: "holiday", marketDay: false, today: p.date, holiday: holiday.reason || "TWSE 休市日" };
  }
  if (holiday?.closed == null) {
    return { session: "unknown", marketDay: null, today: p.date, holiday: null };
  }
  const session = p.minuteOfDay < OPEN_MINUTE ? "pre_market" : p.minuteOfDay < CLOSE_MINUTE ? "trading" : "post_close";
  return { session, marketDay: true, today: p.date, holiday: null };
}

function emptyIndex(session, reason, extra = {}) {
  return {
    symbol: INDEX_SYMBOL,
    name: INDEX_NAME,
    available: false,
    price: null,
    prevClose: null,
    change: null,
    changePct: null,
    high: null,
    low: null,
    asOf: null,
    tradeDate: null,
    priceKind: null,
    source: null,
    priceSource: null,
    stale: null,
    staleReason: null,
    session: session?.session ?? null,
    marketDay: session?.marketDay ?? null,
    holiday: session?.holiday ?? null,
    fetchedAt: null,
    fromCache: null,
    reason,
    ...extra,
  };
}

/**
 * 把 /quote 回來的 TAIEX 報價整理成固定格式（純函式，方便測試）。
 * raw：quote.js 的 quotes.TAIEX；meta：{ fetchedAt, fromCache, autoStopped, forcedRefresh, error }。
 */
export function buildMarketIndex(raw, meta = {}, session = null, now = new Date()) {
  const base = {
    fetchedAt: meta?.fetchedAt || null,
    fromCache: meta?.fromCache == null ? null : Boolean(meta.fromCache),
    ...(meta?.forcedRefresh ? { forcedRefresh: true } : {}),
  };
  if (!raw || typeof raw !== "object") {
    return emptyIndex(session, meta?.reason || "index_quote_missing", { ...base, ...(meta?.error ? { detail: String(meta.error).slice(0, 200) } : {}) });
  }

  const price = num(raw.price);
  // quote.js 在 Yahoo 沒有前收時會把 prevClose 設成 price（加 warning）；那不是真的前收。
  let prevClose = num(raw.prevClose);
  if (raw.warning === "no_prevClose_available" || (prevClose != null && prevClose <= 0)) prevClose = null;

  const asOfMs = Date.parse(String(raw.asOfDate || ""));
  const asOf = Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null;
  const asOfParts = asOf ? taipeiParts(new Date(asOfMs)) : null;
  const tradeDate = asOfParts?.date || null;

  // TWSE 抓不到成交價、Yahoo 也失敗時 quote.js 會拿前收頂替（priceSource "prev"），那不是今天的指數。
  if (price == null || price <= 0 || raw.priceSource === "prev") {
    return emptyIndex(session, "price_unavailable", {
      ...base,
      prevClose,
      source: raw.source || null,
      priceSource: raw.priceSource || null,
      note: "只取得前一交易日收盤（prevClose），沒有可用的最新指數；不以前收冒充最新價。",
    });
  }

  const change = prevClose != null ? round2(price - prevClose) : null;
  const changePct = prevClose != null ? round2(((price - prevClose) / prevClose) * 100) : null;

  const today = session?.today || taipeiParts(now).date;
  let stale = false;
  let staleReason = null;
  let priceKind = "intraday";
  if (!asOf) {
    stale = true;
    staleReason = "no_timestamp";
    priceKind = null;
  } else if (tradeDate < today) {
    stale = true;
    staleReason = "previous_session";
    priceKind = asOfParts.minuteOfDay >= CLOSE_SNAPSHOT_MINUTE ? "close" : "intraday";
  } else if (asOfParts.minuteOfDay >= CLOSE_SNAPSHOT_MINUTE) {
    priceKind = "close";
  }
  if (!stale && raw.isStale === true) {
    stale = true;
    staleReason = "source_marked_stale";
  }
  if (!stale && session?.session === "trading" && now.getTime() - asOfMs > INTRADAY_DELAY_MS) {
    stale = true;
    staleReason = "delayed";
  }
  if (!stale && session?.session === "post_close" && tradeDate === today && priceKind !== "close") {
    stale = true;
    staleReason = "intraday_snapshot_not_close";
  }

  const out = {
    symbol: INDEX_SYMBOL,
    name: INDEX_NAME,
    available: true,
    price,
    prevClose,
    change,
    changePct,
    high: num(raw.high),
    low: num(raw.low),
    asOf,
    tradeDate,
    priceKind,
    source: raw.source || null,
    priceSource: raw.priceSource || null,
    stale,
    staleReason,
    session: session?.session ?? null,
    marketDay: session?.marketDay ?? null,
    holiday: session?.holiday ?? null,
    ...base,
    reason: prevClose == null ? "prev_close_unavailable" : null,
  };
  if (staleReason === "previous_session") {
    out.note = priceKind === "close"
      ? `今天沒有新的指數資料，這是 ${tradeDate} 的收盤指數。`
      : `今天沒有新的指數資料，這是 ${tradeDate} 盤中的最後一筆指數（不是收盤）。`;
  } else if (staleReason === "intraday_snapshot_not_close") {
    out.note = "這是今天盤中的快取指數，不是收盤指數；可用 force:true 重新查詢。";
  }
  return out;
}

function failureReason(data, error) {
  if (error) return "index_fetch_failed";
  if (data?.autoStopped && !data?.quotes) return "auto_refresh_stopped_no_cache";
  if (data && data.ok === false) return "index_fetch_failed";
  return "index_quote_missing";
}

/**
 * 取得大盤：先用呼叫端已經拿到的 /quote 回應（例如持股+TAIEX 一起查的），
 * 沒有才單獨查 TAIEX；收盤後自動停止查詢且沒有快取時，只為 TAIEX 強制查一次
 * （之後同一天就會命中 quote.js 的回應快取）。永遠不 throw。
 *
 * deps.readQuotes(symbols, force) → /quote 的 JSON（可能 throw）
 * deps.readHoliday(dateYmd) → { closed, reason }
 */
export async function readMarketIndex(deps, { force = false, quoteData = null, now = null, allowForcedFallback = true, refetch = true, priorError = null } = {}) {
  const at = now || new Date();
  let holiday = { closed: null, reason: null };
  const weekday = taipeiParts(at).weekday;
  if (weekday !== 0 && weekday !== 6 && typeof deps?.readHoliday === "function") {
    try { holiday = await deps.readHoliday(taipeiParts(at).date); } catch { holiday = { closed: null, reason: null }; }
  }
  const session = marketSessionAt(at, holiday);

  const usable = (data) => {
    const q = data?.quotes?.[INDEX_SYMBOL];
    return q && num(q.price) != null && q.priceSource !== "prev" ? q : null;
  };
  const metaOf = (data, extra = {}) => ({
    fetchedAt: data?.fetchedAt || null,
    fromCache: data?.fromCache ?? false,
    autoStopped: data?.autoStopped ?? false,
    ...extra,
  });

  if (usable(quoteData)) return buildMarketIndex(quoteData.quotes[INDEX_SYMBOL], metaOf(quoteData), session, at);

  if (!refetch) {
    const partialOnly = quoteData?.quotes?.[INDEX_SYMBOL] || null;
    if (partialOnly) return buildMarketIndex(partialOnly, metaOf(quoteData), session, at);
    return buildMarketIndex(null, metaOf(quoteData, { reason: failureReason(quoteData, priorError), error: priorError || quoteData?.error || null }), session, at);
  }

  let data = null;
  let error = null;
  try {
    data = await deps.readQuotes([INDEX_SYMBOL], Boolean(force));
  } catch (e) {
    error = String(e?.message || e);
  }
  if (usable(data)) return buildMarketIndex(data.quotes[INDEX_SYMBOL], metaOf(data), session, at);

  if (!force && allowForcedFallback && data?.autoStopped && !data?.quotes) {
    try {
      const forced = await deps.readQuotes([INDEX_SYMBOL], true);
      if (usable(forced)) return buildMarketIndex(forced.quotes[INDEX_SYMBOL], metaOf(forced, { forcedRefresh: true }), session, at);
      data = forced;
      error = null;
    } catch (e) {
      error = String(e?.message || e);
    }
  }

  // 有 TAIEX 但沒有可用最新價（例如只有前收）→ 讓 buildMarketIndex 說明原因。
  const partial = data?.quotes?.[INDEX_SYMBOL] || quoteData?.quotes?.[INDEX_SYMBOL] || null;
  if (partial) return buildMarketIndex(partial, metaOf(data || quoteData), session, at);
  return buildMarketIndex(null, metaOf(data, { reason: failureReason(data, error), error: error || data?.error || null }), session, at);
}
