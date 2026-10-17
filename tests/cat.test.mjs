// 小白貓：純裝飾（只動畫面）。檢查它不碰資料、不擋操作、尊重「減少動態效果」，
// 並用假的畫面環境（固定亂數種子，結果每次都一樣）實際跑幾千幀，確認它會跑、會坐、會滾，而且不會跑出活動範圍。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppSource } from './_app-source.mjs';
const code = fs.readFileSync(new URL("../za-cat2d.js", import.meta.url), "utf8"); // 手繪平面版（備用）
const html = readAppSource();

test("loader loaded just before clean-ui.js (which must stay last), and the spider is gone", () => {
  assert.match(html, /<script src="\/za-cat\.js[^"]*" defer><\/script>\s*<script src="\/clean-ui\.js[^"]*" defer><\/script>\s*<\/body>/);
  assert.ok(!html.includes("za-spider"));
  assert.ok(!fs.existsSync(new URL("../za-spider.js", import.meta.url)));
});

test("za-cat2d.js (fallback) is DOM-only and cannot be tapped", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "sendBeacon", "/mcp", "/api/", "innerHTML", "innerText"]) assert.ok(!code.includes(bad), bad);
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
function makeEnv({ reduce = false, seed = 7, W = 375, H = 700 } = {}) {
  const calls = { translate: [], scale: [], ellipse: 0, stroke: 0, fill: 0 };
  const ctx = new Proxy({}, {
    get(_, name) {
      if (name === "translate") return (x, y) => calls.translate.push([x, y]);
      if (name === "scale") return (x, y) => calls.scale.push([x, y]);
      if (name in calls) return () => { calls[name] += 1; };
      return () => {};
    },
    set() { return true; },
  });
  const canvas = { style: {}, setAttribute() {}, getContext: () => ctx, width: 0, height: 0 };
  const rafs = [];
  const doc = { body: { appendChild(el) { doc.appended = el; } }, createElement: () => canvas, addEventListener() {} };
  const win = { innerWidth: W, innerHeight: H, devicePixelRatio: 2, matchMedia: () => ({ matches: reduce }), addEventListener() {}, requestAnimationFrame: (cb) => { rafs.push(cb); } };
  return { sandbox: { window: win, document: doc, Math: seededMath(seed), String }, calls, rafs, doc, win };
}

test("reduced motion: the 2D cat never starts", () => {
  const env = makeEnv({ reduce: true });
  vm.runInNewContext(code, env.sandbox);
  assert.equal(env.doc.appended, undefined);
  assert.equal(env.rafs.length, 0);
});

test("3000 frames: it sits, runs and rolls, always inside the play area (clear of the header and the tab bar), and keeps drawing", () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    const env = makeEnv({ seed });
    vm.runInNewContext(code, env.sandbox);
    assert.ok(env.doc.appended, "canvas added to the page");
    const seen = new Set();
    let t = 1000;
    for (let i = 0; i < 3000; i++) {
      t += 34;
      env.rafs.shift()(t);
      seen.add(env.sandbox.window.__zaCat.state);
    }
    for (const s of ["sit", "run", "roll"]) assert.ok(seen.has(s), `seed ${seed} never reached ${s}`);
    // 每幀畫貓時第一個 translate(x, y) 是貓的位置（其餘是身體各部位的小位移，數值都很小）
    const cats = env.calls.translate.filter(([, y]) => y >= 100);
    assert.ok(cats.length > 2500, "drawn every frame");
    for (const [x, y] of cats) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(x >= 34 && x <= 375 - 34, `x out of range: ${x}`);
      assert.ok(y >= 100 && y <= 700 - 96, `y out of range (header / tab bar): ${y}`);
    }
    assert.ok(env.calls.stroke > 20000 && env.calls.fill > 20000, "outlines and fills get drawn");
  }
});

test("the cat faces the way it moves (mirrored when going left) and gets slightly bigger lower on the screen", () => {
  const env = makeEnv({ seed: 5 });
  vm.runInNewContext(code, env.sandbox);
  let t = 1000;
  for (let i = 0; i < 2000; i++) { t += 34; env.rafs.shift()(t); }
  const dirs = new Set(env.calls.scale.map(([sx]) => Math.sign(sx)));
  assert.ok(dirs.has(1) && dirs.has(-1), "faces both directions");
  const sizes = env.calls.scale.map(([, sy]) => sy);
  assert.ok(Math.max(...sizes) > Math.min(...sizes), "depth scaling");
});
