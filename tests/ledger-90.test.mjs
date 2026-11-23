// Issue #90：持股紀錄的假資料測試。只讀 tests/fixtures/ledger-90.json（虛構資料），不連網、不讀任何正式帳本。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import '../ledger-core.js';
import { readAppSource } from './_app-source.mjs';

const L = globalThis.ZinfLedger;
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/ledger-90.json', import.meta.url), 'utf8'));
const now = new Date(fx.now);
const src = readAppSource();
const sharesOf = (h, trades) => Number(h.initialShares) + trades.filter((t) => t.symbol === h.symbol).reduce((s, t) => s + (t.action === 'buy' ? 1 : -1) * t.shares, 0);
const positions = (holdings = fx.holdings, trades = fx.trades) => holdings.map((h) => ({ symbol: h.symbol, name: h.name, shares: sharesOf(h, trades) }));
const lastRecord = fx.dailyRecords[fx.dailyRecords.length - 1];
const twOnly = (over = {}) => L.valuation({ positions: positions(), quotes: fx.quotes, now, record: lastRecord, ...over });
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- 首頁：總市值、來源、資料時間 ----------
test('完整報價：總市值＝每檔 價格×股數，狀態 complete，資料時間用原始報價時間（台灣時間）', () => {
  const v = twOnly();
  assert.equal(v.status, 'complete');
  assert.equal(v.totalNtd, Math.round(1200 * 62.5 + 100 * 1050 + 4000 * 22.8));
  assert.equal(v.asOf.newest, '2026-11-20T05:30:00.000Z');
  assert.deepEqual(v.asOf.twDates, ['2026-11-20']);
  assert.equal(L.asOfLine(v), '11/20 13:30 報價');
  for (const r of v.rows) { assert.equal(r.provider, 'TWSE'); assert.equal(r.twDate, '2026-11-20'); assert.equal(r.stale, false); }
});

test('部分報價：不把缺一檔的即時價拿來加總，整個台股改用每日紀錄並標明；沒有紀錄就是未知（不是 0）', () => {
  const quotes = clone(fx.quotes); delete quotes['2330'];
  const v = twOnly({ quotes });
  assert.equal(v.status, 'fallback');
  assert.equal(v.totalNtd, lastRecord.twValue, '用 11/19 每日紀錄，不是 0050+00878 的部分合計');
  assert.deepEqual(v.missing, ['2330']);
  assert.equal(v.flags.fallbackRecord, true);
  assert.equal(v.asOf.recordDate, '2026-11-19');
  assert.match(L.asOfLine(v), /11\/19 每日紀錄/);
  assert.equal(v.rows.every((r) => r.valueNtd == null), true, '沒有任何一檔以即時價計入');
  const none = twOnly({ quotes, record: null });
  assert.equal(none.status, 'unknown');
  assert.equal(none.totalNtd, null);
  assert.match(L.asOfLine(none), /2330 沒有報價/);
  // 價格是 0／空字串也算缺報價
  const zero = twOnly({ quotes: { ...fx.quotes, '2330': { ...fx.quotes['2330'], price: 0 } }, record: null });
  assert.equal(zero.totalNtd, null);
});

test('部分報價時當日漲跌不顯示；完整時才有數字', () => {
  const quotes = clone(fx.quotes); delete quotes['2330'];
  const c = L.comparableChange({ valuation: twOnly({ quotes }), prevRecord: lastRecord, trades: fx.trades, today: '2026-11-20' });
  assert.deepEqual(c, { comparable: false, reason: 'partial' });
  const ok = L.comparableChange({ valuation: twOnly(), quoteDay: { change: 2000.4, pct: 0.79 }, prevRecord: lastRecord, trades: fx.trades, today: '2026-11-20' });
  assert.deepEqual(ok, { comparable: true, basis: 'prevClose', change: 2000, pct: 0.79, vsDate: null });
});

test('沒有昨收可比時：只在「上一筆紀錄之後沒有買賣」才拿每日紀錄比；有買賣＝摻了現金流，不顯示', () => {
  const v = twOnly();
  const clean = L.comparableChange({ valuation: v, prevRecord: lastRecord, trades: fx.trades, today: '2026-11-20' });
  assert.equal(clean.comparable, true);
  assert.equal(clean.basis, 'record');
  assert.equal(clean.vsDate, '2026-11-19');
  assert.equal(clean.change, v.totalNtd - lastRecord.twValue);
  const withBuy = [...fx.trades, { id: 'x', date: '2026-11-20', symbol: '0050', action: 'buy', shares: 100, price: 62, amount: 6200 }];
  const mixed = L.comparableChange({ valuation: v, prevRecord: lastRecord, trades: withBuy, today: '2026-11-20' });
  assert.equal(mixed.comparable, false);
  assert.equal(mixed.reason, 'cash_flow');
  assert.equal(L.comparableChange({ valuation: v, prevRecord: null, trades: [] }).reason, 'no_baseline');
});

