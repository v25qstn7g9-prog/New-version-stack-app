/**
 * ask.js — 4.6-ask-free-21.3-search-error-transparency
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
 * 這支只保留 Cloudflare 單一主模型；v2.21 的 Gemini 備援由前端直接改連
 * 另一個平台的 fallback-vercel/api/ask.js，不再把第二模型塞進同一個 Cloudflare Worker。
 */
const ASK_VERSION = "4.6-ask-free-22-gemini-direct-fallback";
const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash-lite";
const GEMINI_MAX_OUTPUT_TOKENS = 1000;
// 從 120b 換成同系列的 20b：一樣支援 function calling、訊息格式完全相容，不用改其他程式碼。
// 20b 運算量小很多，回應通常比較快，換算下來單次問答用掉的神經元也比較少，
// 同樣的免費額度可以撐比較多次問答；代價是複雜推理/長篇分析的品質可能略遜於 120b，
// 但日常查詢、聊天、簡單工具呼叫這些場景差異不大，適合以查詢為主的使用習慣。
// 想換回大模型只要把這行改回 "@cf/openai/gpt-oss-120b" 即可。
const MODEL = "@cf/openai/gpt-oss-20b";
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
- 使用者問「某支股票/ETF 為什麼漲/跌」「今天下跌的原因」這類問題：一律用 web_search 查當天新聞，
  不要只憑自己知識列一般性的漲跌因素（大盤情緒、產業消息…）敷衍帶過——那樣等於沒回答到「今天」這個重點
- 一般新聞/時事/公開資訊/你內建知識不確定的事：web_search（不要拿來查使用者自己的持股資料；特定個股即時價優先 get_live_quotes）
【重要】使用者問「今天/現在/最新」這類會隨時間變動的統計數字（地震次數、天氣、疫情、比分、即時災情等），
一律視為必須查證，禁止憑訓練時的印象或記憶直接回答——即使你「覺得」自己知道答案，也要先呼叫 web_search 查證後才能回覆；
不要等使用者追問「附來源」才想到要查。
【重要】如果 web_search 的查詢結果是「網路搜尋失敗」「網路搜尋發生錯誤」「尚未設定網路搜尋功能」這類訊息，
一定要把裡面的完整文字（含錯誤代碼/原因）原封不動告訴使用者，不要自己改寫成「目前無法取得即時新聞」這種模糊說法——
使用者需要看到真正的錯誤內容才能排查問題。
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
      id: `gemini_call_${idx}_${Date.now()}`,
      name: fc.name,
      arguments: fc.args && typeof fc.args === "object" ? fc.args : {},
    });
  }
  return calls;
}

