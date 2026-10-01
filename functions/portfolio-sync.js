/**
 * portfolio-sync.js — 存股App 持股快照同步
 *
 * 持股資料只存在使用者自己瀏覽器的 localStorage，伺服器端本來完全讀不到。
 * 這支 API 讓 App 在瀏覽器裡把「目前持股摘要」在資料變動時推一份
 * 過來存進 KV，用一組使用者自己在「計畫」分頁產生、只有自己（跟自己貼給誰）知道的
 * token 當 key——猜不到 token 就讀不到別人的資料，即使大家共用同一個部署網址。
 *
 * 路由（掛在 worker.js）：
 *   POST /api/portfolio-sync   Authorization: Bearer <token>，body: { summary }
 *                              （舊版 App 把 token 放在 body.token，仍然接受）
 *   GET  /api/portfolio-sync   Authorization: Bearer <token>
 *                              （?token=xxx 舊寫法仍然接受，但 token 會出現在網址／log，建議改用 header）
 *
 * GET 找不到快照時會回 reason：
 *   never_synced   這組 token 從來沒上傳過
 *   expired        上傳過，但快照超過 14 天沒更新、被 KV 自動清掉（lastSyncedAt 是最後一次上傳的大約時間）
 *   token_mismatch 這組 token 沒上傳過，但最近 14 天有「別的 token」在上傳（推測兩邊 token 不一致）
 *
 * KV：沿用 health_kv（見 wrangler.jsonc），不另外申請新的 namespace。
 *   portfolio-sync:<token>        快照本體（14 天 TTL，跟以前一樣）
 *   portfolio-sync-meta:<token>   { firstSyncedAt, lastSyncedAt }，不過期；最多每 6 小時更新一次，避免多吃 KV 寫入額度
 *   portfolio-sync-last-writer    { tokenTag, at }：最近一次上傳的是哪組 token（只存雜湊前綴，不存 token）
 *   portfolio-sync-prev:<token>   { savedAt, snapshot }：被覆蓋前的上一版（14 天 TTL，最多每 6 小時存一次）
 *
 * 防覆蓋保護（2026-10-01 事故：空的 App 副本帶著同一組 token 開啟，8 秒後把「持股 0 檔」推上來，蓋掉中控的完整資料）：
 *   POST 時若「中控上已有資料」而新快照明顯少很多，回 409、不寫入。判斷見 shrinkReason()：
 *     - 新快照完全是空的（持股、交易、每日資產紀錄都是 0），但原本有資料
 *     - 持股從有變成 0 檔
 *     - 交易或每日資產紀錄從 10 筆以上掉到不到一半
 *   第一次上傳、原本就是空的、正常增減，都照常寫入。
 *   GET ?prev=1（同樣要帶 token）可讀回被覆蓋前的上一版，萬一小幅度誤蓋也救得回來。
 */

const KV_PREFIX = "portfolio-sync:";
const META_PREFIX = "portfolio-sync-meta:";
const LAST_WRITER_KEY = "portfolio-sync-last-writer";
const PREV_PREFIX = "portfolio-sync-prev:";
// 上一版備份最多每 6 小時存一次（帳號共用的 KV 每日寫入額度有限）。
const PREV_REFRESH_MS = 6 * 60 * 60 * 1000;
// 交易／每日紀錄原本有這麼多筆以上，才會套用「掉到不到一半就拒絕」。
const SHRINK_MIN_OLD = 10;
const SHRINK_RATIO = 0.5;
// meta / last-writer 最多每 6 小時寫一次（帳號共用的 KV 每日寫入額度有限）。
const META_REFRESH_MS = 6 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_TOKEN_LEN = 16;
const MAX_TOKEN_LEN = 128;
// 兩週沒有新的同步就讓 KV 自動過期，避免累積沒人在用的舊 token 資料。
const TTL_SECONDS = 60 * 60 * 24 * 14;

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
    },
  });
}

function isValidToken(token) {
  return (
    typeof token === "string" &&
    token.length >= MIN_TOKEN_LEN &&
    token.length <= MAX_TOKEN_LEN &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

function headerToken(request) {
  const auth = request.headers.get("authorization") || "";
  return /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : "";
}

async function tokenTag(token) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`portfolio-sync:${token}`)));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

