// mini-quote-core.js — 迷你報價頁（mini.html）的純計算邏輯，不碰 DOM，方便單元測試。
// 資料來源和主程式完全相同：localStorage 的 holdings / trades，以及同一個 /quote API。

const SYMBOL_PATTERN = /^[0-9]{4,6}[A-Z]?$/;

export function readJsonKey(storage, key, fallback) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// 股數算法與主程式 holdingsWithShares 相同：期初股數 + 買進 − 賣出。
export function currentShares(holding, trades) {
  const list = Array.isArray(trades) ? trades : [];
  const sum = (action) =>
    list
      .filter((t) => t && t.symbol === holding.symbol && t.action === action)
      .reduce((s, t) => s + Number(t.shares || 0), 0);
  return Number(holding.initialShares || 0) + sum("buy") - sum("sell");
}

export function activeHoldings(holdings, trades) {
  if (!Array.isArray(holdings)) return [];
  return holdings
    .filter((h) => h && SYMBOL_PATTERN.test(String(h.symbol || "")))
    .map((h) => ({ symbol: String(h.symbol), name: String(h.name || h.symbol), shares: currentShares(h, trades) }))
    .filter((h) => h.shares > 0);
}

function move(q) {
  const price = Number(q?.price);
  const prev = Number(q?.prevClose);
  if (!Number.isFinite(price) || !(prev > 0)) return null;
  const change = price - prev;
  return { price, prevClose: prev, change, pct: (change / prev) * 100 };
}

export function buildView(active, quotes) {
  const q = quotes || {};
  const rows = active.map((h) => {
    const m = move(q[h.symbol]);
    return { ...h, ...(m || {}), hasQuote: Boolean(m), pnl: m ? m.change * h.shares : null };
  });
  const quoted = rows.filter((r) => r.hasQuote);
  const totalPnl = quoted.reduce((s, r) => s + r.pnl, 0);
  const prevValue = quoted.reduce((s, r) => s + r.prevClose * r.shares, 0);
  return {
    index: move(q.TAIEX),
    rows,
    totalPnl: quoted.length ? totalPnl : null,
    totalPct: prevValue > 0 ? (totalPnl / prevValue) * 100 : null,
    missing: rows.filter((r) => !r.hasQuote).map((r) => r.symbol),
  };
}

export function quoteUrl(active, force = false, now = Date.now()) {
  const symbols = [...active.map((h) => h.symbol), "TAIEX"];
  return `/quote?symbols=${encodeURIComponent(symbols.join(","))}&force=${force ? "1" : "0"}&_ts=${now}`;
}
