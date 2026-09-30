/**
 * functions/ai-connector-prepared.js
 *
 * 資產 App 的獨立 MCP / Agent 工具層。
 *
 * IMPORTANT:
 * - worker.js 的 /mcp 路由已掛載這裡。
 * - 外層 OAuth 先驗證 AI client，再把 server-side portfolio sync token
 *   以 context.syncToken 傳進 handlePreparedAssetMcp()。
 * - 不在原始碼硬編任何 token / secret。
 * - 所有 Assets MCP 工具維持唯讀。
 */
import { onRequestGet as portfolioSyncGet } from "./portfolio-sync.js";
import { onRequestGet as quoteGet } from "./quote.js";
import { onRequestGet as newsGet } from "./news.js";
import { onRequestGet as dividendGet } from "./dividend-schedule.js";
import { onRequestGet as dailyHistoryGet } from "./daily-history.js";
import { onRequestGet as holidayGet } from "./holiday-schedule.js";
import { onRequestGet as taifexGet } from "./taifex-tx.js";
import { onRequestGet as healthGet } from "./health-check.js";
import { onRequestGet as pendingTradesGet } from "./pending-trades.js";
import { holidayStatusFromRows } from "./twse-holiday.js";

const SERVER = { name: "z-infinity-assets", version: "1.2.0" };
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const PREPARED_ASSET_TOOLS = [
  {
    name: "asset_summary",
    title: "資產存股摘要",
    annotations: READ_ONLY,
    description:
      "Read the user's latest synchronized portfolio snapshot: holdings, shares, costs, totals and history. This is a synchronized snapshot, not guaranteed real-time market data.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "asset_agent_brief",
    title: "Assets Agent 今日總覽",
    annotations: READ_ONLY,
    description:
      "One compact bounded-agent briefing for broad requests such as '今天資產狀況怎樣' or '幫我看一下資產'. It combines deterministic today-record/market-session status, live portfolio quotes when useful, system-health cards and pending trade confirmations. It never invents asset values and never performs trades.",
    inputSchema: {
      type: "object",
      properties: {
        includeLive: { type: "boolean", description: "Include live portfolio quote snapshot. Default auto: only when useful during/after today's market session." }
      },
      additionalProperties: false
    },
  },
  {
    name: "today_asset_status",
    title: "今日資產狀態",
    annotations: READ_ONLY,
    description:
      "Answer 'today's assets' deterministically. Check whether today has a saved daily asset record; if not, check Taiwan weekend/TWSE holiday and Taiwan market time. On a holiday, report that the market is closed and cite the latest saved asset record date. Before 09:00 on a trading day, say the market has not opened yet. From 09:00 onward, remind the user to record today's assets when no record exists; after 14:00 mark it overdue. If the TWSE holiday calendar cannot be fetched, status is market_status_unknown (do not guess). Every response includes sync.syncedAt / sync.syncAgeMinutes / sync.stale (older than 72h) and, when no snapshot is found, sync.reason (never_synced / expired / token_mismatch). Never invent today's asset value when there is no saved record.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portfolio_live_snapshot",
    title: "持股即時概況",
    annotations: READ_ONLY,
    description:
      "Combine the latest synchronized holdings with available quote data and return per-holding latest price, market value and daily change plus portfolio totals. Quote coverage can be partial; never invent missing prices.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Request a manual quote refresh when true. Use sparingly.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "stock_quote", title: "個股／大盤即時行情", annotations: READ_ONLY,
    description: "Read current/last available quotes for Taiwan stocks, ETFs, TAIEX, SPX, SOX or USDTWD. Missing or stale data must be reported explicitly.",
    inputSchema: { type:"object", properties:{ symbols:{type:"array",items:{type:"string"},minItems:1,maxItems:30}, force:{type:"boolean"} }, required:["symbols"], additionalProperties:false }
  },
  {
    name: "stock_news", title: "持股／個股相關新聞", annotations: READ_ONLY,
    description: "Read recent news for requested stock symbols and optional names.",
    inputSchema: { type:"object", properties:{ symbols:{type:"array",items:{type:"string"},minItems:1,maxItems:30}, names:{type:"array",items:{type:"string"},maxItems:30}, windowHours:{type:"integer",minimum:1,maximum:168}, maxPerSymbol:{type:"integer",minimum:1,maximum:10} }, required:["symbols"], additionalProperties:false }
  },
  {
    name: "daily_history", title: "個股／大盤日K歷史", annotations: READ_ONLY,
    description: "Read daily price history for requested symbols for trend and technical analysis.",
    inputSchema: { type:"object", properties:{ symbols:{type:"array",items:{type:"string"},minItems:1,maxItems:30} }, required:["symbols"], additionalProperties:false }
  },
  {
    name: "dividend_schedule", title: "除權除息預告", annotations: READ_ONLY,
    description: "Read TWSE dividend/ex-right schedule for one or more Taiwan symbols.",
    inputSchema: { type:"object", properties:{ symbols:{type:"array",items:{type:"string"},minItems:1,maxItems:30} }, required:["symbols"], additionalProperties:false }
  },
  {
    name: "holiday_schedule", title: "台股休市行事曆", annotations: READ_ONLY,
    description: "Read the official TWSE holiday/market closure schedule.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  },
  {
    name: "taifex_tx", title: "台指期近月行情", annotations: READ_ONLY,
    description: "Read official TAIFEX nearest-month TX futures quote and session context.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  },
  {
    name: "system_health", title: "資產 App 系統健康", annotations: READ_ONLY,
    description: "Read existing system health cards without triggering a new AI health check.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  },
  {
    name: "pending_trades", title: "待確認股票交易", annotations: READ_ONLY,
    description: "Read stock trades currently queued for confirmation in the Assets app. This does not modify holdings.",
    inputSchema: { type:"object", properties:{}, additionalProperties:false }
  }
];

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function rpcError(id, code, message, status = 200) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function toolResult(data, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
    isError,
  };
}

function validSyncToken(token) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(String(token || ""));
}

async function readPortfolio(env, syncToken) {
  const req = new Request("https://asset-app.local/api/portfolio-sync", {
    headers: { authorization: `Bearer ${syncToken}` },
  });
  const res = await portfolioSyncGet({ request: req, env });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || data?.error || `portfolio HTTP ${res.status}`);
  return data;
}

