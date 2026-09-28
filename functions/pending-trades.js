/**
 * pending-trades.js — Atlas 中控台代為送出的「待確認交易」佇列
 *
 * Atlas（透過 MCP，使用者在聊天裡說「幫我記今天買了 0056」）沒辦法直接寫進這個
 * App 的 localStorage——真正的持股/交易資料只存在使用者自己的瀏覽器。所以 Atlas
 * 只能把「使用者已經在聊天裡同意」的交易，暫存到這裡；真正生效要等使用者自己打開
 * 這個 App、在畫面上再按一次「加入」，由瀏覽器自己把它寫進 trades 狀態——
 * 這支 API 全程不會碰到、也看不到使用者的完整持股資料。
 *
 * 路由（掛在 worker.js）：
 *   GET  /api/pending-trades?token=xxx           → 讀回這個 token 目前待確認的交易列表
 *   POST /api/pending-trades   body:{token,trade} → 新增一筆待確認交易（Atlas 呼叫）
 *   POST /api/pending-trades/resolve body:{token,id,applied} → App 端按了加入/忽略後呼叫，把那筆移除
 *
 * KV：沿用 health_kv（跟 portfolio-sync 同一個 namespace），key 用 pending-trades: 前綴，
 * 彼此獨立，不會互相覆蓋。
 */

const KV_PREFIX = "pending-trades:";
const MAX_BODY_BYTES = 8 * 1024;
const MIN_TOKEN_LEN = 16;
const MAX_TOKEN_LEN = 128;
const MAX_PENDING = 20; // 累積上限，避免一直被新增卻沒人處理
const TTL_SECONDS = 60 * 60 * 24 * 14; // 跟 portfolio-sync 一樣兩週後自動過期

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

function tokenFrom(request, url) {
  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return url.searchParams.get("token") || "";
}

// 只驗證新增交易需要的欄位；跟 TradesPanel 手動新增表單同一組限制，
// 讓 App 端可以直接把這筆丟進原本 add() 的邏輯，不用另外處理。
function validateTrade(trade) {
  const date = String(trade?.date || "");
  const symbol = String(trade?.symbol || "").trim().toUpperCase();
  const action = String(trade?.action || "");
  const shares = Number(trade?.shares);
  const price = Number(trade?.price);
  const fee = Number(trade?.fee ?? 0);
  const tax = Number(trade?.tax ?? 0);
  const note = String(trade?.note || "").slice(0, 200);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!symbol || symbol.length > 12) return null;
  if (action !== "buy" && action !== "sell") return null;
  if (!(Number.isFinite(shares) && shares > 0 && shares <= 10_000_000)) return null;
  if (!(Number.isFinite(price) && price > 0 && price <= 100_000_000)) return null;
  if (!(Number.isFinite(fee) && fee >= 0 && fee <= 100_000_000)) return null;
  if (!(Number.isFinite(tax) && tax >= 0 && tax <= 100_000_000)) return null;
  return { date, symbol, action, shares, price, fee, tax, note };
}

export async function onRequestGet({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);
  const url = new URL(request.url);
  const token = tokenFrom(request, url);
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);
  try {
    const raw = await env.health_kv.get(KV_PREFIX + token);
    const list = raw ? JSON.parse(raw) : [];
    return jsonResponse({ ok: true, pending: Array.isArray(list) ? list : [] });
  } catch (e) {
    return jsonResponse({ error: "讀取失敗", detail: String(e?.message || e).slice(0, 300) || null }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);
  const url = new URL(request.url);
  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "內容過大" }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const token = tokenFrom(request, url) || body?.token;
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);
  const trade = validateTrade(body?.trade);
  if (!trade) return jsonResponse({ error: "交易內容格式不對" }, 400);

  try {
    const raw = await env.health_kv.get(KV_PREFIX + token);
    const list = raw ? JSON.parse(raw) : [];
    const item = { id: crypto.randomUUID(), ...trade, proposedAt: new Date().toISOString(), source: "atlas" };
    const next = [item, ...(Array.isArray(list) ? list : [])].slice(0, MAX_PENDING);
    await env.health_kv.put(KV_PREFIX + token, JSON.stringify(next), { expirationTtl: TTL_SECONDS });
    return jsonResponse({ ok: true, pending: item });
  } catch (e) {
    return jsonResponse({ error: "寫入失敗", detail: String(e?.message || e).slice(0, 300) || null }, 500);
  }
}

export async function onRequestResolve({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);
  const url = new URL(request.url);
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }
  const token = tokenFrom(request, url) || body?.token;
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);
  const id = String(body?.id || "");
  if (!id) return jsonResponse({ error: "缺少 id" }, 400);

  try {
    const raw = await env.health_kv.get(KV_PREFIX + token);
    const list = raw ? JSON.parse(raw) : [];
    const next = (Array.isArray(list) ? list : []).filter((x) => x?.id !== id);
    await env.health_kv.put(KV_PREFIX + token, JSON.stringify(next), { expirationTtl: TTL_SECONDS });
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: "更新失敗", detail: String(e?.message || e).slice(0, 300) || null }, 500);
  }
}