// ---------- 休市日、台美跨日 ----------
test('休市日：週六看到週五收盤價不算過期；國定假日也一樣；真的隔了一個交易日才算過期', () => {
  const sat = new Date('2026-11-21T02:00:00Z'); // 週六 10:00 台北
  assert.equal(L.expectedSessionDay('TW', sat, {}), '2026-11-20');
  assert.equal(twOnly({ now: sat }).status, 'complete');
  const mon = new Date('2026-11-23T02:00:00Z'); // 週一 10:00，已開盤
  assert.equal(L.expectedSessionDay('TW', mon, {}), '2026-11-23');
  assert.equal(twOnly({ now: mon }).status, 'stale', '週一開盤後還拿週五的價＝不是最新');
  assert.equal(L.expectedSessionDay('TW', mon, { '2026-11-23': { name: '示範假日' } }), '2026-11-20');
  assert.equal(twOnly({ now: mon, holidays: { TW: { '2026-11-23': { name: '示範假日' } } } }).status, 'complete', '假日沿用上一個交易日');
  const preOpen = new Date('2026-11-23T00:30:00Z'); // 週一 08:30，還沒開盤
  assert.equal(L.expectedSessionDay('TW', preOpen, {}), '2026-11-20');
});

test('台美跨日：美股週四收盤價在台灣是週五清晨，日期各自標示，不算日期混用也不算過期', () => {
  const v = L.valuation({ positions: [...positions(), { symbol: 'VOO', shares: 2 }], quotes: fx.quotes, usQuotes: fx.usQuotes, fx: fx.fx, now, record: lastRecord });
  const voo = v.rows.find((r) => r.symbol === 'VOO');
  assert.equal(voo.market, 'US');
  assert.equal(voo.marketDate, '2026-11-19', '紐約當地的交易日');
  assert.equal(voo.twDate, '2026-11-20', '換成台灣日期');
  assert.equal(voo.stale, false, '台北週五 13:35 時紐約還沒開盤，週四收盤就是最新');
  assert.equal(v.flags.mixedDates, false);
  assert.equal(v.status, 'complete');
  assert.deepEqual(v.asOf.marketDates, { TW: ['2026-11-20'], US: ['2026-11-19'] });
  // 同一個市場裡混了不同交易日 → 標示日期混用、漲跌不比較
  const mixedQuotes = { ...fx.quotes, '2330': { ...fx.quotes['2330'], asOfDate: '2026-11-19T05:30:00Z' } };
  const m = twOnly({ quotes: mixedQuotes });
  assert.equal(m.flags.mixedDates, true);
  assert.equal(m.status, 'stale');
  assert.equal(L.comparableChange({ valuation: m, quoteDay: { change: 1, pct: 1 } }).reason, 'mixed_dates');
  // 美股日光節約：7 月的紐約 16:00 是 UTC 20:00
  assert.equal(L.zoneClock('2026-07-10T20:00:00Z', 'America/New_York').minute, 16 * 60);
  assert.equal(L.zoneClock('2026-11-19T21:00:00Z', 'America/New_York').minute, 16 * 60);
});

// ---------- 匯率 ----------
test('匯率只換算一次：美股市值＝美元價×股數×匯率；每日紀錄的美股金額已是新台幣，不再乘匯率', () => {
  const v = L.valuation({ positions: [{ symbol: 'VOO', shares: 2 }], usQuotes: fx.usQuotes, fx: fx.fx, now });
  assert.equal(v.totalNtd, 600 * 2 * 32);
  assert.equal(v.rows[0].fxRate, 32);
  assert.equal(v.fx.source, 'Yahoo');
  assert.equal(v.fx.twDate, '2026-11-20');
  // 缺匯率：改用每日紀錄的 usValue（已是新台幣），原樣使用
  const rec = { date: '2026-11-19', twValue: 0, usValue: 38000 };
  const noFx = L.valuation({ positions: [{ symbol: 'VOO', shares: 2 }], usQuotes: fx.usQuotes, fx: { rate: null }, now, record: rec });
  assert.equal(noFx.totalNtd, 38000);
  assert.equal(noFx.us.reason, 'missing_fx');
  assert.equal(L.valuation({ positions: [{ symbol: 'VOO', shares: 2 }], usQuotes: fx.usQuotes, fx: null, now }).totalNtd, null, '沒匯率也沒紀錄＝未知');
});

