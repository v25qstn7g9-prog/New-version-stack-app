// Issue #78 首輪純前端視覺：總覽 hero 的戶外漸層、白話眉標、對比、reduced-motion。
// 不開瀏覽器、不連網。對比用 WCAG 2.x 公式；前景色一律從實際 CSS（clean.css／index.html／forma-hero.css）讀出，
// 透明度與等高線線條都合成到漸層上，沿漸層每 1/40 取樣找最差位置。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readAppSource } from "./_app-source.mjs";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const heroCss = strip(read("forma-hero.css"));
const cleanCss = strip(read("clean.css"));
const html = read("index.html");
const indexCss = strip([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n"));
const jsx = read("src/app.jsx");

// ---------- 小型 CSS 讀取：只抓「選擇器 { 宣告 }」，@media 外層會被略過、內層規則照樣抓到 ----------
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  sel: m[1].trim().replace(/\s+/g, " "),
  decl: Object.fromEntries(m[2].split(";").map((d) => d.split(/:(.*)/s)).filter((p) => p.length > 1).map(([k, v]) => [k.trim(), v.trim()])),
}));
const varsOf = (css, selector) => Object.assign({}, ...rules(css).filter((r) => r.sel === selector).map((r) => r.decl));

// ---------- 色彩工具 ----------
const hex = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const toHex = (rgb) => "#" + rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// a 佔 (1-t)、b 佔 t（sRGB 線性內插，與 CSS 漸層／color-mix in srgb／alpha 合成相同）
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v * (1 - t) + hex(b)[i] * t));
const samples = (stops) => {
  const pts = []; const n = stops.length - 1;
  for (let i = 0; i <= 40; i++) { const t = (i / 40) * n; const j = Math.min(n - 1, Math.floor(t)); pts.push(mix(stops[j], stops[j + 1], t - j)); }
  return pts;
};

// 解析 var()／color-mix(in srgb, A P%, B)，回傳不透明色碼
const resolve = (value, vars, depth = 0) => {
  assert.ok(depth < 8, `var loop on ${value}`);
  value = value.replace(/!important$/, "").trim();
  const v = value.match(/^var\((--[\w-]+)(?:,\s*([^)]+))?\)$/);
  if (v) return resolve(vars[v[1]] ?? v[2], vars, depth + 1);
  const cm = value.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/);
  if (cm) return mix(resolve(cm[3], vars, depth + 1), resolve(cm[1], vars, depth + 1), Number(cm[2]) / 100);
  assert.match(value, /^#[0-9a-f]{3,6}$/i, `unresolved colour ${value}`);
  return value.toLowerCase();
};

