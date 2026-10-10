// 清爽版外觀：確認樣式層有載入、外觀小幫手只動畫面（不呼叫 API、不碰儲存）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../clean-ui.js", import.meta.url), "utf8");
test("clean.css loads after the inline style block and clean-ui.js before </body>", () => {
  assert.ok(html.indexOf('href="/clean.css') > html.indexOf("</style>"));
  assert.match(html, /<script src="\/clean-ui\.js[^"]*" defer><\/script>\s*<\/body>/);
  assert.match(html, /<html class="za-clean"/);
});
test("inputs are 17px so iPhone does not zoom", () => { assert.match(css, /font-size:17px!important/); });
test("clean-ui.js is DOM-only", () => {
  for (const bad of ["fetch(", "XMLHttpRequest", "localStorage", "indexedDB", "sendBeacon", "/mcp", "/api/"]) assert.ok(!js.includes(bad), bad);
});
test("clean.css has no gradients except the select arrow icon", () => {
  assert.ok(!/linear-gradient|radial-gradient/.test(css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/linear-gradient\(to bottom, rgba\(255/g, "")));
});