function arrayLen(value) {
  return Array.isArray(value) ? value.length : 0;
}

/** 一份快照裡「持股／交易／每日資產／股息」各有幾筆（沒有 dataset 的舊版快照只看頂層持股）。 */
export function snapshotSize(summary) {
  const ds = summary && typeof summary === "object" ? summary.dataset : null;
  return {
    holdings: Math.max(arrayLen(summary?.holdings), arrayLen(ds?.holdings)),
    trades: arrayLen(ds?.trades),
    dailyRecords: arrayLen(ds?.dailyRecords),
    dividends: arrayLen(ds?.dividends),
  };
}

export function isEmptySnapshotSize(size) {
  return size.holdings === 0 && size.trades === 0 && size.dailyRecords === 0;
}

/** 新快照相對於現有快照「縮水到不合理」的原因；沒問題回 null。 */
export function shrinkReason(oldSize, newSize) {
  if (isEmptySnapshotSize(oldSize)) return null; // 原本就是空的：任何內容都可以寫入（含從空白救回來）
  if (isEmptySnapshotSize(newSize)) return "empty_over_existing";
  if (oldSize.holdings > 0 && newSize.holdings === 0) return "holdings_dropped_to_zero";
  for (const key of ["trades", "dailyRecords"]) {
    if (oldSize[key] >= SHRINK_MIN_OLD && newSize[key] < oldSize[key] * SHRINK_RATIO) return `${key}_shrunk`;
  }
  return null;
}

const SHRINK_TEXT = {
  empty_over_existing: "中控上已有資料，這份快照卻是空的（持股、交易、每日資產都是 0）",
  holdings_dropped_to_zero: "這份快照的持股是 0 檔，但中控上原本有持股",
  trades_shrunk: "這份快照的交易筆數不到中控上的一半",
  dailyRecords_shrunk: "這份快照的每日資產紀錄不到中控上的一半",
};