function geminiText(data) {
  return parseGeminiParts(data)
    .map((p) => typeof p?.text === "string" ? p.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function callGemini(env, contents, systemInstruction, tools = true) {
  const apiKey = String(env?.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("Gemini 備援未設定 GEMINI_API_KEY");
  const model = String(env?.GEMINI_MODEL || GEMINI_MODEL_DEFAULT).trim() || GEMINI_MODEL_DEFAULT;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
    },
  };
  if (tools) {
    body.tools = [{ functionDeclarations: geminiFunctionDeclarations(TOOLS) }];
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const detail = data?.error?.message || data?.error?.status || `HTTP ${res.status}`;
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
  for (const turn of toolTurns || []) {
    const calls = Array.isArray(turn?.calls) ? turn.calls : [];
    const results = Array.isArray(turn?.results) ? turn.results : [];
    if (calls.length) {
      contents.push({
        role: "model",
        parts: calls.map((tc) => ({ functionCall: {
          name: String(tc?.name || ""),
          args: tc?.arguments && typeof tc.arguments === "object" ? tc.arguments : {},
        }})).filter((p) => p.functionCall.name),
      });
    }
    if (results.length) {
      const callNames = new Map(calls.map((tc) => [String(tc?.id || ""), String(tc?.name || "query_app_data")]));
      contents.push({
        role: "user",
        parts: results.map((tr) => ({ functionResponse: {
          name: String(tr?.name || callNames.get(String(tr?.id || "")) || "query_app_data"),
          response: { result: String(tr?.content || "").slice(0, MAX_CONTEXT_LEN) },
        }})),
      });
    }
  }
  contents.push({ role: "user", parts: [{ text: message }] });
  return contents;
}

async function runGeminiFallback(env, { message, history, contextText, toolTurns, allowPrivate = false }) {
  const allowPrivateByEnv = String(env?.GEMINI_ALLOW_PRIVATE_CONTEXT || "false").toLowerCase() === "true";
  allowPrivate = allowPrivate === true || allowPrivateByEnv;
  const safeContext = allowPrivate ? contextText : "";
  const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
  const systemPrompt = safeContext
    ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${safeContext}`
    : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n這是 Cloudflare 主 AI 的 Gemini 備援。若問題需要私人資產資料但目前沒有提供持股 context，不要猜數字，改用 query_app_data 工具讓前端查詢。`;

  let contents = buildGeminiContents(history, message, toolTurns);
  let searchRounds = 0;
  while (true) {
    const { data, model } = await callGemini(env, contents, systemPrompt, true);
    const toolCalls = parseGeminiToolCalls(data);
    if (toolCalls.length > 0 && toolCalls.every((tc) => tc.name === "web_search") && searchRounds < MAX_SERVER_SEARCH_ROUNDS) {
      const modelParts = parseGeminiParts(data).filter((p) => p?.functionCall || p?.text);
      contents.push({ role: "model", parts: modelParts });
      const responseParts = [];
      for (const tc of toolCalls) {
        const content = await callTavily(env.TAVILY_API_KEY, tc.arguments?.query);
        responseParts.push({ functionResponse: { name: tc.name, response: { result: content.slice(0, MAX_CONTEXT_LEN) } } });
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
  if (/neuron|quota|limit|daily|exceeded|usage/i.test(s)) {
    return "今日 AI 免費額度可能已用完，等額度重置後再試。";
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
  let primaryError = null;
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

    const body = await context.request.json().catch(() => null);
    const message = String(body?.message || "").trim();
    if (!message) return jsonResponse({ error: "沒有收到訊息內容", version: ASK_VERSION }, 400);
    if (message.length > MAX_MESSAGE_LEN) return jsonResponse({ error: "訊息太長了，麻煩縮短一點", version: ASK_VERSION }, 400);

    const rawHistory = Array.isArray(body?.history) ? body.history : [];
    const history = rawHistory
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CONTENT) }));
    const contextText = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT_LEN) : "";
    const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
    const systemPrompt = contextText
      ? `${SYSTEM_PROMPT_BASE}\n\n${dateLine}\n\n目前持股資料：\n${contextText}`
      : `${SYSTEM_PROMPT_BASE}\n\n${dateLine}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];
    const toolTurns = Array.isArray(body?.toolTurns) ? body.toolTurns : [];
    toolTurns.forEach((turn) => {
      const calls = Array.isArray(turn?.calls) ? turn.calls : [];
      const results = Array.isArray(turn?.results) ? turn.results : [];
      if (!calls.length) return;
      messages.push({
        role: "assistant", content: "",
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

    if (!ai) throw new Error("尚未設定 Cloudflare AI Binding（AI）");

    async function runModel() {
      return await ai.run(MODEL, { messages, max_tokens: MAX_TOKENS, tools: TOOLS });
    }

    let result;
    try {
      result = await runModel();
    } catch (e) {
      primaryError = e;
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
        messages.push({ role: "user", content: "（系統提示：已達自動查詢次數上限，請直接根據目前已經查到的資料用文字回答，不要再要求呼叫任何工具，也不要提到這則系統提示本身。）" });
        result = await ai.run(MODEL, { messages, max_tokens: MAX_TOKENS });
        toolCalls = parseToolCalls(result).filter((tc) => tc.name !== "web_search");
      }
      if (toolCalls.length > 0) return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, toolCalls });
      let reply = String(result?.response || "").trim();
      if (!reply && Array.isArray(result?.choices)) reply = String(result.choices[0]?.message?.content || "").trim();
      if (!reply) throw new Error("AI 沒有回傳文字內容");
      return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, reply });
      } catch (e) {
        primaryError = e;
      }
    }

    // 第二層：同一個 Cloudflare Worker 直接呼叫 Gemini。
    // API key 只存在 Worker Secret，不經瀏覽器，也不需要 Vercel。
    try {
      const gemini = await runGeminiFallback(context.env, {
        message, history, contextText, toolTurns, allowPrivate: body?.allowGeminiPrivate === true,
      });
      return jsonResponse({ ok: true, version: ASK_VERSION, ...gemini, fallbackFrom: friendlyAiError(primaryError?.message) });
    } catch (geminiError) {
      return jsonResponse({
        error: `Cloudflare AI：${friendlyAiError(primaryError?.message)}；Gemini 備援：${geminiError?.message || "失敗"}`,
        version: ASK_VERSION,
      }, 502);
    }
  } catch (e) {
    return jsonResponse({ error: friendlyAiError(e?.message), version: ASK_VERSION }, 500);
  }
}
