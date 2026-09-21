import { COLORS } from "../lib/constants.js";
import { nf, addMonths } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { useLanguage } from "../lib/i18n.jsx";

function ProgressPanel({ planSchedule, setPlanSchedule, planTotal, schedule, totalInvested, totalToday,
  principalCrossing, assetCrossing, elapsedMonths, costLeadMonths, assetLeadMonths }) {
  const { t } = useLanguage();

  const principalDate = principalCrossing ? addMonths(planSchedule.startDate, principalCrossing.index) : "—";
  const assetDate = assetCrossing ? addMonths(planSchedule.startDate, assetCrossing.index) : "—";
  const principalBeyond = principalCrossing?.beyond;
  const assetBeyond = assetCrossing?.beyond;

  return (
    <div className="space-y-4">
      <Panel title={t("計畫進度追蹤")}>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <div className="text-[11px]" style={{ color: COLORS.sub }}>{t("成本進度")}</div>
            <div className="text-lg font-bold mono mt-1">{principalDate}{principalBeyond ? "+" : ""}</div>
            <div className="text-[11px] mono mt-1" style={{ color: COLORS.sub }}>
              {t("目前持倉成本 NT$ {amount}", { amount: nf(totalInvested) })}
            </div>
          </div>
          <div className="rounded-xl p-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <div className="text-[11px]" style={{ color: COLORS.sub }}>{t("資產進度")}</div>
            <div className="text-lg font-bold mono mt-1">{assetDate}{assetBeyond ? "+" : ""}</div>
            <div className="text-[11px] mono mt-1" style={{ color: COLORS.sub }}>
              {t("實際資產 NT$ {amount}", { amount: nf(totalToday) })}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <span className="text-[11px]" style={{ color: COLORS.sub }}>{t("成本進度 vs 已執行月數")}</span>
            <span className="text-lg font-bold mono mt-1"
              style={{ color: costLeadMonths == null ? COLORS.text : (costLeadMonths >= 0 ? COLORS.gain : COLORS.loss) }}>
              {costLeadMonths == null ? "—" : t("{sign}{n} 個月", { sign: costLeadMonths >= 0 ? "+" : "", n: costLeadMonths.toFixed(1) })}
            </span>
            <span className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
              {costLeadMonths == null ? "" : (costLeadMonths >= 0 ? t("投入節奏領先計畫") : t("投入節奏落後計畫"))}
            </span>
          </div>
          <div className="rounded-xl p-3 flex flex-col justify-between" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <span className="text-[11px]" style={{ color: COLORS.sub }}>{t("資產進度 vs 已執行月數")}</span>
            <span className="text-lg font-bold mono mt-1"
              style={{ color: assetLeadMonths == null ? COLORS.text : (assetLeadMonths >= 0 ? COLORS.gain : COLORS.loss) }}>
              {assetLeadMonths == null ? "—" : t("{sign}{n} 個月", { sign: assetLeadMonths >= 0 ? "+" : "", n: assetLeadMonths.toFixed(1) })}
            </span>
            <span className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
              {assetLeadMonths == null ? "" : (assetLeadMonths >= 0 ? t("資產成長領先假設報酬率") : t("資產成長落後假設報酬率"))}
            </span>
          </div>
        </div>
        <div className="mt-2 text-[11px] mono" style={{ color: COLORS.sub }}>
          {t("計畫已執行約 {n} 個月（自 {date}）", { n: elapsedMonths.toFixed(1), date: planSchedule.startDate })}
        </div>
        {(principalBeyond || assetBeyond) && (
          <div className="mt-2 text-[11px]" style={{ color: COLORS.gold }}>
            {t("已超出目前推算年限，請拉長下方「推算年限」以看到精確月份。")}
          </div>
        )}
      </Panel>

      <Panel title={t("計畫參數設定")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("計畫開始日")}><input type="date" value={planSchedule.startDate}
            onChange={(e) => setPlanSchedule({ ...planSchedule, startDate: e.target.value })}
            className="input" /></Field>
          <Field label={t("起始本金")}><input type="number" value={planSchedule.initialPrincipal ?? planSchedule.initialCapital}
            onChange={(e) => setPlanSchedule({ ...planSchedule, initialPrincipal: Number(e.target.value), initialCapital: Number(e.target.value) })}
            className="input" /></Field>
          <Field label={t("起始資產")}><input type="number" value={planSchedule.initialAssets ?? planSchedule.initialCapital}
            onChange={(e) => setPlanSchedule({ ...planSchedule, initialAssets: Number(e.target.value) })}
            className="input" /></Field>
          <Field label={t("每月投入金額")}>
            <input type="number" value={planSchedule.monthlyAmount}
              onChange={(e) => setPlanSchedule({ ...planSchedule, monthlyAmount: Number(e.target.value) })}
              className="input" />
          </Field>
          <Field label={t("假設年化報酬率(%)")}><input type="number" step="0.1" value={planSchedule.annualReturn}
            onChange={(e) => setPlanSchedule({ ...planSchedule, annualReturn: Number(e.target.value) })}
            className="input" /></Field>
          <div className="col-span-2">
            <Field label={t("推算年限(年)")}><input type="number" value={planSchedule.horizonMonths / 12}
              onChange={(e) => setPlanSchedule({ ...planSchedule, horizonMonths: Number(e.target.value) * 12 })}
              className="input" /></Field>
          </div>
        </div>
        <button onClick={() => setPlanSchedule({ ...planSchedule, monthlyAmount: planTotal })}
          className="mt-3 w-full rounded-xl py-2 text-xs font-bold"
          style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}`, color: COLORS.gold }}>
          {t("帶入「計畫設定」目前每月定期定額合計（NT$ {amount}）", { amount: nf(planTotal) })}
        </button>
      </Panel>

      <Panel title={t("每月本金與資產推算（共 {n} 筆）", { n: schedule.length })}>
        <div className="grid grid-cols-4 gap-1 text-[10px] font-bold px-2 pb-1.5" style={{ color: COLORS.sub }}>
          <div>{t("月份")}</div>
          <div className="text-right">{t("累積本金")}</div>
          <div className="text-right">{t("推算資產")}</div>
          <div className="text-right">{t("資產-本金")}</div>
        </div>
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {schedule.map((row) => {
            const isCurrent = Math.round(elapsedMonths) === row.index;
            const gap = row.assets - row.principal;
            return (
              <div key={row.index}
                className="grid grid-cols-4 gap-1 rounded-lg px-2 py-1.5 text-[11px] mono items-center"
                style={{
                  background: isCurrent ? "rgba(201,162,75,0.12)" : COLORS.bg,
                  border: `1px solid ${isCurrent ? COLORS.gold : COLORS.panelBorder}`,
                }}>
                <div style={{ color: isCurrent ? COLORS.gold : COLORS.text }}>
                  {row.index === 0 ? t("起點") : addMonths(planSchedule.startDate, row.index)}
                  {isCurrent && <span className="ml-1 text-[9px]" style={{ color: COLORS.gold }}>●{t("目前")}</span>}
                </div>
                <div className="text-right" style={{ color: COLORS.sub }}>{nf(row.principal)}</div>
                <div className="text-right">{nf(row.assets)}</div>
                <div className="text-right" style={{ color: gap >= 0 ? COLORS.gain : COLORS.loss }}>
                  {gap >= 0 ? "+" : ""}{nf(gap)}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- shared bits ----------------

export default ProgressPanel;
export { ProgressPanel };
