// 蜘蛛圖（za-catweb.js）：只讀 /api/spider，不寫資料；格式不對就用示意資料；分頁有接上。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const code = read("za-catweb.js"), css = read("za-catweb.css"), html = read("index.html");

test("wired as a tab and loaded before the kitten loader", () => {
  assert.match(html, /\{ id: "spider", label: "蜘蛛圖"/);
  assert.match(html, /case "spider":\s*return <SpiderPanel \/>/);
  assert.match(html, /<script src="\/za-catweb\.js\?v=1" defer><\/script>\s*<script src="\/za-cat\.js/);
});
test("read-only: only GETs /api/spider, never writes storage", () => {
  assert.ok(!/localStorage|sessionStorage|method:\s*"(POST|PUT|DELETE)"/.test(code));
  assert.equal((code.match(/fetch\(/g) || []).length, 1);
});
test("normalize rejects bad payloads and keeps nulls", () => {
  const w = {}; vm.runInNewContext(code, { window: w, document: {}, location: { search: "" } });
  const n = w.ZaSpider._normalize;
  assert.equal(n(null), null); assert.equal(n({ ok: false }), null);
  const d = n(w.ZaSpider._fixture);
  assert.equal(d.axes.length, 6); assert.equal(d.holdings[2].raw.pe, null);
  assert.equal(n({ ok: true, holdings: [], mood: "weird" }).mood, "flat");
});
test("respects reduced motion and image is small", () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.ok(fs.statSync(new URL("../spider-cat.webp", import.meta.url)).size < 150000);
});
