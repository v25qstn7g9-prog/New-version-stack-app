/**
 * market-calendar.js — 某天台股是否休市（後端共用），兩個來源：
 *
 * 1. 證交所休市行事曆（openapi.twse.com.tw，經 holiday-schedule.js 邊緣快取 6 小時）——主來源。
 *    它有「只辦結算交割、市場無交易」這類公務員照常上班的休市日，比辦公日曆準。
 * 2. 行政院人事行政總處「政府行政機關辦公日曆表」（政府資料開放平臺）——備援。
 *    官方檔案每年換一個下載網址，這裡讀 ruyut/TaiwanCalendar 依該資料集整理的每年 JSON
 *    （https://github.com/ruyut/TaiwanCalendar，政府資料開放授權）；證交所抓不到、
 *    或證交所還沒公布那一年的行事曆時才用。
 *
 * 每年 12 月 runCalendarCheck 會檢查明年的休市表是否已公布，沒有就用 LINE 提醒。
 */
import { onRequestGet as holidayGet } from "./holiday-schedule.js";
import { holidayStatusFromRows, rowsCoverYear } from "./twse-holiday.js";
import { lineConfigured, pushLine } from "./auto-daily.js";

const OFFICE_URL = (year) => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
const OFFICE_TTL_SECONDS = 24 * 60 * 60;

async function readTwseRows() {
  try {
    const res = await holidayGet();
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.rows) ? data.rows : null;
  } catch {
    return null;
  }
}

export async function readOfficeCalendar(year, fetchImpl = fetch) {
  const url = OFFICE_URL(year);
  let cache = null;
  try { cache = globalThis.caches?.default || null; } catch { cache = null; }
  try {
    const hit = cache ? await cache.match(url) : null;
    if (hit) return await hit.json();
  } catch {}
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    try {
      if (cache) await cache.put(url, new Response(JSON.stringify(rows), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${OFFICE_TTL_SECONDS}` } }));
    } catch {}
    return rows;
  } catch {
    return null;
  }
}

export function officeStatusFromRows(rows, ymd) {
  if (!Array.isArray(rows) || !rows.length) return { closed: null, reason: null };
  const key = String(ymd || "").replace(/\D/g, "");
  const row = rows.find((r) => String(r?.date ?? "") === key);
  if (!row) return { closed: null, reason: null };
  if (row.isHoliday === true) return { closed: true, reason: String(row.description || "").trim() || "例假日" };
  if (row.isHoliday === false) return { closed: false, reason: null };
  return { closed: null, reason: null };
}

/**
 * 回傳 { closed: true|false|null, reason, source: "twse"|"office"|null }。
 * deps 可注入 readTwse / readOffice 方便測試。
 */
export async function marketClosedStatus(ymd, deps = {}) {
  const twseRows = await (deps.readTwse || readTwseRows)();
  const twse = holidayStatusFromRows(twseRows, ymd);
  if (twse.closed !== null) return { ...twse, source: "twse" };
  const year = Number(String(ymd).slice(0, 4));
  const officeRows = year ? await (deps.readOffice || readOfficeCalendar)(year) : null;
  const office = officeStatusFromRows(officeRows, ymd);
  if (office.closed !== null) return { ...office, source: "office" };
  return { closed: null, reason: null, source: null };
}

export async function marketClosed(ymd, deps = {}) {
  return (await marketClosedStatus(ymd, deps)).closed;
}

/**
 * 每天 08:00 的排程呼叫；只在 12 月的 1、8、15、22、29 號動作：
 * 檢查證交所是否已公布明年休市表，沒有就 LINE 提醒（並記下狀態給健康檢查看）。
 */
export async function runCalendarCheck(env, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  const t = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const month = t.getUTCMonth() + 1, day = t.getUTCDate();
  if (month !== 12 || ![1, 8, 15, 22, 29].includes(day)) return { skipped: "not_check_day" };
  const nextYear = t.getUTCFullYear() + 1;
  const twseRows = await (deps.readTwse || readTwseRows)();
  const twseReady = rowsCoverYear(twseRows, nextYear);
  const officeRows = await (deps.readOffice || readOfficeCalendar)(nextYear);
  const officeReady = Array.isArray(officeRows) && officeRows.length > 300;
  const status = { checkedAt: now.toISOString(), year: nextYear, twseReady, officeReady };
  try { await env?.health_kv?.put("calendar:next-year", JSON.stringify(status)); } catch {}
  if (twseReady) return { ok: true, ...status };
  const text = `存股 App 提醒：證交所還沒公布 ${nextYear} 年的休市行事曆。` +
    (officeReady ? `跨年後會先用人事行政總處的辦公日曆判斷休市，證交所公布後自動改回。` : `人事行政總處的 ${nextYear} 年辦公日曆也還讀不到，跨年後可能無法判斷休市日，請留意。`);
  const sent = lineConfigured(env) ? await (deps.pushLine || pushLine)(env, text).catch(() => ({ ok: false })) : { ok: false, skipped: "line_not_configured" };
  return { ok: true, ...status, notified: sent };
}
