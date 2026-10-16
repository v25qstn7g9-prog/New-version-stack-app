// v3 走動：整個畫面、偏好邊緣、加權隨機作息、空間記憶、禁區、減少動態效果。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { env, simulate, seeded, hitR, DASH, R } from "./catroam-env.mjs";

test("behaviour choice is weighted random (not a cycle): frequencies follow weights, no fixed period", () => {
  const { core } = env(); const r = seeded(4), N = 20000;
  for (const mood of ["happy", "relaxed", "sad"]) {
    const c = { stay: 0, patrol: 0, zoom: 0, jump: 0 }, seq = [];
    for (let i = 0; i < N; i++) { const b = core.planNext(mood, r); c[b]++; seq.push(b); }
    ["stay", "patrol", "zoom", "jump"].forEach((k, i) => assert.ok(Math.abs(c[k] / N - core.BEHAVE[mood][i]) < 0.02, mood + " " + k + " " + c[k] / N));
    assert.ok(c.stay / N > 0.29, "mostly stays/rests");
    for (let p = 1; p <= 12; p++) { let same = 0; for (let i = p; i < N; i++) if (seq[i] === seq[i - p]) same++; assert.ok(same / (N - p) < 0.6, "no period " + p); }
  }
  assert.equal(core.BEHAVE.sad[2] + core.BEHAVE.sad[3], 0, "sad: no zoomies, no jumps");
});

test("simulated 30 min happy: sleeps, idles, grooms, stares, patrols, zooms (runs) and jumps onto edges; rest lengths vary", () => {
  const rests = []; let cur = null, len = 0;
  const { behaves, modes } = simulate({ seed: 5, secs: 1800, mood: "happy", onStep: (e) => { const m = e.core.state.mode; if (m !== cur) { if (e.core.isRest(cur)) rests.push(len); cur = m; len = 0; } len++; } });
  for (const m of ["sleep", "sit", "groom", "stare", "walk", "run", "jump", "trans"]) assert.ok(modes[m] > 0, "mode " + m);
  for (const b of ["patrol", "zoom", "jump"]) assert.ok(behaves[b] > 0, "behaviour " + b + " " + JSON.stringify(behaves));
  const restT = (modes.sleep + modes.sit + modes.groom + modes.stare) / 54000;
  assert.ok(restT > 0.7, "mostly resting: " + restT);
  assert.ok(new Set(rests.map((n) => Math.round(n / 30))).size > rests.length * 0.5, "rest durations irregular");
});

test("spatial memory: recently visited cells are penalised and the cat does not keep returning", () => {
  const { core } = env(); const L = core.last;
  const s = { x: 200, y: 400 };
  assert.equal(core.memPenalty([], s), 1);
  assert.ok(core.memPenalty([core.cellOf(s)], s) < 0.2);
  assert.ok(core.memPenalty([core.cellOf(s), core.cellOf(s)], s) < 0.04, "repeated visits compound");
  assert.ok(core.spotWeight(L, s, null, "happy", [core.cellOf(s)]) < core.spotWeight(L, s, null, "happy", []) * 0.2);
  // pick with vs without memory: memory spreads landings
  const count = (useMem) => { const r = seeded(9), mem = [], seen = {}; for (let i = 0; i < 400; i++) { const p = core.pick(L, null, "happy", r, useMem ? mem : null); const c = core.cellOf(p); seen[c] = (seen[c] || 0) + 1; mem.push(c); if (mem.length > core.MEM_N) mem.shift(); } return Math.max(...Object.values(seen)); };
  assert.ok(count(true) < count(false), "memory lowers the most-visited cell count");
  for (const seed of [1, 2, 3]) {
    const { lands } = simulate({ seed, secs: 3600, mood: "happy" });
    let rep = 0; for (let i = 1; i < lands.length; i++) if (lands[i].cell === lands[i - 1].cell) rep++;
    assert.ok(rep / lands.length < 0.05, "immediate return rate " + rep / lands.length);
    const per = {}; lands.forEach((l) => (per[l.cell] = (per[l.cell] || 0) + 1));
    assert.ok(Math.max(...Object.values(per)) / lands.length < 0.12, "no cell dominates");
  }
});

test("range is the whole viewport and landings are biased to edges/corners (cards, header, screen edges)", () => {
  const { core } = env(); const L = core.last;
  assert.ok(core.edgeScore(L, { x: 4, y: 700 }) >= 1, "screen edge");
  assert.ok(core.edgeScore(L, { x: 160, y: 104 - core.H }) >= 1, "sitting on a card's top edge");
  assert.ok(core.edgeScore(L, { x: 4, y: L.top }) >= 2, "corner counts twice");
  const spots = core.findSpots(L), base = spots.filter((s) => core.edgeScore(L, s) > 0).length / spots.length;
  const { lands, e } = simulate({ seed: 3, secs: 1200, mood: "happy" });
  const edge = lands.filter((l) => l.edge).length / lands.length;
  assert.ok(edge > base + 0.1, `edge share ${edge} vs uniform ${base}`);
  const xs = lands.map((l) => l.x), ys = lands.map((l) => l.y);
  assert.ok(Math.min(...xs) < 40 && Math.max(...xs) > e.vw - e.core.W - 40, "uses full width");
  assert.ok(Math.max(...ys) - Math.min(...ys) > 400, "uses full height");
});

test("follows scroll: spots are viewport coords, re-measured after scroll; a rest spot that becomes content is left at once", () => {
  const e = env({ mood: "relaxed" }); const before = e.core.findSpots(e.core.last).length;
  e.scroll(300);
  const L = e.core.last; const spots = e.core.findSpots(L);
  assert.ok(spots.length !== before);
  for (const s of spots) for (const p of e.state.protect) assert.ok(!hitR(e.core, s, p));
  const st = e.core.state; const p = e.state.protect[2];
  st.mode = "stare"; st.spot = { x: p[0], y: p[1] }; st.x = p[0]; st.y = p[1]; st.t = 0; st.wait = 99;
  e.core.step(1 / 30); assert.ok(!e.core.isRest(st.mode) && st.urgent);
});

test("protected zones over 10 simulated minutes per mood (incl. zoomies/jumps): never rests on numbers/charts, never covers tab bar or chat", () => {
  for (const mood of ["happy", "relaxed", "sad"]) for (const seed of [11, 12]) simulate({ seed, mood, secs: 600, onStep: (e, i) => {
    const st = e.core.state;
    assert.ok(!hitR(e.core, st, e.tab) && !hitR(e.core, st, e.chat), `${mood} over tab/chat @${i}`);
    assert.ok(st.y + e.core.H <= e.chat.top, "stays above chat/tab");
    if (e.core.isRest(st.mode)) { assert.ok(e.core.validSpot(e.core.last, st.spot)); for (const p of DASH) assert.ok(!hitR(e.core, st.spot, p), `${mood} rests on content`); }
  } });
});

test("groom/stare have no own frames: existing frames + small CSS motion; reduced motion -> roaming never loaded (static)", () => {
  const photo = fs.readFileSync(new URL("../za-catphoto.js", import.meta.url), "utf8");
  assert.match(photo, /stare: "look"/);
  assert.match(photo, /prefers-reduced-motion: reduce[\s\S]*if \(!\(rm && rm\.matches\)[\s\S]*za-catroam\.js\?v=4/);
  const e = env(); const st = e.core.state;
  st.mode = "groom"; st.t = 0.3; e.rafs[e.rafs.length - 1](16);
  assert.match(e.cat.face.style.transform, /rotate\(/);
});
