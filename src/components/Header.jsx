import { APP_VERSION, COLORS } from "../lib/constants.js";
import { nf } from "../lib/helpers.js";

function Header({ goal, totalToday, goalDate, backupOverdue, backupAgeDays }) {
  const remain = Math.max(0, goal.targetAmount - totalToday);
  const pct = Math.min(100, (totalToday / goal.targetAmount) * 100);
  return (
    <div
      className="px-4 pb-3"
      style={{
        borderBottom: `1px solid ${COLORS.panelBorder}`,
        // Header padding-top only needs to clear the safe-area notch/Dynamic
        // Island, not reproduce its full height as blank space above the
        // title. `env(safe-area-inset-top)` on iPhones with a notch/Dynamic
        // Island is typically 44–59px — subtracting only 4px left roughly a
        // line and a half of dead space above "存股資產追蹤". Subtracting
        // more claws that back, while `max(4px, ...)` keeps a small minimum
        // gap on devices with zero safe-area inset (Android, older iPhones)
        // so the title never touches the very top edge.
        paddingTop: "max(4px, calc(env(safe-area-inset-top, 0px) - 20px))",
      }}
    >
      <div className="max-w-2xl mx-auto">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-black tracking-tight" style={{ color: COLORS.gold }}>
            存股資產追蹤 <span className="text-[10px] font-medium" style={{ color: COLORS.sub }}>v{APP_VERSION}</span>
          </h1>
          <span className="text-xs mono" style={{ color: COLORS.sub }}>
            目標 {goal.targetYear} · {nf(goal.targetAmount)}
          </span>
        </div>
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.panel }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS.gold }} />
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[11px] mono" style={{ color: COLORS.sub }}>
          <span>距目標 NT${nf(remain)}（已達成 {pct.toFixed(1)}%）</span>
          {goalDate && <span style={{ color: COLORS.gold }}>預計 {goalDate} 達成</span>}
        </div>
        {backupOverdue && (
          <div className="mt-2 rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
            style={{ color: COLORS.gold, background: COLORS.panel, border: `1px solid ${COLORS.gold}` }}>
            🔐 備份提醒：{backupAgeDays == null ? "尚未記錄 JSON 備份" : `上次備份已 ${backupAgeDays} 天前`}，建議到「計畫設定」匯出一份。
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- News Carousel (dashboard) ----------------
// 只顯示「今天有新消息」的持股，逐則輪播；完全沒有任何新消息時整張卡片不渲染。

export default Header;
export { Header };