test('歷史匯率：舊美元交易用「當時存的匯率」換一次；已是新台幣的金額不再換；沒有當時匯率＝未知，不套今天的', () => {
  const twd = fx.trades[0], usd = fx.trades[2];
  assert.equal(L.tradeNtd(twd), 12017);
  assert.equal(L.tradeNtd({ ...twd, currency: 'USD', fxRate: 32 }), 12017, 'amount 已是新台幣：即使標 USD 也不再乘');
  assert.equal(L.tradeNtd(usd), 251 * 30.1, '用 2025 年存的 30.1，不是今天的 32');
  assert.equal(L.tradeNtd({ ...usd, fxRate: 0 }), null);
  assert.equal(L.tradeNtd({ ...usd, fxRate: 0 }, { historicalFx: { '2025-06-10': 29.9 } }), 251 * 29.9);
  const flow = L.cashFlow([twd, { ...usd, fxRate: 0 }]);
  assert.equal(flow.paidNtd, 12017);
  assert.equal(flow.unknownCount, 1, '未知的那筆不當成 0 默默略過，會回報筆數');
});

// ---------- 記交易 ----------
test('記交易預設：台北今天＋買進；台北已跨日而 UTC 還沒，也是台北的日期', () => {
  assert.deepEqual(L.defaultTradeDraft(now), { date: '2026-11-20', action: 'buy', symbol: '', shares: '', price: '', fee: '', tax: '', note: '' });
  assert.equal(L.defaultTradeDraft(new Date('2026-11-20T16:30:00Z')).date, '2026-11-21');
});

test('股數可小數；千分位、全形數字可接受；空白、負數、文字都不是 0', () => {
  assert.equal(L.parseDecimal('0.5'), 0.5);
  assert.equal(L.parseDecimal('.25'), 0.25);
  assert.equal(L.parseDecimal('1,000.75'), 1000.75);
  assert.equal(L.parseDecimal('１２．５'), 12.5);
  for (const bad of ['', ' ', '-1', 'abc', '1e3', '1.2.3', null, undefined]) assert.equal(L.parseDecimal(bad), null, String(bad));
  const v = L.validateTrade({ date: '2026-11-20', action: 'buy', symbol: 'voo', shares: '0.125', price: '19200', fee: '', tax: '', note: '' });
  assert.equal(v.ok, true);
  assert.equal(v.fields.shares, 0.125);
  assert.equal(v.fields.amount, 2400);
});

test('可改日期、手續費、交易稅：買進金額＝股數×價＋手續費；賣出＝股數×價−手續費−交易稅', () => {
  const buy = L.buildTrade({ date: '2026-11-18', action: 'buy', symbol: '0050', shares: '100', price: '62', fee: '20', tax: '99', note: '補登' }, 'new-1');
  assert.deepEqual(buy, { id: 'new-1', date: '2026-11-18', symbol: '0050', action: 'buy', shares: 100, price: 62, fee: 20, tax: 0, amount: 6220, nativeAmount: 6220, currency: 'TWD', fxRate: 1, note: '補登' });
  const sell = L.buildTrade({ date: '2026-11-20', action: 'sell', symbol: '0050', shares: '100', price: '62', fee: '20', tax: '6', note: '' }, 'new-2');
  assert.equal(sell.amount, 6200 - 20 - 6);
  assert.equal(sell.tax, 6);
  assert.equal(L.buildTrade({ date: '2026-02-30', action: 'buy', symbol: '0050', shares: '1', price: '1' }, 'x'), null, '不存在的日期');
  assert.deepEqual(L.validateTrade({ date: '2026-11-20', action: 'buy', symbol: '', shares: '', price: '' }).missing, ['代號', '股數', '成交價']);
  assert.equal(L.validateTrade({ date: '2026-11-20', action: 'sell', symbol: '0050', shares: '1', price: '10', fee: '20' }).ok, false, '費用超過成交金額');
});

test('草稿保留：重新打開面板只更新沒碰過的欄位（日期跨日會更新，自己改過的日期不動）', () => {
  const draft = { ...L.defaultTradeDraft(now), symbol: '0050', shares: '100' };
  const next = L.refreshDraft(draft, { symbol: true, shares: true }, { date: '2026-11-21', action: 'buy' });
  assert.equal(next.date, '2026-11-21');
  assert.equal(next.symbol, '0050');
  assert.equal(next.shares, '100');
  const kept = L.refreshDraft({ ...draft, date: '2026-11-18', action: 'sell' }, { date: true, action: true }, { date: '2026-11-21', action: 'buy' });
  assert.equal(kept.date, '2026-11-18');
  assert.equal(kept.action, 'sell');
});

