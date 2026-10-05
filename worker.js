/**
 * worker.js — 存股App 的進入點程式（Workers with Static Assets 架構）
 *
 * 這支程式決定每個進來的網址要怎麼處理：
 * - /quote（GET）→ 交給 functions/quote.js 的即時股價邏輯
 * - /news（GET）→ 交給 functions/news.js 的新聞邏輯
 * - /ask（POST）→ 交給 functions/ask.js 的 AI 助手邏輯
 * - /dividend-schedule（GET）→ 交給 functions/dividend-schedule.js，查 TWSE 除權除息預告表
 * - /daily-history（GET）→ 交給 functions/daily-history.js，查個股／大盤日K歷史（給趨勢雷達算真正的日/月KD）
 * - /holiday-schedule（GET）→ 交給 functions/holiday-schedule.js，查 TWSE 官方休市行事曆
 * - /taifex-tx（GET）→ 交給 functions/taifex-tx.js，查台指近月期貨官方報價
 * - /api/health-cards（GET/POST）→ 交給 functions/health-check.js，讀卡片清單／確認或忽略卡片
 * - /api/health-check（GET）→ 交給 functions/health-check.js，手動觸發一次健康檢查
 * - /api/portfolio-sync（GET/POST）→ 交給 functions/portfolio-sync.js，讓 Z∞ 中控可以讀到持股摘要
 * - 其他所有網址 → 當一般靜態檔案送出去（index.html 等）
 *
 * 另外 export 了 scheduled()：Cloudflare Cron Trigger 會定期呼叫這個，
 * 不經過一般的網址請求，是背景自動跑健康檢查用的（見 wrangler.jsonc 的 triggers.crons）。
 *
 * 這是新式「Workers with Static Assets」架構必須有的進入點，
 * 跟舊式 Pages Functions（functions 資料夾會被自動偵測）不一樣，
 * 兩者需要的設定完全不同，不能只搬檔案就以為會動。
 */
