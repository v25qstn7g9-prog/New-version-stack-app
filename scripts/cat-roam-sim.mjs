// 小白貓 v3 落腳點模擬（seeded）：node scripts/cat-roam-sim.mjs [out.png] → 落點熱度圖 PNG＋統計（JSON 印在 stdout）。
// 用 tests/catroam-env.mjs 的假版面（390×844、三張卡片＋數字／圖表禁區），每次 10 分鐘。
import fs from "node:fs";
import zlib from "node:zlib";
import { simulate, CARDS, DASH } from "../tests/catroam-env.mjs";
const out = process.argv[2] || "cat-roam-heatmap.png";
const VW = 390, VH = 844, CELL = 48, SEEDS = [42, 43, 44, 45, 46, 47, 48, 49, 50, 51];
const stat = (lands) => { const per = {}; lands.forEach((l) => (per[l.cell] = (per[l.cell] || 0) + 1)); const n = lands.length;
  return { landings: n, uniqueCells: Object.keys(per).length, maxCellShare: n ? +(Math.max(...Object.values(per)) / n).toFixed(3) : 0, edgeShare: n ? +(lands.filter((l) => l.edge).length / n).toFixed(3) : 0 }; };
const res = { single: {}, aggregate: {} }, all = [];
for (const mood of ["happy", "relaxed", "sad"]) {
  const one = simulate({ seed: 42, secs: 600, mood }); res.single[mood] = { seed: 42, secs: 600, ...stat(one.lands), behaviours: one.behaves };
  const agg = []; for (const seed of SEEDS) agg.push(...simulate({ seed, secs: 600, mood }).lands);
  res.aggregate[mood] = { seeds: SEEDS.length, secsEach: 600, ...stat(agg) }; all.push(...agg);
}
const { e } = simulate({ seed: 42, secs: 1 }); const W = e.core.W, H = e.core.H;
const spots = e.core.findSpots(e.core.last); res.uniformEdgeShareOfFreeSpots = +(spots.filter((s) => e.core.edgeScore(e.core.last, s) > 0).length / spots.length).toFixed(3);
res.all = stat(all);
// 畫圖：灰＝卡片、紅＝禁區、深色＝分頁列／對話鈕、熱度＝落腳格（黃→紅）
const S = 1, img = Buffer.alloc(VW * VH * 3, 250);
const fill = (x, y, w, h, c, a = 1) => { for (let j = Math.max(0, y | 0); j < Math.min(VH, y + h); j++) for (let i = Math.max(0, x | 0); i < Math.min(VW, x + w); i++) { const k = (j * VW + i) * 3; for (let t = 0; t < 3; t++) img[k + t] = Math.round(img[k + t] * (1 - a) + c[t] * a); } };
CARDS.forEach((r) => fill(...r, [215, 220, 228]));
DASH.forEach((r) => fill(...r, [240, 150, 150], 0.6));
fill(0, VH - 60, VW, 60, [60, 60, 70]); fill(VW - 72, VH - 138, 56, 56, [60, 60, 70]);
const per = {}; all.forEach((l) => (per[l.cell] = (per[l.cell] || 0) + 1)); const mx = Math.max(...Object.values(per));
for (const [c, n] of Object.entries(per)) { const [cx, cy] = c.split(",").map(Number); const q = n / mx; fill(cx * CELL + 2, cy * CELL + 2, CELL - 4, CELL - 4, [255, Math.round(230 * (1 - q)), 0], 0.35 + 0.6 * q); }
all.forEach((l) => fill(l.x + W / 2 - 1, l.y + H - 1, 3, 3, [20, 20, 120]));
const raw = Buffer.alloc((VW * 3 + 1) * VH); for (let y = 0; y < VH; y++) { raw[y * (VW * 3 + 1)] = 0; img.copy(raw, y * (VW * 3 + 1) + 1, y * VW * 3, (y + 1) * VW * 3); }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(VW, 0); ih.writeUInt32BE(VH, 4); ih[8] = 8; ih[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(JSON.stringify(res, null, 1));
