/**
 * twse-holiday.js — 判斷某天是不是 TWSE 休市日（後端共用）
 *
 * TWSE 休市表（/holiday-schedule，資料來自 openapi.twse.com.tw）除了真正的休市日，
 * 也會列出「國曆新年開始交易日」「農曆春節前最後交易日」「春節後開始交易日」這類
 * 「有開盤」的參考日，那些不能當成休市。日期欄位是民國年 yyyMMdd（例如 1150102）。
 * 前端 index.html 的 isClosedHolidayScheduleItem 用的是同一套規則。
 */

const TRADING_DAY_MARKER = /開始交易|最後交易/;

function dateVariants(ymd) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return [];
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const roc = y - 1911;
  return [`${y}-${mm}-${dd}`, `${y}/${mm}/${dd}`, `${y}${mm}${dd}`, `${roc}/${mm}/${dd}`, `${roc}${mm}${dd}`];
}

function rowText(row) {
  return Object.values(row && typeof row === "object" ? row : {}).map((v) => String(v ?? "")).join(" ");
}

function rowDateDigits(row) {
  const raw = row?.Date ?? row?.date ?? row?.["日期"] ?? null;
  return raw == null ? "" : String(raw).replace(/\D/g, "");
}

export function isTradingDayMarkerRow(row) {
  return TRADING_DAY_MARKER.test(rowText(row));
}

export function holidayRowMatchesDate(row, ymd) {
  if (isTradingDayMarkerRow(row)) return false;
  const variants = dateVariants(ymd);
  const digits = rowDateDigits(row);
  if (digits) return variants.some((v) => v.replace(/\D/g, "") === digits);
  const text = rowText(row).replace(/\s+/g, " ");
  return variants.some((v) => text.includes(v));
}

export function holidayReasonOf(row) {
  if (!row || typeof row !== "object") return null;
  for (const k of ["Description", "description", "Holiday", "holiday", "Name", "name", "說明", "名稱", "備註"]) {
    const v = String(row[k] ?? "").trim();
    if (v) return v;
  }
  return null;
}

// 回傳 { closed: true|false|null, reason }；rows 不是陣列或是空的 → null（未知）。
export function holidayStatusFromRows(rows, ymd) {
  if (!Array.isArray(rows) || rows.length === 0) return { closed: null, reason: null };
  const match = rows.find((row) => holidayRowMatchesDate(row, ymd));
  if (!match) return { closed: false, reason: null };
  return { closed: true, reason: holidayReasonOf(match) || "TWSE 休市日" };
}
