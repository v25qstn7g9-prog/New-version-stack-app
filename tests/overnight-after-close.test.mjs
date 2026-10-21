// 台股 13:45 後停止自動查價，但隔夜指標（S&P500、費半、美元／台幣）不能一起被擋：
// 以前 13:45～半夜在沒有當天快取時會回「已停用自動查詢」，趨勢雷達的隔夜訊號與 AI 都讀不到美股收盤。
import test from 'node:test';
import assert from 'node:assert/strict';

const RealDate = Date;
let nowMs = 0;
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [nowMs])); } static now() { return nowMs; } };
globalThis.fetch = async (url) => {
  if (String(url).includes('finance/chart')) {
    return new Response(JSON.stringify({ chart: { result: [{ meta: {}, timestamp: [1760967000, 1761053400], indicators: { quote: [{ close: [7690.7, 7712.6] }] } }] } }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
const { onRequestGet } = await import('../functions/quote.js');
const ask = async (iso, symbols) => {
  nowMs = new RealDate(iso).getTime();
  const r = await onRequestGet({ request: new Request(`https://x/quote?symbols=${symbols}&force=0`), env: {}, waitUntil() {} });
  return r.json();
};

test('overnight indicators are readable after the Taiwan close, in the evening and the next morning', async () => {
  for (const t of ['2026-10-21T10:30:00+08:00', '2026-10-21T13:50:00+08:00', '2026-10-21T20:00:00+08:00', '2026-10-21T23:30:00+08:00', '2026-10-22T07:00:00+08:00']) {
    const j = await ask(t, 'SPX,SOX,USDTWD');
    assert.equal(j.ok, true, t + ' ' + (j.error || ''));
    assert.deepEqual(Object.keys(j.quotes).sort(), ['SOX', 'SPX', 'USDTWD'], t);
    assert.equal(j.quotes.SPX.isStale, false, t);
  }
});

test('Taiwan-only requests still stop after 13:45 (unchanged)', async () => {
  const j = await ask('2026-10-21T20:00:00+08:00', '0050');
  assert.equal(j.autoStopped, true);
});
