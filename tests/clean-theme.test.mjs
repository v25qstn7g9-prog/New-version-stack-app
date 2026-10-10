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
test("automatic dark mode redefines the shared colour variables", () => {
  assert.match(css, /html\.za-clean\[data-theme="dark"\]\{[^}]*--c-bg:#111317/);
  assert.match(html, /bg: "var\(--z-bg, #FAF8F4\)"/);
  assert.match(html, /gold: "var\(--z-gold, #3457C9\)"/);
});

test("default light theme is warm off-white, never pure white", () => {
  const light = css.match(/html\.za-clean\{([\s\S]*?)\n\}/)[1];
  assert.match(light, /--c-bg:#f3f0ea/); assert.match(light, /--c-card:#faf8f4/);
  assert.ok(!/#fff(fff)?\b/i.test(light));
  for (const k of ["bg", "panel", "text"]) assert.ok(!new RegExp(k + ': "var\\(--z-[a-z-]+, #FFFFFF\\)"').test(html), k);
});
test("theme toggle: applied in <head> before paint, own storage key, follows system on first visit", () => {
  const head = html.slice(0, html.indexOf("</head>") > 0 ? html.indexOf("</head>") : html.indexOf("<body"));
  assert.match(head, /var K = "zaTheme"/);
  assert.match(head, /prefers-color-scheme: dark/);
  assert.match(head, /root\.setAttribute\("data-theme", t\)/);
  assert.match(head, /id="zaThemeColor"/);
  assert.ok(head.indexOf("zaTheme") < head.indexOf("clean.css"));
  assert.match(html, /<ThemeToggle showEnglish=\{showEnglish\} \/>/);
  assert.match(html, /id="themeToggle"/);
  assert.match(css, /html\.za-clean:not\(\[data-theme\]\)/);
});
