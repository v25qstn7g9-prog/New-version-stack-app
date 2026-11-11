/** 唯讀 API，沿用 portfolio-sync 的 token 隔離與 SI Hub 唯讀權限。 */
import { onRequestGet as portfolioSyncGet, isSiHubReadToken, isKnownSyncToken } from "./portfolio-sync.js";
import { calculateConcentration } from "./concentration.js";

export const RISK_PREFIX = "portfolio-risk:v1:";
export async function onRequestGet({ request, env }) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  if (!/^Bearer\s+/i.test(request.headers.get("authorization") || "") || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    // 不傳 query（尤其 prev/token），只讀當前快照。
    const response = await portfolioSyncGet({ request: new Request("https://asset-app.local/api/portfolio-sync", { headers: { authorization: `Bearer ${token}` } }), env });
    if (!response.ok) return json({ ok: false, error: "snapshot_unavailable" }, response.status);
    const data = await response.json();
    let scopedToken = token;
    if (isSiHubReadToken(env, token) && !(await isKnownSyncToken(env, token))) scopedToken = String(env.LINE_REMINDER_SYNC_TOKEN || "").trim();
    let state = null;
    try { state = JSON.parse(await env.health_kv.get(RISK_PREFIX + scopedToken) || "null"); } catch { /* 告警讀不到不影響集中度 */ }
    return json({ ok: true, found: data.found, reason: data.reason || null,
      concentration: calculateConcentration(data.summary),
      notifications: { updatedAt: state?.updatedAt || null, sourceSyncedAt: state?.sourceSyncedAt || null,
        alerts: Array.isArray(state?.alerts) ? state.alerts : [], line: state?.line || { skipped: "not_evaluated" },
        decline: state?.decline || null },
      disclaimer: "僅供自我追蹤，非投資建議；快照非即時行情。" });
  } catch { return json({ ok: false, error: "risk_read_failed" }, 503); }
}
