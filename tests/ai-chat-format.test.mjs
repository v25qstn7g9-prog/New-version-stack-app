import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

const html = readAppSource();

// 取出 parseAiBlocks（純顯示用的整理函式）單獨執行
function loadParser() {
  const start = html.indexOf('function parseAiBlocks(');
  const end = html.indexOf('function AiMessageBody(');
  assert.ok(start > 0 && end > start, 'parseAiBlocks must exist before AiMessageBody');
  const ctx = {};
  vm.runInNewContext(html.slice(start, end) + '\nthis.parse = parseAiBlocks;', ctx);
  return ctx.parse;
}

const SAMPLE = [
  '以下是為您整理的 2026 年 9 月份存股資產月報：',
  '',
  '資產與損益表現',
  '',
  '・ 月底總資產：NT$ 5,910,210（較 8 月底 NT$ 5,619,826 增加 NT$ 290,384，增幅約 +5.17%）',
  '・ 累計總成本：NT$ 3,931,646',
  '',
  '賣出部分：',
  '・ 00685L：9 月 1 日賣出 2,000 股 @NT$ 12.10，收回資金約 NT$ 24,142',
  '',
  '月度總結',
  '',
  '9 月份整體資產呈現階梯式穩健上揚。',
].join('\n');

test('report text is split into headings, rows and paragraphs', () => {
  const blocks = loadParser()(SAMPLE);
  const types = blocks.map((b) => b.type);
  assert.deepEqual([...types], ['para', 'heading', 'row', 'row', 'heading', 'row', 'heading', 'para']);
  assert.equal(blocks[1].text, '資產與損益表現');
  assert.equal(blocks[4].text, '賣出部分');
});

test('row keeps the exact label, value and note text (display only, nothing is recalculated)', () => {
  const rows = loadParser()(SAMPLE).filter((b) => b.type === 'row');
  assert.equal(rows[0].label, '月底總資產');
  assert.equal(rows[0].value, 'NT$ 5,910,210');
  assert.equal(rows[0].note, '（較 8 月底 NT$ 5,619,826 增加 NT$ 290,384，增幅約 +5.17%）');
  assert.equal(rows[1].value, 'NT$ 3,931,646');
  assert.equal(rows[1].note, '');
});

test('plain answers and last short line are not turned into headings', () => {
  const parse = loadParser();
  assert.deepEqual([...parse('好的').map((b) => b.type)], ['para']);
  assert.equal(parse('').length, 0);
  const html2 = parse('<img src=x onerror=alert(1)>');
  assert.equal(html2[0].type, 'para');
  assert.equal(html2[0].text, '<img src=x onerror=alert(1)>');
});

test('chat panel renders text through React nodes only and keeps accessibility sizes', () => {
  const body = html.slice(html.indexOf('function AiMessageBody('), html.indexOf('function aiQuickPrompts('));
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(body), 'AI text must never be inserted as HTML');
  assert.match(html, /\.ai-panel-h \.forma-chat-chip\{[^}]*min-height:44px/);
  assert.match(html, /\.ai-panel-h textarea\{font-size:16px!important/);
});

test('quick prompts only fill the input box and never call send()', () => {
  const i = html.indexOf('className="forma-chat-chip"');
  assert.ok(i > 0);
  const tag = html.slice(i, html.indexOf('</button>', i));
  assert.match(tag, /onClick=\{\(\) => setInput\(q\.prompt\)\}/);
  assert.ok(!/send\(/.test(tag));
});