// ---------- 兩主題實際的變數（依 clean.css／forma-hero.css 的層疊順序合併） ----------
const lightVars = { ...varsOf(cleanCss, "html.za-clean"), ...varsOf(heroCss, 'html.za-clean[data-theme="grey"] [data-forma-theme="portfolio"]') };
const darkVars = {
  ...varsOf(cleanCss, "html.za-clean"),
  ...varsOf(cleanCss, 'html.za-clean[data-theme="navy"]'),
  ...varsOf(cleanCss, 'html.za-clean[data-theme="navy"],html.za-clean:not([data-theme])'),
  ...varsOf(heroCss, 'html.za-clean:not([data-theme="grey"]) [data-forma-theme="portfolio"]'),
};
const gradientStops = (name) => {
  const g = rules(heroCss).map((r) => r.decl[name]).find(Boolean);
  assert.ok(g && g.startsWith("linear-gradient("), `missing ${name}`);
  return [...g.matchAll(/#[0-9a-f]{6}/gi)].map((x) => x[0].toLowerCase());
};
const contourOf = (vars) => {
  const svg = decodeURIComponent(vars["--forma-hero-contour"] || "");
  const stroke = svg.match(/stroke='(#[0-9a-f]{6})'/i), op = svg.match(/stroke-opacity='([\d.]+)'/);
  assert.ok(stroke && op, "contour stroke colour/opacity readable");
  return { stroke: stroke[1].toLowerCase(), opacity: Number(op[1]) };
};

// 套在 hero 內的實際前景色（COLORS.sub → --z-sub；clean.css 對非粗體 sub 字再改成 --c-muted-2）
const foregrounds = (vars) => ({
  "text (--c-ink)": { fg: resolve("var(--z-text)", vars) },
  "sub regular (--c-muted-2)": { fg: resolve("var(--c-muted-2)", vars) },
  "sub bold (--z-sub)": { fg: resolve("var(--z-sub)", vars) },
  "gold/focus (--c-accent)": { fg: resolve("var(--z-gold)", vars) },
  "gain (--c-bad)": { fg: resolve("var(--z-gain)", vars) },
  "loss (--c-good)": { fg: resolve("var(--z-loss)", vars) },
  "warn (--c-warn)": { fg: resolve("var(--c-warn)", vars) },
  "eyebrow": { fg: resolve("var(--forma-hero-eyebrow)", vars) },
  // index.html：hero 內 svg（漲跌箭頭）opacity .92 → 非文字資訊，需 3:1
  "gain icon @svg opacity": { fg: resolve("var(--z-gain)", vars), alpha: "svg", min: 3 },
  "loss icon @svg opacity": { fg: resolve("var(--z-loss)", vars), alpha: "svg", min: 3 },
});

test("--c-muted-2 really is what the hero's regular sub text uses", () => {
  assert.ok(rules(cleanCss).some((r) => r.sel.includes('.premium-main [style*="color: var(--z-sub"]') && /var\(--c-muted-2\)/.test(r.decl.color || "")));
  assert.equal(lightVars["--c-muted-2"], "var(--c-muted)");
  assert.match(darkVars["--c-muted-2"], /color-mix/);
  assert.match(jsx, /className="forma-asset-breakdown[^"]*"[^>]*color: COLORS\.sub/);
});

test("AA contrast of the real hero foregrounds at the worst sampled gradient / contour position", (t) => {
  const svgOpacity = Number(rules(indexCss).find((r) => r.sel === ".premium-dashboard>.premium-asset-hero svg")?.decl.opacity ?? 1);
  // 主數字旁的副標（「全部持股合計」／「台股＋美股合計」）原本 opacity .85；hero 範圍內被 forma-hero.css 改回 1（下面一併確認）
  assert.ok(rules(heroCss).some((r) => r.sel.includes(".forma-asset-heading>div") && /^1(!important)?$/.test(r.decl.opacity || "")));
  for (const [theme, vars, gradVar] of [["light", lightVars, "--forma-hero-outdoor-light"], ["dark", darkVars, "--forma-hero-outdoor-dark"]]) {
    const stops = gradientStops(gradVar);
    const { stroke, opacity } = contourOf(vars);
    // 文字實際所在：漸層任一點（文字區在右側讓出等高線寬度，見下一個測試）
    const grad = samples(stops);
    // 參考：同一點再疊上等高線線條（遮罩全開的最壞假設）；只要求主文字色在這裡也達標
    const underContour = grad.map((p) => mix(p, stroke, opacity));
    const worstOn = (bgs, fg, alpha) => bgs.reduce((acc, bg) => {
      const c = contrast(alpha === "svg" ? mix(bg, fg, svgOpacity) : fg, bg);
      return c < acc.c ? { c, bg } : acc;
    }, { c: Infinity, bg: "" });
    for (const [name, { fg, alpha, min = 4.5 }] of Object.entries(foregrounds(vars))) {
      const w = worstOn(grad, fg, alpha), u = worstOn(underContour, fg, alpha);
      t.diagnostic(`${theme} ${name} ${fg}${alpha ? ` @opacity ${svgOpacity}` : ""}: gradient worst ${w.c.toFixed(2)}:1 on ${w.bg}; under contour ${u.c.toFixed(2)}:1`);
      assert.ok(w.c >= min, `${theme} ${name} ${fg} only ${w.c.toFixed(2)}:1 on ${w.bg}`);
      if (name.startsWith("text")) assert.ok(u.c >= 4.5, `${theme} main text under contour only ${u.c.toFixed(2)}:1`);
    }
  }
});

test("only the hero gets the outdoor gradient; decoration is non-interactive and shrinks on narrow screens", () => {
  const withGrad = rules(heroCss).filter((r) => /var\(--forma-hero-outdoor\)/.test(r.decl["background-image"] || ""));
  assert.ok(withGrad.length >= 1 && withGrad.every((r) => /\.premium-asset-hero$/.test(r.sel)));
  const deco = rules(heroCss).find((r) => /\.premium-asset-hero::after$/.test(r.sel) && r.decl.content);
  assert.equal(deco.decl["pointer-events"], "none");
});

// 把 CSS 長度（px、%、calc／min／max）在指定的參考寬度下算成 px；只接受這幾種寫法，其他直接失敗
const cssLength = (value, percentBase) => {
  const expr = value.replace(/!important$/, "").trim()
    .replace(/(-?\d+(?:\.\d+)?)%/g, (_, n) => `(${n}*${percentBase}/100)`)
    .replace(/(-?\d+(?:\.\d+)?)px/g, "$1")
    .replace(/\bmin\(/g, "Math.min(").replace(/\bmax\(/g, "Math.max(").replace(/\bcalc\(/g, "(");
  assert.match(expr, /^[\d\s.+\-*/(),Mathminax]*$/, `unsupported length ${value}`);
  return Function(`return (${expr})`)();
};

test("contour and text reserve scale with the card: never eat most of a narrow / zoomed card, never overlap", () => {
  const deco = rules(heroCss).find((r) => /\.premium-asset-hero::after$/.test(r.sel) && r.decl.content);
  const reserveRules = rules(heroCss).filter((r) => /forma-hero-eyebrow/.test(r.sel) && /forma-asset-heading/.test(r.sel) && r.decl["padding-right"]);
  assert.equal(reserveRules.length, 1, "one reserve rule, no fixed-px override in a media query");
  const reserveDecl = reserveRules[0].decl["padding-right"];
  // 等高線高度由 2:1 比例跟著寬度走，背景圖填滿框
  assert.match(deco.decl["aspect-ratio"] || "", /^2\s*\/\s*1$/);
  assert.match(deco.decl.background || "", /\/\s*100% 100%/);
  // 卡片內距（clean.css／forma-hero.css 的 hero 規則）：不重疊的證明要涵蓋所有實際用到的內距
  const paddings = [...cleanCss.matchAll(/premium-asset-hero[^{}]*\{[^{}]*?padding:(\d+)px/g), ...heroCss.matchAll(/premium-asset-hero\{[^{}]*?padding:(\d+)px/g)].map((m) => Number(m[1]));
  assert.ok(paddings.length >= 2);
  for (const p of new Set([...paddings, 14, 16, 20, 24])) {
    for (let content = 60; content <= 900; content += 1) {
      const reserve = cssLength(reserveDecl, content); // 子元素的 % 以 hero 內容寬為基準
      const contour = cssLength(deco.decl.width, content + 2 * p); // 絕對定位的 % 以 hero 含內距寬為基準
      assert.ok(reserve >= 0 && contour >= 0);
      assert.ok(reserve <= 112 && contour <= 112, "caps at the original 112px");
      assert.ok(reserve <= content * 0.25, `p=${p} content=${content}: reserve ${reserve} eats more than a quarter`);
      assert.ok(p + reserve >= contour - 1e-9, `p=${p} content=${content}: text (reserve ${reserve}) overlaps contour ${contour}`);
    }
  }
  // 主控實測情境：390px 手機、200% 放大 → hero 約 195 CSS px 寬（內容約 163px）：等高線隱藏、文字不讓出
  assert.equal(cssLength(deco.decl.width, 195), 0);
  assert.equal(cssLength(reserveDecl, 163), 0);
  // 一般 390px 手機（hero 約 358px、內距 16）：等高線仍在，且不超過原本 112px
  assert.ok(cssLength(deco.decl.width, 358) > 60);
});

test("eyebrow sentence is present and sits above the total", () => {
  const dash = jsx.slice(jsx.indexOf("function Dashboard("));
  const eyebrow = dash.indexOf("讓資產安排，更有條理"), total = dash.indexOf("forma-asset-total");
  assert.ok(eyebrow > 0 && total > eyebrow);
});

// ---------- AnimatedNumber：在 Node 裡用 build 同一版 Babel 轉譯元件，配上極簡 hooks 實際執行 ----------
const loadAnimatedNumber = () => {
  const src = readAppSource();
  const fn = (name) => { const a = src.indexOf(`function ${name}(`); assert.ok(a >= 0, name); return src.slice(a, src.indexOf("\n}\n", a) + 2); };
  const Babel = createRequire(import.meta.url)("@babel/standalone");
  const code = Babel.transform(fn("prefersReducedMotion") + fn("AnimatedNumber"), { presets: ["react"] }).code;
  const state = { hooks: [], i: 0, effects: [], rafCalls: 0, cancelCalls: 0, rafQueue: new Map(), seq: 0, reduce: false, now: 0 };
  const ctx = {
    React: { createElement: (_t, _p, ...kids) => kids.flat().join("") },
    useState: (init) => { const k = state.i++; if (!(k in state.hooks)) state.hooks[k] = init; return [state.hooks[k], (v) => { state.hooks[k] = v; }]; },
    useRef: (init) => { const k = state.i++; if (!(k in state.hooks)) state.hooks[k] = { current: init }; return state.hooks[k]; },
    useEffect: (fx, deps) => { const k = state.i++; const prev = state.hooks[k]; if (!prev || deps.some((d, j) => d !== prev.deps[j])) { state.effects.push(() => { prev?.cleanup?.(); state.hooks[k] = { deps, cleanup: fx(), fx }; }); } },
    nf: (n) => String(n),
    performance: { now: () => state.now },
    requestAnimationFrame: (cb) => { state.rafCalls++; const id = ++state.seq; state.rafQueue.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { state.cancelCalls++; state.rafQueue.delete(id); },
  };
  // MediaQueryList 替身：mqlMode = "modern"（addEventListener）／"legacy"（addListener）／"none"（沒有監聽 API）
  state.mqlMode = "modern"; state.listeners = [];
  const add = (fn) => { state.listeners.push(fn); };
  const remove = (fn) => { state.listeners = state.listeners.filter((f) => f !== fn); };
  ctx.window = { matchMedia: (q) => {
    const mql = { get matches() { return q.includes("prefers-reduced-motion") && state.reduce; } };
    if (state.mqlMode === "modern") Object.assign(mql, { addEventListener: (type, fn) => { if (type === "change") add(fn); }, removeEventListener: (type, fn) => { if (type === "change") remove(fn); } });
    if (state.mqlMode === "legacy") Object.assign(mql, { addListener: add, removeListener: remove });
    return mql;
  } };
  vm.createContext(ctx);
  vm.runInContext(code + "\nthis.AnimatedNumber = AnimatedNumber; this.prefersReducedMotion = prefersReducedMotion;", ctx);
  const render = (value) => { state.i = 0; const out = ctx.AnimatedNumber({ value }); const fx = state.effects.splice(0); fx.forEach((f) => f()); return out; };
  const frame = (ms) => { state.now += ms; const q = [...state.rafQueue.values()]; state.rafQueue.clear(); q.forEach((cb) => cb(state.now)); };
  const effectSlots = () => state.hooks.filter((h) => h && typeof h.fx === "function");
  // 卸載：執行每個 effect 的 cleanup（React 卸載行為）
  const unmount = () => { effectSlots().forEach((h) => { h.cleanup?.(); h.cleanup = undefined; }); };
  // StrictMode 開發模式：掛載後先全部 cleanup，再把 effect 重跑一次
  const strictRemount = () => { const slots = effectSlots(); slots.forEach((h) => h.cleanup?.()); slots.forEach((h) => { h.cleanup = h.fx(); }); };
  // 只切換系統偏好並發出 change 事件（不 render、不改 value）
  const setReduce = (on) => { state.reduce = on; [...state.listeners].forEach((fn) => fn({ matches: on })); };
  return { ctx, state, render, frame, unmount, strictRemount, setReduce };
};

test("AnimatedNumber: reduced motion shows the new value at once, no requestAnimationFrame, no in-between values", () => {
  const h = loadAnimatedNumber();
  h.state.reduce = true;
  h.render(1000);
  h.render(2000);
  assert.equal(h.state.hooks[0], 2000, "shows the latest value immediately");
  assert.equal(h.state.rafCalls, 0, "no animation frame requested");
  h.render(1500);
  assert.equal(h.state.hooks[0], 1500);
  assert.equal(h.state.rafCalls, 0);
});

test("AnimatedNumber: switching to reduced motion mid-animation cancels it and jumps to the latest value", () => {
  const h = loadAnimatedNumber();
  h.render(0);
  h.render(1000);
  h.frame(100);
  const mid = h.state.hooks[0];
  assert.ok(mid > 0 && mid < 1000, "normal mode still animates (control case)");
  h.state.reduce = true;
  h.render(3000);
  assert.equal(h.state.hooks[0], 3000);
  assert.equal(h.state.rafQueue.size, 0, "pending frame cancelled");
  h.frame(1000);
  assert.equal(h.state.hooks[0], 3000, "no stray frame overwrites the value");
});

test("AnimatedNumber: toggling only the reduced-motion preference (same value) stops at the latest value at once", () => {
  for (const mode of ["modern", "legacy"]) {
    const h = loadAnimatedNumber();
    h.state.mqlMode = mode;
    h.render(0);
    assert.equal(h.state.listeners.length, 1, `${mode}: one change listener`);
    h.render(1000);
    h.frame(100);
    const mid = h.state.hooks[0];
    assert.ok(mid > 0 && mid < 1000, `${mode}: animating (control case)`);
    h.setReduce(true); // 只切換偏好，不 render、不改 value
    assert.equal(h.state.hooks[0], 1000, `${mode}: jumps to the latest value`);
    assert.equal(h.state.rafQueue.size, 0, `${mode}: pending frame cancelled`);
    h.frame(100); h.frame(1000);
    assert.equal(h.state.hooks[0], 1000, `${mode}: no later frame rewrites it`);
    h.render(1000);
    assert.equal(h.state.hooks[0], 1000);
    assert.equal(h.state.rafQueue.size, 0, `${mode}: re-render does not restart the animation`);
    h.setReduce(false); // 關掉偏好不動顯示值
    assert.equal(h.state.hooks[0], 1000);
  }
});

test("AnimatedNumber: change listener is removed on unmount and not duplicated by StrictMode remount", () => {
  for (const mode of ["modern", "legacy"]) {
    const h = loadAnimatedNumber();
    h.state.mqlMode = mode;
    h.render(0);
    h.strictRemount();
    assert.equal(h.state.listeners.length, 1, `${mode}: exactly one listener after StrictMode remount`);
    h.render(500);
    h.unmount();
    assert.equal(h.state.listeners.length, 0, `${mode}: listener removed on unmount`);
  }
  const h = loadAnimatedNumber();
  h.state.mqlMode = "none"; // 沒有任何監聽 API：安全略過，動畫照常
  h.render(0); h.render(300); h.frame(600);
  assert.equal(h.state.hooks[0], 300);
  assert.doesNotThrow(() => h.unmount());
});

test("AnimatedNumber: missing or throwing matchMedia falls back to the normal animation", () => {
  const h = loadAnimatedNumber();
  delete h.ctx.window.matchMedia;
  assert.equal(h.ctx.prefersReducedMotion(), false);
  h.ctx.window.matchMedia = () => { throw new Error("nope"); };
  assert.equal(h.ctx.prefersReducedMotion(), false);
  h.render(0); h.render(500); h.frame(600);
  assert.equal(h.state.hooks[0], 500, "still lands on the exact value");
});

test("reduced motion: forma-hero.css adds no animation and stops hero transitions", () => {
  assert.doesNotMatch(heroCss, /@keyframes/);
  assert.match(heroCss, /prefers-reduced-motion:\s*reduce/);
});

// ---------- 美股開關（showUsFields）與主數字標籤 ----------
// 從 src/app.jsx 抽出「真的」Dashboard（連同 COLORS／UI_EN／uiText／UiLabel／nf／pf／AnimatedNumber），
// 用 build 同一版 Babel 轉譯，在 vm 裡以極簡 React 替身（createElement＋同步 hooks）實際渲染成 HTML 字串。
// 沒有 react-dom/server 可用（vendor/ 只有瀏覽器用的 react-dom），所以自己做最小的靜態渲染器；
// Dashboard 用到、但不屬於 hero 的子元件與工具函式只換成「明確清單」DASHBOARD_STUBS 裡回傳 null 的替身，並記下收到的 props；
// 清單外的依賴會讓測試失敗。驗證範圍只到 hero 大卡，不代表整個總覽頁。
const block = (src, start, end = "\n};\n") => { const a = src.indexOf(start); assert.ok(a >= 0, start); return src.slice(a, src.indexOf(end, a) + end.length); };
const fnSrc = (src, name) => block(src, `function ${name}(`, "\n}\n");
const lineOf = (src, start) => { const a = src.indexOf(start); assert.ok(a >= 0, start); return src.slice(a, src.indexOf("\n", a) + 1); };

// Dashboard 實際用到、但不屬於本次驗證範圍的子元件／圖示／工具函式（一律回傳 null）。新增依賴時要在這裡明確加上。
const DASHBOARD_STUBS = [
  // 日期／交易日工具
  "changeLabelDate", "todayStr", "isNonTradingDay",
  // hero 以外的子區塊（另有各自的測試）
  "DashboardCollapsibleSection", "FactorBacktest", "LivePricePanel", "NewsCarousel", "PortfolioPerformanceCard", "TrendRadar",
  // lucide 圖示
  "TrendingUp", "TrendingDown",
  // 資產曲線（Recharts 與刻度工具；圖表本身不在本測試驗證範圍）
  "ResponsiveContainer", "AreaChart", "Area", "CartesianGrid", "XAxis", "YAxis", "Tooltip", "ReferenceLine", "pickEvenTimeTicks", "formatTickDate",
];

const renderDashboard = (props, { english = false } = {}) => {
  const Babel = createRequire(import.meta.url)("@babel/standalone");
  const parts = [
    block(jsx, "const COLORS = {"), block(jsx, "const UI_EN = {"), block(jsx, "const CHART_RANGES = [", "\n];\n"),
    fnSrc(jsx, "uiText"), fnSrc(jsx, "UiLabel"), lineOf(jsx, "const nf = "), lineOf(jsx, "const pf = "),
    fnSrc(jsx, "prefersReducedMotion"), fnSrc(jsx, "AnimatedNumber"), fnSrc(jsx, "Dashboard"),
  ];
  const code = Babel.transform(parts.join("\n"), { presets: ["react"] }).code;
  const Fragment = Symbol("Fragment");
  const React = { Fragment, createElement: (type, p, ...children) => ({ type, props: { ...(p || {}), children } }) };
  const hooks = {
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (v) => ({ current: v }), useEffect: () => {}, useLayoutEffect: () => {},
  };
  const stubCalls = [];
  const known = { React, ...hooks, UI_SHOW_ENGLISH: english, window: {}, performance: { now: () => 0 }, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  const stub = (name) => (p) => { stubCalls.push([name, p]); return null; };
  const stubs = new Map(DASHBOARD_STUBS.map((name) => [name, stub(name)]));
  // 只有明確列在 DASHBOARD_STUBS 的依賴會換成回傳 null 的替身；JS 內建（Math、Number…）照用。
  // 清單外的識別字一律記下，渲染後讓測試失敗並列出名稱（不默默補成空元件）。
  const unknown = new Set();
  const env = new Proxy({}, {
    has: (_t, k) => typeof k === "string" && k !== "__out" && (k in known || stubs.has(k) || !(k in globalThis)),
    get: (_t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in known) return known[k];
      if (stubs.has(k)) return stubs.get(k);
      unknown.add(k);
      return undefined;
    },
  });
  const ctx = vm.createContext({ __env: env, __out: {} });
  vm.runInContext(`with (__env) { ${code}\n__out.Dashboard = Dashboard; }`, ctx);
  const failUnknown = () => assert.deepEqual([...unknown].sort(), [], "Dashboard uses dependencies not in DASHBOARD_STUBS");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let hero = null;
  const render = (n) => {
    if (n == null || n === false || n === true) return "";
    if (Array.isArray(n)) return n.map(render).join("");
    if (typeof n !== "object") return esc(n);
    const { type, props: p } = n;
    if (type === Fragment) return render(p.children);
    if (typeof type === "function") return render(type(p));
    const attrs = Object.entries(p).filter(([k, v]) => /^(className|role|title|aria-[\w-]+)$/.test(k) && v != null && v !== false)
      .map(([k, v]) => ` ${k === "className" ? "class" : k}="${esc(v)}"`).join("");
    const html = `<${type}${attrs}>${render(p.children)}</${type}>`;
    if (/\bpremium-asset-hero\b/.test(p.className || "")) hero = html;
    return html;
  };
  let html;
  try { html = render(ctx.__out.Dashboard(props)); } catch (e) { failUnknown(); throw e; }
  failUnknown();
  assert.ok(hero, "hero card rendered");
  const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { html, hero, heroText: text(hero), text: text(html), stubCalls };
};

const dashProps = (over = {}) => ({
  totalToday: 1500000, currentTwValue: 1200000, currentUsValue: 300000, dailyChange: 1234, dailyChangePct: 0.08,
  capitalGain: 0, totalDividends: 0, totalReturn: 50000, totalReturnPct: 3.4, twTotalReturn: 30000, twTotalReturnPct: 2.5,
  usTotalReturn: 20000, usTotalReturnPct: 7, hasUsAssets: true, showUsFields: false, showGoal: false,
  highPoint: { value: -Infinity, date: null }, drawdown: 0, ytdGain: 0, ytdPct: 0, chartData: [], goal: null, goalDate: null,
  totalInvested: 0, holdings: [], dailyRecords: [], dividends: [], yesterdayTwValue: 0, yesterdayUsValue: 0,
  usHoldings: [{ symbol: "VOO", shares: 3 }], usLive: { brokerCalibrationActive: true }, firstRun: false, ...over,
});
const US_WORDS_ZH = /美股|已自動校準/;
const US_WORDS_EN = /\bUS\b|Auto-calibrated/;
const childUsFlags = (r) => r.stubCalls.filter(([n]) => n === "LivePricePanel" || n === "PortfolioPerformanceCard");

test("showUsFields default is off: initial state false, only a stored value === true turns it on", () => {
  assert.match(jsx, /const \[showUsFields, setShowUsFields\] = useState\(false\);/);
  // 載入：Promise.all 的第幾個 loadKey 就是解構的第幾個變數 → 找出 showUsFields 對應的變數名
  const m = jsx.match(/const \[([^\]]+)\] = await Promise\.all\(\[([\s\S]*?)\]\);/);
  assert.ok(m, "load block found");
  const names = m[1].split(",").map((s) => s.trim());
  // 每一行一個陣列元素；取該行第一個 loadKey 的 key
  const keys = m[2].split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (l.match(/^loadKey\("([^"]+)"/) || [])[1] ?? "(other)");
  const idx = keys.indexOf("showUsFields");
  assert.ok(idx >= 0 && names.length === keys.length, "showUsFields is loaded in the same Promise.all");
  assert.match(m[2], /loadKey\("showUsFields", null\)/, "missing key loads as null (not true)");
  const v = names[idx];
  const setCalls = [...jsx.matchAll(/setShowUsFields\??\.?\(([^)]*)\)/g)].map((c) => c[1].trim());
  const loadExpr = setCalls.find((c) => new RegExp(`^${v}\\b`).test(c));
  assert.equal(loadExpr, `${v} === true`);
  // 實際執行同一個判斷式：只有 boolean true 會打開
  const decide = vm.runInNewContext(`(${v}) => (${loadExpr})`);
  for (const stored of [null, undefined, false, "true", 1, "1", {}, [], "yes"]) assert.equal(decide(stored), false, `stored ${JSON.stringify(stored)} keeps it off`);
  assert.equal(decide(true), true);
  // 其他會改到開關的只有每日紀錄頁的 checkbox（使用者自己勾）
  assert.deepEqual(setCalls.filter((c) => c !== loadExpr), ["e.target.checked"]);
  assert.match(jsx, /<input type="checkbox" checked=\{showUsFields\} onChange=\{\(e\) => setShowUsFields\?\.\(e\.target\.checked\)\} \/>/);
  // Dashboard 自己的預設也是關
  assert.match(fnSrc(jsx, "Dashboard"), /showUsFields = false/);
});

// 驗證範圍只到 hero 大卡（其餘子區塊是替身，這裡不宣稱整個總覽）
test("US switch off (default): the hero card has no TW / US split row and no US content, even when US holdings exist", () => {
  const cases = [
    ["US holdings, switch off", {}],
    ["switch not passed", { omit: true }],
    ["no US holdings", { hasUsAssets: false, currentUsValue: 0, usHoldings: [], usLive: null }],
  ];
  for (const english of [false, true]) {
    for (const [label, over] of cases) {
      const { omit, ...rest } = over;
      const props = dashProps(rest);
      if (omit) delete props.showUsFields; // 沒傳 → 元件預設 false
      const r = renderDashboard(props, { english });
      const tag = `${english ? "en" : "zh"} / ${label}`;
      assert.doesNotMatch(r.hero, /forma-asset-breakdown/, `${tag}: split row rendered`);
      assert.doesNotMatch(r.heroText, english ? /TW Assets/ : /台股資產/, `${tag}: ${r.heroText}`);
      assert.doesNotMatch(r.heroText, english ? US_WORDS_EN : US_WORDS_ZH, `${tag}: ${r.heroText}`);
      assert.doesNotMatch(r.heroText, english ? /TW \+ US/ : /台股＋美股/, tag);
      assert.doesNotMatch(r.heroText, /1,200,000|300,000/, `${tag}: no TW / US sub-amounts`);
      // 主數字照常顯示（數值不變）
      assert.match(r.heroText, /NT\$ 1,500,000|NT\$ 1,200,000/);
      // 交給子區塊的 hasUsAssets 旗標也跟著關（只檢查傳入的 props）
      for (const [name, p] of childUsFlags(r)) assert.equal(p.hasUsAssets, false, `${tag}: ${name}`);
    }
  }
});

test("hero card with goal and chart branches renders using only the listed dependencies", () => {
  for (const showUsFields of [false, true]) {
    const r = renderDashboard(dashProps({
      showUsFields, showGoal: true, goal: { targetAmount: 3000000, targetYear: 2030 }, goalDate: "2030-01",
      dailyChange: -500, dailyChangePct: -0.03,
      chartData: [{ date: "2026-11-05", total: 1400000, tw: 1100000, us: 300000 }, { date: "2026-11-06", total: 1500000, tw: 1200000, us: 300000 }],
    }));
    assert.match(r.heroText, /距目標 NT\$ 1,500,000/);
    assert.equal(/forma-asset-breakdown/.test(r.hero), showUsFields);
  }
  // 清單不放多餘的名字：每一個替身都真的出現在 Dashboard 原始碼
  const dash = fnSrc(jsx, "Dashboard");
  for (const name of DASHBOARD_STUBS) assert.match(dash, new RegExp(`\\b${name}\\b`), `${name} listed but not used by Dashboard`);
});

test("US switch on with US holdings: hero card shows the split row (TW + US + calibrated) and 台股＋美股合計", () => {
  const zh = renderDashboard(dashProps({ showUsFields: true }));
  assert.match(zh.hero, /class="forma-asset-breakdown[^"]*"/);
  assert.match(zh.heroText, /台股＋美股合計/);
  assert.match(zh.heroText, /台股資產 NT\$ 1,200,000/);
  assert.match(zh.heroText, /美股資產 NT\$ 300,000/);
  assert.match(zh.heroText, /已自動校準/);
  assert.doesNotMatch(zh.heroText, /全部持股合計/);
  assert.ok(zh.hero.indexOf("台股資產") < zh.hero.indexOf("美股資產"));
  const en = renderDashboard(dashProps({ showUsFields: true }), { english: true });
  assert.match(en.heroText, /TW \+ US Combined/);
  assert.match(en.heroText, /TW Assets NT\$ 1,200,000/);
  assert.match(en.heroText, /US Assets NT\$ 300,000/);
  assert.ok(childUsFlags(zh).length >= 1);
  for (const [name, p] of childUsFlags(zh)) assert.equal(p.hasUsAssets, true, name);
});

test("hero headline is 持股總市值 / Total Holdings Value (sums TW + US holdings value only), no 總資產 wording in the hero", () => {
  // 主數字 totalToday 只由台股、美股持股市值相加（無現金或其他資產）
  assert.match(jsx, /const totalToday = currentTwValue \+ currentUsValue;/);
  const zh = renderDashboard(dashProps());
  assert.match(zh.heroText, /^讓資產安排，更有條理 持股總市值 全部持股合計 NT\$ 1,500,000/);
  assert.doesNotMatch(zh.hero, /總資產/);
  const en = renderDashboard(dashProps(), { english: true });
  assert.match(en.heroText, /Total Holdings Value All holdings combined NT\$ 1,500,000/);
  assert.doesNotMatch(en.hero, /Total Assets|Current Total/);
  const on = renderDashboard(dashProps({ showUsFields: true }), { english: true });
  assert.match(on.heroText, /Total Holdings Value TW \+ US Combined/);
  // 英文與既有的 TW／US Holdings Value 用詞一致
  const uiEn = block(jsx, "const UI_EN = {");
  assert.match(uiEn, /"持股總市值": "Total Holdings Value"/);
  assert.match(uiEn, /"全部持股合計": "All holdings combined"/);
  assert.match(uiEn, /"台股持股市值": "TW Holdings Value"/);
  assert.match(uiEn, /"美股持股市值": "US Holdings Value"/);
  // 送給 AI 的提示字串不是畫面標籤，維持原樣
  // （AI 問答改用瀏覽器整理的資產摘要 buildPuterSummary，提示字串仍用「目前總資產」）
  assert.equal((jsx.match(/L\.push\(`目前總資產：/g) || []).length, 1);
});
