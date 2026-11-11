// AI 助手對話框的鍵盤與讀螢幕規則（瀏覽器前後實測見 PR 說明；這裡防止日後被改掉）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
const widget = src.slice(src.indexOf('function AiChatWidget('), src.indexOf('function ThemeToggle('));
const block = (start) => { const i = widget.indexOf(start); assert.ok(i >= 0, start); return widget.slice(i, widget.indexOf('\n  };', i)); };

test('the AI panel is announced as a modal dialog with a title', () => {
  assert.match(widget, /role="dialog"/);
  assert.match(widget, /aria-modal="true"/);
  const id = widget.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(id && widget.includes(`id="${id}"`));
});

test('Enter while an input method is choosing characters does not send', () => {
  const onKeyDown = block('const onKeyDown = (e) => {');
  assert.match(onKeyDown, /isComposing/);
  assert.match(onKeyDown, /229/);
  assert.ok(onKeyDown.indexOf('isComposing') < onKeyDown.indexOf('send()'));
  assert.match(widget, /onKeyDown=\{onKeyDown\}/);
});

test('Esc and Tab are handled at the document level while open, focus is pulled back, and returns to the launcher', () => {
  assert.match(widget, /document\.addEventListener\("keydown"/);
  assert.match(widget, /document\.addEventListener\("focusin"/);
  assert.match(widget, /e\.key === "Escape"[\s\S]{0,120}isComposing[\s\S]{0,120}setOpen\(false\)/);
  assert.match(widget, /launcherRef\.current\?\.focus/);
  assert.match(widget, /ref=\{launcherRef\}/);
});

test('the floating AI launcher is a cute 60px cat head with "AI": same aria-label, theme colours, reduced motion, no external assets', () => {
  const i = widget.indexOf('<button ref={launcherRef}');
  const launcher = widget.slice(i, widget.indexOf('</button>', i));
  // 行為不變：aria-label、點擊打開對話框
  assert.match(launcher, /aria-label=\{UI_SHOW_ENGLISH \? "Open investment assistant" : "開啟投資助手"\}/);
  assert.match(launcher, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(launcher, /className="premium-ai-launcher za-ai-cat /);
  // 尺寸：60×60（可點範圍 ≥ 44px）
  const size = launcher.match(/width: (\d+), height: (\d+)/);
  assert.ok(size && Number(size[1]) >= 56 && Number(size[1]) <= 60 && size[1] === size[2], 'button is 56–60px square');
  // 圖形：inline SVG（aria-hidden）＋貓耳＋臉＋「AI」；沒有外部資源
  const svg = launcher.slice(launcher.indexOf('<svg'), launcher.indexOf('</svg>'));
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /za-ai-cat-ear-l/);
  assert.match(svg, /za-ai-cat-ear-r/);
  assert.match(svg, /<ellipse /);
  assert.match(svg, />AI<\/text>/);
  assert.doesNotMatch(launcher, /<img|href=|src=|url\(|https?:|<MessageCircle/);
  // 顏色只用主題變數（不新增色碼）
  assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b/i);
  assert.match(svg, /fill="var\(--ai-cat-face\)"/);
  assert.match(svg, /fill="var\(--ai-cat-ink\)"/);

  const css = fs.readFileSync(new URL('../clean.css', import.meta.url), 'utf8');
  const cat = css.slice(css.indexOf('/* ════ AI 浮動按鈕：可愛貓咪頭'));
  assert.match(cat, /html\.za-clean \.premium-ai-launcher\.za-ai-cat\{background:transparent!important;box-shadow:none!important;border:0!important;color:var\(--c-btn-ink\)!important;\s*--ai-cat-face:var\(--c-btn\);--ai-cat-ink:var\(--c-btn-ink\)/);
  assert.doesNotMatch(cat, /url\(|https?:/, 'no external resources in the cat CSS');
  // 動畫只在 no-preference 裡；reduce 時明確關掉
  const motion = cat.match(/@media \(prefers-reduced-motion:no-preference\)\{([\s\S]*?)\n\}/);
  assert.ok(motion, 'animations live inside prefers-reduced-motion:no-preference');
  assert.match(motion[1], /animation:za-ai-cat-ear-l 6s/);
  assert.match(motion[1], /animation:za-ai-cat-sway 6s/);
  assert.equal((cat.replace(motion[0], '').match(/animation:za-ai-cat/g) || []).length, 0, 'no animation outside the no-preference block');
  assert.match(cat, /@media \(prefers-reduced-motion:reduce\)\{\.za-ai-cat \.za-ai-cat-head,\.za-ai-cat \.za-ai-cat-ear\{animation:none!important\}\}/);

  // 各主題實際顏色（從 CSS 變數取出）計算對比：AI 字 ≥ 4.5:1、貓臉對頁面背景與卡片 ≥ 3:1
  const lum = (hex) => {
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.replace('#', '').slice(k, k + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (x, y) => { const [m, n] = [lum(x), lum(y)].sort((p, q) => q - p); return (m + 0.05) / (n + 0.05); };
  const varOf = (block, name) => (block.match(new RegExp(`${name}:(#[0-9a-f]{6})`, 'i')) || [])[1];
  const base = css.match(/html\.za-clean\{[\s\S]*?\n\}/)[0];
  const light = { btn: varOf(base, '--c-accent'), ink: varOf(base, '--c-btn-ink'), bg: varOf(base, '--c-bg'), card: varOf(base, '--c-card') };
  assert.match(base, /--c-btn:var\(--c-accent\)/);
  const navyBlock = css.match(/html\.za-clean\[data-theme="navy"\]\{[\s\S]*?--c-btn-ink:#[0-9a-f]{6};/i)[0];
  const sysBlock = css.match(/html\.za-clean:not\(\[data-theme\]\)\{[\s\S]*?--c-btn-ink:#[0-9a-f]{6};/i)[0];
  const dark = (b) => ({ btn: varOf(b, '--c-btn'), ink: varOf(b, '--c-btn-ink'), bg: varOf(b, '--c-bg'), card: varOf(b, '--c-card') });
  for (const [name, t] of [['light', light], ['navy', dark(navyBlock)], ['system dark', dark(sysBlock)]]) {
    for (const v of Object.values(t)) assert.match(String(v), /^#[0-9a-f]{6}$/i, `${name} colour resolved`);
    assert.ok(contrast(t.ink, t.btn) >= 4.5, `${name}: AI text ${t.ink} on ${t.btn} = ${contrast(t.ink, t.btn).toFixed(2)}:1`);
    assert.ok(contrast(t.btn, t.bg) >= 3, `${name}: cat face ${t.btn} on page ${t.bg} = ${contrast(t.btn, t.bg).toFixed(2)}:1`);
    assert.ok(contrast(t.btn, t.card) >= 3, `${name}: cat face ${t.btn} on card ${t.card} = ${contrast(t.btn, t.card).toFixed(2)}:1`);
  }
  // 深藍主題舊的「白底圓鈕」規則會被貓咪規則蓋掉（背景透明、無圓形陰影）
  assert.ok(css.indexOf('html.za-clean .premium-ai-launcher.za-ai-cat{') > css.lastIndexOf('.premium-ai-launcher{background:#ffffff!important'));
  // index.html 換了 clean.css 的快取版本，避免新按鈕配到舊樣式
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/clean\.css\?v=ai-cat-1"/);
});

// 「即時股價」重新整理鈕不能落在右下角 AI 按鈕那一欄（捲到同高時會被蓋住、點不到）。
// 瀏覽器層級的 elementFromPoint 命中檢查在 scripts/check-ai-launcher-hit.mjs（本機有 Chrome 時執行；CI 沒有瀏覽器）。
test('the live-quote refresh button sits at the left end of its row, away from the AI button lane; the AI button respects safe-area-inset-right', () => {
  const panelStart = src.indexOf('<Panel title="即時股價">');
  assert.ok(panelStart > 0);
  const row = src.slice(src.indexOf('live-status-row', panelStart) - 200, src.indexOf('live-status-line', panelStart) + 20);
  assert.match(row, /className="flex items-center justify-start gap-2 mb-2 live-status-row"/);
  const rowBody = src.slice(src.indexOf('live-status-row', panelStart), src.indexOf('{hasLive && (', panelStart));
  assert.ok(rowBody.indexOf('live-refresh-icon') >= 0 && rowBody.indexOf('live-refresh-icon') < rowBody.indexOf('live-status-line'),
    'refresh button comes first (left), the status text after it');
  assert.doesNotMatch(rowBody, /justify-between|marginLeft: "auto"|ml-auto/);
  // AI 按鈕：右側留出橫向瀏海的安全區
  const i = widget.indexOf('<button ref={launcherRef}');
  const launcher = widget.slice(i, widget.indexOf('</button>', i));
  assert.match(launcher, /right: "calc\(14px \+ env\(safe-area-inset-right, 0px\)\)"/);
  // AI 按鈕欄寬（從右邊算）＝14 + 60 + 8 間距 = 82px；重新整理鈕 40px 放在卡片內容最左邊，
  // 最窄 320px 時右緣 ≈ 69px（本機實測），離 AI 欄左緣 238px 還很遠。
  assert.match(launcher, /width: 60, height: 60/);
  const script = fs.readFileSync(new URL('../scripts/check-ai-launcher-hit.mjs', import.meta.url), 'utf8');
  assert.match(script, /document\.elementFromPoint\(cx, cy\)/);
  assert.match(script, /\[320, 375, 390, 430\]/);
});
