import { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { TrendingUp, TrendingDown } from "../lib/icons.jsx";
import { COLORS, CHART_RANGES } from "../lib/constants.js";
import { nf, pickEvenTimeTicks, formatTickDate, pf } from "../lib/helpers.js";
import { AnimatedNumber } from "./AnimatedNumber.jsx";
import { NewsCarousel } from "./NewsCarousel.jsx";
import { LivePricePanel } from "./LivePricePanel.jsx";
import { StatCard } from "./StatCard.jsx";

function Dashboard({ totalToday, dailyChange, dailyChangePct, capitalGain, totalDividends,
  totalReturn, totalReturnPct, highPoint, drawdown, ytdGain, ytdPct, chartData, goal, totalInvested, holdings,
  yesterdayTwValue, onFillDailyTw }) {
  const up = dailyChange >= 0;
  // Defaults to "1年" rather than "全部": with 3+ sparse years plotted
  // proportionally to real time (see pickEvenTimeTicks above), the last
  // few months of daily-tracked detail — the part most people check day to
  // day — get compressed into a thin sliver on the full-history view. A
  // shorter default window shows that recent detail first; "全部" is one
  // tap away for anyone who wants the long-term shape.
  const [chartRangeId, setChartRangeId] = useState("1y");
  const rangedChartData = useMemo(() => {
    const range = CHART_RANGES.find((r) => r.id === chartRangeId) || CHART_RANGES[CHART_RANGES.length - 1];
    if (!range.days || chartData.length === 0) return chartData;
    const cutoff = chartData[chartData.length - 1].t - range.days * 24 * 60 * 60 * 1000;
    const filtered = chartData.filter((d) => d.t >= cutoff);
    // If the chosen window is shorter than the data actually goes back
    // (e.g. "1個月" on a brand-new tracker), fall back to everything rather
    // than showing a near-empty chart.
    return filtered.length > 1 ? filtered : chartData;
  }, [chartData, chartRangeId]);
  return (
    <div className="space-y-4">
      <NewsCarousel holdings={holdings} />

      <div className="rounded-2xl p-4" style={{
        background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
        boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
      }}>
        <div className="text-xs" style={{ color: COLORS.sub }}>目前總資產</div>
        <div className="text-3xl font-black mono mt-1"><AnimatedNumber value={totalToday} prefix="NT$ " /></div>
        <div className="flex items-center gap-1 mt-1.5 text-sm mono"
          style={{ color: up ? COLORS.gain : COLORS.loss }}>
          {up ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          {nf(dailyChange)}（{pf(dailyChangePct)}）今日
        </div>
      </div>

      <LivePricePanel holdings={holdings} onFillDailyTw={onFillDailyTw} yesterdayTwValue={yesterdayTwValue} />

      {chartData.length > 1 && (
        <div className="rounded-2xl p-4" style={{
          background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
          boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
        }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs" style={{ color: COLORS.sub }}>資產曲線</div>
            <div className="flex gap-1">
              {CHART_RANGES.map((r) => {
                const active = chartRangeId === r.id;
                return (
                  <button key={r.id} onClick={() => setChartRangeId(r.id)}
                    className="rounded-lg px-1.5 py-1 text-[10px] font-bold whitespace-nowrap"
                    style={{
                      background: active ? COLORS.gold : COLORS.bg,
                      color: active ? "#0A0F1C" : COLORS.sub,
                      border: `1px solid ${active ? COLORS.gold : COLORS.panelBorder}`,
                    }}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rangedChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={COLORS.panelBorder} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]}
                  tick={{ fontSize: 9, fill: COLORS.sub }}
                  ticks={pickEvenTimeTicks(rangedChartData, "t", 6)} tickFormatter={formatTickDate} />
                <YAxis tick={{ fontSize: 9, fill: COLORS.sub }}
                  tickFormatter={(v) => `${(v / 10000).toFixed(0)}萬`} width={44} />
                <Tooltip
                  labelFormatter={formatTickDate}
                  contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}`, fontSize: 12 }}
                  formatter={(v) => [`NT$ ${nf(v)}`, "總資產"]} />
                <ReferenceLine y={goal.targetAmount} stroke={COLORS.gold} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="total" stroke={COLORS.gold} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="持倉損益(估)" value={`NT$ ${nf(capitalGain)}`} tone={capitalGain >= 0 ? "gain" : "loss"} />
        <StatCard label="累積股息" value={`NT$ ${nf(totalDividends)}`} tone="gold" />
        <StatCard label="粗估總報酬" value={`NT$ ${nf(totalReturn)}`} tone={totalReturn >= 0 ? "gain" : "loss"} />
        <StatCard label="粗估報酬率" value={pf(totalReturnPct)} tone={totalReturnPct >= 0 ? "gain" : "loss"} />
        <StatCard label="今年資產變化(YTD)" value={`${nf(ytdGain)}（${pf(ytdPct)}）`} tone={ytdGain >= 0 ? "gain" : "loss"} className="col-span-2" />
      </div>
      <div className="text-[11px] px-1" style={{ color: COLORS.sub }}>
        註：目前成本來自券商/每日紀錄的持倉成本；若曾賣出、換股或用股息再投入，
        「粗估總報酬」不等同完整 XIRR 或全期間真實總報酬。
      </div>

      <div className="rounded-2xl p-4" style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
        <div className="text-xs mb-2" style={{ color: COLORS.sub }}>資產高點</div>
        <div className="flex justify-between text-sm mono">
          <span style={{ color: COLORS.sub }}>{highPoint.date || "—"}</span>
          <span>NT$ {nf(highPoint.value === -Infinity ? 0 : highPoint.value)}</span>
        </div>
        <div className="flex justify-between text-sm mono mt-1">
          <span style={{ color: COLORS.sub }}>回撤率</span>
          <span style={{ color: drawdown < 0 ? COLORS.loss : COLORS.text }}>{pf(drawdown)}</span>
        </div>
        <div className="flex justify-between text-sm mono mt-1">
          <span style={{ color: COLORS.sub }}>目前持倉成本</span>
          <span>NT$ {nf(totalInvested)}</span>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
export { Dashboard };
