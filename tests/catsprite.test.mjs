// 真貓動作：Johnny 給的兩段影片去背後做成的雪碧圖。依心情、走路／休息、點／摸牠挑動作；圖載不到維持照片。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(new URL("../za-catphoto.js", import.meta.url), "utf8");

function load({ reduce = false, imageOk = true } = {}) {
  const els = [], timers = [], rafs = [], draws = [];
  const mk = (tag) => {
    const el = { tag, style: {}, children: [], attrs: {}, listeners: {}, parentNode: null, textContent: "", offsetWidth: 0,
      classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle() {} },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, removeChild() {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }, contains: (x) => x === el };
    if (tag === "canvas") el.getContext = () => ({ clearRect() {}, drawImage: (...a) => draws.push(a) });
    els.push(el); return el;
  };
  const row = { style: {}, getBoundingClientRect: () => ({ left: 16, right: 374, top: 10, bottom: 46, width: 358, height: 36 }), appendChild(c) { c.parentNode = row; },
    querySelector: () => ({ firstElementChild: { getBoundingClientRect: () => ({ left: 16, right: 200, top: 10, bottom: 46, width: 184, height: 36 }) }, nextElementSibling: { getBoundingClientRect: () => ({ left: 300, right: 374, top: 10, bottom: 46, width: 74, height: 36 }) } }) };
  const images = [];
  function Image() { images.push(this); }
  Object.defineProperty(Image.prototype, "src", { set(v) { this._src = v; queueMicrotask(() => (imageOk ? this.onload && this.onload() : this.onerror && this.onerror())); }, get() { return this._src; } });
  const win = { addEventListener() {}, matchMedia: () => ({ matches: reduce }), __zaNoRoam: true };
  let now = 1_000_000;
  const DateF = { now: () => now };
  vm.runInNewContext(code, { window: win, document: { head: { appendChild() {} }, body: { appendChild() {} }, createElement: mk, querySelector: () => row },
    navigator: {}, fetch: () => Promise.reject(new Error("x")), getComputedStyle: () => ({ position: "relative" }),
    requestAnimationFrame: (f) => { rafs.push(f); }, setTimeout: (f, ms) => { timers.push({ f, ms }); return 1; }, clearTimeout() {},
    MutationObserver: function () { this.observe = () => {}; }, Image, Date: DateF, Math, Promise, String, queueMicrotask });
  return { api: win.__zaPhotoCat, els, rafs, draws, images, advance: (ms) => { now += ms; }, runRaf: () => { const f = rafs.splice(0); f.forEach((x) => x()); } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("sprite asset is small enough and the manifest matches the atlas", () => {
  const { api } = load();
  const S = api.sprite;
  assert.ok(fs.statSync(new URL("../za-cat-sprite.webp", import.meta.url)).size + fs.statSync(new URL("../za-cat-photo.webp", import.meta.url)).size <= 300000, "all cat images together <= 300KB");
  for (const k of ["sit", "look", "walk", "sad", "happy", "loaf", "jump"]) assert.ok(S.actions[k] && S.actions[k].count > 0, k);
  const last = Math.max(...Object.values(S.actions).map((a) => a.start + a.count));
  assert.equal(last, S.total); assert.ok(S.total <= S.cols * S.rows);
});

test("which clip plays: reaction > walking > mood at rest", () => {
  const { api } = load();
  const A = api.spriteAction;
  assert.equal(A("relaxed", "walk", null, false, 0), "walk");
  assert.equal(A("happy", "walk", "loaf", false, 0), "loaf", "a reaction wins over walking");
  assert.equal(A("relaxed", "rest", null, false, 0), "sit");
  assert.equal(A("relaxed", "rest", null, false, 13), "look", "sometimes looks right at you");
  assert.equal(A("relaxed", "rest", null, true, 0), "loaf", "napping");
  assert.equal(A("sad", "rest", null, false, 0), "sad");
  assert.equal(A("sad", "rest", null, false, 8), "loaf");
  assert.equal(A("happy", "rest", null, false, 0), "sit");
});

test("frame timing: loop wraps, pingpong goes back and forth, once holds the last frame", () => {
  const { api } = load();
  const S = api.sprite, F = api.spriteFrame;
  const w = S.actions.walk, s = S.actions.sit, h = S.actions.happy;
  assert.equal(F("walk", 0, 12), w.start);
  assert.equal(F("walk", w.count / 12, 12), w.start, "loop wraps");
  assert.equal(F("sit", (s.count - 1) / 12, 12), s.start + s.count - 1);
  assert.equal(F("sit", s.count / 12, 12), s.start + s.count - 2, "pingpong comes back");
  assert.equal(F("happy", 99, 12), h.start + h.count - 1, "once holds the last frame");
});

test("after the sprite loads it replaces the photo, animates, and taps / pets switch to the matching real clip", async () => {
  const e = load(); await flush();
  assert.equal(e.api.spriteReady, true);
  const canvas = e.els.find((x) => x.tag === "canvas");
  assert.ok(canvas && canvas.attrs["aria-hidden"] === "true");
  e.runRaf(); assert.ok(e.draws.length >= 1, "drew a frame");
  e.api.setMood("happy"); assert.equal(e.api.tap(5000, 0), "jump"); e.runRaf();
  assert.equal(e.api.action, "jump", "real jump clip");
  e.advance(4000); e.runRaf(); assert.equal(e.api.tap(9000, 0.9), "wiggle"); e.runRaf();
  assert.equal(e.api.action, "happy", "tail-up walk toward you");
  e.advance(4000); e.runRaf(); assert.notEqual(e.api.action, "happy", "reaction ends");
  e.api.pet(); e.runRaf(); assert.equal(e.api.action, "loaf", "petting -> purring loaf");
  e.advance(3000); e.api.setMood("sad"); e.runRaf(); assert.ok(["sad", "loaf"].includes(e.api.action), "sad mood: head down / curled up");
});

test("reduced motion: one still frame, no animation loop", async () => {
  const e = load({ reduce: true }); await flush();
  e.runRaf(); const n = e.rafs.length;
  assert.equal(n, 0, "does not schedule further frames");
});

test("sprite fails to load -> keeps the photo", async () => {
  const e = load({ imageOk: false }); await flush();
  assert.ok(!e.api.spriteReady);
  assert.ok(!e.els.some((x) => x.tag === "canvas"));
});

test("no EXIF / metadata chunks in the sprite", () => {
  const b = fs.readFileSync(new URL("../za-cat-sprite.webp", import.meta.url));
  assert.equal(b.toString("latin1", 0, 4), "RIFF");
  for (const c of ["EXIF", "XMP ", "ICCP"]) assert.ok(!b.includes(Buffer.from(c)), c);
});

test("roaming states map to clips: sleep->loaf, run uses walk frames, jump uses the real jump frames", () => {
  const { api } = load();
  const A = api.spriteAction;
  assert.equal(A("relaxed", "sleep", null, false, 0), "loaf");
  assert.equal(A("happy", "run", null, false, 0), "walk");
  assert.equal(A("happy", "jump", null, false, 0), "jump");
  assert.ok(["sit", "look"].includes(A("relaxed", "groom", null, false, 5)));
  assert.ok(api.sprite.actions.loaf.fps < api.sprite.actions.walk.fps, "sleep breathes slowly");
});
