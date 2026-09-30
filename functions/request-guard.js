/**
 * request-guard.js — 共用的請求保護工具
 *
 * - constantTimeEqual：密碼／token 比對一律固定時間
 * - adminTokenMatches：伺服器端管理密碼（ASSET_MCP_PASSWORD 或 ZINF_TOOL_TOKEN）
 * - writeAllowed：寫入端點依 IP 限流（綁定 WRITE_RATE_LIMITER 時才生效，沒綁定就放行）
 * - authAttemptBlocked / recordAuthFailure：登入密碼錯誤次數限制
 *   （綁定 AUTH_RATE_LIMITER 時也會套用；另外用 health_kv 計數，只有「密碼錯」才寫 KV）
 *
 * 所有限流都「壞掉就放行」：限流元件故障不能讓 App 同步或 Claude 登入整個壞掉。
 */

const MIN_ADMIN_TOKEN_LEN = 16;
const AUTH_FAIL_PREFIX = "authfail:";
const AUTH_FAIL_MAX = 10;
const AUTH_FAIL_WINDOW_SECONDS = 15 * 60;

export function constantTimeEqual(a, b) {
  const encoder = new TextEncoder();
  const x = encoder.encode(String(a ?? ""));
  const y = encoder.encode(String(b ?? ""));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
}

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip")
    || String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "unknown";
}

// 管理用 token：ASSET_MCP_PASSWORD 或 ZINF_TOOL_TOKEN 任一（至少 16 字）都算。
export function adminTokenMatches(env, supplied) {
  if (!supplied) return false;
  const candidates = [env?.ASSET_MCP_PASSWORD, env?.ZINF_TOOL_TOKEN]
    .map((v) => String(v || ""))
    .filter((v) => v.length >= MIN_ADMIN_TOKEN_LEN);
  let ok = false;
  for (const candidate of candidates) ok = constantTimeEqual(supplied, candidate) || ok;
  return ok;
}

export async function writeAllowed(env, request, scope = "write") {
  const limiter = env?.WRITE_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function") return true;
  try {
    const { success } = await limiter.limit({ key: `${scope}:${clientIp(request)}` });
    return success !== false;
  } catch {
    return true;
  }
}

async function readAuthFail(env, key) {
  const raw = await env.health_kv.get(key);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

export async function authAttemptBlocked(env, request, scope) {
  const limiter = env?.AUTH_RATE_LIMITER;
  if (limiter && typeof limiter.limit === "function") {
    try {
      const { success } = await limiter.limit({ key: `${scope}:${clientIp(request)}` });
      if (success === false) return true;
    } catch { /* 放行 */ }
  }
  if (!env?.health_kv) return false;
  try {
    const record = await readAuthFail(env, `${AUTH_FAIL_PREFIX}${scope}:${clientIp(request)}`);
    return Boolean(record && Number(record.count) >= AUTH_FAIL_MAX && Number(record.until) > Date.now());
  } catch {
    return false;
  }
}

export async function recordAuthFailure(env, request, scope) {
  if (!env?.health_kv) return;
  try {
    const key = `${AUTH_FAIL_PREFIX}${scope}:${clientIp(request)}`;
    const record = await readAuthFail(env, key);
    const now = Date.now();
    const active = record && Number(record.until) > now;
    const next = {
      count: active ? Number(record.count || 0) + 1 : 1,
      until: active ? Number(record.until) : now + AUTH_FAIL_WINDOW_SECONDS * 1000,
    };
    await env.health_kv.put(key, JSON.stringify(next), { expirationTtl: Math.max(60, Math.ceil((next.until - now) / 1000)) });
  } catch { /* KV 失敗不影響登入流程 */ }
}
