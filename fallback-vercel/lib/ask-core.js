/**
 * ask.js — 4.6-ask-free-21.4-gemini35-stable-tools
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
const ASK_VERSION = "4.6-ask-free-21.4-gemini35-stable-tools";
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

【市場分析規範】
1. 「今天」一律以台灣時間（UTC+8）為準。
2. 優先使用最新新聞、官方資料及最新市場數據。
3. 前一交易日資料必須明確標示「昨日收盤」或「前一交易日」，不可稱為今天。
4. 已查證的事實與 AI 推論必須分開。
5. 每一個被列為「主要原因」的因素，都必須同時具備：
   （A）事件：有明確、可查證的近期事件、新聞或官方資訊；
   （B）數據：有與該事件或市場反應相關的最新市場數據；
   （C）關聯：能合理說明該事件與今日市場價格變動之間的可能關聯。
6. 「事件＋數據＋關聯」三者缺一不可。
   如果只有新聞事件、沒有相關市場數據，不得直接列為「主要原因」。
   如果只有市場下跌數據、沒有能支持原因的事件資料，不得自行推測原因。
   如果事件與數據存在，但兩者與今日股價變動的因果關係無法合理建立，必須標示為「可能影響因素」，不得直接稱為「主要原因」。
7. 「關聯」必須區分「已查證事實」與「AI 推論」：
   - 已查證事實：來源明確報導或官方資料直接支持的內容。
   - AI 推論：根據已查證事件與市場數據所做的合理推論。
   AI 推論不得寫成已確認的因果關係。避免使用「就是因為」、「造成今天下跌」、「主因就是」等過度確定的語句，除非可靠資料明確支持該因果關係。
8. 分析今日台股時，至少應優先查找：
   - 今日最新新聞與重大市場事件
   - 今日台股指數、成交量及漲跌幅
   - 外資、投信、自營商等三大法人買賣超（若資料已公布）
   - 相關產業、個股或 ETF 的最新價格與成交資訊
   - 與事件直接相關的國際市場數據，例如美股、亞洲主要股市、美元、國債殖利率、原油等（僅在與分析主題有關時使用）
9. 「獲利了結」、「技術面壓力」、「市場恐慌」、「投資人避險」、「資金撤出」等市場常見說法，都必須有資料支持才能使用。不得因為這些說法常見，就自行將它們當成今日市場下跌的原因。
10. 「升息擔憂」、「降息預期」、「外資撤出」、「法人調節」、「地緣政治風險」等因素，也必須提供具體資料或可靠來源支持。例如涉及央行利率預期時，若沒有可靠的市場定價或官方資訊，不得自行宣稱「市場預期將升息／降息」。
11. 「9月魔咒」、「財報季效應」、「季節性行情」等概括性市場說法，除非有當期可靠統計資料明確支持，否則不得列為今日市場下跌或上漲的原因。
12. 如果資料不足以確認原因，必須直接說：「目前沒有足夠資料確認這是今日市場變動的主要原因。」不得為了讓答案完整而自行補充推測性原因。
13. 回答主要原因時，優先使用以下結構：
   【主要原因】
   事件：說明發生了什麼，以及事件日期。
   數據：列出與事件或市場反應相關的最新數據。
   關聯：說明事件可能如何影響市場，並明確標示這部分屬於「AI 推論」。
   證據來源：列出支持該原因的可靠來源。
14. 如果無法同時取得「事件＋數據＋關聯」，就不要把該因素列入「主要原因」。可以放在「其他可能影響因素」中，但必須明確標示「資料不足，尚無法確認」。
15. 所有市場分析都應遵循以下優先順序：
   已查證事件 → 最新市場數據 → 事件與數據之間的關聯 → AI 推論 → 結論
   不得反過來先猜原因，再尋找資料替猜測背書。
16. 如果執行了 web_search，應優先使用搜尋結果中的最新資料與來源，不得以模型記憶中的舊資訊取代最新搜尋結果。
17. 如果搜尋結果彼此矛盾，必須指出資料存在差異，並優先採用較新、較可靠的一手來源；不得自行選擇一個結果而不說明。
18. 最終回答中，應盡可能讓使用者清楚區分：【已查證】、【市場數據】、【AI 推論】、【尚無法確認】。

核心原則：
「沒有事件證據，不下原因結論；沒有市場數據，不下主要原因結論；沒有合理關聯，不把相關事件說成原因。」

【工具節奏】一次只選一類工具。若同一題同時需要 web_search 與 App 私人資料，先完成 web_search，收到結果後再決定是否需要 query_app_data / get_live_quotes；不要在同一個回覆同時呼叫 web_search 和其他工具。
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

    const activeTools = TOOLS;
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
          // Gemini 3 的 thoughtSignature 必須跨 HTTP round-trip 原封不動帶回。
          // 前端 toolTurns 會保留 data.toolCalls 上的這個欄位；這裡若漏掉，
          // query_app_data / get_live_quotes 第二輪就會 400 missing thought_signature。
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

    async function runModel(toolsForThisRun = activeTools) {
      const options = { messages, max_tokens: MAX_TOKENS, tools: toolsForThisRun };
      return await ai.run(MODEL, options);
    }

    let result = await runModel();
    let toolCalls = parseToolCalls(result);

    // web_search 是 Vercel 伺服器端工具，絕對不能回到前端當成「待執行動作」。
    // 即使模型同一輪混叫 web_search + query_app_data，也先只完成搜尋、丟棄同輪
    // 其他呼叫，讓模型讀完搜尋結果後再重新決定下一步。這可避免前端出現
    // 「執行未知動作：web_search」。
    let searchRounds = 0;
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

      result = await runModel();
      toolCalls = parseToolCalls(result);
      searchRounds += 1;
    }

    // 已達搜尋輪數上限後，如果模型還想再搜，不能把 web_search 丟回 App。
    // 直接捨棄那個尚未執行的模型回覆，利用已經取得的搜尋結果再跑一次，
    // 並從工具清單移除 web_search，逼模型整理現有資料或改叫 App 能執行的工具。
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
