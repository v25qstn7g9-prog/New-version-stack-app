import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 迴歸測試：Workers with Static Assets 架構下，wrangler.jsonc 的 assets.run_worker_first
// 沒列到的路徑會「先被靜態資源接走」，加上 not_found_handling = single-page-application，
// 結果是 worker.js 明明有掛路由，正式站卻回首頁 HTML（200, text/html），前端也不會報錯。
// 09/28 的 /taifex-tx、10/02 的 /intraday-metrics 與 /market-breadth 都是這樣壞掉的。
// 這裡直接讀 worker.js / OAuth 模組的路由與 wrangler.jsonc，確保每個 API 路由都在 run_worker_first 裡。

// 去掉 JSONC 註解（會略過字串內容，避免把 "/.well-known/*" 之類的字串誤判成註解）。
function stripJsonComments(src) {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += n; i++; } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[\]}])/g, '$1');
}

function readWrangler() {
  return JSON.parse(stripJsonComments(fs.readFileSync('wrangler.jsonc', 'utf8')));
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function coveredBy(patterns, path) {
  return patterns.some((p) => globToRegExp(p).test(path));
}

// 這些是 worker.js 裡「刻意交給靜態資源」的路徑（只是補 header），不是 API。
const STATIC_PATHS = new Set(['/', '/index.html']);

function workerRoutes() {
  const worker = fs.readFileSync('worker.js', 'utf8');
  const routes = new Set();
  for (const m of worker.matchAll(/url\.pathname\s*===\s*["']([^"']+)["']/g)) routes.add(m[1]);
  for (const m of worker.matchAll(/url\.pathname\.startsWith\(\s*["']([^"']+)["']\s*\)/g)) routes.add(`${m[1]}__any-subpath`);
  const apiMethods = worker.match(/const API_METHODS = new Map\(\[([\s\S]*?)\]\);/);
  assert.ok(apiMethods, 'worker.js should still declare API_METHODS');
  for (const m of apiMethods[1].matchAll(/\[\s*["'](\/[^"']*)["']\s*,/g)) routes.add(m[1]);
  const writePaths = worker.match(/const WRITE_PATHS = new Set\(\[([^\]]*)\]\)/);
  if (writePaths) for (const m of writePaths[1].matchAll(/["']([^"']+)["']/g)) routes.add(m[1]);
  return [...routes].filter((r) => !STATIC_PATHS.has(r));
}

function oauthRoutes() {
  const src = fs.readFileSync('functions/asset-mcp-oauth.js', 'utf8');
  return [...new Set([...src.matchAll(/path\s*===\s*["']([^"']+)["']/g)].map((m) => m[1]))];
}

test('wrangler.jsonc parses and declares assets.run_worker_first', () => {
  const cfg = readWrangler();
  assert.ok(Array.isArray(cfg.assets?.run_worker_first), 'assets.run_worker_first must be an array');
  assert.equal(cfg.assets.not_found_handling, 'single-page-application');
});

test('the route extractor actually finds the known API routes (guards against a silently empty scan)', () => {
  const routes = workerRoutes();
  for (const r of ['/mcp', '/quote', '/taifex-tx', '/intraday-metrics', '/market-breadth', '/api/health', '/api/pending-trades/resolve']) {
    assert.ok(routes.includes(r), `expected scan of worker.js to find ${r}`);
  }
  const oauth = oauthRoutes();
  for (const r of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server', '/oauth/authorize', '/oauth/token', '/oauth/register']) {
    assert.ok(oauth.includes(r), `expected scan of asset-mcp-oauth.js to find ${r}`);
  }
});

test('every API route handled by worker.js is listed in run_worker_first', () => {
  const patterns = readWrangler().assets.run_worker_first;
  const missing = [];
  for (const route of workerRoutes()) {
    if (route.endsWith('__any-subpath')) {
      const prefix = route.replace('__any-subpath', '');
      if (!patterns.includes(`${prefix}*`)) missing.push(`${prefix}*`);
    } else if (!coveredBy(patterns, route)) {
      missing.push(route);
    }
  }
  assert.deepEqual(missing, [], `missing from wrangler.jsonc assets.run_worker_first (production would serve index.html instead): ${missing.join(', ')}`);
});

test('every OAuth / MCP discovery route is listed in run_worker_first', () => {
  const patterns = readWrangler().assets.run_worker_first;
  const missing = oauthRoutes().filter((r) => !coveredBy(patterns, r));
  assert.deepEqual(missing, [], `OAuth routes missing from run_worker_first: ${missing.join(', ')}`);
});

test('no environment overrides assets without the same run_worker_first list', () => {
  const cfg = readWrangler();
  for (const [name, env] of Object.entries(cfg.env || {})) {
    if (env.assets) {
      assert.deepEqual(env.assets.run_worker_first, cfg.assets.run_worker_first, `env.${name}.assets.run_worker_first must match the top-level list`);
    }
  }
});

test('the frontend-called endpoints from the 10/02 regression are in run_worker_first', () => {
  const patterns = readWrangler().assets.run_worker_first;
  assert.ok(coveredBy(patterns, '/intraday-metrics'));
  assert.ok(coveredBy(patterns, '/market-breadth'));
  assert.ok(coveredBy(patterns, '/taifex-tx'));
});
