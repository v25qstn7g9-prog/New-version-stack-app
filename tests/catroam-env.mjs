// 測試／模擬共用：在假的 DOM 裡跑 za-catroam.js（不是測試檔本身）。
import fs from "node:fs";
import vm from "node:vm";
export const code = fs.readFileSync(new URL("../za-catroam.js", import.meta.url), "utf8");
export const R = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
export function seeded(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// 模擬總覽：卡片（不是禁區，只當邊緣）＋卡片裡的數字／圖表（禁區）
export const CARDS = [[8, 104, 374, 110], [8, 226, 374, 300], [8, 538, 374, 160]];
export const DASH = [[24, 120, 200, 28], [24, 160, 120, 20], [24, 240, 340, 24], [24, 280, 340, 150], [24, 552, 260, 24], [24, 590, 340, 70]];
export function env({ vw = 390, vh = 844, protect = DASH, cards = CARDS, mood = "relaxed", gap = { x: 196, y: 6 } } = {}) {
  const rafs = [], docL = {}, winL = {}, classes = new Set();
  const box = { style: {}, parentNode: null, contains: () => false,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) } };
  const cat = { box, face: { style: {} }, mood, headerGap: (w) => (gap ? { x: gap.x, y: gap.y, w, h: w * 503 / 400 } : null) };
  const state = { protect, cards };
  const mk = (r, card) => ({ getBoundingClientRect: () => R(...r), matches: (s) => card && !/svg|canvas|button/.test(s) });
  const tab = { getBoundingClientRect: () => R(0, vh - 60, vw, 60) }, chat = { getBoundingClientRect: () => R(vw - 72, vh - 138, 56, 56) };
  const doc = { hidden: false, head: { appendChild() {} }, body: { getBoundingClientRect: () => R(0, 0, vw, vh), appendChild: (c) => { c.parentNode = doc.body; } },
    createElement: () => ({ style: {} }), createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}),
    querySelector: (s) => (s === ".premium-tabbar" ? tab : s === ".premium-ai-launcher" ? chat : null),
    querySelectorAll: () => [...state.protect.map((r) => mk(r, false)), ...state.cards.map((r) => mk(r, true))], addEventListener: (n, f) => { docL[n] = f; } };
  const win = { __zaPhotoCat: cat, innerWidth: vw, innerHeight: vh, addEventListener: (n, f) => { winL[n] = f; } };
  vm.runInNewContext(code, { window: win, document: doc, performance: { now: () => 0 }, requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {}, Math });
  const core = win.__zaCatRoamCore;
  // 捲動：所有內容往上移 dy，重新量（真的頁面是捲動事件標 dirty 後重量）
  const scroll = (dy) => { const sh = (r) => [r[0], r[1] - dy, r[2], r[3]]; state.protect = state.protect.map(sh); state.cards = state.cards.map(sh); core.measure(); };
  return { core, cat, box, rafs, doc, winL, classes, state, scroll, tab: tab.getBoundingClientRect(), chat: chat.getBoundingClientRect(), vw, vh };
}
export const hitR = (core, s, r) => core.hit({ x: s.x, y: s.y, w: core.W, h: core.H }, { x: r.left ?? r[0], y: r.top ?? r[1], w: r.width ?? r[2], h: r.height ?? r[3] });
// 跑 secs 秒（30fps），回傳每次「落腳」的點與行為
export function simulate({ seed = 1, secs = 600, mood = "relaxed", vw = 390, vh = 844, onStep } = {}) {
  const realR = Math.random; Math.random = seeded(seed);
  try {
    const e = env({ mood, vw, vh }); const lands = [], behaves = {};
    e.core.onLand = (s, b) => { lands.push({ x: s.x, y: s.y, edge: e.core.edgeScore(e.core.last, s) > 0, cell: e.core.cellOf(s), b }); behaves[b] = (behaves[b] || 0) + 1; };
    const modes = {};
    for (let i = 0; i < secs * 30; i++) { e.core.step(1 / 30); modes[e.core.state.mode] = (modes[e.core.state.mode] || 0) + 1; if (onStep) onStep(e, i); }
    return { e, lands, behaves, modes };
  } finally { Math.random = realR; }
}
