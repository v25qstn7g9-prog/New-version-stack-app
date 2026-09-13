/**
 * news.js — 4.6-news-stable-7 (Optimized: KV cache + Bing retry)
 *
 * 持股新聞摘要：Yahoo Finance JSON 為主，Bing News RSS 為備援。
 *
 * 本版變更（相對 4.6-news-stable-6）：
 * 1. 加入 Cloudflare KV 快取（TTL 5 分鐘）：同 symbol/windowHours/maxPerSymbol 短時間重複查詢
 *    直接吃快取，減少對 Yahoo/Bing 的重複請求，降低延遲與被限流風險。
 *    若環境未綁定 KV（context.env.NEWS_CACHE 不存在），會自動略過快取，行為與舊版一致。
 * 2. Bing RSS 路徑補上重試機制，行為與 Yahoo 那條路徑一致（一次429/5xx重試）。
 * 3. debug 模式下會標示該筆是否來自快取（fromCache）。
 */

const NEWS_VERSION = "4.6-news-stable-7";
const SYMBOL_PATTERN = /^[0-9A-Za-z.]{1,10}$/;
const CACHE_TTL_SECONDS = 300; // 5 分鐘

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

function normalizeTitleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[，。！？、「」『』【】\-–—:：,.!?()（）\[\]]/g, "");
}

