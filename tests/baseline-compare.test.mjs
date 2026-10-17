import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 對照組：盤中模型 vs「跟著目前漲跌猜」，以及只看波動的影子機率模型（只記錄，不影響預測）。
const html = readAppSource();
const block = html.match(/\/\/ <baseline-compare>([\s\S]*?)\/\/ <\/baseline-compare>/)?.[1];
assert.ok(block);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(block + '\nthis.api={normCdf,dailySigma,volProbability,baselineStats};', ctx);
const { normCdf, dailySigma, volProbability, baselineStats } = ctx.api;

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1) - 0.8413447) < 1e-6);
  assert.ok(Math.abs(normCdf(-1.96) - 0.0249979) < 1e-6);
});

test('dailySigma: sample sd of daily % moves over ~60 sessions; null when too short', () => {
  const bars = Array.from({ length: 61 }, (_, i) => ({ day: `d${i}`, close: 100 * (i % 2 ? 1.01 : 1) }));
  const sd = dailySigma(bars);
  assert.ok(sd > 0.9 && sd < 1.1, String(sd));
  assert.equal(dailySigma(bars.slice(0, 10)), null);
});

test('volProbability: same +0.3% means little at 09:30 and a lot at 13:25 (台積電 σ≈1.9%)', () => {
  const morning = volProbability(0.3, 1.9, 570).p;   // 09:30
  const late = volProbability(0.3, 1.9, 805).p;      // 13:25
  assert.ok(morning >= 54 && morning <= 58, String(morning));
  assert.ok(late >= 85, String(late)); // 13:25 只剩 5 分鐘：+0.3% ≈ 88%
  assert.equal(volProbability(0, 1.9, 600).p, 50);
  assert.equal(volProbability(-0.3, 1.9, 805).p, 100 - late, "symmetric");
  assert.equal(volProbability(0.3, null, 600), null, 'no volatility data, no guess');
  // 低波動的 0056（σ≈1.5%）同樣 +0.5% 比台積電更有把握
  assert.ok(volProbability(0.5, 1.47, 600).p > volProbability(0.5, 1.91, 600).p);
});

const rec = (o) => ({ phase: 'morning', modelVersion: 'M', direction: '稍偏漲', ...o });
test('baselineStats compares the model and the simple rule on the same validated records', () => {
  const records = [
    rec({ symbol: '2330', probability: 60, stockPct: 0.5, actual: { pct: 1 } }),   // 模型對、規則對
    rec({ symbol: '2330', probability: 40, direction: '稍偏跌', stockPct: 0.2, actual: { pct: 0.4 } }), // 模型錯、規則對
    rec({ symbol: '0056', probability: 58, stockPct: -0.1, actual: { pct: 0.3 } }), // 模型對、規則錯
    rec({ symbol: 'TAIEX', probability: 56, indexPct: 0.3, actual: { pct: -0.2 } }), // 都錯（TAIEX 用 indexPct）
    rec({ symbol: '0050', probability: 50, direction: '方向不明', stockPct: 0.4, actual: { pct: 1 } }), // 模型沒表態 → 不比
    rec({ symbol: '0050', probability: 60, stockPct: 0, actual: { pct: 1 } }),     // 規則沒方向 → 不比
    rec({ symbol: '0050', probability: 60, stockPct: 0.2, actual: { pct: 0 } }),   // 平盤 → 不比
    rec({ symbol: '0050', probability: 60, stockPct: 0.2, actual: { pct: 1 }, modelVersion: 'old' }),
    rec({ symbol: '0050', stockPct: 0.2, actual: { pct: 1 }, source: 'server', probability: null }),
    rec({ symbol: '2330', phase: 'closeLock', probability: 60, stockPct: 0.5, actual: { pct: 1 } }),
  ];
  const s = baselineStats(records, { phase: 'morning', modelVersion: 'M' });
  assert.equal(s.n, 4);
  assert.equal(s.modelHits, 2);
  assert.equal(s.naiveHits, 2);
});

test('baselineStats: Brier of model vs shadow volatility model on records that carry it', () => {
  const records = Array.from({ length: 20 }, (_, i) => rec({ symbol: '2330', probability: 60, stockPct: 0.5, shadow: { p: 90 }, actual: { pct: i < 18 ? 1 : -1 } }));
  const s = baselineStats(records, { phase: 'morning', modelVersion: 'M' });
  assert.equal(s.brierN, 20);
  assert.ok(Math.abs(s.brierModel - (18 * 0.16 + 2 * 0.36) / 20) < 1e-9);
  assert.ok(Math.abs(s.brierVol - (18 * 0.01 + 2 * 0.81) / 20) < 1e-9);
  assert.ok(s.brierVol < s.brierModel);
});

test('the radar records the shadow probability (record-only) and shows the comparison under each hit rate', () => {
  assert.equal((html.match(/shadow:r\.shadowVol\|\|null,/g) || []).length, 2);
  assert.match(html, /shadowVol:volProbability\(stockPct,sigmaFor\(h\.symbol\),sessionClock\)/);
  assert.match(html, /shadow:volProbability\(indexPct,sigmaFor\("TAIEX"\),mins\)/);
  assert.match(html, /<BaselineLine stats=\{baseline\?\.morning\} \/>/);
  assert.match(html, /<BaselineLine stats=\{baseline\?\.closeLock\} \/>/);
  // 影子模型不能進到模型分數
  const scoreBlock = html.slice(html.indexOf('let score = Math.max(-16'), html.indexOf('const quoteFresh=F.quoteFresh(q,now);'));
  assert.ok(!/shadow|volProbability/.test(scoreBlock));
});
