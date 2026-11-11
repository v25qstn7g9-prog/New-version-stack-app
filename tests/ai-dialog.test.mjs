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

test('the floating AI launcher shows the text "AI" (no icon) and keeps its aria-label, size and colors', () => {
  const i = widget.indexOf('<button ref={launcherRef}');
  const launcher = widget.slice(i, widget.indexOf('</button>', i));
  assert.match(launcher, /aria-label=\{UI_SHOW_ENGLISH \? "Open investment assistant" : "開啟投資助手"\}/);
  assert.match(launcher, /<span aria-hidden="true"[^>]*>AI<\/span>/);
  assert.doesNotMatch(launcher, /<MessageCircle/);
  assert.match(launcher, /width: 46, height: 46/);
  // 文字跟著按鈕顏色（currentColor）：淺色 #ffffff on #3f6b91（5.6:1）、深藍 #1f2b4d on #ffffff（13.9:1）
  const css = fs.readFileSync(new URL('../clean.css', import.meta.url), 'utf8');
  assert.match(css, /html\.za-clean \.premium-ai-launcher\{background:var\(--c-btn\)!important;color:var\(--c-btn-ink\)!important/);
  assert.match(css, /html\.za-clean\[data-theme="navy"\] \.premium-ai-launcher\{background:#ffffff!important;color:#1f2b4d!important\}/);
});
