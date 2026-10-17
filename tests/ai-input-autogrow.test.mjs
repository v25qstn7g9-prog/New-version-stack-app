import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAppSource } from './_app-source.mjs';

// AI 助手輸入框：字多時要自動長高（最多約 5 行），不能固定一行把字切掉。
const html = readAppSource();

test('the chat textarea auto-grows with its content and is capped', () => {
  assert.ok(html.includes('<textarea ref={inputRef} value={input}'));
  assert.ok(html.includes('el.style.height = "auto";'));
  assert.ok(html.includes('const max = Math.round(line * 5 + chrome);'));
  assert.ok(html.includes('}, [input, open]);'));
  assert.ok(html.includes('el.style.overflowY = el.scrollHeight + chrome > max ? "auto" : "hidden";'));
});

test('the textarea no longer pins overflow:hidden in its inline style (it would fight the effect)', () => {
  const ta = html.slice(html.indexOf('<textarea ref={inputRef}'), html.indexOf('<Send size={18} />'));
  assert.ok(!/overflow:\s*"hidden"/.test(ta));
  assert.ok(/minHeight:\s*"44px"/.test(ta));
});
