import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// 休市日提醒曾在 10/05 美股改版時被拿掉；這個測試防止再次消失。
test('live quotes show a market-holiday notice (weekend / national holiday / make-up day) and pause wording', () => {
  assert.match(html, /live-status-line text-\[11px\] \$\{marketClosedNow \? "is-closed" : ""\}/);
  assert.match(html, /marketClosedNow && <span className="live-closed-note">/);
  assert.match(html, /\$\{marketClosure\?\.name \|\| "今日休市"\}・台股休市，已停止自動更新/);
  assert.match(html, /!marketClosedNow && <span>\{UI_SHOW_ENGLISH \? "TW: 15s when open" : "台股開盤每 15 秒"\}<\/span>/);
});