async function readQuotes(env, symbols, force = false) {
  if (!symbols.length) return { ok: true, quotes: {}, missing: [] };
  const url = new URL("https://asset-app.local/quote");
  url.searchParams.set("symbols", symbols.join(","));
  if (force) url.searchParams.set("force", "1");
  const res = await quoteGet({ request: new Request(url), env });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `quote HTTP ${res.status}`);
  return data || { ok: false, quotes: {}, missing: symbols };
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function taipeiNowParts(now = new Date()) {
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
    weekday: t.getUTCDay(),
    minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(),
  };
}

function compactDailyRecord(record) {
  if (!record || typeof record !== "object") return null;
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const totalAsset = num(record.totalAsset) ?? (
    num(record.twValue) != null || num(record.usValue) != null
      ? (num(record.twValue) || 0) + (num(record.usValue) || 0)
      : null
  );
  return {
    date: String(record.date || ""),
    totalAsset,
    twValue: num(record.twValue),
    usValue: num(record.usValue),
    totalCost: num(record.totalCost) ?? (
      num(record.twCost) != null || num(record.usCost) != null
        ? (num(record.twCost) || 0) + (num(record.usCost) || 0)
        : null
    ),
  };
}

// 資產快照多久沒更新算「太舊」：跟 Atlas Muse 一致（72 小時）。
const SYNC_STALE_MINUTES = 72 * 60;

// 回傳同步快照的時間資訊，所有 today_asset_status / asset_agent_brief 的回應都會帶。
export function describeSync(portfolio, now = new Date()) {
  const found = Boolean(portfolio?.found && portfolio?.summary);
  const syncedAt = found ? (portfolio.summary.syncedAt || null) : (portfolio?.lastSyncedAt || null);
  const t = Date.parse(String(syncedAt || ""));
  const syncAgeMinutes = Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60000)) : null;
  return {
    found,
    syncedAt,
    syncAgeMinutes,
    stale: syncAgeMinutes == null ? null : syncAgeMinutes > SYNC_STALE_MINUTES,
    reason: found ? null : (portfolio?.reason || null),
  };
}

