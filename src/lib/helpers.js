import { BACKUP_SCHEMA_VERSION, DAILY_SEED, DIVIDEND_CHART_COLORS } from "./constants.js";
import { translate as t } from "./i18n.jsx";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const taiwanDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const out = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: out.year, month: out.month, day: out.day, hour: Number(out.hour), minute: Number(out.minute) };
};

export const todayStr = () => {
  const p = taiwanDateParts();
  return `${p.year}-${p.month}-${p.day}`;
};

export const nf = (n) => (n ?? 0).toLocaleString("zh-TW", { maximumFractionDigits: 0 });

// A categorical XAxis (dataKey pointing at a string) spaces every point
// evenly by ARRAY INDEX, never by real elapsed time. That's invisible when
// records are evenly spaced, but this app's history mixes a handful of
// sparse quarterly snapshots (2021-2024) with dense near-daily records
// (2025-2026): ~14 old points vs ~80 recent ones. Index-spacing squeezes
// those 3+ sparse years into a sliver near the left edge and stretches the
// last ~14 months across almost the entire chart — years of real history
// look "short", and the line connecting the sparse old points draws a fake
// smooth ramp that isn't really there. Picking better tick *labels* (the
// previous fix here) can't correct this: labels just get relabeled at
// whatever index position their date happens to fall on.
// The real fix is a numeric time-scaled axis: chartData now carries a "t"
// timestamp, the XAxis uses type="number" with a dataMin/dataMax domain, so
// pixel position is proportional to actual elapsed time. pickEvenTimeTicks
// just returns evenly spaced timestamps to label — no snapping to existing
// data needed, since a continuous numeric axis can place a tick anywhere.

export function pickEvenTimeTicks(data, key, count = 6) {
  if (!data || data.length === 0) return [];
  const minT = data[0][key], maxT = data[data.length - 1][key];
  if (minT === maxT) return [minT];
  const ticks = [];
  for (let i = 0; i < count; i++) {
    ticks.push(Math.round(minT + ((maxT - minT) * i) / (count - 1)));
  }
  return ticks;
}

export function formatTickDate(t) {
  const d = new Date(t);
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const pf = (n) => `${n >= 0 ? "+" : ""}${(n ?? 0).toFixed(2)}%`;

// Lazily injects the SheetJS (xlsx) library the first time Excel export is
// actually used, instead of loading it eagerly on every page load. This
// keeps a large third-party script fully off the critical boot path — if
// it fails to load for any reason, only the Excel button is affected, not
// the rest of the app. Cached at module scope (not component state) so a
// second click reuses the same in-flight/completed load instead of
// injecting the script tag again.
let xlsxLoadPromise = null;

export function loadXLSXLibrary() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX 載入後仍無法使用")));
    script.onerror = () => reject(new Error("XLSX 函式庫載入失敗，請確認網路連線"));
    document.head.appendChild(script);
  }).catch((err) => { xlsxLoadPromise = null; throw err; }); // allow retry on next click if it failed
  return xlsxLoadPromise;
}

// Animates a number counting up/down to its new value instead of jumping
// instantly — used for the big "目前總資產" figure so a live-price refresh
// feels like something happened rather than a silent swap.

export function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d || 1);
}

export function monthsBetween(dateA, dateB) {
  const a = parseLocalDate(dateA), b = parseLocalDate(dateB);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
    + (b.getDate() - a.getDate()) / 30;
}

