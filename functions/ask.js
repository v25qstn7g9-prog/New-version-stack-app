/**
 * ask.js — 4.7-personal-advisor-v2.29.1-gemini36-direct-fallback
 *
 * POST /ask
 * body: {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }, ...],
 *   context?: string   // 持股摘要純文字；閒聊可不帶以省 neurons
 * }
 * 回傳: { ok: true, reply } 或 { ok: true, toolCalls: [{ name, arguments }] }
 *
 * Cloudflare AI Binding：Variable name = AI
 * Cloudflare 為主模型；Cloudflare 失敗時由同一個 Worker 直接切 Gemini 3.6 Flash。
 * 舊 fallback-vercel 仍保留作最後一道相容備援。
 */
const ASK_VERSION = "4.7-personal-advisor-v3.2-bounded-learning";
const GEMINI_MODEL_DEFAULT = "gemini-3.6-flash";
const GEMINI_MAX_OUTPUT_TOKENS = 1000;
const LIGHT_MODEL = "@cf/zai-org/glm-4.7-flash";
const HEAVY_MODEL = "@cf/openai/gpt-oss-20b";

function chooseAssetModel(message = "", contextText = "", toolTurns = [], forceAnswer = false) {
  const question = String(message || "");
  const complex = /(完整分析|綜合分析|比較|趨勢|歷史|為什麼|原因|風險|情境|規劃|預測|模型|驗證|關聯|法人|新聞|台指|隔夜|跨期|月總結|年度|全部紀錄)/i.test(question);
  const multiStep = Array.isArray(toolTurns) && toolTurns.length > 0;
  const veryLargeContext = String(contextText || "").length > 16000;
  return (complex || multiStep || veryLargeContext) ? HEAVY_MODEL : LIGHT_MODEL;
}
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_CONTENT = 3000;
const MAX_CONTEXT_LEN = 12000;
const MAX_TOKENS = 1000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SERVER_SEARCH_ROUNDS = 2;

// 家人／朋友內測的 AI 成本保護：一般裝置每天最多 15 次模型請求。
// Owner 沿用 LINE_REMINDER_SYNC_TOKEN 作伺服器端識別；token 只透過 Authorization header 傳送，
// 不寫進公開程式碼。沒有設定 health_kv 時安全退化成只保留原本的短期限流。
const DAILY_AI_LIMIT = 15;
const AI_QUOTA_PREFIX = "ai-daily-quota:";
const AI_QUOTA_TTL_SECONDS = 60 * 60 * 48;

function taiwanQuotaDate() {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return t.toISOString().slice(0, 10);
}

function bearerToken(request) {
  const auth = String(request?.headers?.get("authorization") || "");
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
}

function isOwnerAsk(request, env) {
  const supplied = bearerToken(request);
  const owner = String(env?.LINE_REMINDER_SYNC_TOKEN || "").trim();
  return Boolean(supplied && owner && supplied === owner);
}