const STATS_TTL = 8 * 24 * 60 * 60;
function statsTaipeiDate(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
async function statsDeviceTag(request) {
  const raw = String(request.headers.get("x-device-id") || request.headers.get("cf-connecting-ip") || "anonymous").slice(0, 100);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("usage:" + raw)));
  return Array.from(bytes.slice(0, 10), b => b.toString(16).padStart(2, "0")).join("");
}
async function bumpUsage(env, request, kind) {
  if (!env?.health_kv) return;
  const date = statsTaipeiDate();
  const tag = await statsDeviceTag(request);
  await Promise.all([
    env.health_kv.put(`usage-active:${date}:${tag}`, "1", { expirationTtl: STATS_TTL }),
    env.health_kv.get(`usage-count:${date}:${kind}`).then(v => env.health_kv.put(`usage-count:${date}:${kind}`, String((Number(v) || 0) + 1), { expirationTtl: STATS_TTL })),
  ]).catch(() => {});
}
async function readSystemStats(env) {
  const today = statsTaipeiDate();
  const days = Array.from({ length: 7 }, (_, i) => statsTaipeiDate(-i));
  let todayActive = 0, weekActiveSet = new Set();
  if (env?.health_kv?.list) {
    for (const d of days) {
      let cursor;
      do {
        const page = await env.health_kv.list({ prefix: `usage-active:${d}:`, cursor });
        for (const k of page.keys || []) {
          const tag = k.name.split(":").pop();
          if (d === today) todayActive += 1;
          weekActiveSet.add(tag);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    }
  }
  const [quoteRequests, aiRequests] = await Promise.all([
    env?.health_kv?.get(`usage-count:${today}:quote`),
    env?.health_kv?.get(`usage-count:${today}:ai`),
  ]);
  return { todayActive, weekActive: weekActiveSet.size, quoteRequests: Number(quoteRequests) || 0, aiRequests: Number(aiRequests) || 0 };
}

import { onRequestGet as quoteHandler } from "./functions/quote.js";
import { onRequestGet as newsHandler } from "./functions/news.js";
import { onRequestPost as askHandler } from "./functions/ask.js";
import { onRequestGet as dividendScheduleHandler } from "./functions/dividend-schedule.js";
import { onRequestGet as dailyHistoryHandler } from "./functions/daily-history.js";
import { onRequestGet as holidayScheduleHandler } from "./functions/holiday-schedule.js";
import { onRequestGet as taifexTxHandler } from "./functions/taifex-tx.js";
import { onRequestGet as intradayMetricsHandler } from "./functions/intraday-metrics.js";
import { onRequestGet as marketBreadthHandler } from "./functions/market-breadth.js";
import { onRequestGet as stockNameHandler } from "./functions/stock-name.js";
import {
  onRequestGet as healthGetHandler,
  onRequestPost as healthPostHandler,
  runHealthCheck,
} from "./functions/health-check.js";
import {
  onRequestGet as portfolioSyncGetHandler,
  onRequestPost as portfolioSyncPostHandler,
} from "./functions/portfolio-sync.js";
import { handlePreparedAssetMcp } from "./functions/ai-connector-prepared.js";
import { INTRADAY_CRON, recordIntradayMinute, archiveIntradayDay, readIntradayHealth, noteIntradayRun } from "./functions/intraday.js";
import { AUTO_DAILY_CRON, runAutoDaily, runDailyReminder, onRequestGet as autoDailyGetHandler } from "./functions/auto-daily.js";
import { adminTokenMatches, bearerToken, writeAllowed } from "./functions/request-guard.js";
import { isKnownSyncToken } from "./functions/portfolio-sync.js";
import { handleAssetOAuth, verifyAssetAccessToken, readAssetMcpSyncToken } from "./functions/asset-mcp-oauth.js";
import {
  onRequestGet as pendingTradesGetHandler,
  onRequestPost as pendingTradesPostHandler,
  onRequestResolve as pendingTradesResolveHandler,
} from "./functions/pending-trades.js";

function apiJson(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

const API_METHODS = new Map([
  ["/quote", ["GET"]],
  ["/news", ["GET"]],
  ["/ask", ["POST"]],
  ["/dividend-schedule", ["GET"]],
  ["/daily-history", ["GET"]],
  ["/holiday-schedule", ["GET"]],
  ["/taifex-tx", ["GET"]],
  ["/intraday-metrics", ["GET"]],
  ["/market-breadth", ["GET"]],
  ["/stock-name", ["GET"]],
  ["/api/health", ["GET"]],
  ["/api/health-cards", ["GET", "POST"]],
  ["/api/health-check", ["GET"]],
  ["/api/portfolio-sync", ["GET", "POST"]],
  ["/api/auto-daily", ["GET"]],
  ["/api/owner-status", ["GET"]],
  ["/api/system-stats", ["GET"]],
  ["/api/pending-trades", ["GET", "POST"]],
  ["/api/pending-trades/resolve", ["POST"]],
]);

const WRITE_PATHS = new Set(["/api/portfolio-sync", "/api/pending-trades", "/api/pending-trades/resolve", "/api/health-cards"]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const oauthResponse = await handleAssetOAuth(request, env);
    if (oauthResponse) return oauthResponse;

    if (url.pathname === "/mcp") {
      const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const access = bearer ? await verifyAssetAccessToken(env, bearer, url.origin) : null;
      if (!access) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "WWW-Authenticate": `Bearer resource_metadata=\"${url.origin}/.well-known/oauth-protected-resource\", scope=\"read:assets\"`,
          },
        });
      }
      const syncToken = await readAssetMcpSyncToken(env, access);
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(syncToken)) {
        return new Response(JSON.stringify({ error: "Assets sync token is not configured" }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      try {
        return await handlePreparedAssetMcp(request, env, { syncToken });
      } catch (error) {
        return apiJson({ error: "MCP Internal Server Error", detail: String(error?.message || error).slice(0, 300) || null }, 500);
      }
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const intraday = await readIntradayHealth(env);
      return apiJson({ ok: true, service: "new-version-stack-app", intraday });
    }

    if (url.pathname === "/api/owner-status" && request.method === "GET") {
      const supplied = bearerToken(request);
      const owner = String(env.LINE_REMINDER_SYNC_TOKEN || "").trim();
      // 只回傳布林值；Secret 本身永遠不送到瀏覽器。
      return apiJson({ ok: true, owner: Boolean(supplied && owner && supplied === owner) });
    }

    if (url.pathname === "/api/system-stats" && request.method === "GET") {
      const auth = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const owner = String(env.LINE_REMINDER_SYNC_TOKEN || "").trim();
      if (!auth || !owner || auth !== owner) return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
      const stats = await readSystemStats(env);
      return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/quote" && request.method === "GET") {
      ctx.waitUntil(bumpUsage(env, request, "quote"));
      return quoteHandler({ request, env, ctx });
    }
    if (url.pathname === "/news" && request.method === "GET") {
      return newsHandler({ request, env, ctx });
    }
    if (url.pathname === "/ask" && request.method === "POST") {
      ctx.waitUntil(bumpUsage(env, request, "ai"));
      return askHandler({ request, env, ctx });
    }
    if (url.pathname === "/dividend-schedule" && request.method === "GET") {
      return dividendScheduleHandler({ request, env, ctx });
    }
    if (url.pathname === "/daily-history" && request.method === "GET") {
      return dailyHistoryHandler({ request, env, ctx });
    }
    if (url.pathname === "/holiday-schedule" && request.method === "GET") {
      return holidayScheduleHandler({ request, env, ctx });
    }
    if (url.pathname === "/taifex-tx" && request.method === "GET") {
      return taifexTxHandler();
    }
    if (url.pathname === "/intraday-metrics" && request.method === "GET") {
      return intradayMetricsHandler({ request, env, ctx });
    }
    if (url.pathname === "/market-breadth" && request.method === "GET") {
      return marketBreadthHandler({ request, env, ctx });
    }
    if (url.pathname === "/stock-name" && request.method === "GET") {
      return stockNameHandler({ request, env, ctx });
    }
    const isWrite = request.method === "POST" && WRITE_PATHS.has(url.pathname);
    if (isWrite && !(await writeAllowed(env, request, url.pathname))) {
      return apiJson({ error: "請求太頻繁，請稍後再試" }, 429, { "Retry-After": "60" });
    }

    if (url.pathname === "/api/health-check" && request.method === "GET") {
      if (!adminTokenMatches(env, bearerToken(request))) {
        return apiJson({ error: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
      }
      return healthGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/health-cards" && request.method === "GET") {
      return healthGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/health-cards" && request.method === "POST") {
      const supplied = bearerToken(request);
      if (!adminTokenMatches(env, supplied) && !(await isKnownSyncToken(env, supplied))) {
        return apiJson({ error: "Unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
      }
      return healthPostHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/portfolio-sync" && request.method === "GET") {
      return portfolioSyncGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/portfolio-sync" && request.method === "POST") {
      return portfolioSyncPostHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/auto-daily" && request.method === "GET") {
      return autoDailyGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/pending-trades" && request.method === "GET") {
      return pendingTradesGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/pending-trades" && request.method === "POST") {
      return pendingTradesPostHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/pending-trades/resolve" && request.method === "POST") {
      return pendingTradesResolveHandler({ request, env, ctx });
    }

    const allowedMethods = API_METHODS.get(url.pathname);
    if (allowedMethods && !allowedMethods.includes(request.method)) {
      return apiJson({ error: "Method Not Allowed" }, 405, { Allow: allowedMethods.join(", ") });
    }
    if (url.pathname.startsWith("/api/")) {
      return apiJson({ error: "API route not found" }, 404);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const headers = new Headers(assetResponse.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
    }

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },

  async scheduled(event, env, ctx) {
    if (event && event.cron === INTRADAY_CRON) {
      ctx.waitUntil((async () => {
        let result;
        try {
          result = await recordIntradayMinute(env);
        } catch (e) {
          // 以前例外（例如 KV 寫入被拒）會直接消失；現在留一筆心跳讓 /api/health 看得到。
          result = { ok: false, error: String(e?.message || e) };
        }
        await noteIntradayRun(env, result);
        if (result && result.skipped === "outside_market_hours") {
          await archiveIntradayDay(env);
        }
        // 13:36、13:45 記帳提醒（只在那兩分鐘真的動作；沒設定 LINE 就跳過）
        try { await runDailyReminder(env); } catch (e) { console.warn("daily reminder failed", e?.message || e); }
      })());
      return;
    }
    if (event && event.cron === AUTO_DAILY_CRON) {
      // 14:00 用收盤價自動記錄還沒記的今天（休市日、報價不完整都不記）
      ctx.waitUntil(runAutoDaily(env).catch((e) => console.warn("auto daily failed", e?.message || e)));
      return;
    }
    ctx.waitUntil((async () => {
      await archiveIntradayDay(env);
      await runHealthCheck(env);
    })());
  },
};
