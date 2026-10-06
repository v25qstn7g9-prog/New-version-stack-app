import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as daily} from '../functions/daily-history.js';
import {onRequestGet as tx} from '../functions/taifex-tx.js';
const RealDate=Date;
function at(iso){globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[iso]));}static now(){return RealDate.parse(iso);}};}
test('daily history cache changes after close; carries split-adjusted closes and omits zero-volume phantom days',async()=>{
 const oldFetch=globalThis.fetch,oldCaches=globalThis.caches,keys=[];
 globalThis.caches={default:{match:async r=>{keys.push(r.url);return null;},put:async()=>{}}};
 globalThis.fetch=async()=>Response.json({chart:{result:[{timestamp:[RealDate.parse('2026-10-05T01:00:00Z')/1000,RealDate.parse('2026-10-06T01:00:00Z')/1000],indicators:{quote:[{open:[100,101],high:[101,102],low:[99,100],close:[100,101],volume:[100,0]}],adjclose:[{adjclose:[99,100]}]}}]}});
 try{
  at('2026-10-06T02:00:00Z');const first=await (await daily({request:new Request('https://test/daily-history?symbols=2330')})).json();
  at('2026-10-06T06:00:00Z');await daily({request:new Request('https://test/daily-history?symbols=2330')});
  assert.notEqual(keys[0],keys[1]);assert.equal(first.bars['2330'].length,1);assert.equal(first.bars['2330'][0].adjustedClose,99);
 }finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;globalThis.Date=RealDate;}
});
test('TAIFEX premarket retains last night session and never probes future sessions',async()=>{
 const old=globalThis.fetch,dates=[];
 globalThis.fetch=async(url,opts)=>{dates.push(opts.body.get('queryDate'));return new Response('<table><tr><td>TX</td><td>202610</td><td>20000</td><td>20200</td><td>19900</td><td>20100</td><td>100</td><td>0.5</td><td>1000</td></tr></table>');};
 try{
  at('2026-10-05T23:50:00Z');const body=await (await tx()).json();
  assert.equal(body.session,'after_hours');assert.equal(body.queryDate,'2026/10/06');assert.equal(body.quote.price,20100);
  assert.ok(dates.every(day=>day<='2026/10/06'));
 }finally{globalThis.fetch=old;globalThis.Date=RealDate;}
});
