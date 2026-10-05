import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 手動輸入流程：每日紀錄在自己的分頁自動帶入、各頁不再有分散的「帶入」按鈕、
// 新增表單會說還差哪幾格、交易紀錄先放每天要用的「新增交易」。
const html = fs.readFileSync('index.html', 'utf8');
const slice = (name) => {
  const a = html.indexOf(`function ${name}(`);
  assert.ok(a > 0, `${name} exists`);
  return html.slice(a, html.indexOf('\nfunction ', a + 10));
};

test('daily record: today card auto-fills TW value from quotes, TW cost from holdings, US from the last record', () => {
  const daily = slice('DailyPanel');
  assert.match(daily, /<Panel title="今天的紀錄">/);
  assert.match(daily, /fetchQuotesWithFallback\(activeTw\.map\(\(h\) => h\.symbol\), force\)/);
  assert.match(daily, /Number\(quotes\[h\.symbol\]\.price\) \* Number\(h\.current\)/);
  assert.match(daily, /holdings\.filter\(\(h\) => isTaiwanSymbol\(h\.symbol\)\)\.reduce\(\(sum, h\) => sum \+ Number\(h\.estCostBasis \|\| 0\), 0\)/, 'TW cost excludes US holdings');
  assert.match(daily, /fills\.usValue = String\(autoUs\.value\); from\.usValue = "usQuote"/, 'today uses US quotes when configured');
  assert.match(daily, /from\.usValue = "last"/);
  // 只填空的欄位，使用者自己清空的不會被塞回去
  assert.match(daily, /const canFill = \(k\) => form\[k\] === "" && autoFrom\[k\] !== "typed";/);
  // 報價不完整就不自動帶入市值
  assert.match(daily, /if \(missing\.length\) \{ setAutoTw\(\{ status: "partial"/);
  assert.match(daily, /\|\| quotes\?\.\[h\.symbol\]\?\.isStale\)/, 'stale quotes never become today\'s value');
  assert.match(daily, /isToday && isTwseTradingHours\(\)/, 'intraday note');
  assert.match(daily, /label="補記其他日期"/);
});

test('daily record: a blank US field on a new day keeps the previous record value instead of 0', () => {
  const daily = slice('DailyPanel');
  assert.match(daily, /Number\(existing\?\.\[key\] \?\? \(key\.startsWith\("us"\) \? prior\?\.\[key\] : 0\) \?\? 0\)/);
});

test('scattered 帶入 buttons are gone; dashboard shows a one-line reminder after the close instead', () => {
  assert.doesNotMatch(html, /帶入「每日紀錄」台股市值/);
  assert.doesNotMatch(html, /帶入「每日紀錄」台股成本/);
  assert.doesNotMatch(html, /onFillDailyCost=\{/);
  assert.match(slice('Dashboard'), /onGoDaily && needsTodayRecord\(dailyRecords\)/);
});

test('needsTodayRecord only nags on trading days after 13:30 when today is missing', () => {
  const fnSrc = html.slice(html.indexOf('function needsTodayRecord('), html.indexOf('\n}\n', html.indexOf('function needsTodayRecord(')) + 2);
  const ctx = { todayStr: () => '2026-10-05', isMarketClosedToday: () => false, Date };
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);
  const at = (iso) => new Date(iso);
  assert.equal(ctx.needsTodayRecord([], at('2026-10-05T03:00:00Z')), false, '11:00 Taipei: market still open');
  assert.equal(ctx.needsTodayRecord([], at('2026-10-05T05:45:00Z')), true, '13:45 Taipei, nothing recorded');
  assert.equal(ctx.needsTodayRecord([{ date: '2026-10-05' }], at('2026-10-05T07:00:00Z')), false, 'already recorded');
  assert.equal(ctx.needsTodayRecord([], at('2026-10-04T07:00:00Z')), false, 'Sunday');
  ctx.isMarketClosedToday = () => true;
  assert.equal(ctx.needsTodayRecord([], at('2026-10-05T07:00:00Z')), false, 'holiday');
});

test('trades: new trade first, set-once cost tracking last, tax only for sells, amount preview', () => {
  const trades = slice('TradesPanel');
  assert.ok(trades.indexOf('<Panel title="新增交易">') < trades.indexOf('<Panel title="成本追蹤">'));
  assert.match(trades, /\{form\.action === "sell" && \(\s*<Field label="交易稅（賣出）">/);
  assert.match(trades, /這筆買進金額/);
});

test('add forms say what is missing and disable the button until complete', () => {
  assert.match(html, /function MissingHint\(\{ missing \}\)/);
  for (const label of ['新增交易', '新增配息紀錄', '新增標的', '新增項目']) {
    assert.match(html, new RegExp(`<AddButton onClick=\\{add\\} label="${label}" disabled=\\{`), label);
  }
});

test('auto daily record (app): server pickup and same-day fallback never overwrite an existing day', () => {
  const app = html.slice(html.indexOf('// ---- 每日資產自動記帳（App 端）----'), html.indexOf('// ---- Z∞ 背景同步'));
  assert.ok(app.length > 0);
  assert.match(app, /const have = new Set\(rs\.map\(\(r\) => r\.date\)\);/);
  assert.match(app, /clean\.filter\(\(r\) => !have\.has\(r\.date\)\)/, 'manual (or any existing) record for that day wins');
  assert.match(app, /source: "auto"/);
  assert.match(app, /fetchWithTimeout\("\/api\/auto-daily", \{ cache: "no-store", headers: \{ authorization: "Bearer " \+ zinfSyncToken \} \}/);
  // 本機備案：14:00 後、交易日、今天沒紀錄；報價要齊、非過期、而且是今天的
  assert.match(app, /needsTodayRecord\(dailyRecords, new Date\(\), 14 \* 60\)/);
  assert.match(app, /!q\.isStale && taipeiDay\(q\.asOfDate\) === today/);
});

test('daily tab labels auto records and saving turns them into manual ones', () => {
  const daily = slice('DailyPanel');
  assert.match(daily, /sameDayRecord\.source === "auto" \? "🤖 自動記錄" : "✅ 已記錄"/);
  // add() 重新建立整筆紀錄，不帶 source → 手動儲存後就是手動紀錄
  const add = daily.slice(daily.indexOf('const add = () => {'), daily.indexOf('const remove ='));
  assert.doesNotMatch(add, /source/);
});
