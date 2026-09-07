/**
 * ask.js — 4.6-ask-free-20.0-native-fallback-model
 *
 * POST /ask
 * body: {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }, ...],
 *   context?: string   // 持股摘要純文字；閒聊可不帶以省 neurons
 * }
 * 回傳: { ok: true, reply } 或 { ok: true, toolCalls: [{ name, arguments }] }
 *
 * Cloudflare AI Binding：Variable name = AI（主模型 + 備援模型都走這一個綁定）
 * 備援模型：google/gemini-3.8-flash，Cloudflare 代管的第三方模型，
 * 不需要另外申請 API Key、不需要另外的 Secret，主模型額度用完時自動切換。
 */
const ASK_VERSION = "4.6-ask-free-20.0-native-fallback-model";
const MODEL = "@cf/openai/gpt-oss-120b";
const FALLBACK_MODEL = "google/gemini-3.8-flash";
const MAX_HISTORY_TURNS = 6; // 再縮一點省輸入 token
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_CONTENT = 3000;
const MAX_CONTEXT_LEN = 4000;
const MAX_TOKENS = 1000;
const MAX_SERVER_SEARCH_ROUNDS = 2; // 網路搜尋在伺服器端自動來回幾輪，避免無限查詢

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

// 呼叫 Tavily 網路搜尋 API。apiKey 沒設定就直接回錯誤字串，不會讓整個請求掛掉。
async function callTavily(apiKey, query) {
  if (!apiKey) return "（尚未設定網路搜尋功能，請提醒使用者到 Cloudflare 加上 TAVILY_API_KEY。）";
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

const SYSTEM_PROMPT_BASE = `你是內嵌在個人存股資產追蹤 App 的助手，用繁體中文回答。

個性：像認識很久的朋友，不是客服，也不是投資工具人。

使用者純聊天、開玩笑、問候、閒扯（沒有問任何跟持股/金額/交易有關的事）時：
- 針對他講的「那件事本身」真的接話、給意見、問問題、開玩笑——把它當一件值得聊的事，不是話題跳板
- 錯誤示範（不要這樣做）：使用者說「今天下了一整天的雨」，你回「這種天氣最適合泡杯熱茶順手檢查一下投資狀況」——
  這是硬拗回投資，很尷尬。正確做法是單純聊天氣本身：會不會冷、要不要帶傘、討厭雨天還是喜歡，就這樣
- 絕對不要在結尾加「若有投資問題歡迎詢問」「隨時跟我說～」「有什麼想聊的/想查的都可以說」這類收尾句，
  不管有沒有加表情符號都算
- 不要主動把任何話題（天氣、心情、時事）跟投資/資產/查詢綁在一起，除非使用者自己先提到

只要使用者的話牽涉到「金額、股數、報酬率」這類實際數字，或要求記交易、改目標，
才切回精準模式：嚴謹、不含糊、一切以下面規則為準。

【最重要】不要編造數字。只能使用「目前持股資料」或 query_app_data 回傳的數字。
資料不足就說「這個我這邊看不到資料」，不要硬湊。

使用者可能閒聊、問持股（賺多少、達標進度），或要求執行動作（記交易、改目標股數、改均價、改總目標）。
執行動作必須用工具（function calling），你無法直接改資料；App 會顯示確認卡，使用者按確定才生效。
資訊不夠（缺股數、價格等）先用文字問清楚，不要瞎猜後呼叫工具。

query_app_data 跟 get_live_quotes 都是唯讀查詢，可直接呼叫，不用確認卡。系統會把查詢結果以正式的工具回覆（tool 訊息）交給你，
收到工具回覆後就代表查詢已完成，直接根據內容用文字回答，不要再次呼叫同一個查詢。
【重要】query_app_data 只有「歷史紀錄」（過去存進資料庫的每日市值、成本、交易、配息），沒有現在的股價。
使用者問「現在/今天股價多少」「收盤價」「幫我算現在市值」這類問題，要用 get_live_quotes 查即時報價，
不要用 query_app_data，也不要說自己查不到——這兩個工具合起來才是完整的查詢能力。
【重要】彙總結果都已由程式算好，不要自己對 records 明細手動加減比較。
- 現在持股成本：看摘要即可
- 過去某日成本：source=holding_cost + symbol + asOfDate
- A→B 變化量：source=daily_records, aggregation=start_end, fromDate/toDate（跟區間長短無關，
  橫跨數月也一樣一次查完，不要覺得範圍大就遲疑或改用別的方式）
- 某日絕對本金/市值：aggregation=summary，填 toDate（或同一天）
- 哪個月漲跌最多：aggregation=min_max
- 月度趨勢：aggregation=monthly；明細才用 records
- 交易/配息：source=trades 或 dividends；統計用 summary，列表用 records
- 個股／ETF 的現在股價、今日最新價、個別持股現在市值：get_live_quotes
- 台股大盤／加權指數／TAIEX／美股大盤指數的點數與收盤：web_search（get_live_quotes 不查大盤指數）
- 一般新聞/時事/公開資訊/你內建知識不確定的事：web_search（不要拿來查使用者自己的持股資料；特定個股即時價優先 get_live_quotes）
同一問題最多查 2 次；不確定「變化量還是絕對值」就直接問使用者。

手機小視窗：回答簡潔。可結合最近對話理解省略句。
你不是財務顧問，不要給應買應賣建議，可中性說明資訊。`;

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
      description: "唯讀查詢總入口。需要 App 內歷史數字時主動使用並一次選對 source + aggregation：區間變化用 daily_records+start_end；單日絕對值用 daily_records+summary；月趨勢用 daily_records+monthly；極值用 daily_records+min_max；交易/配息統計用 trades/dividends+summary；列表才用 records；過去持有成本用 holding_cost。",
      parameters: {
        type: "object",
        properties: {
          source: {
            type: "string",
            enum: ["daily_records", "trades", "dividends", "holding_cost"],
            description: "資料來源",
          },
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
            items: {
              type: "string",
              enum: ["totalAsset", "totalCost", "totalGain", "twValue", "usValue", "twCost", "usCost", "twGain", "usGain"],
            },
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
      name: "get_live_quotes",
      description: "查詢特定股票／ETF 的即時／今日最新股價（來自證交所即時報價，不是歷史紀錄）。使用者問某檔股票『現在/今天股價多少』『收盤價是多少』『幫我算現在市值』時用這個。不要用它查台股加權指數／TAIEX／大盤點數，那種公開指數資料請用 web_search；也不要跟 query_app_data 搞混——query_app_data 只有 App 歷史紀錄。",
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
      description: "上網搜尋一般性、公開的最新資訊（新聞、時事、你內建知識不確定或太新的事）。只在使用者問的不是他自己的持股/資產資料、也不是股價時才用這個；自己的資料用 query_app_data，股價用 get_live_quotes，不要優先用網路搜尋去查這兩種資料，因為搜尋結果可能不準或跟 App 資料對不起來。",
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
  "get_live_quotes",
  "web_search",
]);

function shouldFallbackFromCloudflare(error) {
  const s = String(error?.message || error || "");
  return /neuron|quota|daily|exceeded|usage|rate.?limit|429|capacity|temporar|timeout|internal server|service unavailable|502|503|504/i.test(s);
}

// ---- OpenAI 風格 messages/tools 翻譯成 Gemini 原生格式 ----
// google/gemini-3.8-flash 這個第三方模型雖然也是走 env.AI 綁定呼叫，
// 但它吃的是 Gemini 原生格式：system 訊息要拆成獨立的 systemInstruction，
// 一般對話用 contents，工具呼叫用 functionCall / functionResponse part，
// 跟 Cloudflare 原生模型用的 OpenAI 風格 messages/tool_calls 完全不同，還是要轉換。
function toGeminiRequest(messages, tools) {
  const systemParts = [];
  const contents = [];
  // 追蹤每個 tool_call_id 對應的函式名稱，因為 OpenAI 的 tool 訊息只有 id 沒有 name，
  // 但 Gemini 的 functionResponse 需要 name。
  const callIdToName = {};

  for (const m of messages) {
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
          return { functionCall: { name: tc.function?.name, args } };
        });
        contents.push({ role: "model", parts });
      } else {
        contents.push({ role: "model", parts: [{ text: String(m.content || "") }] });
      }
      continue;
    }
    if (m.role === "tool") {
      const name = callIdToName[m.tool_call_id] || "tool_result";
      contents.push({
        role: "function",
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

// 把 Gemini 原生回應轉回我們系統統一使用的 OpenAI 風格結構（choices[0].message），
// 這樣 parseToolCalls() 跟其他既有邏輯完全不用另外判斷 provider。
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
          })),
        },
      }],
    };
  }
  const text = parts.map((p) => p.text || "").join("").trim();
  return { choices: [{ message: { role: "assistant", content: text } }] };
}

