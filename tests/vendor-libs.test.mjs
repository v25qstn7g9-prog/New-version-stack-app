// React／ReactDOM／Recharts 改成存一份在自己網站（vendor/），不再從 unpkg 載入（2026-11-03）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("browser libraries load from /vendor with the same pinned versions, not unpkg", () => {
  assert.ok(!/<script[^>]+unpkg\.com/.test(html));
  const order = ["react-18.3.1.production.min.js", "react-dom-18.3.1.production.min.js", "react-is-18.3.1.production.min.js", "prop-types-15.8.1.min.js", "recharts-2.12.7.js"];
  let last = -1;
  for (const f of order) {
    const i = html.indexOf(`<script src="/vendor/${f}"></script>`);
    assert.ok(i > last, f + " loaded in order");
    last = i;
    assert.ok(fs.statSync(new URL("../vendor/" + f, import.meta.url)).size > 1000, f);
  }
  assert.ok(last < html.indexOf('<script src="/app.js'), "libraries before app.js");
  assert.match(fs.readFileSync(new URL("../vendor/react-18.3.1.production.min.js", import.meta.url), "utf8").slice(0, 200), /@license React/);
  assert.match(fs.readFileSync(new URL("../vendor/recharts-2.12.7.js", import.meta.url), "utf8").slice(0, 200), /Recharts/);
});
