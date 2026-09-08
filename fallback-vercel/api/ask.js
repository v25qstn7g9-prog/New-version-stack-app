import { onRequestPost } from "../lib/ask-core.js";

// 這組帳號是新申請的 Gemini API Key，Google 目前限制新帳號只能用 3.x 系列
// （2.5 系列回傳 404「no longer available to new users」），沒有退路，只能用 3.5。
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

// 逐步試水溫用：先只開放這個清單裡的工具給 Gemini 備援，其他一律不給
// functionDeclaration（模型端會完全不知道它們存在）。ask-core.js 也會依照這份清單
// 自動切換成對應的「部分功能」系統提示詞，只教學這幾個工具、明講其餘不存在，
// 不會出現「system prompt 教了但沒真的給」導致模型模仿假造呼叫語法的問題。
// 想加開更多，就把工具名稱加進這個陣列即可（順序建議：唯讀工具先開，會寫入資料的
// add_trade / update_* 最後再開）。
const FALLBACK_ALLOWED_TOOL_NAMES = ["get_live_quotes"];

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

// ---- OpenAI 風格 messages/tools 翻譯成 Gemini 原生格式 ----
// 新版 Gemini API Key（AQ. 開頭）用 Google AI Studio 官方「Copy cURL quickstart」
// 驗證過的方式：x-goog-api-key 表頭 + 原生 generateContent 端點，不是 Authorization:
// Bearer + OpenAI 相容端點——後者對 AQ. 格式金鑰會回傳認證錯誤（今天已經實測踩過）。
function toGeminiRequest(messages, tools) {
  const systemParts = [];
  const contents = [];
  const callIdToName = {};

  for (const m of messages || []) {
    if (m.role === "system") {
      systemParts.push(String(m.content || ""));
      continue;
    }
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: String(m.content || "") }] });
      continue;
    }
    if (m.role === "assistant") {
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const parts = m.tool_calls.map((tc) => {
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = {}; }
          callIdToName[tc.id] = tc.function?.name;
          const part = { functionCall: { name: tc.function?.name, args } };
          // Gemini 要求把上一輪它自己給的 thought_signature 原封不動帶回同一個
          // functionCall part，否則下一輪會被拒絕（400: missing thought_signature）。
          if (tc._geminiThoughtSignature) part.thoughtSignature = tc._geminiThoughtSignature;
          return part;
        });
        contents.push({ role: "model", parts });
      } else {
        contents.push({ role: "model", parts: [{ text: String(m.content || "") }] });
      }
      continue;
    }
    if (m.role === "tool") {
      const name = callIdToName[m.tool_call_id] || "tool_result";
      // 【重要修正】舊版 Gemini API 用 role:"function" 包工具查詢結果，
      // 但 gemini-3.5-flash-lite 這個新版不接受這個角色名稱，會直接 400
      // 「Role 'function' is not supported」。新版只認 USER/MODEL（加系統角色），
      // functionResponse 這個 part 改包在 role:"user" 底下送回去。
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name, response: { result: String(m.content || "") } } }],
      });
      continue;
    }
  }

  const body = { contents };
  if (systemParts.length) body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  if (Array.isArray(tools) && tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }];
  }
  return body;
}

// 把 Gemini 原生回應轉回 ask-core.js 認得的 OpenAI 風格結構（choices[0].message）。
// 每個 functionCall part 收到的 thoughtSignature 也一併帶出去（放在自訂欄位
// _geminiThoughtSignature），讓 ask-core.js 組下一輪訊息時能原樣帶回去給 Gemini。
function fromGeminiResponse(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const functionCallParts = parts.filter((p) => p.functionCall);
  if (functionCallParts.length > 0) {
    return {
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: functionCallParts.map((p, idx) => ({
            id: `gemini_call_${idx}`,
            type: "function",
            function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
            ...(p.thoughtSignature ? { _geminiThoughtSignature: p.thoughtSignature } : {}),
          })),
        },
      }],
    };
  }
  const text = parts.map((p) => p.text || "").join("").trim();
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

async function callGemini(options) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY 尚未設定");

  const model = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 28000);
  try {
    // 【重要】以前這裡故意傳 []，完全不給 Gemini 工具清單，用來規避 thought_signature
    // 驗證問題——但根源其實是 ask-core.js 在把歷史 toolTurns 組回 messages 時，
    // 弄丟了 Gemini 自己附帶的 thoughtSignature（已修正，見 ask-core.js 的
    // toolTurns.forEach）。現在改成真的把（篩選過的）tools 傳給 Gemini，讓
    // FALLBACK_ALLOWED_TOOL_NAMES 清單裡的工具可以真正被呼叫、簽章正確原樣帶回去。
    const payload = toGeminiRequest(options?.messages, options?.tools || []);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }
    );
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
    if (data?.promptFeedback?.blockReason) {
      throw new Error(`Gemini 內容被擋下（${data.promptFeedback.blockReason}）`);
    }
    return fromGeminiResponse(data);
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
    // 告訴 ask-core.js 這次只有這幾個工具是真的能用，其他工具的教學段落會被拿掉，
    // 換成「這些不存在」的明確提示，避免模型照著它看不到的工具說明模仿呼叫語法。
    AI_ALLOWED_TOOL_NAMES: FALLBACK_ALLOWED_TOOL_NAMES,
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
