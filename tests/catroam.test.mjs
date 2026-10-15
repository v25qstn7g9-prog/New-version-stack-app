// 會走動的小白貓（za-catroam.js）：只停在空白處、不碰分頁列與對話按鈕、背景分頁暫停、心情影響走法。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(new URL("../za-catroam.js", import.meta.url), "utf8");
const body = code.replace(/^\s*\/\/.*$/gm, "");

test("no API / storage / three.js; transforms + rAF only; no polling", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "three", "setInterval", "innerHTML"]) assert.ok(!body.includes(bad), bad);
  assert.match(body, /requestAnimationFrame/); assert.match(body, /translate3d/);
  assert.ok(!/style\.(left|top)\s*=\s*[^"]*st\./.test(body), "per-frame movement uses transform, not left/top");
});

const R = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
function env({ vw = 390, vh = 844, protect = [], mood = "relaxed", hidden = false, gap = { x: 196, y: 6 } } = {}) {
  const rafs = [], docL = {}, winL = {};
  const el = (r) => ({ getBoundingClientRect: () => r });
  const classes = new Set();
  const box = { style: {}, parentNode: null, contains: () => false,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const cat = { box, face: {}, mood, headerGap: (w) => (gap ? { x: gap.x, y: gap.y, w, h: w * 503 / 400 } : null) };
  const tab = el(R(0, vh - 60, vw, 60)), chat = el(R(vw - 72, vh - 60 - 78, 56, 56));
  const protEls = protect.map((r) => el(R(...r)));
  const doc = {
    hidden, head: { appendChild() {} }, body: { getBoundingClientRect: () => R(0, 0, vw, vh), appendChild: (c) => { c.parentNode = doc.body; } },
    createElement: () => ({ style: {} }), createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}),
    querySelector: (s) => (s === ".premium-tabbar" ? tab : s === ".premium-ai-launcher" ? chat : null),
    querySelectorAll: () => protEls, addEventListener: (n, f) => { docL[n] = f; },
  };
  const win = { __zaPhotoCat: cat, innerWidth: vw, innerHeight: vh, addEventListener: (n, f) => { winL[n] = f; } };
  vm.runInNewContext(code, { window: win, document: doc, performance: { now: () => 0 }, requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {}, Math });
  const core = win.__zaCatRoamCore;
  return { core, cat, box, rafs, doc, docL, winL, classes, tab: tab.getBoundingClientRect(), chat: chat.getBoundingClientRect(), vw, vh };
}
const rect = (s, core) => ({ x: s.x, y: s.y, w: core.W, h: core.H });
const toXY = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
function seeded(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 模擬總覽：總資產卡、資產曲線、回撤列（都是禁區）
const DASH = [[12, 180, 366, 60], [12, 250, 200, 24], [12, 300, 366, 160], [12, 470, 260, 24], [290, 470, 88, 24], [12, 520, 366, 120]];

test("cat is phone-sized: 60-76px box (cat itself ~55-65px) at 375/390/430", () => {
  for (const vw of [375, 390, 430]) { const { core } = env({ vw }); assert.ok(core.W >= 60 && core.W <= 76, vw + ":" + core.W); }
  const { core } = env({ vw: 1400 }); assert.equal(core.W, 76, "does not grow on desktop");
});

test("rest spots never touch protected rects (numbers, chart, 回撤), tab bar or chat button", () => {
  const e = env({ protect: DASH });
  const L = e.core.measure();
  const spots = e.core.findSpots(L);
  assert.ok(spots.length > 0, "some clear whitespace exists");
  for (const s of spots) {
    const r = rect(s, e.core);
    for (const p of DASH) assert.ok(!e.core.hit(r, toXY(R(...p))), JSON.stringify([s, p]));
    assert.ok(!e.core.hit(r, toXY(e.tab)) && !e.core.hit(r, toXY(e.chat)));
    assert.ok(r.y + r.h <= e.chat.top, "whole play area is above the chat button and tab bar");
  }
});

test("no clear spot -> goes back to the header gap; no header gap either -> hides", () => {
  const full = [[0, 0, 390, 844]];
  let e = env({ protect: full });
  let s = e.core.pick(e.core.measure(), null, "relaxed", () => 0.5);
  assert.ok(s && s.home); assert.equal(s.x, 196);
  e = env({ protect: full, gap: null });
  assert.equal(e.core.pick(e.core.measure(), null, "relaxed", () => 0.5), null);
});

test("simulated 10 minutes per mood: never pauses over content, never overlaps tab bar/chat, even while walking", () => {
  for (const mood of ["happy", "relaxed", "sad"]) for (const seed of [1, 7, 42]) {
    const realR = Math.random; Math.random = seeded(seed);
    try {
      const e = env({ protect: DASH, mood });
      const L = e.core.last, st = e.core.state;
      let rests = 0, walking = 0;
      for (let i = 0; i < 600 * 30; i++) {
        e.core.step(1 / 30);
        const r = { x: st.x, y: st.y, w: e.core.W, h: e.core.H };
        assert.ok(!e.core.hit(r, toXY(e.tab)) && !e.core.hit(r, toXY(e.chat)), `${mood} overlaps tab/chat at frame ${i}`);
        if (e.core.isRest(st.mode)) { rests++; assert.ok(e.core.validSpot(L, st.spot), `${mood} resting on content`); } else walking++;
      }
      assert.ok(walking > 0 && rests > 0, `${mood} both walks and rests`);
    } finally { Math.random = realR; }
  }
});

test("mood affects movement: happy fastest, sad slowest and stays near the header gap", () => {
  const { core } = env();
  assert.ok(core.SPEED.happy > core.SPEED.relaxed && core.SPEED.relaxed > core.SPEED.sad);
  const realR = Math.random; Math.random = seeded(3);
  try {
    const e = env({ protect: DASH, mood: "sad" }); const st = e.core.state;
    for (let i = 0; i < 600 * 30; i++) { e.core.step(1 / 30); if (e.core.isRest(st.mode)) assert.ok(Math.hypot(st.x - 196, st.y - 6) <= 221 || st.spot.home); }
  } finally { Math.random = realR; }
});

test("faces the walking direction (flip class) and relaxed naps get the nap class", () => {
  const realR = Math.random; Math.random = seeded(9);
  try {
    const e = env({ protect: DASH, mood: "relaxed" }); const st = e.core.state;
    let flips = new Set(), napped = false;
    for (let i = 0; i < 1200 * 30; i++) { e.core.step(1 / 30); if (!e.core.isRest(st.mode)) flips.add(e.classes.has("za-face-r")); if (e.classes.has("za-nap")) napped = true; }
    assert.equal(flips.size, 2, "walks both ways, image flipped"); assert.ok(napped);
  } finally { Math.random = realR; }
});

test("scroll puts content under a resting cat -> it leaves right away (urgent)", () => {
  const e = env({ protect: [] }); const st = e.core.state;
  st.mode = "sit"; st.spot = { x: 100, y: 300 }; st.x = 100; st.y = 300; st.wait = 99; st.t = 0;
  e.core.last.protect.push({ x: 90, y: 290, w: 100, h: 100 });
  e.core.step(1 / 30);
  assert.ok(!e.core.isRest(st.mode)); assert.equal(st.urgent, true);
});

test("tab hidden -> no animation frames; visible again -> resumes", () => {
  const e = env();
  assert.equal(e.rafs.length, 1);
  e.doc.hidden = true; const n = e.rafs.length; e.rafs[n - 1](16); assert.equal(e.rafs.length, n, "hidden: frame does not reschedule");
  e.docL.visibilitychange(); assert.equal(e.core.isRunning(), false);
  e.doc.hidden = false; e.docL.visibilitychange(); assert.equal(e.rafs.length, n + 1); assert.equal(e.core.isRunning(), true);
});

test("layout is measured only when marked dirty (scroll/resize/redraw), throttled — not every frame", () => {
  const e = env(); let calls = 0; const orig = e.core.measure;
  e.doc.querySelectorAll = () => { calls++; return []; };
  for (let i = 1; i <= 60; i++) e.rafs[e.rafs.length - 1](i * 16);
  assert.equal(calls, 0, "no re-measure without a change");
  e.winL.resize(); e.rafs[e.rafs.length - 1](61 * 16);
  assert.equal(calls, 1, "one re-measure after resize");
  e.cat.roam.refresh(); for (let i = 62; i <= 70; i++) e.rafs[e.rafs.length - 1](i * 16);  // < 250ms later
  assert.equal(calls, 1, "throttled to ≥250ms apart");
  for (let i = 71; i <= 80; i++) e.rafs[e.rafs.length - 1](i * 16);
  assert.equal(calls, 2, "then measured once more");
});

test("takes over the box: fixed, roaming class, moves via transform", () => {
  const e = env();
  assert.ok(e.classes.has("za-roaming")); assert.match(e.box.style.transform, /translate3d/);
  assert.equal(e.box.parentNode, e.doc.body);
  assert.match(code, /\.za-photocat\.za-roaming\.za-roaming\{position:fixed/);
});

test("state machine durations: sleep 40-90s, sit/groom 10-25s; sad never runs or jumps", () => {
  const { core } = env(); const r = seeded(5); const seen = {};
  for (let i = 0; i < 2000; i++) for (const mood of ["happy", "relaxed", "sad"]) {
    const p = core.planRest(mood, r); (seen[p.mode] ||= []).push(p.wait);
    const lim = p.mode === "sleep" ? [40, 90] : [10, 25];
    assert.ok(p.wait >= lim[0] && p.wait <= lim[1], p.mode + " " + p.wait);
    if (mood === "sad") assert.equal(core.planTravel("sad", 300, 80, false, r), "walk");
  }
  for (const k of ["sleep", "sit", "groom"]) assert.ok(seen[k] && seen[k].length > 100, k);
});

test("travel: long trips sometimes run, close spots at a different height sometimes jump, urgent runs", () => {
  const { core } = env();
  assert.equal(core.planTravel("happy", 120, 60, false, () => 0), "jump");
  assert.equal(core.planTravel("happy", 300, 0, false, () => 0), "run");
  assert.equal(core.planTravel("relaxed", 300, 0, false, () => 0.99), "walk");
  assert.equal(core.planTravel("relaxed", 60, 0, true, () => 0.99), "run");
  assert.equal(core.planTravel("relaxed", 500, 200, false, () => 0.99), "walk", "too far to jump");
});

test("walk eases in and out; feet are synced to distance (no sliding)", () => {
  const { core } = env();
  const v = 40;
  assert.ok(core.easedSpeed(v, 0, 200) < v * 0.2, "starts slowly");
  assert.ok(core.easedSpeed(v, 0.35, 200) < core.easedSpeed(v, 1, 200), "accelerates");
  assert.equal(core.easedSpeed(v, 2, 200), v, "cruises");
  assert.ok(core.easedSpeed(v, 2, 2) < v * 0.4, "slows before stopping");
  const per = core.framesFor(100, 64, false); assert.ok(Math.abs(per - 100 / (64 * 0.8) * 18) < 1e-9);
  // 12 fps-ish at cruise: frames per second = speed / stride * 18
  const fps = core.framesFor(v, 64, false); assert.ok(fps > 10 && fps < 16, String(fps));
  const runFps = core.framesFor(core.RUN, 64, true); assert.ok(runFps > fps && runFps < 30, String(runFps));
});

test("jump arc: crouch on the ground, lift in the air, lands; uses all 6 real frames", () => {
  const { core } = env(); const J = core.JUMP, T = J.crouch + J.air + J.land, frames = new Set();
  let maxLift = 0;
  for (let t = 0; t <= T + 0.01; t += 0.01) { const j = core.jumpAt(t); frames.add(j.frame); maxLift = Math.max(maxLift, j.lift); if (t < J.crouch) assert.equal(j.lift, 0); }
  assert.deepEqual([...frames].sort(), [0, 1, 2, 3, 4, 5]); assert.ok(maxLift > 0.95);
  assert.equal(core.jumpAt(T + 0.01).done, true);
});

test("a full simulated hour: sleeps happen and last 40-90s; jumps and runs occur for happy", () => {
  const realR = Math.random; Math.random = seeded(11);
  try {
    const e = env({ protect: DASH, mood: "happy" }); const st = e.core.state;
    let prev = st.mode, since = 0, modes = new Set();
    for (let i = 0; i < 3600 * 30; i++) {
      e.core.step(1 / 30); modes.add(st.mode);
      if (st.mode !== prev) { if (prev === "sleep") assert.ok(since >= 39.9 && since <= 90.1, "sleep lasted " + since); prev = st.mode; since = 0; }
      since += 1 / 30;
    }
    for (const m of ["walk", "sleep", "sit", "groom"]) assert.ok(modes.has(m), m);
    assert.ok(modes.has("run") || modes.has("jump"), "some run or jump");
  } finally { Math.random = realR; }
});

test("tap: wakes a sleeping cat, pauses a walking cat, and hops", () => {
  const e = env(); const st = e.core.state;
  st.mode = "sleep"; st.t = 5; st.wait = 60; e.core.react("blink");
  assert.equal(st.mode, "sit"); assert.ok(st.hop > 0);
  e.core.go(false); const x = st.x, y = st.y; e.core.react("jump"); e.core.step(0.5);
  assert.equal(st.x, x); assert.equal(st.y, y); assert.ok(st.pause > 0);
});
