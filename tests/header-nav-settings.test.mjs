// 標題列瘦身、底部不遮字、設定頁重排（2026-11-03，review L1／L5／L9／L10）。只改外觀與位置，不改計算。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const jsx = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");

test("L9: tab is called 設定 and the page order is 備份 → 收盤提醒 → 進階功能 → collapsed 系統／AI → version", () => {
  assert.match(jsx, /\{ id: "plan", label: "設定", en: "Settings", icon: Settings2 \}/);
  const start = jsx.indexOf("function PlanPanel(");
  const body = jsx.slice(start, jsx.indexOf("// ---------------- Progress Panel", start));
  const order = ['<Panel title="資料備份與還原">', "<PushReminderPanel />", '<Panel title="進階使用">', "data-system-group",
    "{healthCards.length > 0 && (", '<Panel title="AI 問答（Puter）">', '{isOwner && <Panel title="系統管理">', '{isOwner && <Panel title="Z∞ 同步">', "data-app-version"]
    .map((m) => { const i = body.indexOf(m); assert.ok(i >= 0, m); return i; });
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `out of order at ${i}`);
  assert.match(body, /const \[systemOpen, setSystemOpen\] = useState\(false\);/);
  assert.match(body, /\{systemOpen && <div className="space-y-2 mt-2">/);
  assert.match(body, /aria-expanded=\{systemOpen\}/);
  assert.match(body, /v\{APP_DISPLAY_VERSION\}/);
});

test("L10: no holdings → no closing report card", () => {
  assert.match(jsx, /\{holdings\.some\(\(h\) => Number\(h\.current\) > 0\) && <DailyClosingAiReport holdings=\{holdings\} dailyRecords=\{dailyRecords\} \/>\}/);
});

test("L5: 72px extra bottom room for the AI button, opaque tab bar, dark active tab without the overlapping top line", () => {
  assert.match(css, /\.premium-main\{padding-bottom:calc\(96px \+ 72px \+ env\(safe-area-inset-bottom,0px\)\)!important\}/);
  assert.match(css, /--c-tabbar:#ffffff;/);
  assert.equal((css.match(/--c-tabbar:#171717;/g) || []).length, 2);
  assert.ok(!/--c-tabbar:rgba\(/.test(css), "no translucent tab bar left");
  assert.match(css, /\[data-theme="navy"\] \.premium-tabbar button\[data-active="true"\]::before\{content:none!important;display:none!important\}/);
});

test("L1: header has no second row; the cat menu floats above content when open", () => {
  assert.match(css, /\.premium-header:has\(\.za-cat-open\)\{position:relative;z-index:40\}/);
  assert.match(css, /\.premium-header \.za-cat-pop\{position:absolute;/);
});