async function quotaDeviceTag(deviceId, clientIp) {
  const raw = deviceId ? `device:${deviceId}` : (clientIp ? `ip:${clientIp}` : "anonymous");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ask-quota:${raw}`)));
  return Array.from(bytes.slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function consumeDailyAiQuota(env, deviceId, clientIp) {
  if (!env?.health_kv) return { ok: true, skipped: "no_kv" };
  const date = taiwanQuotaDate();
  const tag = await quotaDeviceTag(deviceId, clientIp);
  const key = `${AI_QUOTA_PREFIX}${date}:${tag}`;
  let used = Number(await env.health_kv.get(key) || 0);
  if (!Number.isFinite(used) || used < 0) used = 0;
  if (used >= DAILY_AI_LIMIT) return { ok: false, used, limit: DAILY_AI_LIMIT };
  used += 1;
  await env.health_kv.put(key, String(used), { expirationTtl: AI_QUOTA_TTL_SECONDS });
  return { ok: true, used, limit: DAILY_AI_LIMIT };
}
const primaryCooldown = new WeakMap();
const PRIMARY_AI_TIMEOUT_MS = 30000;
const GEMINI_AI_TIMEOUT_MS = 25000;

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 逾時（超過 ${Math.round(ms / 1000)} 秒未回應）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const ASK_CACHE_TTL_MS = 5 * 60 * 1000;
const ASK_CACHE = new Map();

function normalizeAskCacheHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-2)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 300).trim() }));
}

function buildAskCacheKey(message, history, contextText, toolTurns) {
  const safeMessage = String(message || "").trim();
  const normalizedHistory = normalizeAskCacheHistory(history);
  const safeContextFlag = typeof contextText === "string" && contextText.trim() ? "private-context" : "no-context";
  const toolCount = Array.isArray(toolTurns) ? toolTurns.length : 0;
  return JSON.stringify({
    message: safeMessage.slice(0, 500),
    history: normalizedHistory,
    context: safeContextFlag,
    toolTurns: toolCount,
  });
}

function readAskCache(key) {
  if (!key) return null;
  const hit = ASK_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.timestamp > ASK_CACHE_TTL_MS) {
    ASK_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function writeAskCache(key, value) {
  if (!key || !value || typeof value !== "object") return;
  ASK_CACHE.set(key, { value, timestamp: Date.now() });
  if (ASK_CACHE.size > 200) {
    const oldestKey = ASK_CACHE.keys().next().value;
    if (oldestKey) ASK_CACHE.delete(oldestKey);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    },
  });
}

async function callTavily(apiKey, query) {
  if (!apiKey) return "（尚未設定網路搜尋功能，請提醒使用者到 Cloudflare 加上 TAVILY_API_KEY。）";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: String(query || "").slice(0, 400),
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const detail = data?.detail?.error || data?.error || data?.message || "";
      return `網路搜尋失敗（HTTP ${res.status}${detail ? `：${detail}` : ""}）`;
    }
    const results = Array.isArray(data.results) ? data.results.slice(0, 5) : [];
    const lines = results.map(
      (r) => `- ${r.title || "（無標題）"}：${String(r.content || "").slice(0, 200)}（來源：${r.url}）`
    );
    const answer = data.answer ? `摘要：${data.answer}\n\n` : "";
    return answer + (lines.length ? lines.join("\n") : "搜尋沒有找到相關結果");
  } catch (e) {
    return `網路搜尋發生錯誤：${e.message}`;
  }
}

const SYSTEM_PROMPT_BASE = `你是內嵌在這個 App 裡的「存股助手 AI」，用繁體中文回答。

你是 App 的資料解讀層，不是另一套自行猜測的投資模型。回答任何與使用者資產、持股、設定、雷達或即時行情有關的問題時：
1. App 內已計算的資料與 Trend Radar 結果是第一級事實來源；不要自行重算出一套互相衝突的機率。
2. 若目前 context 不足，優先呼叫 get_app_snapshot、query_app_data 或 get_live_quotes，再回答；不要猜數字。
3. 清楚區分「App 實際資料」「雷達模型輸出」「你的解釋/推論」。
4. 雷達機率只代表模型訊號強弱，不是保證；不得把 58% 說成一定會漲。
5. 對歷史資產、交易、配息等精確數字，使用工具結果，不憑記憶或自行估算。
6. 使用者要求修改資料時才呼叫寫入工具；唯讀查詢可直接使用。
7. 回答以簡潔、可操作、能解釋因子衝突為優先。若訊號互相矛盾，要直接指出哪些因子正向、哪些負向。
8. 嚴格忠於 App 快照：快照沒有的因子不要自行補充。尤其不要把「基本面」「長期趨勢權重較高」「利率環境」等沒有出現在資料裡的內容說成模型已使用。
9. 面向一般使用者時，把內部欄位翻成自然語言：newsScore=4 說成「新聞訊號偏正向」、inst=2.5 說成「法人訊號偏正向」、overnight=1.88 說成「隔夜訊號偏多」。只有使用者要求看原始數值時才列內部欄位。
10. 不給「加碼、減碼、增倉、停損」等交易指示。可以改成「觀察重點」「可能改變判斷的條件」「目前模型偏向」。
11. 若回答涉及 Trend Radar，先講結論，再講 2–4 個真正有進模型或快照的主要因子，最後補一句風險/限制。手機畫面優先，避免長篇報告。
12. 不要輸出 Markdown 表格、HTML <br>、### 標題、**粗體**等排版符號；請用短段落與「•」項目即可。
13. 時間要說清楚：收盤後讀到盤中/收盤快照時，稱為「今日收盤快照」或「最近一次雷達快照」，不要讓人誤以為是夜間即時股價。
14. 若使用者問「明天會不會漲」，回答必須寫成「目前模型偏漲/偏跌/方向不明 + 機率」，並明確說這是模型訊號，不是保證。
15. 若 context 內出現「Asset AI Learning」，它只代表使用者在本機累積的互動偏好（常問主題、常提持股、回答篇幅偏好）。它可以影響你先講什麼、怎麼排序與解釋，但絕對不是市場證據，不得因此改寫持股、成本、行情、Trend Radar 機率、模型驗證或任何交易資料。

你的任務不是泛泛而談的財經聊天，而是把 App 裡的「持股、成本、交易、配息、每日資產、計畫設定、即時行情、KD、法人、新聞、台指近月、隔夜訊號、Trend Radar、模型驗證」整合成可理解的個人化分析。`;

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

function taiwanNowLabel() {
  const now = new Date();
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const weekday = WEEKDAY_ZH[t.getUTCDay()];
  return `${y}-${m}-${d}（星期${weekday}）${hh}:${mm}（台灣時間 UTC+8）`;
}

function taiwanTodayStr() {
  const now = new Date();
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_trade",
      description: "新增一筆買進或賣出交易紀錄",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "股票代號，例如 0050" },
          action: { type: "string", enum: ["buy", "sell"], description: "buy=買進，sell=賣出" },
          shares: { type: "number", description: "股數" },
          price: { type: "number", description: "每股成交價" },
          fee: { type: "number", description: "手續費，沒說填 0" },
          tax: { type: "number", description: "證交稅（賣出），沒說填 0" },
          date: { type: "string", description: `交易日期 YYYY-MM-DD，沒說用今天 ${taiwanTodayStr()}` },
          note: { type: "string", description: "備註，沒有就空字串" },
        },
        required: ["symbol", "action", "shares", "price"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_holding_target",
      description: "修改某檔股票的目標股數",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "股票代號" },
          target: { type: "number", description: "新的目標股數" },
        },
        required: ["symbol", "target"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_manual_avg_cost",
      description: "手動設定平均成本，或清除改回自動計算",
      parameters: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "股票代號" },
          avgCost: { type: "number", description: "新均價；清除時可填 0" },
          clear: { type: "boolean", description: "true=清除手動設定，改回自動計算" },
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_goal",
      description: "修改總目標金額或目標年份",
      parameters: {
        type: "object",
        properties: {
          targetAmount: { type: "number", description: "新目標金額（TWD），不改就不要帶" },
          targetYear: { type: "number", description: "新目標年份，不改就不要帶" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_app_data",
      description: "唯讀查詢總入口。",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["daily_records", "trades", "dividends", "holding_cost"], description: "資料來源" },
          fromDate: { type: "string", description: "起始 YYYY-MM-DD" },
          toDate: { type: "string", description: "結束 YYYY-MM-DD" },
          asOfDate: { type: "string", description: "holding_cost：計算到此日（含）" },
          symbol: { type: "string", description: "股票代號；holding_cost 必填" },
          aggregation: {
            type: "string",
            enum: ["records", "start_end", "monthly", "min_max", "summary"],
            description: "daily_records: records/start_end/monthly/min_max；trades/dividends: records 或 summary",
          },
          fields: {
            type: "array",
            items: { type: "string", enum: ["totalAsset", "totalCost", "totalGain", "twValue", "usValue", "twCost", "usCost", "twGain", "usGain"] },
            description: "關注欄位；min_max 用第一個當比較鍵，預設 totalGain",
          },
          limit: { type: "number", description: "records 最多筆數，預設 120，上限 200" },
        },
        required: ["source"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_snapshot",
      description: "讀取 App 最新完整狀態摘要，包括持股/計畫設定、即時行情、Trend Radar 今日/明日預測、KD/法人/新聞狀態、台指近月與隔夜訊號、模型驗證。當使用者問『我的 App 現在怎麼判斷』『為什麼預測這樣』『讀全部設定』時優先用這個工具。",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["all", "portfolio", "settings", "market", "radar", "validation"],
            description: "要讀的區段；不確定時用 all",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_quotes",
      description: "查詢特定股票／ETF 的即時／今日最新股價。",
      parameters: {
        type: "object",
        properties: {
          symbols: {
            type: "array",
            items: { type: "string" },
            description: "要查詢的股票代號清單，例如 [\"0050\",\"0056\"]；沒指定就查使用者目前全部持股",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "上網搜尋一般性、公開的最新資訊。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜尋關鍵字，簡短具體，中文或英文皆可" },
        },
        required: ["query"],
      },
    },
  },
];

const ALLOWED_TOOL_NAMES = new Set([
  "add_trade",
  "update_holding_target",
  "update_manual_avg_cost",
  "update_goal",
  "query_app_data",
  "get_app_snapshot",
  "get_live_quotes",
  "web_search",
]);

function geminiTypeSchema(schema) {
  if (!schema || typeof schema !== "object") return schema;
  const out = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toUpperCase();
  if (out.properties && typeof out.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, geminiTypeSchema(v)]));
  }
  if (out.items) out.items = geminiTypeSchema(out.items);
  return out;
}

function geminiFunctionDeclarations(tools = TOOLS) {
  return tools
    .filter((t) => t?.type === "function" && t?.function?.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || "",
      parameters: geminiTypeSchema(t.function.parameters || { type: "OBJECT", properties: {} }),
    }));
}

function parseGeminiParts(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts : [];
}

function parseGeminiToolCalls(data) {
  const calls = [];
  for (const [idx, part] of parseGeminiParts(data).entries()) {
    const fc = part?.functionCall;
    if (!fc?.name || !ALLOWED_TOOL_NAMES.has(fc.name)) continue;
    calls.push({
      id: String(fc.id || `gemini_call_${idx}_${Date.now()}`),
      name: fc.name,
      arguments: fc.args && typeof fc.args === "object" ? fc.args : {},
      ...(part.thoughtSignature ? { _geminiThoughtSignature: part.thoughtSignature } : {}),
    });
  }
  return calls;
}

function geminiText(data) {
  return parseGeminiParts(data)
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function callGemini(env, contents, systemInstruction, tools = true, options = {}) {
  const apiKey = String(env?.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("Gemini 備援未設定 GEMINI_API_KEY");
  const configuredModel = String(env?.GEMINI_MODEL || "").trim();
  const model = (!configuredModel || /^gemini-(?:2|3\.5)(?:\.|-|$)/i.test(configuredModel)) ? GEMINI_MODEL_DEFAULT : configuredModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  };
  if (tools) {
    body.tools = [{ functionDeclarations: geminiFunctionDeclarations(TOOLS) }];
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_AI_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const detail = String(data?.error?.message || data?.error?.status || `HTTP ${res.status}`);
    const locationBlocked = res.status === 400 && /location is not supported|unsupported.*location/i.test(detail);
    if (locationBlocked && options.allowLocationRetry !== false) {
      // Cloudflare egress can occasionally be classified by Google as an unsupported API location.
      // Retry once; the request is idempotent and this avoids turning a transient egress issue into an app failure.
      await new Promise(resolve => setTimeout(resolve, 900));
      return callGemini(env, contents, systemInstruction, tools, { ...options, allowLocationRetry: false });
    }
    throw new Error(`Gemini ${detail}`);
  }
  return { data, model };
}

function buildGeminiContents(history, message, toolTurns = []) {
  const contents = [];
  for (const m of history || []) {
    const role = m?.role === "assistant" ? "model" : "user";
    const text = String(m?.content || "").slice(0, MAX_HISTORY_CONTENT);
    if (text) contents.push({ role, parts: [{ text }] });
  }

  // IMPORTANT: toolTurns can originate from Cloudflare GPT-OSS, not Gemini.
  // Gemini 3.x requires a model-generated thought_signature when replaying
  // functionCall parts. Cloudflare-originated tool calls do not have that
  // signature, so replaying them as functionCall/functionResponse causes HTTP 400.
  // Feed already-resolved local App tool results back to Gemini as plain text
  // evidence instead. Gemini's own tool calls created later in this request still
  // use native functionCall parts and preserve their thought signatures.
  for (const turn of toolTurns || []) {
    const calls = Array.isArray(turn?.calls) ? turn.calls : [];
    const results = Array.isArray(turn?.results) ? turn.results : [];
    if (!results.length) continue;
    const callNames = new Map(calls.map((tc) => [String(tc?.id || ""), String(tc?.name || "app_tool")]));
    const blocks = results.map((tr, idx) => {
      const name = String(tr?.name || callNames.get(String(tr?.id || "")) || calls[idx]?.name || "app_tool");
      return `【App 工具結果：${name}】\n${String(tr?.content || "").slice(0, MAX_CONTEXT_LEN)}`;
    });
    contents.push({ role: "user", parts: [{ text: blocks.join("\n\n") }] });
  }

  contents.push({ role: "user", parts: [{ text: message }] });
  return contents;
}

async function runGeminiFallback(env, { message, history, contextText, toolTurns, allowPrivate = false, forceAnswer = false }) {
  const allowPrivateByEnv = String(env?.GEMINI_ALLOW_PRIVATE_CONTEXT || "false").toLowerCase() === "true";
  allowPrivate = allowPrivate === true || allowPrivateByEnv;
  if (!allowPrivate && toolTurns.some(turn =>
    (turn.calls || []).some(tc => ["query_app_data", "get_app_snapshot"].includes(tc.name)))) {
    throw new Error("私人資產工具結果未授權傳送至 Gemini，請先開啟私人資料授權");
  }
  const safeContext = allowPrivate ? contextText : "";
  const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
  const finalizeLine = forceAnswer ? "\n\n【系統】工具資料已經取得完成。現在必須直接用既有資料回答使用者，不要再次呼叫任何工具。" : "";
  const systemPrompt = safeContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${safeContext}${finalizeLine}`
    : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n這是 Cloudflare 主 AI 的 Gemini 備援。若問題需要私人資產資料但目前沒有提供持股 context，不要猜數字，改用 query_app_data / get_live_quotes 等工具。${finalizeLine}`;

  let contents = buildGeminiContents(history, message, toolTurns);
  let searchRounds = 0;
  while (true) {
    let geminiResult;
    try {
      geminiResult = await callGemini(env, contents, systemPrompt, !forceAnswer);
    } catch (e) {
      if (!/502|503|high demand|temporar|overload/i.test(String(e?.message || e))) throw e;
      await new Promise(resolve => setTimeout(resolve, 900));
      geminiResult = await callGemini(env, contents, systemPrompt, !forceAnswer);
    }
    const { data, model } = geminiResult;
    const toolCalls = parseGeminiToolCalls(data);
    if (toolCalls.length > 0 && toolCalls.every((tc) => tc.name === "web_search") && searchRounds < MAX_SERVER_SEARCH_ROUNDS) {
      const modelParts = parseGeminiParts(data).filter((p) => p?.functionCall || p?.text);
      contents.push({ role: "model", parts: modelParts });
      const responseParts = [];
      for (const tc of toolCalls) {
        const content = await callTavily(env.TAVILY_API_KEY, tc.arguments?.query);
        responseParts.push({ functionResponse: { name: tc.name, ...(tc?.id ? { id: String(tc.id) } : {}), response: { result: content.slice(0, MAX_CONTEXT_LEN) } } });
      }
      contents.push({ role: "user", parts: responseParts });
      searchRounds += 1;
      continue;
    }
    if (toolCalls.length > 0) {
      return { provider: "gemini-direct-fallback", model, toolCalls };
    }
    const reply = geminiText(data);
    if (!reply) throw new Error("Gemini 沒有回傳文字內容");
    return { provider: "gemini-direct-fallback", model, reply };
  }
}

function friendlyAiError(message) {
  const s = String(message || "");
  if (/429|resource_exhausted|quota exceeded|quota.*exceed|rate.?limit/i.test(s)) {
    return "AI 服務目前達到額度或速率限制，請稍後再試。";
  }
  if (/timeout|timed out|逾時|abort/i.test(s)) {
    return "AI 服務回應逾時，請稍後再試。";
  }
  if (/unauthorized|forbidden|401|403|api.?key/i.test(s)) {
    return "AI 服務授權失敗，請檢查服務金鑰或 Cloudflare 設定。";
  }
  if (/binding|AI binding|env\.AI/i.test(s)) {
    return "尚未設定 Cloudflare AI Binding（Variable name: AI）。";
  }
  if (/沒有回傳文字內容|empty response/i.test(s)) {
    return "AI 服務有回應，但沒有可顯示的文字內容。";
  }
  return s || "AI 服務暫時無法完成要求";
}

function extractCloudflareText(result) {
  const candidates = [
    result?.response,
    result?.result?.response,
    result?.output_text,
    result?.text,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.map(x => typeof x === "string" ? x : (x?.text || x?.content || "")).filter(Boolean).join("\n").trim();
      if (joined) return joined;
    }
  }
  const output = result?.output;
  if (Array.isArray(output)) {
    const joined = output.flatMap(x => Array.isArray(x?.content) ? x.content : [x])
      .map(x => x?.text || x?.content || "").filter(x => typeof x === "string" && x.trim()).join("\n").trim();
    if (joined) return joined;
  }
  return "";
}

export async function onRequestPost(context) {
  let primaryError = null;
  try {
    const ai = context.env.AI;

    const limiter = context.env.ASK_RATE_LIMITER;
    const deviceId = String(context.request.headers.get("x-device-id") || "").slice(0, 80);
    const clientIp = String(context.request.headers.get("cf-connecting-ip") || "").slice(0, 64);
    // 以 IP 為主：x-device-id 是用戶端自己填的，換一個值就能繞過限流；只有拿不到 IP 時才用它。
    const rateLimitKey = clientIp ? `ip:${clientIp}` : (deviceId ? `device:${deviceId}` : "anonymous");
    if (limiter) {
      const limited = await limiter.limit({ key: rateLimitKey });
      if (limited && limited.success === false) {
        return jsonResponse({ error: "AI 問答太頻繁了，請稍後再試。", version: ASK_VERSION }, 429);
      }
    }

    const contentLength = Number(context.request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonResponse({ error: "Request too large" }, 413);
    const rawBody = await context.request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "Request too large" }, 413);
    let body = null;
    try { body = rawBody.trim() ? JSON.parse(rawBody) : null; } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const message = String(body?.message || "").trim();
    if (!message) return jsonResponse({ error: "沒有收到訊息內容", version: ASK_VERSION }, 400);
    if (message.length > MAX_MESSAGE_LEN) return jsonResponse({ error: "訊息太長了，麻煩縮短一點", version: ASK_VERSION }, 400);

    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CONTENT) }));
    const contextText = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT_LEN) : "";
    const toolTurns = Array.isArray(body?.toolTurns) ? body.toolTurns : [];
    const forceAnswer = body?.forceAnswer === true;
    let activeModel = chooseAssetModel(message, contextText, toolTurns, forceAnswer);
    // 個人化資產 context 與工具結果不可進共享的記憶體快取，否則相同問題可能跨使用者命中舊答案。
    // 只有沒有私人 context、也沒有 tool round 的一般閒聊才使用短 TTL 快取。
    const cacheEnabled = !contextText.trim() && toolTurns.length === 0;
    const cacheKey = cacheEnabled ? buildAskCacheKey(message, history, contextText, toolTurns) : null;
    const cached = cacheEnabled ? readAskCache(cacheKey) : null;
    if (cached) {
      return jsonResponse({ ok: true, version: ASK_VERSION, ...cached, fromCache: true, provider: cached.provider || "cache" });
    }

    // 快取命中不耗模型額度；真正要呼叫 AI 前才扣每日次數。
    // Owner 以伺服器 Secret 對應的同步 token 驗證，不靠前端 owner=true 之類可偽造旗標。
    if (!isOwnerAsk(context.request, context.env)) {
      const quota = await consumeDailyAiQuota(context.env, deviceId, clientIp);
      if (!quota.ok) {
        return jsonResponse({
          error: `今天的 AI 使用額度已用完（${quota.limit} 次），明天會自動恢復。`,
          code: "daily_ai_limit",
          used: quota.used,
          limit: quota.limit,
          version: ASK_VERSION,
        }, 429);
      }
    }

    const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
    const finalizeLine = forceAnswer ? "\n\n【系統】唯讀工具資料已經取得完成。請立刻根據上面的工具結果直接回答使用者；不要再次呼叫任何工具，也不要要求使用者重送問題。" : "";
    const systemPrompt = contextText
      ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${contextText}${finalizeLine}`
      : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}${finalizeLine}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];
    toolTurns.forEach((turn) => {
      const calls = Array.isArray(turn?.calls) ? turn.calls : [];
      const results = Array.isArray(turn?.results) ? turn.results : [];
      if (!calls.length) return;
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: calls.map((tc) => ({ id: String(tc?.id || ""), type: "function", function: { name: String(tc?.name || ""), arguments: JSON.stringify(tc?.arguments || {}) } })),
      });
      results.forEach((tr) => messages.push({ role: "tool", tool_call_id: String(tr?.id || ""), content: String(tr?.content || "").slice(0, MAX_CONTEXT_LEN) }));
    });

    function parseToolCalls(result) {
      const rawToolCalls = result?.tool_calls || result?.response?.tool_calls || result?.choices?.[0]?.message?.tool_calls || null;
      if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return [];
      return rawToolCalls.map((tc, idx) => {
        const name = tc?.name || tc?.function?.name;
        let args = tc?.arguments ?? tc?.function?.arguments;
        if (typeof args === "string") {
          try { args = JSON.parse(args.replace(/```json\n?/gi, "").replace(/```/g, "").trim()); } catch { args = {}; }
        }
        const id = String(tc?.id || tc?.tool_call_id || `call_${idx}`);
        return name && ALLOWED_TOOL_NAMES.has(name) ? { id, name, arguments: args || {} } : null;
      }).filter(Boolean);
    }

    const primaryDeadline = Date.now() + PRIMARY_AI_TIMEOUT_MS;
    async function runModel() {
      if (!ai) throw new Error("尚未設定 Cloudflare AI Binding（AI）");
      if ((primaryCooldown.get(ai) || 0) > Date.now()) throw new Error("AI 暫時冷卻，改用備援");
      if (Date.now() >= primaryDeadline) throw new Error("Cloudflare Workers AI 逾時");
      const request = forceAnswer
        ? ai.run(activeModel, { messages, max_tokens: MAX_TOKENS })
        : ai.run(activeModel, { messages, max_tokens: MAX_TOKENS, tools: TOOLS });
      return await withTimeout(request, primaryDeadline - Date.now(), "Cloudflare Workers AI");
    }

    let result;
    try {
      result = await runModel();
    } catch (e) {
      primaryError = e;
      // 只有「輕量模型本身出錯」才升級 20B 再試一次；額度用完（429）、服務暫停
      // （502/503）、逾時或冷卻中這類整個 Workers AI 共通的暫時性錯誤，換模型也
      // 一樣會失敗，只會讓使用者多等一輪才輪到 Gemini 備援。
      const transientFailure = /429|quota|timeout|逾時|503|502|temporar|冷卻/i.test(String(e?.message));
      if (activeModel === LIGHT_MODEL && ai && !transientFailure) {
        try {
          activeModel = HEAVY_MODEL;
          primaryError = null;
          result = await runModel();
        } catch (heavyError) {
          primaryError = heavyError;
        }
      }
    }

    if (!primaryError) {
      try {
        let toolCalls = parseToolCalls(result);
        let searchRounds = 0;
        while (toolCalls.length > 0 && toolCalls.every((tc) => tc.name === "web_search") && searchRounds < MAX_SERVER_SEARCH_ROUNDS) {
          messages.push({ role: "assistant", content: "", tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) } })) });
          for (const tc of toolCalls) {
            const content = await callTavily(context.env.TAVILY_API_KEY, tc.arguments?.query);
            messages.push({ role: "tool", tool_call_id: tc.id, content: content.slice(0, MAX_CONTEXT_LEN) });
          }
          result = await runModel();
          toolCalls = parseToolCalls(result);
          searchRounds += 1;
        }
        if (toolCalls.length > 0 && toolCalls.some((tc) => tc.name === "web_search")) {
          messages.push({ role: "user", content: "（系統提示：已達自動查詢次數上限，請直接根據目前已經查到的資料用文字回答，不要再要求呼叫任何工具。）" });
          if (Date.now() >= primaryDeadline) throw new Error("Cloudflare Workers AI 逾時");
          result = await withTimeout(
            ai.run(activeModel, { messages, max_tokens: MAX_TOKENS }),
            primaryDeadline - Date.now(),
            "Cloudflare Workers AI"
          );
          toolCalls = parseToolCalls(result).filter((tc) => tc.name !== "web_search");
        }
        if (toolCalls.length > 0) {
          const payload = { ok: true, version: ASK_VERSION, provider: "cloudflare", model: activeModel, toolCalls };
          if (cacheEnabled) writeAskCache(cacheKey, payload);
          return jsonResponse(payload);
        }
        let reply = extractCloudflareText(result);
        if (!reply && activeModel === LIGHT_MODEL && ai) {
          activeModel = HEAVY_MODEL;
          result = await runModel();
          reply = extractCloudflareText(result);
        }
        if (!reply) throw new Error("AI 沒有回傳文字內容");
        const payload = { ok: true, version: ASK_VERSION, provider: "cloudflare", model: activeModel, reply };
        if (cacheEnabled) writeAskCache(cacheKey, payload);
        return jsonResponse(payload);
      } catch (e) {
        primaryError = e;
      }
    }

    if (ai && /429|quota|timeout|逾時|503|502|temporar/i.test(String(primaryError?.message))) primaryCooldown.set(ai, Date.now() + 30000);
    try {
      const gemini = await withTimeout(runGeminiFallback(context.env, {
        message, history, contextText, toolTurns, allowPrivate: body?.allowGeminiPrivate === true, forceAnswer,
      }), GEMINI_AI_TIMEOUT_MS, "Gemini 備援");
      const payload = { ok: true, version: ASK_VERSION, ...gemini, fallbackFrom: friendlyAiError(primaryError?.message) };
      if (cacheEnabled) writeAskCache(cacheKey, payload);
      return jsonResponse(payload);
    } catch (geminiError) {
      return jsonResponse({
        error: `Cloudflare AI：${friendlyAiError(primaryError?.message)}；Gemini 備援：${friendlyAiError(geminiError?.message || "失敗")}`,
        version: ASK_VERSION,
      }, 502);
    }
  } catch (e) {
    return jsonResponse({ error: friendlyAiError(e?.message), version: ASK_VERSION }, 500);
  }
}
