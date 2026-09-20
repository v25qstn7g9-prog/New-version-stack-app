import { COLORS } from "../lib/constants.js";

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] mb-1" style={{ color: COLORS.sub }}>{label}</div>
      {children}
      <style>{`
        .input {
          width: 100%; background: ${COLORS.bg}; border: 1px solid ${COLORS.panelBorder};
          color: ${COLORS.text}; border-radius: 10px; padding: 8px 10px; font-size: 13px;
          outline: none; font-family: 'JetBrains Mono', monospace;
        }
        .input:focus { border-color: ${COLORS.gold}; }
      `}</style>
    </label>
  );
}

export default Field;
export { Field };
