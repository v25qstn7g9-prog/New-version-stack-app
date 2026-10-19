// Tailwind 先編好成 tw.css（npm run build:css），不再載入 cdn.tailwindcss.com 的瀏覽器編譯器。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const css = fs.readFileSync(new URL('tw.css', root), 'utf8');
let cli = null;
try { cli = createRequire(import.meta.url).resolve('tailwindcss/lib/cli.js'); } catch {}

test('index.html links the prebuilt tw.css after clean.css and no longer loads the Tailwind CDN', () => {
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com/);
  const clean = html.indexOf('/clean.css'), tw = html.indexOf('<link rel="stylesheet" href="/tw.css?v=');
  assert.ok(clean > 0 && tw > clean, 'tw.css comes after clean.css, same cascade order as the old injected <style>');
  assert.ok(tw < html.indexOf('</head>'));
});

test('tw.css has the classes the app relies on', () => {
  for (const sel of ['.grid-cols-3', '.text-\\[11px\\]', '.animate-spin', '.space-y-2>', '.whitespace-nowrap', '.fixed', '.hidden']) assert.ok(css.includes(sel), sel);
});

test('tw.css is a fresh build of the current sources (run npm run build:css)', { skip: cli ? false : '需要 npm install（tailwindcss）' }, () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-')), 'tw.css');
  execFileSync(process.execPath, [cli, '-c', 'scripts/tailwind.config.cjs', '-i', 'scripts/tw-input.css', '-o', out, '--minify'], { cwd: new URL('.', root), stdio: 'ignore' });
  assert.equal(fs.readFileSync(out, 'utf8'), css, 'tw.css 過期：請執行 npm run build:css');
});
