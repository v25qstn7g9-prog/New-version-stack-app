import { useState, useEffect, useMemo } from "react";
import { Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrashIcon, PencilIcon } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";
import { uid, todayStr, nf, loadKey } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { Field } from "./Field.jsx";
import { AddButton } from "./AddButton.jsx";
import { Empty } from "./Empty.jsx";

function HoldingsPanel({ holdings, setHoldings, onFillDailyCost }) {
  const [form, setForm] = useState({ symbol: "", name: "", initialShares: "", target2035: "", costBasis: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  // 持股進度頁不另外打報價 API；直接沿用「總覽 → 即時股價」寫入的 livePrices 快取。
  // 這樣首頁是唯一報價來源，避免兩個頁面各自抓一次造成重複請求。
  const [holdingQuotes, setHoldingQuotes] = useState({});

  useEffect(() => {
    let cancelled = false;
    const onLivePricesUpdated = (e) => {
      if (!cancelled && e?.detail?.map) setHoldingQuotes(e.detail.map);
    };
    window.addEventListener("livePricesUpdated", onLivePricesUpdated);

    (async () => {
      const cached = await loadKey("livePrices", null);
      if (cancelled) return;
      setHoldingQuotes(cached?.map || {});
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("livePricesUpdated", onLivePricesUpdated);
    };
  }, []);

  const add = () => {
    if (!form.symbol) return;
    const costAmount = form.costBasis === "" ? null : Number(form.costBasis);
    setHoldings((h) => [...h, {
      id: uid(), symbol: form.symbol, name: form.name,
      initialShares: Number(form.initialShares || 0), target2035: Number(form.target2035 || 0),
      costOverride: costAmount != null ? { amount: costAmount, asOfDate: todayStr(), asOfShares: Number(form.initialShares || 0) } : null,
    }]);
    setForm({ symbol: "", name: "", initialShares: "", target2035: "", costBasis: "" });
  };
  const remove = (id) => setHoldings((h) => h.filter((x) => x.id !== id));

  const startEdit = (h) => {
    setEditingId(h.id);
    setEditForm({
      symbol: h.symbol, name: h.name, initialShares: String(h.initialShares), target2035: String(h.target2035),
      // 編輯時預先帶入目前算出來的持有成本，方便直接對照券商 App 修改，
      // 不用自己從零算起。
      costBasis: h.estCostBasis != null ? String(h.estCostBasis) : "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm(null); };
  const saveEdit = () => {
    // asOfShares 用目前算出來的股數（來自 holdings 這個已經算好 current 的 prop），
    // 不是 setHoldings 裡那個還沒算過的原始資料，兩者不能搞混。
    const currentShares = holdings.find((x) => x.id === editingId)?.current ?? 0;
    setHoldings((hs) => hs.map((h) => h.id === editingId ? {
      ...h, symbol: editForm.symbol, name: editForm.name,
      initialShares: Number(editForm.initialShares || 0), target2035: Number(editForm.target2035 || 0),
      // 把「持有成本」存成一筆快照（今天的成本 + 今天的股數），之後只會疊加快照
      // 日期「之後」發生的買賣紀錄，不會重複計算今天以前已經算進這個數字裡的交易。
      costOverride: editForm.costBasis === "" ? null : {
        amount: Number(editForm.costBasis || 0), asOfDate: todayStr(), asOfShares: currentShares,
      },
      // 一旦手動編輯過持股，就不再吃舊版的手動平均成本覆蓋，全部改由「持有成本快照＋交易紀錄」自動算。
      manualAvgCost: "",
    } : h));
    cancelEdit();
  };

  // 總持有成本：加總每一檔目前的持有成本（起始成本＋歷來買賣紀錄），
  // 用來跟「每日紀錄」的台股成本互相核對、同步。
  const totalHoldingCost = holdings.reduce((s, h) => s + (h.estCostBasis || 0), 0);

  // 資產配置圓餅圖：優先用「即時股價 × 目前股數」算市值佔比（比較貼近再平衡要看的
  // 實際曝險），單一標的抓不到報價時，退回用該檔的持有成本，圖表才不會缺一塊。
  const ALLOC_COLORS = [COLORS.gold, "#60A5FA", "#34D399", "#F472B6", "#A78BFA", "#F87171", "#22D3EE", "#FBBF24"];
  const allocationData = useMemo(() => {
    return holdings.map((h) => {
      const q = holdingQuotes[h.symbol];
      const price = Number(q?.price);
      const hasPrice = Number.isFinite(price) && price > 0 && Number(h.current || 0) > 0;
      const marketValue = hasPrice ? price * Number(h.current) : null;
      const value = marketValue != null ? marketValue : Number(h.estCostBasis || 0);
      return { symbol: h.symbol, name: h.name, value, usedCostFallback: !hasPrice };
    }).filter((x) => x.value > 0);
  }, [holdings, holdingQuotes]);
  const allocationTotal = allocationData.reduce((s, x) => s + x.value, 0);
  const hasCostFallback = allocationData.some((x) => x.usedCostFallback);

  return (
    <div className="space-y-4">
      <Panel title="持股進度">
        <div className="flex items-center justify-between rounded-xl p-3 mb-3"
          style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
          <div>
            <div className="text-[11px]" style={{ color: COLORS.sub }}>總持有成本（所有標的合計）</div>
            <div className="text-base font-bold mono" style={{ color: COLORS.gold }}>NT$ {nf(totalHoldingCost)}</div>
          </div>
          {onFillDailyCost && (
            <button onClick={() => onFillDailyCost(Math.round(totalHoldingCost))}
              className="text-[11px] px-2.5 py-1.5 rounded-lg font-bold"
              style={{ border: `1px solid ${COLORS.gold}`, color: COLORS.gold }}>
              帶入「每日紀錄」台股成本
            </button>
          )}
        </div>

        {allocationData.length > 0 && (
          <div className="rounded-xl p-3 mb-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
            <div className="text-[11px] mb-1" style={{ color: COLORS.sub }}>資產配置（以市值計，抓不到報價時退回用成本）</div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={allocationData} dataKey="value" nameKey="symbol"
                    innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {allocationData.map((_, i) => (
                      <Cell key={i} fill={ALLOC_COLORS[i % ALLOC_COLORS.length]} stroke={COLORS.bg} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, fontSize: 12 }}
                    formatter={(v, n) => [`NT$ ${nf(v)}（${((v / allocationTotal) * 100).toFixed(1)}%）`, n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
              {allocationData.map((x, i) => (
                <div key={x.symbol} className="flex items-center gap-1 text-[11px]" style={{ color: COLORS.sub }}>
                  <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} />
                  <span className="mono" style={{ color: COLORS.text }}>{x.symbol}</span>
                  <span>{((x.value / allocationTotal) * 100).toFixed(1)}%{x.usedCostFallback ? "*" : ""}</span>
                </div>
              ))}
            </div>
            {hasCostFallback && (
              <div className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
                * 抓不到即時報價，暫時用持有成本計算佔比
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          {holdings.map((h) => (
            <div key={h.id} className="rounded-xl p-3" style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}` }}>
              {editingId === h.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="代號"><input value={editForm.symbol}
                      onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value })} className="input" /></Field>
                    <Field label="名稱"><input value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="input" /></Field>
                    <Field label="期初股數"><input type="number" value={editForm.initialShares}
                      onChange={(e) => setEditForm({ ...editForm, initialShares: e.target.value })} className="input" /></Field>
                    <Field label="目標股數"><input type="number" value={editForm.target2035}
                      onChange={(e) => setEditForm({ ...editForm, target2035: e.target.value })} className="input" /></Field>
                    <div className="col-span-2">
                      <Field label="持有成本（直接輸入目前總成本，例如對照券商App的數字）">
                        <input type="number" value={editForm.costBasis} placeholder="0"
                          onChange={(e) => setEditForm({ ...editForm, costBasis: e.target.value })} className="input" />
                      </Field>
                      <div className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
                        平均成本會用「持有成本 ÷ 目前股數」自動倒算。儲存後會把這個數字當成「今天」的成本快照，
                        之後新增的每一筆交易都會自動疊加上去；今天以前已經發生的交易不會被重複計算。
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={cancelEdit} className="rounded-lg py-2 text-xs font-bold"
                      style={{ background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`, color: COLORS.sub }}>
                      取消
                    </button>
                    <button onClick={saveEdit} className="rounded-lg py-2 text-xs font-bold"
                      style={{ background: COLORS.gold, color: COLORS.bg }}>
                      儲存
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start">
                    <div className="flex items-baseline gap-2">
                      <span className="font-bold mono">{h.symbol}</span>
                      <span className="text-[11px]" style={{ color: COLORS.sub }}>{h.name}</span>
                      {h.avgTradePrice != null && (
                        <span className="text-[11px] mono" style={{ color: COLORS.gold }}>
                          均價 {h.avgTradePrice.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => startEdit(h)} style={{ color: COLORS.sub }}><PencilIcon size={15} /></button>
                      <button onClick={() => remove(h.id)} style={{ color: COLORS.sub }}><TrashIcon size={15} /></button>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs mono mt-2">
                    <span style={{ color: COLORS.sub }}>
                      平均成本 <span style={{ color: COLORS.text }}>{h.avgCost != null ? `NT$ ${h.avgCost.toFixed(2)}` : "-"}</span>
                      {h.isManualAvgCost && <span style={{ color: COLORS.gold }}> (手動)</span>}
                    </span>
                    <span style={{ color: COLORS.sub }}>
                      持有成本 <span style={{ color: COLORS.text }}>{h.estCostBasis != null ? `NT$ ${nf(h.estCostBasis)}` : "-"}</span>
                    </span>
                  </div>
                  <div className="flex justify-between text-xs mono mt-2">
                    <span style={{ color: COLORS.sub }}>目前 {nf(h.current)} 股</span>
                    <span style={{ color: COLORS.sub }}>目標 {nf(h.target2035)} 股</span>
                  </div>
                  {(() => {
                    const q = holdingQuotes[h.symbol];
                    const price = Number(q?.price);
                    const prevClose = Number(q?.prevClose);
                    const hasPrice = Number.isFinite(price) && price > 0;
                    const hasPrevClose = Number.isFinite(prevClose) && prevClose > 0;
                    const marketValue = hasPrice
                      ? price * Number(h.current || 0)
                      : null;
                    const estimatedPnl = marketValue != null && Number(h.estCostBasis || 0) > 0
                      ? Math.round(marketValue - Number(h.estCostBasis))
                      : null;
                    const cumulativePct = marketValue != null && Number(h.estCostBasis || 0) > 0
                      ? ((marketValue - Number(h.estCostBasis)) / Number(h.estCostBasis)) * 100
                      : null;
                    return (
                      <div className="flex justify-between text-[11px] mono mt-1">
                        <span style={{ color: COLORS.sub }}>
                          預估損益{" "}
                          <span style={{ color: estimatedPnl == null ? COLORS.sub : (estimatedPnl >= 0 ? COLORS.gain : COLORS.loss) }}>
                            {estimatedPnl == null ? "--" : `${estimatedPnl >= 0 ? "+" : ""}${nf(estimatedPnl)}`}
                          </span>
                        </span>
                        <span style={{ color: COLORS.sub }}>
                          累積獲利率{" "}
                          <span style={{ color: cumulativePct == null ? COLORS.sub : (cumulativePct >= 0 ? COLORS.gain : COLORS.loss) }}>
                            {cumulativePct == null ? "--" : `${cumulativePct >= 0 ? "+" : ""}${cumulativePct.toFixed(1)}%`}
                          </span>
                        </span>
                      </div>
                    );
                  })()}
                  <div className="flex justify-between text-[11px] mono mt-1" style={{ color: COLORS.sub }}>
                    <span>
                      第 {h.quarterNum} 季增加 <span style={{ color: h.quarterSharesAdded >= 0 ? COLORS.text : COLORS.gain }}>
                        {h.quarterSharesAdded > 0 ? "+" : ""}{nf(h.quarterSharesAdded)} 股
                      </span>
                    </span>
                    <span>
                      今年累計 <span style={{ color: h.yearSharesAdded >= 0 ? COLORS.text : COLORS.gain }}>
                        {h.yearSharesAdded > 0 ? "+" : ""}{nf(h.yearSharesAdded)} 股
                      </span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.panelBorder }}>
                    <div className="h-full rounded-full" style={{ width: `${h.pct}%`, background: COLORS.gold }} />
                  </div>
                  <div className="flex justify-between items-baseline mt-1">
                    <span className="text-[11px] mono" style={{ color: COLORS.sub }}>{h.projectedLabel}</span>
                    <span className="text-[11px] mono" style={{ color: COLORS.gold }}>
                      達成率 {h.pct.toFixed(1)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          ))}
          {holdings.length === 0 && <Empty text="尚未新增持股標的" />}
        </div>
      </Panel>

      <Panel title="新增持股標的">
        <div className="grid grid-cols-2 gap-2">
          <Field label="代號"><input value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
            placeholder="0056" className="input" /></Field>
          <Field label="名稱"><input value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="高股息ETF" className="input" /></Field>
          <Field label="期初股數"><input type="number" value={form.initialShares}
            onChange={(e) => setForm({ ...form, initialShares: e.target.value })}
            placeholder="0" className="input" /></Field>
          <Field label="2035目標股數"><input type="number" value={form.target2035}
            onChange={(e) => setForm({ ...form, target2035: e.target.value })}
            placeholder="0" className="input" /></Field>
          <div className="col-span-2">
            <Field label="起始成本（期初股數對應的持有成本，留空=0）">
              <input type="number" value={form.costBasis}
                onChange={(e) => setForm({ ...form, costBasis: e.target.value })}
                placeholder="0" className="input" />
            </Field>
          </div>
        </div>
        <AddButton onClick={add} label="新增標的" />
      </Panel>
    </div>
  );
}

// ---------------- Trades Panel ----------------

export default HoldingsPanel;
export { HoldingsPanel };
