/**
 * functions/ai-connector-prepared.js
 *
 * 資產 App 的「獨立 AI 中控入口」預備層。
 *
 * IMPORTANT:
 * - 目前刻意沒有掛到 worker.js，所以部署後不會新增任何公開路由。
 * - 目前 Claude / ChatGPT 都不會連到這支檔案。
 * - 未來啟用時，由外層 OAuth/授權 adapter 驗證使用者，再把 portfolio sync token
 *   以 context.syncToken 傳進 handlePreparedAssetMcp()。
 * - 不在原始碼硬編任何 token / secret。
 */
import { onRequestGet as portfolioSyncGet } from "./portfolio-sync.js";
import { onRequestGet as quoteGet } from "./quote.js";

const SERVER = { name: "z-infinity-assets", version: "0.1.0-prepared" };
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

async function callTool(name, args, env, syncToken) {
  if (name === "asset_summary") {
    const data = await readPortfolio(env, syncToken);
    return toolResult(data, data?.ok === false);
  }
  if (name === "portfolio_live_snapshot") {
    try {
      return toolResult(await liveSnapshot(env, syncToken, args?.force));
    } catch (error) {
      return toolResult({ ok: false, error: String(error?.message || error).slice(0, 300) }, true);
    }
  }
  return null;
}

/**
 * Prepared MCP core. NOT ROUTED YET.
 * Future auth layer must verify the AI client/user and provide context.syncToken.
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
        "這是資產存股 App 的獨立唯讀 AI 工具。asset_summary 是最後同步快照；portfolio_live_snapshot 會把持股與可取得的行情合併。資料缺失時必須明說，不得自行補數字。回答使用者時使用繁體中文。",
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
