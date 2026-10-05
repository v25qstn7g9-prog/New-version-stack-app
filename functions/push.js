/**
 * push.js — 收盤提醒的網頁推播（Web Push，無內容版）
 *
 * 伺服器只記「推播地址」（endpoint），完全不存持股或金額。每個開盤日：
 *   13:45 → 推一次（手機上的 Service Worker 醒來，顯示「還沒記錄的話 14:00 會自動記」）
 *   14:00 → 再推一次（Service Worker 用手機裡的持股＋即時報價自動記錄，並顯示結果）
 * 推播本身不帶內容，要顯示什麼、記不記，全由手機上的 sw.js 依照自己的資料決定。
 *
 * VAPID 金鑰第一次用到時自動產生並存在 KV（push:vapid），不需要設任何 Secret。
 * KV：push:vapid = { publicKey, privateJwk }；push-sub:<sha256(endpoint)前 32 字> = { endpoint, createdAt }
 */
import { holidayStatusFromRows } from "./twse-holiday.js";
import { onRequestGet as holidayGet } from "./holiday-schedule.js";

export const PUSH_MINUTES = [13 * 60 + 45];
const VAPID_KEY = "push:vapid";
const SUB_PREFIX = "push-sub:";
const MAX_SUBSCRIPTIONS = 200;
const VAPID_SUBJECT = "mailto:noreply@new-version-stack-app.workers.dev";
// 只接受主流瀏覽器的推播服務，避免被當成任意網址的請求跳板（SSRF）。
const ALLOWED_PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export function b64url(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isAllowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && endpoint.length <= 600 && ALLOWED_PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

async function subKey(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return SUB_PREFIX + b64url(digest).slice(0, 32);
}

export async function getVapid(env) {
  const stored = await env.health_kv.get(VAPID_KEY, "json");
  if (stored?.publicKey && stored?.privateJwk) return stored;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const fresh = { publicKey, privateJwk, createdAt: new Date().toISOString() };
  await env.health_kv.put(VAPID_KEY, JSON.stringify(fresh));
  return fresh;
}

export async function vapidHeader(env, endpoint, now = Date.now()) {
  const vapid = await getVapid(env);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: VAPID_SUBJECT })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${body}`));
  return `vapid t=${header}.${body}.${b64url(sig)}, k=${vapid.publicKey}`;
}

export async function sendPush(env, endpoint, fetchImpl = fetch) {
  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: await vapidHeader(env, endpoint), TTL: "1800", Urgency: "high", "content-length": "0" },
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

async function listSubscriptions(env) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const page = await env.health_kv.list({ prefix: SUB_PREFIX, cursor });
    for (const k of page.keys || []) out.push(k.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

async function defaultMarketClosed(date) {
  try {
    const res = await holidayGet();
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return holidayStatusFromRows(data?.rows, date)?.closed ?? null;
  } catch {
    return null;
  }
}

function taipeiNow(now) {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** 對所有訂閱發一次推播。force=true 略過「是不是推播時間」的檢查（14:00 的 cron 本身就是時間點）。 */
export async function runPushRound(env, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const t = taipeiNow(now);
  if (!env?.health_kv) return { skipped: "no_kv" };
  if (!deps.force && !PUSH_MINUTES.includes(t.minuteOfDay)) return { skipped: "not_push_minute" };
  if (t.weekday === 0 || t.weekday === 6) return { skipped: "weekend" };
  if ((await (deps.marketClosed || defaultMarketClosed)(t.date)) === true) return { skipped: "holiday" };
  const send = deps.send || ((endpoint) => sendPush(env, endpoint, deps.fetch || fetch));
  let sent = 0, failed = 0, removed = 0;
  for (const name of await listSubscriptions(env)) {
    const sub = await env.health_kv.get(name, "json");
    if (!sub?.endpoint) continue;
    try {
      const r = await send(sub.endpoint);
      if (r.ok) sent++;
      else if (r.gone) { await env.health_kv.delete(name); removed++; }
      else failed++;
    } catch {
      failed++;
    }
  }
  return { ok: true, sent, failed, removed };
}

export async function onRequestPush({ request, env }) {
  const url = new URL(request.url);
  if (!env?.health_kv) return json({ error: "KV not configured" }, 500);
  if (url.pathname === "/api/push/key" && request.method === "GET") {
    return json({ ok: true, publicKey: (await getVapid(env)).publicKey });
  }
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);
  const body = await request.json().catch(() => null);
  const endpoint = String(body?.endpoint || "");
  if (!isAllowedEndpoint(endpoint)) return json({ error: "不支援的推播地址" }, 400);
  const key = await subKey(endpoint);
  if (url.pathname === "/api/push/unsubscribe") {
    await env.health_kv.delete(key);
    return json({ ok: true });
  }
  if (url.pathname === "/api/push/subscribe") {
    const existing = await env.health_kv.get(key);
    if (!existing && (await listSubscriptions(env)).length >= MAX_SUBSCRIPTIONS) return json({ error: "訂閱數已達上限" }, 429);
    await env.health_kv.put(key, JSON.stringify({ endpoint, createdAt: new Date().toISOString() }));
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}