// 透過 Cloudflare 自己代管的第三方模型呼叫 Gemini（不用另外的 GEMINI_API_KEY、
// 不用另外的網址/驗證方式，一樣走 env.AI 這個綁定）。這個模型本身吃 Gemini 原生的
// contents/tools 格式，所以還是要用 toGeminiRequest/fromGeminiResponse 做轉換，
// 只是不用再自己處理 HTTP 呼叫、逾時、金鑰這些細節，Cloudflare 都包好了。
async function runGeminiViaWorkersAI(ai, messages, tools = []) {
  const body = toGeminiRequest(messages, tools);
  const data = await ai.run(FALLBACK_MODEL, body);
  if (data?.promptFeedback?.blockReason) {
    throw new Error(`備援模型失敗：內容被擋下（${data.promptFeedback.blockReason}）`);
  }
  const translated = fromGeminiResponse(data);
  return { ...translated, provider: "gemini", model: FALLBACK_MODEL };
}

async function runModel(ai, messages, tools = [], allowFallbackModel = true) {
  if (!ai) throw new Error("尚未設定 Cloudflare AI Binding");
  let primaryError = null;
  try {
    const options = { messages, max_tokens: MAX_TOKENS };
    if (tools.length) options.tools = tools;
    const result = await ai.run(MODEL, options);
    if (result && typeof result === "object") {
      result.provider = "cloudflare";
      result.model = MODEL;
    }
    return result;
  } catch (e) {
    primaryError = e;
    if (!allowFallbackModel || !shouldFallbackFromCloudflare(e)) throw e;
  }

  try {
    return await runGeminiViaWorkersAI(ai, messages, tools);
  } catch (e) {
    throw new Error(`主模型已不可用（${primaryError.message || primaryError}）；備援模型也失敗：${e.message || e}`);
  }
}