test('同日交易：連點只成立一筆；同一天已有一模一樣的交易時，仍用 id 找到剛新增的那一筆', () => {
  const twin = { date: '2026-11-20', action: 'buy', symbol: '0050', shares: '100', price: '62', fee: '', tax: '', note: '' };
  let trades = [...fx.trades, L.buildTrade(twin, 'same-day-earlier')];
  const gate = L.createSubmitGate();
  let seq = 0;
  const submit = (key) => gate.submit(key, () => L.buildTrade(twin, `new-${++seq}`));
  const first = submit('draft-A');
  const second = submit('draft-A');
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.result.id, first.result.id, '重送拿回第一次那一筆');
  assert.equal(seq, 1, '沒有產生第二筆');
  trades = [...trades, first.result];
  const found = L.locateTrade(trades, first.result.id);
  assert.equal(found.row.id, 'new-1');
  assert.equal(found.sameDay, 2);
  assert.equal(found.index, 1, '同一天裡排在先前那筆之後，不會指到 same-day-earlier');
  assert.equal(L.sortTradesForDisplay(trades)[0].id, 'same-day-earlier');
  // 使用者真的要記第二筆一樣的交易（新的草稿）是可以的
  assert.equal(submit('draft-B').accepted, true);
  assert.equal(L.locateTrade(trades, 'nope'), null);
  // 驗證沒過不佔用這份草稿
  const g2 = L.createSubmitGate();
  assert.equal(g2.submit('k', () => L.buildTrade({ ...twin, shares: '' }, 'z')).accepted, false);
  assert.equal(g2.submit('k', () => L.buildTrade(twin, 'z')).accepted, true);
});

test('既有帳本：新增一筆不動到舊紀錄與舊 id；新紀錄的欄位和原本「交易紀錄」表單存的一樣', () => {
  const before = clone(fx.trades);
  const row = L.buildTrade({ date: '2026-11-20', action: 'buy', symbol: '00878', shares: '500', price: '22.8', fee: '16', tax: '', note: '' }, 'new-x');
  const after = [...fx.trades, row];
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.map((t) => t.id), ['t-old-1', 't-old-2', 't-old-usd', 'new-x']);
  assert.deepEqual(Object.keys(row).sort(), ['action', 'amount', 'currency', 'date', 'fee', 'fxRate', 'id', 'nativeAmount', 'note', 'price', 'shares', 'symbol', 'tax']);
  // App 的 holdingShareCount（從原始碼取出）對新舊紀錄算出的股數正確
  const a = src.indexOf('const isTaiwanSymbol'), b = src.indexOf('function mergeLegacyUsHoldings');
  const ctx = vm.createContext({});
  vm.runInContext(src.slice(a, b) + '\nthis.holdingShareCount=holdingShareCount;', ctx);
  assert.equal(ctx.holdingShareCount(fx.holdings[2], after), 3000 + 1000 + 500);
  assert.equal(ctx.holdingShareCount(fx.holdings[0], after), 1200);
  // 帳本格式版本沒有動
  assert.match(src, /const BACKUP_SCHEMA_VERSION = 2;/);
});

