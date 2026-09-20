import { COLORS } from "../lib/constants.js";

function Panel({ title, children }) {
  return (
    <div className="rounded-2xl p-4" style={{
      background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
      boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
    }}>
      <div className="text-xs font-bold mb-3" style={{ color: COLORS.sub }}>{title}</div>
      {children}
    </div>
  );
}

export default Panel;
export { Panel };
