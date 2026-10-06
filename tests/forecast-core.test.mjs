import test from 'node:test';
import assert from 'node:assert/strict';
import '../forecast-core.js';
const F=globalThis.ZinfForecast;
const now=new Date('2026-10-06T02:00:00Z');
const quote=(asOfDate)=>({price:101,prevClose:100,asOfDate,fetchedAt:now.toISOString()});
test('uses Taipei clock regardless of device timezone and skips official holidays',()=>{
 assert.deepEqual(F.clock(new Date('2026-10-05T23:50:00Z')),{day:'2026-10-06',minute:470,weekday:2});
 assert.equal(F.nextSession('2026-10-08',{'2026-10-09':true}),'2026-10-12');
});
test('fresh fetch cannot make yesterday or delayed source quotes fresh',()=>{
 assert.equal(F.quoteFresh(quote('2026-10-05T02:00:00Z'),now),false);
 assert.equal(F.quoteFresh(quote('2026-10-06T01:45:00Z'),now),false);
 assert.equal(F.quoteFresh(quote('2026-10-06T02:00:10Z'),now),false);
 assert.equal(F.quoteFresh(quote('2026-10-06T01:59:45Z'),now),true);
 assert.equal(F.quoteFresh({price:101,prevClose:100,fetchedAt:now.toISOString()},now),false);
});
test('closing validation rejects preclose, stale, unknown dates and flat returns',()=>{
 const after=new Date('2026-10-06T06:00:00Z');
 assert.equal(F.outcome(quote('2026-10-06T05:25:00Z'),'2026-10-06',after),null);
 assert.equal(F.outcome(quote('2026-10-05T05:30:00Z'),'2026-10-06',after),null);
 assert.equal(F.outcome({...quote('2026-10-06T05:30:00Z'),isStale:true},'2026-10-06',after),null);
 assert.equal(F.outcome(quote('2026-10-06T05:30:00Z'),'2026-10-06',after).pct,1);
 const flat=F.outcome({...quote('2026-10-06T05:30:00Z'),price:100},'2026-10-06',after);
 assert.equal(flat.up,null);
});
test('micro momentum needs real horizon coverage and excludes future or stale observations',()=>{
 const t=now.getTime(),point=(seconds,px)=>({day:'2026-10-06',ts:t-seconds*1000,quotes:{'2330':px}});
 assert.equal(F.micro([point(15,100),point(0,101)],'2330',101,now).available,false);
 const m=F.micro([point(480,100),point(180,101),point(60,102),point(0,103)],'2330',103,now);
 assert.equal(m.available,true);assert.ok(m.m8>m.m1);assert.equal(m.agreement,1);
 assert.equal(F.micro([point(500,100),point(400,101)],'2330',101,now).available,false);
});
test('stale volume metrics cannot be compared with today live prices',()=>{
 assert.equal(F.metricsFresh({day:'2026-10-05',lastMinute:600},now),false);
 assert.equal(F.metricsFresh({day:'2026-10-06',lastMinute:585},now),false);
 assert.equal(F.metricsFresh({day:'2026-10-06',lastMinute:599},now),true);
});
test('calibration uses only earlier, validated, matching model/horizon records; null and flat are excluded',()=>{
 const mk=i=>({symbol:'2330',phase:'morning',modelVersion:'new',day:`2026-09-${String(i%28+1).padStart(2,'0')}`,probability:65,actual:{pct:1,up:true,hit:true,closedAt:'2026-10-05T06:00:00Z'}});
 const records=Array.from({length:50},(_,i)=>mk(i));
 const c=F.calibrate(65,records,{symbol:'2330',phase:'morning',modelVersion:'new',beforeDay:'2026-10-06'});
 assert.equal(c.n,50);assert.equal(c.calibrated,true);assert.ok(c.probability>65);
 for(const change of [{modelVersion:'old'},{day:'2026-10-06'},{actual:{pct:null}},{actual:{pct:0,up:null}},{phase:'closeLock'},{lateCreated:true}]){
  assert.equal(F.calibrate(65,records.map(r=>({...r,...change})),{symbol:'2330',phase:'morning',modelVersion:'new',beforeDay:'2026-10-06'}).n,0);
 }
});
test('price bands use only completed prior bars; forward bars do not leak into estimate',()=>{
 const bars=Array.from({length:80},(_,i)=>({day:new Date(Date.UTC(2026,5,1+i)).toISOString().slice(0,10),close:100+Math.sin(i)*2,high:103,low:97}));
 const a=F.priceBand(bars,101,{beforeDay:'2026-10-06',remainingMinutes:270});
 const b=F.priceBand([...bars,{day:'2026-10-06',close:1e6,high:1e6,low:1}],101,{beforeDay:'2026-10-06',remainingMinutes:270});
 assert.deepEqual(a,b);assert.ok(a.lower<101&&a.upper>101);
 const near=F.priceBand(bars,101,{beforeDay:'2026-10-06',remainingMinutes:5});
 assert.ok(near.upper-near.lower<a.upper-a.lower);
});
test('independent slow loads run concurrently, deduplicate and isolate failures',async()=>{
 const jobs=F.resourcePool();let release;let calls=0;
 const p=jobs.run('daily','one',1000,()=>{calls++;return new Promise(r=>release=r);});
 const same=jobs.run('daily','one',1000,()=>{calls++;return 99;});
 assert.equal(p,same); await Promise.resolve();assert.equal(calls,1);
 const fast=jobs.run('metrics','one',1000,async()=>42);
 assert.equal(await fast,42);release(7);assert.equal(await p,7);
 await assert.rejects(jobs.run('breadth','one',1000,async()=>{throw Error('offline')}));
 assert.equal(await jobs.run('daily','one',1000,async()=>99),7);
});
test('repeated fetches of the same source tick cannot fabricate a momentum horizon',()=>{
 const t=now.getTime(),source=t-15000;
 const tape=Array.from({length:33},(_,i)=>({day:'2026-10-06',ts:t-480000+i*15000,quotes:{2330:101},sourceTimes:{2330:source}}));
 assert.equal(F.micro(tape,'2330',101,now).available,false);
});
test('reported accuracy includes abstention coverage and separates horizons',()=>{
 const records=[
 {symbol:'2330',modelVersion:'v',day:'2026-10-01',phase:'final',probability:65,direction:'稍偏漲',actual:{pct:1}},
 {symbol:'2330',modelVersion:'v',day:'2026-10-02',phase:'final',probability:50,direction:'方向不明',actual:{pct:-1}},
 {symbol:'2330',modelVersion:'v',day:'2026-10-03',phase:'postClose',probability:65,direction:'稍偏漲',actual:{pct:-1}},
 ];
 const stats=F.auditStats(records,{modelVersion:'v',phase:'final',beforeDay:'2026-10-06'});
 assert.equal(stats.n,1);assert.equal(stats.hits,1);assert.equal(stats.total,2);assert.equal(stats.coverage,0.5);
 assert.equal(stats.baselineHits,1);assert.ok(stats.brier>0);
});
