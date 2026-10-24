import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../worker.js';

// 首頁是靜態檔，不在 run_worker_first，正式環境不會進 worker.js。
// 防嵌入標頭必須寫在 _headers，手機開 App 才收得到。
test('static _headers deny framing without restricting scripts', () => {
  const text = fs.readFileSync(new URL('../_headers', import.meta.url), 'utf8');
  assert.match(text, /X-Frame-Options:\s*DENY/);
  assert.match(text, /X-Content-Type-Options:\s*nosniff/);
  assert.match(text, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
  assert.match(text, /Content-Security-Policy:\s*frame-ancestors 'none'/);
  assert.doesNotMatch(text, /script-src|default-src|connect-src/);
  assert.equal((text.match(/X-Frame-Options:/g) || []).length, 1, '同一標頭寫兩次會被逗號接在一起');
  assert.match(text, /^\/\n\tCache-Control: no-store/m);
  assert.match(text, /^\/index\.html\n\tCache-Control: no-store/m);
});

test('worker asset responses carry the same framing headers', async () => {
  const env = {
    ASSETS: {
      fetch: async () => new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' },
      }),
    },
  };
  const res = await worker.fetch(new Request('https://app.example/'), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.match(await res.text(), /id="root"/);
});

function bootHarness() {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/\/\* boot-error-start \*\/([\s\S]*?)\/\* boot-error-end \*\//);
  assert.ok(script, 'boot-error script markers');
  assert.doesNotMatch(script[1], /innerHTML/);
  const listeners = {};
  const elements = {
    root: { childNodes: [] },
    box: { style: { display: 'none' }, nodes: [], replaceChildren() { this.nodes = []; }, append(...nodes) { this.nodes.push(...nodes); } },
  };
  const document = {
    getElementById(id) { return id === 'root' ? elements.root : id === 'boot-error' ? elements.box : null; },
    createElement() { return { textContent: '' }; },
  };
  const window = { addEventListener(type, fn) { listeners[type] = fn; } };
  vm.runInNewContext(script[1], { window, document });
  return { listeners, elements, window };
}

test('boot errors are shown as text, and only before the app has drawn', () => {
  const { listeners, elements, window } = bootHarness();
  listeners.error({ target: window, message: '<img src=x onerror=alert(1)>' });
  assert.equal(elements.box.style.display, 'block');
  assert.equal(elements.box.nodes[0].textContent, 'App 載入錯誤');
  assert.equal(elements.box.nodes[1].textContent, '<img src=x onerror=alert(1)>');

  elements.box.style.display = 'none';
  elements.box.nodes = [];
  listeners.error({ target: { tagName: 'IMG' }, message: 'missing image' });
  assert.equal(elements.box.style.display, 'none', '圖片載入失敗不該蓋住整個 App');

  elements.root.childNodes.push({});
  listeners.unhandledrejection({ reason: new Error('<b>later</b>') });
  assert.equal(elements.box.style.display, 'none', '畫面已經出來之後，背景錯誤不再蓋滿全螢幕');
});
