// app.js 是 src/app.jsx 預先編譯的結果（scripts/build-app.mjs），兩邊不能不同步。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build, header } from '../scripts/build-app.mjs';

const src = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
const out = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let hasBabel = true;
try { createRequire(import.meta.url).resolve('@babel/standalone'); } catch { hasBabel = false; }

test('app.js header matches the current src/app.jsx (run npm run build:app)', () => {
  assert.ok(out.startsWith(header(src)), 'app.js 過期：請執行 npm run build:app');
});

test('app.js is exactly a fresh build of src/app.jsx', { skip: hasBabel ? false : '需要 npm install（@babel/standalone）' }, async () => {
  assert.equal(await build(src), out, 'app.js 過期：請執行 npm run build:app');
});

test('index.html loads the precompiled app.js and no in-browser Babel', () => {
  assert.match(html, /<script src="\/app\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(html, /text\/babel|@babel\/standalone/);
});
