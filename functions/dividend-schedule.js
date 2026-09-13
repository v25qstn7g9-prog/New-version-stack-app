/**
 * dividend-schedule.js — 上市股票／ETF「除權除息預告表」查詢
 *
 * 資料來源：TWSE TWT48U（https://www.twse.com.tw/exchangeReport/TWT48U）
 *   這張表只列出「已經公告」、近期即將除權息的上市股票／ETF；多數個股一年
 *   只公告一次，公告前是查不到的（回傳 found:false，不是錯誤）。
 *   目前只涵蓋「上市」（TWSE），上櫃（TPEx）股票不在這張表裡。
 *
 * 整張表一天更新一次，用 Cloudflare 的 edge cache 存 6 小時，
 * 同一批使用者查不同代號時不用每次都重打 TWSE。
 */

const SYMBOL_PATTERN = /^[0-9]{4,6}[A-Z]?$/;
const TWSE_URL = "https://www.twse.com.tw/exchangeReport/TWT48U?response=json";
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 小時

function isAllowedSymbol(s) {
  return SYMBOL_PATTERN.test(s);
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

// "115年09月16日" → "2026-09-16"（民國年轉西元年）
function rocDateToIso(rocStr) {
  const m = String(rocStr || "").match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = Number(m[1]) + 1911;
  const mm = String(m[2]).padStart(2, "0");
  const dd = String(m[3]).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (compatible; StockTracker/1.0)",
      },
    });
    if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 抓整張除權除息預告表，用 Cloudflare 的 caches.default 存起來，
// 避免同一天內每個使用者查詢都重打一次 TWSE。
async function getScheduleRows() {
  const cache = caches.default;
  const cacheKey = new Request("https://internal-cache.example/dividend-schedule-twse-v1");
  const cached = await cache.match(cacheKey);
  if (cached) {
    return await cached.json();
  }

  const json = await fetchJson(TWSE_URL);
  const fields = Array.isArray(json?.fields) ? json.fields : [];
  const data = Array.isArray(json?.data) ? json.data : [];
  const idx = {
    date: fields.indexOf("除權除息日期"),
    symbol: fields.indexOf("股票代號"),
    name: fields.indexOf("名稱"),
    type: fields.indexOf("除權息"),
    cash: fields.indexOf("現金股利"),
  };

  const rows = data.map((r) => {
    const cashRaw = idx.cash >= 0 ? r[idx.cash] : null;
    const cashNum = parseFloat(cashRaw);
    return {
      symbol: String(idx.symbol >= 0 ? r[idx.symbol] : "").trim(),
      name: String(idx.name >= 0 ? r[idx.name] : "").trim(),
      date: rocDateToIso(idx.date >= 0 ? r[idx.date] : null),
      type: String(idx.type >= 0 ? r[idx.type] : "").trim(),
      cashDividend: Number.isFinite(cashNum) ? cashNum : null,
    };
  });

  const body = JSON.stringify(rows);
  const cacheResponse = new Response(body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  await cache.put(cacheKey, cacheResponse);
  return rows;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();

  if (!symbol) return jsonResponse({ ok: false, error: "缺少股票代號" }, 400);
  if (!isAllowedSymbol(symbol)) return jsonResponse({ ok: false, error: "股票代號格式不正確" }, 400);

  try {
    const rows = await getScheduleRows();
    const match = rows.find((r) => r.symbol === symbol);

    if (!match || !match.date) {
      // 沒公告不是錯誤——多數個股一年只公告一次，公告前本來就查不到。
      return jsonResponse({ ok: true, symbol, found: false });
    }

    return jsonResponse({
      ok: true,
      symbol,
      found: true,
      date: match.date,
      type: match.type || null, // "息" / "權" / "權息"
      cashDividend: match.cashDividend, // 每股現金股利；ETF常顯示「待公告」→ null
      name: match.name || null,
      source: "twse-exright-announcement",
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: `查詢失敗：${String(err?.message || err)}` }, 502);
  }
}
