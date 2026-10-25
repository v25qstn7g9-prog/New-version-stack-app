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