function friendlyAiError(message, meta = {}) {
  const s = String(message || "");
  if (/neuron|quota|limit|daily|exceeded|usage/i.test(s)) {
    if (meta.privateFallbackBlocked) {
      return "Cloudflare AI 免費額度可能已用完。這題包含你的個人資產資料，備援模型（Gemini）因隱私保護預設不接手；若你接受再把 ALLOW_PRIVATE_FALLBACK_MODEL 設為 true。";
    }
    return "Cloudflare AI 免費額度可能已用完，備援模型這次也沒有成功，請稍後再試。";
  }
  if (/unauthorized|forbidden|401|403/i.test(s)) {
    return "AI 服務授權失敗，請檢查 Cloudflare 設定。";
  }
  if (/binding|AI binding|env\.AI/i.test(s)) {
    return "尚未設定 Cloudflare AI Binding（Variable name: AI）。";
  }
  return s || "ask function failed";
}

export async function onRequestPost(context) {
  const errorMeta = { privateFallbackBlocked: false };
  try {
    const ai = context.env.AI;

    // Optional Cloudflare Rate Limiting binding. If it is not configured,
    // nothing changes. We only use the anonymous device id supplied by the
    // app; we do not forward the visitor IP to the model.
    const limiter = context.env.ASK_RATE_LIMITER;
    const deviceId = String(context.request.headers.get("x-device-id") || "").slice(0, 80);
    if (limiter && deviceId) {
      const limited = await limiter.limit({ key: deviceId });
      if (limited && limited.success === false) {
        return jsonResponse({ error: "AI 問答太頻繁了，請稍後再試。", version: ASK_VERSION }, 429);
      }
    }
    if (!ai) {
      return jsonResponse({ error: "尚未設定 AI：請設定 Cloudflare AI Binding（Variable name: AI）。", version: ASK_VERSION }, 500);
    }

    const body = await context.request.json().catch(() => null);
    const message = String(body?.message || "").trim();
    if (!message) return jsonResponse({ error: "沒有收到訊息內容", version: ASK_VERSION }, 400);
    if (message.length > MAX_MESSAGE_LEN) {
      return jsonResponse({ error: "訊息太長了，麻煩縮短一點", version: ASK_VERSION }, 400);
    }

    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CONTENT) }));

    const toolProfile = { tools: TOOLS, needsPortfolioContext: true };
    const activeTools = toolProfile.tools;
    const allowPrivateFallback = String(context.env.ALLOW_PRIVATE_FALLBACK_MODEL || "").toLowerCase() === "true";
    const rawToolTurns = Array.isArray(body?.toolTurns) ? body.toolTurns : [];
    const contextText = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT_LEN) : "";
    // 隱私保護：只要這次請求裡「真的帶了」持股摘要或工具查詢結果（不管問題怎麼問），
    // 一律預設不讓備援模型（Gemini）碰，比用關鍵字猜問題內容穩妥，不會漏接。
    const hasPrivateData = Boolean(contextText.trim()) || rawToolTurns.some((t) => Array.isArray(t?.results) && t.results.length > 0);
    errorMeta.privateFallbackBlocked = Boolean(hasPrivateData && !allowPrivateFallback);
    const allowFallbackModel = !errorMeta.privateFallbackBlocked;

    const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
    const systemPrompt = contextText
      ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${contextText}`
      : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    // 標準工具呼叫來回：把之前每一輪「AI 呼叫了什麼工具」+「實際查到的結果」
    // 用正式的 assistant tool_calls + tool 訊息接回對話，而不是塞成一段文字。
    // 這樣不管幾輪，模型都能正確判斷「工具已經回覆」，不會再重複呼叫同一個查詢。
    // toolTurns: [{ calls: [{id,name,arguments}], results: [{id,content}] }, ...]（依發生順序）
    const toolTurns = rawToolTurns;
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
          function: {
            name: String(tc?.name || ""),
            arguments: JSON.stringify(tc?.arguments || {}),
          },
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

    // 解析一次 ai.run() 回傳裡的 tool_calls，統一格式成 { id, name, arguments }
    function parseToolCalls(result) {
      const rawToolCalls =
        result?.tool_calls ||
        result?.response?.tool_calls ||
        result?.choices?.[0]?.message?.tool_calls ||
        null;
      if (!Array.isArray(rawToolCalls) || rawToolCalls.length === 0) return [];
      return rawToolCalls
        .map((tc, idx) => {
          const name = tc?.name || tc?.function?.name;
          let args = tc?.arguments ?? tc?.function?.arguments;
          if (typeof args === "string") {
            try {
              const cleanArgs = args.replace(/```json\n?/gi, "").replace(/```/g, "").trim();
              args = JSON.parse(cleanArgs);
            } catch {
              args = {};
            }
          }
          // 有些模型不會回傳 id，這裡補一個穩定的 fallback，讓下一輪可以正確對應回去。
          const id = String(tc?.id || tc?.tool_call_id || `call_${idx}`);
          return name && ALLOWED_TOOL_NAMES.has(name) ? { id, name, arguments: args || {} } : null;
        })
        .filter(Boolean);
    }

    let result = await runModel(ai, messages, activeTools, allowFallbackModel);
    let toolCalls = parseToolCalls(result);

    // 網路搜尋直接在伺服器端自動處理完，使用者跟前端完全不用介入，
    // 也不會把 Tavily 的 API Key 暴露給瀏覽器。最多來回幾輪，避免無限搜尋。
    let searchRounds = 0;
    while (
      toolCalls.length > 0 &&
      toolCalls.every((tc) => tc.name === "web_search") &&
      searchRounds < MAX_SERVER_SEARCH_ROUNDS
    ) {
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
        })),
      });
      const tavilyKey = context.env.TAVILY_API_KEY;
      for (const tc of toolCalls) {
        const content = await callTavily(tavilyKey, tc.arguments?.query);
        messages.push({ role: "tool", tool_call_id: tc.id, content: content.slice(0, MAX_CONTEXT_LEN) });
      }
      result = await runModel(ai, messages, activeTools, allowFallbackModel);
      toolCalls = parseToolCalls(result);
      searchRounds += 1;
    }

    if (toolCalls.length > 0) {
      return jsonResponse({ ok: true, version: ASK_VERSION, provider: result?.provider || "cloudflare", model: result?.model || MODEL, toolCalls });
    }

    let reply = String(result?.response || "").trim();
    if (!reply && Array.isArray(result?.choices)) {
      reply = String(result.choices[0]?.message?.content || "").trim();
    }
    if (!reply) {
      return jsonResponse({ error: "AI 沒有回傳文字內容", version: ASK_VERSION }, 502);
    }

    return jsonResponse({ ok: true, version: ASK_VERSION, provider: result?.provider || "cloudflare", model: result?.model || MODEL, reply });
  } catch (e) {
    return jsonResponse({ error: friendlyAiError(e?.message, errorMeta), version: ASK_VERSION }, 500);
  }
}
