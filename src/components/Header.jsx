import { APP_VERSION, COLORS } from "../lib/constants.js";
import { nf } from "../lib/helpers.js";
import { useLanguage } from "../lib/i18n.jsx";

function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "zh" : "en")}
      className="text-[11px] font-black rounded-full px-2.5 py-1 flex-shrink-0"
      style={{ color: COLORS.bg, background: COLORS.gold }}
      aria-label={lang === "en" ? "Switch to Chinese" : "切換為英文"}
      title={lang === "en" ? "Switch to Chinese" : "切換為英文"}
    >
      {lang === "en" ? "中" : "EN"}
    </button>
  );
}

function Header({ goal, totalToday, goalDate, backupOverdue, backupAgeDays }) {
  const { t } = useLanguage();
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
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-black tracking-tight min-w-0" style={{ color: COLORS.gold }}>
            {t("存股資產追蹤")}
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs mono" style={{ color: COLORS.sub }}>
              {t("目標")} {goal.targetYear} · {nf(goal.targetAmount)}
            </span>
            <LanguageToggle />
          </div>
        </div>
        <div className="text-[10px] font-medium" style={{ color: COLORS.sub }}>v{APP_VERSION}</div>
        <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.panel }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: COLORS.gold }} />
        </div>
        <div className="mt-1 flex items-baseline justify-between text-[11px] mono" style={{ color: COLORS.sub }}>
          <span>{t("距目標 NT${amount}（已達成 {pct}%）", { amount: nf(remain), pct: pct.toFixed(1) })}</span>
          {goalDate && <span style={{ color: COLORS.gold }}>{t("預計 {date} 達成", { date: goalDate })}</span>}
        </div>
        {backupOverdue && (
          <div className="mt-2 rounded-lg px-2.5 py-1.5 text-[10px] font-bold"
            style={{ color: COLORS.gold, background: COLORS.panel, border: `1px solid ${COLORS.gold}` }}>
            🔐 {t("備份提醒")}：{backupAgeDays == null ? t("尚未記錄 JSON 備份") : t("上次備份已 {days} 天前", { days: backupAgeDays })}，{t("建議到「計畫設定」匯出一份。")}
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
