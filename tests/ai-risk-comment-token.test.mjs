// 資產總覽「AI 一句話評論」：以前用 zinfSyncToken 送 /ask；2026-11-11 起改用使用者自己的 Puter 帳號，
// 不再需要同步 token，也不再呼叫 /ask。這裡確保 token 不再往下傳給這張卡，且整個檔案沒有未宣告就使用的 zinfSyncToken。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const IS_CI = ['true', '1'].includes(String(process.env.CI || '').toLowerCase());
const src = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');

function paramsOf(name) {
  const m = src.match(new RegExp(`function ${name}\\(\\{([\\s\\S]*?)\\}\\)\\s*\\{`));
  assert.ok(m, `找不到 function ${name}`);
  return m[1];
}

function jsxOpening(tag) {
  const start = src.indexOf(`<${tag}\n`);
  assert.ok(start >= 0, `找不到 <${tag}`);
  // 開頭標籤結束於第一個獨立的 "/>"（屬性內的 => 不會以 "/>" 結尾）
  const end = src.indexOf('/>', start);
  return src.slice(start, end);
}

test('the AI risk comment no longer needs the sync token: PortfolioPerformanceCard / Dashboard do not take it', () => {
  assert.doesNotMatch(paramsOf('PortfolioPerformanceCard'), /\bzinfSyncToken\b/);
  assert.doesNotMatch(paramsOf('Dashboard'), /\bzinfSyncToken\b/);
  assert.doesNotMatch(jsxOpening('PortfolioPerformanceCard'), /zinfSyncToken/);
  assert.doesNotMatch(jsxOpening('Dashboard'), /zinfSyncToken/);
});

test('AI risk comment failure logs only the error kind (no token) and shows the Puter message', () => {
  const i = src.indexOf('const askAiRiskComment');
  assert.ok(i >= 0);
  const body = src.slice(i, src.indexOf('const mini =', i));
  assert.match(body, /console\.warn\("\[AI risk comment\] failed:", info\?\.kind \|\| "unknown"\)/);
  assert.doesNotMatch(body, /zinfSyncToken|authorization|fetch/i);
  assert.match(body, /setAiRiskError\(info\?\.message \|\| uiText\("AI 暫時無法評論"\)\)/);
});

let Babel = null;
try { Babel = createRequire(import.meta.url)('@babel/standalone'); } catch {}

test('no unbound zinfSyncToken reference anywhere in src/app.jsx (scope analysis)',
  { skip: Babel || IS_CI ? false : '需要 npm install（@babel/standalone）' }, () => {
    assert.ok(Babel, '需要 @babel/standalone（CI 必須先安裝）');
    const unbound = [];
    Babel.transform(src, {
      filename: 'app.jsx', presets: ['react'], code: false, compact: true,
      plugins: [() => ({ visitor: { Identifier(p) {
        if (p.node.name === 'zinfSyncToken' && p.isReferencedIdentifier() && !p.scope.hasBinding('zinfSyncToken')) {
          unbound.push(p.node.loc.start.line);
        }
      } } })],
    });
    assert.deepEqual(unbound, [], `未宣告就使用 zinfSyncToken 的行：${unbound.join(', ')}`);
  });
