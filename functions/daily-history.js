/**
 * daily-history.js — 台股個股／大盤日K歷史（供 Trend Radar 算真正的日KD／月KD用）
 *
 * 之前 Trend Radar 的 KD 只有 5/15/60 分鐘（自己從 15 秒報價流組出來的），
 * 日K/月K完全缺席。這支直接複用 quote.js 已經在正式環境穩定運作的 Yahoo
 * Finance chart API 路徑（同一個資料來源、同樣的 fetch 方式），一次抓 2 年
 * 日K（約 490 根），日KD、月KD（重新取樣）都算得出來，不用另外處理 TWSE
 * STOCK_DAY 逐月配額的麻煩。
 *
 * 邊緣快取以「當天」為 key，一天只會真的打一次 Yahoo，其餘都吃快取。
 */

const HISTORY_VERSION = "1.0-daily-history";
const SYMBOL_PATTERN = /^[0-9]{4,6}[A-Z]?$/;

function isAllowedSymbol(s) {
  return s === "TAIEX" || SYMBOL_PATTERN.test(s);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}

function taiwanDateStr(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function taipeiDateStr(unixSeconds) {
  const d = new Date((unixSeconds + 8 * 3600) * 1000);
  return d.toISOString().slice(0, 10);
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (compatible; StockTracker/4.6-v2)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDailyBars(symbol) {
  const yahooSymbol = symbol === "TAIEX" ? "^TWII" : `${symbol}.TW`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2y&_ts=${Date.now()}`;
  const json = await fetchJson(url);
  const r = json?.chart?.result?.[0];
  const timestamps = Array.isArray(r?.timestamp) ? r.timestamp : [];
  const q = r?.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = Number(q.open?.[i]);
    const h = Number(q.high?.[i]);
    const l = Number(q.low?.[i]);
    const c = Number(q.close?.[i]);
    if ([o, h, l, c].every((v) => Number.isFinite(v) && v > 0)) {
      bars.push({ day: taipeiDateStr(Number(timestamps[i])), open: o, high: h, low: l, close: c });
    }
  }
  return bars;
}

async function readCache(symbol, day) {
  try {
    const key = new Request(`https://daily-history-cache.local/${day}/${symbol}`);
    const hit = await caches.default.match(key);
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function writeCache(symbol, day, bars) {
  try {
    const key = new Request(`https://daily-history-cache.local/${day}/${symbol}`);
    await caches.default.put(
      key,
      new Response(JSON.stringify(bars), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=43200, s-maxage=43200",
        },
      })
    );
  } catch {
    // cache is optional.
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const requested = (url.searchParams.get("symbols") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const symbols = [...new Set(requested)].filter(isAllowedSymbol).slice(0, 30);

    if (!symbols.length) {
      return jsonResponse({ error: "沒有允許的股票代號" }, 400);
    }

    const day = taiwanDateStr();
    const bars = {};
    const errors = [];

    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const cached = await readCache(sym, day);
          if (cached && Array.isArray(cached) && cached.length) {
            bars[sym] = cached;
            return;
          }
          const fresh = await fetchDailyBars(sym);
          if (fresh.length) {
            bars[sym] = fresh;
            await writeCache(sym, day, fresh);
          } else {
            errors.push(`${sym}: 無資料`);
          }
        } catch (e) {
          errors.push(`${sym}: ${e?.message || e}`);
        }
      })
    );

    return jsonResponse({
      ok: true,
      version: HISTORY_VERSION,
      day,
      bars,
      errors,
      count: Object.keys(bars).length,
    });
  } catch (e) {
    return jsonResponse({ error: "歷史資料服務暫時無法使用", version: HISTORY_VERSION }, 500);
  }
}
