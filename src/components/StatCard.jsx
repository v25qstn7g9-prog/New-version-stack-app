import { COLORS } from "../lib/constants.js";
import { Panel } from "./Panel.jsx";

function StatCard({ label, value, tone, className = "" }) {
  const color = tone === "gain" ? COLORS.gain : tone === "loss" ? COLORS.loss : tone === "gold" ? COLORS.gold : COLORS.text;
  return (
    <div className={`rounded-2xl p-4 ${className}`} style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}>
      <div className="text-xs" style={{ color: COLORS.sub }}>{label}</div>
      <div className="text-lg font-bold mono mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

// ---------------- Daily Panel ----------------

export default StatCard;
export { StatCard };