export function addMonths(dateStr, n) {
  const d = parseLocalDate(dateStr);
  d.setMonth(d.getMonth() + Math.round(n));
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
// build a monthly projection schedule: month 0 = start date

export function buildSchedule({ startDate, initialCapital, initialPrincipal, initialAssets, monthlyAmount, annualReturn, horizonMonths }) {
  const principal0 = Number(initialPrincipal ?? initialCapital ?? 0);
  const assets0 = Number(initialAssets ?? initialCapital ?? principal0);
  const rm = Math.pow(1 + (annualReturn / 100), 1 / 12) - 1;
  const rows = [{ index: 0, principal: principal0, assets: assets0 }];
  for (let i = 1; i <= horizonMonths; i++) {
    const prev = rows[i - 1];
    rows.push({
      index: i,
      principal: prev.principal + monthlyAmount,
      assets: prev.assets * (1 + rm) + monthlyAmount,
    });
  }
  return rows;
}
// find the first schedule index whose `key` value reaches `target`, with linear interpolation
// Whether it's currently within TWSE trading hours (weekdays 09:00–13:30,
// using the device's local time — fine since this app is used in Taiwan).
// Only checks weekday + time window; it doesn't know about public holidays,
// so a market holiday will still count as "open" here and the auto-refresh
// will fire a few extra times that day — harmless, just not perfectly precise.

export function isTwseTradingHours(date = new Date()) {
  const tw = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = tw.getDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;
  const minutes = tw.getHours() * 60 + tw.getMinutes();
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

export function findCrossing(schedule, key, target) {
  if (!schedule.length) return null;
  if (target <= schedule[0][key]) return { index: 0 };
  for (let i = 1; i < schedule.length; i++) {
    if (schedule[i][key] >= target) {
      const prev = schedule[i - 1][key], cur = schedule[i][key];
      const frac = cur === prev ? 0 : (target - prev) / (cur - prev);
      return { index: i - 1 + frac };
    }
  }
  return { index: schedule.length - 1, beyond: true };
}

// ---------- live price helpers (Cloudflare Pages Function) ----------
// The front end sends the symbols that are actually held to the same-origin
// /quote endpoint. Cloudflare then talks to TWSE/Yahoo server-side, so the
// browser no longer needs any public CORS proxy.

export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- independent AI fallback helpers ----------
// The fallback URL points to a second provider (for example Vercel), so it
// can still answer even when Cloudflare Workers AI quota is exhausted.

export function normalizeExternalAiAskUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const u = new URL(text);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return "";
    const cleanPath = u.pathname.replace(/\/+$/, "");
    if (!cleanPath || cleanPath === "/") u.pathname = "/api/ask";
    else if (!cleanPath.endsWith("/api/ask")) u.pathname = `${cleanPath}/api/ask`;
    else u.pathname = cleanPath;
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

export function externalAiHealthUrl(raw) {
  const askUrl = normalizeExternalAiAskUrl(raw);
  if (!askUrl) return "";
  const u = new URL(askUrl);
  u.pathname = u.pathname.replace(/\/api\/ask$/, "/api/health");
  return u.toString();
}

export function shouldUseExternalAiFallback(error) {
  const status = Number(error?.status || 0);
  const msg = String(error?.message || "");
  if (!status) return true; // network/timeout
  if (status === 401 || status === 403 || status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return /neuron|quota|額度|limit|binding|AI 服務|timeout|逾時|temporar/i.test(msg);
}

export async function fetchQuotesWithFallback(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return { quotes: {}, missing: [], complete: true };
  const unique = [...new Set(symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  const url = `/quote?symbols=${encodeURIComponent(unique.join(","))}&_ts=${Date.now()}`;
  const res = await fetchWithTimeout(url, { cache: "no-store" }, 9000);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`報價 API 回傳格式錯誤（HTTP ${res.status}）`);
  }
  if (!res.ok || !data?.ok || !data?.quotes) {
    throw new Error(data?.error || `報價 API 失敗（HTTP ${res.status}）`);
  }
  const missing = Array.isArray(data.missing) ? data.missing : unique.filter((sym) => !data.quotes[sym]);
  return {
    quotes: data.quotes,
    missing,
    complete: data.status === "complete" || missing.length === 0,
    status: data.status || (missing.length ? "partial" : "complete"),
  };
}

// ---------- news helpers (持股新聞摘要，Cloudflare Function: /news) ----------

export async function fetchStockNews(activeHoldings) {
  if (!activeHoldings.length) return {};
  const symbols = activeHoldings.map((h) => h.symbol).join(",");
  const names = activeHoldings.map((h) => h.name || "").join(",");
  const url = `/news?symbols=${encodeURIComponent(symbols)}&names=${encodeURIComponent(names)}&_ts=${Date.now()}`;
  const res = await fetchWithTimeout(url, { cache: "no-store" }, 10000);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`新聞 API 回傳格式錯誤（HTTP ${res.status}）`);
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `新聞 API 失敗（HTTP ${res.status}）`);
  }
  return data.news || {};
}

export function relativeTimeLabel(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return t("{n} 分鐘前", { n: Math.max(1, mins) });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("{n} 小時前", { n: hrs });
  const days = Math.floor(hrs / 24);
  return t("{n} 天前", { n: days });
}

// ---------- AI 問答用：把目前持股狀況整理成一段純文字，讓 Claude 直接讀 ----------

