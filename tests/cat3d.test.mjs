// 3D 小白貓：純裝飾。檢查載入器的退路、尊重「減少動態效果」、不碰資料、不擋操作，
// 並用假的畫面與假的 WebGL 渲染器（固定亂數種子）實際跑幾千幀，確認貓會跑、坐、翻滾、躺著，且不會跑出活動範圍。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import * as THREE from "../vendor/three.module.min.js";
import { start } from "../za-cat3d.js";
import { readAppSource } from './_app-source.mjs';

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const loader = read("za-cat.js"), cat3d = read("za-cat3d.js"), html = readAppSource();

test("the 3D cat and its three.js copy ship with the app (MIT licence kept)", () => {
  assert.ok(fs.existsSync(new URL("../vendor/three.module.min.js", import.meta.url)));
  assert.match(read("vendor/LICENSE-three.txt"), /MIT License/);
  assert.match(read("vendor/three.module.min.js").slice(0, 300), /MIT/);
  assert.match(html, /<script src="\/za-cat\.js\?v=15" defer><\/script>\s*<script src="\/clean-ui\.js[^"]*" defer><\/script>\s*<\/body>/);
});

test("za-cat3d.js is DOM-only, never reads page text, cannot be tapped, sits below the tab bar", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "sendBeacon", "/mcp", "/api/", "innerHTML", "innerText", "textContent"]) assert.ok(!cat3d.includes(bad), bad);
  assert.match(cat3d, /pointer-events:none/);
  assert.match(cat3d, /aria-hidden/);
  assert.ok(Number(cat3d.match(/z-index:(\d+)/)[1]) < 50, "below the tab bar (z-index 50) and modals (1000)");
});

function loaderEnv({ reduce = false, webgl = true, importFails = false } = {}) {
  const appended = [], timers = [], listeners = {};
  const win = {
    matchMedia: () => ({ matches: reduce }), WebGLRenderingContext: webgl ? function () {} : undefined,
    addEventListener: (n, f) => { listeners[n] = f; }, setTimeout: (f) => { timers.push(f); }, document: null,
  };
  const doc = {
    readyState: "complete", body: { appendChild: (el) => appended.push(el) },
    createElement: (t) => (t === "canvas" ? { getContext: () => (webgl ? {} : null) } : { tag: t }),
  };
  win.document = doc;
  const sandbox = { window: win, document: doc, setTimeout: win.setTimeout, HTMLScriptElement: { prototype: { noModule: true } }, Promise, Function: importFails ? function () { return () => Promise.reject(new Error("no")); } : function () { return () => new Promise(() => {}); } };
  return { sandbox, appended, timers };
}
const tick = () => new Promise((r) => setImmediate(r));

test("loader: always loads only the photo cat (reduced motion handled inside it by CSS); 3D/2D no longer loaded", async () => {
  for (const opts of [{}, { reduce: true }, { webgl: false }, { importFails: true }]) {
    const e = loaderEnv(opts);
    vm.runInNewContext(loader, e.sandbox);
    e.timers.forEach((f) => f());
    await tick();
    assert.equal(e.appended.length, 1); assert.match(e.appended[0].src, /za-catphoto\.js\?v=15/);
  }
  assert.ok(!/za-cat3d|za-cat2d|import\(/.test(loader.replace(/^\/\/.*$/gm, "")));
});

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function fakeEnv({ W = 375, H = 700 } = {}) {
  const rafs = [], renders = { n: 0 }, style = { cssText: "" };
  const g = new Proxy({}, { get: (_, k) => (k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  const canvas = { style, setAttribute() {}, getContext: () => g, addEventListener() {}, width: 0, height: 0, parentNode: null };
  const body = { appendChild: (el) => { el.parentNode = body; }, removeChild: (el) => { el.parentNode = null; } };
  const doc = { body, createElement: () => ({ ...canvas, style: {}, getContext: () => g }) };
  const win = { innerWidth: W, innerHeight: H, devicePixelRatio: 2, addEventListener() {}, requestAnimationFrame: (cb) => { rafs.push(cb); } };
  const renderer = { setPixelRatio() {}, setSize() {}, setClearColor() {}, shadowMap: {}, render: () => { renders.n++; }, dispose() {} };
  return { env: { window: win, document: doc, makeRenderer: () => renderer }, rafs, renders, canvas: null, doc, win, renderer, style };
}

test("3000 frames: sits, runs, rolls and lies belly-up, always inside the play area, renders every frame", () => {
  const realRandom = Math.random;
  try {
    for (const seed of [1, 7, 42, 99, 2024]) {
      Math.random = seededRandom(seed);
      const f = fakeEnv();
      const api = start(THREE, f.env);
      assert.ok(api.ready);
      const seen = new Set(); let t = 1000, maxY = 0;
      for (let i = 0; i < 3000; i++) {
        t += 34; f.rafs.shift()(t); seen.add(api.state);
        assert.ok(Number.isFinite(api.x) && Number.isFinite(api.y) && Number.isFinite(api.cat.yaw));
        assert.ok(api.x >= 70 && api.x <= 375 - 70, `x ${api.x}`);
        assert.ok(api.y >= 100 && api.y <= 700 - 100 + 1, `y ${api.y} (header / tab bar)`);
        maxY = Math.max(maxY, api.y);
      }
      for (const s of ["sit", "run", "roll", "lie"]) assert.ok(seen.has(s), `seed ${seed} never reached ${s}`);
      assert.ok(f.renders.n >= 2990, "one render per frame");
      api.stop();
    }
  } finally { Math.random = realRandom; }
});

test("it turns to face where it runs (smoothly through many headings, not just a left/right flip)", () => {
  const realRandom = Math.random; Math.random = seededRandom(5);
  try {
    const f = fakeEnv(); const api = start(THREE, f.env);
    const yaws = new Set(); let t = 1000;
    for (let i = 0; i < 2500; i++) {
      t += 34; f.rafs.shift()(t);
      yaws.add(Math.round(api.cat.yaw * 2) / 2);
    }
    assert.ok(yaws.size > 4, "heading changes smoothly through many angles, not just a flip");
  } finally { Math.random = realRandom; }
});

test("a lost WebGL context removes the cat and hands over to the fallback", () => {
  const f = fakeEnv(); let lost = 0; let handler = null;
  const orig = f.env.document.createElement;
  f.env.document.createElement = (t) => { const c = orig(t); if (!handler) { c.addEventListener = (n, h) => { if (n === "webglcontextlost") handler = h; }; } return c; };
  f.env.onLost = () => { lost++; };
  start(THREE, f.env);
  assert.ok(handler, "listens for context loss");
  handler({ preventDefault() {} });
  assert.equal(lost, 1);
});
