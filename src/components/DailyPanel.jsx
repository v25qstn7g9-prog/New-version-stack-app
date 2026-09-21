import { useState, useEffect } from "react";
import { COLORS } from "../lib/constants.js";
import { uid, todayStr, nf } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { AddButton } from "./AddButton.jsx";
import { Row } from "./Row.jsx";
import { Empty } from "./Empty.jsx";
import { useLanguage } from "../lib/i18n.jsx";

function DailyPanel({ records, setRecords, prefill, form, setForm }) {
  const { t } = useLanguage();
  // When "帶入「每日紀錄」..." is pressed elsewhere in the app, prefill is
  // set to a fresh object each time — that reference change is what makes
  // this effect fire again even if the same value is sent twice. Only the
  // fields actually present on prefill get overwritten, so the market-value
  // button and the cost-basis button can each fill in just their own field.
  useEffect(() => {
    if (!prefill) return;
    setForm((f) => {
      const next = { ...f, date: todayStr() };
      if (prefill.twValue != null) next.twValue = String(prefill.twValue);
      if (prefill.twCost != null) next.twCost = String(prefill.twCost);
      return next;
    });
  }, [prefill]);
  const add = () => {
    const sameDayExists = records.some((x) => x.date === form.date);
    if (!sameDayExists && !form.twValue && !form.usValue) return;
    if (!form.twValue && !form.usValue && !form.twCost && !form.usCost) return;
    setRecords((r) => {
      const existing = r.find((x) => x.date === form.date);
      const keepOrNumber = (raw, key) => raw === "" || raw == null
        ? Number(existing?.[key] || 0)
        : Number(raw);
      const filtered = r.filter((x) => x.date !== form.date);
      return [...filtered, {
        id: existing?.id || uid(), date: form.date,
        twValue: keepOrNumber(form.twValue, "twValue"), usValue: keepOrNumber(form.usValue, "usValue"),
        twCost: keepOrNumber(form.twCost, "twCost"), usCost: keepOrNumber(form.usCost, "usCost"),
      }].sort((a, b) => a.date.localeCompare(b.date));
    });
    setForm({ date: todayStr(), twValue: "", usValue: "", twCost: "", usCost: "" });
  };
  const remove = (id) => setRecords((r) => r.filter((x) => x.id !== id));
  const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const reversed = [...sortedRecords].reverse();

  // Monthly summary: for each month, compare the last record of that month
  // against the last record before it (i.e. the prior month's closing
  // value) to get that month's gain/loss and return %. The very first
  // month in the whole history has no "before" record to compare against,
  // so it's left blank rather than showing a misleading 0%/100%.
  const monthlyStats = {};
  const monthKey = (d) => d.slice(0, 7); // "YYYY-MM"
  let lastSeenPerMonth = {};
  sortedRecords.forEach((r) => { lastSeenPerMonth[monthKey(r.date)] = r; });
  const monthKeys = Object.keys(lastSeenPerMonth).sort();
  monthKeys.forEach((mk, i) => {
    const endRec = lastSeenPerMonth[mk];
    const endValue = endRec.twValue + endRec.usValue;
    const endCost = (endRec.twCost || 0) + (endRec.usCost || 0);
    const prevMk = i > 0 ? monthKeys[i - 1] : null;
    if (!prevMk) { monthlyStats[mk] = null; return; }
    const startRec = lastSeenPerMonth[prevMk];
    const startValue = startRec.twValue + startRec.usValue;
    const startCost = (startRec.twCost || 0) + (startRec.usCost || 0);
    // Market return isolates actual investment performance from money you
    // added that month: compare unrealized gain (value − cost) at the
    // start vs end of the month, instead of comparing raw asset value
    // (which would count new contributions as if they were investment
    // gains). Contribution is the month's own number: how much your cost
    // basis grew, i.e. how much new money went in.
    // This only works if BOTH ends of the month have real cost data. If
    // cost tracking started partway through your history, one side will
    // read as 0 (not "genuinely zero cost", just "not filled in yet") —
    // using it anyway would misread that as a huge fake gain/loss for
    // whichever month straddles that transition. Fall back to the plain
    // value-based estimate for exactly that month instead.
    const hasCostBothEnds = startCost > 0 && endCost > 0;
    let marketReturn, pct, contribution;
    if (hasCostBothEnds) {
      marketReturn = (endValue - endCost) - (startValue - startCost);
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = endCost - startCost;
    } else {
      marketReturn = endValue - startValue;
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = null; // unknown split between market move and new money
    }
    monthlyStats[mk] = { marketReturn, pct, contribution, approximate: !hasCostBothEnds };
  });

  // Yearly summary: same market-return / contribution split as monthly
  // above, just grouped by year instead of month. Reuses the exact same
  // logic (and the same "no cost data on one side" fallback) so the
  // numbers here are directly comparable to the monthly breakdown.
  const yearlyStats = {};
  const yearKey = (d) => d.slice(0, 4); // "YYYY"
  let lastSeenPerYear = {};
  records.forEach((r) => { lastSeenPerYear[yearKey(r.date)] = r; });
  const yearKeys = Object.keys(lastSeenPerYear).sort();
  yearKeys.forEach((yk, i) => {
    const endRec = lastSeenPerYear[yk];
    const endValue = endRec.twValue + endRec.usValue;
    const endCost = (endRec.twCost || 0) + (endRec.usCost || 0);
    const prevYk = i > 0 ? yearKeys[i - 1] : null;
    if (!prevYk) { yearlyStats[yk] = null; return; }
    const startRec = lastSeenPerYear[prevYk];
    const startValue = startRec.twValue + startRec.usValue;
    const startCost = (startRec.twCost || 0) + (startRec.usCost || 0);
    const hasCostBothEnds = startCost > 0 && endCost > 0;
    let marketReturn, pct, contribution;
    if (hasCostBothEnds) {
      marketReturn = (endValue - endCost) - (startValue - startCost);
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = endCost - startCost;
    } else {
      marketReturn = endValue - startValue;
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = null;
    }
    yearlyStats[yk] = { marketReturn, pct, contribution, approximate: !hasCostBothEnds };
  });

  // Weekly summary: same market-return / contribution split as monthly and
  // yearly above, just grouped by ISO week (Monday-start) instead. Shown as
  // a horizontally swipeable strip of compact cards rather than a vertical
  // list — a full year of weekly data would make an very long list, and
  // weekly numbers are usually small day-to-day noise that's more useful to
  // skim sideways a few at a time than to scroll through in bulk.
  const mondayOf = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  };
  const weeklyStats = {};
  const weekKey = (d) => mondayOf(d);
  let lastSeenPerWeek = {};
  records.forEach((r) => { lastSeenPerWeek[weekKey(r.date)] = r; });
  const weekKeys = Object.keys(lastSeenPerWeek).sort();
  weekKeys.forEach((wk, i) => {
    const endRec = lastSeenPerWeek[wk];
    const endValue = endRec.twValue + endRec.usValue;
    const endCost = (endRec.twCost || 0) + (endRec.usCost || 0);
    const prevWk = i > 0 ? weekKeys[i - 1] : null;
    if (!prevWk) { weeklyStats[wk] = null; return; }
    const startRec = lastSeenPerWeek[prevWk];
    const startValue = startRec.twValue + startRec.usValue;
    const startCost = (startRec.twCost || 0) + (startRec.usCost || 0);
    const hasCostBothEnds = startCost > 0 && endCost > 0;
    let marketReturn, pct, contribution;
    if (hasCostBothEnds) {
      marketReturn = (endValue - endCost) - (startValue - startCost);
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = endCost - startCost;
    } else {
      marketReturn = endValue - startValue;
      pct = startValue ? (marketReturn / startValue) * 100 : 0;
      contribution = null;
    }
    weeklyStats[wk] = { marketReturn, pct, contribution, approximate: !hasCostBothEnds };
  });
  const weekLabel = (wk) => {
    const start = new Date(wk + "T00:00:00");
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    return `${fmt(start)}-${fmt(end)}`;
  };

  // 自訂區間查詢：找「這天或更早最近一筆」的紀錄來比對，因為使用者不一定每天都記錄，
  // 直接要求剛好命中那天太嚴格；用程式碼算，100% 準確，不會有 AI 抄錯數字的風險。
  const findRecordAtOrBefore = (dateStr) => {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    let found = null;
    for (const r of sorted) {
      if (r.date <= dateStr) found = r; else break;
    }
    return found;
  };
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const rangeResult = (rangeFrom && rangeTo) ? (() => {
    const fromRec = findRecordAtOrBefore(rangeFrom);
    const toRec = findRecordAtOrBefore(rangeTo);
    if (!fromRec || !toRec) return { error: t("這個區間找不到對應的紀錄") };
    const fromValue = fromRec.twValue + fromRec.usValue;
    const toValue = toRec.twValue + toRec.usValue;
    const fromCost = (fromRec.twCost || 0) + (fromRec.usCost || 0);
    const toCost = (toRec.twCost || 0) + (toRec.usCost || 0);
    return {
      fromRec, toRec, fromValue, toValue, fromCost, toCost,
      assetChange: toValue - fromValue,
      costChange: toCost - fromCost,
      gainChange: (toValue - toCost) - (fromValue - fromCost),
      twValueChange: (toRec.twValue || 0) - (fromRec.twValue || 0),
      usValueChange: (toRec.usValue || 0) - (fromRec.usValue || 0),
      twCostChange: (toRec.twCost || 0) - (fromRec.twCost || 0),
      usCostChange: (toRec.usCost || 0) - (fromRec.usCost || 0),
    };
  })() : null;

  return (
    <div className="space-y-4">
      <Panel title={t("新增每日紀錄")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("日期")}><input type="date" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="input" /></Field>
          <div />
          <Field label={t("台股市值")}><input type="number" value={form.twValue}
            onChange={(e) => setForm({ ...form, twValue: e.target.value })}
            placeholder="0" className="input" /></Field>
          <Field label={t("美股市值")}><input type="number" value={form.usValue}
            onChange={(e) => setForm({ ...form, usValue: e.target.value })}
            placeholder="0" className="input" /></Field>
          <Field label={t("台股成本")}><input type="number" value={form.twCost}
            onChange={(e) => setForm({ ...form, twCost: e.target.value })}
            placeholder="0" className="input" /></Field>
          <Field label={t("美股成本")}><input type="number" value={form.usCost}
            onChange={(e) => setForm({ ...form, usCost: e.target.value })}
            placeholder="0" className="input" /></Field>
        </div>
        <AddButton onClick={add} label={t("儲存紀錄")} />
      </Panel>

      <Panel title={t("區間查詢（精算，非AI）")}>
        <div className="text-[11px] mb-2" style={{ color: COLORS.sub }}>
          {t("選兩個日期，直接用你的原始紀錄計算資產/本金/損益變化，數字保證準確")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("起始日期")}><input type="date" value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)} className="input" /></Field>
          <Field label={t("結束日期")}><input type="date" value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)} className="input" /></Field>
        </div>
        {rangeResult && rangeResult.error && (
          <div className="text-xs mt-2" style={{ color: COLORS.loss }}>{rangeResult.error}</div>
        )}
        {rangeResult && !rangeResult.error && (
          <div className="mt-3 space-y-1.5 text-sm mono rounded-lg px-3 py-2.5"
            style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <div className="text-[10px]" style={{ color: COLORS.sub }}>
              {t("實際比對：{from}（起）→ {to}（迄）", { from: rangeResult.fromRec.date, to: rangeResult.toRec.date })}
              {(rangeResult.fromRec.date !== rangeFrom || rangeResult.toRec.date !== rangeTo)
                ? t("（其中一天沒有剛好的紀錄，取最近一筆較早的紀錄代替）") : ""}
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("總市值變化")}</span>
              <span className="font-bold" style={{ color: rangeResult.assetChange >= 0 ? COLORS.gain : COLORS.loss }}>
                {rangeResult.assetChange >= 0 ? "+" : ""}{nf(rangeResult.assetChange)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("總本金變化")}</span>
              <span className="font-bold" style={{ color: COLORS.gold }}>
                {rangeResult.costChange >= 0 ? "+" : ""}{nf(rangeResult.costChange)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("損益變化（市場報酬）")}</span>
              <span className="font-bold" style={{ color: rangeResult.gainChange >= 0 ? COLORS.gain : COLORS.loss }}>
                {rangeResult.gainChange >= 0 ? "+" : ""}{nf(rangeResult.gainChange)}
              </span>
            </div>
            <div style={{ borderTop: `1px solid ${COLORS.panelBorder}`, margin: "6px 0" }} />
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("台股市值變化")}</span>
              <span className="font-bold" style={{ color: rangeResult.twValueChange >= 0 ? COLORS.gain : COLORS.loss }}>
                {rangeResult.twValueChange >= 0 ? "+" : ""}{nf(rangeResult.twValueChange)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("台股本金變化")}</span>
              <span className="font-bold" style={{ color: COLORS.gold }}>
                {rangeResult.twCostChange >= 0 ? "+" : ""}{nf(rangeResult.twCostChange)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("美股市值變化")}</span>
              <span className="font-bold" style={{ color: rangeResult.usValueChange >= 0 ? COLORS.gain : COLORS.loss }}>
                {rangeResult.usValueChange >= 0 ? "+" : ""}{nf(rangeResult.usValueChange)}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: COLORS.sub }}>{t("美股本金變化")}</span>
              <span className="font-bold" style={{ color: COLORS.gold }}>
                {rangeResult.usCostChange >= 0 ? "+" : ""}{nf(rangeResult.usCostChange)}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {weekKeys.length > 0 && (
        <Panel title={t("週度損益")}>
          {weekKeys.some((wk) => weeklyStats[wk]?.approximate) && (
            <div className="text-[10px] mb-2" style={{ color: COLORS.sub }}>
              {t("* 成本資料不完整的週份，市場報酬與新增投入無法精準拆分，數字為粗估")}
            </div>
          )}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {[...weekKeys].reverse().map((wk) => {
              const stat = weeklyStats[wk];
              return (
                <div key={wk} className="rounded-lg px-3 py-2 text-xs mono"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
                  <div className="flex justify-between items-baseline">
                    <span style={{ color: COLORS.sub }}>{weekLabel(wk)}{stat?.approximate ? " *" : ""}</span>
                    {stat ? (
                      <span className="font-bold" style={{ color: stat.marketReturn >= 0 ? COLORS.gain : COLORS.loss }}>
                        {t("市場 {sign}{amount}（{pctSign}{pct}%）", { sign: stat.marketReturn >= 0 ? "+" : "", amount: nf(stat.marketReturn), pctSign: stat.pct >= 0 ? "+" : "", pct: stat.pct.toFixed(2) })}
                      </span>
                    ) : (
                      <span style={{ color: COLORS.sub }}>{t("最早紀錄，無前週可比較")}</span>
                    )}
                  </div>
                  {stat && stat.contribution != null && stat.contribution !== 0 && (
                    <div className="text-right mt-0.5" style={{ color: COLORS.gold }}>
                      {t("新增投入 {sign}{amount}", { sign: stat.contribution >= 0 ? "+" : "", amount: nf(stat.contribution) })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {monthKeys.length > 0 && (
        <Panel title={t("月度損益")}>
          {monthKeys.some((mk) => monthlyStats[mk]?.approximate) && (
            <div className="text-[10px] mb-2" style={{ color: COLORS.sub }}>
              {t("* 成本資料不完整的月份，市場報酬與新增投入無法精準拆分，數字為粗估")}
            </div>
          )}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {[...monthKeys].reverse().map((mk) => {
              const stat = monthlyStats[mk];
              return (
                <div key={mk} className="rounded-lg px-3 py-2 text-xs mono"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
                  <div className="flex justify-between items-baseline">
                    <span style={{ color: COLORS.sub }}>{mk}{stat?.approximate ? " *" : ""}</span>
                    {stat ? (
                      <span className="font-bold" style={{ color: stat.marketReturn >= 0 ? COLORS.gain : COLORS.loss }}>
                        {t("市場 {sign}{amount}（{pctSign}{pct}%）", { sign: stat.marketReturn >= 0 ? "+" : "", amount: nf(stat.marketReturn), pctSign: stat.pct >= 0 ? "+" : "", pct: stat.pct.toFixed(2) })}
                      </span>
                    ) : (
                      <span style={{ color: COLORS.sub }}>{t("最早紀錄，無前月可比較")}</span>
                    )}
                  </div>
                  {stat && stat.contribution != null && stat.contribution !== 0 && (
                    <div className="text-right mt-0.5" style={{ color: COLORS.gold }}>
                      {t("新增投入 {sign}{amount}", { sign: stat.contribution >= 0 ? "+" : "", amount: nf(stat.contribution) })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {yearKeys.length > 0 && (
        <Panel title={t("年度損益")}>
          {yearKeys.some((yk) => yearlyStats[yk]?.approximate) && (
            <div className="text-[10px] mb-2" style={{ color: COLORS.sub }}>
              {t("* 成本資料不完整的年份，市場報酬與新增投入無法精準拆分，數字為粗估")}
            </div>
          )}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {[...yearKeys].reverse().map((yk) => {
              const stat = yearlyStats[yk];
              return (
                <div key={yk} className="rounded-lg px-3 py-2 text-xs mono"
                  style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
                  <div className="flex justify-between items-baseline">
                    <span style={{ color: COLORS.sub }}>{yk}{stat?.approximate ? " *" : ""}</span>
                    {stat ? (
                      <span className="font-bold" style={{ color: stat.marketReturn >= 0 ? COLORS.gain : COLORS.loss }}>
                        {t("市場 {sign}{amount}（{pctSign}{pct}%）", { sign: stat.marketReturn >= 0 ? "+" : "", amount: nf(stat.marketReturn), pctSign: stat.pct >= 0 ? "+" : "", pct: stat.pct.toFixed(2) })}
                      </span>
                    ) : (
                      <span style={{ color: COLORS.sub }}>{t("最早紀錄，無前年可比較")}</span>
                    )}
                  </div>
                  {stat && stat.contribution != null && stat.contribution !== 0 && (
                    <div className="text-right mt-0.5" style={{ color: COLORS.gold }}>
                      {t("新增投入 {sign}{amount}", { sign: stat.contribution >= 0 ? "+" : "", amount: nf(stat.contribution) })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}


      <Panel title={t("歷史紀錄（{n}）", { n: records.length })}>
        <div className="space-y-2 max-h-[30rem] overflow-y-auto">
          {(() => {
            let lastMonth = null;
            return reversed.map((r, i) => {
              const total = r.twValue + r.usValue;
              const totalCost = (r.twCost || 0) + (r.usCost || 0);
              const prevRec = records[records.length - 2 - i];
              const diff = prevRec ? total - (prevRec.twValue + prevRec.usValue) : null;
              const mk = monthKey(r.date);
              const showHeader = mk !== lastMonth;
              lastMonth = mk;
              const stat = monthlyStats[mk];
              return (
                <div key={r.id}>
                  {showHeader && (
                    <div className="pt-3 pb-1.5 text-[11px] font-bold mono"
                      style={{ borderTop: i > 0 ? `1px solid ${COLORS.panelBorder}` : "none", marginTop: i > 0 ? "0.25rem" : 0 }}>
                      <div className="flex justify-between items-baseline">
                        <span style={{ color: COLORS.gold }}>{mk}{stat?.approximate ? " *" : ""}</span>
                        {stat ? (
                          <span style={{ color: stat.marketReturn >= 0 ? COLORS.gain : COLORS.loss }}>
                            {t("市場 {sign}{amount}（{pctSign}{pct}%）", { sign: stat.marketReturn >= 0 ? "+" : "", amount: nf(stat.marketReturn), pctSign: stat.pct >= 0 ? "+" : "", pct: stat.pct.toFixed(2) })}
                          </span>
                        ) : (
                          <span style={{ color: COLORS.sub, fontWeight: "normal" }}>{t("最早紀錄，無前月可比較")}</span>
                        )}
                      </div>
                      {stat && stat.contribution != null && stat.contribution !== 0 && (
                        <div className="text-right font-normal" style={{ color: COLORS.gold }}>
                          {t("新增投入 {sign}{amount}", { sign: stat.contribution >= 0 ? "+" : "", amount: nf(stat.contribution) })}
                        </div>
                      )}
                    </div>
                  )}
                  <Row onDelete={() => remove(r.id)}>
                    <div className="flex-1">
                      <div className="text-sm mono">{r.date}</div>
                      <div className="text-[11px]" style={{ color: COLORS.sub }}>
                        {t("台 {tw} ／ 美 {us}", { tw: nf(r.twValue), us: nf(r.usValue) })}
                      </div>
                      {totalCost > 0 && (
                        <div className="text-[11px] mono" style={{ color: COLORS.sub }}>
                          {t("成本 台 {tw} ／ 美 {us}", { tw: nf(r.twCost), us: nf(r.usCost) })}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="mono text-sm font-bold">{nf(total)}</div>
                      {diff != null && (
                        <div className="text-[11px] mono" style={{ color: diff >= 0 ? COLORS.gain : COLORS.loss }}>
                          {diff >= 0 ? "+" : ""}{nf(diff)}
                        </div>
                      )}
                      {totalCost > 0 && (
                        <div className="text-[11px] mono" style={{ color: (total - totalCost) >= 0 ? COLORS.gain : COLORS.loss }}>
                          {t("損益 {sign}{amount}", { sign: (total - totalCost) >= 0 ? "+" : "", amount: nf(total - totalCost) })}
                        </div>
                      )}
                    </div>
                  </Row>
                </div>
              );
            });
          })()}
          {records.length === 0 && <Empty text={t("尚無紀錄，新增第一筆吧")} />}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Holdings Panel ----------------

export default DailyPanel;
export { DailyPanel };
