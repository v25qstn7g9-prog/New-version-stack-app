// Standalone OAuth 2.1 server for the private Z∞ Assets MCP connector.
// Claude and Grok may dynamically register, but only trusted callback URLs are accepted.
// The portfolio sync token is entered at login and is carried inside the signed access token;
// it is never exposed in source code or a public endpoint.

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const CODE_TTL_SECONDS = 5 * 60;
const SCOPE = "read:assets";
const MIN_PASSWORD_LEN = 16;

const ALLOWED_REDIRECTS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://grok.com/connectors-oauth-exchange-code/",
]);

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(value) {
  const s = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function timingSafeEqual(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function readPassword(env) {
  const value = String(env.ASSET_MCP_PASSWORD || env.ZINF_TOOL_TOKEN || "");
  return value.length >= MIN_PASSWORD_LEN ? value : "";
}
async function signingKey(env) {
  const password = readPassword(env);
  if (!password) return null;
  const base = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derived = new Uint8Array(await crypto.subtle.sign("HMAC", base, enc.encode("zinf-assets-mcp-oauth-v1")));
  return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function sign(env, payload) {
  const key = await signingKey(env);
  if (!key) throw new Error("Assets MCP password is not configured");
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return body + "." + b64url(mac);
}
async function verify(env, token, typ) {
  const key = await signingKey(env);
  if (!key || typeof token !== "string") return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  let ok = false;
  try { ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(mac), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))); } catch { return null; }
  if (payload?.typ !== typ || (payload.exp && payload.exp <= Math.floor(Date.now() / 1000))) return null;
  return payload;
}
function isLoopback(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch { return false; }
}
function redirectAllowed(uri) { return ALLOWED_REDIRECTS.has(uri) || isLoopback(uri); }
function redirectMatches(registered, requested) {
  if (registered.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const r = new URL(requested);
  return registered.some((uri) => {
    if (!isLoopback(uri)) return false;
    const u = new URL(uri);
    return u.hostname === r.hostname && u.pathname === r.pathname;
  });
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
function oauthError(error, description, status = 400) { return json({ error, error_description: description }, status); }
export function assetMcpResource(origin) { return origin + "/mcp"; }
function resourceMetadata(origin) {
  return { resource: assetMcpResource(origin), authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Z∞ Assets" };
}
function serverMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: origin + "/oauth/authorize",
    token_endpoint: origin + "/oauth/token",
    registration_endpoint: origin + "/oauth/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [SCOPE],
  };
}
async function onRegister(request, env) {
  if (!readPassword(env)) return oauthError("temporarily_unavailable", "Assets MCP login password is not configured", 503);
  let body;
  try { body = await request.json(); } catch { return oauthError("invalid_client_metadata", "Body must be JSON"); }
  const redirects = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirects.length) return oauthError("invalid_redirect_uri", "redirect_uris is required");
  const bad = redirects.find((uri) => !redirectAllowed(uri));
  if (bad) return oauthError("invalid_redirect_uri", "redirect_uri not allowed: " + bad);
  const name = String(body?.client_name || "MCP client").slice(0, 80);
  const now = Math.floor(Date.now() / 1000);
  const clientId = await sign(env, { typ: "client", r: redirects, n: name, iat: now });
  return json({ client_id: clientId, client_id_issued_at: now, client_name: name, redirect_uris: redirects, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function loginPage({ params, clientName, redirectHost, error }) {
  const hidden = Object.entries(params).map(([k,v]) => '<input type="hidden" name="' + esc(k) + '" value="' + esc(v) + '">').join("");
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Z∞ Assets 登入</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.6 system-ui,-apple-system,"PingFang TC",sans-serif;padding:16px}main{width:100%;max-width:420px;border:1px solid #8885;border-radius:20px;padding:22px}h1{font-size:21px;margin:0 0 6px}p,small{opacity:.7}label{display:block;font-weight:650;margin:14px 0 6px}input{width:100%;font:inherit;font-size:16px;padding:11px 12px;border-radius:12px;border:1px solid #8888;background:transparent;color:inherit}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:12px;background:#2563eb;color:white;font:inherit;font-weight:700}.err{color:#d33}</style></head><body><main>
<h1>🔐 Z∞ Assets</h1><p>${esc(clientName)} 要讀取你的存股快照與行情（唯讀，不會交易或修改持股）。</p>${error ? '<div class="err">'+esc(error)+'</div>' : ""}
<form method="post" action="/oauth/authorize">${hidden}<label>連接器密碼</label><input name="password" type="password" autocomplete="current-password" required autofocus>
<label>存股同步 token</label><input name="sync_token" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<small>使用資產 App「Z∞ 同步」的 token；只會放進你的加密簽章登入憑證。</small><button type="submit">允許並登入</button></form>
<small>登入後返回：${esc(redirectHost)}</small></main></body></html>`, { status: error ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } });
}
const AUTH_PARAMS = ["response_type","client_id","redirect_uri","code_challenge","code_challenge_method","state","scope","resource"];
async function readAuthorize(request) {
  if (request.method === "POST") {
    const form = await request.formData(), params = {};
    for (const k of AUTH_PARAMS) if (form.get(k) != null) params[k] = String(form.get(k));
    return { params, password: String(form.get("password") || ""), syncToken: String(form.get("sync_token") || "").trim() };
  }
  const u = new URL(request.url), params = {};
  for (const k of AUTH_PARAMS) if (u.searchParams.get(k) != null) params[k] = u.searchParams.get(k);
  return { params };
}
async function onAuthorize(request, env, origin) {
  if (!readPassword(env)) return new Response("Assets MCP login password is not configured.", { status: 503 });
  const { params, password, syncToken } = await readAuthorize(request);
  const client = await verify(env, params.client_id, "client");
  if (!client) return new Response("Invalid client_id.", { status: 400 });
  if (!params.redirect_uri || !redirectMatches(client.r || [], params.redirect_uri) || !redirectAllowed(params.redirect_uri)) return new Response("redirect_uri mismatch.", { status: 400 });
  const back = (query) => {
    const u = new URL(params.redirect_uri);
    for (const [k,v] of Object.entries(query)) u.searchParams.set(k,v);
    if (params.state != null) u.searchParams.set("state", params.state);
    return Response.redirect(u.toString(), 302);
  };
  if (params.response_type !== "code") return back({ error: "unsupported_response_type" });
  if (!params.code_challenge || params.code_challenge_method !== "S256") return back({ error: "invalid_request", error_description: "PKCE S256 is required" });
  if (params.resource && params.resource !== assetMcpResource(origin)) return back({ error: "invalid_target" });
  const view = { params, clientName: client.n || "MCP client", redirectHost: new URL(params.redirect_uri).host };
  if (request.method !== "POST") return loginPage(view);
  if (!timingSafeEqual(password, readPassword(env))) return loginPage({ ...view, error: "密碼不對，請再試一次。" });
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(syncToken)) return loginPage({ ...view, error: "存股同步 token 格式不對。" });
  const now = Math.floor(Date.now()/1000);
  const code = await sign(env, { typ:"code", cid: params.client_id.slice(-43), ru:params.redirect_uri, cc:params.code_challenge, st:syncToken, exp:now+CODE_TTL_SECONDS });
  return back({ code });
}
async function s256(verifier) { return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)))); }
async function issueTokens(env, origin, cid, syncToken) {
  const now = Math.floor(Date.now()/1000);
  const access = await sign(env, { typ:"access", aud:assetMcpResource(origin), sc:SCOPE, st:syncToken, iat:now, exp:now+ACCESS_TTL_SECONDS });
  const refresh = await sign(env, { typ:"refresh", cid, st:syncToken, iat:now, exp:now+REFRESH_TTL_SECONDS, j:b64url(crypto.getRandomValues(new Uint8Array(8))) });
  return json({ access_token:access, token_type:"Bearer", expires_in:ACCESS_TTL_SECONDS, refresh_token:refresh, scope:SCOPE });
}
async function onToken(request, env, origin) {
  let form;
  try { form = await request.formData(); } catch { return oauthError("invalid_request","Expected form body"); }
  const grant=String(form.get("grant_type")||""), clientId=String(form.get("client_id")||"");
  if (!(await verify(env,clientId,"client"))) return oauthError("invalid_client","Unknown client_id",401);
  const cid=clientId.slice(-43);
  if (grant==="authorization_code") {
    const code=await verify(env,String(form.get("code")||""),"code");
    if (!code || code.cid!==cid || String(form.get("redirect_uri")||"")!==code.ru) return oauthError("invalid_grant","Invalid authorization code");
    const verifier=String(form.get("code_verifier")||"");
    if (!verifier || await s256(verifier)!==code.cc) return oauthError("invalid_grant","PKCE verification failed");
    return issueTokens(env,origin,cid,code.st);
  }
  if (grant==="refresh_token") {
    const refresh=await verify(env,String(form.get("refresh_token")||""),"refresh");
    if (!refresh || refresh.cid!==cid) return oauthError("invalid_grant","Invalid refresh token");
    return issueTokens(env,origin,cid,refresh.st);
  }
  return oauthError("unsupported_grant_type","Unsupported grant");
}
export async function verifyAssetAccessToken(env, token, origin) {
  const p=await verify(env,token,"access");
  if (!p || p.aud!==assetMcpResource(origin) || !/^[A-Za-z0-9_-]{16,128}$/.test(String(p.st||""))) return null;
  return p;
}
export async function handleAssetOAuth(request, env) {
  const u=new URL(request.url), origin=u.origin, method=request.method.toUpperCase(), path=u.pathname;
  if (method==="GET" && (path==="/.well-known/oauth-protected-resource" || path==="/.well-known/oauth-protected-resource/mcp")) return json(resourceMetadata(origin));
  if (method==="GET" && (path==="/.well-known/oauth-authorization-server" || path==="/.well-known/openid-configuration")) return json(serverMetadata(origin));
  if (path==="/oauth/register" && method==="POST") return onRegister(request,env);
  if (path==="/oauth/authorize" && (method==="GET" || method==="POST")) return onAuthorize(request,env,origin);
  if (path==="/oauth/token" && method==="POST") return onToken(request,env,origin);
  return null;
}
