// 刪除可復原（2026-11-03）：持股、交易、配息、計畫、每日紀錄刪除後 5 秒內可按「復原」，放回的是同一筆原始資料、同一個位置。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const jsx = fs.readFileSync(new URL("../src/app.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../clean.css", import.meta.url), "utf8");

function loadDeleteWithUndo() {
  const fn = jsx.match(/function deleteWithUndo\(setList, id, label\) \{[\s\S]*?\n\}\n/)[0];
  const ctx = { uid: () => "k" + Math.random(), undoToastSink: null };
  vm.createContext(ctx);
  vm.runInContext("var undoToastSink = null;\n" + fn + "\nthis.deleteWithUndo = deleteWithUndo; this.setSink = (f) => { undoToastSink = f; };", ctx);
  return ctx;
}
function fakeState(initial) {
  const s = { value: initial };
  s.set = (u) => { s.value = typeof u === "function" ? u(s.value) : u; };
  return s;
}

test("every delete site goes through deleteWithUndo (no silent one-tap delete left)", () => {
  for (const setter of ["setRecords", "setHoldings", "setTrades", "setDividends", "setPlanItems"]) {
    assert.match(jsx, new RegExp(`const remove = \\(id, label\\) => deleteWithUndo\\(${setter}, id, label\\);`), setter);
  }
  assert.ok(!/const remove = \(id\) => set\w+\(\(\w\) => \w\.filter\(\(x\) => x\.id !== id\)\);/.test(jsx));
  assert.match(jsx, /<UndoToast \/>/);
  assert.match(jsx, /const UNDO_TOAST_MS = 5000;/);
  assert.match(jsx, /`已刪除 \$\{toast\.label\}`/);
});

test("undo restores exactly the deleted record at its original position", () => {
  const ctx = loadDeleteWithUndo();
  let toast = null; ctx.setSink((t) => { toast = t; });
  const a = { id: "a", symbol: "0050", shares: 1000, price: 182.5, fee: 260, note: "x" };
  const b = { id: "b", symbol: "00878", shares: 10, costOverride: { amount: 1, includedTradeIds: ["t1"] } };
  const c = { id: "c", symbol: "2330" };
  const st = fakeState([a, b, c]);
  ctx.deleteWithUndo(st.set, "b", "00878");
  assert.equal(st.value.map((x) => x.id).join(","), ["a", "c"].join(","));
  assert.equal(toast.label, "00878");
  toast.restore();
  assert.equal(st.value.map((x) => x.id).join(","), ["a", "b", "c"].join(","));
  assert.equal(st.value[1], b, "same object, untouched");
  toast.restore();
  assert.equal(st.value.length, 3, "restoring twice never duplicates");
});

test("undo after other edits keeps those edits and still puts the record back", () => {
  const ctx = loadDeleteWithUndo();
  let toast = null; ctx.setSink((t) => { toast = t; });
  const st = fakeState([{ id: "a" }, { id: "b" }, { id: "c" }]);
  ctx.deleteWithUndo(st.set, "c", "c");
  st.set((l) => [...l, { id: "d" }]);
  toast.restore();
  assert.equal(st.value.map((x) => x.id).join(","), ["a", "b", "c", "d"].join(","));
  ctx.deleteWithUndo(st.set, "zzz", "nothing");
  assert.equal(st.value.length, 4);
  toast.restore();
  assert.equal(st.value.length, 4, "unknown id: nothing deleted, nothing restored");
});

test("toast sits above the tab bar, clear of the AI button, 44px undo button, reduced motion respected", () => {
  assert.match(css, /\.forma-undo-toast\{position:fixed;left:12px;right:80px;bottom:calc\(78px/);
  assert.match(css, /\.forma-undo-btn\{[^}]*min-height:44px/);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{\.forma-undo-toast\{animation/);
});

test("openBackup is one shared function (header, first-run guide, dashboard)", () => {
  assert.match(jsx, /const openBackup = \(\) => \{/);
  assert.equal((jsx.match(/onOpenBackup=\{openBackup\}/g) || []).length, 2);
  assert.equal((jsx.match(/document\.querySelector\("\[data-backup-card\]"\)/g) || []).length, 1);
});
