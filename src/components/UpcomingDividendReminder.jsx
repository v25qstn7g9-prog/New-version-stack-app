import { useState, useEffect } from "react";
import { COLORS } from "../lib/constants.js";
import { todayStr, fetchWithTimeout } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";

function UpcomingDividendReminder({ holdings }) {
  const symbols = [...new Set(
    holdings.filter((h) => Number(h.current || 0) > 0 && h.symbol).map((h) => h.symbol)
  )];
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(symbols.length ? "loading" : "idle");

  useEffect(() => {
    if (!symbols.length) { setStatus("idle"); setItems([]); return; }
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetchWithTimeout(
          `/dividend-schedule?symbols=${encodeURIComponent(symbols.join(","))}`, { cache: "no-store" }, 8000
        );
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.ok) { setStatus("error"); return; }
        const today = todayStr();
        const upcoming = (data.results || [])
          .filter((r) => r.found && r.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        setItems(upcoming);
        setStatus("done");
      } catch (e) {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [symbols.join(",")]);

  if (status === "idle" || status === "error") return null;
  if (status === "loading") {
    return (
      <Panel title="近期除息">
        <div className="text-xs" style={{ color: COLORS.sub }}>查詢中…</div>
      </Panel>
    );
  }
  if (!items.length) return null; // 沒有即將除息的持股，安靜不顯示這個區塊

  const daysUntil = (dateStr) => {
    const diff = (new Date(dateStr) - new Date(todayStr())) / (1000 * 60 * 60 * 24);
    return Math.round(diff);
  };

  return (
    <Panel title="近期除息">
      <div className="space-y-2">
        {items.map((r) => {
          const days = daysUntil(r.date);
          return (
            <div key={r.symbol} className="flex items-center justify-between text-sm">
              <div className="mono">{r.symbol}{r.name ? ` · ${r.name}` : ""}</div>
              <div className="text-right">
                <span className="mono" style={{ color: COLORS.gold }}>{r.date}</span>
                <span className="text-[11px] ml-1" style={{ color: COLORS.sub }}>
                  {days === 0 ? "就是今天" : `還有 ${days} 天`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// 配息歷史圖表：依股票代號篩選（或看全部加總），用長條圖看每年配息
// 金額的變化。資料完全來自使用者自己輸入過的配息紀錄，不用額外打 API。
// 選「全部」時改成依股票代號分色的堆疊圖，可以看出當年配息主要來自哪一檔；
// 選特定代號時就是單純的單色長條圖。

export default UpcomingDividendReminder;
export { UpcomingDividendReminder };
