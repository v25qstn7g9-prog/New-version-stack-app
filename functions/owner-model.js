import { OWNER_MODEL_KV_KEY, normalizeModelName, defaultGeminiModel, readOwnerModel } from "./ask.js";

// Owner 專用：讀取／設定自己詢問時使用的 Gemini 模型。身分用 LINE_REMINDER_SYNC_TOKEN 比對（同 /api/system-stats）。
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function isOwner(request, env) {
  const auth = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const owner = String(env?.LINE_REMINDER_SYNC_TOKEN || "").trim();
  return Boolean(auth && owner && auth === owner);
}

export async function onRequestGet({ request, env }) {
  if (!isOwner(request, env)) return json({ ok: false, error: "Forbidden" }, 403);
  return json({ ok: true, model: await readOwnerModel(env), defaultModel: defaultGeminiModel(env) });
}

export async function onRequestPost({ request, env }) {
  if (!isOwner(request, env)) return json({ ok: false, error: "Forbidden" }, 403);
  if (!env?.health_kv) return json({ ok: false, error: "沒有設定 KV，無法儲存" }, 503);
  const body = await request.json().catch(() => null);
  const raw = String(body?.model ?? "").trim();
  if (!raw) {
    await env.health_kv.delete(OWNER_MODEL_KV_KEY);
    return json({ ok: true, model: "", defaultModel: defaultGeminiModel(env) });
  }
  const model = normalizeModelName(raw);
  if (!model) return json({ ok: false, error: "模型名稱格式不對，需為 gemini- 開頭的英數字（例如 gemini-3.6-flash）" }, 400);
  await env.health_kv.put(OWNER_MODEL_KV_KEY, model);
  return json({ ok: true, model, defaultModel: defaultGeminiModel(env) });
}
