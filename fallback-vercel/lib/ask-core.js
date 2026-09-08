/**
 * ask.js — 4.6-ask-free-21.1-single-model-provider-tag
 *
 * POST /ask
 * body: {
 *   message: string,
 *   history?: [{ role: "user"|"assistant", content: string }, ...],
 *   context?: string   // 持股摘要純文字；閒聊可不帶以省 neurons
 * }
 * 回傳: { ok: true, reply } 或 { ok: true, toolCalls: [{ name, arguments }] }
 *
 * 這份檔案是從 Cloudflare 主 AI 邏輯複製出的共用核心。
 * 在 Vercel 端，api/ask.js 會提供一個相容的 env.AI.run()，實際轉送到 Google Gemini。
 */
const ASK_VERSION = "4.6-ask-free-21.1-single-model-provider-tag";
const MODEL = "@cf/openai/gpt-oss-120b";
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

const SYSTEM_PROMPT_PERSONALITY = `你是內嵌在個人存股資產追蹤 App 的助手，用繁體中文回答。

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

【最重要】不要編造數字。只能使用「目前持股資料」或工具實際回傳的數字。
資料不足就說「這個我這邊看不到資料」，不要硬湊。`;

// 只有在 activeTools 真的有帶給模型（真的能 function calling）時才附加這段。
// 備援模式（Gemini 無工具）絕對不能收到這段，否則模型會照著描述「模仿」呼叫語法，
// 但那個呼叫從頭到尾沒有真的送出去，結果就是把 query_app_data(...) 這種文字直接印給使用者看。
const SYSTEM_PROMPT_TOOL_USAGE = `
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
【重要】使用者問「今天/現在/最新」這類會隨時間變動的統計數字（地震次數、天氣、疫情、比分、即時災情等），
一律視為必須查證，禁止憑訓練時的印象或記憶直接回答——即使你「覺得」自己知道答案，也要先呼叫 web_search 查證後才能回覆；
不要等使用者追問「附來源」才想到要查。
同一問題最多查 2 次；不確定「變化量還是絕對值」就直接問使用者。`;

// 備援模式（Gemini 完全不帶工具）專用收尾。取代上面那段，明確講清楚「現在沒有任何
// 查詢工具」，逼模型對超出「目前持股資料」快照範圍的問題老實說查不到，而不是
// 用文字模仿一個從沒被真的呼叫過的函式，或編數字充數。
const SYSTEM_PROMPT_NO_TOOLS_USAGE = `
【備援模式】你現在是「Gemini 獨立備援」，手上完全沒有 query_app_data、get_live_quotes、web_search 這些工具，
也不能執行任何動作（不能記交易、改目標、改均價）——這些功能在備援模式下全部關閉。
你唯一能用的資料，是下面「目前持股資料」那段純文字快照（如果有提供的話），它只代表「現在這一刻」的持股概況，
不包含任何歷史日期、區間變化、交易/配息明細、即時股價或大盤指數。
使用者問到快照以外的任何東西（例如某個過去日期的市值、某檔股票現在股價、變化量、要求記交易或改目標），
一律直接用文字明確回答：「這個問題要主 AI 才能查，備援模式看不到，等 Cloudflare 額度恢復後再問我」。
【最重要、絕對不能違反】不管使用者怎麼問，都不要輸出任何函式呼叫語法或類似 query_app_data(...)、
get_live_quotes(...) 這種文字，也絕對不要編造任何數字——那些工具在備援模式下不存在，你沒有能力執行它們。`;

