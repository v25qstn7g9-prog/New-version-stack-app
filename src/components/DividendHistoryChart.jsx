import { useState } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";
import { COLORS } from "../lib/constants.js";
import { nf, colorForSymbol } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";

function DividendHistoryChart({ dividends }) {
  const symbols = [...new Set(dividends.map((d) => d.symbol))].sort();
  const [filter, setFilter] = useState("all");
  if (!dividends.length) return null;

  const isAll = filter === "all";
  let chartData, seriesKeys;

  if (isAll) {
    // 每年一筆，欄位是各代號當年配息加總：{ year, "0056": 12345, "00878": 6789 }
    const byYear = {};
    dividends.forEach((d) => {
      const year = String(d.date).slice(0, 4);
      if (!byYear[year]) byYear[year] = {};
      byYear[year][d.symbol] = (byYear[year][d.symbol] || 0) + Number(d.amount || 0);
    });
    chartData = Object.keys(byYear).sort().map((year) => ({ year, ...byYear[year] }));
    seriesKeys = symbols;
  } else {
    const byYear = {};
    dividends.filter((d) => d.symbol === filter).forEach((d) => {
      const year = String(d.date).slice(0, 4);
      byYear[year] = (byYear[year] || 0) + Number(d.amount || 0);
    });
    chartData = Object.keys(byYear).sort().map((year) => ({ year, amount: byYear[year] }));
    seriesKeys = ["amount"];
  }

  return (
    <Panel title="配息歷史">
      <div className="flex gap-1.5 flex-wrap mb-3">
        {["all", ...symbols].map((s) => {
          const active = filter === s;
          return (
            <button key={s} onClick={() => setFilter(s)}
              className="rounded-lg px-2 py-1 text-[11px] font-bold"
              style={{
                background: active ? COLORS.gold : COLORS.bg,
                color: active ? "#0A0F1C" : COLORS.sub,
                border: `1px solid ${active ? COLORS.gold : COLORS.panelBorder}`,
              }}>
              {s === "all" ? "全部" : s}
            </button>
          );
        })}
      </div>
      <div style={{ height: isAll ? 210 : 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={COLORS.panelBorder} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" tick={{ fontSize: 9, fill: COLORS.sub }} />
            <YAxis tick={{ fontSize: 9, fill: COLORS.sub }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} width={40} />
            <Tooltip
              cursor={false}
              contentStyle={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}`, fontSize: 12 }}
              formatter={(v, name) => [`NT$ ${nf(v)}`, isAll ? name : "配息"]} />
            {isAll && (
              <Legend wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => <span style={{ color: COLORS.sub }}>{value}</span>} />
            )}
            {seriesKeys.map((key, i) => (
              <Bar key={key} dataKey={key} stackId={isAll ? "a" : undefined}
                fill={colorForSymbol(isAll ? key : filter, symbols)}
                activeBar={false}
                radius={i === seriesKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

// ---------------- Dividends Panel ----------------

export default DividendHistoryChart;
export { DividendHistoryChart };
