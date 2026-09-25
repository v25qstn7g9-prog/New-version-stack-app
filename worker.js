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
 * - /api/health-cards（GET/POST）→ 交給 functions/health-check.js，讀卡片清單／確認或忽略卡片
 * - /api/health-check（GET）→ 交給 functions/health-check.js，手動觸發一次健康檢查
 * - 其他所有網址 → 當一般靜態檔案送出去（index.html 等）
 *
 * 另外 export 了 scheduled()：Cloudflare Cron Trigger 會定期呼叫這個，
 * 不經過一般的網址請求，是背景自動跑健康檢查用的（見 wrangler.jsonc 的 triggers.crons）。
 *
 * 這是新式「Workers with Static Assets」架構必須有的進入點，
 * 跟舊式 Pages Functions（functions 資料夾會被自動偵測）不一樣，
 * 兩者需要的設定完全不同，不能只搬檔案就以為會動。
 */
import { onRequestGet as quoteHandler } from "./functions/quote.js";
import { onRequestGet as newsHandler } from "./functions/news.js";
import { onRequestPost as askHandler } from "./functions/ask.js";
import { onRequestGet as dividendScheduleHandler } from "./functions/dividend-schedule.js";
import { onRequestGet as dailyHistoryHandler } from "./functions/daily-history.js";
import { onRequestGet as holidayScheduleHandler } from "./functions/holiday-schedule.js";
import {
  onRequestGet as healthGetHandler,
  onRequestPost as healthPostHandler,
  runHealthCheck,
} from "./functions/health-check.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/quote" && request.method === "GET") {
      return quoteHandler({ request, env, ctx });
    }
    if (url.pathname === "/news" && request.method === "GET") {
      return newsHandler({ request, env, ctx });
    }
    if (url.pathname === "/ask" && request.method === "POST") {
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
    if ((url.pathname === "/api/health-cards" || url.pathname === "/api/health-check") && request.method === "GET") {
      return healthGetHandler({ request, env, ctx });
    }
    if (url.pathname === "/api/health-cards" && request.method === "POST") {
      return healthPostHandler({ request, env, ctx });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    // index.html changes frequently during active development. Prevent Safari/PWA
    // and intermediary caches from pinning an older header/version after a deploy.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      headers.set("Pragma", "no-cache");
      headers.set("Expires", "0");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    }
    return assetResponse;
  },

  // Cron Trigger 進來的入口（不是一般 HTTP 請求，沒有 request/response）。
  // ctx.waitUntil 讓 Worker 在背景檢查跑完之前不會被提早關掉。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runHealthCheck(env));
  },
};
