import { useState, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "./lib/icons.jsx";
import { APP_VERSION, BACKUP_SCHEMA_VERSION, TABS, COLORS } from "./lib/constants.js";
import { todayStr, loadXLSXLibrary, monthsBetween, addMonths, buildSchedule, findCrossing, loadKey, saveKey, isObject, inspectBackupPayload, defaultHoldings, defaultTrades, defaultDividends, defaultDailyRecords, defaultPlan, defaultPlanSchedule } from "./lib/helpers.js";
import { useLanguage } from "./lib/i18n.jsx";
import { Header } from "./components/Header.jsx";
import { Dashboard } from "./components/Dashboard.jsx";
import { DailyPanel } from "./components/DailyPanel.jsx";
import { HoldingsPanel } from "./components/HoldingsPanel.jsx";
import { TradesPanel } from "./components/TradesPanel.jsx";
import { DividendsPanel } from "./components/DividendsPanel.jsx";
import { PlanPanel } from "./components/PlanPanel.jsx";
import { ProgressPanel } from "./components/ProgressPanel.jsx";
import { AiChatWidget } from "./components/AiChatWidget.jsx";
import { TabBar } from "./components/TabBar.jsx";

function AssetTracker() {
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("dashboard");
  // Set (with a fresh object each time so the effect in DailyPanel re-fires
  // even if the same number is sent twice) when "記錄為今日資產" is pressed
  // on the dashboard — carries the fetched TW market value over to the
  // 每日紀錄 form so the user can add the US-side value and confirm together.
  const [dailyPrefill, setDailyPrefill] = useState(null);
  // Lifted out of DailyPanel itself: that panel only renders while
  // tab === "daily", so a useState inside it gets wiped every time you
  // switch away and back (e.g. going to 總覽 to fill market value, then to
  // 交易紀錄 to fill cost — each visit was resetting whatever the other one
  // had just filled in). Owning it here means it survives tab switches.
  const [dailyForm, setDailyForm] = useState({ date: todayStr(), twValue: "", usValue: "", twCost: "", usCost: "" });

  // 左右滑動切換分頁：只在明確的水平手勢時觸發，避免正常上下捲動誤換頁。
  // 從輸入框、按鈕、連結、圖表等互動區開始的手勢一律不接管。
  const swipeStartRef = useRef(null);
  const swipeBlockedRef = useRef(false);

  // 換頁動畫：仿 iPhone 主畫面切頁——舊、新兩頁接在一起變成一條「長條」，
  // 整條一起橫向平移一個畫面寬度，不是各自淡入淡出。這樣兩頁之間不會疊
  // 在一起看到底層的殘影，因為同一時間畫面上永遠只看得到「半條」內容。
  // transitionState 非 null 的這段期間，畫面上同時掛著新舊兩頁；
  // settled 控制的是「有沒有套用 transition + 移到定位」，靠兩次
  // requestAnimationFrame 確保瀏覽器先畫出起始位置、才套用動畫，
  // 不然兩個狀態擠在同一幀會被瀏覽器直接跳過，看起來就是瞬間切換。
  const [transitionState, setTransitionState] = useState(null); // { from, to, dir } | null
  const [settled, setSettled] = useState(true);
  const tabTransitionRaf1Ref = useRef(null);
  const tabTransitionRaf2Ref = useRef(null);

  // 統一的換頁入口：不管是滑手勢還是點下面的分頁按鈕，都走這裡，
  // 這樣兩種切換方式的動畫才會一致。
  const goToTab = (nextId) => {
    if (nextId === tab || transitionState) return;
    const fromIndex = TABS.findIndex((x) => x.id === tab);
    const toIndex = TABS.findIndex((x) => x.id === nextId);
    if (toIndex < 0) return;
    const dir = toIndex > fromIndex ? "left" : "right";
    setTransitionState({ from: tab, to: nextId, dir });
    setSettled(false);
    setTab(nextId);
  };

  useEffect(() => {
    if (!transitionState || settled) return;
    // 第一幀先讓瀏覽器畫出起點，第二幀才移到終點，CSS transition 才會真的跑。
    tabTransitionRaf1Ref.current = requestAnimationFrame(() => {
      tabTransitionRaf2Ref.current = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      if (tabTransitionRaf1Ref.current != null) cancelAnimationFrame(tabTransitionRaf1Ref.current);
      if (tabTransitionRaf2Ref.current != null) cancelAnimationFrame(tabTransitionRaf2Ref.current);
      tabTransitionRaf1Ref.current = null;
      tabTransitionRaf2Ref.current = null;
    };
  }, [transitionState, settled]);

  const onPageTouchStart = (e) => {
    if (!e.touches || e.touches.length !== 1) {
      swipeStartRef.current = null;
      swipeBlockedRef.current = true;
      return;
    }
    const target = e.target;
    swipeBlockedRef.current = Boolean(
      target?.closest?.('input, textarea, select, button, a, [role="button"], .recharts-wrapper, [data-no-page-swipe="true"]')
    );
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };

  const onPageTouchEnd = (e) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || swipeBlockedRef.current || !e.changedTouches || e.changedTouches.length !== 1) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // 至少滑 70px，而且水平位移要明顯大於垂直位移，才算換頁手勢。
    if (absX < 70 || absX < absY * 1.35) return;

    const currentIndex = TABS.findIndex((x) => x.id === tab);
    if (currentIndex < 0) return;

    // 左滑 = 下一頁；右滑 = 上一頁。第一頁/最後一頁不循環。
    const nextIndex = dx < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0 || nextIndex >= TABS.length) return;

    goToTab(TABS[nextIndex].id);
  };

  const [dailyRecords, setDailyRecords] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [trades, setTrades] = useState([]);
  const [dividends, setDividends] = useState([]);
  const [planItems, setPlanItems] = useState([]);
  const [goal, setGoal] = useState({ targetAmount: 10000000, targetYear: 2035 });
  const [planSchedule, setPlanSchedule] = useState(defaultPlanSchedule());
  // Starting cost basis, before any trade in the 交易紀錄 log — combined
  // with the running buy/sell total to get today's accumulated cost.
  const [costBasis, setCostBasis] = useState({ startingCost: 0 });
  const [lastBackupAt, setLastBackupAt] = useState(null);
  // Gemini 備援權限只控制是否把私人持股 context 交給 Gemini；API Key 永遠只留在 Cloudflare Worker Secret。
  const [aiFallbackConfig, setAiFallbackConfig] = useState({ url: "", token: "", allowPrivate: false });
  // 系統健康卡片：由 Cloudflare 背景排程（或手動觸發）產生，App 開啟時抓一次現況。
  // 只是顯示用的暫存狀態，不寫進 localStorage/JSON 備份——它本來就是伺服器端的資料。
  const [healthCards, setHealthCards] = useState([]);
  const [healthCardBusyId, setHealthCardBusyId] = useState("");

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      const [dr, h, t, dv, p, g, ps, cb, lba, afc] = await Promise.all([
        loadKey("dailyRecords", defaultDailyRecords()),
        loadKey("holdings", defaultHoldings()),
        loadKey("trades", defaultTrades()),
        loadKey("dividends", defaultDividends()),
        loadKey("planItems", defaultPlan()),
        loadKey("goal", { targetAmount: 10000000, targetYear: 2035 }),
        loadKey("planSchedule", defaultPlanSchedule()),
        loadKey("costBasis", { startingCost: 0 }),
        loadKey("lastBackupAt", null),
        loadKey("aiFallbackConfig", { url: "", token: "", allowPrivate: false }),
      ]);
      setDailyRecords(dr);
      setHoldings(h);
      setTrades(t);
      setDividends(dv);
      setPlanItems(p);
      setGoal(g);
      const defaultPs = defaultPlanSchedule();
      setPlanSchedule({
        ...defaultPs,
        ...ps,
        initialPrincipal: Number(ps?.initialPrincipal ?? ps?.initialCapital ?? defaultPs.initialPrincipal),
        initialAssets: Number(ps?.initialAssets ?? ps?.initialCapital ?? defaultPs.initialAssets),
      });
      setCostBasis(isObject(cb) ? { ...{ startingCost: 0 }, ...cb } : { startingCost: 0 });
      setLastBackupAt(typeof lba === "string" && Number.isFinite(Date.parse(lba)) ? lba : null);
      setAiFallbackConfig(isObject(afc) ? {
        url: String(afc.url || ""),
        token: String(afc.token || ""),
        allowPrivate: afc.allowPrivate === true,
      } : { url: "", token: "", allowPrivate: false });
      setReady(true);
    })();
  }, []);

  // ---- 系統健康卡片：App 開啟時抓一次現況，不需要密集輪詢 ----
  const fetchHealthCards = async () => {
    try {
      const res = await fetch("/api/health-cards", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      const cards = Array.isArray(data?.cards) ? data.cards : [];
      setHealthCards(cards.filter((c) => c?.status === "pending"));
    } catch {
      // 抓不到就算了，不要讓這個非必要功能影響主畫面；使用者下次開 App 再試一次即可。
    }
  };
  useEffect(() => { fetchHealthCards(); }, []);

  const respondHealthCard = async (id, action) => {
    setHealthCardBusyId(id);
    try {
      await fetch("/api/health-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      setHealthCards((cards) => cards.filter((c) => c.id !== id));
    } catch {
      // 送失敗就留著卡片，讓使用者可以再按一次。
    } finally {
      setHealthCardBusyId("");
    }
  };

  // ---- persist on change (after ready) ----
  useEffect(() => { if (ready) saveKey("dailyRecords", dailyRecords); }, [dailyRecords, ready]);
  useEffect(() => { if (ready) saveKey("holdings", holdings); }, [holdings, ready]);
  useEffect(() => { if (ready) saveKey("trades", trades); }, [trades, ready]);
  useEffect(() => { if (ready) saveKey("dividends", dividends); }, [dividends, ready]);
  useEffect(() => { if (ready) saveKey("planItems", planItems); }, [planItems, ready]);
  useEffect(() => { if (ready) saveKey("goal", goal); }, [goal, ready]);
  useEffect(() => { if (ready) saveKey("planSchedule", planSchedule); }, [planSchedule, ready]);
  useEffect(() => { if (ready) saveKey("costBasis", costBasis); }, [costBasis, ready]);
  useEffect(() => { if (ready) saveKey("aiFallbackConfig", aiFallbackConfig); }, [aiFallbackConfig, ready]);


  // ---- full backup / restore ----
  const exportBackup = () => {
    const exportedAt = new Date().toISOString();
    const payload = {
      app: "存股資產追蹤",
      appVersion: APP_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt,
      data: { dailyRecords, holdings, trades, dividends, planItems, goal, planSchedule, costBasis },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t("存股資產追蹤")}_${t("備份")}_${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setLastBackupAt(exportedAt);
    saveKey("lastBackupAt", exportedAt);
  };

  const exportExcel = async () => {
    let XLSX;
    try {
      XLSX = await loadXLSXLibrary();
    } catch (e) {
      window.alert(t("Excel 匯出元件載入失敗，請確認網路後再試一次。"));
      return;
    }

    const wb = XLSX.utils.book_new();

    const dailyRows = [...dailyRecords]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        日期: r.date,
        台股市值: Number(r.twValue || 0),
        美股市值: Number(r.usValue || 0),
        總市值: Number(r.twValue || 0) + Number(r.usValue || 0),
        台股成本: Number(r.twCost || 0),
        美股成本: Number(r.usCost || 0),
        總成本: Number(r.twCost || 0) + Number(r.usCost || 0),
      }));

    const tradeRows = [...trades]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((t) => ({
        日期: t.date,
        代號: t.symbol,
        買賣: t.action === "buy" ? "買" : "賣",
        股數: Number(t.shares || 0),
        成交價: Number(t.price || 0),
        手續費: Number(t.fee || 0),
        交易稅: Number(t.tax || 0),
        交易金額: Number(t.amount || 0),
        備註: t.note || "",
      }));

    const dividendRows = [...dividends]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        除息日: d.date,
        代號: d.symbol,
        股數: Number(d.shares || 0),
        每股配息: Number(d.perShare || 0),
        配息總額: Number(d.amount || 0),
      }));

    const holdingRows = holdings.map((h) => {
      const netShares = trades
        .filter((t) => t.symbol === h.symbol)
        .reduce((sum, t) => sum + (t.action === "buy" ? Number(t.shares || 0) : -Number(t.shares || 0)), 0);
      const current = Number(h.initialShares || 0) + netShares;
      const target = Number(h.target2035 || 0);
      return {
        代號: h.symbol,
        名稱: h.name || "",
        期初股數: Number(h.initialShares || 0),
        目前股數: current,
        "2035目標股數": target,
        尚缺股數: Math.max(0, target - current),
        達成率: target > 0 ? current / target : 0,
      };
    });

    const planRows = planItems.map((p) => ({
      代號: p.symbol,
      每月投入: Number(p.amount || 0),
      備註: p.note || "",
    }));

    const summaryRows = [
      { 項目: "匯出日期", 資料: todayStr() },
      { 項目: "App版本", 資料: APP_VERSION },
      { 項目: "退休目標金額", 資料: Number(goal.targetAmount || 0) },
      { 項目: "退休目標年份", 資料: Number(goal.targetYear || 0) },
      { 項目: "起始成本", 資料: Number(costBasis?.startingCost || 0) },
      { 項目: "目前累積成本", 資料: Number(accumulatedCost || 0) },
      { 項目: "累積配息", 資料: dividends.reduce((sum, d) => sum + Number(d.amount || 0), 0) },
    ];

    const addSheet = (name, rows, widths) => {
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 資料: "尚無紀錄" }]);
      if (widths) ws["!cols"] = widths.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    addSheet("摘要", summaryRows, [20, 20]);
    addSheet("每日紀錄", dailyRows, [12, 14, 14, 14, 14, 14, 14]);
    addSheet("交易紀錄", tradeRows, [12, 10, 8, 10, 10, 10, 10, 14, 28]);
    addSheet("配息紀錄", dividendRows, [12, 10, 12, 12, 14]);
    addSheet("持股進度", holdingRows, [10, 18, 12, 12, 14, 12, 12]);
    addSheet("計畫設定", planRows, [10, 14, 28]);

    // 持股進度的達成率欄改成 Excel 百分比格式。
    const holdingSheet = wb.Sheets["持股進度"];
    if (holdingSheet && holdingRows.length) {
      for (let row = 2; row <= holdingRows.length + 1; row++) {
        const cell = holdingSheet[`G${row}`];
        if (cell) cell.z = "0.0%";
      }
    }

    XLSX.writeFile(wb, `${t("存股資產追蹤")}_${todayStr()}.xlsx`);
  };

  const importBackup = async (file) => {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const check = inspectBackupPayload(payload);
      if (!check.ok) {
        const shown = check.errors.slice(0, 8).map((x) => `• ${t(x)}`).join("\n");
        const more = check.errors.length > 8 ? t("\n…另有 {n} 項", { n: check.errors.length - 8 }) : "";
        window.alert(t("備份檔深度驗證失敗，資料未變更。\n\n{shown}{more}", { shown, more }));
        return;
      }
      if (check.warnings.length) {
        const shown = check.warnings.map((x) => `• ${t(x)}`).join("\n");
        if (!window.confirm(t("備份檔可匯入，但有提醒：\n\n{shown}\n\n仍要繼續嗎？", { shown }))) return;
      }
      if (!window.confirm(t("匯入會以備份內容取代目前 App 內的資料，確定要繼續嗎？"))) return;
      const data = check.data;
      setDailyRecords(data.dailyRecords);
      setHoldings(data.holdings);
      setTrades(data.trades);
      setDividends(data.dividends);
      setPlanItems(data.planItems);
      setGoal(data.goal);
      const defaultPs = defaultPlanSchedule();
      const importedPs = data.planSchedule || {};
      setPlanSchedule({
        ...defaultPs,
        ...importedPs,
        initialPrincipal: Number(importedPs.initialPrincipal ?? importedPs.initialCapital ?? defaultPs.initialPrincipal),
        initialAssets: Number(importedPs.initialAssets ?? importedPs.initialCapital ?? defaultPs.initialAssets),
      });
      // schema 1 沒有 costBasis；保留目前值，不用 0 覆蓋。schema 2 才完整還原。
      if (check.schemaVersion >= 2 && isObject(data.costBasis)) setCostBasis(data.costBasis);
      if (typeof payload.exportedAt === "string" && Number.isFinite(Date.parse(payload.exportedAt))) {
        setLastBackupAt(payload.exportedAt);
        saveKey("lastBackupAt", payload.exportedAt);
      }
      window.alert(t("備份已匯入完成（schema {v}）。建議重新整理一次頁面確認資料。", { v: check.schemaVersion }));
    } catch (e) {
      console.error("backup import failed", e);
      window.alert(t("備份檔讀取失敗，資料未變更。"));
    }
  };

  // ---- derived ----
  const sortedDaily = useMemo(
    () => [...dailyRecords].sort((a, b) => a.date.localeCompare(b.date)),
    [dailyRecords]
  );
  const latest = sortedDaily[sortedDaily.length - 1];
  const prev = sortedDaily[sortedDaily.length - 2];
  const totalToday = latest ? latest.twValue + latest.usValue : 0;
  const totalPrev = prev ? prev.twValue + prev.usValue : null;
  const dailyChange = totalPrev != null ? totalToday - totalPrev : 0;
  const dailyChangePct = totalPrev ? (dailyChange / totalPrev) * 100 : 0;

  const tradesInvested = trades.reduce(
    (s, t) => s + (t.action === "buy" ? t.amount : -t.amount), 0
  );
  // Running cost basis: starting cost plus every buy (+) / sell (-) since.
  const accumulatedCost = Number(costBasis.startingCost || 0) + tradesInvested;
  // 目前持倉成本優先取自「每日紀錄」的台股成本+美股成本
  // 沒有填成本欄位時，才退回用交易紀錄淨買入金額估算
  const latestCost = latest ? (latest.twCost || 0) + (latest.usCost || 0) : 0;
  const totalInvested = latestCost > 0 ? latestCost : tradesInvested;
  const totalDividends = dividends.reduce((s, d) => s + d.amount, 0);
  const capitalGain = totalToday - totalInvested;
  const totalReturn = capitalGain + totalDividends;
  const totalReturnPct = totalInvested ? (totalReturn / totalInvested) * 100 : 0;

  const highPoint = sortedDaily.reduce((max, r) => {
    const v = r.twValue + r.usValue;
    return v > max.value ? { value: v, date: r.date } : max;
  }, { value: -Infinity, date: null });
  const drawdown = highPoint.value > 0 ? ((totalToday - highPoint.value) / highPoint.value) * 100 : 0;

  const chartData = sortedDaily.map((r) => ({
    date: r.date.slice(2),
    t: new Date(r.date).getTime(),
    total: r.twValue + r.usValue,
  }));

  // 昨日台股市值：抓最近一筆日期在「今天」之前的每日紀錄的 twValue。
  // 用來在「即時股價」面板算「今/昨日盈虧」——比較的是你自己台股持股的市值，
  // 不是單一股票的漲跌幅。
  const yesterdayTwRecord = [...sortedDaily].reverse().find((r) => r.date < todayStr());
  const yesterdayTwValue = yesterdayTwRecord ? yesterdayTwRecord.twValue : null;

  // "今年資產變化(YTD)" — market-value change since the start of the current
  // calendar year. Like the other stat cards, this is value-based, not a
  // cost-adjusted/time-weighted return: it doesn't separate new
  // contributions from investment gains. Baseline is the last record on or
  // before Jan 1 of this year; if tracking only started sometime this year,
  // falls back to the very first record so the number stays meaningful.
  const ytdBase = (() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    let base = null;
    for (let i = chartData.length - 1; i >= 0; i--) {
      if (chartData[i].t <= yearStart) { base = chartData[i]; break; }
    }
    return base || chartData[0] || null;
  })();
  const ytdGain = ytdBase ? totalToday - ytdBase.total : 0;
  const ytdPct = ytdBase && ytdBase.total ? (ytdGain / ytdBase.total) * 100 : 0;

  const holdingsWithShares = useMemo(() => holdings.map((h) => {
    const bought = trades.filter((t) => t.symbol === h.symbol && t.action === "buy")
      .reduce((s, t) => s + t.shares, 0);
    const sold = trades.filter((t) => t.symbol === h.symbol && t.action === "sell")
      .reduce((s, t) => s + t.shares, 0);
    const current = h.initialShares + bought - sold;
    const pct = h.target2035 ? Math.min(100, (current / h.target2035) * 100) : 0;

    // 持有成本用「快照＋往後疊加」的方式算：
    // costOverride = { amount, asOfDate, asOfShares } 記錄「在 asOfDate 這天，
    // 手動輸入的總持有成本是 amount，當時股數是 asOfShares」。
    // 之後只會把「asOfDate 之後」的買賣紀錄疊加上去（用移動加權平均法），
    // 不會重複計算 asOfDate（含）當天以前已經發生、已經算進 amount 裡的交易。
    // 平均成本＝疊加後的持有成本 ÷ 股數，用倒算的，不用另外手動輸入均價。
    // 沒有設定過 costOverride 的舊資料，預設等同「一開始（很久以前）成本 0、
    // 股數＝期初股數」，等於整段交易紀錄都照算，跟改版前的行為一致。
    const symbolTrades = trades
      .filter((t) => t.symbol === h.symbol)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    const hasOverride = h.costOverride && Number.isFinite(Number(h.costOverride.amount));
    const overrideAsOfDate = hasOverride ? (h.costOverride.asOfDate || "0000-01-01") : "0000-01-01";
    let runningShares = hasOverride ? Number(h.costOverride.asOfShares || 0) : Number(h.initialShares || 0);
    let runningCost = hasOverride ? Number(h.costOverride.amount || 0) : 0;
    const laterTrades = symbolTrades.filter((t) => t.date > overrideAsOfDate);
    let runningSharesNoFee = 0, runningCostNoFee = 0; // 不含手續費，算「成交均價」用，永遠用全部交易紀錄
    for (const t of laterTrades) {
      if (t.action === "buy") {
        runningCost += t.shares * t.price + Number(t.fee || 0);
        runningShares += t.shares;
      } else {
        if (runningShares > 0) {
          const avgPerShare = runningCost / runningShares;
          const sellShares = Math.min(t.shares, runningShares);
          runningCost -= avgPerShare * sellShares;
          runningShares -= sellShares;
        }
      }
    }
    for (const t of symbolTrades) {
      if (t.action === "buy") {
        runningCostNoFee += t.shares * t.price;
        runningSharesNoFee += t.shares;
      } else if (runningSharesNoFee > 0) {
        const avgPerShareNoFee = runningCostNoFee / runningSharesNoFee;
        const sellSharesNoFee = Math.min(t.shares, runningSharesNoFee);
        runningCostNoFee -= avgPerShareNoFee * sellSharesNoFee;
        runningSharesNoFee -= sellSharesNoFee;
      }
    }
    const autoAvgCost = runningShares > 0 ? runningCost / runningShares : null;
    const avgTradePrice = runningSharesNoFee > 0 ? runningCostNoFee / runningSharesNoFee : null; // 不含手續費的成交均價

    // 舊版相容：更早的版本是直接手動輸入「平均成本」整個覆蓋掉自動計算，且不會隨新交易更新。
    // 現在編輯持股改成填「持有成本」快照，這裡只保留讀取舊資料／AI 指令相容用途。
    const manualAvgCost = Number(h.manualAvgCost);
    const hasManualAvgCost = h.manualAvgCost !== undefined && h.manualAvgCost !== "" && Number.isFinite(manualAvgCost) && manualAvgCost > 0;
    const avgCost = hasManualAvgCost ? manualAvgCost : autoAvgCost;
    const estCostBasis = hasManualAvgCost
      ? (avgCost != null ? Math.round(avgCost * current) : null)
      : (runningShares > 0 || runningCost > 0 ? Math.round(runningCost) : null);



    // 本季（自然季度：1-3月/4-6月/7-9月/10-12月）淨增加股數，過季就歸零重算。
    const now = new Date();
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3; // 0, 3, 6, 9
    const quarterStartStr = `${now.getFullYear()}-${String(qStartMonth + 1).padStart(2, "0")}-01`;
    const quarterNum = qStartMonth / 3 + 1;
    const quarterSharesAdded = symbolTrades
      .filter((t) => t.date >= quarterStartStr)
      .reduce((s, t) => s + (t.action === "buy" ? t.shares : -t.shares), 0);

    // 今年累計（自然年：1/1 起算）淨增加股數，跨年就歸零重算。
    const yearStartStr = `${now.getFullYear()}-01-01`;
    const yearSharesAdded = symbolTrades
      .filter((t) => t.date >= yearStartStr)
      .reduce((s, t) => s + (t.action === "buy" ? t.shares : -t.shares), 0);

    // 推估離目標股數還要多久：用「從第一筆交易到今天」的實際淨增加股數，
    // 算出平均每月增加速度，再用剩餘股數 ÷ 這個速度，推算預估達成日期（精確到日）。
    // 完全依實際交易紀錄，不是用假設報酬率或投入金額去猜。
    let projectedLabel = null;
    if (h.target2035 > 0) {
      if (current >= h.target2035) {
        projectedLabel = t("已達成");
      } else if (symbolTrades.length > 0) {
        const firstTradeDate = new Date(symbolTrades[0].date);
        const daysSpan = Math.max(1, (now - firstTradeDate) / 86400000);
        const monthsSpan = Math.max(1 / 30.44, daysSpan / 30.44); // 至少抓約1天，避免除以0
        const netFromTrades = bought - sold;
        const monthlyPace = netFromTrades / monthsSpan;
        if (monthlyPace > 0) {
          const remaining = h.target2035 - current;
          const monthsNeeded = remaining / monthlyPace;
          const target = new Date(now.getTime() + monthsNeeded * 30.44 * 86400000);
          const y = target.getFullYear();
          const m = String(target.getMonth() + 1).padStart(2, "0");
          projectedLabel = t("預定 {y}/{m}", { y, m });
        } else {
          projectedLabel = t("無法推估");
        }
      } else {
        projectedLabel = t("無法推估");
      }
    }

    return {
      ...h, bought, sold, current, pct, avgCost, estCostBasis, isManualAvgCost: hasManualAvgCost, avgTradePrice,
      quarterSharesAdded, quarterNum, yearSharesAdded, projectedLabel,
    };
  }), [holdings, trades, t]);

  const planTotal = planItems.reduce((s, p) => s + Number(p.amount || 0), 0);

  const schedule = useMemo(() => buildSchedule(planSchedule), [planSchedule]);
  const principalCrossing = useMemo(
    () => findCrossing(schedule, "principal", totalInvested), [schedule, totalInvested]
  );
  const assetCrossing = useMemo(
    () => findCrossing(schedule, "assets", totalToday), [schedule, totalToday]
  );
  // Same schedule, but against the stated goal amount instead of today's
  // asset total — gives an estimated goal-completion date to show in the
  // header, reusing the same projection already used in "計畫進度".
  const goalCrossing = useMemo(
    () => findCrossing(schedule, "assets", goal.targetAmount), [schedule, goal.targetAmount]
  );
  const goalDate = goalCrossing && !goalCrossing.beyond
    ? addMonths(planSchedule.startDate, goalCrossing.index) : null;
  const elapsedMonths = monthsBetween(planSchedule.startDate, latest ? latest.date : todayStr());
  // 分別看「成本進度」「資產進度」各自比「計畫已執行的月數」超前或落後幾個月，
  // 而不是拿這兩個基準點數字不同的東西互相相減（那樣算出來的正負號常常會誤導人）。
  // 正值＝實際數字比排程預期的還早達到（領先），負值＝比預期晚達到（落後）。
  const costLeadMonths = (principalCrossing && elapsedMonths != null)
    ? principalCrossing.index - elapsedMonths : null;
  const assetLeadMonths = (assetCrossing && elapsedMonths != null)
    ? assetCrossing.index - elapsedMonths : null;

  // Milestone celebration: show a one-time toast the first time total assets
  // cross 50% / 80% / 100% of the goal. celebratedMilestones is persisted so
  // it doesn't fire again on every reload once a milestone has been hit.
  const [celebratedMilestones, setCelebratedMilestones] = useState(null); // null = not loaded yet
  const [celebration, setCelebration] = useState(null);
  useEffect(() => {
    (async () => {
      const saved = await loadKey("celebratedMilestones", []);
      setCelebratedMilestones(saved);
    })();
  }, []);
  useEffect(() => {
    if (!ready || celebratedMilestones === null || !goal.targetAmount) return;
    const pct = (totalToday / goal.targetAmount) * 100;
    const milestones = [50, 80, 100];
    const next = milestones.find((m) => pct >= m && !celebratedMilestones.includes(m));
    if (next) {
      const updated = [...celebratedMilestones, next];
      setCelebratedMilestones(updated);
      saveKey("celebratedMilestones", updated);
      setCelebration(next);
      setTimeout(() => setCelebration(null), 3200);
    }
  }, [totalToday, goal.targetAmount, ready, celebratedMilestones]);

  const backupAgeDays = lastBackupAt && Number.isFinite(Date.parse(lastBackupAt))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86400000))
    : null;
  const backupOverdue = backupAgeDays == null || backupAgeDays >= 7;

  // <main> 最小高度：量測 Header + TabBar 實際高度，讓每個分頁至少撐滿一個
  // 螢幕高度，不會因為內容多寡（例如「配息」頁常常內容很少）忽高忽低——
  // 這在剛做完的左右滑頁動畫下特別重要，不然兩頁高度差太多，切換時看起來
  // 會很不順。用實際量測、不是寫死一個數字，是因為 Header 高度本身會變
  // （備份逾期警告出現時會多一行），寫死的數字只要警告一跳出來就會不準。
  const headerRef = useRef(null);
  const tabBarRef = useRef(null);
  const [mainMinHeight, setMainMinHeight] = useState(null);

  useEffect(() => {
    const measure = () => {
      const headerH = headerRef.current?.offsetHeight || 0;
      const tabBarH = tabBarRef.current?.offsetHeight || 0;
      const viewportH = window.visualViewport?.height || window.innerHeight;
      setMainMinHeight(Math.max(0, viewportH - headerH - tabBarH));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && headerRef.current) ro.observe(headerRef.current);
    if (ro && tabBarRef.current) ro.observe(tabBarRef.current);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [backupOverdue]);

  if (!ready) {
    return (
      <div style={{ background: COLORS.bg, color: COLORS.sub }}
        className="min-h-screen flex items-center justify-center gap-2 font-sans">
        <Loader2 className="animate-spin" size={20} />
        <span>{t("載入中…")}</span>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text }}
      className="min-h-screen font-sans pb-24">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { font-family: 'Noto Sans TC', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes celebrate-in {
          0% { opacity: 0; transform: translate(-50%, -12px) scale(0.9); }
          100% { opacity: 1; transform: translate(-50%, 0) scale(1); }
        }
      `}</style>

      {celebration && (
        <div className="fixed top-4 left-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-bold flex items-center gap-2"
          style={{
            transform: "translateX(-50%)", background: COLORS.gold, color: COLORS.bg,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)", animation: "celebrate-in 0.35s ease-out",
          }}>
          🎉 {t("已達成目標 {pct}%！", { pct: celebration })}
        </div>
      )}

      <div ref={headerRef}>
        <Header goal={goal} totalToday={totalToday} goalDate={goalDate} backupOverdue={backupOverdue} backupAgeDays={backupAgeDays} />
      </div>

      <main
        className="relative px-4 pt-4 pb-24 max-w-2xl mx-auto overflow-x-hidden"
        style={{ touchAction: "pan-y", ...(mainMinHeight != null ? { minHeight: `${mainMinHeight}px` } : {}) }}
        onTouchStart={onPageTouchStart}
        onTouchEnd={onPageTouchEnd}
      >
        {(() => {
          const renderTabContent = (id) => {
            switch (id) {
              case "dashboard":
                return (
                  <Dashboard
                    totalToday={totalToday} dailyChange={dailyChange} dailyChangePct={dailyChangePct}
                    capitalGain={capitalGain} totalDividends={totalDividends} totalReturn={totalReturn}
                    totalReturnPct={totalReturnPct} highPoint={highPoint} drawdown={drawdown}
                    ytdGain={ytdGain} ytdPct={ytdPct}
                    chartData={chartData} goal={goal} totalInvested={totalInvested}
                    holdings={holdingsWithShares} yesterdayTwValue={yesterdayTwValue}
                    onFillDailyTw={(value) => { setDailyPrefill({ twValue: value, nonce: Date.now() }); goToTab("daily"); }}
                  />
                );
              case "daily":
                return (
                  <DailyPanel records={sortedDaily} setRecords={setDailyRecords} prefill={dailyPrefill}
                    form={dailyForm} setForm={setDailyForm} />
                );
              case "holdings":
                return (
                  <HoldingsPanel holdings={holdingsWithShares} setHoldings={setHoldings}
                    onFillDailyCost={(value) => { setDailyPrefill({ twCost: value, nonce: Date.now() }); goToTab("daily"); }}
                  />
                );
              case "trades":
                return (
                  <TradesPanel trades={trades} setTrades={setTrades} holdings={holdings}
                    costBasis={costBasis} setCostBasis={setCostBasis} accumulatedCost={accumulatedCost}
                    onFillDailyCost={(value) => { setDailyPrefill({ twCost: value, nonce: Date.now() }); goToTab("daily"); }}
                  />
                );
              case "dividends":
                return (
                  <DividendsPanel dividends={dividends} setDividends={setDividends} holdings={holdingsWithShares} />
                );
              case "plan":
                return (
                  <PlanPanel planItems={planItems} setPlanItems={setPlanItems}
                    planTotal={planTotal} goal={goal} setGoal={setGoal}
                    exportBackup={exportBackup} importBackup={importBackup} exportExcel={exportExcel} lastBackupAt={lastBackupAt} backupAgeDays={backupAgeDays} backupOverdue={backupOverdue}
                    aiFallbackConfig={aiFallbackConfig} setAiFallbackConfig={setAiFallbackConfig}
                    healthCards={healthCards} healthCardBusyId={healthCardBusyId} respondHealthCard={respondHealthCard} />
                );
              case "progress":
                return (
                  <ProgressPanel
                    planSchedule={planSchedule} setPlanSchedule={setPlanSchedule}
                    planTotal={planTotal} schedule={schedule}
                    totalInvested={totalInvested} totalToday={totalToday}
                    principalCrossing={principalCrossing} assetCrossing={assetCrossing}
                    elapsedMonths={elapsedMonths} costLeadMonths={costLeadMonths} assetLeadMonths={assetLeadMonths}
                  />
                );
              default:
                return null;
            }
          };
          // 兩種狀態（換頁動畫中／靜止）統一用同一組長條結構渲染，只差在靜止時
          // 長條只有一格、寬度 100%。這樣做是刻意的：如果動畫結束那一刻切去
          // 另一組完全不同的 DOM 結構，React 會認不出「這其實是同一個分頁」，
          // 直接把剛滑到的分頁整個重新掛載一次——如果那個分頁裡有圖表（像
          // 「總覽」的資產曲線），重新掛載就會讓圖表的進場動畫重播一次，
          // 看起來就是「滑到後閃一下」。每一格都加上 key={id}，讓 React
          // 兩種狀態之間能認出同一個分頁、不用重新掛載，這個閃爍就不會發生。
          const panelIds = transitionState
            ? (transitionState.dir === "left" ? [transitionState.from, transitionState.to] : [transitionState.to, transitionState.from])
            : [tab];
          const stripWidthPct = panelIds.length === 2 ? "200%" : "100%";
          const childWidthPct = panelIds.length === 2 ? "50%" : "100%";
          let offsetPct = "0%";
          if (transitionState) {
            const startOffset = transitionState.dir === "left" ? "0%" : "-50%";
            const endOffset = transitionState.dir === "left" ? "-50%" : "0%";
            offsetPct = settled ? endOffset : startOffset;
          }
          return (
            <div style={{ overflow: "hidden", position: "relative" }}>
              <div
                onTransitionEnd={(e) => {
                  if (e.propertyName === "transform" && transitionState) setTransitionState(null);
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  width: stripWidthPct,
                  transform: `translate3d(${offsetPct}, 0, 0)`,
                  transition: transitionState && settled ? "transform 0.28s cubic-bezier(.22,.61,.36,1)" : "none",
                  willChange: transitionState ? "transform" : "auto",
                  WebkitBackfaceVisibility: "hidden",
                  backfaceVisibility: "hidden",
                  WebkitPerspective: 1000,
                  perspective: 1000,
                }}>
                {panelIds.map((id) => (
                  <div key={id} style={{
                    width: childWidthPct, flexShrink: 0, minWidth: 0,
                    WebkitTransform: "translateZ(0)", transform: "translateZ(0)",
                  }}>
                    {renderTabContent(id)}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </main>

      <AiChatWidget holdings={holdingsWithShares} goal={goal} totalToday={totalToday} totalInvested={totalInvested}
        trades={trades} setTrades={setTrades} setHoldings={setHoldings} setGoal={setGoal}
        dailyRecords={dailyRecords} dividends={dividends} planItems={planItems} planSchedule={planSchedule}
        goalDate={goalDate} aiFallbackConfig={aiFallbackConfig}
        perf={{
          capitalGain, totalDividends, totalReturn, totalReturnPct, highPoint, drawdown, ytdGain, ytdPct,
          elapsedMonths, costLeadMonths, assetLeadMonths, startingCost: costBasis?.startingCost,
        }} />

      <TabBar tab={tab} setTab={goToTab} rootRef={tabBarRef} />
    </div>
  );
}

// ---------------- Header ----------------

export default AssetTracker;
