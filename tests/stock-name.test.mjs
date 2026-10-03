import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, pickStockName } from '../functions/stock-name.js';

// /stock-name 給「新增持股標的」表單用：輸入代號後帶出名稱。
// 這裡用假的 fetch / Cache API，驗證解析、快取與錯誤處理，不碰真正的證交所。

function installFakes({ twse }) {
  const calls = { fetch: [], put: [] };
  const store = new Map();
  const realFetch = globalThis.fetch;
  const realCaches = globalThis.caches;
  globalThis.fetch = async (url) => {
    calls.fetch.push(String(url));
    return twse(String(url));
  };
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(req.url);
        return hit ? new Response(hit.body, { headers: hit.headers }) : undefined;
      },
      async put(req, res) {
        calls.put.push({ url: req.url, cacheControl: res.headers.get('cache-control') });
        store.set(req.url, { body: await res.text(), headers: [...res.headers] });
      },
    },
  };
  return { calls, restore() { globalThis.fetch = realFetch; globalThis.caches = realCaches; } };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const get = (qs) => onRequestGet({ request: new Request(`https://app.example/stock-name${qs}`) });

test('returns the short name for a listed stock and queries both tse and otc', async () => {
  const f = installFakes({ twse: () => json({ msgArray: [{ c: '0056', n: '元大高股息', nf: '元大台灣高股息基金', ex: 'tse' }] }) });
  try {
    const res = await get('?symbol=0056');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, found: true, symbol: '0056', name: '元大高股息', market: 'tse' });
    assert.equal(f.calls.fetch.length, 1);
    const q = decodeURIComponent(new URL(f.calls.fetch[0]).searchParams.get('ex_ch'));
    assert.equal(q, 'tse_0056.tw|otc_0056.tw');
  } finally { f.restore(); }
});

test('finds an OTC (上櫃) stock and normalises a lowercase code', async () => {
  const f = installFakes({ twse: () => json({ msgArray: [{ c: '00937B', n: '群益ESG投等債20+', ex: 'otc' }] }) });
  try {
    const body = await (await get('?symbol=00937b')).json();
    assert.equal(body.symbol, '00937B');
    assert.equal(body.name, '群益ESG投等債20+');
    assert.equal(body.market, 'otc');
  } finally { f.restore(); }
});

test('an unknown code is found:false (ok, not an error) and cached only briefly', async () => {
  const f = installFakes({ twse: () => json({ msgArray: [] }) });
  try {
    const res = await get('?symbol=9999');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, found: false, symbol: '9999' });
    assert.equal(f.calls.put.length, 1);
    assert.match(f.calls.put[0].cacheControl, /max-age=600$/);
  } finally { f.restore(); }
});

test('rows for another code or with an empty name are ignored', () => {
  assert.equal(pickStockName([{ c: '2330', n: '台積電', ex: 'tse' }], '0056'), null);
  assert.equal(pickStockName([{ c: '0056', n: '  ', ex: 'tse' }], '0056'), null);
  assert.equal(pickStockName([{ c: '0056', ex: 'tse' }], '0056'), null);
  assert.equal(pickStockName(undefined, '0056'), null);
  assert.deepEqual(pickStockName([{ c: '2330', n: 'x' }, { c: '0056', n: '元大高股息', ex: 'tse' }], '0056'), { name: '元大高股息', market: 'tse' });
});

test('names are stripped of control characters and capped in length', () => {
  const picked = pickStockName([{ c: '0056', n: '元大\n高\u0000股息' + 'あ'.repeat(80), ex: 'tse' }], '0056');
  assert.ok(!/[\u0000-\u001f]/.test(picked.name));
  assert.ok(picked.name.length <= 40);
  assert.ok(picked.name.startsWith('元大高股息'));
});

test('a found name is cached for a week and the second request does not hit TWSE', async () => {
  const f = installFakes({ twse: () => json({ msgArray: [{ c: '2330', n: '台積電', ex: 'tse' }] }) });
  try {
    await get('?symbol=2330');
    assert.match(f.calls.put[0].cacheControl, /max-age=604800$/);
    const second = await (await get('?symbol=2330')).json();
    assert.equal(second.name, '台積電');
    assert.equal(f.calls.fetch.length, 1, 'second lookup must come from the edge cache');
  } finally { f.restore(); }
});

test('upstream failures return 502 and are never cached (so a retry can succeed)', async () => {
  for (const twse of [
    () => { throw new Error('network down'); },
    () => new Response('nope', { status: 503 }),
    () => json({ unexpected: true }),
  ]) {
    const f = installFakes({ twse });
    try {
      const res = await get('?symbol=0056');
      assert.equal(res.status, 502);
      assert.equal((await res.json()).ok, false);
      assert.equal(f.calls.put.length, 0, 'an upstream error must not be cached as "not found"');
    } finally { f.restore(); }
  }
});

test('invalid symbols are rejected with 400 before any upstream request', async () => {
  const f = installFakes({ twse: () => json({ msgArray: [] }) });
  try {
    for (const bad of ['', '?symbol=', '?symbol=ABC', '?symbol=12', '?symbol=AAPL', '?symbol=0056;DROP', '?symbol=00000000', '?symbol=0056%7Ctse_2330.tw']) {
      const res = await get(bad);
      assert.equal(res.status, 400, `expected 400 for ${bad}`);
    }
    assert.equal(f.calls.fetch.length, 0);
  } finally { f.restore(); }
});
