import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/intraday-bars.js';

// /intraday-bars：App 打開時補匯入伺服器代收的分 K。只讀 KV，要擋掉亂參數。
const kvWith = (entries) => ({ get: async (k) => entries[k] ?? null, put: async () => {}, list: async () => ({ keys: [] }) });
const call = (qs, env) => onRequestGet({ request: new Request(`https://x.test/intraday-bars?${qs}`), env });

test('/intraday-bars returns the recorded bars for the requested symbols and day', async () => {
  const env = { health_kv: kvWith({ 'intraday:2026-10-01': JSON.stringify({ v: 1, day: '2026-10-01', bars: {
    '2330': [['09:00', 1000, 1002, 999, 1001, 4], ['09:01', 1001, 1003, 1000, 1002, 4]],
    'TAIEX': [['09:00', 20000, 20010, 19990, 20005, 4]],
  } }) }) };
  const res = await call('date=2026-10-01&symbols=2330,taiex,9999&interval=5', env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.found, true);
  assert.deepEqual(Object.keys(body.bars).sort(), ['2330', 'TAIEX']);
  assert.equal(body.bars['2330'][0].open, 1000);
  assert.equal(body.bars['2330'][0].close, 1002);
  assert.deepEqual(body.missing, ['9999']);
  assert.match(res.headers.get('cache-control'), /max-age=300/); // 過去的日子可短暫快取
});

test('/intraday-bars says found:false (never invents bars) when the day has no record', async () => {
  const res = await call('date=2026-10-01&symbols=2330', { health_kv: kvWith({}) });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.found, false);
});

test('/intraday-bars rejects malformed or oversized requests', async () => {
  const env = { health_kv: kvWith({}) };
  assert.equal((await call('symbols=2330', env)).status, 400);                       // 缺 date
  assert.equal((await call('date=10-01&symbols=2330', env)).status, 400);            // date 格式
  assert.equal((await call('date=2026-10-01', env)).status, 400);                    // 缺 symbols
  assert.equal((await call('date=2026-10-01&symbols=23%2030', env)).status, 400);    // 代號格式
  assert.equal((await call('date=2026-10-01&symbols=2330&interval=7', env)).status, 400); // interval
  const many = Array.from({ length: 40 }, (_, i) => `${1000 + i}`).join(',');
  assert.equal((await call(`date=2026-10-01&symbols=${many}`, env)).status, 400);    // 太多
});
