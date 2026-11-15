// 手機版面（2026-11-12，依 stack-app-fable52-design-v2 設計稿、6 項取捨照建議）：只在 ≤767px 換排列，≥768px 維持 #86 現況。
// 只改外觀與排列，不碰計算、資料、API；AI 仍只走 Puter。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const jsx = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");
const fn = (name) => {
  const a = jsx.indexOf(`function ${name}(`);
  assert.ok(a >= 0, `${name} exists`);
  return jsx.slice(a, jsx.indexOf("\nfunction ", a + 10));
};
const MARK = "/* ════ 手機版面 2026-11-12";
const mobileCss = css.slice(css.indexOf(MARK));
// 去掉註解後，逐一取出頂層區塊（@media …{…}）
const topLevelBlocks = (src) => {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let depth = 0, start = -1, head = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") { if (depth === 0) start = head; depth++; }
    else if (s[i] === "}") { depth--; if (depth === 0) { out.push(s.slice(start, i + 1).trim()); head = i + 1; } }
  }
  return { blocks: out, rest: s.slice(head).trim() };
};
const ruleBody = (selectorEnd) => {
  const i = mobileCss.indexOf(selectorEnd + "{");
  assert.ok(i >= 0, selectorEnd);
  return mobileCss.slice(i + selectorEnd.length + 1, mobileCss.indexOf("}", i));
};

test("all new mobile CSS lives inside max-width:767px media queries (≥768px keeps #86 as-is) and never uses CSS order", () => {
  assert.ok(mobileCss.length > 1000, "mobile block found at the end of clean.css");
  const { blocks, rest } = topLevelBlocks(mobileCss);
  assert.equal(rest, "", "nothing outside a block");
  assert.ok(blocks.length >= 2);
  for (const b of blocks) assert.match(b, /^@media \(max-width:767px\)/, b.slice(0, 80));
  assert.doesNotMatch(mobileCss.replace(/\/\*[\s\S]*?\*\//g, ""), /(^|[;{\s])order\s*:/, "no CSS order used to reshuffle content");
  assert.doesNotMatch(mobileCss, /min-width:768px/);
});

test("JS layout switch is the same 767px breakpoint and listens for changes", () => {
  assert.match(jsx, /const MOBILE_LAYOUT_QUERY = "\(max-width: 767px\)";/);
  const hook = fn("useIsMobileLayout");
  assert.match(hook, /mq\.addEventListener\("change", on\)/);
  assert.match(hook, /mq\.removeEventListener\("change", on\)/);
});

test("新增列加號：32×32 正圓（border-radius:50%、寬高與上下限都是 32px），不是膠囊", () => {
  const body = ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-composer-plus');
  const decl = Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const k = d.indexOf(":"); return [d.slice(0, k).trim(), d.slice(k + 1).trim()]; }));
  for (const k of ["width", "height", "min-width", "max-width", "min-height", "max-height"]) assert.equal(decl[k], "32px", k);
  assert.equal(decl["aspect-ratio"], "1");
  assert.equal(decl["border-radius"], "50%");
  assert.equal(decl.flex, "0 0 32px");
  assert.equal(decl.padding, "0", "no padding that could stretch it into a pill");
  assert.doesNotMatch(body, /999px/);
  // 展開時轉 45° 變成關閉，仍是同一顆圓
  assert.match(mobileCss, /\.forma-composer\.is-open \.forma-composer-plus\{[^}]*transform:rotate\(45deg\)/);
  assert.doesNotMatch(mobileCss.match(/\.forma-composer\.is-open \.forma-composer-plus\{[^}]*\}/)[0], /width|height|border-radius/);
  // 整列約 56px
  assert.match(ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-composer-row'), /min-height:56px/);
  // JSX：加號是 span 裡放 Plus 圖示
  assert.match(fn("ComposerFold"), /<span className="forma-composer-plus" aria-hidden="true"><Plus size=\{18\} \/><\/span>/);
});

