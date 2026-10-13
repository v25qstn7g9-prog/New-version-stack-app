/**
 * intraday-bars.js
 * GET /intraday-bars?date=YYYY-MM-DD&symbols=2330,0050,TAIEX&interval=5
 * 讓 App 打開時補匯入「人不在時伺服器代收的分 K」（因子回測用）。
 * 只讀 KV（Cron 已記好的資料），不打外部行情來源。
 */
import { readIntradayBars, MAX_TRACKED_SYMBOLS } from "./intraday.js";

const SYMBOL_PATTERN = /^[A-Z0-9]{2,10}$/;

function json(data, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: "date 需為 YYYY-MM-DD" }, 400);
  const symbols = (url.searchParams.get("symbols") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) return json({ ok: false, error: "缺少 symbols" }, 400);
  if (symbols.length > MAX_TRACKED_SYMBOLS + 1) return json({ ok: false, error: "symbols 過多" }, 400);
  if (symbols.some((s) => !SYMBOL_PATTERN.test(s))) return json({ ok: false, error: "symbols 格式不正確" }, 400);
  const interval = Number(url.searchParams.get("interval") || 5);

  const out = await readIntradayBars(env, { symbols, interval, date });
  if (!out.ok) return json(out, 400);
  // 已收盤的歷史日資料不會再變，可短暫快取；今天的一律不快取。
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  return json(out, 200, date < today ? "public, max-age=300" : "no-store");
}
