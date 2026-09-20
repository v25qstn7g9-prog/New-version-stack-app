import { useState, useEffect, useRef } from "react";
import { X, MessageCircle, Send } from "../lib/icons.jsx";
import { COLORS, READ_TOOL_NAMES } from "../lib/constants.js";
import { uid, todayStr, fetchWithTimeout, normalizeExternalAiAskUrl, shouldUseExternalAiFallback, buildPortfolioContext, describeToolCall, validateToolCall, executeReadTool, executeLiveQuoteTool } from "../lib/helpers.js";

function AiChatWidget({ holdings, goal, totalToday, totalInvested, trades, setTrades, setHoldings, setGoal, dailyRecords, dividends, planItems, planSchedule, goalDate, perf, aiFallbackConfig }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role, content} 一般訊息，或 {role:'assistant', toolCall, status} 確認卡片
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [providerInfo, setProviderInfo] = useState(null); // { provider, model, profile }
  const scrollRef = useRef(null);

  // 開啟 AI 助手時把背景頁面「鎖死」，不能被 iOS 內部的 scroll-into-view
  // 行為拖走。只用 overflow:hidden 不夠——那只能擋使用者手動滑動，擋不住
  // iOS 為了讓聚焦的輸入框可見而做的內部捲動（比 CSS overflow 屬性更底
  // 層）。用 position:fixed 把 body 整個「拔出」文件流，記錄原本捲動位
  // 置，關閉時自動捲回去，不用手動滑回原位。
  //
  // 面板本身貼齊鍵盤交給 CSS 的 env(keyboard-inset-height)（見上面
  // .ai-panel-wrap）。實測過 interactive-widget=resizes-content 沒有真的
  // 讓 dvh 跟著鍵盤縮小，所以不能只靠它；這裡不用 JS 去算面板高度——量
  // visualViewport.height 在這個 PWA 環境下試過也不準。
  useEffect(() => {
    if (!open) return;

    const scrollY = window.scrollY;
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const prevHtml = { overflow: htmlStyle.overflow, height: htmlStyle.height };
    const prevBody = {
      position: bodyStyle.position, top: bodyStyle.top, left: bodyStyle.left,
      right: bodyStyle.right, width: bodyStyle.width, overflow: bodyStyle.overflow,
    };
    htmlStyle.overflow = "hidden";
    htmlStyle.height = "100%";
    bodyStyle.position = "fixed";
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = "0";
    bodyStyle.right = "0";
    bodyStyle.width = "100%";
    bodyStyle.overflow = "hidden";

    return () => {
      htmlStyle.overflow = prevHtml.overflow;
      htmlStyle.height = prevHtml.height;
      bodyStyle.position = prevBody.position;
      bodyStyle.top = prevBody.top;
      bodyStyle.left = prevBody.left;
      bodyStyle.right = prevBody.right;
      bodyStyle.width = prevBody.width;
      bodyStyle.overflow = prevBody.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  // 呼叫一次 /ask，回傳解析後的資料；共用給第一次發問跟「自動查詢後再問一次」用。
  // toolTurns（選填）：之前每一輪「AI 呼叫了什麼工具＋查到的結果」，用正式的
  // assistant/tool 訊息格式接回對話，讓模型判斷「工具已經回覆過了」，不要再塞成文字。
  const askOnce = async (message, history, context, toolTurns) => {
    const deviceIdKey = "stockTrackerDeviceId";
    let deviceId = localStorage.getItem(deviceIdKey);
    if (!deviceId) { deviceId = `d_${uid()}_${uid()}`; localStorage.setItem(deviceIdKey, deviceId); }

    const baseBody = { message, history, context, allowGeminiPrivate: aiFallbackConfig?.allowPrivate === true };
    if (Array.isArray(toolTurns) && toolTurns.length > 0) baseBody.toolTurns = toolTurns;

    const callAskEndpoint = async (url, body, { fallback = false } = {}) => {
      const headers = { "content-type": "application/json", "x-device-id": deviceId };
      if (fallback && aiFallbackConfig?.token) headers["x-fallback-token"] = aiFallbackConfig.token;
      let res;
      try {
        res = await fetchWithTimeout(url, {
          method: "POST", headers, body: JSON.stringify(body), cache: "no-store",
        }, fallback ? 30000 : 20000);
      } catch (e) {
        const err = new Error(e?.name === "AbortError" ? "連線逾時" : (e?.message || "網路連線失敗"));
        err.status = 0;
        throw err;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const err = new Error(data?.error || `問答失敗（HTTP ${res.status}）`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    };

    try {
      return await callAskEndpoint("/ask", baseBody);
    } catch (primaryError) {
      const fallbackUrl = normalizeExternalAiAskUrl(aiFallbackConfig?.url);
      if (!fallbackUrl || !shouldUseExternalAiFallback(primaryError)) throw primaryError;

      const containsPrivateToolResult = Array.isArray(toolTurns) && toolTurns.some((turn) =>
        Array.isArray(turn?.calls) && turn.calls.some((tc) => tc?.name === "query_app_data")
      );
      if (containsPrivateToolResult && aiFallbackConfig?.allowPrivate !== true) {
        throw new Error("Cloudflare AI 已失敗；獨立 Gemini 備援可用，但這一輪包含私人資產查詢結果。請到『計畫設定 → AI 獨立備援』開啟私人資料授權後再試。");
      }

      const fallbackBody = {
        ...baseBody,
        context: aiFallbackConfig?.allowPrivate === true ? context : "",
      };
      try {
        const data = await callAskEndpoint(fallbackUrl, fallbackBody, { fallback: true });
        if (aiFallbackConfig?.allowPrivate !== true && Array.isArray(data?.toolCalls) && data.toolCalls.some((tc) => tc?.name === "query_app_data")) {
          throw new Error("這個問題需要讀取你的 App 私人資產資料；目前 Gemini 備援的私人資料授權是關閉的。請到『計畫設定 → AI 獨立備援』開啟後再試。");
        }
        return { ...data, provider: data.provider || "gemini-external", fallbackFrom: primaryError.message };
      } catch (fallbackError) {
        throw new Error(`Cloudflare AI：${primaryError.message}；獨立備援：${fallbackError.message}`);
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError("");
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setSending(true);

    try {
      const baseContext = buildPortfolioContext(holdings, goal, totalToday, totalInvested, trades, dailyRecords, dividends, planItems, planSchedule, goalDate, perf);
      // 確認卡片不算「文字對話」，送給 AI 的歷史紀錄只留一般文字訊息，避免格式搞亂它。
      const history = nextMessages.slice(0, -1).filter((m) => typeof m.content === "string");

      let data = await askOnce(text, history, baseContext);
      if (data?.provider) setProviderInfo({ provider: data.provider, model: data.model || "", profile: data.profile || "" });

      // 如果 AI 呼叫的是唯讀查詢工具，直接自動執行、把查到的結果用正式的 tool 訊息
      // 接回對話再幫它問一次，使用者完全不用介入；最多自動追問一輪，避免萬一 AI 一直
      // 要求查詢造成無限迴圈。toolTurns 會依序累積每一輪的呼叫+結果，一起送給 /ask。
      let rounds = 0;
      const toolTurns = [];
      const seenReadCalls = new Set();
      while (Array.isArray(data.toolCalls) && data.toolCalls.length > 0 && data.toolCalls.every((tc) => READ_TOOL_NAMES.includes(tc.name)) && rounds < 2) {
        const freshCalls = data.toolCalls.filter((tc) => {
          const key = `${tc.name}:${JSON.stringify(tc.arguments || {})}`;
          if (seenReadCalls.has(key)) return false;
          seenReadCalls.add(key);
          return true;
        });
        if (!freshCalls.length) break;
        const results = await Promise.all(freshCalls.map(async (tc) => ({
          id: tc.id,
          content: tc.name === "get_live_quotes"
            ? await executeLiveQuoteTool(tc, holdings)
            : executeReadTool(tc, { trades, dailyRecords, dividends, holdings }),
        })));
        toolTurns.push({ calls: freshCalls, results });
        data = await askOnce(text, history, baseContext, toolTurns);
        if (data?.provider) setProviderInfo({ provider: data.provider, model: data.model || "", profile: data.profile || "" });
        rounds += 1;
      }

      if (Array.isArray(data.toolCalls) && data.toolCalls.length > 0) {
        // 混到動作型工具（或自動查詢用完額度還是要查）的話，剩下的動作型工具照舊跳確認卡片。
        const actionCalls = data.toolCalls.filter((tc) => !READ_TOOL_NAMES.includes(tc.name));
        if (actionCalls.length > 0) {
          setMessages((m) => [
            ...m,
            ...actionCalls.map((tc) => ({ role: "assistant", toolCall: tc, status: "pending" })),
          ]);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: "AI 已取得查詢資料，但仍未完成回答。請直接重送同一個問題；不需要縮小日期範圍。" }]);
        }
      } else {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      }
    } catch (e) {
      setError(e?.message || "問答失敗，請稍後再試");
    } finally {
      setSending(false);
    }
  };

  // 實際寫入資料的地方 —— 只有使用者按下「確定」才會執行到這裡，AI 本身碰不到這段程式碼。
  const executeToolCall = (tc) => {
    const a = tc.arguments || {};
    switch (tc.name) {
      case "add_trade": {
        const shares = Number(a.shares), price = Number(a.price);
        const fee = Number(a.fee || 0), tax = Number(a.tax || 0);
        const amount = a.action === "sell" ? shares * price - fee - tax : shares * price + fee;
        setTrades((ts) => [...ts, {
          id: uid(),
          date: a.date || todayStr(),
          symbol: a.symbol, action: a.action === "sell" ? "sell" : "buy",
          shares, price, fee, tax, amount, note: a.note || "",
        }]);
        return { ok: true };
      }
      case "update_holding_target": {
        let found = false;
        setHoldings((hs) => hs.map((h) => {
          if (h.symbol === a.symbol) { found = true; return { ...h, target2035: Number(a.target) }; }
          return h;
        }));
        return found ? { ok: true } : { ok: false, message: `找不到 ${a.symbol} 這檔持股` };
      }
      case "update_manual_avg_cost": {
        let found = false;
        setHoldings((hs) => hs.map((h) => {
          if (h.symbol === a.symbol) {
            found = true;
            return { ...h, manualAvgCost: a.clear ? "" : Number(a.avgCost) };
          }
          return h;
        }));
        return found ? { ok: true } : { ok: false, message: `找不到 ${a.symbol} 這檔持股` };
      }
      case "update_goal": {
        setGoal((g) => ({
          ...g,
          targetAmount: a.targetAmount != null ? Number(a.targetAmount) : g.targetAmount,
          targetYear: a.targetYear != null ? Number(a.targetYear) : g.targetYear,
        }));
        return { ok: true };
      }
      default:
        return { ok: false, message: "不認得這個動作" };
    }
  };

  const confirmToolCall = (idx) => {
    const msg = messages[idx];
    const invalidReason = validateToolCall(msg.toolCall);
    if (invalidReason) {
      // 防呆：就算按鈕被繞過，這裡再擋一次，絕不讓資料不完整的動作真的寫進資料。
      setMessages((m) => m.map((mm, i) => i === idx ? { ...mm, status: "failed", failMessage: invalidReason } : mm));
      return;
    }
    const result = executeToolCall(msg.toolCall);
    setMessages((m) => m.map((mm, i) => i === idx
      ? { ...mm, status: result.ok ? "done" : "failed", failMessage: result.message }
      : mm));
  };

  const cancelToolCall = (idx) => {
    setMessages((m) => m.map((mm, i) => i === idx ? { ...mm, status: "cancelled" } : mm));
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="fixed z-40 rounded-full flex items-center justify-center"
        style={{
          right: 16, bottom: "calc(64px + env(safe-area-inset-bottom, 4px))",
          width: 52, height: 52, background: COLORS.gold, color: COLORS.bg,
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
        }}>
        <MessageCircle size={24} />
      </button>

      {open && (
        <div className="ai-panel-wrap fixed inset-x-0 bottom-0 z-50 flex flex-col justify-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="ai-panel-h flex flex-col rounded-t-2xl" style={{
            background: COLORS.bg,
            maxHeight: "100%",
            overflow: "hidden",
            boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
          }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${COLORS.panelBorder}`, paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }}>
              <div className="flex items-center gap-2 min-w-0">
                <div className="font-bold text-sm">專用投資顧問</div>
                {providerInfo && (() => {
                  const isGemini = String(providerInfo.provider || "").toLowerCase().includes("gemini");
                  return (
                    <div className="text-[9px] px-1.5 py-0.5 rounded-full truncate max-w-[170px]"
                      title={`${providerInfo.provider} · ${providerInfo.model}`}
                      style={{ color: isGemini ? COLORS.gold : COLORS.sub, border: `1px solid ${isGemini ? COLORS.gold : COLORS.panelBorder}` }}>
                      {isGemini ? "Gemini 獨立備援" : "GPT-OSS"}
                    </div>
                  );
                })()}
              </div>
              <button onClick={() => setOpen(false)} style={{ color: COLORS.sub }}><X size={20} /></button>
            </div>

            <div ref={scrollRef}
              className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 ${messages.length === 0 ? "flex items-center justify-center" : "space-y-3"}`}>
              {messages.length === 0 && (
                <div className="text-xs text-center" style={{ color: COLORS.sub }}>
                  可以問我你的持股、資產、配息、目標與市場；我會優先用 App 裡的實際資料幫你分析，也可以幫你記交易與調整目標
                </div>
              )}
              {messages.map((m, i) => {
                if (m.toolCall) {
                  const desc = describeToolCall(m.toolCall, holdings);
                  const invalidReason = m.status === "pending" ? validateToolCall(m.toolCall) : null;
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl px-3 py-2.5 text-sm"
                        style={{ background: COLORS.panel, border: `1px solid ${invalidReason ? COLORS.gain : COLORS.gold}` }}>
                        <div className="text-[11px] mb-1" style={{ color: invalidReason ? COLORS.gain : COLORS.gold }}>
                          {invalidReason ? "AI 想執行（資料看起來不完整）：" : "AI 想執行："}
                        </div>
                        <div className="leading-relaxed">{desc}</div>
                        {invalidReason && (
                          <div className="text-[11px] mt-1.5" style={{ color: COLORS.gain }}>⚠ {invalidReason}</div>
                        )}
                        {m.status === "pending" && (
                          <div className="flex gap-2 mt-2.5">
                            <button onClick={() => cancelToolCall(i)}
                              className="flex-1 rounded-lg py-1.5 text-xs font-bold"
                              style={{ background: COLORS.bg, border: `1px solid ${COLORS.panelBorder}`, color: COLORS.sub }}>
                              取消
                            </button>
                            <button onClick={() => confirmToolCall(i)} disabled={!!invalidReason}
                              className="flex-1 rounded-lg py-1.5 text-xs font-bold"
                              style={{ background: invalidReason ? COLORS.panelBorder : COLORS.gold, color: invalidReason ? COLORS.sub : COLORS.bg, opacity: invalidReason ? 0.6 : 1 }}>
                              確定執行
                            </button>
                          </div>
                        )}
                        {m.status === "done" && (
                          <div className="text-[11px] mt-2" style={{ color: COLORS.gain }}>✓ 已完成</div>
                        )}
                        {m.status === "failed" && (
                          <div className="text-[11px] mt-2" style={{ color: COLORS.gain }}>✗ 失敗：{m.failMessage}</div>
                        )}
                        {m.status === "cancelled" && (
                          <div className="text-[11px] mt-2" style={{ color: COLORS.sub }}>已取消</div>
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed"
                      style={{
                        background: m.role === "user" ? COLORS.gold : COLORS.panel,
                        color: m.role === "user" ? COLORS.bg : COLORS.text,
                        border: m.role === "user" ? "none" : `1px solid ${COLORS.panelBorder}`,
                      }}>
                      {m.content}
                    </div>
                  </div>
                );
              })}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl px-3 py-2 text-sm" style={{ background: COLORS.panel, color: COLORS.sub, border: `1px solid ${COLORS.panelBorder}` }}>
                    思考中…
                  </div>
                </div>
              )}
              {error && <div className="text-xs text-center" style={{ color: COLORS.gain }}>{error}</div>}
            </div>

            <div className="px-3 py-3 flex items-end gap-2"
              style={{ borderTop: `1px solid ${COLORS.panelBorder}`, paddingBottom: "calc(12px + env(safe-area-inset-bottom, 4px))" }}>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
                placeholder="輸入訊息…" rows={1}
                className="flex-1 rounded-xl px-3 py-2 text-sm resize-none"
                style={{ 
                  background: COLORS.panel, 
                  border: `1px solid ${COLORS.panelBorder}`, 
                  color: COLORS.text, 
                  outline: "none",
                  WebkitAppearance: "none",
                  lineHeight: "1.5",
                  minHeight: "44px",
                  overflow: "hidden",
                  WebkitBoxSizing: "border-box",
                  boxSizing: "border-box"
                }} />
              <button onClick={send} disabled={sending || !input.trim()}
                className="rounded-xl px-3 py-2.5 flex items-center justify-center"
                style={{ background: COLORS.gold, color: COLORS.bg, opacity: (sending || !input.trim()) ? 0.5 : 1 }}>
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AiChatWidget;
export { AiChatWidget };