test("ComposerFold：有紀錄先收合、沒有紀錄預設展開、送出成功（筆數變多）收回；≥768px 直接回傳原本表單", () => {
  const cf = fn("ComposerFold");
  assert.match(cf, /const \[open, setOpen\] = useState\(\(\) => kind === "add" && !\(Number\(count\) > 0\)\);/);
  assert.match(cf, /if \(n > prevCount\.current\) setOpen\(false\);/);
  assert.match(cf, /else if \(n === 0 && prevCount\.current > 0\) setOpen\(true\);/);
  assert.match(cf, /if \(!mobile\) return children;/);
  assert.match(cf, /aria-expanded=\{open\} aria-controls=\{bodyId\}/);
  assert.match(cf, /\{open && <div id=\{bodyId\} className="forma-composer-body">\{children\}<\/div>\}/);
  // 三處新增表單都包起來，筆數用各自的紀錄數
  assert.match(fn("TradesPanel"), /<ComposerFold label="新增交易" hint="[^"]+" count=\{trades\.length\}>\s*<Panel title="新增交易">/);
  assert.match(fn("DividendsPanel"), /<ComposerFold label="新增配息" hint="[^"]+" count=\{dividends\.length\}>\s*<Panel title="新增配息">/);
  assert.match(fn("HoldingsPanel"), /<ComposerFold label="新增持股" hint="[^"]+" count=\{holdings\.length\}>\s*<Panel title="新增持股標的">/);
  // 每日：今天的紀錄維持展開；區間查詢收成一列（kind="fold"，預設收起）
  const daily = fn("DailyPanel");
  assert.doesNotMatch(daily.slice(0, daily.indexOf('<Panel title="今天的紀錄">') + 30), /ComposerFold/);
  assert.match(daily, /<ComposerFold kind="fold" label="區間查詢" hint="[^"]+">\s*<Panel title="區間查詢（精算，非AI）">/);
  // 展開後表單的標題由新增列代替，卡片外框拿掉（只在手機）
  assert.match(mobileCss, /\.forma-composer>\.forma-composer-body>\.premium-panel>\.premium-panel-title\{display:none!important\}/);
});

test("配息頁（手機）：新增列 → 股息報表 → 配息紀錄 → 歷史圖；桌面維持報表 → 歷史圖 → 紀錄。用 DOM 順序，不用 CSS order", () => {
  const dp = fn("DividendsPanel");
  const ret = dp.slice(dp.indexOf("\n  return (\n"));
  const at = (m) => { const i = ret.indexOf(m); assert.ok(i >= 0, m); return i; };
  const order = ['<ComposerFold label="新增配息"', "<DividendReport ", "{mobile && recordsPanel}", "<DividendHistoryChart ", "{!mobile && recordsPanel}"].map(at);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `out of order at ${i}`);
  assert.match(dp, /const mobile = useIsMobileLayout\(\);\s*const recordsPanel = \(/);
  assert.equal((ret.match(/recordsPanel/g) || []).length, 2, "rendered exactly once per layout");
});

test("提醒列優先順序：補記缺漏 › 允許收盤通知 › 備份；處理完一件下一件自動遞補", () => {
  const block = jsx.match(/\/\/ <mobile-layout>([\s\S]*?)\/\/ <\/mobile-layout>/)[1];
  const ctx = { window: {}, useState: () => [false, () => {}], useEffect: () => {} };
  vm.createContext(ctx);
  vm.runInContext(block + "\nthis.pick = pickAlertOrder; this.title = missedAlertTitle;", ctx);
  const order = (o) => [...ctx.pick(o)];
  assert.deepEqual(order({ missed: true, closing: true, backup: true }), ["missed", "closing", "backup"]);
  assert.deepEqual(order({ backup: true, closing: true }), ["closing", "backup"], "missed handled → closing moves up");
  assert.deepEqual(order({ backup: true }), ["backup"]);
  assert.deepEqual(order({}), []);
  assert.deepEqual(order(), []);
  assert.equal(ctx.title(["2026-11-11"]), "11/11 沒有每日紀錄");
  assert.equal(ctx.title(["2026-11-05", "2026-11-11", "2026-11-10"]), "11/11 等 3 天沒有每日紀錄");
  assert.equal(ctx.title([]), "");
});

