import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readAppSource} from './_app-source.mjs';
const src=readAppSource();
const start=src.indexOf('  // 只填「空的」');
const effect=src.slice(src.indexOf('  useEffect(() => {',start)+22,src.indexOf('\n  const editField =',start));
const body=effect.slice(0,effect.lastIndexOf('\n  }, ['));
function draft(overrides={}){
 const ctx=vm.createContext({prefill:null,form:{date:'2026-10-19',twValue:'',usValue:'',twCost:'',usCost:''},autoFrom:{},isToday:true,sameDayRecord:null,
 lastBefore:{id:'prior',date:'2026-10-18',usValue:88111,usCost:85555},autoTw:{status:'loading',value:null},autoUs:{status:'loading',value:null},autoTwCost:0,
 holdings:[{symbol:'VOO',current:4.09114,estCostBasis:91193}],usHoldings:[{symbol:'VOO',shares:4.09114}],activeUs:[{symbol:'VOO',shares:4.09114}],
 isTaiwanSymbol:s=>/^[0-9]/.test(s),...overrides});
 const a=src.indexOf('function knownHoldingCost('),b=src.indexOf('\n}',a)+2;vm.runInContext(src.slice(a,b),ctx);
 ctx.setForm=fn=>{ctx.form=fn(ctx.form);};ctx.setAutoFrom=fn=>{ctx.autoFrom=fn(ctx.autoFrom);};
 return {ctx,fill(){vm.runInContext("(()=>{"+body+"})()",ctx);return ctx.form;}};
}
test('delayed calibrated US quotes replace the automatic previous-record fallback',()=>{
 const h=draft();assert.equal(h.fill().usValue,'88111');h.ctx.autoUs={status:'ok',value:92830};assert.equal(h.fill().usValue,'92830');
});
test('corrected holding cost replaces an older automatic cost without touching the records',()=>{
 const h=draft({holdings:[{symbol:'VOO',current:4.09114,estCostBasis:85555}]});assert.equal(h.fill().usCost,'85555');
 h.ctx.holdings=[{symbol:'VOO',current:4.09114,estCostBasis:91193}];assert.equal(h.fill().usCost,'91193');assert.equal(h.ctx.lastBefore.usCost,85555);
});
test('today uses calibrated market value and corrected cost even when a saved snapshot exists',()=>{
 const h=draft({sameDayRecord:{id:'saved',usValue:88111,usCost:85555},autoUs:{status:'ok',value:92830}});const f=h.fill();assert.equal(f.usValue,'92830');assert.equal(f.usCost,'91193');
});
test('refresh waits for the requested quote instead of locking in yesterday again',()=>{
 const h=draft({autoFrom:{usValue:'wantQuote',usCost:'wantHoldings'}});assert.equal(h.fill().usValue,'');assert.equal(h.ctx.autoFrom.usValue,'wantQuote');
 h.ctx.autoUs={status:'ok',value:92830};assert.equal(h.fill().usValue,'92830');
});
test('manual values and intentional blanks survive live refreshes',()=>{
 const h=draft({form:{date:'2026-10-19',twValue:'0',usValue:'90000',twCost:'',usCost:''},autoFrom:{usValue:'typed',usCost:'typed'},autoUs:{status:'ok',value:92830}});
 assert.equal(h.fill().usValue,'90000');assert.equal(h.fill().usCost,'');
});
test('historical dates retain their own saved values, not current quote or cost corrections',()=>{
 const h=draft({isToday:false,sameDayRecord:{id:'old',usValue:88111,usCost:85555},autoUs:{status:'ok',value:92830}});
 assert.equal(h.fill().usValue,'88111');assert.equal(h.fill().usCost,'85555');
});

test('a pending refresh does not revert an existing automatic quote to an older saved value',()=>{
 const h=draft({form:{date:'2026-10-19',twValue:'',usValue:'92830',twCost:'',usCost:'91193'},autoFrom:{usValue:'usQuote',usCost:'holdings'},sameDayRecord:{id:'saved',usValue:88111,usCost:85555}});
 assert.equal(h.fill().usValue,'92830');
});

test('unknown initial cost keeps the prior cost; an explicit corrected zero remains zero',()=>{
 const h=draft({holdings:[{symbol:'VOO',current:4.09114,estCostBasis:0,missingInitialCost:true}]});assert.equal(h.fill().usCost,'85555');
 h.ctx.holdings=[{symbol:'VOO',current:4.09114,estCostBasis:0,missingInitialCost:false}];assert.equal(h.fill().usCost,'0');
});

test('a stale US quote is not promoted to a current automatic value just because a cached total exists',()=>{
 const a=src.indexOf('    setAutoUs({ status:'),b=src.indexOf('\n  }, [activeUsKey',a);let result;
 const c=vm.createContext({activeUs:[{symbol:'VOO',shares:4.09114}],usHoldings:[{symbol:'VOO',shares:4.09114}],usLive:{totalNtd:92830,state:{status:'done',failed:[],quotes:{VOO:{price:710,isStale:true}},fx:32}},normalizeStockSymbol:s=>s.toUpperCase(),setAutoUs:v=>{result=v;}});
 const fn=src.indexOf('function usSnapshotCanRecord('),end=src.indexOf('\n}',fn)+2;vm.runInContext(src.slice(fn,end),c);
 vm.runInContext(src.slice(a,b),c);assert.notEqual(result.status,'ok');
});

test('a delayed US quote cannot save yesterday automatically as today; explicit input remains usable',()=>{
 const a=src.indexOf('  const dailyMissing =',src.indexOf('function DailyPanel(')),b=src.indexOf('\n  const add =',a);
 const c=vm.createContext({form:{twValue:'5000000',usValue:'88111'},sameDayRecord:null,isToday:true,activeUs:[{symbol:'VOO'}],autoFrom:{usValue:'last'},autoTw:{status:'ok'},autoUs:{status:'loading'},M:(en,zh)=>zh});
 const read=()=>vm.runInContext('(()=>{'+src.slice(a,b)+'return dailyMissing;})()',c);
 assert.ok(read().length>0,'wait for a valid automatic quote before enabling Save');
 c.autoFrom.usValue='typed';assert.equal(read().length,0);
});
