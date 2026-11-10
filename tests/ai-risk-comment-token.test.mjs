// 資產總覽「AI 一句話評論」：PortfolioPerformanceCard 用 zinfSyncToken 送 /ask，
// 以前 props 沒傳進來 → 執行時 ReferenceError 被 catch 吃掉，永遠顯示「AI 暫時無法評論」。
// 這裡確保 App → Dashboard → PortfolioPerformanceCard 一路都有傳，且整個檔案沒有未宣告就使用的 zinfSyncToken。
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

test('PortfolioPerformanceCard destructures zinfSyncToken', () => {
  assert.match(paramsOf('PortfolioPerformanceCard'), /\bzinfSyncToken\b/);
});

test('Dashboard destructures zinfSyncToken and passes it to PortfolioPerformanceCard', () => {
  assert.match(paramsOf('Dashboard'), /\bzinfSyncToken\b/);
  assert.match(jsxOpening('PortfolioPerformanceCard'), /zinfSyncToken=\{zinfSyncToken\}/);
});

test('App passes zinfSyncToken to Dashboard', () => {
  assert.match(jsxOpening('Dashboard'), /zinfSyncToken=\{zinfSyncToken\}/);
});

test('AI risk comment failure logs the error message (not the token) and still shows the fallback text', () => {
  const i = src.indexOf('const askAiRiskComment');
  assert.ok(i >= 0);
  const body = src.slice(i, src.indexOf('const mini =', i));
  const c = body.slice(body.indexOf('} catch (e) {'));
  assert.match(c, /console\.warn\([^)]*e\?\.message/);
  assert.doesNotMatch(c.slice(0, c.indexOf('setAiRiskError')), /zinfSyncToken|headers|authorization/i);
  assert.match(c, /setAiRiskError\(uiText\("AI 暫時無法評論"\)\)/);
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