export function buildPortfolioContext(holdings, goal, totalToday, totalInvested, trades, dailyRecords, dividends, planItems, planSchedule, goalDate, perf) {
  const lines = [];
  const overallPct = goal?.targetAmount ? Math.min(100, (totalToday / goal.targetAmount) * 100) : 0;
  const remain = goal?.targetAmount ? Math.max(0, goal.targetAmount - totalToday) : 0;
  lines.push(`總目標：${goal?.targetYear || "-"} 年 NT$${nf(goal?.targetAmount || 0)}`);
  lines.push(`目前總資產：NT$${nf(totalToday || 0)}（已達成整體目標${overallPct.toFixed(1)}%，距目標還差NT$${nf(remain)}）`);
  lines.push(`整體目標預計達成時間：${goalDate ? goalDate : "以目前的計畫假設無法在投影期間內達成，或尚未設定"}`);
  if (totalInvested != null) lines.push(`累計投入本金：NT$${nf(totalInvested)}`);

  // 總覽頁的績效數字（持倉損益、累積股息、粗估總報酬/報酬率、資產新高/拉回、今年以來報酬）。
  if (perf) {
    lines.push(`持倉損益(估)：NT$${nf(perf.capitalGain)}`);
    lines.push(`累積股息：NT$${nf(perf.totalDividends)}`);
    lines.push(`粗估總報酬：NT$${nf(perf.totalReturn)}，粗估報酬率：${perf.totalReturnPct.toFixed(2)}%`);
    if (perf.highPoint?.date) lines.push(`資產歷史新高：NT$${nf(perf.highPoint.value)}（${perf.highPoint.date}），目前從新高拉回：${perf.drawdown.toFixed(2)}%`);
    lines.push(`今年資產變化(YTD)：NT$${nf(perf.ytdGain)}，YTD報酬率：${perf.ytdPct.toFixed(2)}%`);
    if (perf.startingCost) lines.push(`起始成本(計畫外的期初投入)：NT$${nf(perf.startingCost)}`);
  }

  // 計畫進度頁：成本進度／資產進度各自跟「已執行月數」比較，是否超前或落後排程。
  if (perf && perf.elapsedMonths != null) {
    const leadText = (label, v) => v == null ? "" : `，${label}${v >= 0 ? "領先" : "落後"}計畫排程約${Math.abs(v).toFixed(1)}個月`;
    lines.push(`計畫進度：已執行${perf.elapsedMonths}個月` +
      leadText("成本進度", perf.costLeadMonths) + leadText("資產進度", perf.assetLeadMonths));
  }

  const active = holdings.filter((h) => h.symbol);
  for (const h of active) {
    const parts = [
      `${h.symbol}(${h.name || ""})`,
      `目前${nf(h.current || 0)}股`,
      h.target2035 ? `目標${nf(h.target2035)}股(達成率${(h.pct || 0).toFixed(1)}%)` : null,
      h.avgCost != null ? `平均成本NT$${h.avgCost.toFixed(2)}` : null,
      h.avgTradePrice != null ? `成交均價(不含手續費)NT$${h.avgTradePrice.toFixed(2)}` : null,
      h.estCostBasis != null ? `持有成本NT$${nf(h.estCostBasis)}` : null,
      h.quarterSharesAdded != null ? `第${h.quarterNum}季增加${h.quarterSharesAdded}股` : null,
      h.yearSharesAdded != null ? `今年累計增加${h.yearSharesAdded}股` : null,
      h.projectedLabel ? h.projectedLabel : null,
    ].filter(Boolean);
    lines.push(parts.join("，"));
  }

  // 交易明細：均價就是從這些原始買賣紀錄算出來的，沒有這段 AI 只看得到結果、看不到算式，
  // 遇到「為什麼均價跟券商對不起來」這種問題會答不出所以然。
  // 每檔股票的紀錄可能有上百筆，塞太多會超過訊息大小，所以只帶最近 20 筆，並註明實際總筆數。
  const allTrades = Array.isArray(trades) ? trades : [];
  for (const h of active) {
    const symbolTrades = allTrades
      .filter((t) => t.symbol === h.symbol)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    if (symbolTrades.length === 0) continue;

    const recent = symbolTrades.slice(-20);
    const omitted = symbolTrades.length - recent.length;
    lines.push(`\n${h.symbol} 交易紀錄${omitted > 0 ? `（共${symbolTrades.length}筆，以下為最近20筆）` : `（共${symbolTrades.length}筆）`}：`);
    for (const t of recent) {
      const fee = t.fee ? `，手續費${t.fee}` : "";
      lines.push(`${t.date} ${t.action === "buy" ? "買進" : "賣出"} ${t.shares}股 @NT$${t.price}${fee}`);
    }
  }

  // 每日紀錄（資產曲線）：只帶最近 20 筆，長期歷史留給圖表看就好，這裡是給「最近走勢」用的。
  const sortedDaily = Array.isArray(dailyRecords)
    ? [...dailyRecords].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  if (sortedDaily.length > 0) {
    const recentDaily = sortedDaily.slice(-20);
    const omitted = sortedDaily.length - recentDaily.length;
    lines.push(`\n每日紀錄${omitted > 0 ? `（共${sortedDaily.length}筆，以下為最近20筆）` : `（共${sortedDaily.length}筆）`}：`);
    for (const r of recentDaily) {
      const total = (r.twValue || 0) + (r.usValue || 0);
      lines.push(`${r.date} 資產NT$${nf(total)}（台股${nf(r.twValue || 0)}+美股${nf(r.usValue || 0)}）`);
    }
  }

  // 配息紀錄：只帶最近 20 筆。
  const sortedDividends = Array.isArray(dividends)
    ? [...dividends].sort((a, b) => a.date.localeCompare(b.date))
    : [];
  if (sortedDividends.length > 0) {
    const recentDiv = sortedDividends.slice(-20);
    const omitted = sortedDividends.length - recentDiv.length;
    lines.push(`\n配息紀錄${omitted > 0 ? `（共${sortedDividends.length}筆，以下為最近20筆）` : `（共${sortedDividends.length}筆）`}：`);
    for (const d of recentDiv) {
      lines.push(`${d.date} ${d.symbol} ${nf(d.shares)}股 @NT$${d.perShare}/股 = NT$${nf(d.amount)}`);
    }
  }

  // 計畫設定：定期定額配置 + 資產成長曲線假設（計畫進度頁面用來投影「預計達成日」的依據）。
  if (Array.isArray(planItems) && planItems.length > 0) {
    lines.push(`\n定期定額配置：`);
    for (const p of planItems) {
      lines.push(`${p.symbol} 每期NT$${nf(p.amount)}${p.note ? `（${p.note}）` : ""}`);
    }
  }
  if (planSchedule) {
    lines.push(`\n資產成長計畫假設：起始日${planSchedule.startDate}，起始本金NT$${nf(planSchedule.initialPrincipal ?? planSchedule.initialCapital)}，` +
      `起始資產NT$${nf(planSchedule.initialAssets ?? planSchedule.initialCapital)}，每月投入NT$${nf(planSchedule.monthlyAmount)}，年化報酬率${planSchedule.annualReturn}%，` +
      `投影期間${planSchedule.horizonMonths}個月`);
  }

  return lines.join("\n");
}


