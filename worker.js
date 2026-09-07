/**
 * worker.js — 存股App 的進入點程式（Workers with Static Assets 架構）
 *
 * 這支程式決定每個進來的網址要怎麼處理：
 * - /quote（GET）→ 交給 functions/quote.js 的即時股價邏輯
 * - /news（GET）→ 交給 functions/news.js 的新聞邏輯
 * - /ask（POST）→ 交給 functions/ask.js 的 AI 助手邏輯
 * - 其他所有網址 → 當一般靜態檔案送出去（index.html 等）
 *
 * 這是新式「Workers with Static Assets」架構必須有的進入點，
 * 跟舊式 Pages Functions（functions 資料夾會被自動偵測）不一樣，
 * 兩者需要的設定完全不同，不能只搬檔案就以為會動。
 */
import { onRequestGet as quoteHandler } from "./functions/quote.js";
import { onRequestGet as newsHandler } from "./functions/news.js";
import { onRequestPost as askHandler } from "./functions/ask.js";

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

    return env.ASSETS.fetch(request);
  },
};