function syncAgeText(sync) {
  if (sync?.syncAgeMinutes == null) return "";
  const m = sync.syncAgeMinutes;
  if (m < 60) return `${m} 分鐘前`;
  if (m < 48 * 60) return `約 ${Math.round(m / 60)} 小時前`;
  return `約 ${Math.round(m / 1440)} 天前`;
}

function unavailableAdvice(reason) {
  if (reason === "expired") return "快照已超過保存期限（14 天沒有上傳）：打開存股 App 讓它重新上傳一次（App 開著時會自動同步）。";
  if (reason === "token_mismatch") return "這組 token 沒有上傳紀錄，但最近有其他 token 在上傳：連接器登入時的 token 可能和 App「計畫 → Z∞ 同步」目前的 token 不同，請重新連接並貼上 App 目前的 token。";
  if (reason === "never_synced") return "這組 token 從未上傳過：打開存股 App →「計畫 → Z∞ 同步」確認已開啟，App 開著時會自動同步上傳。";
  return "開啟存股 App 等待自動同步；若開啟 App 後仍無快照，檢查 App 的 Z∞ 同步狀態與連接器登入時的 token 是否一致；不要推定沒有持股。";
}

// TWSE 休市判斷：回傳 { closed: true|false|null, reason }；抓不到行事曆 → null（未知）。
async function marketClosedToday(date) {
  try {
    const res = await holidayGet();
    if (!res.ok) return { closed: null, reason: null };
    const data = await res.json().catch(() => null);
    return holidayStatusFromRows(data?.rows, date);
  } catch {
    return { closed: null, reason: null };
  }
}

// 每個狀態都帶上 sync（syncedAt / syncAgeMinutes / stale / reason）；快照太舊時在 message 後面加註。
async function todayAssetStatus(env, syncToken) {
  const meta = {};
  const result = await todayAssetStatusCore(env, syncToken, meta);
  const note = meta.staleNote && result.message && !result.message.includes(meta.staleNote) ? meta.staleNote : "";
  return { ...result, sync: meta.sync || null, message: result.message ? result.message + note : result.message };
}

