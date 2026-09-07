import { onRequestPost } from "../lib/ask-core.js";

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Device-Id, X-Fallback-Token");
  res.setHeader("Access-Control-Max-Age", "86400");
  return true;
}

function verifyToken(req) {
  const expected = String(process.env.FALLBACK_ACCESS_TOKEN || "");
  if (!expected) return true;
  return String(req.headers["x-fallback-token"] || "") === expected;
}

async function parseBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString("utf8")); } catch { return null; }
  }
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

async function callGemini(options) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY 尚未設定");

  const model = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    const payload = {
      model,
      messages: Array.isArray(options?.messages) ? options.messages : [],
      max_tokens: Number(options?.max_tokens || 1000),
    };
    if (Array.isArray(options?.tools) && options.tools.length) payload.tools = options.tools;

    const response = await fetch(GEMINI_OPENAI_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* keep null */ }
    if (!response.ok) {
      const detail = data?.error?.message || data?.message || text.slice(0, 500) || `HTTP ${response.status}`;
      const err = new Error(`Gemini HTTP ${response.status}: ${detail}`);
      err.status = response.status;
      throw err;
    }
    if (!data) throw new Error("Gemini 回傳不是 JSON");
    return data;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("Gemini 連線逾時");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).json({ ok: false, error: "Method Not Allowed" });
    return;
  }
  if (!verifyToken(req)) {
    res.status(401).json({ ok: false, error: "備援存取 Token 不正確" });
    return;
  }

  const body = await parseBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "JSON 內容無法解析" });
    return;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (Array.isArray(v)) headers.set(k, v.join(","));
    else if (v != null) headers.set(k, String(v));
  }
  const request = new Request("https://external-fallback.local/ask", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const env = {
    AI: { run: async (_cloudflareModel, options) => await callGemini(options) },
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    ASK_RATE_LIMITER: null,
  };

  try {
    const response = await onRequestPost({ request, env, ctx: {} });
    const raw = await response.text();
    let data = null;
    try { data = JSON.parse(raw); } catch { /* keep raw below */ }

    if (data && typeof data === "object") {
      if (data.ok) {
        data.provider = "gemini-external";
        data.model = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
      }
      res.status(response.status).json(data);
      return;
    }
    res.status(response.status).send(raw);
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e?.message || "獨立 Gemini 備援發生未知錯誤",
      provider: "gemini-external",
      model: String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL),
    });
  }
}
