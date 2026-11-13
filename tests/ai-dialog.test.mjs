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

test('the floating AI launcher is the white bell-tag cat (design C): 60px, same aria-label, sticker outline contrast, reduced motion, no external assets', () => {
  const i = widget.indexOf('<button ref={launcherRef}');
  const launcher = widget.slice(i, widget.indexOf('</button>', i));
  // 行為不變：aria-label、點擊打開對話框、右側含 safe-area
  assert.match(launcher, /aria-label=\{UI_SHOW_ENGLISH \? "Open investment assistant" : "開啟投資助手"\}/);
  assert.match(launcher, /onClick=\{\(\) => setOpen\(true\)\}/);
  assert.match(launcher, /className="premium-ai-launcher za-ai-cat /);
  assert.match(launcher, /right: "calc\(14px \+ env\(safe-area-inset-right, 0px\)\)"/);
  // 尺寸：按鈕 60×60（可點範圍 ≥ 60×60），SVG 也是 60×60
  assert.match(launcher, /width: 60, height: 60/);
  const svg = launcher.slice(launcher.indexOf('<svg'), launcher.indexOf('</svg>') + 6);
  assert.match(svg, /<svg className="za-ai-cat-svg" viewBox="-4 -4 108 108" width="60" height="60" aria-hidden="true" focusable="false">/);
  // 沒有外部資源、沒有可能撞名的 id、沒有舊式屬性寫法
  assert.doesNotMatch(launcher, /<image|<script|<foreignObject|href=|xlink|url\(|https?:|<img|\bid="/i);
  assert.doesNotMatch(svg, /stroke-width=|stroke-linecap=|stroke-linejoin=/, 'JSX camelCase attributes');
  // 小尺寸修正：「A」內洞放大（筆畫 5.8、橫槓壓低）、鈴鐺細刻線與小亮點、眼睛小亮點都已移除
  assert.match(svg, /<path d="M34\.9,91 L44\.2,72 L53\.5,91"\/>/);
  assert.match(svg, /strokeWidth="5\.8"/);
  assert.doesNotMatch(svg, /M25\.5,63\.5|r="1\.1"|r="1\.2"/);
  // 「A」內洞在 60px 時的大小（幾何計算）：橫槓上緣到兩腳內緣交會點的高度、底寬都要 ≥ 2.5px
  const px = 60 / 108, half = 9.3, h = 19, sw = 5.8, barY = 86.2, barSw = 3.6, apexY = 72;
  const slope = half / h, off = (sw / 2) / Math.cos(Math.atan(slope));
  const holeTop = apexY + off / slope, holeBottom = barY - barSw / 2;
  const holeH = (holeBottom - holeTop) * px, holeW = 2 * (slope * (holeBottom - apexY) - off) * px;
  assert.ok(holeH >= 2.5 && holeW >= 2.5, `A counter ${holeH.toFixed(2)}×${holeW.toFixed(2)}px`);

  // 顏色從 SVG 本身取：深棕描邊、米白貼紙邊、吊牌底色
  const brown = svg.match(/<g fill="(#[0-9a-f]{6})" stroke="\1" strokeWidth="6\.2">/i)[1];
  const rim = svg.match(/<g fill="(#[0-9a-f]{6})" stroke="\1" strokeWidth="14\.6"/i)[1];
  const tag = svg.match(/<path d="M38,65 h24[^"]*" fill="(#[0-9a-f]{6})"/i)[1];
  const aiInk = svg.match(/<g fill="none" stroke="(#[0-9a-f]{6})" strokeWidth="5\.8"/i)[1];
  // 外描邊在 60px 時至少約 1.5px：深棕剪影 6.2 → 外側 3.1 ＋ 填色描邊內側 1.3 = 4.4 單位
  assert.ok((6.2 / 2 + 2.6 / 2) * px >= 1.5);
  const lum = (hex) => {
    const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.replace('#', '').slice(k, k + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (x, y) => { const [m, n] = [lum(x), lum(y)].sort((p, q) => q - p); return (m + 0.05) / (n + 0.05); };
  assert.ok(contrast(aiInk, tag) >= 4.5, `AI ${aiInk} on tag ${tag} = ${contrast(aiInk, tag).toFixed(2)}:1`);
  // 有效外緣對比：淺色背景靠深棕描邊、深色背景靠米白貼紙邊（兩層取較高者）
  const css = fs.readFileSync(new URL('../clean.css', import.meta.url), 'utf8');
  const hero = fs.readFileSync(new URL('../forma-hero.css', import.meta.url), 'utf8');
  const stops = (name) => [...hero.match(new RegExp(`--forma-hero-outdoor-${name}:linear-gradient\\(([^;]+)\\);`))[1].matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0]);
  const base = css.match(/html\.za-clean\{[\s\S]*?\n\}/)[0];
  const navy = css.match(/html\.za-clean\[data-theme="navy"\]\{[\s\S]*?--c-card:(#[0-9a-f]{6})/i);
  const bgs = [base.match(/--c-bg:(#[0-9a-f]{6})/i)[1], base.match(/--c-card:(#[0-9a-f]{6})/i)[1], ...stops('light'),
    css.match(/html\.za-clean\[data-theme="navy"\]\{[\s\S]*?--c-bg:(#[0-9a-f]{6})/i)[1], navy[1], ...stops('dark')];
  assert.ok(bgs.includes('#f1f0ec') && bgs.includes('#ffffff') && bgs.includes('#171717') && bgs.includes('#232323'));
  for (const bg of bgs) {
    const eff = Math.max(contrast(brown, bg), contrast(rim, bg));
    assert.ok(eff >= 3, `cat outline on ${bg} = ${eff.toFixed(2)}:1`);
  }

  // CSS：舊貓頭（耳朵動畫）規則已移除；整隻貓輕晃只在 no-preference；reduce 明確關掉；焦點外框；貼紙陰影
  const cat = css.slice(css.indexOf('/* ════ AI 浮動按鈕：白貓鈴鐺吊牌'));
  assert.ok(cat.length > 0);
  assert.doesNotMatch(css, /za-ai-cat-ear|--ai-cat-face|za-ai-cat-head/);
  assert.match(cat, /html\.za-clean \.premium-ai-launcher\.za-ai-cat\{background:transparent!important;box-shadow:none!important;border:0!important/);
  assert.match(cat, /\.za-ai-cat \.za-ai-cat-svg\{[^}]*filter:drop-shadow\(/);
  assert.match(cat, /\.premium-ai-launcher\.za-ai-cat:focus-visible\{outline:2px solid var\(--c-accent\)!important/);
  const motion = cat.match(/@media \(prefers-reduced-motion:no-preference\)\{([\s\S]*?)\n\}/);
  assert.ok(motion, 'animation lives inside prefers-reduced-motion:no-preference');
  assert.match(motion[1], /\.za-ai-cat \.za-ai-cat-body\{animation:za-ai-cat-sway 6s/);
  assert.equal((cat.replace(motion[0], '').match(/animation:za-ai-cat/g) || []).length, 0);
  assert.match(cat, /@media \(prefers-reduced-motion:reduce\)\{\.za-ai-cat \.za-ai-cat-body\{animation:none!important\}\}/);
  assert.match(cat, /transform-origin:50% 100%/);
  assert.doesNotMatch(cat, /url\(|https?:/);
  // 新貓咪樣式排在舊的深藍白圓底規則後面（才蓋得掉）
  assert.ok(css.indexOf('html.za-clean .premium-ai-launcher.za-ai-cat{') > css.lastIndexOf('.premium-ai-launcher{background:#ffffff!important'));
  // 快取參數
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/clean\.css\?v=mobile-layout-1"/);
  assert.match(html, /<script src="\/app\.js\?v=9"><\/script>/);
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