async function todayAssetStatusCore(env, syncToken, meta = {}) {
  const p = await readPortfolio(env, syncToken);
  const summary = p?.summary || null;
  const sync = describeSync(p);
  meta.sync = sync;
  if (!p?.found || !summary) {
    const last = sync.syncedAt ? `最後一次上傳是 ${sync.syncedAt}（${syncAgeText(sync)}）。` : "";
    return {
      ok: true,
      status: "snapshot_unavailable",
      today: taipeiNowParts().date,
      marketDay: null,
      hasTodayRecord: null,
      latestRecord: null,
      sync,
      message: `連接器尚未讀到這組 token 的同步快照，無法判斷今日或歷史資產紀錄。${last}${sync.reason === "token_mismatch" ? "" : "存股 App 開啟時會自動同步。"}`,
      recommendation: unavailableAdvice(sync.reason),
    };
  }
  const staleNote = sync.stale ? `（注意：這份快照是 ${syncAgeText(sync)} 上傳的，可能不是最新持股）` : "";
  meta.staleNote = staleNote;
  const rows = Array.isArray(summary?.dataset?.dailyRecords) ? summary.dataset.dailyRecords : [];
  const records = rows
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date || "")))
    .sort((a,b) => String(b.date).localeCompare(String(a.date)));
  const now = taipeiNowParts();
  const todayRecordRaw = records.find(r => String(r.date) === now.date) || null;
  const latestRaw = records[0] || null;
  const todayRecord = compactDailyRecord(todayRecordRaw);
  const latestRecord = compactDailyRecord(latestRaw);

  if (todayRecord) {
    return {
      ok: true,
      status: "recorded",
      today: now.date,
      marketDay: true,
      hasTodayRecord: true,
      record: todayRecord,
      message: "今天已有資產紀錄，請直接以這筆實際紀錄回答。",
      recommendation: "若要看盤中變化，可另外查即時行情；不要用即時行情覆蓋已保存的每日資產紀錄。",
    };
  }

  let holiday = false;
  let holidayName = null;
  const weekend = now.weekday === 0 || now.weekday === 6;
  if (weekend) {
    holiday = true;
    holidayName = now.weekday === 6 ? "週六休市" : "週日休市";
  } else {
    const market = await marketClosedToday(now.date);
    if (market.closed === null) {
      // 抓不到 TWSE 行事曆時不能假設「有開盤」，也不能假設休市。
      return {
        ok: true,
        status: "market_status_unknown",
        today: now.date,
        marketDay: null,
        hasTodayRecord: false,
        latestRecord,
        sync,
        message: (latestRecord
          ? `暫時無法取得 TWSE 休市行事曆，不能確定今天是否開盤；目前最新實際資產紀錄是 ${latestRecord.date}。`
          : "暫時無法取得 TWSE 休市行事曆，不能確定今天是否開盤，而且目前沒有歷史資產紀錄。"),
        recommendation: "先不要據此提醒補登或宣稱休市；稍後再查一次。",
      };
    }
    if (market.closed) {
      holiday = true;
      holidayName = market.reason || "TWSE 休市日";
    }
  }

  if (holiday) {
    return {
      ok: true,
      status: "market_closed",
      today: now.date,
      marketDay: false,
      hasTodayRecord: false,
      holiday: holidayName,
      latestRecord,
      message: latestRecord
        ? `今天是例假／休市日（${holidayName}），今天沒有資產紀錄；目前最新實際資產紀錄是 ${latestRecord.date}。`
        : `今天是例假／休市日（${holidayName}），目前也沒有可用的歷史資產紀錄。`,
      recommendation: "休市日不需要為了補日期而新增一筆相同資產；沿用最近一次實際記錄作為參考即可。",
    };
  }

  if (now.minuteOfDay < 9 * 60) {
    return {
      ok: true,
      status: "pre_market",
      today: now.date,
      marketDay: true,
      hasTodayRecord: false,
      latestRecord,
      message: latestRecord
        ? `今天是開盤日，但現在還沒到 09:00；尚未開盤。最新資產紀錄是 ${latestRecord.date}。`
        : "今天是開盤日，但現在還沒到 09:00；尚未開盤，而且目前沒有歷史資產紀錄。",
      recommendation: "先不用記今日資產；等收盤後再記，避免把盤前數字當成今日收盤資產。",
    };
  }

  if (now.minuteOfDay < 14 * 60) {
    const beforeClose = now.minuteOfDay < 13 * 60 + 30;
    return {
      ok: true,
      status: beforeClose ? "trading_no_record" : "post_close_reminder",
      today: now.date,
      marketDay: true,
      hasTodayRecord: false,
      latestRecord,
      message: beforeClose
        ? "今天是開盤日，目前尚未看到今日資產紀錄。"
        : "今天已收盤，目前尚未看到今日資產紀錄，記得補登今天的資產。",
      recommendation: beforeClose
        ? "盤中可以先看即時行情，但每日資產建議收盤後再記；若你只是問『今天資產』，不要拿即時估值冒充每日紀錄。"
        : "現在是最適合記錄的時間；完成後再用今日紀錄做損益與趨勢比較。",
    };
  }

  return {
    ok: true,
    status: "record_overdue",
    today: now.date,
    marketDay: true,
    hasTodayRecord: false,
    latestRecord,
    message: "今天是開盤日，已過 14:00 仍沒有看到今日資產紀錄，提醒你補登。",
    recommendation: "優先補今天的實際資產紀錄；在補登前，任何『今日資產』回答都應明確標示為缺紀錄，不用即時估值代填。",
  };
}

