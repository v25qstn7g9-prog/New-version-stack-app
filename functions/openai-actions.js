// ChatGPT GPT Actions 用的唯讀 REST 接口：把資產 MCP 的唯讀工具原樣轉成 OpenAPI。
//   GET  /openai/openapi.json        公開的 OpenAPI 說明檔（貼進 GPT 的 Actions 設定）
//   POST /openai/tools/<工具名稱>     帶 x-api-key 標頭；金鑰存在 env.OPENAI_ACTION_KEY
// 資產 MCP 的每個工具本來就全部唯讀；這裡不新增任何寫入路徑。
import { PREPARED_ASSET_TOOLS, handlePreparedAssetMcp } from "./ai-connector-prepared.js";

const openAiEnc = new TextEncoder();

function openAiJson(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });
}

function openAiSameSecret(a, b) {
  const x = openAiEnc.encode(String(a)), y = openAiEnc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

const openAiReadOnlyTools = () => PREPARED_ASSET_TOOLS.filter((t) => t.annotations?.readOnlyHint === true);

export function buildOpenApi(origin) {
  const paths = {};
  for (const t of openAiReadOnlyTools()) {
    paths[`/openai/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title || t.name,
        description: String(t.description || "").slice(0, 300),
        requestBody: { required: false, content: { "application/json": { schema: t.inputSchema || { type: "object", properties: {} } } } },
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } },
        security: [{ ApiKeyAuth: [] }],
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Z∞ Assets（唯讀）", version: "1.0.0", description: "資產、持股、行情與新聞的唯讀查詢。" },
    servers: [{ url: origin }],
    paths,
    components: { securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" } } },
  };
}

export async function handleOpenAiActions(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/openai/")) return null;

  if (url.pathname === "/openai/openapi.json" && request.method === "GET") return openAiJson(buildOpenApi(url.origin));

  const m = url.pathname.match(/^\/openai\/tools\/([a-z_]+)$/);
  if (!m) return openAiJson({ error: "Not found" }, 404);
  if (request.method !== "POST") return openAiJson({ error: "Method Not Allowed" }, 405, { allow: "POST" });

  const key = String(env.OPENAI_ACTION_KEY || "").trim();
  if (!key) return openAiJson({ error: "尚未設定 OPENAI_ACTION_KEY，OpenAI Action 未開放。" }, 503);
  if (!openAiSameSecret(request.headers.get("x-api-key") || "", key)) return openAiJson({ error: "Unauthorized" }, 401);

  const tool = openAiReadOnlyTools().find((t) => t.name === m[1]);
  if (!tool) return openAiJson({ error: "Unknown tool" }, 404);

  // 讀取資產快照用 SI Hub 同一把唯讀金鑰（Secret SI_HUB_READ_TOKEN），這把金鑰不能寫入。
  const syncToken = String(env.SI_HUB_READ_TOKEN || "").trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(syncToken)) return openAiJson({ error: "Assets sync token is not configured" }, 503);

  let args = {};
  try { const text = await request.text(); if (text.trim()) args = JSON.parse(text); }
  catch { return openAiJson({ error: "Invalid JSON" }, 400); }

  const rpcRequest = new Request(url.origin + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: args && typeof args === "object" ? args : {} } }),
  });
  const rpcResponse = await handlePreparedAssetMcp(rpcRequest, env, { syncToken });
  const out = await rpcResponse.json().catch(() => null);
  const result = out?.result;
  if (!result) return openAiJson({ error: out?.error?.message || "Tool call failed" }, 502);
  return openAiJson(result.structuredContent ?? result, result.isError ? 502 : 200);
}
