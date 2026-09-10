const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function resolvedGeminiModel() {
  const configured = String(process.env.GEMINI_MODEL || "").trim();
  if (!configured || /^gemini-3(?:\.|-|$)/i.test(configured)) return DEFAULT_GEMINI_MODEL;
  return configured;
}

function allowedOrigins() {
  return String(process.env.APP_ORIGIN || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  const allowed = allowedOrigins();
  if (allowed.length && origin && !allowed.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", allowed.length ? (origin || allowed[0]) : "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Fallback-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
  return true;
}

function verifyToken(req) {
  const expected = String(process.env.FALLBACK_ACCESS_TOKEN || "");
  if (!expected) return true;
  return String(req.headers["x-fallback-token"] || "") === expected;
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    res.status(403).json({ ok: false, error: "這個來源不在 APP_ORIGIN 允許清單" });
    return;
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }
  if (!verifyToken(req)) {
    res.status(401).json({ ok: false, error: "備援存取 Token 不正確" });
    return;
  }

  const hasGeminiKey = Boolean(String(process.env.GEMINI_API_KEY || "").trim());
  res.status(hasGeminiKey ? 200 : 500).json({
    ok: hasGeminiKey,
    provider: "gemini-external",
    model: resolvedGeminiModel(),
    geminiKeyConfigured: hasGeminiKey,
    tavilyConfigured: Boolean(String(process.env.TAVILY_API_KEY || "").trim()),
    originRestricted: allowedOrigins().length > 0,
    tokenProtected: Boolean(String(process.env.FALLBACK_ACCESS_TOKEN || "")),
    error: hasGeminiKey ? undefined : "GEMINI_API_KEY 尚未設定",
  });
}
