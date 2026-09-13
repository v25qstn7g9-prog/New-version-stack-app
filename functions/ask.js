/**
 * ask.js — 4.6-ask-free-21.5-gemini35-stable-tools (Optimized v2)
 *
 * POST /ask
 * body: {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }, ...],
 *   context?: string   // 持股摘要純文字；閒聊可不帶以省 neurons
 * }
 * 回傳: { ok: true, reply } 或 { ok: true, toolCalls: [{ name, arguments }] }
 *
 * 本版變更（相對 4.6-ask-free-21.4）：
 * 1. 修正 MARKET_ANALYSIS_RULES 在多輪 web_search 時會被重複疊加進 system prompt 的問題
 * 2. MAX_TOKENS 1000 -> 1600，避免結構化長回答被截斷
 * 3. toolTurns 只保留最近 2 輪，避免對話拉長後 messages 陣列無限膨脹
 * 4. ai.run() 加上逾時保護（15s），避免 AI binding 卡住時請求無限等待
 */
const ASK_VERSION = "4.6-ask-free-21.5-gemini35-stable-tools";
const MODEL = "@cf/openai/gpt-oss-120b";
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_CONTENT = 3000;
const MAX_CONTEXT_LEN = 4000;
const MAX_TOKENS = 1600;
const MAX_SERVER_SEARCH_ROUNDS = 2;
const MAX_TOOL_TURNS_KEPT = 2;
const AI_TIMEOUT_MS = 15000;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

async function callTavily(apiKey, query) {
  if (!apiKey) return "（Vercel 備援尚未設定 TAVILY_API_KEY，暫時不能執行網路搜尋。）";
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: String(query || "").slice(0, 400),
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return `網路搜尋失敗（HTTP ${res.status}）`;
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

// 精簡版基礎 Prompt（日常對話與持股查詢）
const SYSTEM_PROMPT_BASE = `你是內嵌在個人存股資產追蹤 App 的助手，用繁體中文回答。

個性：像認識很久的朋友，不是客服，也不是投資工具人。

使用者純聊天、開玩笑、問候、閒扯時：
- 針對他講的「那件事本身」真的接話，把它當一件值得聊的事。
- 絕對不要在結尾加「若有投資問題歡迎詢問」「有什麼想聊的都可以說」這類套話，不要硬拗回投資。

當牽涉「金額、股數、報酬率」時：切回精準模式。【最重要】絕對不要編造數字。

執行動作必須用工具（function calling）；資訊不夠先用文字問清楚。
query_app_data 跟 get_live_quotes 都是唯讀查詢。
- query_app_data：歷史紀錄（市值、成本、交易、配息）
- get_live_quotes：個股/ETF 現在股價
- web_search：台股大盤點數、一般新聞/時事/公開資訊

【工具節奏】一次只選一類工具。回答保持簡潔。`;

// 只有執行 web_search 後才動態補充的市場分析規範
const MARKET_ANALYSIS_RULES = `

【市場分析規範】
1. 「今天」以台灣時間（UTC+8）為準。前一交易日必須標示「昨日收盤」。
2. 已查證事實與 AI 推論必須分開。
3. 主要原因必須同時具備 (A)事件 (B)數據 (C)關聯，三者缺一不可。
4. 結構：盡量區分【已查證】、【市場數據】、【AI 推論】、【尚無法確認】。
5. 沒有事件與數據證據，不下主要原因結論。`;

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
          symbol: { type: "string", description: "股票代號" },
          action: { type: "string", enum: ["buy", "sell"], description: "buy=買進，sell=賣出" },
          shares: { type: "number", description: "股數" },
          price: { type: "number", description: "每股成交價" },
          fee: { type: "number", description: "手續費，沒說填 0" },
          tax: { type: "number", description: "證交稅，沒說填 0" },
          date: { type: "string", description: `交易日期 YYYY-MM-DD，沒說用今天 ${taiwanTodayStr()}` },
          note: { type: "string", description: "備註" },
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
          avgCost: { type: "number", description: "新均價" },
          clear: { type: "boolean", description: "true=清除手動設定" },
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
          targetAmount: { type: "number", description: "新目標金額" },
          targetYear: { type: "number", description: "新目標年份" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_app_data",
      description: "唯讀查詢總入口。查詢 App 歷史數字。",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", enum: ["daily_records", "trades", "dividends", "holding_cost"] },
          fromDate: { type: "string" },
          toDate: { type: "string" },
          asOfDate: { type: "string" },
          symbol: { type: "string" },
          aggregation: { type: "string", enum: ["records", "start_end", "monthly", "min_max", "summary"] },
          fields: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
        required: ["source"],
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
          symbols: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "上網搜尋一般性、公開的最新資訊（新聞、時事、大盤）。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜尋關鍵字" },
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
  "get_live_quotes",
  "web_search",
]);

