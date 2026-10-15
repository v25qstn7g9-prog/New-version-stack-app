// 標題列的像素小蜘蛛：純裝飾，只能是外觀（不呼叫 API、不碰儲存），並且尊重「減少動態效果」。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");
const headerSrc = html.slice(html.indexOf("function Header("), html.indexOf("// ---------------- News Carousel"));
test("header carries an aria-hidden decorative spider", () => {
  assert.match(headerSrc, /<span className="za-spider" aria-hidden="true">/);
  assert.match(headerSrc, /className="za-legs-a"/);
  assert.match(headerSrc, /className="za-legs-b"/);
});
test("spider cannot be tapped and does not use a new accent colour", () => {
  const rule = css.match(/html\.za-clean \.za-spider\{[^}]*\}/)[0];
  assert.match(rule, /pointer-events:none/);
  assert.match(rule, /color:var\(--c-muted\)/);
});
test("reduced motion stops the spider", () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{html\.za-clean \.za-spider,html\.za-clean \.za-spider \*\{animation:none!important\}\}/);
});
test("spider markup has no data access", () => {
  const spider = headerSrc.slice(headerSrc.indexOf('<span className="za-spider"'));
  for (const bad of ["fetch(", "localStorage", "onClick", "/api/"]) assert.ok(!spider.includes(bad), bad);
});