async function liveSnapshot(env, syncToken, force) {
  const portfolio = await readPortfolio(env, syncToken);
  if (!portfolio?.found || !portfolio.summary) {
    return { ok: true, found: false, syncedAt: null, holdings: [] };
  }

  const summary = portfolio.summary;
  const rawHoldings = Array.isArray(summary.holdings) ? summary.holdings : [];
  const symbols = [...new Set(rawHoldings.map((h) => String(h?.symbol || "").trim().toUpperCase()).filter(Boolean))];
  const quoteData = await readQuotes(env, symbols, Boolean(force));
  const quotes = quoteData?.quotes && typeof quoteData.quotes === "object" ? quoteData.quotes : {};

  let coveredMarketValue = 0;
  let coveredDailyChange = 0;
  let coveredPrevValue = 0;
  let coveredCount = 0;

  const holdings = rawHoldings.map((h) => {
    const symbol = String(h?.symbol || "").trim().toUpperCase();
    const shares = n(h?.shares);
    const q = quotes[symbol] || null;
    const price = n(q?.price);
    const prevClose = n(q?.prevClose);
    const marketValue = shares != null && price != null ? shares * price : null;
    const dailyChange = shares != null && price != null && prevClose != null ? shares * (price - prevClose) : null;
    const dailyChangePct = price != null && prevClose != null && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;

    if (marketValue != null) {
      coveredMarketValue += marketValue;
      coveredCount += 1;
    }
    if (dailyChange != null) coveredDailyChange += dailyChange;
    if (shares != null && prevClose != null) coveredPrevValue += shares * prevClose;

    return {
      symbol,
      name: String(h?.name || ""),
      shares,
      avgCost: n(h?.avgCost),
      latestPrice: price,
      prevClose,
      marketValue,
      dailyChange,
      dailyChangePct,
      quoteSource: q?.source || null,
      quoteAsOf: q?.asOfDate || null,
      stale: q?.isStale ?? q?.stale ?? null,
    };
  });

  return {
    ok: true,
    found: true,
    syncedAt: summary.syncedAt || null,
    quoteFetchedAt: quoteData?.fetchedAt || null,
    quoteStatus: quoteData?.status || null,
    coverage: { quotedHoldings: coveredCount, totalHoldings: holdings.length },
    totals: {
      syncedTotalAssets: n(summary.totalAssets),
      coveredMarketValue: coveredCount ? coveredMarketValue : null,
      coveredDailyChange: coveredCount ? coveredDailyChange : null,
      coveredDailyChangePct:
        coveredPrevValue > 0 ? (coveredDailyChange / coveredPrevValue) * 100 : null,
    },
    holdings,
    missingQuotes: Array.isArray(quoteData?.missing) ? quoteData.missing : [],
    note:
      coveredCount === holdings.length
        ? "全部持股皆有可用報價。"
        : "報價涵蓋不完整；總市值與當日損益只計入有可用報價的持股，不補猜缺失數字。",
  };
}

async function readHealthCards(env) {
  try {
    const res = await healthGet({ request: new Request("https://asset-app.local/api/health-cards"), env });
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.cards) ? data.cards : [];
  } catch {
    return [];
  }
}

async function readPendingTrades(env, syncToken) {
  try {
    const req = new Request("https://asset-app.local/api/pending-trades", {
      headers: { authorization: `Bearer ${syncToken}` },
    });
    const res = await pendingTradesGet({ request: req, env });
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.pending) ? data.pending : [];
  } catch {
    return [];
  }
}

