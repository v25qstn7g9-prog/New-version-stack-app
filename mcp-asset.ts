/**
 * mcp-asset.ts — 存股 App（new-version-stack-app）的 Today MCP 端點
 *
 * 這是一個輕量 MCP server，用簡單 Bearer Token 驗證（不需要 OAuth），
 * 直接從 KV 讀取持股快照。適合加進既有 worker.js 作為一條新路由。
 *
 * 掛載方式：在 worker.js 的 fetch handler 加入：
 *   if (url.pathname === "/mcp/today") return handleAssetMcpToday(request, env);
 *
 * 需要的 binding / secret：
 *   - health_kv（既有 KV，已綁定）
 *   - LINE_REMINDER_SYNC_TOKEN（既有 Secret，擁有者的同步 token）
 *   - TODAY_MCP_TOKEN（新建 Secret，Today 連線用的 Bearer Token）
 *
 * 所有工具皆唯讀。
 */

const SERVER = { name: "today-asset-mcp", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

interface Env {
  health_kv: KVNamespace;
  LINE_REMINDER_SYNC_TOKEN?: string;
  TODAY_MCP_TOKEN?: string;
}

function jsonRpc(result: unknown, id: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", result, id }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function jsonRpcError(code: number, message: string, id: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const TOOLS = [
  {
    name: "asset_summary",
    title: "資產存股摘要",
    annotations: READ_ONLY,
    description:
      "讀取使用者最新的持股快照：持有標的、股數、成本、總額、損益與近期資產歷史。這是同步快照，非即時市場報價。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "portfolio_pnl",
    title: "持倉損益",
    annotations: READ_ONLY,
    description:
      "讀取最新持倉的損益摘要：總投入成本、總市值、損益金額、損益百分比，以及各持倉的個別損益。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recent_trades",
    title: "近期交易紀錄",
    annotations: READ_ONLY,
    description:
      "讀取最近同步的交易紀錄（買進、賣出、配息），含日期、標的、股數、價格。",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "最多回傳幾筆。預設 20。",
        },
      },
      additionalProperties: false,
    },
  },
];

async function readSnapshot(env: Env): Promise<{ found: boolean; summary: any; reason?: string; syncedAt?: string }> {
  const ownerToken = String(env.LINE_REMINDER_SYNC_TOKEN || "").trim();
  if (!ownerToken || !/^[A-Za-z0-9_-]{16,128}$/.test(ownerToken)) {
    return { found: false, summary: null, reason: "owner_token_not_configured" };
  }
  const raw = await env.health_kv.get(`portfolio-sync:${ownerToken}`);
  if (!raw) {
    return { found: false, summary: null, reason: "awaiting_first_sync" };
  }
  try {
    const summary = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { found: true, summary, syncedAt: summary?.syncedAt || null };
  } catch {
    return { found: false, summary: null, reason: "parse_error" };
  }
}

function extractHoldings(summary: any): any[] {
  if (!summary) return [];
  if (Array.isArray(summary.holdings)) return summary.holdings;
  if (summary.dataset && Array.isArray(summary.dataset.holdings)) return summary.dataset.holdings;
  return [];
}

function extractTrades(summary: any): any[] {
  if (!summary) return [];
  if (summary.dataset && Array.isArray(summary.dataset.trades)) return summary.dataset.trades;
  if (Array.isArray(summary.trades)) return summary.trades;
  return [];
}

function extractDailyRecords(summary: any): any[] {
  if (!summary) return [];
  if (summary.dataset && Array.isArray(summary.dataset.dailyRecords)) return summary.dataset.dailyRecords;
  if (Array.isArray(summary.dailyRecords)) return summary.dailyRecords;
  return [];
}