test("提醒列接線：手機一條列＋面板（既有行動都在），桌面仍是原本三張橫幅；稍後／不用了沿用同一組記憶", () => {
  const app = fn("AssetTracker");
  assert.match(app, /\{isMobile && !\(firstRun && corruptLoads\.length === 0 && tab === "dashboard"\) && <MobileAlerts missed=\{missedAlert\} backup=\{backupAlert\} status=\{missedMsg\} \/>\}/);
  assert.match(app, /\{!isMobile && <ClosingReminderBanner \/>\}/);
  assert.match(app, /\{!isMobile && <MissedDaysBanner /);
  assert.match(app, /<Header [^>]*backupOverdue=\{showBackupBanner\} hideBackupBanner=\{isMobile\}/);
  assert.match(fn("Header"), /\{backupOverdue && !hideBackupBanner && \(/);
  // 缺漏：用收盤價補記／稍後（同一個 fillMissedDays、hideMissedToday）
  assert.match(app, /onAct: fillMissedDays, busy: missedBusy/);
  assert.match(app, /\{ label: showEnglish \? "Later" : "稍後", onClick: hideMissedToday \}/);
  assert.match(app, /onAct: openBackup/);
  // 收盤通知：允許通知／稍後（closingReminderBannerHidden）／不用了（setWanted(false)），狀態在自己的 hook
  const ma = fn("MobileAlerts");
  assert.match(ma, /const r = useClosingReminder\(\);/);
  assert.match(ma, /localStorage\.getItem\("closingReminderBannerHidden"\)/);
  assert.match(ma, /localStorage\.setItem\("closingReminderBannerHidden", today\)/);
  assert.match(ma, /r\.status === "needs_allow" && hiddenDay !== today/);
  assert.match(ma, /onClick: \(\) => r\.setWanted\(false\), link: true/);
  assert.match(ma, /pickAlertOrder\(\{ missed: Boolean\(missed\), closing: Boolean\(closing\), backup: Boolean\(backup\) \}\)/);
  // 面板：對話框、可關閉、只有第一件是實心主按鈕
  const strip = fn("AlertStrip");
  assert.match(strip, /role="dialog" aria-modal="true" aria-labelledby="forma-alert-sheet-title"/);
  assert.match(strip, /e\.key === "Escape"/);
  assert.match(strip, /j === 0 \? \(i === 0 \? "is-primary" : "is-tonal"\) : "is-secondary"/);
  assert.match(strip, /\{i === 0 && <em>\{M\("Do this first", "先處理這件"\)\}<\/em>\}/);
  // 48px 列、可點 ≥44px
  assert.match(ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-alert-strip'), /height:48px/);
  assert.match(ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-alert-act'), /min-width:44px/);
  assert.match(ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-alert-more'), /min-width:44px/);
  assert.match(ruleBody('html.za-clean [data-forma-theme="portfolio"] .forma-sheet-x'), /width:44px;height:44px/);
});

test("首次使用：收盤提醒是歡迎卡下方的安靜虛線列，不放在頂端搶第一眼", () => {
  const app = fn("AssetTracker");
  assert.match(app, /firstRunAlert=\{isMobile && firstRun && corruptLoads\.length === 0 \? <MobileAlerts quiet missed=\{missedAlert\} backup=\{backupAlert\} status=\{missedMsg\} \/> : null\}/);
  const dash = fn("Dashboard");
  const guide = dash.indexOf("<FirstRunGuide ");
  const hero = dash.indexOf("premium-asset-hero");
  const quiet = dash.indexOf("{firstRun && firstRunAlert}");
  const live = dash.indexOf("<LivePricePanel ");
  assert.ok(guide > 0 && hero > guide && quiet > hero && live > quiet, "歡迎卡 → Hero → 安靜提醒列 → 即時股價");
  assert.match(mobileCss, /\.forma-alert-strip\.is-quiet\{[^}]*border-style:dashed/);
});

test("兩字分頁：完整名稱留在 aria-label；6／7 個等寬、最小 44px；選中＝淡色膠囊＋粗體（沒有頂端細線）", () => {
  const tabs = jsx.slice(jsx.indexOf("const TABS = ["), jsx.indexOf("];", jsx.indexOf("const TABS = [")));
  const rows = [...tabs.matchAll(/\{ id: "(\w+)", label: "([^"]+)"(?:, short: "([^"]+)")?/g)].map((m) => ({ id: m[1], label: m[2], short: m[3] || m[2] }));
  assert.deepEqual(rows.map((r) => r.short), ["總覽", "持股", "每日", "交易", "配息", "計畫", "設定"]);
  for (const r of rows) assert.equal([...r.short].length, 2, r.id);
  const bar = fn("TabBar");
  assert.match(bar, /const shown = showEnglish \? en : \(mobile \? \(short \|\| label\) : label\);/);
  assert.match(bar, /aria-label=\{showEnglish \? en : label\}/);
  // 計畫仍只在進階開啟時出現
  assert.match(jsx, /return advanced \? allTabs : allTabs\.filter\(\(t\) => t\.id !== "progress"\);/);
  const btn = ruleBody('html.za-clean [data-forma-theme="portfolio"] .premium-tabbar button');
  assert.match(btn, /flex:1 1 0!important/);
  assert.match(btn, /min-width:44px!important/);
  assert.match(mobileCss, /\.premium-tabbar button\[data-active="true"\]>span:first-child\{background:var\(--forma-m-tint\)!important/);
  assert.match(mobileCss, /\.premium-tabbar button\[data-active="true"\]>span:last-child\{font-weight:700!important\}/);
  assert.match(mobileCss, /\.premium-tabbar button\[data-active="true"\]::before\{content:none!important;display:none!important\}/);
  assert.match(mobileCss, /\.premium-tabbar\{padding-bottom:env\(safe-area-inset-bottom,0px\)!important/);
});

test("貓貼紙貼著分頁列右上：右邊距 max(10px, 安全區＋10px)、底部在分頁列上方 4px；60×60、輕晃規則不變、不做捲動縮小", () => {
  const cat = ruleBody('html.za-clean [data-forma-theme="portfolio"] .premium-ai-launcher.za-ai-cat');
  assert.match(cat, /right:max\(10px,calc\(env\(safe-area-inset-right,0px\) \+ 10px\)\)!important/);
  assert.match(cat, /bottom:calc\(var\(--forma-m-tab\) \+ env\(safe-area-inset-bottom,0px\) \+ 4px\)!important/);
  assert.match(mobileCss, /--forma-m-tab:58px/);
  // 內容結尾留約 84px
  assert.match(mobileCss, /\.premium-main\{padding-top:4px!important;padding-bottom:calc\(var\(--forma-m-tab\) \+ 84px \+ env\(safe-area-inset-bottom,0px\)\)!important\}/);
  // 造型與動畫沿用設計 C（ai-dialog.test.mjs 另有完整檢查）；這輪沒有加捲動監聽或縮放
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.za-ai-cat \.za-ai-cat-body\{animation:none!important\}\}/);
  const widget = fn("AiChatWidget");
  assert.match(widget, /width: 60, height: 60/);
  assert.doesNotMatch(widget + fn("AlertStrip") + fn("ComposerFold"), /addEventListener\("scroll"/);
});

test("持股頁（手機）：總持有成本＋圓餅＋圖例同一張卡；每檔第一行是預估損益／累積獲利率（算式不變）", () => {
  const hp = fn("HoldingsPanel");
  assert.match(hp, /\{mobile && \(\s*\/\/ 手機：總持有成本＋圓餅＋圖例同一張卡/);
  assert.match(hp, /<div className="forma-alloc-card mb-3" data-alloc-card>/);
  assert.match(hp, /\{!mobile && \(<>/);
  // 預估損益只有一份算式（holdingPnl），桌面與手機共用
  assert.equal((hp.match(/const estimatedPnl = marketValue != null/g) || []).length, 1);
  assert.match(hp, /\{mobile && \(\(\) => \{[\s\S]{0,200}const \{ estimatedPnl, cumulativePct \} = holdingPnl\(h\);/);
  assert.match(hp, /\{!mobile && \(\(\) => \{\s*const \{ estimatedPnl, cumulativePct \} = holdingPnl\(h\);/);
  const key = hp.indexOf("data-holding-key");
  assert.ok(key > 0 && key < hp.indexOf('className="holding-cost-summary'), "key row sits above the cost summary");
  // 財務密集字 11／17
  assert.match(mobileCss, /\.forma-holding-key-lab\{font-size:11px!important;line-height:17px!important\}/);
  assert.match(mobileCss, /\.forma-alloc-leg li\{[^}]*font-size:11px;line-height:17px/);
});

test("AI 面板（手機）：徽章放標題下方、未登入送出是黃色提示＋帳號卡、問題留在輸入框；仍只走 Puter", () => {
  const widget = fn("AiChatWidget");
  assert.match(widget, /<div className="forma-ai-title flex items-center gap-2 min-w-0">/);
  assert.match(mobileCss, /\.forma-ai-title\{flex-direction:column;/);
  assert.match(widget, /<div className="forma-puter-warn text-xs font-bold"[^>]*>\{PUTER_LOGIN_REQUIRED\}<\/div>\s*<PuterAccountCard \/>/);
  assert.match(mobileCss, /\.forma-puter-warn\{[^}]*var\(--c-warn\)/);
  // 未登入：不清輸入框（setInput("") 在登入檢查之後）
  const send = widget.slice(widget.indexOf("const send = () => {"));
  assert.ok(send.indexOf('puterSendGate(window) !== "ask"') < send.indexOf('setInput("")'));
  // 新加的手機元件沒有任何後端 AI／備援
  for (const name of ["AlertStrip", "MobileAlerts", "ComposerFold"]) assert.doesNotMatch(fn(name), /\/ask|gemini|cloudflare|fetch\(/i, name);
});

test("頂列變矮、提醒列與面板吃 safe-area；深色模式的淡藍底有對應值", () => {
  assert.match(mobileCss, /\.premium-app-shell\[data-forma-theme="portfolio"\]\{padding-top:max\(env\(safe-area-inset-top,0px\),8px\)!important\}/);
  assert.match(mobileCss, /\.premium-header\{padding-top:0!important;padding-bottom:4px!important/);
  assert.match(mobileCss, /\.forma-sheet\{[^}]*env\(safe-area-inset-bottom,0px\)/);
  assert.match(mobileCss, /html\.za-clean\[data-theme="navy"\] \[data-forma-theme="portfolio"\],\s*html\.za-clean:not\(\[data-theme\]\) \[data-forma-theme="portfolio"\]\{--forma-m-tint:color-mix\(in srgb,var\(--c-accent\) 22%,var\(--c-card\)\)\}/);
  // 新區塊不另造色碼：只用既有變數（陰影的 rgba 除外）
  const hexes = mobileCss.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-f]{3,8}\b/gi) || [];
  assert.deepEqual(hexes, [], "no new hex colours in the mobile block");
});

test("Codex 第一輪：提醒面板導覽型動作會關面板、模態焦點循環＋背景 inert、首次使用只在總覽隱藏提醒列", () => {
  const app = fn("AssetTracker");
  const strip = fn("AlertStrip");
  // 1. 「去備份」是導覽型動作：面板先關再跳頁
  assert.match(app, /onClick: openBackup, nav: true \}/);
  assert.match(strip, /const runAction = \(x\) => \{ if \(x\.nav\) setSheetOpen\(false\); x\.onClick\?\.\(\); \};/);
  assert.doesNotMatch(strip, /onClick=\{x\.onClick\}/, "面板按鈕都經過 runAction");
  assert.equal((strip.match(/onClick=\{\(\) => runAction\(x\)\}/g) || []).length, 2);
  // 2. 模態：背景 inert（關閉時還原）、Tab／Shift+Tab 循環、關閉後焦點回到打開按鈕
  assert.match(strip, /sib\.inert = true; inerted\.push\(sib\);/);
  assert.match(strip, /for \(const el of inerted\) el\.inert = false;/);
  assert.match(strip, /e\.key !== "Tab"/);
  assert.match(strip, /e\.shiftKey && \(cur === first \|\| cur === sheet \|\| !inside\)\) \{ e\.preventDefault\(\); last\.focus\(\); \}/);
  assert.match(strip, /!e\.shiftKey && \(cur === last \|\| !inside\)\) \{ e\.preventDefault\(\); first\.focus\(\); \}/);
  assert.ok(strip.indexOf("el.inert = false") < strip.indexOf("(openerRef.current || prevFocus)?.focus"), "先解除 inert 再把焦點還給打開按鈕");
  // 3. 首次使用：只有總覽改放安靜列，其他分頁照常顯示頂端提醒列
  // 合併 #87 後：讀檔損壞時不當成首次使用，頂端提醒列不可被藏起來
  assert.match(app, /isMobile && !\(firstRun && corruptLoads\.length === 0 && tab === "dashboard"\) && <MobileAlerts /);
  assert.doesNotMatch(app, /isMobile && !firstRun && <MobileAlerts /);
});

test("Codex 第二輪：提醒面板用 portal 掛到 document.body（不在分頁容器裡），背景 #root inert、關閉還原，沒有 body 時原地渲染", async () => {
  const strip = fn("AlertStrip");
  const portalSrc = fn("portalSheet");
  // 面板（遮罩＋底部面板）經 portalSheet 渲染，不再直接放在 AlertStrip 的 DOM 裡
  assert.match(strip, /\{sheetOpen && portalSheet\(\s*<div className="forma-sheet-scrim"/);
  const { createRequire } = await import("node:module");
  const Babel = createRequire(import.meta.url)("@babel/standalone");
  const code = Babel.transform(portalSrc, { presets: ["react"] }).code;
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }) };
  const run = (ctx) => vm.runInNewContext(`${code}; portalSheet`, { React, ...ctx });
  // 1. 有 document.body 與 createPortal：掛到 body 的直接子節點，外包 data-forma-theme="portfolio" 讓原樣式照樣套用
  const body = { tag: "BODY" };
  const ReactDOM = { createPortal: (el, container) => ({ portal: true, el, container }) };
  const sheet = { tag: "scrim" };
  const out = run({ window: { ReactDOM }, document: { body } })(sheet);
  assert.equal(out.portal, true);
  assert.equal(out.container, body, "portal 目標是 document.body");
  assert.equal(out.el.props["data-forma-theme"], "portfolio");
  assert.deepEqual(out.el.props.children, [sheet]);
  // 2. 測試／SSR：沒有 document、沒有 body、沒有 createPortal 都原地渲染，不丟錯
  assert.equal(run({ window: { ReactDOM } })(sheet), sheet);
  assert.equal(run({ window: { ReactDOM }, document: {} })(sheet), sheet);
  assert.equal(run({ window: {}, document: { body } })(sheet), sheet);
  // 3. 掛到 body 後，既有的 inert 迴圈會讓 #root（含分頁內容）inert，面板本身不受影響；關閉後還原
  const el = (tag, extra = {}) => ({ tagName: tag, inert: false, children: [], parentElement: null, ...extra });
  const docBody = el("BODY");
  const root = el("DIV", { id: "root" });
  const script = el("SCRIPT");
  const wrap = el("DIV");
  const scrim = el("DIV");
  const sheetEl = el("DIV");
  const link = (p, ...kids) => { for (const k of kids) { p.children.push(k); k.parentElement = p; } };
  link(docBody, root, script, wrap); link(wrap, scrim); link(scrim, sheetEl);
  sheetEl.closest = (sel) => (sel === ".forma-sheet-scrim" ? scrim : null);
  const loopStart = strip.indexOf("for (let node = sheet?.closest");
  const loopEnd = strip.indexOf("try { sheet?.focus", loopStart);
  assert.ok(loopStart > 0 && loopEnd > loopStart);
  const inerted = vm.runInNewContext(`const inerted = []; ${strip.slice(loopStart, loopEnd)}; inerted`, { sheet: sheetEl, document: { body: docBody } });
  assert.equal(root.inert, true, "#root 變 inert");
  assert.equal(wrap.inert, false, "portal 外層不 inert");
  assert.equal(script.inert, false);
  assert.deepEqual(Array.from(inerted, (n) => n.id), ["root"]);
  for (const n of inerted) n.inert = false;
  assert.equal(root.inert, false, "關閉後還原");
  // 4. 焦點循環／Esc／焦點歸還仍在
  assert.match(strip, /if \(e\.key === "Escape"\) \{ setSheetOpen\(false\); return; \}/);
  assert.match(strip, /\(openerRef\.current \|\| prevFocus\)\?\.focus\?\.\(\{ preventScroll: true \}\)/);
});