async function assetAgentBrief(env, syncToken, args = {}) {
  const today = await todayAssetStatus(env, syncToken);
  const now = taipeiNowParts();
  const autoLive = today?.marketDay === true && now.minuteOfDay >= 9 * 60 && now.minuteOfDay <= 14 * 60;
  const wantLive = args?.includeLive === true || (args?.includeLive !== false && autoLive);

  const [healthCards, pending, live] = await Promise.all([
    readHealthCards(env),
    readPendingTrades(env, syncToken),
    wantLive ? liveSnapshot(env, syncToken, false).catch(() => null) : Promise.resolve(null),
  ]);

  const pendingHealth = healthCards.filter(c => c?.status === "pending");
  const attention = [];
  const nextActions = [];

  if (today?.status === "snapshot_unavailable") {
    attention.push("連接器尚無可讀取的同步快照");
    nextActions.push(unavailableAdvice(today?.sync?.reason));
  } else if (today?.status === "market_status_unknown") {
    attention.push("暫時無法取得 TWSE 休市行事曆");
    nextActions.push("稍後再確認今天是否開盤，再決定要不要補登資產");
  } else if (today?.status === "post_close_reminder" || today?.status === "record_overdue") {
    attention.push("今天尚未完成資產紀錄");
    nextActions.push("補登今天的實際資產紀錄");
  } else if (today?.status === "trading_no_record") {
    nextActions.push("盤中先看行情；收盤後再記今日資產");
  } else if (today?.status === "pre_market") {
    nextActions.push("09:00 前不用記今日資產，等收盤後再記");
  } else if (today?.status === "market_closed") {
    nextActions.push("休市日不用重複補一筆相同資產");
  } else if (today?.status === "recorded") {
    nextActions.push("今天已有實際資產紀錄，不用重複登記");
  }

  if (today?.sync?.found && today.sync.stale) {
    attention.push(`資產同步快照最後更新在${syncAgeText(today.sync)}，可能不是最新持股`);
    nextActions.push("打開存股 App 讓它上傳一次（App 開著時會自動同步）");
  }
  if (pending.length) {
    attention.push(`有 ${pending.length} 筆待確認交易`);
    nextActions.push("有空時檢查待確認交易；未確認前不視為已寫入持股");
  }
  if (pendingHealth.length) {
    attention.push(`系統有 ${pendingHealth.length} 張待處理健康卡`);
    nextActions.push("查看系統健康卡，必要時再處理");
  }
  if (live?.coverage && live.coverage.quotedHoldings < live.coverage.totalHoldings) {
    attention.push("即時報價涵蓋不完整");
  }

  return {
    ok: true,
    service: "z-infinity-assets-agent",
    mode: "bounded-read-only-agent",
    today: {
      status: today?.status || null,
      date: today?.today || now.date,
      marketDay: today?.marketDay ?? null,
      hasTodayRecord: today?.hasTodayRecord ?? null,
      holiday: today?.holiday || null,
      message: today?.message || null,
      record: today?.record || null,
      latestRecord: today?.latestRecord || null,
      recommendation: today?.recommendation || null,
    },
    sync: today?.sync || null,
    live: live ? {
      quoteFetchedAt: live.quoteFetchedAt || null,
      quoteStatus: live.quoteStatus || null,
      coverage: live.coverage || null,
      totals: live.totals || null,
      missingQuotes: live.missingQuotes || [],
    } : null,
    pendingTrades: {
      count: pending.length,
      items: pending.slice(0, 5).map(x => ({
        id: x?.id || null,
        date: x?.date || null,
        symbol: x?.symbol || null,
        action: x?.action || null,
        shares: x?.shares ?? null,
        price: x?.price ?? null,
      })),
    },
    systemHealth: {
      pendingCount: pendingHealth.length,
      cards: pendingHealth.slice(-5).map(c => ({
        id: c?.id || null,
        severity: c?.severity || null,
        summary: c?.summary || null,
        detectedAt: c?.detectedAt || null,
      })),
    },
    attention,
    nextActions,
    guardrails: [
      "沒有今日實際資產紀錄時，不用即時估值冒充每日資產。",
      "即時報價只作盤中/最近行情參考，不改寫每日紀錄。",
      "此 Agent 唯讀，不會自行新增交易或修改持股。",
    ],
  };
}

async function endpointTool(handler, path, env, params = {}) {
  const url = new URL("https://asset-app.local" + path);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const res = await handler({ request: new Request(url), env });
  const data = await res.json().catch(() => null);
  return toolResult(data ?? { ok:false, error:"Invalid endpoint response" }, !res.ok || data?.ok === false);
}

