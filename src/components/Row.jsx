import { TrashIcon } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";

function Row({ children, onDelete }) {
  return (
    <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
      {children}
      <button onClick={onDelete} style={{ color: COLORS.sub }}><TrashIcon size={14} /></button>
    </div>
  );
}

export default Row;
export { Row };
