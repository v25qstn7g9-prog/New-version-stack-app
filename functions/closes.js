/**
 * closes.js — GET /api/closes?symbols=0050,2330&days=45
 * 回傳每檔近幾天「每個交易日的收盤價」，給 App「補齊缺漏交易日」用。
 * 有收盤價的日期就是交易日（休市日 Yahoo 沒有那一天），所以不需要另外查假日表。
 * 只讀公開行情，不涉及任何使用者資料。
 */
const SYMBOL_PATTERN = /^[0-9]{4,6}[A-Z]?$/;
const MAX_SYMBOLS = 30;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=600", "x-content-type-options": "nosniff" },
});

export function parseCloses(payload) {
  const r = payload?.chart?.result?.[0];
  const ts = Array.isArray(r?.timestamp) ? r.timestamp : [];
  const closes = r?.indicators?.quote?.[0]?.close || [];
  const out = {};
  for (let i = 0; i < Math.min(ts.length, closes.length); i++) {
    const c = Number(closes[i]);
    if (!Number.isFinite(c) || c <= 0) continue;
    const date = new Date((Number(ts[i]) + 8 * 3600) * 1000).toISOString().slice(0, 10);
    out[date] = c;
  }
  return out;
}

async function fetchSymbolCloses(symbol, range, fetchImpl) {
  for (const suffix of [".TW", ".TWO"]) {
    try {
      const res = await fetchImpl(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol + suffix)}?interval=1d&range=${range}`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      const closes = parseCloses(await res.json().catch(() => null));
      if (Object.keys(closes).length) return closes;
    } catch {
      // 試下一個後綴
    }
  }
  return null;
}

export async function onRequestGet({ request }, deps = {}) {
  const url = new URL(request.url);
  const symbols = [...new Set((url.searchParams.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!symbols.length || symbols.length > MAX_SYMBOLS || !symbols.every((s) => SYMBOL_PATTERN.test(s))) return json({ error: "symbols 不合法" }, 400);
  const days = Math.max(5, Math.min(90, Number(url.searchParams.get("days")) || 45));
  const range = days <= 30 ? "1mo" : "3mo";
  const fetchImpl = deps.fetch || fetch;
  const entries = await Promise.all(symbols.map(async (s) => [s, await fetchSymbolCloses(s, range, fetchImpl)]));
  const closes = {};
  const missing = [];
  for (const [s, c] of entries) { if (c) closes[s] = c; else missing.push(s); }
  return json({ ok: true, closes, missing });
}
