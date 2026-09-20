import { useState } from "react";
import { Download, Upload, ShieldCheck } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";
import { uid, nf, fetchWithTimeout, externalAiHealthUrl } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { AddButton } from "./AddButton.jsx";
import { Row } from "./Row.jsx";
import { Empty } from "./Empty.jsx";

function PlanPanel({ planItems, setPlanItems, planTotal, goal, setGoal, exportBackup, importBackup, exportExcel, lastBackupAt, backupAgeDays, backupOverdue, aiFallbackConfig, setAiFallbackConfig, healthCards, healthCardBusyId, respondHealthCard }) {
  const [form, setForm] = useState({ symbol: "", amount: "", note: "" });
  const [fallbackTest, setFallbackTest] = useState({ status: "idle", message: "" });

  const testExternalAiFallback = async () => {
    const healthUrl = externalAiHealthUrl(aiFallbackConfig?.url);
    if (!healthUrl) {
      setFallbackTest({ status: "error", message: "網址格式不正確；可直接貼 Vercel 專案網址" });
      return;
    }
    setFallbackTest({ status: "loading", message: "測試中…" });
    try {
      const headers = {};
      if (aiFallbackConfig?.token) headers["x-fallback-token"] = aiFallbackConfig.token;
      const res = await fetchWithTimeout(healthUrl, { method: "GET", headers, cache: "no-store" }, 10000);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const model = data.model ? ` · ${data.model}` : "";
      setFallbackTest({ status: "ok", message: `備援後端正常${model}` });
    } catch (e) {
      setFallbackTest({ status: "error", message: e?.message || "備援測試失敗" });
    }
  };
  const add = () => {
    if (!form.symbol || !form.amount) return;
    setPlanItems((p) => [...p, { id: uid(), symbol: form.symbol, amount: Number(form.amount), note: form.note }]);
    setForm({ symbol: "", amount: "", note: "" });
  };
  const remove = (id) => setPlanItems((p) => p.filter((x) => x.id !== id));

  return (
    <div className="space-y-4">
      <Panel title="退休目標設定">
        <div className="grid grid-cols-2 gap-2">
          <Field label="目標金額 (NTD)"><input type="number" value={goal.targetAmount}
            onChange={(e) => setGoal({ ...goal, targetAmount: Number(e.target.value) })} className="input" /></Field>
          <Field label="目標年份"><input type="number" value={goal.targetYear}
            onChange={(e) => setGoal({ ...goal, targetYear: Number(e.target.value) })} className="input" /></Field>
        </div>
      </Panel>

      <Panel title={`每月定期定額（合計 NT$ ${nf(planTotal)}）`}>
        <div className="space-y-2">
          {planItems.map((p) => (
            <Row key={p.id} onDelete={() => remove(p.id)}>
              <div className="flex-1">
                <div className="text-sm mono font-bold">{p.symbol}</div>
                {p.note && <div className="text-[11px]" style={{ color: COLORS.sub }}>{p.note}</div>}
              </div>
              <div className="mono text-sm font-bold">{nf(p.amount)}</div>
            </Row>
          ))}
          {planItems.length === 0 && <Empty text="尚未設定定期定額配置" />}
        </div>
      </Panel>

      <Panel title="新增定期定額項目">
        <div className="grid grid-cols-2 gap-2">
          <Field label="標的"><input value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })} placeholder="0050" className="input" /></Field>
          <Field label="月投入金額"><input type="number" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} className="input" /></Field>
          <div className="col-span-2">
            <Field label="備註"><input value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} className="input" /></Field>
          </div>
        </div>
        <AddButton onClick={add} label="新增項目" />
      </Panel>

      {healthCards.length > 0 && (
        <Panel title="系統健康">
          {healthCards.map((card) => (
            <div key={card.id} className="mb-3 rounded-xl p-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
              <div className="text-[12px] leading-5" style={{ color: COLORS.text }}>{card.summary}</div>
              {card.occurrences > 1 && (
                <div className="mt-1 text-[10px]" style={{ color: COLORS.sub }}>已連續偵測到 {card.occurrences} 次，最後一次：{card.lastSeenAt}</div>
              )}
              {card.fixType === "wait" && (
                <div className="mt-1 text-[10px]" style={{ color: COLORS.sub }}>建議：不用做什麼，等它自動恢復即可。</div>
              )}
              {card.fixType === "code" && (
                <div className="mt-1 text-[10px]" style={{ color: COLORS.sub }}>建議：這個需要改程式碼重新部署，按「確定」只會把這張卡片標記為已處理，不會自動改程式。</div>
              )}
              <div className="mt-2 flex gap-2">
                <button onClick={() => respondHealthCard(card.id, "apply")} disabled={healthCardBusyId === card.id}
                  className="flex-1 rounded-lg py-2 text-[11px] font-bold"
                  style={{ background: COLORS.gold, color: COLORS.bg, opacity: healthCardBusyId === card.id ? 0.6 : 1 }}>
                  確定（知道了）
                </button>
                <button onClick={() => respondHealthCard(card.id, "dismiss")} disabled={healthCardBusyId === card.id}
                  className="flex-1 rounded-lg py-2 text-[11px] font-bold"
                  style={{ background: COLORS.bg, color: COLORS.sub, border: `1px solid ${COLORS.panelBorder}`, opacity: healthCardBusyId === card.id ? 0.6 : 1 }}>
                  忽略
                </button>
              </div>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="AI 雙層備援（自動）">
        <div className="text-[11px] leading-5" style={{ color: COLORS.sub }}>
          主 AI：<span style={{ color: COLORS.gold }}>Cloudflare GPT-OSS</span>。如果遇到額度用完、429、逾時或服務錯誤，會由同一個 Cloudflare Worker <span style={{ color: COLORS.gold }}>直接切到 Gemini 3.5 Flash-Lite</span>，不再需要 Vercel，也不會把 Gemini API Key 放在手機。
        </div>
        <div className="mt-2 rounded-xl p-3 text-[11px] leading-5" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}`, color: COLORS.sub }}>
          <div><span style={{ color: COLORS.loss }}>①</span> Cloudflare AI</div>
          <div><span style={{ color: COLORS.gold }}>↓ 失敗自動切換</span></div>
          <div><span style={{ color: COLORS.gain }}>②</span> Gemini 3.5 Flash-Lite（Worker 伺服器端）</div>
          <div><span style={{ color: COLORS.sub }}>↓ 如果 Gemini 也失敗，才顯示真正錯誤，不會假裝成功</span></div>
        </div>
        <label className="mt-3 flex items-start gap-2 text-[11px] leading-5" style={{ color: COLORS.sub }}>
          <input type="checkbox" checked={aiFallbackConfig?.allowPrivate === true}
            onChange={(e) => setAiFallbackConfig({ ...aiFallbackConfig, allowPrivate: e.target.checked })}
            style={{ marginTop: 3 }} />
          <span>允許 Gemini 備援讀取 App 的持股／成本／資產資料。關閉時，公開資訊、聊天、新聞與即時股價仍可備援；需要私人資產資料時，Gemini 會改用唯讀工具請 App 查詢，不會把整份私人 context 送出去。</span>
        </label>
      </Panel>

      <Panel title="資料備份與還原">
        <div className="rounded-xl p-3 flex gap-2 items-start"
          style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
          <ShieldCheck size={18} style={{ color: COLORS.gold, flex: "0 0 auto", marginTop: 1 }} />
          <div className="text-[11px] leading-5" style={{ color: COLORS.sub }}>
            JSON 用來完整備份／還原 App；Excel 用來保存、檢視與分析投資歷史。重要修改後建議兩種都留一份。
          </div>
          <div className="ml-auto text-right text-[10px] leading-4" style={{ color: backupOverdue ? COLORS.gold : COLORS.sub }}>
            {lastBackupAt
              ? <>上次 JSON 備份<br />{new Date(lastBackupAt).toLocaleDateString("zh-TW")}（{backupAgeDays} 天前）</>
              : <>上次 JSON 備份<br />尚未記錄</>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <button onClick={exportBackup}
            className="rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-1"
            style={{ background: COLORS.gold, color: COLORS.bg }}>
            <Download size={14} /> JSON備份
          </button>
          <label className="rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
            style={{ background: COLORS.bg, color: COLORS.gold, border: `1px solid ${COLORS.gold}` }}>
            <Upload size={14} /> JSON還原
            <input type="file" accept="application/json,.json" className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                importBackup(file);
                e.target.value = "";
              }} />
          </label>
          <button onClick={exportExcel}
            className="rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-1"
            style={{ background: COLORS.bg, color: COLORS.gold, border: `1px solid ${COLORS.gold}` }}>
            <Download size={14} /> 匯出Excel
          </button>
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Progress Panel ----------------

export default PlanPanel;
export { PlanPanel };
