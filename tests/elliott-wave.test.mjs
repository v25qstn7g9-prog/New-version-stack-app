// 波浪圖層（elliott-core.js）測試：只用合成日K，不連網、不讀任何真實行情或帳本。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../elliott-core.js';
import { readAppSource } from './_app-source.mjs';

const E = globalThis.ZinfElliott;
const core = fs.readFileSync(new URL('../elliott-core.js', import.meta.url), 'utf8');
const jsx = fs.readFileSync(new URL('../src/app.jsx', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ui = jsx.slice(jsx.indexOf('// <elliott-wave-ui>'), jsx.indexOf('// </elliott-wave-ui>'));

// ---------- 合成資料 ----------
// 交易日：週一到週五（不放假），從指定日期起算。
function tradingDays(start, n) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  while (out.length < n) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
// 依轉折價格畫出直線走勢：每段 step 根；高點＝收盤×1.002、低點＝收盤×0.998（讓「高點用 high、低點用 low」看得出差別）。
// prefix：前面先放幾根從第一個點的反方向慢慢走過來（幅度不到門檻），讓資料超過 60 根、起點也是近期極值。
function makeBars(points, { step = 5, prefix = 30, start = '2025-01-06', drift = 0.03 } = {}) {
  const closes = [];
  const p0 = points[0], dir = points[1] > points[0] ? 1 : -1;
  for (let k = 0; k < prefix; k++) closes.push(p0 * (1 + dir * drift * (1 - k / prefix)) * (1 + 0.004 * Math.sin(k)));
  for (let s = 0; s < points.length - 1; s++) {
    const a = points[s], b = points[s + 1];
    for (let k = s === 0 ? 0 : 1; k <= step; k++) closes.push(a + (b - a) * (k / step));
  }
  const days = tradingDays(start, closes.length);
  return closes.map((c, i) => ({ day: days[i], open: c, high: +(c * 1.002).toFixed(4), low: +(c * 0.998).toFixed(4), close: +c.toFixed(4) }));
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const ruleOf = (c, id) => c.rules.find((r) => r.id === id);

// 理想的上漲 5 浪＋A-B-C：2 浪回檔 60%、3 浪 1.6×1 浪、4 浪回檔 37.5%、5 浪＝1 浪、B 反彈 58%、C≈1.6×A
const UP_5ABC = [100, 120, 108, 140, 128, 148, 136, 143, 124];
const DOWN_5ABC = [150, 130, 142, 110, 122, 102, 114, 107, 126];

// ---------- 1. 轉折點 ----------
test('zigzag：反轉超過門檻才確認轉折；高點用 high、低點用 low，並記錄當天 close', () => {
  const bars = makeBars([100, 120, 108, 130], { prefix: 0 });
  const z = E.zigzag(bars, 5);
  assert.deepEqual(z.pivots.map((p) => p.type), ['L', 'H', 'L', 'H']);
  for (const p of z.pivots) {
    const b = bars[p.i];
    assert.equal(p.price, p.type === 'H' ? b.high : b.low);
    assert.equal(p.close, b.close);
    assert.equal(p.day, b.day);
  }
  assert.ok(z.pivots.slice(0, 3).every((p) => p.confirmed));
});

test('zigzag：門檻不同，轉折不同（4% 的回檔在 5% 門檻下不算轉折、在 3% 門檻下算）', () => {
  const bars = makeBars([100, 125, 120, 140], { prefix: 0 }); // 125→120 約 4%
  assert.equal(E.zigzag(bars, 5).pivots.length, 2);
  assert.equal(E.zigzag(bars, 3).pivots.length, 4);
});

test('zigzag：最後一段未確認的走勢標成「進行中」', () => {
  const bars = makeBars([100, 120, 108, 130], { prefix: 0 });
  const z = E.zigzag(bars, 5);
  const last = z.pivots[z.pivots.length - 1];
  assert.equal(last.confirmed, false);
  assert.equal(z.inProgress.direction, 'up');
  assert.equal(z.inProgress.extreme.day, last.day);
  assert.equal(z.inProgress.from.day, z.pivots[z.pivots.length - 2].day);
  assert.equal(z.inProgress.lastDay, bars[bars.length - 1].day);
  assert.match(z.inProgress.note, /進行中/);
});

test('門檻依波動度挑選：在候選門檻上各算一次，回傳實際用的門檻與 ATR%', () => {
  const r = E.analyze(makeBars(UP_5ABC));
  assert.equal(r.ok, true);
  assert.ok(E.CANDIDATE_THRESHOLDS.includes(r.thresholdPct));
  assert.equal(r.candidatesTried.length, E.CANDIDATE_THRESHOLDS.length);
  assert.ok(r.atrPct > 0);
  assert.ok(r.candidatesTried.every((t) => typeof t.atrMultiple === 'number'));
});

// ---------- 盤中今天那根不算 ----------
test('盤中未收盤的今天那根日K不算（820 分鐘以後才含今天），未來日期也不算', () => {
  const bars = makeBars([100, 120, 108, 130], { prefix: 0 });
  const today = bars[bars.length - 1].day;
  assert.equal(E.completedBars(bars, today, 600).at(-1).day, bars[bars.length - 2].day);
  assert.equal(E.completedBars(bars, today, 819).length, bars.length - 1);
  assert.equal(E.completedBars(bars, today, 820).at(-1).day, today);
  assert.equal(E.completedBars(bars, bars[bars.length - 3].day, 900).length, bars.length - 2);
  assert.match(jsx, /ZinfForecast\.clock\(new Date\(\)\)/);
  assert.match(ui, /today: data\.clock\.day, minute: data\.clock\.minute/);
});

// ---------- 2-4. 計數、硬性規則 ----------
test('正確的上漲 5 浪＋A–B–C 被認出，硬性規則全部通過', () => {
  const r = E.analyze(makeBars(UP_5ABC));
  assert.equal(r.primary.id, 'I5ABC');
  assert.equal(r.primary.direction, 'up');
  assert.deepEqual(r.primary.waves.map((w) => w.label), ['1', '2', '3', '4', '5', 'A', 'B', 'C']);
  assert.ok(r.primary.rules.length >= 4);
  assert.ok(r.primary.rules.every((x) => x.state === 'pass'), JSON.stringify(r.primary.rules));
  assert.equal(r.primary.waves.at(-1).inProgress, true, '最後一段（C 浪）還沒被反轉確認');
  assert.ok(['valid', 'uncertain'].includes(r.status));
  assert.equal(r.statusText, E.STATUS_TEXT[r.status]);
});

test('下跌方向也支援：鏡像的 5 浪＋A–B–C', () => {
  const r = E.analyze(makeBars(DOWN_5ABC));
  assert.equal(r.primary.id, 'I5ABC');
  assert.equal(r.primary.direction, 'down');
  assert.ok(r.primary.rules.every((x) => x.state === 'pass'));
  assert.ok(r.primary.waves[0].change < 0 && r.primary.waves[2].change < 0 && r.primary.waves[4].change < 0);
});

test('硬性規則：第 2 浪跌破第 1 浪起點 → 失敗並附數字，該計數被淘汰', () => {
  const bars = makeBars([100, 120, 97, 140, 128, 148], { prefix: 30 });
  const c = E.candidates(bars, 5).find((x) => x.id === 'I5');
  const rule = ruleOf(c, 'w2_start');
  assert.equal(rule.state, 'fail');
  assert.equal(rule.pass, false);
  assert.match(rule.detail, /第 2 浪低點 96\.81；第 1 浪起點 99\.\d+/);
  assert.equal(c.valid, false);
  assert.equal(c.score, 0);
  const r = E.analyze(bars, { thresholds: [5] });
  assert.notEqual(r.primary?.id, 'I5');
});

test('硬性規則：第 3 浪是 1、3、5 中最短 → 失敗，該計數被淘汰', () => {
  const bars = makeBars([100, 130, 112, 136, 131.5, 159], { prefix: 30 });
  const c = E.candidates(bars, 3).find((x) => x.id === 'I5');
  assert.equal(ruleOf(c, 'w3_not_shortest').state, 'fail');
  assert.match(ruleOf(c, 'w3_not_shortest').detail, /第 1 浪 .*第 3 浪 .*第 5 浪/);
  assert.equal(c.valid, false);
  assert.notEqual(E.analyze(bars, { thresholds: [3] }).primary?.id, 'I5');
});

test('硬性規則：第 4 浪進入第 1 浪價格區 → 失敗；只差這條時標成「可能是斜三角」，只能當替代、不當主要', () => {
  const bars = makeBars([100, 120, 108, 140, 118, 150], { prefix: 30 });
  const c = E.candidates(bars, 5).find((x) => x.id === 'I5');
  assert.equal(ruleOf(c, 'w4_overlap').state, 'fail');
  assert.equal(c.valid, false);
  assert.equal(c.diagonal, true);
  assert.match(c.text, /斜三角/);
  const r = E.analyze(bars, { thresholds: [5] });
  assert.ok(!r.primary || !r.primary.diagonal);
  assert.notEqual(r.primary?.id, 'I5');
});

test('硬性規則：第 3 浪要超過第 1 浪終點；還在進行中時標「未定」，不硬說成立', () => {
  const bars = makeBars([100, 120, 108, 118], { prefix: 30 });
  const c = E.candidates(bars, 5).find((x) => x.id === 'I3');
  assert.equal(ruleOf(c, 'w3_beyond_w1').state, 'pending');
  assert.equal(c.valid, true);
});

test('A–B–C：B 浪超過 A 浪起點只能算擴張平台，而且明標', () => {
  const bars = makeBars([60, 100, 80, 104, 70, 90, 82], { prefix: 30 });
  const c = E.candidates(bars, 5).find((x) => x.id === 'ABC12');
  assert.ok(c);
  const rule = ruleOf(c, 'b_not_beyond_a');
  assert.equal(rule.state, 'flat');
  assert.match(rule.detail, /擴張平台/);
  assert.equal(c.expandedFlat, true);
  assert.match(c.text, /擴張平台/);
});

// ---------- 5. 輸出：費波那契、天數、失效與關卡 ----------
test('費波那契回檔位＝該浪幅度的 38.2／50／61.8% 回檔價', () => {
  assert.deepEqual(E.fibLevels(100, 120), { r382: 112.36, r500: 110, r618: 107.64 });
  assert.deepEqual(E.fibLevels(120, 100), { r382: 107.64, r500: 110, r618: 112.36 });
  const r = E.analyze(makeBars(UP_5ABC));
  for (const w of r.primary.waves) {
    const d = w.end.price - w.start.price;
    assert.ok(near(w.fib.r382, Math.round((w.end.price - 0.382 * d) * 100) / 100, 1e-4));
    assert.ok(near(w.fib.r618, Math.round((w.end.price - 0.618 * d) * 100) / 100, 1e-4));
  }
});

test('每一浪的交易日數與日曆天數', () => {
  const bars = makeBars(UP_5ABC);
  const r = E.analyze(bars);
  for (const w of r.primary.waves) {
    assert.equal(w.tradingDays, w.end.i - w.start.i);
    assert.equal(w.calendarDays, (Date.parse(w.end.day) - Date.parse(w.start.day)) / 86400000);
    assert.ok(w.calendarDays >= w.tradingDays);
    assert.equal(w.start.day, bars[w.start.i].day);
    assert.ok(Math.abs(w.pct - (w.end.price / w.start.price - 1) * 100) < 0.02);
  }
  // 週五 → 下週一：1 個交易日、3 個日曆天
  const days = tradingDays('2025-01-10', 2);
  assert.deepEqual(days, ['2025-01-10', '2025-01-13']);
});

test('A–B–C 修正後的新推動：失效價＝C 浪低點；跌破後的下一個參考用 C＝A 比例；關卡含新第 1 浪高點、B 浪高點、修正起點，每個都有理由', () => {
  // 前一段大漲 60→160，A 160→130、B →148、C →120，新 1 浪 →138、2 浪 →128（進行中）
  const bars = makeBars([60, 160, 130, 148, 120, 138, 128], { prefix: 30, step: 6 });
  const r = E.analyze(bars, { thresholds: [5] });
  assert.equal(r.primary.id, 'ABC12');
  const W = Object.fromEntries(r.primary.waves.map((w) => [w.label, w]));
  assert.equal(r.invalidation[0].price, W.C.end.price);
  assert.match(r.invalidation[0].why, /第 2 浪不可跌破第 1 浪起點/);
  const A = Math.abs(W.A.end.price - W.A.start.price);
  const next = r.invalidation.find((v) => v.next && /C 浪延伸/.test(v.why));
  assert.ok(next && near(next.price, Math.round((W.B.end.price - A) * 100) / 100, 1e-4), JSON.stringify(r.invalidation));
  const kl = (p) => r.keyLevels.find((k) => k.price === p);
  assert.match(kl(W['1'].end.price).why, /第 3 浪/);
  assert.match(kl(W.B.end.price).why, /B 浪/);
  assert.match(kl(W.A.start.price).why, /修正起點/);
  assert.ok(r.keyLevels.every((k) => typeof k.why === 'string' && k.why.length > 6));
  // 新推動尚未突破第 1 浪高點：不說「成立」
  assert.equal(r.status, 'uncertain');
  assert.ok(r.uncertainReasons.some((t) => /新推動尚未確認/.test(t)));
});

test('第 5 浪進行中：失效價＝第 4 浪低點；第 3 浪短於第 1 浪時，第 5 浪上限也列為失效價', () => {
  const bars = makeBars([100, 130, 112, 138, 131, 145], { prefix: 30 });
  const c = E.candidates(bars, 5).find((x) => x.id === 'I5');
  assert.equal(c.valid, true);
  assert.equal(c.invalidation[0].price, c.waves[3].end.price);
  const cap = c.invalidation.find((v) => /第 5 浪不可比第 3 浪長/.test(v.why));
  const w3 = Math.abs(c.waves[2].end.price - c.waves[2].start.price);
  assert.ok(cap && near(cap.price, Math.round((c.waves[3].end.price + w3) * 100) / 100, 1e-4));
});

// ---------- 評分與不確定 ----------
test('分數接近時 status＝不確定；差距夠大才不因分數而不確定', () => {
  assert.equal(E.scoreReasons(0.7, 0.68).some((t) => /分數接近/.test(t)), true);
  assert.deepEqual(E.scoreReasons(0.7, 0.5), []);
  assert.deepEqual(E.scoreReasons(0.7, null), []);
  assert.equal(E.scoreReasons(0.4, null).some((t) => /偏低/.test(t)), true);
  const r = E.analyze(makeBars(UP_5ABC), { closeMargin: 1, minScore: 0 });
  assert.ok(r.alternatives.length > 0);
  assert.equal(r.status, 'uncertain');
  assert.ok(r.uncertainReasons.some((t) => /分數接近/.test(t)));
  const r2 = E.analyze(makeBars(UP_5ABC), { minScore: 2 });
  assert.equal(r2.status, 'uncertain');
  assert.ok(r2.uncertainReasons.some((t) => /偏低/.test(t)));
  assert.ok(r.alternatives.length <= 2);
});

test('沒有任何候選通過硬性規則 → 計數不成立，只回轉折、不貼浪名', () => {
  // 每次反彈都創新低又創新高的擴散走勢：任何 5 浪／ABC 都違反規則
  const bars = makeBars([100, 106, 94, 112, 88, 118, 82, 124, 76], { prefix: 30 });
  const r = E.analyze(bars, { thresholds: [5] });
  assert.equal(r.status, 'invalid');
  assert.equal(r.statusText, '計數不成立');
  assert.equal(r.primary, null);
  assert.ok(r.pivots.length > 0);
  assert.ok(r.rejected.length > 0 && r.rejected.every((c) => c.rules.some((x) => x.state === 'fail')));
  assert.ok(r.uncertainReasons[0].includes('硬性規則'));
});

test('資料不足時回傳安全的空結果', () => {
  for (const input of [null, undefined, [], makeBars([100, 120], { prefix: 0, step: 10 }), [{ day: 'x', high: 'a' }]]) {
    const r = E.analyze(input);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'insufficient');
    assert.equal(r.primary, null);
    assert.deepEqual(r.alternatives, []);
    assert.deepEqual(r.keyLevels, []);
    assert.deepEqual(r.invalidation, []);
    assert.match(r.reason, /不計算波浪/);
  }
  assert.deepEqual(E.zigzag([], 5), { pivots: [], inProgress: null });
  assert.equal(E.scenarios(0, '2026-01-01'), null);
  assert.equal(E.scenarios(100, 'bad'), null);
});

// ---------- 6. 2055 情境 ----------
test('2055 年底情境：三種假設年化報酬率（悲觀 2%、中性 5%、樂觀 8%），純計算', () => {
  assert.deepEqual(E.SCENARIO_RATES, { pessimistic: 0.02, neutral: 0.05, optimistic: 0.08 });
  assert.equal(E.SCENARIO_YEAR, 2055);
  const s = E.scenarios(100, '2025-12-31');
  const years = 10957 / 365.25;
  assert.ok(near(s.years, Math.round(years * 100) / 100));
  const by = Object.fromEntries(s.rows.map((x) => [x.key, x]));
  assert.ok(near(by.pessimistic.price, Math.round(100 * 1.02 ** years * 100) / 100, 1e-6));
  assert.ok(near(by.neutral.price, Math.round(100 * 1.05 ** years * 100) / 100, 1e-6));
  assert.ok(near(by.optimistic.price, Math.round(100 * 1.08 ** years * 100) / 100, 1e-6));
  assert.deepEqual(s.rows.map((x) => x.label), ['樂觀', '中性', '悲觀']);
  assert.match(s.note, /假設情境，不是預測/);
  assert.match(s.note, /不含股息/);
  const custom = E.scenarios(50, '2030-06-30', { pessimistic: 0, neutral: 0.1, optimistic: 0.2 }, 2031);
  assert.equal(custom.rows.find((x) => x.key === 'pessimistic').price, 50);
  // 常數集中在 core 一處
  assert.equal((core.match(/pessimistic:0\.02/g) || []).length, 1);
});

// ---------- 原始碼檢查 ----------
test('程式裡沒有寫死任何參考價位', () => {
  for (const src of [core, jsx]) assert.doesNotMatch(src, /35442|36033|40180|44525|49969|32393|38195|40122/);
});

test('圖層預設關閉；關閉時不抓資料、不計算；開關不存檔', () => {
  assert.match(ui, /const \[on, setOn\] = useState\(false\);/);
  assert.match(ui, /useEffect\(\(\) => \{ if \(on && data\.status === "idle"\) load\(\); \}, \[on, data\.status, load\]\);/);
  assert.match(ui, /if \(!on \|\| data\.status !== "ready" \|\| !E\) return null;/);
  assert.equal((ui.match(/loadElliottBars\(/g) || []).length, 2, '只有定義與 load() 內一處呼叫');
  assert.match(ui, /\{on && \(/);
  assert.match(ui, /role="switch" aria-checked=\{on\}/);
  // 不新增儲存鍵、不寫入：只唯讀既有的 trendRadarDailyHistory 快取
  assert.doesNotMatch(ui, /saveKey|localStorage|sessionStorage|indexedDB|setItem/);
  assert.deepEqual([...ui.matchAll(/loadKey\("([^"]+)"/g)].map((m) => m[1]), ['trendRadarDailyHistory']);
  assert.deepEqual([...ui.matchAll(/fetchWithTimeout\(`([^`?]+)/g)].map((m) => m[1]), ['/daily-history']);
  assert.match(ui, /symbols=\$\{encodeURIComponent\(want\.join\(","\)\)\}/);
  assert.deepEqual(jsx.match(/const ELLIOTT_SYMBOLS = \[[^\]]+\]/)[0].match(/sym: "([^"]+)"/g), ['sym: "TAIEX"', 'sym: "0050"', 'sym: "0056"']);
  // 核心是純計算：沒有網路、沒有儲存
  assert.doesNotMatch(core, /fetch\(|XMLHttpRequest|WebSocket|localStorage|indexedDB|https?:\/\//);
});

test('免責聲明與「假設情境，不是預測」文字存在', () => {
  assert.match(ui, /僅供參考，不構成投資建議。轉折點與比例由程式計算。/);
  assert.equal(E.DISCLAIMER, '僅供參考，不構成投資建議。轉折點與比例由程式計算。');
  assert.match(ui, /假設情境，不是預測/);
  assert.match(ui, /價格指數不含股息/);
});

test('載入方式比照其他 core：index.html script 標籤、放在總覽即時報價卡後面', () => {
  assert.match(html, /<script src="\/elliott-core\.js\?v=1"><\/script>/);
  assert.ok(html.indexOf('/ledger-core.js') < html.indexOf('/elliott-core.js'));
  assert.ok(html.indexOf('/elliott-core.js') < html.indexOf('<script src="/app.js'));
  const src = readAppSource();
  const dash = src.slice(src.indexOf('function Dashboard({ totalToday'));
  const live = dash.indexOf('<LivePricePanel'), ew = dash.indexOf('<ElliottWaveCard />'), radar = dash.indexOf('title="今日趨勢雷達"');
  assert.ok(live > 0 && ew > live && radar > ew);
});

test('手機版面：可點區域用 forma-tap（≥44px）、不用固定寬度撐破畫面、圖表不跑動畫、漲跌色只用在漲跌幅', () => {
  assert.match(ui, /role="tab"[\s\S]*?className="forma-tap flex-1/);
  assert.doesNotMatch(ui, /w-\[\d{3,}px\]|width: ?[3-9]\d\d\b|minWidth: ?[3-9]\d\d/);
  assert.equal((ui.match(/<Line /g) || []).length, (ui.match(/isAnimationActive=\{false\}/g) || []).length);
  const gainUses = ui.match(/COLORS\.(gain|loss)/g) || [];
  assert.equal(gainUses.length, 2);
  assert.match(ui, /color: w\.pct >= 0 \? COLORS\.gain : COLORS\.loss/);
  assert.match(ui, /text-\[11px\] leading-\[17px\]/);
});
