import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// 表單格子是「底部對齊」(align-items:end)：把提示文字放在某一欄裡面，會把同一排的另一欄頂下去。
// 提示要放在格子外面（獨立一行）。
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('dividend schedule hint is its own row, not inside the 代號 field', () => {
  const form = html.slice(html.indexOf('<Panel title="新增配息">'), html.indexOf('<DividendHistoryChart'));
  const sym = form.slice(form.indexOf('<Field label="代號">'), form.indexOf('</Field>', form.indexOf('<Field label="代號">')));
  assert.ok(!sym.includes('scheduleHint'), 'hint must not live inside the 代號 Field');
  assert.ok(form.includes('{scheduleHint && ('));
  assert.ok(form.includes('data-form-hint'));
});

test('holding name-lookup hint is its own row, not inside the 名稱 field', () => {
  const form = html.slice(html.indexOf('<Panel title="新增持股標的">'), html.indexOf('<MissingHint missing={[!form.symbol && "代號"]'));
  const name = form.slice(form.indexOf('<Field label="名稱">'), form.indexOf('</Field>', form.indexOf('<Field label="名稱">')));
  assert.ok(!name.includes('nameHint'), 'hint must not live inside the 名稱 Field');
  assert.ok(form.includes('{nameHint && ('));
  assert.ok(form.includes('data-form-hint'));
});
