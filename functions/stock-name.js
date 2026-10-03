/**
 * stock-name.js — look up a Taiwan stock / ETF short name from its code
 *
 * Used by the "新增持股標的" form to fill in 名稱 once a code is typed.
 * Deliberately separate from /quote: that endpoint is rate-budgeted, stops
 * auto-queries after the close and needs an actual price, none of which a
 * name lookup should depend on. Names almost never change, so results are
 * cached at the edge (Cache API, not KV) for a week.
 */

const SYMBOL_PATTERN = /^[0-9]{4,6}[A-Z]?$/;
const FOUND_TTL_SECONDS = 7 * 24 * 60 * 60;
const MISSING_TTL_SECONDS = 10 * 60;
const TWSE_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

function jsonResponse(data, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
    },
  });
}

// TWSE returns 上市 (tse) and 上櫃 (otc) rows under the same query; a code
// that does not exist in a market simply has no row there.
export function pickStockName(msgArray, symbol) {
  if (!Array.isArray(msgArray)) return null;
  for (const item of msgArray) {
    if (String(item?.c || "").toUpperCase() !== symbol) continue;
    const name = String(item?.n ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
    if (name) return { name, market: item.ex === "otc" ? "otc" : "tse" };
  }
  return null;
}

async function fetchTwseRows(symbol) {
  const exCh = `tse_${symbol}.tw|otc_${symbol}.tw`;
  const url = `${TWSE_URL}?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_ts=${Date.now()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": "Mozilla/5.0 (compatible; StockTracker/4.6-v2)",
        "referer": "https://mis.twse.com.tw/",
      },
    });
    if (!res.ok) throw new Error(`TWSE HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.msgArray)) throw new Error("TWSE invalid response");
    return data.msgArray;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    return jsonResponse({ ok: false, error: "invalid symbol" }, 400);
  }

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://internal-cache.example/stock-name-v1/${symbol}`);

  try {
    const hit = cache && await cache.match(cacheKey);
    if (hit) return jsonResponse(await hit.json(), 200, "no-store");
  } catch {}

  let rows;
  try {
    rows = await fetchTwseRows(symbol);
  } catch (e) {
    // Upstream trouble is not "this code doesn't exist" — never cache it.
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 502);
  }

  const picked = pickStockName(rows, symbol);
  const payload = picked
    ? { ok: true, found: true, symbol, name: picked.name, market: picked.market }
    : { ok: true, found: false, symbol };

  try {
    if (cache) {
      await cache.put(cacheKey, new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${picked ? FOUND_TTL_SECONDS : MISSING_TTL_SECONDS}`,
        },
      }));
    }
  } catch {}

  return jsonResponse(payload);
}
