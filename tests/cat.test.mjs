// 小貓載入順序：za-cat.js 要在 clean-ui.js 前面（clean-ui.js 必須最後），舊的蜘蛛與舊版小貓檔已移除。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readAppSource } from './_app-source.mjs';
const html = readAppSource();

test("loader loaded just before clean-ui.js (which must stay last), and the spider is gone", () => {
  assert.match(html, /<script src="\/za-cat\.js[^"]*" defer><\/script>\s*<script src="\/clean-ui\.js[^"]*" defer><\/script>\s*<\/body>/);
  assert.ok(!html.includes("za-spider"));
  assert.ok(!fs.existsSync(new URL("../za-spider.js", import.meta.url)));
});

test("unused legacy cat files and the temporary QA page are no longer published", () => {
  for (const f of ["za-cat2d.js", "za-cat3d.js", "za-catroam.js", "vendor/three.module.min.js", "ui-review.html", "docs/zinf-market-hours-sync-hook.js"]) {
    assert.ok(!fs.existsSync(new URL("../" + f, import.meta.url)), f + " should be deleted");
  }
  const loader = fs.readFileSync(new URL("../za-cat.js", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/za-cat3d|za-cat2d|za-catroam/.test(loader));
});
