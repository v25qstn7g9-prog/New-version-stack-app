import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';

// 自主學習：從已驗證紀錄學，從手調模型出發做小幅修正；依日期往前走驗證；樣本外贏了才啟用。
const html = readAppSource();
const block = html.match(/\/\/ <self-learn>([\s\S]*?)\/\/ <\/self-learn>/)?.[1];
assert.ok(block, 'self-learn block must exist');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(block + '\nthis.api={learnVector,learnFit,learnPredict,learnRows,learnWalkForward,trainSelfLearn,learnRecFromRow};', ctx);
const { learnVector, learnFit, learnPredict, learnRows, learnWalkForward, trainSelfLearn, learnRecFromRow } = ctx.api;
const plain = (v) => JSON.parse(JSON.stringify(v));

let seed = 11; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / 0.7071; };
const dayStr = (i) => new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);

// 手調模型 raw 只看 stockPct；真正的訊號在 vwapDist（手調模型沒用到）。
function makeRecords({ days, perDay = 3, signal }) {
  const out = [];
  for (let d = 0; d < days; d++) for (let k = 0; k < perDay; k++) {
    const stockPct = gauss() * 0.8, vwapDist = gauss() * 0.6, kdDaily = gauss() * 20;
    const raw = Math.round(Math.max(25, Math.min(75, 50 + stockPct * 6)));
    const z = signal ? 1.6 * vwapDist : 0;
    const up = rnd() < 1 / (1 + Math.exp(-z));
    out.push({
      key: `${dayStr(d)}|S${k}|morning`, day: dayStr(d), symbol: `S${k}`, phase: 'morning', modelVersion: 'M',
      rawProbability: raw, probability: raw, direction: '稍偏漲', stockPct, indexPct: stockPct * 0.5, newsScore: 0, instLoaded: true,
      inst: { f1: 1, f3: -1, f5: 1, t1: 0, t3: 0, t5: 0 }, kd: { kDaily: kdDaily, dDaily: 0 }, timedKdScore: 0,
      volumePrice: { distPct: vwapDist, rvol: 1 }, breadthPrev: { breadth: 0.5 },
      actual: { pct: up ? 0.5 : -0.5, up },
    });
  }
  return out;
}

test('under 60 verified records it only collects', () => {
  const s = trainSelfLearn(makeRecords({ days: 15, perDay: 3, signal: true }), null, { modelVersion: 'M', today: '2026-10-14' });
  assert.equal(s.morning.active, false);
  assert.equal(s.morning.reason, 'collecting');
  assert.equal(s.morning.n, 45);
  assert.equal(s.closeLock.reason, 'collecting');
});

test('a real signal the hand-tuned model ignores: learner beats it out-of-sample and switches on', () => {
  const s = trainSelfLearn(makeRecords({ days: 120, signal: true }), null, { modelVersion: 'M', today: '2026-10-14' });
  const m = s.morning;
  assert.equal(m.active, true, JSON.stringify({ ...m, model: undefined }));
  assert.ok(m.evalN >= 30);
  assert.ok(m.brierLearned < m.brierModel * 0.97);
  assert.equal(m.since, '2026-10-14');
  // 啟用後即時預測：同樣的 raw，vwap 在均價上方 → 比手調模型更看漲
  const rec = (v) => ({ stockPct: 0, indexPct: 0, newsScore: 0, instLoaded: true, inst: { f1: 1, f3: -1, f5: 1, t1: 0, t3: 0, t5: 0 }, kd: { kDaily: 0, dDaily: 0 }, timedKdScore: 0, volumePrice: { distPct: v, rvol: 1 }, breadthPrev: { breadth: 0.5 } });
  assert.ok(learnPredict(m.model, rec(1.2), 50) > learnPredict(m.model, rec(-1.2), 50) + 10);
  assert.ok(learnPredict(m.model, rec(9), 50) <= 75 && learnPredict(m.model, rec(-9), 50) >= 25, 'same 25–75 display range as the hand-tuned model');
});

test('pure noise: it never takes over (and stays close to the hand-tuned model if it did)', () => {
  let activated = 0;
  for (let t = 0; t < 8; t++) {
    const s = trainSelfLearn(makeRecords({ days: 120, signal: false }), null, { modelVersion: 'M', today: '2026-10-14' });
    if (s.morning.active) activated++;
    assert.ok(['not-better', 'validating'].includes(s.morning.reason) || s.morning.active);
  }
  assert.ok(activated <= 1, `noise should almost never switch it on (${activated}/8)`);
});

test('ridge shrinkage: with little data the fit stays near the hand-tuned model', () => {
  const rows = learnRows(makeRecords({ days: 14, signal: true }), { phase: 'morning', modelVersion: 'M' }).slice(0, 12);
  const m = learnFit(rows);
  const rec = { stockPct: 0, indexPct: 0, newsScore: 0, instLoaded: true, inst: { f1: 1, f3: -1, f5: 1, t1: 0, t3: 0, t5: 0 }, kd: { kDaily: 0, dDaily: 0 }, timedKdScore: 0, volumePrice: { distPct: 0.3, rvol: 1 }, breadthPrev: { breadth: 0.5 } };
  for (const raw of [35, 50, 62]) assert.ok(Math.abs(learnPredict(m, rec, raw) - raw) <= 8, `raw ${raw} → ${learnPredict(m, rec, raw)}`);
});