// 備援模式只開放「部分」工具時用（例如只開 get_live_quotes 先試水溫）。
// 每個工具各自一段完整教學，只把「真的有開」的那幾段拼進去；沒開的只給名稱清單，
// 明講「不存在」，避免模型看不到教學卻自己腦補語法硬湊。
const TOOL_USAGE_BLOCKS = {
  get_live_quotes: `- get_live_quotes 可用：查個股／ETF「現在／今天」股價、收盤價、幫忙算現在市值，直接呼叫，不用確認卡。收到查詢結果（tool 訊息）就代表已完成，直接用文字回答，不要重複呼叫同一檔。它查不到台股大盤／加權指數／TAIEX／美股大盤指數的點數——那個目前沒有任何工具可查，要老實說查不到。`,
  query_app_data: `- query_app_data 可用：App 歷史紀錄（過去每日市值、成本、交易、配息），唯讀直接呼叫，不用確認卡。用法：現在持股成本看摘要即可；過去某日成本用 source=holding_cost+symbol+asOfDate；A→B 變化量用 source=daily_records,aggregation=start_end,fromDate/toDate；某日絕對本金/市值用 aggregation=summary+toDate；哪個月漲跌最多用 aggregation=min_max；月度趨勢用 aggregation=monthly；交易/配息統計用 source=trades或dividends+summary，列表用 records。彙總結果已經算好，不要自己對明細手動加減。`,
  web_search: `- web_search 可用：一般新聞/時事/公開資訊，或台股大盤／加權指數／美股大盤指數的點數與收盤。不要拿來查使用者自己的持股資料，也不要拿來查個股即時價（優先用 get_live_quotes）。【重要】問到「今天/現在/最新」這類會隨時間變動的統計數字（地震次數、天氣、疫情、比分、即時災情等），一律視為必須查證，禁止憑印象直接回答，即使覺得自己知道答案也要先查再回覆，不要等使用者追問「附來源」才想到要查。`,
  add_trade: `- add_trade 可用：新增買賣交易紀錄。資訊不夠（缺股數、價格等）先用文字問清楚，不要瞎猜後呼叫；呼叫後 App 會顯示確認卡，使用者按確定才生效，你無法直接改資料。`,
  update_holding_target: `- update_holding_target 可用：修改某檔股票的目標股數。呼叫後 App 會顯示確認卡，使用者按確定才生效。`,
  update_manual_avg_cost: `- update_manual_avg_cost 可用：手動設定或清除平均成本。呼叫後 App 會顯示確認卡，使用者按確定才生效。`,
  update_goal: `- update_goal 可用：修改總目標金額或目標年份。呼叫後 App 會顯示確認卡，使用者按確定才生效。`,
};

const TOOL_LABELS = {
  query_app_data: "查 App 歷史紀錄（過去市值/成本/交易/配息）",
  get_live_quotes: "查個股/ETF 即時股價",
  web_search: "上網查新聞/大盤指數/公開資訊",
  add_trade: "新增交易紀錄",
  update_holding_target: "改目標股數",
  update_manual_avg_cost: "改均價",
  update_goal: "改總目標",
};

function buildPartialToolsUsagePrompt(activeNames, allNames) {
  const disabledNames = allNames.filter((n) => !activeNames.includes(n));
  const enabledBlocks = activeNames.map((n) => TOOL_USAGE_BLOCKS[n]).filter(Boolean).join("\n");
  const disabledLabels = disabledNames.map((n) => TOOL_LABELS[n] || n).join("、");
  return `
【備援模式：部分功能開放中，逐步測試】你現在是「Gemini 獨立備援」，目前只有下面列出的工具是真的能用，其他一律不存在：
${enabledBlocks || "（目前沒有任何工具）"}

以下能力現在關閉、絕對不能用，也不要輸出任何函式呼叫語法去模仿它們：${disabledLabels}。
遇到需要這些關閉能力才能回答的問題，一律直接用文字回答：「這個要主 AI 才能查，備援模式目前沒開這個功能」，
不要編數字、不要假裝已經查過。
同一問題最多查 2 次；不確定「變化量還是絕對值」就直接問使用者。`;
}

