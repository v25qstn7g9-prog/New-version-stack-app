import { Plus } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";

function AddButton({ onClick, label }) {
  return (
    <button onClick={onClick} className="mt-3 w-full flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold"
      style={{ background: COLORS.gold, color: "#0A0F1C" }}>
      <Plus size={16} /> {label}
    </button>
  );
}

export default AddButton;
export { AddButton };
