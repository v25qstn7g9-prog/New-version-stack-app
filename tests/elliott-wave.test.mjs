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
// 卡片的顯示決策（純函式）：直接執行 app.jsx 的 <elliott-session> 與 <elliott-view> 段落
const section = (name) => { const a = ui.indexOf(`// <${name}>`), b = ui.indexOf(`// </${name}>`); assert.ok(a >= 0 && b > a, name); return ui.slice(a, b); };
const V = new Function(`${section('elliott-session')}\n${section('elliott-view')}; return { ewIsValidBar, ewValidBarCount, ewCountKey, ewEntries, resolveElliottView, ewSymbolStatus, ewHeadline, ewSpanText, ewWaveDatesText, EW_PIVOTS_ONLY };`)();

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
  // 只有 on 時才 open()；關閉（effect cleanup）時 close() 會中止請求；卸載時 dispose()
  assert.match(ui, /if \(!on \|\| !s\) return undefined;\s*s\.open\(\);/);
  assert.match(ui, /return \(\) => \{ s\.close\(\);/);
  assert.match(ui, /return \(\) => \{ s\.dispose\(\);/);
  assert.match(ui, /if \(!on \|\| !E \|\| !data\.clock \|\| !Array\.isArray\(symBars\)\) return null;/);
  assert.match(ui, /\{on && \(/);
  assert.match(ui, /role="switch" aria-checked=\{on\}/);
  // 不新增儲存鍵、不寫入：只唯讀既有的 trendRadarDailyHistory 快取
  assert.doesNotMatch(ui, /saveKey|localStorage|sessionStorage|indexedDB|setItem/);
  assert.deepEqual([...ui.matchAll(/loadKey\("([^"]+)"/g)].map((m) => m[1]), ['trendRadarDailyHistory']);
  assert.deepEqual([...ui.matchAll(/fetchWithTimeout\(`([^`?]+)/g)].map((m) => m[1]), ['/daily-history']);
  assert.match(ui, /symbols=\$\{encodeURIComponent\(want\.join\(","\)\)\}`, \{ cache: "no-store", signal \}/);
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

// ======================= Codex 審查第 1 輪的修正 =======================
const pick = (r) => [r.primary, ...r.alternatives].filter(Boolean);

// ---------- 1. A 浪確認方向 ----------
test('A 浪確認：上漲推動後，A 浪低點低於第 4 浪低點才算「跌破」；還沒跌破、剛好相等都不算', () => {
  const at = (last) => {
    const r = E.analyze(makeBars([100, 120, 108, 140, 128, 148, last]), { thresholds: [5] });
    assert.equal(r.primary.id, 'I5A');
    return { r, e4: r.primary.waves[3].end.price, eA: r.primary.waves[5].end.price };
  };
  const before = at(136); // A 浪低點 135.73 還高於第 4 浪低點 127.74
  assert.ok(before.eA > before.e4);
  assert.ok(before.r.uncertainReasons.some((t) => /A 浪還沒跌破第 4 浪低點/.test(t)), JSON.stringify(before.r.uncertainReasons));
  const after = at(124); // 已跌破
  assert.ok(after.eA < after.e4);
  assert.ok(!after.r.uncertainReasons.some((t) => /推動結束尚未確認/.test(t)), JSON.stringify(after.r.uncertainReasons));
  const equal = at(128); // A 浪低點＝第 4 浪低點（同一個 low），不算跌破
  assert.equal(equal.eA, equal.e4);
  assert.ok(equal.r.uncertainReasons.some((t) => /A 浪還沒跌破第 4 浪低點/.test(t)));
});

test('A 浪確認：下跌推動後，A 浪高點高於第 4 浪高點才算「突破」；相等不算', () => {
  const at = (last) => {
    const r = E.analyze(makeBars([150, 130, 142, 110, 122, 102, last]), { thresholds: [5] });
    assert.equal(r.primary.id, 'I5A');
    assert.equal(r.primary.direction, 'down');
    return { r, e4: r.primary.waves[3].end.price, eA: r.primary.waves[5].end.price };
  };
  const before = at(114);
  assert.ok(before.eA < before.e4);
  assert.ok(before.r.uncertainReasons.some((t) => /A 浪還沒突破第 4 浪高點/.test(t)));
  const after = at(126);
  assert.ok(after.eA > after.e4);
  assert.ok(!after.r.uncertainReasons.some((t) => /推動結束尚未確認/.test(t)));
  const equal = at(122);
  assert.equal(equal.eA, equal.e4);
  assert.ok(equal.r.uncertainReasons.some((t) => /A 浪還沒突破第 4 浪高點/.test(t)));
});

// ---------- 2. 獨立 A–B–C ----------
test('獨立 A–B–C：大漲後的 A–B–C（還沒有新第 1 浪）被認出，並和下跌推動競爭主要／替代', () => {
  const bars = makeBars([60, 160, 130, 148, 120], { step: 10 });
  const r = E.analyze(bars);
  const abc = pick(r).find((c) => c.id === 'ABC');
  assert.ok(abc, JSON.stringify(pick(r).map((c) => c.id)));
  assert.equal(r.primary.id, 'ABC'); // 修正解讀比「下跌第 3 浪」更符合比例
  assert.ok(pick(r).some((c) => c.id === 'I3' && c.direction === 'down'), '下跌推動仍列為替代');
  assert.deepEqual(abc.waves.map((w) => w.label), ['A', 'B', 'C']);
  assert.equal(abc.kind, 'abc');
  assert.equal(abc.direction, 'up'); // 被修正的是上漲走勢
  assert.match(abc.directionText, /上漲後的修正/);
  const rule = ruleOf(abc, 'corr_within_prior');
  assert.equal(rule.state, 'pass');
  assert.match(rule.detail, /被修正那段走勢起點/);
  assert.ok(abc.ratios.some((x) => /修正.*÷ 被修正那段走勢/.test(x.name)));
  // C 浪還在進行中：不說成立
  assert.equal(r.status, 'uncertain');
  // 失效價：B 浪高點；跌破被修正那段走勢起點也列為（下一個）失效參考
  assert.equal(r.invalidation[0].price, abc.waves[1].end.price);
  assert.ok(r.invalidation.some((v) => /被修正那段走勢的起點/.test(v.why)));
});

test('獨立 A–B–C：進行中的 A、A–B 也有候選；修正超過被修正那段走勢的起點 → 不成立', () => {
  const a = E.candidates(makeBars([60, 160, 130], { step: 10 }), 5).find((c) => c.id === 'A');
  assert.ok(a && a.valid);
  assert.deepEqual(a.waves.map((w) => w.label), ['A']);
  assert.equal(a.waves[0].inProgress, true);
  const ab = E.candidates(makeBars([60, 160, 130, 148], { step: 10 }), 5).find((c) => c.id === 'AB');
  assert.ok(ab && ab.valid);
  assert.deepEqual(ab.waves.map((w) => w.label), ['A', 'B']);
  assert.equal(ruleOf(ab, 'b_not_beyond_a').state, 'pass');
  assert.equal(ab.waves[1].inProgress, true);
  const rA = E.analyze(makeBars([60, 160, 130], { step: 10 }));
  if (rA.primary?.id === 'A') assert.ok(rA.uncertainReasons.some((t) => /只有 A 浪/.test(t)));
  // 跌破前段漲勢起點（約 60）：不是修正，是新趨勢
  const bad = E.candidates(makeBars([60, 160, 130, 148, 50], { step: 10 }), 5).find((c) => c.id === 'ABC');
  assert.equal(ruleOf(bad, 'corr_within_prior').state, 'fail');
  assert.equal(bad.valid, false);
  // 下跌方向鏡像
  const dn = E.candidates(makeBars([200, 100, 130, 112, 140], { step: 10 }), 5).find((c) => c.id === 'ABC');
  assert.ok(dn && dn.valid);
  assert.equal(dn.direction, 'down');
  assert.ok(dn.waves[0].change > 0 && dn.waves[2].change > 0);
});

test('獨立 A–B–C 和「5 浪＋A–B–C」同一個 A 浪起點時算同一個解讀，不互相佔替代名額', () => {
  const r = E.analyze(makeBars(UP_5ABC));
  assert.equal(r.primary.id, 'I5ABC');
  const a5 = r.primary.waves[5].start.day;
  assert.ok(!r.alternatives.some((c) => c.kind === 'abc' && c.waves[0].start.day === a5));
});

// ---------- 6. 角色 ----------
test('候選角色明確：primary.role＝primary、替代一律 alternative；沒有主要時，違反規則的替代不會變主要', () => {
  const ok = E.analyze(makeBars(UP_5ABC));
  assert.equal(ok.primary.role, 'primary');
  assert.ok(ok.primary.valid);
  assert.ok(ok.alternatives.every((c) => c.role === 'alternative'));
  // 斜三角（只違反第 4 浪重疊）是唯一候選：primary 為 null、替代 valid:false
  const r = E.analyze(makeBars([100, 135, 96, 120, 100, 135, 119, 139, 90]), { thresholds: [5] });
  assert.equal(r.primary, null);
  assert.equal(r.status, 'invalid');
  assert.equal(r.statusText, '計數不成立');
  assert.ok(r.alternatives.length >= 1);
  assert.ok(r.alternatives.every((c) => c.role === 'alternative' && c.valid === false && c.diagonal));
  // 畫面（純函式）：主要只來自 result.primary，不靠陣列位置；沒有主要時預設「只看轉折」，替代都標 alternative
  const okE = V.ewEntries(ok);
  assert.equal(okE[0].role, 'primary');
  assert.equal(okE[0].c, ok.primary);
  assert.ok(okE.slice(1).every((e, k) => e.role === 'alternative' && e.label === `替代 ${k + 1}`));
  assert.equal(V.resolveElliottView(ok, null).sel, 0);
  const rE = V.ewEntries(r);
  assert.ok(rE.length >= 1 && rE.every((e) => e.role === 'alternative' && e.c.valid === false));
  const rv = V.resolveElliottView(r, null);
  assert.equal(rv.sel, -1);
  assert.equal(rv.shown, null);
  assert.equal(rv.pivotsOnly, true);
  assert.match(V.ewHeadline(r), /沒有符合硬性規則的主要計數/);
  assert.equal(V.ewHeadline(ok), `主要：${ok.primary.text}`);
  assert.match(ui, /!shown\.c\.valid && <span data-ew-invalid[^>]*>・計數不成立/);
});

// ---------- 3–5. 載入流程（直接執行 app.jsx 裡的純 JS 段落） ----------
const sessionSrc = ui.slice(ui.indexOf('// <elliott-session>'), ui.indexOf('// </elliott-session>'));
const { createElliottSession, ewPhaseKey } = new Function(`${sessionSrc}; return { createElliottSession, ewPhaseKey };`)();
const SYMS = ['TAIEX', '0050', '0056'];
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const goodBars = (syms) => Object.fromEntries(syms.map((s) => [s, makeBars([100, 120, 110])]));
function harness({ cache = null, fetchImpl, clock = { day: '2026-11-27', minute: 600 } } = {}) {
  const h = { clock, fetches: [], states: [], cacheReads: 0, signals: [] };
  h.s = createElliottSession({
    symbols: SYMS,
    readCache: () => { h.cacheReads++; return typeof cache === 'function' ? cache() : Promise.resolve(cache); },
    fetchBars: (want, signal) => { h.fetches.push(want.slice()); h.signals.push(signal); return fetchImpl ? fetchImpl(want, signal) : Promise.resolve(goodBars(want)); },
    now: () => h.clock,
    onChange: (st) => h.states.push(st),
    memo: { key: null, bars: {} },
  });
  h.last = () => h.states[h.states.length - 1];
  return h;
}

test('載入：沒打開就不讀快取、不抓資料；check() 在關閉時什麼都不做', async () => {
  const h = harness();
  h.s.check();
  await flush();
  assert.equal(h.cacheReads, 0);
  assert.equal(h.fetches.length, 0);
  assert.equal(h.states.length, 0);
});

test('載入：快取還沒讀完就關閉 → 不會再 fetch，也不會更新成 ready', async () => {
  const d = deferred();
  const h = harness({ cache: () => d.p });
  h.s.open();
  assert.equal(h.cacheReads, 1);
  h.s.close();
  d.resolve(null);
  await flush();
  assert.equal(h.fetches.length, 0, '關閉後不得 fetch');
  assert.ok(!h.states.some((st) => st.status === 'ready'));
  assert.equal(h.s.getState().status, 'idle');
});

test('載入：fetch 中關閉 → 請求被 abort，回來的結果丟掉；卸載後也不再回呼', async () => {
  const d = deferred();
  const h = harness({ fetchImpl: () => d.p });
  h.s.open();
  await flush();
  assert.equal(h.fetches.length, 1);
  h.s.close();
  assert.equal(h.signals[0].aborted, true);
  d.resolve(goodBars(SYMS));
  await flush();
  assert.ok(!h.states.some((st) => st.status === 'ready'));
  // 卸載
  const d2 = deferred();
  const h2 = harness({ fetchImpl: () => d2.p });
  h2.s.open();
  await flush();
  const n = h2.states.length;
  h2.s.dispose();
  assert.equal(h2.signals[0].aborted, true);
  d2.resolve(goodBars(SYMS));
  await flush();
  assert.equal(h2.states.length, n, '卸載後不得 setState');
});

test('載入：快速開關，只有最後一次請求的結果會寫回', async () => {
  const ds = [deferred(), deferred()];
  let k = 0;
  const h = harness({ fetchImpl: () => ds[k++].p });
  h.s.open();
  await flush();
  h.s.close();
  h.s.open();
  await flush();
  assert.equal(h.fetches.length, 2);
  assert.equal(h.signals[0].aborted, true);
  ds[1].resolve(goodBars(SYMS));
  await flush();
  ds[0].resolve({ TAIEX: [] });
  await flush();
  assert.equal(h.last().status, 'ready');
  assert.deepEqual(h.last().failed, []);
  assert.ok(SYMS.every((s) => h.last().bars[s].length > 0));
});

test('載入：同一天同一交易階段不重抓；隔天、跨過 13:40 收盤會重抓，分析用新的時鐘', async () => {
  const h = harness();
  h.s.open();
  await flush();
  assert.equal(h.fetches.length, 1);
  h.clock = { day: '2026-11-27', minute: 700 };
  h.s.check();
  await flush();
  assert.equal(h.fetches.length, 1, '同一階段不重抓');
  h.clock = { day: '2026-11-27', minute: 821 }; // 跨過 13:40
  h.s.check();
  await flush();
  assert.equal(h.fetches.length, 2);
  assert.deepEqual(h.last().clock, { day: '2026-11-27', minute: 821 });
  h.s.close();
  h.clock = { day: '2026-11-30', minute: 600 }; // 關著時隔天：不抓
  h.s.check();
  await flush();
  assert.equal(h.fetches.length, 2);
  h.s.open(); // 重新打開 → 發現換日 → 重抓
  await flush();
  assert.equal(h.fetches.length, 3);
  assert.equal(h.last().clock.day, '2026-11-30');
  assert.equal(h.last().key, ewPhaseKey({ day: '2026-11-30', minute: 600 }));
  assert.equal(ewPhaseKey({ day: 'd', minute: 539 }), 'd|premarket');
  assert.equal(ewPhaseKey({ day: 'd', minute: 819 }), 'd|session');
  assert.equal(ewPhaseKey({ day: 'd', minute: 820 }), 'd|closed');
  // 畫面接線：回到前景與每分鐘檢查；分析用 session 回報的時鐘
  assert.match(ui, /document\.addEventListener\("visibilitychange", onVisible\)/);
  assert.match(ui, /document\.removeEventListener\("visibilitychange", onVisible\)/);
  assert.match(ui, /setInterval\(\(\) => \{ if \(document\.visibilityState !== "hidden"\) s\.check\(\); \}, 60000\)/);
  assert.match(ui, /now: \(\) => globalThis\.ZinfForecast\.clock\(new Date\(\)\)/);
});

test('載入：只有部分標的成功 → 缺的標成暫時抓不到，不當完整快取；重試只補抓缺的', async () => {
  let mode = 'partial';
  const h = harness({ fetchImpl: (want) => Promise.resolve(mode === 'partial' ? { TAIEX: makeBars([100, 120, 110]), '0050': [] } : goodBars(want)) });
  h.s.open();
  await flush();
  assert.equal(h.last().status, 'ready');
  assert.deepEqual(h.last().failed, ['0050', '0056']);
  assert.ok(h.last().bars.TAIEX.length > 0);
  assert.equal(h.last().bars['0050'], undefined);
  // 同一階段的檢查不會自動重抓，但重試會、而且只抓缺的
  mode = 'ok';
  h.s.retry();
  await flush();
  assert.deepEqual(h.fetches, [SYMS, ['0050', '0056']]);
  assert.deepEqual(h.last().failed, []);
  // 全部失敗 → error；重新打開會再試
  const h2 = harness({ fetchImpl: () => Promise.reject(new Error('timeout')) });
  h2.s.open();
  await flush();
  assert.equal(h2.last().status, 'error');
  assert.deepEqual(h2.last().failed, SYMS);
  h2.s.close();
  h2.s.open();
  await flush();
  assert.equal(h2.fetches.length, 2);
  // 畫面：缺的標的顯示「暫時抓不到」＋重試（≥44px），不說資料不足
  assert.match(ui, /暫時抓不到\{symLabel\}的日線資料/);
  assert.match(ui, /onClick=\{retry\} className="forma-tap[^"]*" style=\{pill\(true\)\}>重試<\/button>/);
  assert.match(ui, /const tap = \{ minHeight: 44 \};/);
  // 畫面狀態（純函式）：成功的標的 ready、缺的 missing（顯示重試）、全部失敗也是 missing
  const partial = { status: 'ready', bars: { TAIEX: makeBars([100, 120, 110]) }, failed: ['0050', '0056'] };
  assert.equal(V.ewSymbolStatus(partial, 'TAIEX'), 'ready');
  assert.equal(V.ewSymbolStatus(partial, '0050'), 'missing');
  assert.equal(V.ewSymbolStatus({ status: 'error', bars: {}, failed: SYMS }, '0056'), 'missing');
  assert.equal(V.ewSymbolStatus({ status: 'loading', bars: {}, failed: [] }, '0056'), 'loading');
  assert.equal(V.ewSymbolStatus({ status: 'idle', bars: {}, failed: [] }, '0056'), 'loading');
  assert.match(ui, /\{symStatus === "missing" && \(/);
});

test('載入：唯讀快取同一天同一階段才用；只有部分標的時其餘照樣去抓', async () => {
  const cache = { key: ewPhaseKey({ day: '2026-11-27', minute: 600 }) + '|x', bars: { TAIEX: makeBars([100, 120, 110]) } };
  const h = harness({ cache });
  h.s.open();
  await flush();
  assert.deepEqual(h.fetches, [['0050', '0056']]);
  assert.deepEqual(h.last().failed, []);
  const stale = harness({ cache: { key: '2026-11-26|closed|x', bars: goodBars(SYMS) } });
  stale.s.open();
  await flush();
  assert.deepEqual(stale.fetches, [SYMS]);
});

// ---------- 7–9. 圖表資料 ----------
const chartSrc = ui.slice(ui.indexOf('// <elliott-chart>'), ui.indexOf('// </elliott-chart>'));
const { ewChartModel } = new Function(`${chartSrc}; return { ewChartModel };`)();

test('圖表：沒有有效計數時，直接用 result.pivots 畫中性轉折（不貼浪名），最後一段是虛線', () => {
  const bars = makeBars([100, 106, 94, 112, 88, 118, 82, 124, 76], { prefix: 30 });
  const r = E.analyze(bars, { thresholds: [5] });
  assert.equal(r.primary, null);
  const m = ewChartModel(E.completedBars(bars), r, [], 'all');
  const piv = m.rows.filter((x) => x.piv != null).length + m.rows.filter((x) => x.piv == null && x.pivLive != null).length;
  assert.equal(piv, r.pivots.length);
  assert.equal(m.labels.length, 0);
  const lastP = r.pivots.at(-1);
  assert.equal(lastP.confirmed, false);
  assert.equal(m.rows[lastP.i - m.from].piv, undefined, '未確認的點不在實線');
  assert.equal(m.rows[lastP.i - m.from].pivLive, lastP.price);
  assert.equal(m.rows[r.pivots.at(-2).i - m.from].pivLive, r.pivots.at(-2).price);
  assert.match(ui, /dataKey="piv"/);
  assert.match(ui, /dataKey="pivLive"[^\n]*strokeDasharray/);
});

test('圖表：最後已確認轉折 → 未確認極值畫成虛線，不放在實線裡', () => {
  const bars = makeBars(UP_5ABC);
  const r = E.analyze(bars);
  const m = ewChartModel(E.completedBars(bars), r, [{ series: 'wave', c: r.primary }], 'count');
  const pts = r.primary.points, n = pts.length;
  assert.equal(r.primary.waves.at(-1).inProgress, true);
  const row = (p) => m.rows[p.i - m.from];
  assert.equal(row(pts[n - 1]).wave, undefined);
  assert.equal(row(pts[n - 1]).waveLive, pts[n - 1].price);
  assert.equal(row(pts[n - 2]).wave, pts[n - 2].price);
  assert.equal(row(pts[n - 2]).waveLive, pts[n - 2].price);
  assert.equal(row(pts[n - 3]).waveLive, undefined);
  assert.match(ui, /dataKey="waveLive"[^\n]*strokeDasharray/);
  assert.match(ui, /dataKey="altLive"[^\n]*strokeDasharray/);
});

test('圖表時間窗：預設從計數第一浪起點往前留 25% 跨度（至少 60 根）；可切「2 年」看全部', () => {
  const bars = E.completedBars(makeBars(UP_5ABC, { prefix: 300, step: 30 }));
  const r = E.analyze(bars);
  const first = r.primary.points[0].i, span = bars.length - 1 - first;
  const m = ewChartModel(bars, r, [{ series: 'wave', c: r.primary }], 'count');
  assert.equal(m.from, Math.max(0, first - Math.max(60, Math.round(span * 0.25))));
  assert.ok(m.from > 0);
  assert.equal(ewChartModel(bars, r, [{ series: 'wave', c: r.primary }], 'all').from, 0);
  const short = E.completedBars(makeBars(UP_5ABC, { prefix: 300, step: 5 }));
  const rs = E.analyze(short);
  const ms = ewChartModel(short, rs, [{ series: 'wave', c: rs.primary }], 'count');
  assert.ok(rs.primary.points[0].i - ms.from >= 60, '至少留 60 根');
  assert.match(ui, /\[\["count", "計數區間"\], \["all", "2 年"\]\]/);
  assert.match(ui, /aria-pressed=\{range === k\}/);
});

test('浪名標籤：高點標上方、低點標下方，同側太近的只留較新的一個', () => {
  const bars = E.completedBars(makeBars(UP_5ABC, { prefix: 300, step: 4 }));
  const r = E.analyze(bars);
  const m = ewChartModel(bars, r, [{ series: 'wave', c: r.primary }], 'all', 290);
  assert.ok(m.minGap > 4, '2 年視窗下每段只有 4 根，必須篩');
  for (const a of m.labels) for (const b of m.labels) if (a !== b && a.series === b.series && a.side === b.side) assert.ok(Math.abs(a.i - b.i) >= m.minGap);
  assert.ok(m.labels.some((l) => l.text === 'C'), '最新的浪名一定保留');
  const wide = ewChartModel(bars, r, [{ series: 'wave', c: r.primary }], 'count', 290);
  assert.ok(wide.labels.length >= m.labels.length);
  const sides = Object.fromEntries(wide.labels.map((l) => [l.text, l.side]));
  if (sides['1']) assert.equal(sides['1'], 'above');
  if (sides['2']) assert.equal(sides['2'], 'below');
});

// ---------- 10. 卡片長度：細節預設收合 ----------
test('推敲細節預設收合（button＋aria-expanded，≥44px）；規則、比例、候選門檻都收在裡面，功能沒刪', () => {
  assert.match(ui, /const \[details, setDetails\] = useState\(false\);/);
  assert.match(ui, /aria-expanded=\{details\} aria-controls="ew-details"[^\n]*\n\s*className="forma-tap/);
  const inner = ui.slice(ui.indexOf('{details && ('), ui.indexOf('// </elliott-wave-ui>'));
  for (const t of ['規則檢查', '比例評分', '候選門檻', 'result.candidatesTried', 'shown.c.rules', 'shown.c.ratios', 'w.fib.r382', '為什麼是「']) assert.ok(inner.includes(t), t);
  const outer = ui.slice(0, ui.indexOf('{details && ('));
  for (const t of ['data-ew-status', 'data-ew-reason', 'LineChart', 'shown.c.waves.map', '失效價位與關卡', 'data-ew-scenarios']) assert.ok(outer.includes(t), t);
  assert.ok(ui.indexOf('data-ew-disclaimer') > ui.indexOf('{details && ('), '免責永遠顯示（在細節區塊外）');
  assert.doesNotMatch(outer.slice(outer.indexOf('{result?.ok && (')), /shown\.c\.rules\.map|shown\.c\.ratios\.map/);
});

// ---------- Codex 第 2 輪：無效非空資料、選取失效、天數文字、沒有候選 ----------
test('有效日K判斷：day 要是 YYYY-MM-DD、high／low／close 都是有限正數且 high ≥ low', () => {
  assert.equal(V.ewIsValidBar({ day: '2026-11-26', high: 10, low: 9, close: 9.5 }), true);
  assert.equal(V.ewIsValidBar({ day: '2026-11-26', high: '10', low: '9', close: '9.5' }), true);
  for (const b of [null, undefined, {}, 5, 'x', { day: '2026/11/26', high: 10, low: 9, close: 9 }, { day: 20261126, high: 10, low: 9, close: 9 },
    { day: '2026-11-26', high: 10, low: 9 }, { day: '2026-11-26', high: 10, low: 9, close: null }, { day: '2026-11-26', high: 10, low: 9, close: '' },
    { day: '2026-11-26', high: NaN, low: 9, close: 9 }, { day: '2026-11-26', high: Infinity, low: 9, close: 9 }, { day: '2026-11-26', high: 10, low: 0, close: 5 },
    { day: '2026-11-26', high: -1, low: -2, close: -1 }, { day: '2026-11-26', high: 9, low: 10, close: 9.5 }]) assert.equal(V.ewIsValidBar(b), false, JSON.stringify(b));
  assert.equal(V.ewValidBarCount([null, {}, { day: '2026-11-26', high: 10, low: 9, close: 9.5 }]), 1);
  assert.equal(V.ewValidBarCount([null]), 0);
  assert.equal(V.ewValidBarCount('x'), 0);
});

const INVALID_SETS = { TAIEX: [null], '0050': [{}], '0056': [{ day: 'bad', high: 1, low: 1, close: 1 }, { day: '2026-11-20', high: -1, low: -2, close: -1 }, { day: '2026-11-21', high: NaN, low: 1, close: 1 }] };

test('載入：同階段快取非空但全是無效日K（[null]、[{}]、全壞）→ 不當成功，照樣去抓', async () => {
  const cache = { key: ewPhaseKey({ day: '2026-11-27', minute: 600 }) + '|x', bars: INVALID_SETS };
  const h = harness({ cache });
  h.s.open();
  await flush();
  assert.deepEqual(h.fetches, [SYMS]);
  assert.equal(h.last().status, 'ready');
  assert.deepEqual(h.last().failed, []);
  for (const s of SYMS) assert.ok(V.ewValidBarCount(h.last().bars[s]) > 0);
});

test('載入：API 回非空但無效的日K → 算缺漏（可重試）；重試時略過那份無效快取、只補抓缺的', async () => {
  const cache = { key: ewPhaseKey({ day: '2026-11-27', minute: 600 }) + '|x', bars: INVALID_SETS };
  let mode = 'bad';
  const h = harness({ cache, fetchImpl: (want) => Promise.resolve(mode === 'bad' ? { ...goodBars(want.filter((s) => s === 'TAIEX')), '0050': [null], '0056': [{}] } : goodBars(want)) });
  h.s.open();
  await flush();
  assert.equal(h.last().status, 'ready');
  assert.deepEqual(h.last().failed, ['0050', '0056']);
  assert.equal(h.last().bars['0050'], undefined);
  assert.equal(V.ewSymbolStatus(h.last(), '0050'), 'missing');
  assert.equal(V.ewSymbolStatus(h.last(), 'TAIEX'), 'ready');
  // 同階段 check 不自動重抓；重試會再讀一次快取，但快取還是無效 → 略過，照樣 fetch 缺的
  h.s.check();
  await flush();
  assert.equal(h.fetches.length, 1);
  mode = 'ok';
  h.s.retry();
  await flush();
  assert.equal(h.cacheReads, 2);
  assert.deepEqual(h.fetches, [SYMS, ['0050', '0056']]);
  assert.deepEqual(h.last().failed, []);
  assert.equal(V.ewSymbolStatus(h.last(), '0050'), 'ready');
  // 全部標的都只拿到無效資料 → error（不是 ready）
  const h2 = harness({ fetchImpl: () => Promise.resolve(INVALID_SETS) });
  h2.s.open();
  await flush();
  assert.equal(h2.last().status, 'error');
  assert.deepEqual(h2.last().failed, SYMS);
  assert.equal(V.ewSymbolStatus(h2.last(), 'TAIEX'), 'missing');
});

// fixture 般的兩份結果：舊的（11/23）有主要＋2 個替代，新的（11/24）只剩 1 個替代
const fxCount = (id, t, day, text) => ({ id, thresholdPct: t, text, valid: true, points: [{ i: 0, day, price: 1 }], waves: [], rules: [], ratios: [] });
const FX_OLD = { ok: true, primary: fxCount('ABC12', 8, '2026-10-06', '主要'), alternatives: [fxCount('ABC1', 10, '2026-10-06', '替代甲'), fxCount('I5A', 5, '2026-06-03', '替代乙')] };
const FX_NEW = { ok: true, primary: fxCount('ABC12', 8, '2026-10-06', '主要'), alternatives: [fxCount('I5A', 5, '2026-06-03', '替代乙')] };
const FX_NEW_ONE = { ok: true, primary: fxCount('ABC12', 8, '2026-10-06', '主要'), alternatives: [fxCount('ABC1', 10, '2026-10-06', '替代甲')] };
const FX_NONE = { ok: true, primary: null, alternatives: [] };

test('選取解析：資料更新後選的替代不存在 → 回主要計數，並標 stale 讓元件把 state 改回預設', () => {
  // 舊資料選「替代 2」
  const old = V.resolveElliottView(FX_OLD, null);
  assert.equal(old.sel, 0);
  assert.equal(old.entries.length, 3);
  const pick = old.entries[2].key;
  const before = V.resolveElliottView(FX_OLD, pick);
  assert.equal(before.sel, 2);
  assert.equal(before.shown.c.text, '替代乙');
  assert.equal(before.stale, false);
  // 換日：新資料只剩 1 個替代，而且原本的「替代甲」不在了
  const gone = V.resolveElliottView(FX_NEW_ONE, pick);
  assert.equal(gone.stale, true);
  assert.equal(gone.sel, 0);
  assert.equal(gone.shown.role, 'primary');
  assert.ok(gone.shown.c.waves, '逐浪資料不能消失');
  // 同一個計數在新資料換了位置（替代 2 → 替代 1）→ 選取跟著它，不跳掉
  const moved = V.resolveElliottView(FX_NEW, pick);
  assert.equal(moved.stale, false);
  assert.equal(moved.sel, 1);
  assert.equal(moved.shown.label, '替代 1');
  assert.equal(moved.shown.c.text, '替代乙');
  // 沒有主要計數 → 回「只看轉折」
  const none = V.resolveElliottView(FX_NONE, pick);
  assert.equal(none.stale, true);
  assert.equal(none.sel, -1);
  assert.equal(none.shown, null);
  assert.equal(none.pivotsOnly, true);
  // 「只看轉折」只在沒有主要時有效；有主要了就回主要
  assert.equal(V.resolveElliottView(FX_NONE, V.EW_PIVOTS_ONLY).stale, false);
  const pv = V.resolveElliottView(FX_OLD, V.EW_PIVOTS_ONLY);
  assert.equal(pv.stale, true);
  assert.equal(pv.sel, 0);
  // 資料不足或還沒算 → 沒有任何選取
  assert.deepEqual(V.resolveElliottView(null, pick).entries, []);
  assert.equal(V.resolveElliottView({ ok: false }, null).shown, null);
});

test('選取解析：模擬元件跨兩次資料更新（state 依 stale 修正後，之後的更新維持預設）', () => {
  let view = null;
  const render = (result) => { const r = V.resolveElliottView(result, view); if (r.stale) view = null; return r; };
  render(FX_OLD);
  view = V.ewEntries(FX_OLD)[2].key; // 使用者點「替代 2」
  assert.equal(render(FX_OLD).shown.c.text, '替代乙');
  const r1 = render(FX_NEW_ONE); // 換日：替代 2 不見了
  assert.equal(r1.shown.role, 'primary');
  assert.equal(view, null);
  const r2 = render(FX_OLD); // 再更新回有 2 個替代：維持預設主要，不會又跳回替代
  assert.equal(r2.sel, 0);
  // 元件有用 resolveElliottView，並在 stale 時把 view 改回 null；按鈕用 key 不用索引
  assert.match(ui, /const \{ entries, sel, shown, stale \} = resolveElliottView\(result, view\);/);
  assert.match(ui, /useEffect\(\(\) => \{ if \(stale\) setView\(null\); \}, \[stale\]\);/);
  assert.match(ui, /onClick=\{\(\) => setView\(e\.key\)\}/);
  assert.doesNotMatch(ui, /entries\[view\]|setView\(k\)/);
});

test('每浪天數：精簡表寫「交易日／日曆天」，推敲細節列完整起訖年月日', () => {
  const w = { label: 'A', inProgress: false, start: { day: '2026-10-06', price: 49969 }, end: { day: '2026-11-06', price: 37837 }, tradingDays: 20, calendarDays: 31 };
  assert.equal(V.ewSpanText(w), '20 交易日／31 天');
  assert.equal(V.ewWaveDatesText(w), 'A：2026-10-06 → 2026-11-06（20 交易日／31 天）');
  assert.equal(V.ewWaveDatesText({ ...w, label: '2', inProgress: true }), '2＊：2026-10-06 → 2026-11-06（20 交易日／31 天）');
  // 跨年：完整日期分得出年份
  const r = E.analyze(makeBars(UP_5ABC, { start: '2025-11-03', step: 12 }));
  const cross = r.primary.waves.find((x) => x.start.day.slice(0, 4) !== x.end.day.slice(0, 4)) || r.primary.waves[0];
  assert.match(V.ewWaveDatesText(cross), /^\S+：\d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}（\d+ 交易日／\d+ 天）$/);
  for (const x of r.primary.waves) assert.ok(x.calendarDays >= x.tradingDays, '日曆天不少於交易日');
  // 畫面接線：精簡表用 ewSpanText（不再只寫「N日」），推敲細節有完整日期
  assert.match(ui, /data-ew-span[^>]*>\{ewSpanText\(w\)\}<\/span>/);
  assert.doesNotMatch(ui, /\{w\.tradingDays\}日/);
  assert.match(ui, /data-ew-wave-dates[\s\S]{0,300}ewWaveDatesText\(w\)/);
});

test('每浪精簡表在 320px 不左右超出：每個不換行的片段都放得下，片段之間可以換行', () => {
  // 估寬：11px 等寬字，ASCII 約 0.62em、全形約 1em。320px 螢幕扣掉卡片與表格內距、右側漲跌幅後，左欄至少約 180px。
  const est = (t) => [...t].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 || /[＊→／]/.test(ch) ? 11 : 6.9), 0);
  const worst = { label: '5', inProgress: true, start: { day: '2026-12-29' }, end: { day: '2027-12-31', price: 99999 }, tradingDays: 999, calendarDays: 1999 };
  const piece1 = `${worst.label}＊ 12/29→12/31 ${(99999).toLocaleString('en-US')}`;
  assert.ok(est(piece1) <= 180, `日期價格片段 ${est(piece1)}px`);
  assert.ok(est(V.ewSpanText(worst)) <= 180, `天數片段 ${est(V.ewSpanText(worst))}px`);
  // 兩個片段各自 whitespace-nowrap、中間有空白可換行；外層 min-w-0、沒有固定寬度
  const row = ui.slice(ui.indexOf('data-ew-wave-row'), ui.indexOf('data-ew-wave-row') + 600);
  assert.equal((row.match(/whitespace-nowrap/g) || []).length, 2);
  assert.match(row, /<\/span>\{" "\}\s*<span className="whitespace-nowrap" data-ew-span/);
  assert.doesNotMatch(row, /w-\[\d+px\]|width:\s*\d/);
});

test('沒有候選（100 根同價）→ 不確定＋轉折不足，不說成違反硬性規則', () => {
  const days = tradingDays('2025-01-06', 100);
  const r = E.analyze(days.map((day) => ({ day, high: 100, low: 100, close: 100 })));
  assert.equal(r.ok, true);
  assert.equal(r.status, 'uncertain');
  assert.equal(r.noCandidates, true);
  assert.equal(r.primary, null);
  assert.deepEqual(r.alternatives, []);
  assert.deepEqual(r.rejected, []);
  assert.match(r.uncertainReasons[0], /轉折不足/);
  assert.ok(r.uncertainReasons.every((t) => !t.includes('硬性規則')));
  assert.match(V.ewHeadline(r), /轉折太少/);
  assert.equal(V.resolveElliottView(r, null).sel, -1);
});

test('沒有候選（振幅低於所有候選門檻）→ 不確定＋轉折不足；有候選但全被淘汰才是計數不成立', () => {
  const days = tradingDays('2025-01-06', 200);
  // ±1% 的小波動，最小門檻 3% 下也形成不了任何轉折
  const bars = days.map((day, i) => { const c = 100 * (1 + 0.01 * Math.sin(i / 4)); return { day, high: c * 1.001, low: c * 0.999, close: c }; });
  const r = E.analyze(bars);
  assert.equal(r.status, 'uncertain');
  assert.equal(r.statusText, '不確定');
  assert.equal(r.noCandidates, true);
  assert.ok(r.candidatesTried.every((t) => t.validCounts === 0 && t.pivots < 2));
  assert.match(r.uncertainReasons[0], /轉折不足.*最小 3%/);
  // 對照：有候選但都違反規則 → invalid，noCandidates=false
  const bad = E.analyze(makeBars([100, 106, 94, 112, 88, 118, 82, 124, 76], { prefix: 30 }), { thresholds: [5] });
  assert.equal(bad.status, 'invalid');
  assert.equal(bad.noCandidates, false);
  assert.match(V.ewHeadline(bad), /沒有符合硬性規則/);
  // 有主要計數時 noCandidates 也明確是 false
  assert.equal(E.analyze(makeBars(UP_5ABC)).noCandidates, false);
});
