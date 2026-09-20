import { useState, useEffect } from "react";
import { COLORS } from "../lib/constants.js";
import { uid, todayStr, nf, fetchWithTimeout } from "../lib/helpers.js";
import { UpcomingDividendReminder } from "./UpcomingDividendReminder.jsx";
import { DividendHistoryChart } from "./DividendHistoryChart.jsx";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { AddButton } from "./AddButton.jsx";
import { Row } from "./Row.jsx";
import { Empty } from "./Empty.jsx";

function DividendsPanel({ dividends, setDividends, holdings }) {
  const [form, setForm] = useState({ date: todayStr(), symbol: "", shares: "", perShare: "" });
  // Typing/selecting a symbol that matches a holding auto-fills 股數 with
  // that holding's current share count, so you don't have to look it up
  // and retype it every time — still a normal editable field afterward if
  // the actual ex-dividend-date share count was different.
  const handleSymbolChange = (value) => {
    const match = holdings.find((h) => h.symbol === value);
    setForm((f) => ({
      ...f,
      symbol: value,
      shares: match ? String(match.current) : f.shares,
    }));
  };

  // 代號打完（符合股票代號格式）之後，自動去查 TWSE 的「除權除息預告表」，
  // 抓到的話幫忙帶入除息日跟每股配息（查到就直接覆蓋，使用者只要看一眼、
  // 確認沒問題就送出——查不到金額（cashDividend 是 null，例如 ETF 常見的
  // 「待公告實際收益分配金額」）才會留著原本填的值，不會清空。
  // 這張表只列出「已經公告」的，多數個股一年只公告一次，公告前查不到是
  // 正常情況（not-found），不當成錯誤處理；兩個欄位帶入後都還是可以手動改。
  const [scheduleStatus, setScheduleStatus] = useState(null); // null | "loading" | "found" | "not-found" | "error"
  const [scheduleInfo, setScheduleInfo] = useState(null);
  useEffect(() => {
    const symbol = form.symbol.trim().toUpperCase();
    if (!/^[0-9]{4,6}[A-Z]?$/.test(symbol)) {
      setScheduleStatus(null);
      setScheduleInfo(null);
      return;
    }
    let cancelled = false;
    setScheduleStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithTimeout(
          `/dividend-schedule?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" }, 8000
        );
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.ok) { setScheduleStatus("error"); setScheduleInfo(null); return; }
        if (!data.found) { setScheduleStatus("not-found"); setScheduleInfo(null); return; }
        setScheduleStatus("found");
        setScheduleInfo(data);
        setForm((f) => {
          if (f.symbol.trim().toUpperCase() !== symbol) return f; // 使用者已經改打別的代號了
          return {
            ...f,
            date: data.date || f.date,
            perShare: (data.cashDividend != null) ? String(data.cashDividend) : f.perShare,
          };
        });
      } catch (e) {
        if (!cancelled) { setScheduleStatus("error"); setScheduleInfo(null); }
      }
    }, 500); // debounce：等打完字停一下再查，不要每敲一個字就打一次
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.symbol]);

  const scheduleHint = (() => {
    if (scheduleStatus === "loading") return { text: "查詢最新除息公告中…", color: COLORS.sub };
    if (scheduleStatus === "found") {
      const cash = scheduleInfo?.cashDividend != null ? `，每股 ${scheduleInfo.cashDividend}` : "";
      return { text: `已抓到最新公告：${scheduleInfo.date} 除${scheduleInfo.type || "息"}${cash}`, color: COLORS.gold };
    }
    if (scheduleStatus === "not-found") return { text: "尚未有除權息公告（可能還沒到公告時間，日期請自行填寫）", color: COLORS.sub };
    if (scheduleStatus === "error") return { text: "查詢公告失敗，請自行填寫除息日", color: "#EF4444" };
    return null;
  })();

  const add = () => {
    if (!form.symbol || !form.shares || !form.perShare) return;
    const amount = Number(form.shares) * Number(form.perShare);
    setDividends((d) => [...d, {
      id: uid(), date: form.date, symbol: form.symbol,
      shares: Number(form.shares), perShare: Number(form.perShare), amount,
    }]);
    setForm({ date: todayStr(), symbol: "", shares: "", perShare: "" });
  };
  const remove = (id) => setDividends((d) => d.filter((x) => x.id !== id));
  const sorted = [...dividends].sort((a, b) => b.date.localeCompare(a.date));
  const total = dividends.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="space-y-4">
      <UpcomingDividendReminder holdings={holdings} />

      <Panel title="新增配息">
        <div className="grid grid-cols-2 gap-2">
          <Field label="除息日"><input type="date" value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })} className="input" /></Field>
          <Field label="代號">
            <input value={form.symbol} onChange={(e) => handleSymbolChange(e.target.value)}
              placeholder="0056" list="symbols2" className="input" />
            <datalist id="symbols2">{holdings.map((h) => <option key={h.id} value={h.symbol} />)}</datalist>
            {scheduleHint && (
              <div className="text-[11px] mt-1" style={{ color: scheduleHint.color }}>{scheduleHint.text}</div>
            )}
          </Field>
          <Field label="股數（選了有持股的代號會自動帶入，可再手動調整）"><input type="number" value={form.shares}
            onChange={(e) => setForm({ ...form, shares: e.target.value })} className="input" /></Field>
          <Field label={
            scheduleStatus === "found" && scheduleInfo?.cashDividend != null
              ? "每股配息（已用最新公告帶入，請確認後再送出）"
              : "每股配息"
          }><input type="number" step="0.01" value={form.perShare}
            onChange={(e) => setForm({ ...form, perShare: e.target.value })} className="input" /></Field>
        </div>
        <AddButton onClick={add} label="新增配息紀錄" />
      </Panel>

      <DividendHistoryChart dividends={dividends} />

      <Panel title={`累積股息：NT$ ${nf(total)}`}>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {sorted.map((d) => (
            <Row key={d.id} onDelete={() => remove(d.id)}>
              <div className="flex-1">
                <div className="text-sm mono">{d.date} · {d.symbol}</div>
                <div className="text-[11px]" style={{ color: COLORS.sub }}>
                  {nf(d.shares)}股 × {d.perShare}
                </div>
              </div>
              <div className="text-right mono text-sm font-bold" style={{ color: COLORS.gold }}>
                +{nf(d.amount)}
              </div>
            </Row>
          ))}
          {dividends.length === 0 && <Empty text="尚無配息紀錄" />}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Plan Panel ----------------

export default DividendsPanel;
export { DividendsPanel };