async function fetchOnce(url, timeoutMs, asText = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": asText ? "application/rss+xml, application/xml, text/xml, */*" : "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return asText ? await res.text() : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// 通用重試包裝：429/5xx 時重試一次。asText=false 給 Yahoo JSON、asText=true 給 Bing RSS。
async function fetchWithRetry(url, asText = false) {
  try {
    return await fetchOnce(url, 10000, asText);
  } catch (e) {
    const msg = String(e?.message || "");
    if (/HTTP (429|500|502|503|504)/.test(msg)) {
      return await fetchOnce(url, 10000, asText);
    }
    throw e;
  }
}

async function fetchJsonWithRetry(url) {
  return fetchWithRetry(url, false);
}

function compactText(s) {
  return String(s || "").toLowerCase().replace(/[\s\u3000\-_.()（）]/g, "");
}

function isRelevantTitle(title, symbol, name) {
  const t = compactText(title);
  const sym = compactText(symbol);
  const nm = compactText(name);
  if (sym && t.includes(sym)) return true;
  if (nm && nm.length >= 2 && t.includes(nm)) return true;
  const shortName = nm.replace(/etf|基金|股份有限公司|公司/g, "");
  return shortName.length >= 3 && t.includes(shortName);
}

function yahooItemsFromData(data, cutoff, maxPerSymbol, symbol, name) {
  const rawItems = Array.isArray(data?.news) ? data.news : [];
  const seen = new Set();
  const items = [];

  for (const item of rawItems) {
    const title = String(item?.title || "").trim();
    const link = String(item?.link || "").trim();
    const source = item?.publisher || null;
    const pubMs = item?.providerPublishTime ? Number(item.providerPublishTime) * 1000 : null;

    if (!title || !link || pubMs == null || Number.isNaN(pubMs) || pubMs < cutoff) continue;
    if (!isRelevantTitle(title, symbol, name)) continue;
    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    items.push({ title, link, source, pubDate: new Date(pubMs).toISOString() });
    if (items.length >= maxPerSymbol) break;
  }

  return { items, rawCount: rawItems.length };
}

function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function bingItemsFromXml(xml, cutoff, maxPerSymbol) {
  const blocks = String(xml || "").match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const seen = new Set();
  const items = [];

  for (const block of blocks) {
    const title = xmlTag(block, "title");
    const link = xmlTag(block, "link");
    const pubRaw = xmlTag(block, "pubDate");
    const pubMs = Date.parse(pubRaw);
    if (!title || !link || !Number.isFinite(pubMs) || pubMs < cutoff) continue;

    const key = normalizeTitleKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    items.push({ title, link, source: "Bing News", pubDate: new Date(pubMs).toISOString() });
    if (items.length >= maxPerSymbol) break;
  }

  return { items, rawCount: blocks.length };
}

async function fetchNewsForSymbol(symbol, name, windowHours, maxPerSymbol, debug) {
  const cutoff = Date.now() - windowHours * 3600 * 1000;
  const yahooSymbol = `${symbol}.TW`;
  const newsCount = Math.min(30, Math.max(10, maxPerSymbol * 5));
  const attempts = [];

  const yahoo1 = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=${newsCount}&quotesCount=0&lang=zh-Hant-TW&region=TW`;
  try {
    const data = await fetchJsonWithRetry(yahoo1);
    const parsed = yahooItemsFromData(data, cutoff, maxPerSymbol, symbol, name);
    attempts.push({ source: "yahoo-query1", ok: true, rawCount: parsed.rawCount, kept: parsed.items.length });
    if (parsed.items.length) return debug ? { ...parsed, sourceUsed: "yahoo-query1", attempts } : { items: parsed.items };
  } catch (e) {
    attempts.push({ source: "yahoo-query1", ok: false, error: String(e?.message || e) });
  }

  const yahoo2 = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(yahooSymbol)}&newsCount=${newsCount}&quotesCount=0&lang=zh-Hant-TW&region=TW`;
  try {
    const data = await fetchJsonWithRetry(yahoo2);
    const parsed = yahooItemsFromData(data, cutoff, maxPerSymbol, symbol, name);
    attempts.push({ source: "yahoo-query2", ok: true, rawCount: parsed.rawCount, kept: parsed.items.length });
    if (parsed.items.length) return debug ? { ...parsed, sourceUsed: "yahoo-query2", attempts } : { items: parsed.items };
  } catch (e) {
    attempts.push({ source: "yahoo-query2", ok: false, error: String(e?.message || e) });
  }

  const query = [symbol, name].filter(Boolean).join(" ");
  const bingUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=zh-TW&setlang=zh-Hant`;
  try {
    const xml = await fetchWithRetry(bingUrl, true);
    const parsed = bingItemsFromXml(xml, cutoff, maxPerSymbol);
    attempts.push({ source: "bing-rss", ok: true, rawCount: parsed.rawCount, kept: parsed.items.length });
    return debug ? { ...parsed, sourceUsed: parsed.items.length ? "bing-rss" : "none", attempts } : { items: parsed.items };
  } catch (e) {
    attempts.push({ source: "bing-rss", ok: false, error: String(e?.message || e) });
    return debug ? { items: [], rawCount: 0, sourceUsed: "none", attempts } : { items: [] };
  }
}

// 帶 KV 快取的包裝：命中快取就直接回傳，不打 Yahoo/Bing；沒有 KV 綁定則直接跳過快取邏輯
async function fetchNewsForSymbolCached(kv, symbol, name, windowHours, maxPerSymbol, debug) {
  const cacheKey = `news:${symbol}:${windowHours}:${maxPerSymbol}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey, { type: "json" });
      if (cached && Array.isArray(cached.items)) {
        return debug ? { ...cached, fromCache: true } : { items: cached.items };
      }
    } catch {
      // KV 讀取失敗就當作沒有快取，繼續往下正常抓取
    }
  }

  const fresh = await fetchNewsForSymbol(symbol, name, windowHours, maxPerSymbol, debug);

  if (kv && fresh.items.length > 0) {
    try {
      await kv.put(cacheKey, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      // 寫入快取失敗不影響本次回應
    }
  }

  return debug ? { ...fresh, fromCache: false } : fresh;
}

// 限制併發數量的批次執行工具
async function mapConcurrent(items, limit, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.allSettled(chunk.map((item, index) => fn(item, i + index)));
    results.push(...chunkResults);
  }
  return results;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const kv = context.env.NEWS_CACHE || null; // 選配 KV binding，沒設定時自動略過快取

    const symbols = (url.searchParams.get("symbols") || "")
      .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).filter(isAllowedSymbol);
    const names = (url.searchParams.get("names") || "")
      .split(",").map((s) => s.trim());

    if (!symbols.length) return jsonResponse({ error: "沒有提供股票代號" }, 400);

    const windowHours = Math.min(168, Math.max(1, Number(url.searchParams.get("windowHours")) || 72));
    const maxPerSymbol = Math.min(10, Math.max(1, Number(url.searchParams.get("maxPerSymbol")) || 3));
    const debug = url.searchParams.get("debug") === "1";

    // 使用 mapConcurrent 限制最大併發數為 3，防止流量暴增被降流
    const results = await mapConcurrent(
      symbols,
      3,
      (sym, i) => fetchNewsForSymbolCached(kv, sym, names[i] || "", windowHours, maxPerSymbol, debug)
    );

    const news = {};
    const debugInfo = {};
    const warnings = [];

    results.forEach((r, i) => {
      const sym = symbols[i];
      if (r.status === "fulfilled") {
        if (r.value.items.length > 0) news[sym] = r.value.items;
        if (debug) debugInfo[sym] = {
          sourceUsed: r.value.sourceUsed,
          rawCount: r.value.rawCount,
          attempts: r.value.attempts,
          fromCache: r.value.fromCache,
        };
      } else {
        warnings.push(`${sym}: ${r.reason?.message || r.reason}`);
      }
    });

    return jsonResponse({
      ok: true,
      version: NEWS_VERSION,
      fetchedAt: new Date().toISOString(),
      windowHours,
      maxPerSymbol,
      cacheEnabled: Boolean(kv),
      news,
      warnings,
      ...(debug ? { debugInfo } : {}),
    });
  } catch (e) {
    return jsonResponse({ error: e?.message || "news function failed", version: NEWS_VERSION }, 500);
  }
}
