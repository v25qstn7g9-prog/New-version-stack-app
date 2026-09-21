import { useState, useEffect, useRef } from "react";
import { Loader2 } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";
import { nf, isTwseTradingHours, fetchQuotesWithFallback, loadKey, saveKey } from "../lib/helpers.js";
import { Dashboard } from "./Dashboard.jsx";
import { Panel } from "./Panel.jsx";
import { Empty } from "./Empty.jsx";
import { useLanguage } from "../lib/i18n.jsx";

function LivePricePanel({ holdings, onFillDailyTw, yesterdayTwValue }) {
  const { t, lang } = useLanguage();
  const [live, setLive] = useState({});      // symbol -> { price, prevClose, isUS, asOfDate, isStale }
  const [liveStatus, setLiveStatus] = useState("idle"); // idle | loading | done | error
  const [liveAt, setLiveAt] = useState(null);
  const [failedSymbols, setFailedSymbols] = useState([]);
  const [marketIndex, setMarketIndex] = useState(null); // { price, prevClose, ... } 加權指數
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const liveRef = useRef({});
  const isFetchingRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // Dynamic watchlist: fetch every Taiwan holding whose current share count
  // is greater than zero. Add/sell holdings in the app and this list follows
  // automatically — no symbol needs to be hardcoded here.
  const activeHoldings = holdings.filter((h) => Number(h.current || 0) > 0 && h.symbol);
  // Auto-refresh reads this ref instead of closing over `activeHoldings`
  // directly, so an interval set up before you add/remove a holding still
  // fetches the current list instead of the one from when it was created.
  const activeRef = useRef(activeHoldings);
  useEffect(() => {
    activeRef.current = activeHoldings;
  });
  // A stable key so the auto-refresh effect only resets its interval when
  // the set of symbols actually changes, not on every render.
  const activeSymbolsKey = activeHoldings.map((h) => h.symbol).sort().join(",");

  // On first mount, load whatever was fetched last time from storage so
  // switching tabs or reopening the app shows the last known prices right
  // away instead of an empty panel that has to fetch from scratch again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadKey("livePrices", null);
      if (cancelled || !cached) { setCacheLoaded(true); return; }
      const revived = {};
      Object.entries(cached.map || {}).forEach(([sym, v]) => {
        revived[sym] = { ...v, asOfDate: v.asOfDate ? new Date(v.asOfDate) : null };
      });
      liveRef.current = revived;
      setLive(revived);
      setFailedSymbols(cached.failedSymbols || []);
      if (cached.marketIndex) {
        setMarketIndex({
          ...cached.marketIndex,
          asOfDate: cached.marketIndex.asOfDate ? new Date(cached.marketIndex.asOfDate) : null,
        });
      }
      const cachedAt = cached.at ? new Date(cached.at) : null;
      setLiveAt(cachedAt);
      if (cachedAt) lastFetchAtRef.current = cachedAt.getTime();
      setLiveStatus(Object.keys(revived).length ? "done" : "idle");
      setCacheLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchAllLive = async () => {
    const targets = activeRef.current;
    if (!targets.length) return;
    // Guard against overlap: if a previous run (manual or auto) is still
    // in-flight, skip this tick instead of firing a duplicate API request.
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    setLiveStatus("loading");
    const symbols = targets.map((h) => h.symbol);
    const requestSymbols = [...symbols, "TAIEX"];
    let quoteResult = null;
    let quotes = null;
    try {
      try {
        quoteResult = await fetchQuotesWithFallback(requestSymbols);
        quotes = quoteResult.quotes;
      } catch (e) {
        // One retry after a short pause — a brief TWSE/API hiccup
        // shouldn't fail the whole refresh.
        await new Promise((res) => setTimeout(res, 800));
        quoteResult = await fetchQuotesWithFallback(requestSymbols);
        quotes = quoteResult.quotes;
      }
    } catch (e) {
      quotes = null;
    }
    const allMissing = quoteResult?.missing || requestSymbols.filter((s) => !quotes || !quotes[s]);
    // 大盤抓不到不能影響「持股報價是否完整」與每日紀錄寫入。
    const failed = allMissing.filter((s) => s !== "TAIEX");
    const freshIndex = quotes?.TAIEX || null;
    const now = new Date();
    // Merge this refresh with the last known successful price for any
    // symbol that failed this round. This keeps the dashboard useful during
    // temporary proxy/API hiccups instead of making that holding disappear.
    const mergedMap = {};
    targets.forEach((h) => {
      if (quotes && quotes[h.symbol]) {
        // Stamp with "now" only for a genuinely fresh fetch this round.
        mergedMap[h.symbol] = { ...quotes[h.symbol], fetchedAt: now.toISOString() };
      } else if (liveRef.current[h.symbol]) {
        // Carry over the old entry as-is, fetchedAt included — so the UI
        // can tell "this is what we showed last time" from "this just came in".
        mergedMap[h.symbol] = liveRef.current[h.symbol];
      }
    });
    liveRef.current = mergedMap;
    setLive(mergedMap);
    setFailedSymbols(failed);
    if (freshIndex) {
      setMarketIndex({ ...freshIndex, fetchedAt: now.toISOString() });
    }
    setLiveStatus(Object.keys(mergedMap).length ? "done" : "error");
    setLiveAt(now);
    lastFetchAtRef.current = now.getTime();
    // Persist the merged map so failed symbols also survive an app reopen.
    if (Object.keys(mergedMap).length) {
      const indexForCache = freshIndex
        ? { ...freshIndex, fetchedAt: now.toISOString() }
        : marketIndex;
      saveKey("livePrices", {
        map: mergedMap,
        failedSymbols: failed,
        marketIndex: indexForCache || null,
        at: now.toISOString(),
      });
      window.dispatchEvent(new CustomEvent("livePricesUpdated", { detail: { map: mergedMap } }));
    }
    isFetchingRef.current = false;
  };

  // Auto-refresh when the panel is ready, then every 15 seconds — but only
  // during TWSE trading hours. Outside those hours the price wouldn't be
  // changing anyway, so this avoids hitting the price source for nothing
  // all evening/overnight/weekends — it falls back to fully manual then.
  // The manual "抓取即時股價" button is unaffected by this — you can still
  // press it any time to check the last close. If we just loaded a cache
  // that's still fresh (e.g. you switched tabs and back within a few
  // seconds), skip the immediate refetch and just let the interval pick up
  // from there. The effect keys off activeSymbolsKey (not the array itself)
  // so it resets the interval when holdings actually change, not on every
  // render.
  useEffect(() => {
    if (!cacheLoaded || !activeSymbolsKey) return;
    const isFresh = Date.now() - lastFetchAtRef.current < 12000;
    if (!isFresh && isTwseTradingHours()) fetchAllLive();
    const timer = setInterval(() => {
      if (isTwseTradingHours()) fetchAllLive();
    }, 15000);
    return () => clearInterval(timer);
  }, [cacheLoaded, activeSymbolsKey]);

  const rows = activeHoldings.map((h) => {
    const l = live[h.symbol];
    if (!l) return null;
    const chg = l.price - l.prevClose;
    const chgPct = l.prevClose ? (chg / l.prevClose) * 100 : 0;
    const value = l.price * h.current;
    const isFromCache = failedSymbols.includes(h.symbol);
    const quoteIsStale = Boolean(l.isStale);
    return { ...h, price: l.price, chg, chgPct, value, isUS: l.isUS, fetchedAt: l.fetchedAt, isFromCache, quoteIsStale };
  }).filter(Boolean);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const hasLive = rows.length > 0;
  const quoteComplete = activeHoldings.length > 0
    && rows.length === activeHoldings.length
    && failedSymbols.length === 0
    && rows.every((r) => Number.isFinite(r.price) && r.price > 0 && !r.isFromCache);
  const staleOne = Object.values(live).find((l) => l.isStale && l.asOfDate);
  const indexPrice = Number(marketIndex?.price);
  const indexPrevClose = Number(marketIndex?.prevClose);
  const hasMarketIndex = Number.isFinite(indexPrice) && indexPrice > 0
    && Number.isFinite(indexPrevClose) && indexPrevClose > 0;
  const indexChange = hasMarketIndex ? indexPrice - indexPrevClose : 0;
  const indexChangePct = hasMarketIndex ? (indexChange / indexPrevClose) * 100 : null;
  const portfolioDayPct = yesterdayTwValue
    ? ((totalValue - yesterdayTwValue) / yesterdayTwValue) * 100
    : null;
  const vsMarketPct = portfolioDayPct != null && indexChangePct != null
    ? portfolioDayPct - indexChangePct
    : null;

  const recordToday = () => {
    if (!onFillDailyTw) return;
    if (!quoteComplete) {
      window.alert(t("目前報價只有部分成功或混有快取價格，為避免把不完整市值寫進每日紀錄，請先重新抓到全部持股報價。"));
      return;
    }
    onFillDailyTw(Math.round(totalValue));
  };

  return (
    <Panel title={t("即時股價")}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px]" style={{ color: COLORS.sub }}>
          {liveStatus === "idle" && t("自動抓取目前持有的 {n} 檔台股（開盤時間每 15 秒更新，收盤後改手動）", { n: activeHoldings.length })}
          {liveStatus === "loading" && t("更新中…")}
          {liveStatus === "done" && liveAt && (staleOne
            ? t("休市中，顯示 {date} 收盤價（查詢 {time}）", {
                date: `${staleOne.asOfDate.getFullYear()}/${String(staleOne.asOfDate.getMonth()+1).padStart(2,"0")}/${String(staleOne.asOfDate.getDate()).padStart(2,"0")}`,
                time: liveAt.toLocaleTimeString(lang === "en" ? "en-US" : "zh-TW", { hour12: false }),
              })
            : t("已更新 {time}", { time: liveAt.toLocaleTimeString(lang === "en" ? "en-US" : "zh-TW", { hour12: false }) }))}
          {liveStatus === "error" && t("抓取失敗（來源可能暫時壅塞），稍後再試或改用券商 App 查詢")}
        </div>
        <button
          onClick={fetchAllLive}
          disabled={liveStatus === "loading" || !activeHoldings.length}
          className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 flex-shrink-0"
          style={{ background: COLORS.gold, color: COLORS.bg, opacity: (liveStatus === "loading" || !activeHoldings.length) ? 0.5 : 1 }}
        >
          {liveStatus === "loading" ? <Loader2 size={13} className="animate-spin" /> : null}
          {t("抓取即時股價")}
        </button>
      </div>

      {hasLive && (
        <div>
          <div className="grid grid-cols-4 gap-1 text-[10px] pb-1.5 mb-1.5" style={{ color: COLORS.sub, borderBottom: `1px solid ${COLORS.panelBorder}` }}>
            <span>{t("代號")}</span>
            <span className="text-right">{t("股價")}</span>
            <span className="text-right">{t("漲跌幅")}</span>
            <span className="text-right">{t("市值")}</span>
          </div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {rows.map((r) => (
              <div key={r.id}>
                <div className="grid grid-cols-4 gap-1 text-xs mono items-center">
                  <span style={{ color: COLORS.sub }}>{r.symbol}</span>
                  <span className="text-right">{r.price.toFixed(2)}</span>
                  <span className="text-right" style={{ color: r.quoteIsStale ? COLORS.sub : (r.chg >= 0 ? COLORS.gain : COLORS.loss) }}>
                    {r.quoteIsStale && isTwseTradingHours()
                      ? t("待更新")
                      : <>{r.chg >= 0 ? "▲" : "▼"} {r.chgPct >= 0 ? "+" : ""}{r.chgPct.toFixed(2)}%</>}
                  </span>
                  <span className="text-right font-bold">{nf(r.value)}</span>
                </div>
                {!r.quoteIsStale && (
                  <div className="text-xs text-right mt-0.5" style={{ color: r.chg >= 0 ? COLORS.gain : COLORS.loss, opacity: 0.85 }}>
                    {t("今日損益 {sign}{amount}", { sign: r.chg >= 0 ? "+" : "", amount: nf(Math.round(r.chg * r.current)) })}
                  </div>
                )}
                {r.isFromCache && r.fetchedAt && (
                  <div className="text-[9px] text-right mt-0.5" style={{ color: COLORS.sub }}>
                    {t("這次抓取失敗，顯示上次成功價格（{time}）", {
                      time: new Date(r.fetchedAt).toLocaleString(lang === "en" ? "en-US" : "zh-TW", {
                        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
                      }),
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs mono pt-2 mt-2 font-bold" style={{ borderTop: `1px solid ${COLORS.panelBorder}` }}>
            <span style={{ color: COLORS.sub }}>{quoteComplete ? t("今日台股總市值") : t("目前可得市值（部分）")}</span>
            <span style={{ color: COLORS.gold }}>NT$ {nf(totalValue)}</span>
          </div>
          {yesterdayTwValue != null && (
            <>
              <div className="flex justify-between text-xs mono mt-1">
                <span style={{ color: COLORS.sub }}>{t("昨日台股總市值")}</span>
                <span style={{ color: COLORS.sub }}>NT$ {nf(yesterdayTwValue)}</span>
              </div>
              <div className="flex justify-between text-xs mono mt-1 font-bold">
                <span style={{ color: COLORS.sub }}>{t("今/昨日盈虧")}</span>
                {(() => {
                  const diff = totalValue - yesterdayTwValue;
                  const diffPct = yesterdayTwValue ? (diff / yesterdayTwValue) * 100 : 0;
                  const up = diff >= 0;
                  return (
                    <span style={{ color: up ? COLORS.gain : COLORS.loss }}>
                      {up ? "+" : ""}{nf(diff)}（{up ? "+" : ""}{diffPct.toFixed(2)}%）
                    </span>
                  );
                })()}
              </div>
            </>
          )}
          {hasMarketIndex && (
            <>
              <div className="flex justify-between text-xs mono mt-1">
                <span style={{ color: COLORS.sub }}>{t("加權指數")}</span>
                <span style={{ color: indexChange >= 0 ? COLORS.gain : COLORS.loss }}>
                  {nf(Math.round(indexPrice))}　{indexChange >= 0 ? "▲" : "▼"} {indexChangePct >= 0 ? "+" : ""}{indexChangePct.toFixed(2)}%
                </span>
              </div>
              {vsMarketPct != null && (
                <div className="flex justify-between text-xs mono mt-1">
                  <span style={{ color: COLORS.sub }}>{t("今日 vs 大盤")}</span>
                  <span style={{ color: vsMarketPct >= 0 ? COLORS.gain : COLORS.loss }}>
                    {vsMarketPct >= 0 ? t("贏大盤") : t("輸大盤")} {vsMarketPct >= 0 ? "+" : ""}{vsMarketPct.toFixed(2)}%
                  </span>
                </div>
              )}
            </>
          )}
          {onFillDailyTw && (
            <>
              <button onClick={recordToday} disabled={!quoteComplete}
                className="mt-2 w-full rounded-lg py-2 text-[11px] font-bold"
                style={{ background: COLORS.bg, border: `1px solid ${quoteComplete ? COLORS.gold : COLORS.panelBorder}`, color: quoteComplete ? COLORS.gold : COLORS.sub, opacity: quoteComplete ? 1 : 0.6 }}>
                {t("帶入「每日紀錄」台股市值")}
              </button>
              <div className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
                {quoteComplete
                  ? t("會跳到「每日紀錄」並自動填好台股市值，美股記得手動補上再儲存")
                  : t("目前報價不完整：已禁止把部分市值寫入每日紀錄")}
              </div>
            </>
          )}
        </div>
      )}
      {liveStatus === "done" && failedSymbols.length > 0 && (
        <div className="text-[11px] mt-2" style={{ color: COLORS.loss }}>
          {t("抓取失敗：{list}（來源暫時壅塞，可再按一次重試）", { list: failedSymbols.join("、") })}
        </div>
      )}
      {!activeHoldings.length && <Empty text={t("請先到「持股進度」新增持股並填入股數，才能抓取即時股價")} />}
    </Panel>
  );
}

// ---------------- Dashboard ----------------
// Range options for the asset-curve chart. "days: null" means show
// everything. Kept outside the component so the array identity is stable
// across renders (used as a dependency below).

export default LivePricePanel;
export { LivePricePanel };