// ---------- storage helpers ----------

export async function loadKey(key, fallback) {
  try {
    if (window.storage?.get) {
      const res = await window.storage.get(key, false);
      if (res?.value) return JSON.parse(res.value);
    }
    const local = window.localStorage?.getItem(key);
    return local ? JSON.parse(local) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveKey(key, value) {
  const payload = JSON.stringify(value);
  let saved = false;
  try {
    if (window.storage?.set) {
      await window.storage.set(key, payload, false);
      saved = true;
    }
  } catch (e) {
    console.warn("window.storage save failed", key, e);
  }
  try {
    window.localStorage?.setItem(key, payload);
    saved = true;
  } catch (e) {
    console.warn("localStorage save failed", key, e);
  }
  if (!saved) console.error("storage save failed", key);
}

export function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function isValidDateStr(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = parseLocalDate(v);
  return Number.isFinite(d.getTime()) && `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` === v;
}

export function finiteNonNegative(v) {
  return v == null || v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0);
}

export function inspectBackupPayload(payload) {
  const errors = [], warnings = [];
  if (!isObject(payload)) return { ok: false, errors: [t("最外層不是有效物件")], warnings };
  const data = isObject(payload.data) ? payload.data : payload; // schema 1 相容
  const schemaVersion = Number(payload.schemaVersion || 1);
  if (!Number.isFinite(schemaVersion) || schemaVersion < 1) errors.push(t("schemaVersion 不合法"));
  if (schemaVersion > BACKUP_SCHEMA_VERSION) errors.push(t("備份 schema {found} 比目前 App 支援的 {max} 新，為避免資料損壞不匯入", { found: schemaVersion, max: BACKUP_SCHEMA_VERSION }));

  const requiredArrays = ["dailyRecords", "holdings", "trades", "dividends", "planItems"];
  requiredArrays.forEach((k) => { if (!Array.isArray(data[k])) errors.push(t("{key} 不是陣列", { key: k })); });
  if (!isObject(data.goal)) errors.push(t("goal 不存在或格式錯誤"));
  if (!isObject(data.planSchedule)) errors.push(t("planSchedule 不存在或格式錯誤"));
  if (errors.length) return { ok: false, errors, warnings, data, schemaVersion };

  data.dailyRecords.forEach((r, i) => {
    if (!isObject(r) || !isValidDateStr(r.date)) errors.push(t("每日紀錄第 {n} 筆日期不合法", { n: i + 1 }));
    ["twValue", "usValue", "twCost", "usCost"].forEach((k) => {
      if (!finiteNonNegative(r?.[k])) errors.push(t("每日紀錄第 {n} 筆 {key} 不是有效非負數字", { n: i + 1, key: k }));
    });
  });
  data.holdings.forEach((h, i) => {
    if (!isObject(h) || !String(h.symbol || "").trim()) errors.push(t("持股第 {n} 筆缺少股票代號", { n: i + 1 }));
    ["initialShares", "current", "target2035", "avgCost", "manualAvgCost"].forEach((k) => {
      if (!finiteNonNegative(h?.[k])) errors.push(t("持股第 {n} 筆 {key} 不是有效非負數字", { n: i + 1, key: k }));
    });
    if (h?.costOverride != null && (!isObject(h.costOverride) || !finiteNonNegative(h.costOverride.amount) || !finiteNonNegative(h.costOverride.asOfShares))) {
      errors.push(t("持股第 {n} 筆 costOverride 格式不合法", { n: i + 1 }));
    }
  });
  data.trades.forEach((tr, i) => {
    if (!isObject(tr) || !isValidDateStr(tr.date)) errors.push(t("交易第 {n} 筆日期不合法", { n: i + 1 }));
    if (!String(tr?.symbol || "").trim()) errors.push(t("交易第 {n} 筆缺少股票代號", { n: i + 1 }));
    if (!(["buy", "sell"].includes(tr?.action))) errors.push(t("交易第 {n} 筆買賣方向不合法", { n: i + 1 }));
    if (!(Number(tr?.shares) > 0)) errors.push(t("交易第 {n} 筆股數必須大於 0", { n: i + 1 }));
    if (!(Number(tr?.price) > 0)) errors.push(t("交易第 {n} 筆成交價必須大於 0", { n: i + 1 }));
    ["fee", "tax", "amount"].forEach((k) => { if (!finiteNonNegative(tr?.[k])) errors.push(t("交易第 {n} 筆 {key} 不合法", { n: i + 1, key: k })); });
    if (Number.isFinite(Number(tr?.amount)) && Number(tr?.shares) > 0 && Number(tr?.price) > 0) {
      const fee = Number(tr?.fee || 0), tax = Number(tr?.tax || 0);
      const expected = tr.action === "sell"
        ? Number(tr.shares) * Number(tr.price) - fee - tax
        : Number(tr.shares) * Number(tr.price) + fee;
      if (Math.abs(Number(tr.amount) - expected) > 1) warnings.push(t("交易第 {n} 筆交易金額與股數×價格不一致", { n: i + 1 }));
    }
  });
  data.dividends.forEach((d, i) => {
    if (!isObject(d) || !isValidDateStr(d.date)) errors.push(t("配息第 {n} 筆日期不合法", { n: i + 1 }));
    if (!String(d?.symbol || "").trim()) errors.push(t("配息第 {n} 筆缺少股票代號", { n: i + 1 }));
    ["shares", "perShare", "amount"].forEach((k) => { if (!finiteNonNegative(d?.[k])) errors.push(t("配息第 {n} 筆 {key} 不合法", { n: i + 1, key: k })); });
  });
  data.planItems.forEach((x, i) => {
    if (!isObject(x) || !String(x.symbol || "").trim()) errors.push(t("定期定額第 {n} 筆缺少標的", { n: i + 1 }));
    if (!finiteNonNegative(x?.amount)) errors.push(t("定期定額第 {n} 筆金額不合法", { n: i + 1 }));
  });

  if (!(Number(data.goal?.targetAmount) > 0)) errors.push(t("目標金額必須大於 0"));
  if (!(Number(data.goal?.targetYear) >= 2000 && Number(data.goal?.targetYear) <= 2200)) errors.push(t("目標年份不合理"));
  if (!isValidDateStr(data.planSchedule?.startDate)) errors.push(t("計畫起始日不合法"));
  ["initialCapital", "initialPrincipal", "initialAssets", "monthlyAmount"].forEach((k) => {
    if (data.planSchedule?.[k] != null && !finiteNonNegative(data.planSchedule[k])) errors.push(t("planSchedule.{key} 不合法", { key: k }));
  });
  if (data.planSchedule?.annualReturn != null && !(Number(data.planSchedule.annualReturn) > -100 && Number.isFinite(Number(data.planSchedule.annualReturn)))) errors.push(t("年化報酬率不合法"));
  if (data.planSchedule?.horizonMonths != null && !(Number(data.planSchedule.horizonMonths) > 0)) errors.push(t("投影月數必須大於 0"));
  if (schemaVersion >= 2 && data.costBasis != null && (!isObject(data.costBasis) || !finiteNonNegative(data.costBasis.startingCost))) errors.push(t("costBasis 格式不合法"));

  const duplicateIds = (arr, label) => {
    const seen = new Set(), dup = new Set();
    arr.forEach((x) => { const id = String(x?.id || "").trim(); if (id && seen.has(id)) dup.add(id); else if (id) seen.add(id); });
    if (dup.size) warnings.push(t("{label} 有 {n} 個重複 ID", { label: t(label), n: dup.size }));
  };
  duplicateIds(data.holdings, "持股");
  duplicateIds(data.trades, "交易");
  duplicateIds(data.dividends, "配息");
  duplicateIds(data.planItems, "定期定額");
  const holdingSymbols = data.holdings.map((h) => String(h?.symbol || "").trim()).filter(Boolean);
  if (new Set(holdingSymbols).size !== holdingSymbols.length) warnings.push(t("持股清單有重複股票代號"));
  const dates = data.dailyRecords.map((r) => r?.date).filter(Boolean);
  if (new Set(dates).size !== dates.length) warnings.push(t("每日紀錄有重複日期，匯入後請檢查是否為刻意保留"));

  return { ok: errors.length === 0, errors, warnings, data, schemaVersion };
}

// ---- seed data imported from user's Excel (存股現況表) ----

export function colorForSymbol(symbol, symbols) {
  const i = symbols.indexOf(symbol);
  return DIVIDEND_CHART_COLORS[i % DIVIDEND_CHART_COLORS.length];
}

export function describeToolCall(tc, holdings) {
  const a = tc.arguments || {};
  switch (tc.name) {
    case "add_trade": {
      const actionLabel = a.action === "sell" ? t("賣出") : t("買進");
      const feeStr = a.fee ? t("，手續費 {fee}", { fee: a.fee }) : "";
      const taxStr = a.tax ? t("，證交稅 {tax}", { tax: a.tax }) : "";
      return t("新增交易：{date} {action} {symbol} {shares} 股 @NT${price}{fee}{tax}", {
        date: a.date || t("今天"), action: actionLabel, symbol: a.symbol, shares: a.shares, price: a.price, fee: feeStr, tax: taxStr,
      });
    }
    case "update_holding_target":
      return t("把 {symbol} 的目標股數改成 {target} 股", { symbol: a.symbol, target: nf(a.target) });
    case "update_manual_avg_cost":
      return a.clear
        ? t("清除 {symbol} 手動設定的平均成本，改回自動計算", { symbol: a.symbol })
        : t("把 {symbol} 的平均成本手動設定為 NT${avgCost}", { symbol: a.symbol, avgCost: a.avgCost });
    case "update_goal": {
      const parts = [];
      if (a.targetAmount != null) parts.push(t("目標金額改成 NT${amount}", { amount: nf(a.targetAmount) }));
      if (a.targetYear != null) parts.push(t("目標年份改成 {year}", { year: a.targetYear }));
      return parts.length ? parts.join(t("，")) : t("修改總目標（但沒有帶任何要改的欄位）");
    }
    default:
      return t("執行未知動作：{name}", { name: tc.name });
  }
}

// 防呆檢查：AI 有時候會在資訊不完整時亂填 0 或空值，而不是照規則先問清楚。
// 這裡在顯示確認卡片前先擋一次，數字明顯不合理（股數/價格 <= 0）就不給按確定，
// 不能只靠系統提示要求 AI 自律，光是文字指令對小模型來說不夠可靠。

export function validateToolCall(tc) {
  const a = tc?.arguments || {};
  const symbol = String(a.symbol || "").trim().toUpperCase();
  const finitePositive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;
  const validDate = (v) => {
    if (v == null || v === "") return true;
    const text = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const d = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
  };
  const validSymbol = /^[A-Z0-9.-]{1,20}$/.test(symbol);
  switch (tc?.name) {
    case "add_trade":
      if (!validSymbol) return t("股票代號格式不正確");
      if (a.action !== "buy" && a.action !== "sell") return t("交易動作必須是買進或賣出");
      if (!finitePositive(a.shares) || Number(a.shares) > 100000000) return t("股數數值不合理");
      if (!finitePositive(a.price) || Number(a.price) > 100000000) return t("成交價數值不合理");
      if (!Number.isFinite(Number(a.fee || 0)) || Number(a.fee || 0) < 0) return t("手續費數值不合理");
      if (!Number.isFinite(Number(a.tax || 0)) || Number(a.tax || 0) < 0) return t("證交稅數值不合理");
      if (!validDate(a.date)) return t("交易日期格式不正確");
      return null;
    case "update_holding_target":
      if (!validSymbol) return t("股票代號格式不正確");
      if (!finitePositive(a.target) || Number(a.target) > 100000000) return t("目標股數數值不合理");
      return null;
    case "update_manual_avg_cost":
      if (!validSymbol) return t("股票代號格式不正確");
      if (!a.clear && (!finitePositive(a.avgCost) || Number(a.avgCost) > 100000000)) return t("平均成本數值不合理");
      return null;
    case "update_goal":
      if (a.targetAmount == null && a.targetYear == null) return t("沒有帶任何要修改的欄位");
      if (a.targetAmount != null && (!finitePositive(a.targetAmount) || Number(a.targetAmount) > 1000000000000)) return t("目標金額數值不合理");
      if (a.targetYear != null && (!Number.isInteger(Number(a.targetYear)) || Number(a.targetYear) < 2020 || Number(a.targetYear) > 2200)) return t("目標年份不合理");
      return null;
    default:
      return null;
  }
}

export function dailyRecordFields(r, fieldsFilter) {
  const twValue = r.twValue || 0, usValue = r.usValue || 0;
  const twCost = r.twCost || 0, usCost = r.usCost || 0;
  const all = {
    totalAsset: twValue + usValue,
    totalCost: twCost + usCost,
    totalGain: (twValue + usValue) - (twCost + usCost),
    twValue, usValue, twCost, usCost,
    twGain: twValue - twCost,
    usGain: usValue - usCost,
  };
  if (Array.isArray(fieldsFilter) && fieldsFilter.length) {
    const picked = {};
    fieldsFilter.forEach((f) => { if (f in all) picked[f] = all[f]; });
    return picked;
  }
  return all;
}

export const fmtFieldLine = (obj, signed) => Object.entries(obj)
  .map(([k, v]) => `${k}=${signed && v >= 0 ? "+" : ""}${nf(Math.round(v))}`)
  .join(", ");

// 唯讀查詢工具的實際執行：直接從目前 App 的資料裡撈、用程式碼算，完全不會動到任何資料，
// 所以不用跳確認卡片，AI 要用就自動給它；每一種彙總方式都在這裡算好，AI 只負責決定
// 要查什麼、怎麼把結果講出來，不會有它自己動手算術抄錯數字的風險。

export function executeReadTool(tc, { trades, dailyRecords, dividends, holdings }) {
  const a = tc.arguments || {};

  if (tc.name !== "query_app_data") return null;

  if (a.source === "daily_records") {
    const sorted = [...(dailyRecords || [])].sort((x, y) => x.date.localeCompare(y.date));
    if (!sorted.length) return "沒有任何每日紀錄";
    const findAtOrBefore = (dateStr) => {
      let found = null;
      for (const r of sorted) { if (r.date <= dateStr) found = r; else break; }
      return found;
    };
    const agg = a.aggregation || "records";

    if (agg === "records") {
      const inRange = sorted.filter((r) =>
        (!a.fromDate || r.date >= a.fromDate) && (!a.toDate || r.date <= a.toDate));
      const limit = Math.min(200, Number(a.limit) || 120);
      const list = inRange.slice(-limit);
      if (!list.length) return "這個範圍沒有每日紀錄";
      return list.map((r) => `${r.date} ${fmtFieldLine(dailyRecordFields(r, a.fields))}`).join("\n");
    }

    if (agg === "start_end") {
      const fromRec = a.fromDate ? findAtOrBefore(a.fromDate) : sorted[0];
      const toRec = a.toDate ? findAtOrBefore(a.toDate) : sorted[sorted.length - 1];
      if (!fromRec || !toRec) return "這個區間找不到對應的每日紀錄，無法計算";
      const f = dailyRecordFields(fromRec, a.fields), t = dailyRecordFields(toRec, a.fields);
      const diffs = {};
      Object.keys(t).forEach((k) => { diffs[k] = t[k] - f[k]; });
      const noteDates = (fromRec.date !== a.fromDate || toRec.date !== a.toDate)
        ? `（其中一天沒有剛好的紀錄，實際比對：${fromRec.date} → ${toRec.date}）` : "";
      return `${a.fromDate || fromRec.date} 到 ${a.toDate || toRec.date}${noteDates} 變化：\n${fmtFieldLine(diffs, true)}`;
    }

    if (agg === "monthly") {
      const byMonth = {};
      sorted.forEach((r) => { byMonth[r.date.slice(0, 7)] = r; }); // 每月最後一筆
      const allMonths = Object.keys(byMonth).sort();
      const months = allMonths.filter((mk) =>
        (!a.fromDate || mk >= a.fromDate.slice(0, 7)) && (!a.toDate || mk <= a.toDate.slice(0, 7)));
      if (!months.length) return "這個區間沒有可用的月度資料";
      const lines = months.map((mk) => {
        const idx = allMonths.indexOf(mk);
        if (idx <= 0) return `${mk}：最早紀錄，無前月可比較`;
        const e = dailyRecordFields(byMonth[mk], a.fields);
        const s = dailyRecordFields(byMonth[allMonths[idx - 1]], a.fields);
        const diffs = {};
        Object.keys(e).forEach((k) => { diffs[k] = e[k] - s[k]; });
        return `${mk}：${fmtFieldLine(diffs, true)}`;
      });
      return lines.join("\n");
    }

    if (agg === "min_max") {
      const byMonth = {};
      sorted.forEach((r) => { byMonth[r.date.slice(0, 7)] = r; });
      const allMonths = Object.keys(byMonth).sort();
      const field = (Array.isArray(a.fields) && a.fields[0]) || "totalGain";
      const changes = [];
      for (let i = 1; i < allMonths.length; i++) {
        const mk = allMonths[i];
        if ((a.fromDate && mk < a.fromDate.slice(0, 7)) || (a.toDate && mk > a.toDate.slice(0, 7))) continue;
        const e = dailyRecordFields(byMonth[mk]), s = dailyRecordFields(byMonth[allMonths[i - 1]]);
        changes.push({ mk, change: (e[field] || 0) - (s[field] || 0) });
      }
      if (!changes.length) return "這個區間沒有足夠的資料可以比較（至少要橫跨兩個月）";
      const max = changes.reduce((m, c) => (c.change > m.change ? c : m));
      const min = changes.reduce((m, c) => (c.change < m.change ? c : m));
      return `區間內依「${field}」比較：\n漲最多：${max.mk}（${max.change >= 0 ? "+" : ""}${nf(Math.round(max.change))}）\n` +
        `跌最多：${min.mk}（${min.change >= 0 ? "+" : ""}${nf(Math.round(min.change))}）`;
    }

    if (agg === "summary") {
      const inRange = sorted.filter((r) =>
        (!a.fromDate || r.date >= a.fromDate) && (!a.toDate || r.date <= a.toDate));
      if (!inRange.length) return "這個範圍沒有每日紀錄";
      const first = dailyRecordFields(inRange[0], a.fields);
      const last = dailyRecordFields(inRange[inRange.length - 1], a.fields);
      const lines = Object.keys(last).map((k) => `${k}：${nf(Math.round(first[k]))} → ${nf(Math.round(last[k]))}`);
      return `共 ${inRange.length} 筆紀錄，${inRange[0].date} → ${inRange[inRange.length - 1].date}\n${lines.join("\n")}`;
    }

    return `不支援的 aggregation：${agg}`;
  }

  if (a.source === "trades") {
    let list = (trades || []).slice();
    if (a.symbol) list = list.filter((t) => t.symbol === a.symbol);
    if (a.fromDate) list = list.filter((t) => t.date >= a.fromDate);
    if (a.toDate) list = list.filter((t) => t.date <= a.toDate);
    list.sort((x, y) => x.date.localeCompare(y.date));
    if (!list.length) return "查無符合條件的交易紀錄";

    if (a.aggregation === "summary") {
      const buys = list.filter((t) => t.action === "buy");
      const sells = list.filter((t) => t.action === "sell");
      const buyShares = buys.reduce((s, t) => s + t.shares, 0);
      const sellShares = sells.reduce((s, t) => s + t.shares, 0);
      const buyAmount = buys.reduce((s, t) => s + t.amount, 0);
      const sellAmount = sells.reduce((s, t) => s + t.amount, 0);
      return `共${list.length}筆交易：買進${buys.length}筆共${nf(buyShares)}股（金額NT$${nf(buyAmount)}），` +
        `賣出${sells.length}筆共${nf(sellShares)}股（金額NT$${nf(sellAmount)}）`;
    }
    const limit = Math.min(200, Number(a.limit) || 120);
    return list.slice(-limit).map((t) => {
      const fee = t.fee ? `，手續費${t.fee}` : "";
      const tax = t.tax ? `，證交稅${t.tax}` : "";
      return `${t.date} ${t.symbol} ${t.action === "buy" ? "買進" : "賣出"} ${t.shares}股 @NT$${t.price}${fee}${tax}`;
    }).join("\n");
  }

  if (a.source === "dividends") {
    let list = (dividends || []).slice();
    if (a.symbol) list = list.filter((d) => d.symbol === a.symbol);
    if (a.fromDate) list = list.filter((d) => d.date >= a.fromDate);
    if (a.toDate) list = list.filter((d) => d.date <= a.toDate);
    list.sort((x, y) => x.date.localeCompare(y.date));
    if (!list.length) return "查無符合條件的配息紀錄";

    if (a.aggregation === "summary") {
      const total = list.reduce((s, d) => s + d.amount, 0);
      return `共${list.length}筆配息，總金額NT$${nf(total)}`;
    }
    const limit = Math.min(200, Number(a.limit) || 120);
    return list.slice(-limit).map((d) => `${d.date} ${d.symbol} ${nf(d.shares)}股 @NT$${d.perShare}/股 = NT$${nf(d.amount)}`).join("\n");
  }

  if (a.source === "holding_cost") {
    const h = (holdings || []).find((x) => x.symbol === a.symbol);
    const initialShares = h ? Number(h.initialShares || 0) : 0;
    const symbolTrades = (trades || [])
      .filter((t) => t.symbol === a.symbol && t.date <= a.asOfDate)
      .slice()
      .sort((x, y) => x.date.localeCompare(y.date));

    let shares = initialShares;
    let cost = 0; // 期初股數的成本沒有記錄，這裡當作0，結果只反映交易紀錄部分
    for (const t of symbolTrades) {
      if (t.action === "buy") {
        cost += t.shares * t.price + Number(t.fee || 0);
        shares += t.shares;
      } else if (shares > 0) {
        const avgPerShare = cost / shares;
        const sellShares = Math.min(t.shares, shares);
        cost -= avgPerShare * sellShares;
        shares -= sellShares;
      }
    }
    const avgCost = shares > 0 ? cost / shares : null;
    const caveat = initialShares > 0
      ? "（注意：期初股數的成本沒有記錄，這個均價只反映交易紀錄部分，可能不完全準確）"
      : "";
    if (shares <= 0) return `截至${a.asOfDate}：${a.symbol} 股數為0或查無資料${caveat}`;
    return `截至${a.asOfDate}：${a.symbol} 股數${nf(shares)}股，均價NT$${avgCost.toFixed(2)}，總成本NT$${nf(Math.round(cost))}${caveat}`;
  }

  return `不支援的 source：${a.source}`;
}

// AI 助手專用：查即時股價（跟 executeReadTool 不同，這支要打 /quote API，是非同步的）

export async function executeLiveQuoteTool(tc, holdings) {
  const a = tc.arguments || {};
  let symbols = Array.isArray(a.symbols) && a.symbols.length
    ? a.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
    : (holdings || []).filter((h) => Number(h.initialShares) > 0 || (h.target2035 || 0) > 0).map((h) => h.symbol);
  symbols = [...new Set(symbols)];
  if (!symbols.length) return "沒有指定股票代號，也沒有查到任何持股";
  try {
    const { quotes, missing } = await fetchQuotesWithFallback(symbols);
    const lines = symbols.map((sym) => {
      const q = quotes[sym];
      if (!q || q.price == null) return `${sym}：查不到即時股價`;
      return `${sym}：NT$${q.price}${q.asOfDate ? `（${q.asOfDate}）` : ""}`;
    });
    if (missing && missing.length) lines.push(`（查不到報價的代號：${missing.join("、")}）`);
    return lines.join("\n");
  } catch (e) {
    return `即時股價查詢失敗：${e.message}`;
  }
}

export function defaultHoldings() {
  return [];
}

export function defaultTrades() {
  return [];
}

export function defaultDividends() {
  return [];
}

export function defaultDailyRecords() {
  return DAILY_SEED.map((r) => ({ id: uid(), ...r }));
}

export function defaultPlan() {
  return [];
}

export function defaultPlanSchedule() {
  return {
    startDate: todayStr(),
    initialPrincipal: 0,
    initialAssets: 0,
    // 舊版相容欄位：schema 1 仍可能只有 initialCapital。
    initialCapital: 0,
    monthlyAmount: 0,
    annualReturn: 11,
    horizonMonths: 120,
  };
}