async function readJsonKey(env, key) {
  const raw = await env.health_kv.get(key);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

// 找不到快照時判斷原因（只在 found:false 時才多讀這兩個 key）。
async function missingReason(env, token) {
  const meta = await readJsonKey(env, META_PREFIX + token).catch(() => null);
  if (meta?.lastSyncedAt) return { reason: "expired", lastSyncedAt: meta.lastSyncedAt };
  const writer = await readJsonKey(env, LAST_WRITER_KEY).catch(() => null);
  const recent = writer?.at && Date.now() - Date.parse(writer.at) < TTL_SECONDS * 1000;
  if (recent && writer.tokenTag && writer.tokenTag !== (await tokenTag(token))) return { reason: "token_mismatch", lastSyncedAt: null };
  return { reason: "never_synced", lastSyncedAt: null };
}

// 一組 token 有沒有上傳過（快照還在，或 meta 有紀錄）。給其他端點判斷「這是 App 的真 token」用。
export async function isKnownSyncToken(env, token) {
  if (!isValidToken(token) || !env?.health_kv) return false;
  try {
    if (await env.health_kv.get(KV_PREFIX + token)) return true;
    return Boolean(await env.health_kv.get(META_PREFIX + token));
  } catch {
    return false;
  }
}

export async function onRequestGet({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);
  const url = new URL(request.url);
  const token = headerToken(request) || (url.searchParams.get("token") || "");
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);
  try {
    if (url.searchParams.get("prev") === "1") {
      const prev = await readJsonKey(env, PREV_PREFIX + token);
      if (!prev?.snapshot) return jsonResponse({ ok: true, found: false, summary: null, reason: "no_previous_version" });
      return jsonResponse({ ok: true, found: true, savedAt: prev.savedAt || null, summary: prev.snapshot });
    }
    const raw = await env.health_kv.get(KV_PREFIX + token);
    if (!raw) {
      const { reason, lastSyncedAt } = await missingReason(env, token);
      return jsonResponse({ ok: true, found: false, summary: null, reason, lastSyncedAt });
    }
    return jsonResponse({ ok: true, found: true, summary: JSON.parse(raw) });
  } catch (e) {
    // 原本只回一句「讀取失敗」，把真正的例外訊息整個丟掉——例如最常見的帳號共用
    // KV 每日寫入額度用完，畫面只會看到一句看不出原因的錯誤。帶上 detail 才看得出來。
    return jsonResponse({ error: "讀取失敗", detail: String(e?.message || e).slice(0, 300) || null }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.health_kv) return jsonResponse({ error: "KV not configured" }, 500);

  let body;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return jsonResponse({ error: "內容過大" }, 413);
    body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  // 新版 App 用 Authorization header；舊版（快取在手機上的舊頁面）放在 body.token，兩種都收。
  const token = headerToken(request) || body?.token;
  if (!isValidToken(token)) return jsonResponse({ error: "缺少或格式不對的 token" }, 400);

  const summary = body?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    return jsonResponse({ error: "缺少 summary" }, 400);
  }

  try {
    const syncedAt = new Date().toISOString();

    // 防覆蓋：先讀現有快照；讀取失敗就照舊寫入（不因保護機制本身出問題而擋掉正常同步）。
    let existingRaw = null;
    let existing = null;
    try {
      existingRaw = await env.health_kv.get(KV_PREFIX + token);
      existing = existingRaw ? JSON.parse(existingRaw) : null;
    } catch {
      existingRaw = null;
      existing = null;
    }
    if (existing && typeof existing === "object") {
      const oldSize = snapshotSize(existing);
      const newSize = snapshotSize(summary);
      const reason = shrinkReason(oldSize, newSize);
      if (reason) {
        return jsonResponse({
          ok: false,
          error: "snapshot_rejected",
          reason,
          detail: `${SHRINK_TEXT[reason] || "快照比現有的少很多"}，為避免蓋掉資料，這次沒有寫入。`,
          existing: oldSize,
          incoming: newSize,
        }, 409);
      }
      // 覆蓋前保留上一版（只在原本有資料時存，最多每 6 小時一次）。失敗不影響同步本身。
      try {
        if (!isEmptySnapshotSize(oldSize)) {
          const prev = await readJsonKey(env, PREV_PREFIX + token);
          if (!prev?.savedAt || Date.parse(syncedAt) - Date.parse(prev.savedAt) >= PREV_REFRESH_MS) {
            await env.health_kv.put(PREV_PREFIX + token, JSON.stringify({ savedAt: syncedAt, snapshot: existing }), { expirationTtl: TTL_SECONDS });
          }
        }
      } catch { /* 備份失敗：略過 */ }
    }

    const stored = { ...summary, syncedAt };
    await env.health_kv.put(KV_PREFIX + token, JSON.stringify(stored), { expirationTtl: TTL_SECONDS });
    await touchSyncMeta(env, token, syncedAt);
    return jsonResponse({ ok: true, syncedAt });
  } catch (e) {
    // 同上：帶上真正的例外訊息（例如 "KV put() limit exceeded for the day."），
    // 不然「Z∞ 同步」卡片只會顯示「同步失敗：HTTP 500」，看不出是不是額度問題。
    return jsonResponse({ error: "寫入失敗", detail: String(e?.message || e).slice(0, 300) || null }, 500);
  }
}

// 不過期的「最後同步」紀錄。快照本體 14 天後會被 KV 清掉，這份紀錄讓 AI 還能說出
// 「最後一次上傳大約是什麼時候」。失敗不影響同步本身（快照已經寫進去了）。
async function touchSyncMeta(env, token, syncedAt) {
  try {
    const now = Date.parse(syncedAt);
    const meta = await readJsonKey(env, META_PREFIX + token);
    if (!meta?.lastSyncedAt || now - Date.parse(meta.lastSyncedAt) >= META_REFRESH_MS) {
      await env.health_kv.put(META_PREFIX + token, JSON.stringify({ firstSyncedAt: meta?.firstSyncedAt || syncedAt, lastSyncedAt: syncedAt }));
    }
    const tag = await tokenTag(token);
    const writer = await readJsonKey(env, LAST_WRITER_KEY);
    if (!writer || writer.tokenTag !== tag || now - Date.parse(writer.at) >= META_REFRESH_MS) {
      await env.health_kv.put(LAST_WRITER_KEY, JSON.stringify({ tokenTag: tag, at: syncedAt }));
    }
  } catch { /* 例如 KV 當日寫入額度用完：快照已存好，這裡安靜略過 */ }
}
