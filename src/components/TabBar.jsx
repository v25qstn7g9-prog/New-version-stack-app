import { TABS, COLORS } from "../lib/constants.js";

function TabBar({ tab, setTab, rootRef }) {
  return (
    <div ref={rootRef} className="fixed bottom-0 left-0 right-0"
      style={{
        background: COLORS.panel, borderTop: `1px solid ${COLORS.panelBorder}`,
        paddingBottom: "env(safe-area-inset-bottom, 4px)",
      }}>
      <div className="max-w-2xl mx-auto flex">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button key={id} onClick={() => setTab(id)}
              className="flex-1 flex flex-col items-center justify-center gap-0 py-0.5 px-0.5 min-w-0"
              style={{
                color: active ? COLORS.gold : COLORS.sub,
                borderTop: active ? `2px solid ${COLORS.gold}` : "2px solid transparent",
              }}>
              <Icon size={13} />
              <span className="text-[8px] font-medium whitespace-nowrap leading-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- defaults (first run) ----------------
// 【家人共用版】以下這幾個 default* 都改成空白起始狀態，不含任何真實個人資料，
// 給第一次打開這個網址（localStorage 是空的）的人一個乾淨畫面，自己填自己的。

export default TabBar;
export { TabBar };
