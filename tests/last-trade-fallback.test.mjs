// 證交所快照沒有最近成交價（z 是 "-"）時：用今天最後看到的真實成交價，再不行用今天開盤價；不做平均、不拿昨收冒充。
// 2026-10-27：拿掉買賣中間價後，0050／2330 盤中變成「昨收＋待更新」、分 K 也斷掉，這是修正。
import test from 'node:test';
import assert from 'node:assert/strict';
import { fillTwseFromLastTrades } from '../functions/quote.js';

const day = '2026-10-27';
const at = '2026-10-27T01:10:05.000Z';
const mem = () => { const m = new Map(); return { m, store: { read: async (s, d) => m.get(d + s) || null, write: async (s, d, v) => { m.set(d + s, v); } } }; };

test('a real last trade is remembered, then reused when the next snapshot has no trade price', async () => {
  const { store } = mem();
  await fillTwseFromLastTrades({ '0050': { source: 'TWSE', price: 107.15, priceSource: 'last', asOfDate: at, prevClose: 106.9 } }, day, store, () => true);
  const q = { '0050': { source: 'TWSE', price: null, priceSource: null, isStale: true, asOfDate: '2026-10-27T01:11:00.000Z', prevClose: 106.9, open: 107.0 } };
  await fillTwseFromLastTrades(q, day, store, () => true);
  assert.equal(q['0050'].price, 107.15);
  assert.equal(q['0050'].priceSource, 'last-seen');
  assert.equal(q['0050'].isStale, false);
});

test('no trade seen yet today: use today\'s opening price (an actual trade), never the previous close', async () => {
  const { store } = mem();
  const q = { '2330': { source: 'TWSE', price: null, isStale: true, asOfDate: at, prevClose: 2385, open: 2395 } };
  await fillTwseFromLastTrades(q, day, store, () => true);
  assert.equal(q['2330'].price, 2395);
  assert.equal(q['2330'].priceSource, 'open');
});

test('yesterday\'s snapshot or a missing time outside trading hours is left alone', async () => {
  const { store } = mem();
  const q = { a: { source: 'TWSE', price: null, isStale: true, asOfDate: '2026-10-26T05:30:00.000Z', open: 10 }, b: { source: 'TWSE', price: null, isStale: true, asOfDate: null, open: 10 } };
  await fillTwseFromLastTrades(q, day, store, () => false);
  assert.equal(q.a.price, null);
  assert.equal(q.b.price, null);
});

test('a snapshot without a time during trading hours still gets the last trade', async () => {
  const { store, m } = mem();
  m.set(day + '0056', { price: 56.75, asOfDate: at });
  const q = { '0056': { source: 'TWSE', price: null, isStale: true, asOfDate: null } };
  await fillTwseFromLastTrades(q, day, store, () => true);
  assert.equal(q['0056'].price, 56.75);
  assert.ok(q['0056'].asOfDate);
});

test('the new nested trade field from the exchange is the real last trade (real 2026-10-27 snapshot)', async () => {
  const { parseTwseItem } = await import('../functions/quote.js');
  const item = { c: '0050', z: '-', pz: '-', tv: '-', v: '25407', b: '107.1500_107.1000_', a: '107.2000_107.2500_', o: '107.1000', h: '107.5500', l: '106.8000', y: '106.9000', tlong: '1793063889000', trade: { t: '09:17:19', v: 1, z: '107.2500', ft: 20 } };
  const q = parseTwseItem(item);
  assert.equal(q.price, 107.25);
  assert.equal(q.priceSource, 'last');
  assert.equal(q.lastTradeAt, '09:17:19');
  // 沒有 trade、也沒有 z／pz：不平均買賣價，留給後面的備援
  const none = parseTwseItem({ ...item, trade: undefined });
  assert.equal(none.price, null);
  // 大盤仍走 z
  assert.equal(parseTwseItem({ c: 't00', z: '46343.28', y: '46041.43', tlong: '1793063890000' }).price, 46343.28);
});
