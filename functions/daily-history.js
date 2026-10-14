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

import { readIntradayBars } from "./intraday.js";

const HISTORY_VERSION = "1.3-gap-fill";
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
  const adjusted = r?.indicators?.adjclose?.[0]?.adjclose || [];
  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = Number(q.open?.[i]);
    const h = Number(q.high?.[i]);
    const l = Number(q.low?.[i]);
    const c = Number(q.close?.[i]);
    const volume = Number(q.volume?.[i]);
    if ([o, h, l, c].every((v) => Number.isFinite(v) && v > 0) && !(symbol!=="TAIEX" && q.volume?.[i]!=null && volume===0)) {
      bars.push({ day: taipeiDateStr(Number(timestamps[i])), open: o, high: h, low: l, close: c, adjustedClose: Number(adjusted[i])>0?Number(adjusted[i]):null, volume: Number.isFinite(volume) && volume >= 0 ? volume : null });
    }
  }
  return bars;
}

function historyCacheSlot(now=new Date()) {
  const tw=new Date(now.getTime()+8*3600000),minute=tw.getUTCHours()*60+tw.getUTCMinutes();
  // A premarket/intraday snapshot cannot survive into the completed-session cache.
  return minute<540?"premarket":minute<820?"session":"closed";
}
async function readCache(symbol, day, slot) {
  try {
    const key = new Request(`https://daily-history-cache.local/${day}/${slot}/${symbol}`);
    const hit = await caches.default.match(key);
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function writeCache(symbol, day, slot, bars) {
  try {
    const key = new Request(`https://daily-history-cache.local/${day}/${slot}/${symbol}`);
    await caches.default.put(
      key,
      new Response(JSON.stringify(bars), {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=180, s-maxage=180",
        },
      })
    );
  } catch {
    // cache is optional.
  }
}

// Yahoo 日K 偶爾整天缺一根（例：10/13 的 0050、0056 不見了，台積電和大盤都有）。
// 缺的那天如果別的代號有（＝那天有開盤），就用伺服器自己每分鐘記錄的盤中資料補成日K。
// 只補近 30 天、已收盤的日子，標 source:"intraday-archive"；補不到就維持原樣，不猜。
export function findDailyGaps(barsBySymbol, today, lookbackDays = 30, maxGaps = 10) {
  const since = new Date(Date.parse(today + "T12:00:00Z") - lookbackDays * 86400000).toISOString().slice(0, 10);
  const tradingDays = new Set();
  for (const bars of Object.values(barsBySymbol)) for (const b of bars || []) if (b.day >= since && b.day < today) tradingDays.add(b.day);
  const gaps = [];
  for (const [sym, bars] of Object.entries(barsBySymbol)) {
    if (!bars?.length) continue;
    const have = new Set(bars.map((b) => b.day));
    for (const day of tradingDays) if (!have.has(day) && day > bars[0].day) gaps.push({ sym, day });
  }
  return gaps.sort((a, b) => a.day.localeCompare(b.day) || a.sym.localeCompare(b.sym)).slice(-maxGaps);
}
async function fillDailyGaps(env, barsBySymbol, today, read = readIntradayBars) {
  if (!env?.health_kv) return [];
  const byDay = new Map();
  for (const g of findDailyGaps(barsBySymbol, today)) byDay.set(g.day, [...(byDay.get(g.day) || []), g.sym]);
  const filled = [];
  for (const [day, syms] of byDay) {
    let res = null;
    try { res = await read(env, { symbols: syms, interval: 60, date: day }); } catch { res = null; }
    if (!res?.found) continue;
    for (const sym of syms) {
      const rows = res.bars?.[sym];
      const last = String(res.recorded?.[sym]?.lastMinute || "");
      if (!rows?.length || last < "13:30") continue; // 那天沒收完整就不補
      const bar = {
        day, open: rows[0].open, high: Math.max(...rows.map((r) => r.high)), low: Math.min(...rows.map((r) => r.low)),
        close: rows[rows.length - 1].close, adjustedClose: null, volume: null, source: "intraday-archive",
      };
      if (![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) continue;
      barsBySymbol[sym] = [...barsBySymbol[sym], bar].sort((a, b) => a.day.localeCompare(b.day));
      filled.push(`${sym}@${day}`);
    }
  }
  return filled;
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
    const slot=historyCacheSlot();
    const bars = {};
    const errors = [];

    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const cached = await readCache(sym, day, slot);
          if (cached && Array.isArray(cached) && cached.length) {
            bars[sym] = cached;
            return;
          }
          const fresh = await fetchDailyBars(sym);
          if (fresh.length) {
            bars[sym] = fresh;
            await writeCache(sym, day, slot, fresh);
          } else {
            errors.push(`${sym}: 無資料`);
          }
        } catch (e) {
          errors.push(`${sym}: ${e?.message || e}`);
        }
      })
    );

    const filled = await fillDailyGaps(context.env, bars, day, context.readIntradayBars).catch(() => []);

    return jsonResponse({
      ok: true,
      ...(filled.length ? { filled } : {}),
      version: HISTORY_VERSION,
      day,
      cachePhase:slot,
      fetchedAt:new Date().toISOString(),
      bars,
      errors,
      count: Object.keys(bars).length,
    });
  } catch (e) {
    return jsonResponse({ error: "歷史資料服務暫時無法使用", version: HISTORY_VERSION }, 500);
  }
}
