import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../api/stock-name.js';

function response() {
  return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code=code; return this; }, send(body) { this.body=JSON.parse(body); return this; }, json(body) { this.body=body; return this; } };
}
test('public name lookup routes to the native function before the Worker proxy', () => {
  const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
  assert.deepEqual(config.rewrites[0], {source:'/stock-name',destination:'/api/stock-name'});
});
test('Vercel adapter returns a US name through the shared lookup', async () => {
  const saved=globalThis.fetch;
  globalThis.fetch=async () => new Response(JSON.stringify({chart:{result:[{meta:{symbol:'AAPL',currency:'USD',shortName:'Apple Inc.'}}]}}));
  try {
    const res=response();
    await handler({method:'GET',url:'/stock-name?symbol=AAPL'},res);
    assert.equal(res.code,200);
    assert.equal(res.body.name,'Apple Inc.');
    assert.equal(res.body.market,'us');
    assert.match(res.headers['content-type'],/application\/json/);
  } finally { globalThis.fetch=saved; }
});
test('Vercel adapter rejects unsupported methods', async () => {
  const res=response();
  await handler({method:'POST',url:'/stock-name?symbol=AAPL'},res);
  assert.equal(res.code,405);
  assert.equal(res.headers.Allow,'GET');
});
