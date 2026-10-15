// 真貓照片版小白貓：純裝飾，不碰資料、不能點、只坐在標題列空位（不蓋數字與圖表），空位不夠就不顯示。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(new URL("../za-catphoto.js", import.meta.url), "utf8");

test("DOM-only, cannot be tapped, hidden from screen readers, small image", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "sendBeacon", "/api/", "innerHTML", "innerText"]) assert.ok(!code.includes(bad), bad);
  assert.match(code, /pointer-events:none/); assert.match(code, /aria-hidden/);
  assert.match(code, /prefers-reduced-motion:reduce/);
  assert.ok(!/position:fixed/.test(code), "sits inside the header row, never floats over content");
  assert.ok(fs.statSync(new URL("../za-cat-photo.webp", import.meta.url)).size < 150000);
});

function env({ titleRight, btnLeft }) {
  const rect = (l, r, t = 10, b = 46) => ({ left: l, right: r, top: t, bottom: b, width: r - l, height: b - t });
  const kids = [];
  const mk = (tag) => ({ tag, style: {}, children: [], appendChild(c) { this.children.push(c); c.parentNode = this; }, setAttribute() {}, addEventListener() {}, contains: (x) => x === this, removeChild() {} });
  const title = { getBoundingClientRect: () => rect(16, titleRight) };
  const btns = { getBoundingClientRect: () => rect(btnLeft, 374) };
  const h1 = { firstElementChild: title, nextElementSibling: btns };
  const row = { style: {}, getBoundingClientRect: () => rect(16, 374), querySelector: () => h1, appendChild(c) { kids.push(c); c.parentNode = row; } };
  const doc = { head: { appendChild() {} }, body: {}, createElement: mk, querySelector: () => row };
  const win = { addEventListener() {} };
  vm.runInNewContext(code, { window: win, document: doc, getComputedStyle: () => ({ position: "static" }), requestAnimationFrame: (f) => f(), MutationObserver: function () { this.observe = () => {}; } });
  return { api: win.__zaPhotoCat, kids, row };
}
test("sits in the gap between title and buttons, never overlapping either", () => {
  const { api, kids } = env({ titleRight: 210, btnLeft: 300 });
  assert.equal(api.shown, true); assert.equal(kids.length, 1);
  const box = kids[0], left = parseFloat(box.style.left) + 16, w = parseFloat(box.style.width);
  assert.ok(left >= 210 && left + w <= 300, `cat ${left}-${left + w} inside gap 210-300`);
  assert.ok(w <= 36);
  assert.ok(parseFloat(box.style.top) + w * 503 / 400 <= 36 + 0.5, "feet on the row bottom, not below the header row");
});
test("not enough room -> hidden", () => {
  const { api } = env({ titleRight: 280, btnLeft: 300 });
  assert.equal(api.shown, false);
});
