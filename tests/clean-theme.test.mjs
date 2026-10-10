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
test("Forma navy permits one asset hero gradient while other cards stay flat", () => {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(withoutComments, /--forma-hero-gradient:linear-gradient\(180deg,#384b70 0%,#526584 100%\)/);
  assert.match(withoutComments, /\.premium-dashboard>\.premium-asset-hero\{[^}]*background-image:var\(--forma-hero-gradient\)!important/);
  assert.match(withoutComments, /html\.za-clean :is\(div,section,header,span,p,button\):not\(/);
  assert.equal((withoutComments.match(/linear-gradient\(180deg/g) || []).length, 1);
});
test("navy theme is the default and redefines the shared colour variables", () => {
  assert.match(css, /html\.za-clean\[data-theme="navy"\]\{[^}]*--c-bg:#29385b/);
  assert.match(css, /@media all\{\s*html\.za-clean:not\(\[data-theme\]\)\{[^}]*--c-bg:#29385b/);
  assert.match(html, /bg: "var\(--z-bg, #3A4A75\)"/);
  assert.match(html, /<meta name="theme-color" content="#29385B" id="zaThemeColor"/);
});
test("light theme (key grey): Forma portfolio-light mist-blue page, white cards, accessible accent and red-up / green-down", () => {
  const grey = css.match(/html\.za-clean\{([\s\S]*?)\n\}/)[1];
  assert.match(grey, /--c-bg:#f3f5f9/); assert.match(grey, /--c-card:#ffffff/); assert.match(grey, /--c-ink:#19233d/);
  assert.match(grey, /--c-accent:#44749d/); assert.match(grey, /--c-bad:#e0201b/); assert.match(grey, /--c-good:#00843d/);
});
test("theme toggle: applied in <head> before paint, own key, follows the iPhone appearance until chosen, old values mapped", () => {
  const head = html.slice(0, html.indexOf("<body"));
  assert.match(head, /var K = "zaTheme"/);
  assert.match(head, /apply\(saved\(\) \|\| sysTheme\(\)\)/);
  assert.match(head, /v === "grey" \|\| v === "light"\) \? "grey"/);
  assert.match(head, /prefers-color-scheme: dark/);
  assert.ok(head.indexOf("zaTheme") < head.indexOf("clean.css"));
  assert.match(html, /<ThemeToggle showEnglish=\{showEnglish\} \/>/);
  assert.match(html, /id="themeToggle"/);
  assert.match(html, /window\.zaSetTheme\(dark \? "grey" : "navy"\)/);
});

test("readability: secondary text at least 14px, body 16px", () => {
  assert.match(css, /body\{font-size:16px;line-height:1\.55\}/);
  assert.match(css, /text-\[8px\]"\],\[class~="text-\[9px\]"\],\[class~="text-\[10px\]"\],\[class~="text-\[11px\]"\],\.text-xs\)\{font-size:14px!important/);
  assert.match(css, /\.live-quote-grid,html\.za-clean \.live-quote-heading\{font-size:14px!important/);
});