async function callTool(name, args, env, syncToken) {
  if (name === "asset_summary") {
    const data = await readPortfolio(env, syncToken);
    return toolResult(data, data?.ok === false);
  }
  if (name === "asset_agent_brief") {
    try {
      return toolResult(await assetAgentBrief(env, syncToken, args || {}));
    } catch (error) {
      return toolResult({ ok: false, error: String(error?.message || error).slice(0, 300) }, true);
    }
  }
  if (name === "today_asset_status") {
    try {
      return toolResult(await todayAssetStatus(env, syncToken));
    } catch (error) {
      return toolResult({ ok: false, error: String(error?.message || error).slice(0, 300) }, true);
    }
  }
  if (name === "portfolio_live_snapshot") {
    try {
      return toolResult(await liveSnapshot(env, syncToken, args?.force));
    } catch (error) {
      return toolResult({ ok: false, error: String(error?.message || error).slice(0, 300) }, true);
    }
  }
  if (name === "stock_quote") return endpointTool(quoteGet, "/quote", env, { symbols: args?.symbols, force: args?.force ? 1 : null });
  if (name === "stock_news") return endpointTool(newsGet, "/news", env, { symbols: args?.symbols, names: args?.names, windowHours: args?.windowHours, maxPerSymbol: args?.maxPerSymbol });
  if (name === "daily_history") return endpointTool(dailyHistoryGet, "/daily-history", env, { symbols: args?.symbols });
  if (name === "dividend_schedule") return endpointTool(dividendGet, "/dividend-schedule", env, { symbols: args?.symbols });
  if (name === "holiday_schedule") return endpointTool(holidayGet, "/holiday-schedule", env);
  if (name === "taifex_tx") {
    const res = await taifexGet();
    const data = await res.json().catch(() => null);
    return toolResult(data ?? {ok:false,error:"Invalid TAIFEX response"}, !res.ok || data?.ok === false);
  }
  if (name === "system_health") return endpointTool(healthGet, "/api/health-cards", env);
  if (name === "pending_trades") {
    const req = new Request("https://asset-app.local/api/pending-trades", { headers:{ authorization:`Bearer ${syncToken}` } });
    const res = await pendingTradesGet({request:req, env});
    const data = await res.json().catch(()=>null);
    return toolResult(data ?? {ok:false,error:"Invalid pending-trades response"}, !res.ok || data?.ok === false);
  }
  return null;
}

/**
 * Assets MCP core. worker.js routes /mcp here after OAuth verification and
 * provides the server-side portfolio sync token as context.syncToken.
 */
export async function handlePreparedAssetMcp(request, env, context = {}) {
  if (!validSyncToken(context.syncToken)) {
    return rpcError(null, -32001, "Asset connector is not authorized", 401);
  }
  if (request.method === "GET") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  if (request.method !== "POST") return rpcError(null, -32600, "Method Not Allowed", 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error", 400);
  }
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id, -32600, "Invalid Request", 400);
  }

  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(body.params?.protocolVersion)
        ? body.params.protocolVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions:
        "Z∞ Assets 是受控式唯讀資產 Agent。廣泛問題如『今天資產狀況怎樣／幫我看一下資產』優先使用 asset_agent_brief，一次取得今日紀錄/市場時段、必要的即時報價、系統健康與待確認交易，避免重複呼叫。只問『今天資產多少／今天有沒有記錄』時用 today_asset_status；只問即時持股市值時用 portfolio_live_snapshot；個股行情用 stock_quote；新聞用 stock_news；歷史走勢用 daily_history。today_asset_status 的實際每日紀錄優先於任何即時估值；沒有今日紀錄時絕不可拿即時市值冒充。所有工具皆唯讀，不得宣稱已交易、已修改持股或已補登資產。資料缺失、過期或報價不完整時明說。回答用繁體中文，先結論，再注意事項與下一步。",
    });
  }

  if (body.method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (body.method === "ping") return rpc(body.id, {});
  if (body.method === "tools/list") return rpc(body.id, { tools: PREPARED_ASSET_TOOLS });

  if (body.method === "tools/call") {
    const result = await callTool(
      body.params?.name,
      body.params?.arguments || {},
      env,
      context.syncToken,
    );
    if (!result) return rpcError(body.id, -32602, "Unknown tool");
    return rpc(body.id, result);
  }

  return rpcError(body.id, -32601, "Method not found");
}
