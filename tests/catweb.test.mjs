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

// 用假的畫面環境實際掛載一次，看畫出來的 HTML。
async function mountWith({ search = "", fetchImpl }) {
  const w = { fetch: fetchImpl };
  const cls = { add() {}, remove() {} };
  const doc = { getElementById: () => ({}), documentElement: { classList: cls }, head: { appendChild() {} }, createElement: () => ({}) };
  vm.runInNewContext(code, { window: w, fetch: fetchImpl, document: doc, location: { search }, URLSearchParams, Promise, Date, Math });
  const root = { innerHTML: "", setAttribute() {}, addEventListener() {}, removeEventListener() {}, contains: () => true };
  w.ZaSpider.mount(root);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  return root.innerHTML;
}
const MOCK_CODE = /0056|00878|2884|元大高股息|示意資料/;
for (const [name, impl] of [
  ["404", () => Promise.resolve({ ok: false, status: 404 })],
  ["500", () => Promise.resolve({ ok: false, status: 500 })],
  ["401", () => Promise.resolve({ ok: false, status: 401 })],
  ["network", () => Promise.reject(new Error("offline"))],
  ["ok!=true", () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false }) })],
]) {
  test(`error (${name}) -> 讀取失敗 + retry, no mock values`, async () => {
    const html = await mountWith({ fetchImpl: impl });
    assert.match(html, /讀取失敗/); assert.match(html, /data-retry/);
    assert.doesNotMatch(html, MOCK_CODE);
    assert.match(html, /fs-cat/);                       // 小貓還在
    assert.doesNotMatch(html, /fs-dot">\d/);            // 節點沒有任何數字
  });
}
test("empty holdings -> empty state, no numbers", async () => {
  const html = await mountWith({ fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, axes: [], holdings: [] }) }) });
  assert.match(html, /目前沒有持股資料/); assert.doesNotMatch(html, /讀取失敗/); assert.doesNotMatch(html, /fs-dot">\d/);
});
test("?spiderMock=1 -> mock data, fetch not called", async () => {
  let called = 0;
  const html = await mountWith({ search: "?spiderMock=1", fetchImpl: () => { called++; return Promise.reject(); } });
  assert.equal(called, 0); assert.match(html, /0056/); assert.match(html, /示意資料/);
});
