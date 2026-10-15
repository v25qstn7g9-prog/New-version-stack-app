// 機械蜘蛛：純裝飾（只動畫面）。檢查它不碰資料、不擋操作、尊重「減少動態效果」，
// 並用假的畫面環境（固定亂數種子，結果每次都一樣）實際跑幾百幀，確認腳踩到的地方會貼出該處的文字。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(new URL("../za-spider.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("loaded just before clean-ui.js (which must stay last), and the old header spider is gone", () => {
  assert.match(html, /<script src="\/za-spider\.js[^"]*" defer><\/script>\s*<script src="\/clean-ui\.js[^"]*" defer><\/script>\s*<\/body>/);
  assert.ok(!html.includes("za-legs-a"));
});

test("za-spider.js is DOM-only and cannot be tapped", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "sendBeacon", "/mcp", "/api/", "innerHTML"]) assert.ok(!code.includes(bad), bad);
  assert.match(code, /pointer-events:none/);
  assert.match(code, /aria-hidden/);
  const z = Number(code.match(/z-index:(\d+)/)[1]);
  assert.ok(z < 50, "must sit below the tab bar (z-index 50) and modals (1000)");
});

function seededMath(seed) {
  let a = seed >>> 0;
  const m = Object.create(Math);
  m.random = () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return m;
}

function makeEnv({ reduce = false, seed = 7 } = {}) {
  const calls = { translate: [], arc: 0, stroke: 0, strokeRect: 0, fillText: [] };
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === "translate") return (x, y) => calls.translate.push([x, y]);
      if (name === "measureText") return (t) => ({ width: String(t).length * 6 });
      if (name === "fillText") return (t) => calls.fillText.push(t);
      if (name in calls) return () => { calls[name] += 1; };
      return () => {};
    },
    set() { return true; },
  });
  const canvas = { style: {}, setAttribute() {}, getContext: () => ctx, width: 0, height: 0 };
  const card = (l, t, w, h, innerText) => ({ innerText, getAttribute: () => null, getBoundingClientRect: () => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) });
  const cards = [card(16, 100, 343, 120, "總資產\n971,124\n-2.89%"), card(16, 240, 343, 160, "持股市值\n605,800"), card(16, 420, 343, 140, "")];
  const rafs = [];
  const doc = { body: { appendChild(el) { doc.appended = el; } }, documentElement: { getAttribute: () => null }, createElement: () => canvas, querySelectorAll: () => cards, addEventListener() {} };
  const win = { innerWidth: 375, innerHeight: 700, devicePixelRatio: 2, scrollX: 0, scrollY: 0, matchMedia: () => ({ matches: reduce }), addEventListener() {}, requestAnimationFrame: (cb) => { rafs.push(cb); } };
  return { sandbox: { window: win, document: doc, Math: seededMath(seed), String }, calls, rafs, doc, win };
}

test("reduced motion: the spider never starts", () => {
  const env = makeEnv({ reduce: true });
  vm.runInNewContext(code, env.sandbox);
  assert.equal(env.doc.appended, undefined);
  assert.equal(env.rafs.length, 0);
});

test("runs 600 frames: legs and body get drawn, feet land on cards and read the text there, scrolling away does not crash", () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    const env = makeEnv({ seed });
    vm.runInNewContext(code, env.sandbox);
    assert.ok(env.doc.appended, "canvas added to the page");
    let t = 1000;
    for (let i = 0; i < 600; i++) {
      t += 34;
      if (i === 300) env.win.scrollY = 2500; // 使用者捲到很下面
      env.rafs.shift()(t);
    }
    assert.ok(env.calls.arc > 1000, "joints drawn");
    assert.ok(env.calls.stroke > 500, "legs drawn");
    for (const [x, y] of env.calls.translate) assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(env.calls.strokeRect > 0, "a card was highlighted when a foot landed on it");
    // 標籤是畫面上看得到的字：前三行用「 · 」合成一行
    assert.ok(env.calls.fillText.some((s) => s === "總資產 · 971,124 · -2.89%" || s === "持股市值 · 605,800"), "tag shows the visible text of the card (seed " + seed + ")");
  }
});
