/**
 * portfolio-sync.js — 存股App 持股快照同步
 *
 * 持股資料只存在使用者自己瀏覽器的 localStorage，伺服器端（例如 LINE 機器人 J洛）
 * 本來完全讀不到。這支 API 讓 App 在瀏覽器裡把「目前持股摘要」在資料變動時推一份
 * 過來存進 KV，用一組使用者自己在「計畫」分頁產生、只有自己（跟自己貼給誰）知道的
 * token 當 key——猜不到 token 就讀不到別人的資料，即使大家共用同一個部署網址。
 *
 * 路由（掛在 worker.js）：
 *   POST /api/portfolio-sync   body: { token, summary }  → 寫入/覆蓋這個 token 的快照
 *   GET  /api/portfolio-sync?token=xxx                    → 讀回目前快照
 *
 * KV：沿用 health_kv（見 wrangler.jsonc），不另外申請新的 namespace。
 */

const KV_PREFIX = "portfolio-sync:";
const MAX_BODY_BYTES = 32 * 1024;
const MIN_TOKEN_LEN = 16;
const MAX_TOKEN_LEN = 128;
// 兩週沒有新的同步就讓 KV 自動過期，避免累積沒人在用的舊 token 資料。
const TTL_SECONDS = 60 * 60 * 24 * 14;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function isValidToken(token) {
  return (
    typeof token === "string" &&
    token.length >= MIN_TOKEN_LEN &&
    token.length <= MAX_TOKEN_LEN &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

export async function onRequestGet({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);
  try {
    const raw = await env.health_kv.get(KV_PREFIX + token);
    if (!raw) return jsonResponse({ ok: true, found: false, summary: null });
    return jsonResponse({ ok: true, found: true, summary: JSON.parse(raw) });
  } catch (e) {
    return jsonResponse({ error: "讀取失敗" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return jsonResponse({ error: "內容過大" }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const token = body?.token;
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);

  const summary = body?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return jsonResponse({ error: "缺少 summary" }, 400);
  }

  try {
    const stored = { ...summary, syncedAt: new Date().toISOString() };
    await env.health_kv.put(KV_PREFIX + token, JSON.stringify(stored), { expirationTtl: TTL_SECONDS });
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: "寫入失敗" }, 500);
  }
}
