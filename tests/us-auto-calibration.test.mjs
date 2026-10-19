import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildAutoRecord} from '../functions/auto-daily.js';
import {readAppSource} from './_app-source.mjs';
const ctx=vm.createContext({self:{}});vm.runInContext(fs.readFileSync('bg-core.js','utf8'),ctx);const Z=ctx.self.ZinfBg;
const holdings=[{symbol:'VOO',shares:4.09114,costBasis:91193}];
const calibration={enabled:true,factor:92830/93046,activeKey:'VOO:4.09114'};
const price=93046/(4.09114*32),date='2026-10-19';
const q=p=>({price:p,asOfDate:date+'T03:00:00Z',isStale:false,intradayFresh:true});
const mirror={holdings,tracksUs:true,usBrokerCalibration:calibration,prior:{usCost:85555}};
const summary={holdings,dataset:{holdings,usBrokerCalibration:calibration,dailyRecords:[{date:'2026-10-18',usCost:85555}]}};
test('push and server auto records use the same calibrated US value and corrected cost',()=>{
 const a=Z.buildRecord(mirror,{VOO:q(price),USDTWD:q(32)},date).record;
 const b=buildAutoRecord(summary,{VOO:price,USDTWD:32},date).record;
 for(const r of [a,b]){assert.equal(r.usValue,92830);assert.equal(r.usCost,91193);}
});
test('automatic quote updates follow calibration without compounding the factor',()=>{
 for(const multiplier of [1.01,1.02,1]){
  const expected=Math.round(Math.round(93046*multiplier)*calibration.factor);
  assert.equal(Z.buildRecord(mirror,{VOO:q(price*multiplier),USDTWD:q(32)},date).record.usValue,expected);
  assert.equal(buildAutoRecord(summary,{VOO:price*multiplier,USDTWD:32},date).record.usValue,expected);
 }
});
test('a changed share composition disables old calibration in both automatic paths',()=>{
 const changed=[{...holdings[0],shares:5}];
 const a=Z.buildRecord({...mirror,holdings:changed},{VOO:q(price),USDTWD:q(32)},date).record;
 const b=buildAutoRecord({...summary,holdings:changed},{VOO:price,USDTWD:32},date).record;
 assert.equal(a.usValue,Math.round(price*5*32));assert.equal(b.usValue,a.usValue);
});
test('an explicitly corrected zero cost is not replaced by an old nonzero cost',()=>{
 const changed=[{...holdings[0],costBasis:0}];
 assert.equal(Z.buildRecord({...mirror,holdings:changed},{VOO:q(price),USDTWD:q(32)},date).record.usCost,0);
 assert.equal(buildAutoRecord({...summary,holdings:changed},{VOO:price,USDTWD:32},date).record.usCost,0);
});
test('foreground automatic recording stores the calibrated asset value, not the raw quote total',async()=>{
 const src=readAppSource(),start=src.indexOf('    const tryLocal = async () => {'),end=src.indexOf('    tryLocal();',start);let record;
 const c=vm.createContext({needsTodayRecord:()=>true,autoLocalBusyRef:{current:false},holdingsWithShares:[{symbol:'VOO',current:4.09114,estCostBasis:91193}],usHoldings:[{symbol:'VOO',shares:4.09114}],
 usLive:{totalNtd:93046,state:{failed:[]}},usAssetLive:{totalNtd:92830},usSnapshotCanRecord:()=>true,isTaiwanSymbol:s=>/^[0-9]/.test(s),dailyRecords:[],todayStr:()=>date,
 fetchQuotesWithFallback:async()=>({quotes:{}}),insertAutoRecords:rs=>{record=rs[0];}});
 const a=src.indexOf('function knownHoldingCost('),b=src.indexOf('\n}',a)+2;vm.runInContext(src.slice(a,b),c);
 for (const [basis,missing,expected] of [[91193,false,91193],[0,false,0],[0,true,85555]]) {
  c.holdingsWithShares=[{symbol:'VOO',current:4.09114,estCostBasis:basis,missingInitialCost:missing}];c.dailyRecords=[{date:'2026-10-18',usCost:85555}];
  await vm.runInContext('(async()=>{'+src.slice(start,end)+'await tryLocal();})()',c);assert.equal(record.usValue,92830);assert.equal(record.usCost,expected);
 }
});
test('missing background cost keeps the previous basis instead of treating it as an explicit zero',()=>{
 const unknown=[{...holdings[0],costBasis:null}];
 const a=Z.buildRecord({...mirror,holdings:unknown},{VOO:q(price),USDTWD:q(32)},date).record;
 const b=buildAutoRecord({...summary,holdings:unknown},{VOO:price,USDTWD:32},date).record;
 assert.equal(a.usCost,85555);assert.equal(b.usCost,85555);
});
test('disabled and out-of-range calibration never changes automatic raw values',()=>{
 for(const calibration of [{enabled:false,factor:1.01,activeKey:'VOO:4.09114'},{enabled:true,factor:1.2,activeKey:'VOO:4.09114'}]){
  assert.equal(Z.buildRecord({...mirror,usBrokerCalibration:calibration},{VOO:q(price),USDTWD:q(32)},date).record.usValue,93046);
  assert.equal(buildAutoRecord({...summary,dataset:{...summary.dataset,usBrokerCalibration:calibration}},{VOO:price,USDTWD:32},date).record.usValue,93046);
 }
});