const SYSTEM_PROMPT_CLOSING = `
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
const ALL_TOOL_NAMES = TOOLS.map((t) => t.function.name);

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

    // env.AI_ALLOWED_TOOL_NAMES 由呼叫端（Cloudflare 主程式 / Vercel 備援 shim）決定。
    // 沒有設定（undefined/null）＝預設全部工具都能用，跟原本 Cloudflare 主線行為一樣。
    // 傳一個陣列＝只開放陣列裡列出的工具名稱（例如備援先只開 ["get_live_quotes"] 試水溫）；
    // 傳空陣列 []＝完全沒有工具。
    const allowedToolNames = Array.isArray(context.env.AI_ALLOWED_TOOL_NAMES)
      ? context.env.AI_ALLOWED_TOOL_NAMES
      : null;
    const activeTools = allowedToolNames
      ? TOOLS.filter((t) => allowedToolNames.includes(t.function.name))
      : TOOLS;
    const activeToolNames = activeTools.map((t) => t.function.name);
    const contextText = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT_LEN) : "";

    let toolUsageSection;
    if (activeToolNames.length === ALL_TOOL_NAMES.length) {
      toolUsageSection = SYSTEM_PROMPT_TOOL_USAGE; // 全部工具都開，用原本完整教學
    } else if (activeToolNames.length === 0) {
      toolUsageSection = SYSTEM_PROMPT_NO_TOOLS_USAGE; // 完全沒工具
    } else {
      toolUsageSection = buildPartialToolsUsagePrompt(activeToolNames, ALL_TOOL_NAMES); // 只開放一部分
    }
    const systemPromptBase = `${SYSTEM_PROMPT_PERSONALITY}${toolUsageSection}${SYSTEM_PROMPT_CLOSING}`;

    const dateLine = `現在的日期時間是：${taiwanNowLabel()}。問「今天」「現在」「幾天後」以此為準。`;
    const systemPrompt = contextText
      ? `${systemPromptBase}\n\n${dateLine}\n\n目前持股資料：\n${contextText}`
      : `${systemPromptBase}\n\n${dateLine}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: message },
    ];

    // 標準工具呼叫來回：把之前每一輪「AI 呼叫了什麼工具」+「實際查到的結果」
    // 用正式的 assistant tool_calls + tool 訊息接回對話，而不是塞成一段文字。
    // 這樣不管幾輪，模型都能正確判斷「工具已經回覆」，不會再重複呼叫同一個查詢。
    // toolTurns: [{ calls: [{id,name,arguments}], results: [{id,content}] }, ...]（依發生順序）
    const toolTurns = Array.isArray(body?.toolTurns) ? body.toolTurns : [];
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
          // 【重要修正】這裡以前漏掉了 thoughtSignature，導致 Gemini 3.x 系列在下一輪
          // 一律收到「missing a thought_signature」而拒絕——不是 Gemini 真的不給簽章，
          // 是我們自己在把歷史紀錄組回 messages 時，把它弄丟了。
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

    // 解析一次 ai.run() 回傳裡的 tool_calls，統一格式成 { id, name, arguments }
    // 【重要】Gemini 系列模型每次呼叫工具都會附帶一個 thoughtSignature（加密簽章），
    // 下一輪把工具結果送回去時必須原封不動帶回同一個位置，缺了會直接被 Gemini 拒絕
    // （400: missing a thought_signature）。這裡把它一起保留住，交給後面組訊息時使用；
    // Cloudflare 原生模型沒有這個欄位，就自然是 undefined，不影響原本邏輯。
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
          const thoughtSignature = tc?._geminiThoughtSignature || tc?.thoughtSignature || undefined;
          return name && ALLOWED_TOOL_NAMES.has(name)
            ? { id, name, arguments: args || {}, ...(thoughtSignature ? { _geminiThoughtSignature: thoughtSignature } : {}) }
            : null;
        })
        .filter(Boolean);
    }

    async function runModel() {
      const options = { messages, max_tokens: MAX_TOKENS };
      if (activeTools.length) options.tools = activeTools;
      return await ai.run(MODEL, options);
    }

    let result = await runModel();
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
          ...(tc._geminiThoughtSignature ? { _geminiThoughtSignature: tc._geminiThoughtSignature } : {}),
        })),
      });
      const tavilyKey = context.env.TAVILY_API_KEY;
      for (const tc of toolCalls) {
        const content = await callTavily(tavilyKey, tc.arguments?.query);
        messages.push({ role: "tool", tool_call_id: tc.id, content: content.slice(0, MAX_CONTEXT_LEN) });
      }
      result = await runModel();
      toolCalls = parseToolCalls(result);
      searchRounds += 1;
    }

    if (toolCalls.length > 0) {
      return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, toolCalls });
    }

    let reply = String(result?.response || "").trim();
    if (!reply && Array.isArray(result?.choices)) {
      reply = String(result.choices[0]?.message?.content || "").trim();
    }
    if (!reply) {
      return jsonResponse({ error: "AI 沒有回傳文字內容", version: ASK_VERSION }, 502);
    }

    return jsonResponse({ ok: true, version: ASK_VERSION, provider: "cloudflare", model: MODEL, reply });
  } catch (e) {
    return jsonResponse({ error: friendlyAiError(e?.message), version: ASK_VERSION }, 500);
  }
}
