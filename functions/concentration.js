/** 純函數：只計算股票持倉的市值集中度，不把成本或台股小計冒充全組合。 */
export const CONCENTRATION_THRESHOLDS = Object.freeze({ singlePct: 30, top3Pct: 60 });
const numeric = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "");
const positive = (v) => numeric(v) && Number.isFinite(Number(v)) && Number(v) > 0;

export function calculateConcentration(snapshot) {
  const holdings = Array.isArray(snapshot?.holdings) ? snapshot.holdings : null;
  const live = snapshot?.dataset?.livePrices;
  const quotes = live?.map || {};
  const failed = new Set(live?.failedSymbols || []);
  const missing = new Set();
  const values = new Map();
  const fxQuote = quotes.USDTWD;
  const fx = positive(fxQuote?.price) && !fxQuote.isStale && !failed.has("USDTWD") ? Number(fxQuote.price) : null;
  for (const h of holdings || []) {
    if (numeric(h?.shares) && Number(h.shares) === 0) continue;
    const symbol = String(h?.symbol || "").trim().toUpperCase();
    if (!symbol || !positive(h?.shares)) { missing.add(symbol || "unknown_holding"); continue; }
    const market = /^[0-9]/.test(symbol) ? "TW" : "US";
    const q = quotes[symbol];
    const quoted = positive(q?.price) && !q.isStale && !failed.has(symbol);
    // 保存市值只接受明確市值欄位，絕不 fallback 到 costBasis / avgCost / totalAssets。
    const saved = h.marketValue ?? h.currentValue;
    let value = quoted ? Number(q.price) * Number(h.shares) : (positive(saved) ? Number(saved) : null);
    const source = quoted ? "snapshot_quote" : "saved_market_value";
    if (value == null) missing.add(symbol);
    // 美股保存市值沒有明示 TWD 時仍視為 USD，不可默默混幣。
    const alreadyTwd = !quoted && h.marketValueCurrency === "TWD";
    if (market === "US" && !alreadyTwd) {
      if (fx == null) { missing.add("USDTWD"); value = null; }
      else if (value != null) value *= fx;
    }
    if (!Number.isFinite(value) || !(value > 0)) { missing.add(symbol); continue; }
    const previous = values.get(symbol);
    const valueAsOf = quoted ? q.asOfDate || live?.at || null : h.marketValueAsOf || snapshot?.syncedAt || null;
    const asOf = !previous ? valueAsOf : (!Number.isFinite(Date.parse(previous.asOf || "")) || !Number.isFinite(Date.parse(valueAsOf || ""))
      ? null : (Date.parse(previous.asOf) <= Date.parse(valueAsOf) ? previous.asOf : valueAsOf));
    values.set(symbol, { symbol, market, marketValueTwd: value + (previous?.marketValueTwd || 0), asOf,
      source: previous && previous.source !== source ? "mixed_snapshot" : source });
  }
  const rows = [...values.values()].sort((a, b) => b.marketValueTwd - a.marketValueTwd || a.symbol.localeCompare(b.symbol));
  const total = rows.reduce((s, h) => s + h.marketValueTwd, 0);
  const complete = Boolean(holdings?.length && !missing.size && total > 0 && Number.isFinite(total));
  const top3 = rows.slice(0, 3).reduce((s, h) => s + h.marketValueTwd, 0);
  const tw = rows.filter((h) => h.market === "TW").reduce((s, h) => s + h.marketValueTwd, 0);
  const singleBreach = complete && rows.some((h) => h.marketValueTwd * 100 > CONCENTRATION_THRESHOLDS.singlePct * total);
  const top3Breach = complete && top3 * 100 > CONCENTRATION_THRESHOLDS.top3Pct * total;
  return {
    status: complete ? "complete" : "insufficient_data",
    label: complete ? "持股集中度" : "資料不足",
    reason: complete ? null : (!holdings?.length ? "no_holdings" : "incomplete_valuation"),
    source: "portfolio_sync", asOf: snapshot?.syncedAt || null,
    quoteAsOf: live?.at || null, currency: "TWD", basis: "equity_holdings_market_value",
    thresholds: CONCENTRATION_THRESHOLDS,
    missingSymbols: [...missing].sort(),
    totalMarketValueTwd: complete ? total : null,
    holdings: rows.map((h) => ({ ...h, weightPct: complete ? h.marketValueTwd / total * 100 : null,
      exceedsSingle: complete ? h.marketValueTwd * 100 > CONCENTRATION_THRESHOLDS.singlePct * total : null })),
    top3: { symbols: rows.slice(0, 3).map((h) => h.symbol), weightPct: complete ? top3 / total * 100 : null, exceeds: complete ? top3Breach : null },
    markets: { twPct: complete ? tw / total * 100 : null, usPct: complete ? (total - tw) / total * 100 : null },
    breaches: { single: complete ? singleBreach : null, top3: complete ? top3Breach : null },
  };
}
