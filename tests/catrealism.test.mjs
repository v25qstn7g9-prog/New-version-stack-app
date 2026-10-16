// v4 白貓真實感：走路接縫（14 格）、去背邊緣、停下／落地／轉身的緩動與身體微擺。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { env } from "./catroam-env.mjs";

const photo = fs.readFileSync(new URL("../za-catphoto.js", import.meta.url), "utf8");
const SPRITE = JSON.parse(photo.match(/var SPRITE = (\{.*\});/)[1]);

test("walk loop is 14 frames (12 real + 2 seam tweens) and roaming advances the same 14", () => {
  const e = env();
  assert.equal(SPRITE.actions.walk.count, 14);
  assert.equal(e.core.WALK_FRAMES, SPRITE.actions.walk.count, "foot sync uses the sprite's own frame count");
  assert.ok(Math.abs(e.core.STRIDE / e.core.WALK_FRAMES - 0.8 / 12) < 1e-12, "distance per frame unchanged (no foot sliding)");
  const order = Object.values(SPRITE.actions).sort((a, b) => a.start - b.start);
  for (let i = 1; i < order.length; i++) assert.equal(order[i].start, order[i - 1].start + order[i - 1].count, "clips are contiguous");
  assert.equal(SPRITE.total, 95); assert.ok(SPRITE.total <= SPRITE.cols * SPRITE.rows);
});

test("cat assets stay <= 300KB, no EXIF/XMP/ICC, cache versions bumped", () => {
  const sz = (f) => fs.statSync(new URL("../" + f, import.meta.url)).size;
  assert.ok(sz("za-cat-sprite.webp") + sz("za-cat-photo.webp") <= 300000);
  for (const f of ["za-cat-sprite.webp", "za-cat-photo.webp"]) {
    const b = fs.readFileSync(new URL("../" + f, import.meta.url));
    for (const c of ["EXIF", "XMP ", "ICCP"]) assert.ok(!b.includes(Buffer.from(c)), f + " " + c);
  }
  assert.match(photo, /za-cat-sprite\.webp\?v=5/); assert.doesNotMatch(photo, /sc.src = "\/za-catroam/, "legacy roam archived on main (pair/life own motion)");
  assert.match(fs.readFileSync(new URL("../za-cat.js", import.meta.url), "utf8"), /za-catphoto\.js\?v=11/);
});

test("stopping decelerates smoothly (ease-out) instead of braking at a floor speed", () => {
  const { core } = env(); const v = 40;
  let prev = Infinity;
  for (let left = 40; left >= 0.5; left -= 0.5) { const s = core.easedSpeed(v, 5, left); assert.ok(s <= prev + 1e-9, "monotonic"); prev = s; }
  assert.ok(core.easedSpeed(v, 5, 1) <= v * 0.12, "almost stopped right before arriving (v3 was 0.24·vmax here)");
  assert.ok(core.easedSpeed(v, 5, 0) > 0, "never stalls");
  assert.equal(core.easedSpeed(v, 5, 999), v, "cruise at full speed");
});

test("landing squash: wide and low on touchdown, settles back to exactly 1", () => {
  const { core } = env();
  const a = core.landAt(0); assert.ok(a.sx > 1.05 && a.sy < 0.9);
  assert.equal(core.landAt(1).sx, 1); assert.equal(core.landAt(1).sy, 1);
  let prev = core.landAt(0);
  for (let q = 0.02; q <= 1; q += 0.02) { const c = core.landAt(q); assert.ok(Math.abs(c.sy - prev.sy) < 0.03, "no pops"); assert.ok(c.sy > 0.85 && c.sy < 1.05); prev = c; }
});

test("settle wobble decays to 0; walk body sway is tiny and periodic", () => {
  const { core } = env();
  assert.equal(core.settleAt(core.SETTLE, 3), 0); assert.equal(core.settleAt(-1, 3), 0);
  for (let t = 0; t < core.SETTLE; t += 0.02) assert.ok(Math.abs(core.settleAt(t, 3)) <= 3);
  assert.ok(Math.abs(core.settleAt(core.SETTLE * 0.9, 3)) < 0.1, "nearly still at the end");
  assert.ok(Math.abs(core.swayFor(0, 0.9)) < 1e-9);
  assert.ok(Math.abs(core.swayFor(core.WALK_FRAMES, 0.9)) < 1e-9, "one sway per cycle");
  for (let f = 0; f < 30; f += 0.5) assert.ok(Math.abs(core.swayFor(f, 0.9)) <= 0.9 + 1e-9);
});

test("jump landing squashes the box, walk stop wobbles then both settle to rest", () => {
  const e = env(); const st = e.core.state;
  const tick = (ms) => { const f = e.rafs.pop(); f(ms); };
  // 跳到終點
  st.mode = "jump"; st.from = { x: st.x, y: st.y }; st.target = { x: st.x + 40, y: st.y + 40 }; st.t = 10; st.chain = 0;
  e.core.step(0.016);
  assert.ok(st.land >= 0 && st.settle >= 0, "landing + settle started");
  let ms = 1000; tick(ms);
  assert.match(e.box.style.transform, /scale\(1\.0\d+,0\.(8|9)\d+\)/, "squashed on touchdown");
  for (let i = 0; i < 60; i++) { ms += 16; tick(ms); }
  assert.equal(st.land, -1); assert.equal(st.settle, -1);
  assert.ok(!/rotate/.test(e.cat.face.style.transform) || st.mode === "groom" || st.mode === "stare");
  // 走路中有身體微擺
  st.seq = []; st.mode = "walk"; st.pause = 0; st.frame = 3.5; st.t = 0; st.from = { x: st.x, y: st.y }; st.target = { x: st.x + 300, y: st.y };
  ms += 16; tick(ms);
  assert.match(e.cat.face.style.transform, /rotate\(-?0\.\d+deg\)/, "subtle body sway while walking");
});

test("mood fetch code is untouched: Bearer header, failure -> relaxed", () => {
  assert.match(photo, /authorization: "Bearer " \+ tok/);
  assert.match(photo, /function \(\) \{ if \(my === seq\) setMood\("relaxed"\); \}/);
});
