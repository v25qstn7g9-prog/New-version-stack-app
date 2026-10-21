import test from 'node:test';
import assert from 'node:assert/strict';
import { factorCollectionStatus } from '../functions/factor-status.js';

// 因子收集狀態：從同步快照算每天收了幾筆、各因子有幾筆有值（唯讀）。
const full = (day, phase, sym) => ({
  key: `${day}|${phase}|${sym}`, day, phase, symbol: sym, actual: { pct: 0.3 }, indexPct: 0.5, stockPct: 0.2, newsScore: 1, instLoaded: true,
  inst: { f1: 3 }, kd: { k5: 50, d5: 40, k15: 1, d15: 2, k60: 3, d60: 4, kDaily: 5, dDaily: 6, kMonthly: 7, dMonthly: 8 },
  volumePrice: { rvol: 1.1, distPct: 0.2 }, breadthPrev: { breadth: 0.6 }, margin: { chg1: 0.1 },
});

test('counts records per day and per factor, and lists factors that were never filled', () => {
  const recs = [full('2026-10-20', 'morning', '0050'), full('2026-10-20', 'closeLock', '0050'),
    { ...full('2026-10-21', 'morning', '0050'), instLoaded: false, volumePrice: null, global: null }];
  const tom = [{ key: '2026-10-22|0050', targetDay: '2026-10-22', predictedOn: '2026-10-21', phase: 'final', global: { spxPct: 0.2, soxPct: null, usdtwdPct: 0.1, txfPct: 1 }, factors: { overnight: 0.5, inst: 1, ks: 2 } }];
  const st = factorCollectionStatus({ syncedAt: 'x', dataset: { radarHistory: { records: recs }, tomorrowHistory: { records: tom } } });
  assert.equal(st.ok, true);
  assert.equal(st.lastIntradayDay, '2026-10-21');
  const d20 = st.intraday.find((d) => d.day === '2026-10-20'), d21 = st.intraday.find((d) => d.day === '2026-10-21');
  assert.deepEqual(d20.phases, { morning: 1, closeLock: 1 });
  assert.deepEqual(d20.missing, []);
  assert.deepEqual(d21.missing, ['法人', 'RVOL', 'VWAP'], 'instLoaded:false is not counted as institutional data');
  assert.equal(st.tomorrow[0].day, '2026-10-21');
  assert.deepEqual(st.tomorrow[0].missing, ['費半']);
});

test('old snapshots without a dataset report a reason instead of failing', () => {
  assert.equal(factorCollectionStatus({}).ok, false);
  assert.equal(factorCollectionStatus(null).ok, false);
});