// ---------- 配息 ----------
test('配息草稿競速：晚到的公告不蓋掉使用者改過的欄位；代號換了或不是最新一次查詢，整包丟掉', () => {
  const draft = { date: '2026-11-20', symbol: '00878', shares: '4000', perShare: '0.55' };
  const patch = { date: '2026-11-18', perShare: '0.4' };
  const out = L.applyPrefill(draft, { perShare: true }, patch, { symbol: '00878', seq: 2, latestSeq: 2 });
  assert.equal(out.perShare, '0.55', '自己打的每股配息保留');
  assert.equal(out.date, '2026-11-18', '沒碰過的除息日照公告帶入');
  assert.equal(L.applyPrefill(draft, {}, patch, { symbol: '0056', seq: 2, latestSeq: 2 }), draft, '公告是別檔的');
  assert.equal(L.applyPrefill(draft, {}, patch, { symbol: '00878', seq: 1, latestSeq: 2 }), draft, '舊的查詢晚到');
  assert.equal(L.applyPrefill(draft, {}, { date: null, perShare: null }, { symbol: '00878' }), draft, '公告沒有金額時不清空');
  assert.match(src, /ZinfLedger\.applyPrefill\(f, dividendTouchedRef\.current/);
});

test('配息：公告／預估金額與實際入帳分開，沒記入帳就是未知，不拿公告去估', () => {
  const f = L.dividendFacts('00878', { found: true, date: '2026-11-18', cashDividend: null, estimatedDividend: 0.4 }, fx.dividends);
  assert.deepEqual(f.announced, { date: '2026-11-18', perShare: 0.4, estimated: true, official: false });
  assert.equal(f.actual.ntd, 1200);
  const none = L.dividendFacts('0050', { found: true, date: '2026-12-01', cashDividend: 1.5 }, fx.dividends);
  assert.equal(none.announced.official, true);
  assert.equal(none.actual.ntd, null, '有公告但沒記入帳：實際金額未知');
  assert.equal(none.actual.count, 0);
});

// ---------- 計畫進度 ----------
const schedule = (p = fx.plan) => {
  const rows = [{ index: 0, principal: p.initialPrincipal, assets: p.initialAssets }];
  for (let i = 1; i <= p.horizonMonths; i++) rows.push({ index: i, principal: rows[i - 1].principal + p.monthlyAmount, assets: rows[i - 1].assets + p.monthlyAmount });
  return rows;
};

test('排程日期從原始月底開始日算：1/31 → 2/28 → 3/31 → 4/30，不會卡在 28 號或跳過二月', () => {
  assert.deepEqual([0, 1, 2, 3, 12, 13].map((n) => L.scheduleDate('2026-01-31', n)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2027-01-31', '2027-02-28']);
  assert.equal(L.scheduleDate('2027-01-31', 13), '2028-02-29', '閏年');
  assert.equal(L.scheduleLabel('2026-01-31', 1), '2026/02');
  assert.match(src, /ZinfLedger\.scheduleLabel\(planSchedule\.startDate, row\.index\)/);
});

test('第 1 個月和第 2 個月的基準：2/28 剛好滿 1 個月對計畫第 1 格，3/15 還在第 1～2 格之間', () => {
  const s = schedule();
  assert.equal(L.elapsedMonths('2026-01-31', '2026-02-28'), 1);
  assert.equal(L.elapsedMonths('2026-01-31', '2026-03-31'), 2);
  assert.equal(L.elapsedMonths('2026-01-31', '2026-02-27') < 1, true);
  const m1 = L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-02-28', value: 110000, complete: true } });
  assert.equal(m1.planValue, 110000, '對的是第 1 格（110,000），不是第 2 格（120,000）');
  assert.equal(m1.status, 'on_track');
  assert.equal(m1.diff, 0);
  const mid = L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-03-15', value: 120000, complete: true } });
  assert.equal(Math.floor(mid.months), 1, '3/15 目前在第 1 格（以前四捨五入會標成第 2 格）');
  assert.equal(mid.planValue > 110000 && mid.planValue < 120000, true);
  assert.equal(mid.status, 'ahead');
});

test('實際與計畫用同一天、同一份完整資料：不完整或沒日期就不比', () => {
  const s = schedule();
  assert.equal(L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-03-31', value: 130000, complete: false } }).status, 'unknown');
  assert.equal(L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { value: 130000 } }).reason, 'no_date');
  assert.equal(L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: null }).lead, null);
  assert.equal(L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-01-15', value: 1, complete: true } }).reason, 'before_start');
  const ok = L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-03-31', value: 130000, complete: true } });
  assert.equal(ok.date, '2026-03-31');
  assert.equal(ok.planValue, 120000);
  assert.equal(Number(ok.lead.toFixed(6)), 1);
});

test('超出推算年限：不給精確的領先月數', () => {
  const s = schedule();
  const ahead = L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2026-03-31', value: 999999, complete: true } });
  assert.equal(ahead.status, 'ahead_beyond_horizon');
  assert.equal(ahead.lead, null);
  assert.equal(ahead.leadAtLeast, 10, '只知道至少領先到年限尾端');
  const past = L.progressCompare({ schedule: s, startDate: '2026-01-31', key: 'assets', actual: { date: '2027-06-30', value: 250000, complete: true } });
  assert.equal(past.status, 'beyond_horizon');
  assert.equal(past.lead, null);
  assert.equal(past.planValue, null);
  assert.match(src, /principalCrossing && !principalCrossing\.beyond/);
  assert.match(src, /assetCrossing && !assetCrossing\.beyond/);
});

test('已投入本金不從成本回推：只認起始本金＋開始後的買賣現金流；沒設定就是未知', () => {
  const p = L.contributedPrincipal({ initialPrincipal: 100000, startDate: '2026-01-31', trades: fx.trades, asOf: '2026-11-20' });
  assert.equal(p.ntd, 100000 + 12017 + 22532, '2025 年的舊交易在開始日之前，不重複算');
  assert.equal(p.basis, 'initial_plus_net_trades');
  assert.equal(L.contributedPrincipal({ startDate: '2026-01-31', trades: fx.trades }).ntd, null);
  assert.equal(L.contributedPrincipal({ initialPrincipal: '', startDate: '2026-01-31', trades: [] }).ntd, null);
  const unknown = L.contributedPrincipal({ initialPrincipal: 0, startDate: '2020-01-01', trades: [{ ...fx.trades[2], fxRate: 0 }] });
  assert.equal(unknown.ntd, null, '有一筆金額未知時整個是未知');
  assert.doesNotMatch(L.contributedPrincipal.toString(), /cost/i);
});

// ---------- AI ----------
test('來源抽屜的程式說明：虧損保留方向和符號，現金流不是損益，缺匯率不拿別的金額填入', () => {
  const valuation = twOnly();
  const v = { ...valuation, fx: null, us: { ...valuation.us, mode: 'unknown' } };
  const facts = {
    valuation: v, totalNtd: 1280000,
    change: { comparable: true, change: -1200, pct: -0.5 },
    cashFlow: { paidNtd: 4500, receivedNtd: 0, unknownCount: 0 },
  };
  const text = L.sourceDrawerExplanation(facts);
  assert.match(text, /持股總市值 NT\$ 1,280,000/);
  assert.match(text, /11\/20 13:30 報價/);
  assert.match(text, /當日下跌 NT\$ -1,200（-0\.50%）/);
  assert.match(text, /今天買進付出 NT\$ 4,500，賣出收回 NT\$ 0；這是現金流，不是損益/);
  assert.match(text, /美元匯率：未知/);
  assert.doesNotMatch(text, /當日上漲|總市值 NT\$ 4,500|匯率[^。]*4,500/);
});

test('程式說明每次使用當前事實，明確區分未知、零、正值與顯示精度以下的變動', () => {
  const valuation = twOnly();
  const input = { valuation, totalNtd: 0, cashFlow: { paidNtd: 0, receivedNtd: 750, unknownCount: 1 } };
  const unknown = L.sourceDrawerExplanation({ ...input, valuation: { ...valuation, status: 'unknown' }, change: { comparable: false, reason: 'unknown' } });
  assert.match(unknown, /持股總市值目前未知/);
  assert.match(unknown, /當日漲跌暫不顯示/);
  assert.match(unknown, /已知部分.*買進付出 未知.*NT\$ 750/);
  const flat = L.sourceDrawerExplanation({ ...input, change: { comparable: true, change: -0.4, pct: -0.004 } });
  assert.match(flat, /持股總市值 NT\$ 0/);
  assert.match(flat, /顯示精度.*NT\$ 0.*0\.00%/);
  assert.doesNotMatch(flat, /下跌|上漲/);
  const updated = L.sourceDrawerExplanation({ ...input, totalNtd: 1281200,
    change: { comparable: true, change: 1200, pct: 0.5 },
    valuation: { ...valuation, asOf: { ...valuation.asOf, newest: '2026-11-20T05:40:00.000Z' }, us: { ...valuation.us, mode: 'live' }, fx: { rate: 31.25, twDate: '2026-11-20', source: 'fixture' } },
  });
  assert.match(updated, /持股總市值 NT\$ 1,281,200/);
  assert.match(updated, /11\/20 13:40 報價/);
  assert.match(updated, /當日上漲 NT\$ \+1,200（\+0\.50%）/);
  assert.match(updated, /美元匯率：31\.25（fixture；2026-11-20）/);
  assert.doesNotMatch(updated, /目前未知|13:30/);
});

test('舊報價能算出可比值，也不能在來源摘要說成當日上漲；沒有歷史匯率的買進不顯示為零', () => {
  const stale = twOnly({ now: new Date('2026-11-23T07:32:00.000Z') });
  assert.equal(stale.status, 'stale');
  const change = L.comparableChange({ valuation: stale, quoteDay: { change: 1200, pct: 0.5 } });
  assert.equal(change.comparable, true, '不改原本漲跌算法，只避免在說明把舊報價寫成當日');
  const flow = L.cashFlow([{ date: '2026-11-23', action: 'buy', nativeAmount: 10, currency: 'USD' }]);
  assert.deepEqual(flow, { paidNtd: 0, receivedNtd: 0, netNtd: 0, unknownCount: 1 });
  const text = L.sourceDrawerExplanation({ valuation: stale, totalNtd: stale.totalNtd, change, cashFlow: flow });
  assert.match(text, /11\/20 13:30 報價/);
  assert.match(text, /當日漲跌暫不顯示：報價不是最新/);
  assert.doesNotMatch(text, /當日上漲|\+0\.50%|NT\$ 0/);
  assert.match(text, /買進付出 未知.*賣出收回 未知/);
});

test('來源摘要：用每日紀錄比較要寫日期，正常的台美不同交易日仍可顯示', () => {
  const v = L.valuation({ positions: [...positions(), { symbol: 'VOO', shares: 2 }], quotes: fx.quotes, usQuotes: fx.usQuotes, fx: fx.fx, now, record: lastRecord });
  assert.equal(v.status, 'complete');
  assert.notDeepEqual(v.asOf.marketDates.TW, v.asOf.marketDates.US);
  const change = L.comparableChange({ valuation: v, prevRecord: { ...lastRecord, date: '2026-11-09' }, trades: [], today: '2026-11-20' });
  assert.equal(change.basis, 'record');
  const text = L.sourceDrawerExplanation({ valuation: v, totalNtd: v.totalNtd, change });
  assert.match(text, /較 2026-11-09 每日紀錄/);
  assert.doesNotMatch(text, /當日(?:上漲|下跌)|暫不顯示/);
});

test('來源抽屜不發問、不寫入，只顯示程式生成的當前說明；一般 Puter 問答仍在', () => {
  const a = src.indexOf('function SourceDrawer('), b = src.indexOf('// </ledger-90-ui>');
  const drawer = src.slice(a, b);
  assert.match(drawer, /ZinfLedger\.sourceDrawerExplanation\(/);
  assert.match(drawer, /data-ledger-explain="local">\{explanation\}/);
  assert.doesNotMatch(drawer, /puter|askAi|aiBusy|useState|useEffect|setTrades|setHoldings|setDividends|fetch\(/i);
  assert.match(src.slice(0, a) + src.slice(b), /puterRiskCommentFlow\(/, '保留其他 Puter 使用者');
});

let DrawerBabel;
try { DrawerBabel = createRequire(import.meta.url)('@babel/standalone'); } catch {}
test('實際來源抽屜不需要 AI 環境，重新呈現會換成最新快照', {
  skip: DrawerBabel || process.env.CI ? false : '需要 npm install（@babel/standalone）',
}, () => {
  assert.ok(DrawerBabel, 'CI 必須先安裝 @babel/standalone');
  const source = src.slice(src.indexOf('function SourceDrawer('), src.indexOf('// </ledger-90-ui>'));
  const compiled = DrawerBabel.transform(source, { presets: ['react'] }).code;
  const context = vm.createContext({
    ZinfLedger: L, todayStr: () => '2026-11-20', uiText: text => text,
    nf: n => n.toLocaleString('zh-TW'), pf: n => n.toFixed(2)+'%', quotePriceText: String,
    UiLabel: 'label', LedgerSheet: 'sheet',
    React: { createElement: (tag, props, ...children) => ({ tag, props: props || {}, children }) },
  });
  // No React hooks, Puter session or fetch are present. Real component rendering must work without them.
  const render = vm.runInContext(compiled + '\nSourceDrawer', context);
  const walk = (node, pred) => {
    if (Array.isArray(node)) return node.flatMap(child => walk(child, pred));
    if (!node || typeof node !== 'object') return [];
    return [...(pred(node) ? [node] : []), ...walk(node.children, pred)];
  };
  const valuation = twOnly();
  const props = { valuation, change: { comparable: true, basis: 'prevClose' },
    totalToday: 1280000, dailyChange: -1200, dailyChangePct: -0.5, trades: [], dividends: [] };
  const before = render(props);
  const after = render({ ...props, totalToday: 1281200, dailyChange: 1200, dailyChangePct: 0.5 });
  const explanation = n => walk(n, x => x.props['data-ledger-explain'] === 'local')[0].children[0];
  assert.match(explanation(before), /下跌 NT\$ -1,200（-0\.50%）/);
  assert.match(explanation(after), /上漲 NT\$ \+1,200（\+0\.50%）/);
  assert.doesNotMatch(explanation(after), /下跌|1,280,000/);
  const incomplete = render({ ...props, trades: [{ date: '2026-11-20', action: 'buy', currency: 'USD', nativeAmount: 12 }] });
  const textOf = n => Array.isArray(n) ? n.map(textOf).join(' ') : typeof n === 'string' ? n : n && typeof n === 'object' ? textOf(n.children) : '';
  const cash = textOf(walk(incomplete, x => 'data-ledger-flow' in x.props)[0]);
  assert.match(cash, /今天買進付出.*未知/);
  assert.match(cash, /今天賣出收回.*未知/);
  assert.doesNotMatch(cash, /NT\$ 0/);
  const stale = render({ ...props, valuation: twOnly({ now: new Date('2026-11-23T07:32:00.000Z') }) });
  const staleCash = textOf(walk(stale, x => 'data-ledger-flow' in x.props)[0]);
  assert.match(staleCash, /當日漲跌.*—.*報價不是最新/);
  assert.doesNotMatch(staleCash, /1,200|0\.50%/);
  assert.match(explanation(stale), /當日漲跌暫不顯示：報價不是最新/);
  const dated = render({ ...props, change: { comparable: true, basis: 'record', vsDate: '2026-11-09' } });
  const datedCash = textOf(walk(dated, x => 'data-ledger-flow' in x.props)[0]);
  assert.match(datedCash, /2026-11-09.*每日紀錄/);
  assert.doesNotMatch(datedCash, /當日漲跌/);
  for (const tree of [before, after]) {
    assert.equal(walk(tree, x => 'data-ledger-ask-ai' in x.props).length, 0);
    assert.equal(walk(tree, x => 'data-ledger-flow' in x.props).length, 1);
    assert.equal(walk(tree, x => 'data-ledger-dividend' in x.props).length, 1);
  }
});

// ---------- 首頁與版面（靜態檢查；實際 375／390／430 截圖由 scripts/preview-ledger-90.mjs 產生） ----------
test('首頁只有一個「＋記交易」主要動作；總市值下面有資料時間與來源；原本的分頁與進階設定都還在', () => {
  assert.equal((src.match(/data-quick-trade-btn/g) || []).length, 1);
  const dash = src.slice(src.indexOf('function Dashboard('), src.indexOf('function StatCard('));
  assert.match(dash, /<UiLabel zh="持股總市值" \/>/);
  assert.match(dash, /data-ledger-asof/);
  assert.match(dash, /ZinfLedger\.asOfLine\(ledger\)/);
  assert.match(dash, /data-ledger-change="not-comparable"/);
  for (const id of ['dashboard', 'holdings', 'daily', 'trades', 'dividends', 'progress', 'plan']) assert.match(src, new RegExp(`\\{ id: "${id}", label:`));
  assert.match(src, /<ComposerFold label="新增交易"/, '交易紀錄頁原本的新增表單保留');
  assert.match(src, /storageKey="dashboardAdvancedPerformanceOpen"/);
  assert.match(src, /function detectAdvancedUse/);
  assert.match(src, /<script src="\/ledger-core\.js\?v=2"><\/script>/);
  assert.match(src, /href="\/forma-ledger\.css\?v=1"/);
});

test('只做紀錄，不接券商：新程式碼沒有下單／券商 API，也沒有新的對外網址', () => {
  const core = fs.readFileSync(new URL('../ledger-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /fetch\(|XMLHttpRequest|WebSocket|localStorage|https?:\/\//);
  const ui = src.slice(src.indexOf('// <ledger-90-ui>'), src.indexOf('// </ledger-90-ui>'));
  assert.doesNotMatch(ui, /https?:\/\/|fetch\(/);
  assert.match(ui, /不會連到券商、也不會下單/);
});

test('手機版面：可點區域 ≥44px、輸入框 16px、沒有會撐破 375px 的固定寬度；只用既有顏色變數', () => {
  const css = fs.readFileSync(new URL('../forma-ledger.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); assert.ok(m, sel); return m[1]; };
  const px = (decl, prop) => Number((decl.match(new RegExp(`(?:^|;)\\s*${prop}:(\\d+)px`)) || [])[1]);
  for (const sel of ['.forma-ledger-asof', '.forma-ledger-cta', '.forma-ledger-seg-btn', '.forma-ledger-primary', '.forma-ledger-secondary', '.forma-ledger-x', '.forma-ledger-field input'])
    assert.ok(px(rule(sel), 'min-height') >= 44 || px(rule(sel), 'height') >= 44, sel);
  assert.equal(px(rule('.forma-ledger-field input'), 'font-size'), 16);
  assert.match(rule('.forma-ledger-form'), /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  for (const m of css.matchAll(/(?:^|[;{\s])(?:min-)?width:(\d+)px/g)) assert.ok(Number(m[1]) <= 375, m[0]);
  assert.doesNotMatch(css.replace(/rgba\(15,23,42,[.\d]+\)/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, '不新增色碼');
  assert.equal(css.split('}').filter((r) => r.includes('{') && !r.trim().startsWith('@media')).every((r) => /\[data-forma-theme="portfolio"\]/.test(r)), true, '範圍限定在 Forma 主題內');
  assert.match(css, /prefers-reduced-motion:reduce/);
});