test('walk-forward only trains on days before the day it predicts (no peeking)', () => {
  assert.match(block, /const train = rows\.filter\(\(r\) => r\.day < day\);/);
  const rows = learnRows(makeRecords({ days: 60, signal: true }), { phase: 'morning', modelVersion: 'M' });
  const a = learnWalkForward(rows);
  // 把最後一天的答案全部翻過來：只影響「最後一天」那幾筆的成績，更早的預測不會因此改變（樣本數相同、且仍然合理）
  const lastDay = rows[rows.length - 1].day;
  const flipped = rows.map((r) => (r.day === lastDay ? { ...r, y: 1 - r.y } : r));
  const b = learnWalkForward(flipped);
  assert.equal(a.evalN, b.evalN);
});

test('training excludes server-imported, TAIEX, other versions, flat days and rows without a hand-tuned output', () => {
  const base = makeRecords({ days: 2, perDay: 1, signal: true })[0];
  const recs = [
    base,
    { ...base, key: 'a', source: 'server' }, { ...base, key: 'b', symbol: 'TAIEX' }, { ...base, key: 'c', modelVersion: 'old' },
    { ...base, key: 'd', actual: { pct: 0 } }, { ...base, key: 'e', rawProbability: null }, { ...base, key: 'f', phase: 'closeLock' },
  ];
  assert.equal(learnRows(recs, { phase: 'morning', modelVersion: 'M' }).length, 1);
});

test('hysteresis: once on it stays on while it is not worse; the start date is kept', () => {
  const recs = makeRecords({ days: 120, signal: true });
  const first = trainSelfLearn(recs, null, { modelVersion: 'M', today: '2026-10-01' });
  assert.equal(first.morning.active, true);
  const again = trainSelfLearn(recs, first, { modelVersion: 'M', today: '2026-10-14' });
  assert.equal(again.morning.active, true);
  assert.equal(again.morning.since, '2026-10-01');
});

test('features: a stored record and a live radar row give the identical vector', () => {
  const rec = { stockPct: 0.4, indexPct: 0.2, newsScore: 1, instLoaded: true, inst: { f1: 5, f3: -2, f5: 3, t1: 1, t3: 0, t5: -1 }, kd: { k5: 60, d5: 50, k15: 55, d15: 52, k60: 40, d60: 45, kDaily: 70, dDaily: 60 }, timedKdScore: 1.5, volumePrice: { distPct: 0.3, rvol: 1.4 }, breadthPrev: { breadth: 0.42 } };
  const row = { indexPct: 0.2, stockPct: 0.4, newsScore: 1, f1: 5, f3: -2, f5: 3, t1: 1, t3: 0, t5: -1, kd5: { K: 60, D: 50 }, kd15: { K: 55, D: 52 }, kd60: { K: 40, D: 45 }, kdDaily: { K: 70, D: 60 }, timedKdScore: 1.5 };
  const live = learnRecFromRow(row, { prevBreadth: { breadth: 0.42 }, volumePriceRecord: { distPct: 0.3, rvol: 1.4 }, instLoaded: true });
  assert.deepEqual(plain(learnVector(live)), plain(learnVector(rec)));
  assert.equal(learnVector({ ...rec, instLoaded: false })[3], null, 'unloaded institutional data is missing, not a zero signal');
});

test('wired into the radar: learned prob replaces the hand-tuned one only when active; raw stays the training base', () => {
  assert.match(html, /const learnActive=Boolean\(learnSt\?\.active&&learnedP!=null\);\s*if\(learnActive\)probability=learnedP;/);
  assert.match(html, /memoSelfLearn=await loadKey\("selfLearn",null\)/);
  assert.ok(!/launchSlow\("selfLearn"/.test(html), 'read directly so the first snapshot already uses it');
  assert.match(html, /learn:learnedP!=null\?\{p:learnedP,active:learnActive\}:null/);
  assert.equal((html.match(/learn:r\.learn\|\|null,/g) || []).length, 2, 'records keep the shadow prediction');
  assert.match(html, /<SelfLearnLine state=\{learnState\} \/>/);
  assert.match(html, /runSelfLearn\(TREND_MODEL_VERSION\)/);
  assert.match(html, /dispatchEvent\(new CustomEvent\("selfLearnUpdated"/);
  assert.match(html, /addEventListener\("selfLearnUpdated", on\)/);
  // 訓練用的是 rawProbability（手調輸出），不是顯示用的 probability
  assert.match(block, /learnNum\(r\.rawProbability\) != null/);
  assert.match(block, /raw: Number\(r\.rawProbability\)/);
});