function friendlyAiError(message) {
  const s = String(message || "");
  if (/timeout|逾時/i.test(s)) return "AI 回應逾時，請稍後再試一次。";
  if (/neuron|quota|limit|daily|exceeded|usage/i.test(s)) return "今日 AI 免費額度可能已用完，等額度重置後再試。";
  if (/unauthorized|forbidden|401|403/i.test(s)) return "AI 服務授權失敗，請檢查 Cloudflare 設定。";
  if (/binding|AI binding|env\.AI/i.test(s)) return "尚未設定 Cloudflare AI Binding（Variable name: AI）。";
  return s || "ask function failed";
}

export async function onRequestPost(context) {
  try {
    const ai = context.env.AI;
    const limiter = context.env.ASK_RATE_LIMITER;
    const deviceId = String(context.request.headers.get("x-device-id") || "").slice(0, 80);
    if (limiter && deviceId) {
      const limited = await limiter.limit({ key: deviceId });
      if (limited && limited.success === false) {
        return jsonResponse({ error: "AI 問答太頻繁了，請稍後再試。", version: ASK_VERSION }, 429);
      }
    }
    if (!ai) return jsonResponse({ error: "尚未設定 AI Binding。", version: ASK_VERSION }, 500);

    const body = await context.request.json().catch(() => null);
    const message = String(body?.message || "").trim();
    if (!message) return jsonResponse({ error: "沒有收到訊息內容", version: ASK_VERSION }, 400);
    if (message.length > MAX_MESSAGE_LEN) return jsonResponse({ error: "訊息太長了，麻煩縮短一點", version: ASK_VERSION }, 400);

    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CONTENT) }));

    const activeTools = TOOLS;
    const contextText = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT_LEN) : "";
    const dateLine = `現在的日期時間是：${taiwanNowLabel()}。`;

    let systemPrompt = contextText
      ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${contextText}`
      : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    // 只保留最近 MAX_TOOL_TURNS_KEPT 輪，避免長對話讓 messages 陣列無限膨脹
    const toolTurns = (Array.isArray(body?.toolTurns) ? body.toolTurns : []).slice(-MAX_TOOL_TURNS_KEPT);
    toolTurns.forEach((turn) => {
      const calls = Array.isArray(turn?.calls) ? turn.calls : [];
      const results = Array.isArray(turn?.results) ? turn.results : [];
      if (!calls.length) return;
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: calls.map((tc) => ({
          id: String(tc?.id || ""),
          type: "function",
          function: { name: String(tc?.name || ""), arguments: JSON.stringify(tc?.arguments || {}) },
          ...(tc?._geminiThoughtSignature ? { _geminiThoughtSignature: tc._geminiThoughtSignature } : {}),
        })),
      });
      results.forEach((tr) => {
        messages.push({
          role: "tool",
          tool_call_id: String(tr?.id || ""),
          content: String(tr?.content || "").slice(0, MAX_CONTEXT_LEN),
        });
      });
    });

    function parseToolCalls(result) {
      const rawToolCalls = result?.tool_calls || result?.response?.tool_calls || result?.choices?.[0]?.message?.tool_calls || null;
      if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return [];
      return rawToolCalls
        .map((tc, idx) => {
          const name = tc?.name || tc?.function?.name;
          let args = tc?.arguments ?? tc?.function?.arguments;
          if (typeof args === "string") {
            try { args = JSON.parse(args.replace(/```json\n?/gi, "").replace(/```/g, "").trim()); } catch { args = {}; }
          }
          const id = String(tc?.id || tc?.tool_call_id || `call_${idx}`);
          const thoughtSignature = tc?._geminiThoughtSignature || tc?.thoughtSignature || undefined;
          return name && ALLOWED_TOOL_NAMES.has(name)
            ? { id, name, arguments: args || {}, ...(thoughtSignature ? { _geminiThoughtSignature: thoughtSignature } : {}) }
            : null;
        })
        .filter(Boolean);
    }

    // 加上逾時保護：AI binding 若卡住，最多等 AI_TIMEOUT_MS 就放棄，避免請求無限掛著
    async function runModel(toolsForThisRun = activeTools) {
      return await Promise.race([
        ai.run(MODEL, { messages, max_tokens: MAX_TOKENS, tools: toolsForThisRun }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("AI 回應逾時")), AI_TIMEOUT_MS)),
      ]);
    }

    let result = await runModel();
    let toolCalls = parseToolCalls(result);

    let searchRounds = 0;
    let marketRulesInjected = false; // 確保 MARKET_ANALYSIS_RULES 整個請求生命週期只注入一次
    while (toolCalls.some((tc) => tc.name === "web_search") && searchRounds < MAX_SERVER_SEARCH_ROUNDS) {
      const searchCalls = toolCalls.filter((tc) => tc.name === "web_search");
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: searchCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
          ...(tc._geminiThoughtSignature ? { _geminiThoughtSignature: tc._geminiThoughtSignature } : {}),
        })),
      });

      const tavilyKey = context.env.TAVILY_API_KEY;
      for (const tc of searchCalls) {
        const content = await callTavily(tavilyKey, tc.arguments?.query);
        messages.push({ role: "tool", tool_call_id: tc.id, content: content.slice(0, MAX_CONTEXT_LEN) });
      }

      // 動態注入市場規範：只有真的發動過 web_search 並取得搜尋結果後才注入，且只注入一次
      if (!marketRulesInjected) {
        messages[0].content += MARKET_ANALYSIS_RULES;
        marketRulesInjected = true;
      }

      result = await runModel();
      toolCalls = parseToolCalls(result);
      searchRounds += 1;
    }

    if (toolCalls.some((tc) => tc.name === "web_search")) {
      const noWebSearchTools = activeTools.filter((t) => t?.function?.name !== "web_search");
      result = await runModel(noWebSearchTools);
      toolCalls = parseToolCalls(result).filter((tc) => tc.name !== "web_search");
    }

    if (toolCalls.length > 0) {
      const clientToolCalls = toolCalls.filter((tc) => tc.name !== "web_search");
      if (clientToolCalls.length > 0) {
        return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, toolCalls: clientToolCalls });
      }
      return jsonResponse({
        ok: true,
        version: ASK_VERSION,
        provider: "cloudflare",
        model: MODEL,
        reply: "網路搜尋已完成，但模型沒有整理出最終回答。請再送一次同一個問題。",
      });
    }

    let reply = String(result?.response || "").trim();
    if (!reply && Array.isArray(result?.choices)) reply = String(result.choices[0]?.message?.content || "").trim();
    if (!reply) return jsonResponse({ error: "AI 沒有回傳文字內容", version: ASK_VERSION }, 502);

    return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, reply });
  } catch (e) {
    return jsonResponse({ error: friendlyAiError(e?.message), version: ASK_VERSION }, 500);
  }
}
