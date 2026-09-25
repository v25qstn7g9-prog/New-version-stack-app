/**
 * holiday-schedule.js — TWSE official market holiday proxy
 *
 * Same-origin proxy for the TWSE OpenAPI holiday schedule so iOS/PWA clients
 * do not depend on cross-origin browser access. Cached at the edge for 6 hours.
 */

const TWSE_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule";
const CACHE_TTL_SECONDS = 6 * 60 * 60;

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

async function fetchJson(url, timeoutMs = 7000) {
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

export async function onRequestGet() {
  const cache = caches.default;
  const cacheKey = new Request("https://internal-cache.example/twse-holiday-schedule-v1");

  try {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
          "x-content-type-options": "nosniff",
        },
      });
    }
  } catch {}

  try {
    const rows = await fetchJson(TWSE_URL);
    if (!Array.isArray(rows)) throw new Error("TWSE holiday response is not an array");

    const payload = {
      ok: true,
      source: "twse-openapi",
      fetchedAt: new Date().toISOString(),
      rows,
    };

    try {
      await cache.put(
        cacheKey,
        jsonResponse(payload, 200, `public, max-age=${CACHE_TTL_SECONDS}`)
      );
    } catch {}

    return jsonResponse(payload, 200, `public, max-age=${CACHE_TTL_SECONDS}`);
  } catch (err) {
    return jsonResponse({
      ok: false,
      error: String(err?.message || err),
      rows: [],
    }, 502);
  }
}