async function callTool(name: string, args: any, env: Env): Promise<{ content: any[]; isError?: boolean }> {
  const { found, summary, reason } = await readSnapshot(env);

  if (!found) {
    return {
      content: [
        {
          type: "text",
          text: `目前讀不到持股快照。原因：${reason || "unknown"}。請確認 App 已同步過至少一次，且 LINE_REMINDER_SYNC_TOKEN 已設定。`,
        },
      ],
    };
  }

  if (name === "asset_summary") {
    const holdings = extractHoldings(summary);
    const dailyRecords = extractDailyRecords(summary);
    const totalAssets = summary.totalAssets ?? summary.dataset?.totalAssets ?? null;
    const investedCapital = summary.investedCapital ?? summary.dataset?.investedCapital ?? null;
    const totalReturn = summary.totalReturn ?? null;
    const goal = summary.goal ?? null;

    const text = [
      `資產快照（同步時間：${summary.syncedAt || "未知"}）`,
      ``,
      `總資產：${totalAssets ?? "未提供"}`,
      `投入成本：${investedCapital ?? "未提供"}`,
      `損益：${totalReturn ?? "未提供"}`,
      `目標：${goal ?? "未設定"}`,
      ``,
      `持有標的（${holdings.length} 檔）：`,
      ...holdings.map((h: any) =>
        `  ${h.symbol || h.code || "?"} ${h.name || ""} — ${h.shares || 0} 股，成本 ${h.avgCost || h.avg_cost || "?"}`
      ),
      ``,
      `近期資產紀錄（最近 ${Math.min(dailyRecords.length, 5)} 筆）：`,
      ...dailyRecords.slice(-5).map((d: any) => `  ${d.date || d.occurredAt || "?"} — ${d.totalAssets ?? d.value ?? "?"}`),
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  }

  if (name === "portfolio_pnl") {
    const holdings = extractHoldings(summary);
    const totalCost = summary.investedCapital ?? summary.dataset?.investedCapital ?? null;
    const totalValue = summary.totalAssets ?? summary.dataset?.totalAssets ?? null;

    const lines = [
      `持倉損益摘要（同步時間：${summary.syncedAt || "未知"}）`,
      ``,
      `總投入：${totalCost ?? "未提供"}`,
      `總市值：${totalValue ?? "未提供"}`,
    ];

    if (totalCost && totalValue) {
      const pnl = totalValue - totalCost;
      const pnlPct = totalCost > 0 ? ((pnl / totalCost) * 100).toFixed(2) : "?";
      lines.push(`損益：${pnl.toFixed(0)}（${pnlPct}%）`);
    }

    lines.push("", "各持倉損益：");
    for (const h of holdings) {
      const cost = h.totalCost ?? (h.shares && h.avgCost ? h.shares * h.avgCost : null);
      const value = h.marketValue ?? h.currentValue ?? null;
      if (cost && value) {
        const pnl = value - cost;
        const pct = cost > 0 ? ((pnl / cost) * 100).toFixed(1) : "?";
        lines.push(`  ${h.symbol || "?"} ${h.name || ""}：成本 ${cost}、市值 ${value}、損益 ${pnl.toFixed(0)}（${pct}%）`);
      } else {
        lines.push(`  ${h.symbol || "?"} ${h.name || ""}：成本 ${cost ?? "?"}、市值 ${value ?? "?"}（資料不完整）`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  if (name === "recent_trades") {
    const limit = Math.min(args?.limit || 20, 50);
    const trades = extractTrades(summary).slice(-limit).reverse();
    if (trades.length === 0) {
      return { content: [{ type: "text", text: "快照中沒有交易紀錄。" }] };
    }
    const lines = [
      `近期交易紀錄（最近 ${trades.length} 筆）：`,
      "",
      ...trades.map((t: any) => {
        const date = t.date || t.occurredAt || "?";
        const symbol = t.symbol || t.code || "?";
        const action = t.action || t.type || "?";
        const shares = t.shares || t.quantity || "?";
        const price = t.price ?? "?";
        return `  ${date} ${action} ${symbol} ${shares} 股 @ ${price}`;
      }),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  }

  return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
}

export async function handleAssetMcpToday(request: Request, env: Env): Promise<Response> {
  // Bearer Token 驗證
  const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const expected = String(env.TODAY_MCP_TOKEN || "").trim();
  if (!expected) {
    return apiJson({ error: "TODAY_MCP_TOKEN 尚未設定" }, 503);
  }
  if (!bearer || !sameSecret(bearer, expected)) {
    return apiJson({ error: "Unauthorized" }, 401, {
      "WWW-Authenticate": 'Bearer',
    });
  }

  // GET 回傳 server info（給 Today 設定頁面探測用）
  if (request.method === "GET") {
    return apiJson({ server: SERVER.name, version: SERVER.version, protocol: PROTOCOL_VERSION });
  }

  if (request.method !== "POST") {
    return apiJson({ error: "Method Not Allowed" }, 405, { Allow: "GET, POST" });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(-32700, "Parse error", null);
  }

  const { jsonrpc, id, method, params } = body;

  if (method === "initialize") {
    return jsonRpc(
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER.name, version: SERVER.version },
      },
      id
    );
  }

  if (method === "initialized" || method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (method === "tools/list") {
    return jsonRpc({ tools: TOOLS }, id);
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return jsonRpcError(-32601, `Tool not found: ${toolName}`, id);
    }
    try {
      const result = await callTool(toolName, toolArgs, env);
      return jsonRpc(result, id);
    } catch (err: any) {
      return jsonRpc({
        content: [{ type: "text", text: `工具執行錯誤：${String(err?.message || err).slice(0, 300)}` }],
        isError: true,
      }, id);
    }
  }

  return jsonRpcError(-32601, `Method not found: ${method}`, id);
}
