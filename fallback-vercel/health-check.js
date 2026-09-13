/**
 * health-check.js — 4.6-health-check-1
 *
 * 系統健康自我檢查：定期（Cron）或手動（App 打開時）測試 Cloudflare 主 AI
 * 還通不通，出狀況時用規則庫（不是又叫一次 AI，快又不花額度）判斷可能原因，
 * 存成一張「待確認」卡片，讓 App 顯示給使用者看，按確定才套用。
 *
 * 路由（掛在 worker.js）：
 *   GET  /api/health-cards        → 回傳目前的卡片清單（App 開啟時抓一次）
 *   POST /api/health-cards        → { id, action: "apply" | "dismiss" } 更新卡片狀態
 *   GET  /api/health-check        → 手動觸發一次檢查（也可以被 Cron 呼叫）
 *
 * KV：需要一個叫 health_kv 的 KV Namespace binding（見 wrangler.jsonc）。
 * 只存「最近幾張卡片」，不是逐筆日誌，舊卡片超過上限直接丟棄，避免無限長大。
 */

const HEALTH_VERSION = "4.6-health-check-1";
const KV_KEY = "health:cards";
const MAX_CARDS = 20;
const CLOUDFLARE_TEST_MODEL = "@cf/openai/gpt-oss-20b"; // 跟 functions/ask.js 用同一顆模型

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function taiwanNowIso() {
  const now = new Date();
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return t.toISOString().replace("Z", "+08:00");
}

// ---- 規則庫：先用字串比對猜可能原因，猜不到才留一句籠統說明，不額外呼叫 AI ----
// 每條規則： { test(message) => boolean, summary, fixType, proposedChange? }
// fixType: "setting"（純設定切換，App 端按確定當下就能生效，不用重新部署）
//          "code"（要真的改檔案、重新部署，卡片只顯示建議，不能自動套用）
//          "wait"（不用做什麼，等它自己恢復，卡片只是告知）
const RULES = [
  {
    test: (m) => /neuron|quota|limit|daily|exceeded|usage/i.test(m),
    summary: "Cloudflare Workers AI 今日免費額度可能已用完",
    fixType: "wait",
  },
  {
    test: (m) => /unauthorized|forbidden|401|403/i.test(m),
    summary: "Cloudflare AI 授權失敗，Binding 設定可能被改動或權限被收回",
    fixType: "code",
  },
  {
    test: (m) => /binding|AI binding|env\.AI/i.test(m),
    summary: "尚未設定 Cloudflare AI Binding（Variable name 需為 AI）",
    fixType: "code",
  },
  {
    test: (m) => /timeout|timed out|abort/i.test(m),
    summary: "Cloudflare AI 回應逾時，可能是暫時性壅塞",
    fixType: "wait",
  },
];

function diagnose(message) {
  const m = String(message || "");
  const matched = RULES.find((r) => r.test(m));
  if (matched) return { summary: matched.summary, fixType: matched.fixType, proposedChange: matched.proposedChange || null };
  return {
    summary: `Cloudflare AI 呼叫失敗，原因不在已知規則庫內：${m.slice(0, 200)}`,
    fixType: "code",
    proposedChange: null,
  };
}

async function loadCards(env) {
  if (!env.health_kv) return [];
  try {
    const raw = await env.health_kv.get(KV_KEY);
    const cards = raw ? JSON.parse(raw) : [];
    return Array.isArray(cards) ? cards : [];
  } catch {
    return [];
  }
}

async function saveCards(env, cards) {
  if (!env.health_kv) return;
  await env.health_kv.put(KV_KEY, JSON.stringify(cards.slice(-MAX_CARDS)));
}

// 供 Cron（worker.js 的 scheduled()）跟手動 GET /api/health-check 共用的核心邏輯。
// 只在「這次檢查結果跟上一張卡片明顯不同」時才新增卡片，避免同一個問題每次排程
// 都重複新增一張、洗掉舊卡片；狀態恢復正常時，若上一張還是 pending，順手標記解決。
export async function runHealthCheck(env) {
  const cards = await loadCards(env);
  const lastPending = [...cards].reverse().find((c) => c.status === "pending");

  let ok = true;
  let errorMessage = "";
  try {
    if (!env.AI) throw new Error("尚未設定 Cloudflare AI Binding（Variable name: AI）。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      await env.AI.run(CLOUDFLARE_TEST_MODEL, {
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    ok = false;
    errorMessage = e?.message || String(e);
  }

  if (ok) {
    // 恢復正常：如果上一張 pending 卡還在，標記為已解決，但不刪除（留紀錄）。
    if (lastPending) {
      lastPending.status = "resolved";
      lastPending.resolvedAt = taiwanNowIso();
      await saveCards(env, cards);
    }
    return { ok: true, checkedAt: taiwanNowIso() };
  }

  // 同一個原因已經有一張 pending 卡在等使用者確認，就不要重複新增。
  const diagnosis = diagnose(errorMessage);
  if (lastPending && lastPending.summary === diagnosis.summary) {
    lastPending.lastSeenAt = taiwanNowIso();
    lastPending.occurrences = (lastPending.occurrences || 1) + 1;
    await saveCards(env, cards);
    return { ok: false, checkedAt: taiwanNowIso(), card: lastPending };
  }

  const card = {
    id: `hc_${Date.now()}`,
    detectedAt: taiwanNowIso(),
    lastSeenAt: taiwanNowIso(),
    occurrences: 1,
    severity: "warning",
    rawError: errorMessage.slice(0, 300),
    ...diagnosis,
    status: "pending",
  };
  cards.push(card);
  await saveCards(env, cards);
  return { ok: false, checkedAt: taiwanNowIso(), card };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  // /api/health-check：手動觸發一次檢查（App 開啟時、或 Cron 打過來都走這個函式）
  if (url.pathname.endsWith("/health-check")) {
    const result = await runHealthCheck(context.env);
    return jsonResponse({ ok: true, version: HEALTH_VERSION, ...result });
  }
  // /api/health-cards：只讀，不觸發新檢查，給 App 開啟時輪詢用，比較省
  const cards = await loadCards(context.env);
  return jsonResponse({ ok: true, version: HEALTH_VERSION, cards });
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  if (!id || !["apply", "dismiss"].includes(action)) {
    return jsonResponse({ ok: false, error: "缺少 id 或 action 不合法（需為 apply/dismiss）", version: HEALTH_VERSION }, 400);
  }
  const cards = await loadCards(context.env);
  const card = cards.find((c) => c.id === id);
  if (!card) {
    return jsonResponse({ ok: false, error: "找不到這張卡片，可能已經被清掉了", version: HEALTH_VERSION }, 404);
  }
  card.status = action === "apply" ? "applied" : "dismissed";
  card.respondedAt = taiwanNowIso();
  await saveCards(context.env, cards);
  return jsonResponse({ ok: true, version: HEALTH_VERSION, card });
}
