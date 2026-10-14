import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/quote.js';

// 台股開盤時間（尤其 13:25 鎖定明日預測）查 SPX / SOX / USDTWD：
// 這三個是「上一個已收盤交易日」的日線，以前被標成 isStale:true，
// App 的隔夜訊號因此全部丟掉，明日預測紀錄裡 S&P500／費半／美元台幣永遠是空的（n=0），只有台指近月有值。
globalThis.caches = { default: { match: async () => null, put: async () => {} } };

function chart(closes, lastTs) {
  const timestamp = closes.map((_, i) => lastTs - (closes.length - 1 - i) * 86400);
  return { chart: { result: [{ timestamp, indicators: { quote: [{ close: closes }] } }] } };
}

test('SPX / SOX / USDTWD are not stale while TWSE is open, and still carry asOfDate for the app freshness check', async (t) => {
  const real = globalThis.fetch;
  const lastTs = Date.parse('2026-10-12T13:30:00Z') / 1000; // 美股週一收盤那根日線
  globalThis.fetch = async (url) => {
    if (/query1\.finance\.yahoo\.com/.test(String(url))) return Response.json(chart([100, 101, 102.5], lastTs));
    return new Response('offline', { status: 503 });
  };
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-13T05:25:00Z') }); // 週二 13:25 台北
  try {
    const res = await onRequestGet({ request: new Request('https://x.test/quote?symbols=SPX,SOX,USDTWD&force=1'), env: {} });
    const body = await res.json();
    for (const s of ['SPX', 'SOX', 'USDTWD']) {
      const q = body.quotes[s];
      assert.ok(q, s + ' present');
      assert.equal(q.isStale, false, s + ' must not be stale just because TWSE is open');
      assert.equal(q.prevClose, 101);
      assert.equal(q.price, 102.5);
      assert.ok(Date.parse(q.asOfDate) > 0);
    }
  } finally { globalThis.fetch = real; }
});
