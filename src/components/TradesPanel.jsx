import { useState } from "react";
import { COLORS } from "../lib/constants.js";
import { uid, todayStr, nf } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { AddButton } from "./AddButton.jsx";
import { Row } from "./Row.jsx";
import { Empty } from "./Empty.jsx";
import { useLanguage } from "../lib/i18n.jsx";

function TradesPanel({ trades, setTrades, holdings, costBasis, setCostBasis, accumulatedCost, onFillDailyCost }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({
    date: todayStr(), symbol: "", action: "buy", shares: "", price: "", fee: "", tax: "", note: "",
  });
  const [search, setSearch] = useState("");
  const add = () => {
    if (!form.symbol || !form.shares || !form.price) return;
    const shares = Number(form.shares), price = Number(form.price);
    const fee = Number(form.fee || 0), tax = Number(form.tax || 0);
    const amount = form.action === "buy" ? shares * price + fee : shares * price - fee - tax;
    setTrades((t) => [...t, {
      id: uid(), date: form.date, symbol: form.symbol, action: form.action,
      shares, price, fee, tax, amount, note: form.note,
    }]);
    setForm({ date: todayStr(), symbol: "", action: "buy", shares: "", price: "", fee: "", tax: "", note: "" });
  };
  const remove = (id) => setTrades((t) => t.filter((x) => x.id !== id));
  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));

  // 依代號或名稱搜尋，方便查某一檔股票的完整交易紀錄、抓股數哪裡算錯。
  const q = search.trim().toLowerCase();
  const filtered = q
    ? sorted.filter((t) => {
        const h = holdings.find((x) => x.symbol === t.symbol);
        return t.symbol.toLowerCase().includes(q) || (h && h.name && h.name.toLowerCase().includes(q));
      })
    : sorted;

  // 篩選結果如果剛好只對到一檔股票，順便把這檔的買賣加總算出來，跟「持股進度」
  // 頁用的同一套公式（期初股數 + 買進 - 賣出）對一次，方便你核對股數卡在哪裡。
  const filteredSymbols = [...new Set(filtered.map((t) => t.symbol))];
  const singleSymbolSummary = (() => {
    if (filteredSymbols.length !== 1 || filtered.length === 0) return null;
    const sym = filteredSymbols[0];
    const h = holdings.find((x) => x.symbol === sym);
    const bought = filtered.filter((t) => t.action === "buy").reduce((s, t) => s + t.shares, 0);
    const sold = filtered.filter((t) => t.action === "sell").reduce((s, t) => s + t.shares, 0);
    const initialShares = h ? Number(h.initialShares || 0) : 0;
    return { symbol: sym, name: h ? h.name : "", bought, sold, net: bought - sold, initialShares, total: initialShares + bought - sold };
  })();

  // 抓可能重複輸入的紀錄：同一檔股票、同一天、同買賣別、同股數、同價格出現超過一次。
  // 只在有打字搜尋時才算、才顯示，平常瀏覽全部409筆不會跳出來洗版。
  const dupGroups = q ? (() => {
    const map = {};
    for (const t of filtered) {
      const key = `${t.symbol}|${t.date}|${t.action}|${t.shares}|${t.price}`;
      (map[key] = map[key] || []).push(t);
    }
    return Object.values(map).filter((g) => g.length > 1);
  })() : [];

  return (
    <div className="space-y-4">
      {costBasis && (
        <Panel title={t("成本追蹤")}>
          <Field label={t("起始成本（交易紀錄開始追蹤之前，已經投入的成本）")}>
            <input type="number" value={costBasis.startingCost}
              onChange={(e) => setCostBasis({ ...costBasis, startingCost: Number(e.target.value || 0) })}
              className="input" />
          </Field>
          <div className="flex justify-between items-baseline mt-3 text-sm mono">
            <span style={{ color: COLORS.sub }}>{t("目前累積成本（起始成本 + 全部買賣紀錄）")}</span>
            <span className="font-bold" style={{ color: COLORS.gold }}>NT$ {nf(accumulatedCost)}</span>
          </div>
          {onFillDailyCost && (
            <>
              <button onClick={() => onFillDailyCost(Math.round(accumulatedCost))}
                className="mt-3 w-full rounded-lg py-2 text-[11px] font-bold"
                style={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}`, color: COLORS.gold }}>
                {t("帶入「每日紀錄」台股成本")}
              </button>
              <div className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
                {t("會跳到「每日紀錄」並自動填好今天的台股成本，確認後按「儲存紀錄」即可")}
              </div>
            </>
          )}
        </Panel>
      )}

      <Panel title={t("新增交易")}>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("日期")}><input type="date" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" /></Field>
          <Field label={t("買賣")}>
            <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className="input">
              <option value="buy">{t("買")}</option>
              <option value="sell">{t("賣")}</option>
            </select>
          </Field>
          <Field label={t("代號")}>
            <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              placeholder="0050" list="symbols" className="input" />
            <datalist id="symbols">{holdings.map((h) => <option key={h.id} value={h.symbol} />)}</datalist>
          </Field>
          <Field label={t("股數")}><input type="number" value={form.shares}
            onChange={(e) => setForm({ ...form, shares: e.target.value })} className="input" /></Field>
          <Field label={t("成交價")}><input type="number" value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })} className="input" /></Field>
          <Field label={t("手續費")}><input type="number" value={form.fee}
            onChange={(e) => setForm({ ...form, fee: e.target.value })} placeholder="0" className="input" /></Field>
          <Field label={t("交易稅（賣出）")}><input type="number" value={form.tax}
            onChange={(e) => setForm({ ...form, tax: e.target.value })} placeholder="0" className="input" /></Field>
          <Field label={t("備註")}><input value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} className="input" /></Field>
        </div>
        <AddButton onClick={add} label={t("新增交易")} />
      </Panel>

      <Panel title={q ? t("交易紀錄（{n} / 共{total}）", { n: filtered.length, total: trades.length }) : t("交易紀錄（{n}）", { n: filtered.length })}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("搜尋代號或名稱，例如 0050 或 元大台灣50")}
          className="input mb-3"
        />
        {singleSymbolSummary && (
          <div className="rounded-lg p-3 mb-3 text-[11px] mono" style={{ background: COLORS.bg, border: `1px solid ${COLORS.gold}` }}>
            <div style={{ color: COLORS.gold }} className="font-bold mb-1">
              {singleSymbolSummary.symbol}{singleSymbolSummary.name ? `｜${singleSymbolSummary.name}` : ""} {t("核對")}
            </div>
            <div style={{ color: COLORS.sub }}>{t("買進共 {bought} 股、賣出共 {sold} 股，淨增加 {net} 股", { bought: nf(singleSymbolSummary.bought), sold: nf(singleSymbolSummary.sold), net: nf(singleSymbolSummary.net) })}</div>
            <div style={{ color: COLORS.sub }}>{t("期初股數 {initial} + 淨增加 {net} = 目前應有", { initial: nf(singleSymbolSummary.initialShares), net: nf(singleSymbolSummary.net) })} <span className="font-bold" style={{ color: COLORS.text }}>{nf(singleSymbolSummary.total)}</span> {t("股（跟「持股進度」頁顯示的股數對一下，兩邊算法一樣，如果對不起來代表持股進度那邊被手動改過）")}</div>
          </div>
        )}
        {q && dupGroups.length > 0 && (
          <div className="rounded-lg p-3 mb-3 text-[11px]" style={{ background: "#3a1f1f", border: `1px solid ${COLORS.loss}` }}>
            <div style={{ color: COLORS.loss }} className="font-bold mb-1">⚠️ {t("發現 {n} 組疑似重複輸入", { n: dupGroups.length })}</div>
            {dupGroups.map((g, i) => (
              <div key={i} style={{ color: COLORS.sub }} className="mono">
                {g[0].symbol} {g[0].date} {g[0].action === "buy" ? t("買") : t("賣")} {t("{shares}股@{price}", { shares: g[0].shares, price: g[0].price })}（{t("出現 {n} 次", { n: g.length })}）
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filtered.map((t2) => (
            <Row key={t2.id} onDelete={() => remove(t2.id)}>
              <div className="flex-1">
                <div className="text-sm mono">
                  {t2.date} <span style={{ color: t2.action === "buy" ? COLORS.gain : COLORS.loss }}>
                    {t2.action === "buy" ? t("買") : t("賣")}
                  </span> {t2.symbol}
                </div>
                <div className="text-[11px]" style={{ color: COLORS.sub }}>
                  {t("{shares}股 @ {price}", { shares: nf(t2.shares), price: t2.price })}
                </div>
              </div>
              <div className="text-right mono text-sm font-bold">
                {t2.action === "sell" ? "+" : "-"}{nf(t2.amount)}
              </div>
            </Row>
          ))}
          {filtered.length === 0 && <Empty text={q ? t("查無符合的交易紀錄") : t("尚無交易紀錄")} />}
        </div>
      </Panel>
    </div>
  );
}

// 近期除息倒數提醒：一次查詢所有「還在追蹤」的持股，只顯示已公告、
// 日期還沒過的那幾筆，由近到遠排序。查不到公告的股票安靜略過（不當錯誤）。

export default TradesPanel;
export { TradesPanel };
