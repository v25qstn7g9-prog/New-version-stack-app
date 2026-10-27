// 預測因子的資料來源健康檢查（唯讀、伺服器端）：量價（Yahoo 分 K）、前日全市場廣度、融資融券、三大法人。
// App 的融資與法人是手機直接向證交所抓；這裡從伺服器抓同一個網址，看來源本身有沒有資料、格式有沒有變。
import { onRequestGet as metricsGet } from "./intraday-metrics.js";
import { prevDayBreadth } from "./market-breadth.js";

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
const taipeiNow = () => new Date(Date.now() + 8 * 3600e3);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

async function twseJson(url) {
  const res = await withTimeout(fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; StockTracker/4.7)" } }), 8000);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { http: res.status, json, head: json ? null : text.slice(0, 80) };
}

// 最近幾個平日（不含今天，今天的融資晚上才公布）
function recentWeekdays(n) {
  const out = []; const d = taipeiNow();
  for (let i = 1; out.length < n && i < 12; i++) {
    const x = new Date(d.getTime() - i * 86400e3);
    if (x.getUTCDay() !== 0 && x.getUTCDay() !== 6) out.push(x);
  }
  return out;
}

function describeTables(json, symbols) {
  const tables = Array.isArray(json?.tables) ? json.tables : Array.isArray(json?.fields) ? [json] : [];
  return tables.map((t) => {
    const fields = (t?.fields || []).map((f) => String(f).replace(/\s+/g, ""));
    const symI = fields.findIndex((f) => f.includes("代號"));
    const rows = Array.isArray(t?.data) ? t.data : [];
    return {
      title: String(t?.title || "").slice(0, 40), fields: fields.slice(0, 18), rows: rows.length,
      found: symI >= 0 ? symbols.filter((s) => rows.some((r) => String(r?.[symI] ?? "").trim() === s)) : [],
    };
  });
}

export async function probeFactorSources(env, symbols = ["0050", "0056", "2330"]) {
  const out = { checkedAt: new Date().toISOString() };
  const tasks = [
    (async () => {
      const res = await withTimeout(metricsGet({ request: new Request("https://asset-app.local/intraday-metrics?symbols=" + ["TAIEX", ...symbols].join(",")), env }), 12000);
      const j = await res.json();
      out.volumePrice = j?.ok ? Object.fromEntries(Object.entries(j.metrics || {}).map(([s, m]) => [s, { day: m.day, lastMinute: m.lastMinute, rvol: m.rvol ?? null, vwap: m.vwap ?? null, comparisonDays: m.comparisonDays ?? null }])) : { ok: false, error: j?.error || "failed", errors: j?.errors };
    })().catch((e) => { out.volumePrice = { ok: false, error: String(e?.message || e) }; }),
    (async () => {
      const d = taipeiNow().toISOString().slice(0, 10);
      const b = await withTimeout(prevDayBreadth(d), 12000);
      out.breadthPrev = { ok: Boolean(b?.available), day: b?.day ?? null, breadth: b?.breadth ?? null, reason: b?.reason ?? null };
    })().catch((e) => { out.breadthPrev = { ok: false, error: String(e?.message || e) }; }),
    (async () => {
      const days = [];
      for (const d of recentWeekdays(2)) {
        const r = await twseJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${ymd(d)}&selectType=ALL&response=json`).catch((e) => ({ error: String(e?.message || e) }));
        days.push({ date: ymd(d), http: r.http ?? null, stat: r.json?.stat ?? null, error: r.error ?? null, nonJson: r.head ?? null, tables: r.json ? describeTables(r.json, symbols) : [] });
      }
      out.margin = days;
    })().catch((e) => { out.margin = { ok: false, error: String(e?.message || e) }; }),
    (async () => {
      const d = recentWeekdays(1)[0];
      const r = await twseJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${ymd(d)}&selectType=ALLBUT0999&response=json`);
      out.institutional = { date: ymd(d), http: r.http, stat: r.json?.stat ?? null, rows: Array.isArray(r.json?.data) ? r.json.data.length : 0, nonJson: r.head };
    })().catch((e) => { out.institutional = { ok: false, error: String(e?.message || e) }; }),
  ];
  tasks.push((async () => {
    // 證交所即時快照的原始欄位（z 最近成交價、pz、tv 成交量、b/a 五檔、o/h/l、tlong 時間），用來確認成交價欄位是否常是 "-"。
    const exCh = ["t00", ...symbols].map((s) => `tse_${s}.tw`).join("|");
    const res = await withTimeout(fetch(`https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_ts=${Date.now()}`, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } }), 6000);
    const j = await res.json();
    out.twseRaw = (j?.msgArray || []).map((m) => ({ c: m.c, z: m.z, pz: m.pz ?? null, tv: m.tv, v: m.v, b: m.b, a: m.a, o: m.o, h: m.h, l: m.l, y: m.y, tlong: m.tlong, keys: Object.keys(m).join(",") }));
  })().catch((e) => { out.twseRaw = { ok: false, error: String(e?.message || e) }; }));
  await Promise.all(tasks);
  return out;
}
