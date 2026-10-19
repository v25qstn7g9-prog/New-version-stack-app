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
try { const r = createRequire(import.meta.url); r.resolve('@babel/standalone'); r.resolve('terser'); } catch { hasBabel = false; }

test('app.js header matches the current src/app.jsx (run npm run build:app)', () => {
  assert.ok(out.startsWith(header(src)), 'app.js 過期：請執行 npm run build:app');
});

test('app.js is exactly a fresh build of src/app.jsx', { skip: hasBabel ? false : '需要 npm install（@babel/standalone、terser）' }, async () => {
  assert.equal(await build(src), out, 'app.js 過期：請執行 npm run build:app');
});

test('index.html loads the precompiled app.js and no in-browser Babel', () => {
  assert.match(html, /<script src="\/app\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(html, /text\/babel|@babel\/standalone/);
});

test('icons: every LR.Xxx used in src/app.jsx is in src/lucide-icons.js, and the lucide CDN bundle is gone', async () => {
  const { generate } = await import('../scripts/gen-icons.mjs').catch(() => ({}));
  const icons = fs.readFileSync(new URL('../src/lucide-icons.js', import.meta.url), 'utf8');
  const used = [...new Set([...src.matchAll(/\bLR\.([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
  for (const n of used) assert.match(icons, new RegExp('"' + n + '":\\{"iconName"'), n);
  let hasLucide = true; try { createRequire(import.meta.url).resolve('lucide-react/package.json'); } catch { hasLucide = false; }
  if (hasLucide && generate) assert.equal(generate(src), icons, 'src/lucide-icons.js 過期：請執行 node scripts/gen-icons.mjs');
  assert.doesNotMatch(html, /unpkg\.com\/lucide-react/);
  assert.match(out.slice(0, 20000), /window\.LucideReact=/, 'icons are bundled at the top of app.js');
});
