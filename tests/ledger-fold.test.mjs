// 每日紀錄：週／月／年度損益與歷史紀錄是固定高度、框內滑動、可收合的框（使用者 2026-10-29「每段記錄應該是固定一定框的高度
// 然後裡面記要能查閱滑動…每個記錄框可以加收合鍵」）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the four ledger lists are FoldPanels with a fixed height", () => {
  for (const [key, h] of [["week", "21rem"], ["month", "21rem"], ["year", "21rem"], ["history", "30rem"]]) {
    assert.match(src, new RegExp(`<FoldPanel [^>]*foldKey="${key}"[^>]*maxH="${h}"`), key);
  }
  assert.ok(!/<Panel title="(週度|月度|年度)損益">/.test(src), "no plain Panel left for these lists");
});

test("FoldPanel: the body scrolls inside the box, the title row is a 44px button that folds it and is remembered on this device", () => {
  const fp = src.slice(src.indexOf("function FoldPanel("), src.indexOf("function Panel("));
  assert.match(fp, /maxHeight: maxH, overflowY: "auto"/);
  assert.match(fp, /aria-expanded=\{open\} aria-controls=\{bodyId\}/);
  assert.match(fp, /minHeight: 44/);
  assert.match(fp, /const storeKey = "ledger_fold_" \+ foldKey;/);
  assert.match(fp, /localStorage\.setItem\(storeKey, next \? "1" : "0"\)/);
  assert.match(fp, /try \{ return localStorage\.getItem\(storeKey\) !== "0"; \} catch \(e\) \{ return true; \}/);
  assert.match(fp, /\{open && \(\s*<div id=\{bodyId\}/);
});

test("the folded title row has no extra space (clean.css, cache-busted)", () => {
  assert.match(css, /\.premium-panel>\.premium-panel-title\.forma-fold-head\{[^}]*margin:-8px 0!important;padding:0!important/);
  assert.match(html, /href="\/clean\.css\?v=ledger-fold-1"/);
});
