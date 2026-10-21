// 因子收集狀態（唯讀）：從 App 同步上來的快照（summary.dataset.radarHistory／tomorrowHistory）
// 算最近幾個交易日每天收了幾筆、各因子有幾筆有值。只讀不寫，給 MCP 工具與系統健康用。
const num = (v) => v != null && v !== "" && Number.isFinite(Number(v));
const kdPair = (kd, k, d) => num(kd?.[k]) && num(kd?.[d]);

// 盤中（morning 09:25／closeLock 13:25）快照的因子，和 App「因子回測」用的欄位一致。
export const TODAY_FACTORS = [
  ["大盤%", (r) => num(r.indexPct)],
  ["個股%", (r) => num(r.stockPct)],
  ["新聞", (r) => num(r.newsScore)],
  ["法人", (r) => r.instLoaded !== false && num(r.inst?.f1)],
  ["KD5分", (r) => kdPair(r.kd, "k5", "d5")],
  ["KD15分", (r) => kdPair(r.kd, "k15", "d15")],
  ["KD60分", (r) => kdPair(r.kd, "k60", "d60")],
  ["KD日線", (r) => kdPair(r.kd, "kDaily", "dDaily")],
  ["KD月線", (r) => kdPair(r.kd, "kMonthly", "dMonthly")],
  ["RVOL", (r) => num(r.volumePrice?.rvol)],
  ["VWAP", (r) => num(r.volumePrice?.distPct)],
  ["前日廣度", (r) => num(r.breadthPrev?.breadth)],
  ["融資", (r) => num(r.margin?.chg1)],
];
// 明日預測（13:25 鎖定）用的隔夜與綜合因子。
export const TOMORROW_FACTORS = [
  ["S&P500", (r) => num(r.global?.spxPct)],
  ["費半", (r) => num(r.global?.soxPct)],
  ["美元台幣", (r) => num(r.global?.usdtwdPct)],
  ["台指近月", (r) => num(r.global?.txfPct)],
  ["隔夜綜合", (r) => num(r.factors?.overnight)],
  ["法人", (r) => num(r.factors?.inst)],
  ["KD", (r) => num(r.factors?.ks)],
];

const list = (h) => (Array.isArray(h?.records) ? h.records : Array.isArray(h) ? h : []).filter((r) => r && typeof r === "object");
const dayOf = (r, field) => String(r[field] || String(r.key || "").split("|")[0] || "").slice(0, 10);

function summarize(records, dayField, factors, days) {
  const byDay = new Map();
  for (const r of records) {
    const d = dayOf(r, dayField);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const recent = [...byDay.keys()].sort().slice(-days);
  return recent.map((d) => {
    const rows = byDay.get(d);
    const phases = {};
    rows.forEach((r) => { const p = String(r.phase || "—"); phases[p] = (phases[p] || 0) + 1; });
    const filled = Object.fromEntries(factors.map(([label, has]) => [label, rows.filter((r) => { try { return has(r); } catch { return false; } }).length]));
    const missing = factors.filter(([label]) => filled[label] === 0).map(([label]) => label);
    return { day: d, records: rows.length, phases, verified: rows.filter((r) => r.actual).length, filled, missing };
  });
}

export function factorCollectionStatus(summary, { days = 8 } = {}) {
  const ds = summary?.dataset;
  if (!ds) return { ok: false, reason: "快照沒有因子資料（App 尚未同步或是舊版快照）" };
  const today = list(ds.radarHistory), tomorrow = list(ds.tomorrowHistory);
  const todayDays = summarize(today, "day", TODAY_FACTORS, days);
  const tomorrowDays = summarize(tomorrow, "predictedOn", TOMORROW_FACTORS, days);
  return {
    ok: true,
    syncedAt: summary.syncedAt || summary.updatedAt || null,
    totals: { intradayRecords: today.length, tomorrowRecords: tomorrow.length },
    lastIntradayDay: todayDays.length ? todayDays[todayDays.length - 1].day : null,
    lastTomorrowDay: tomorrowDays.length ? tomorrowDays[tomorrowDays.length - 1].day : null,
    intraday: todayDays,
    tomorrow: tomorrowDays,
    note: "filled＝那天有值的筆數；missing＝那天完全沒收到的因子。資料來自 App 最後一次同步。",
  };
}
