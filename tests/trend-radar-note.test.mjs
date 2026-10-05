import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function loadFunction(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) {
      end = i + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${name} should have a complete body`);
  return vm.runInNewContext(`(${source.slice(start, end)})`);
}

test("trend radar method note stays short and explains the decision in plain language", () => {
  const methodNote = loadFunction("trendRadarMethodNote");
  const zh = methodNote(false);
  const en = methodNote(true);

  assert.match(zh, /法人、量價、趨勢與海外市場訊號/);
  assert.match(zh, /資料不足.*降低.*權重/);
  assert.match(zh, /收盤後核對/);
  assert.ok(zh.length <= 75, `Chinese note is too long: ${zh.length}`);
  assert.ok(en.length <= 180, `English note is too long: ${en.length}`);
});
