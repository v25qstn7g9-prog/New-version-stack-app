import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildAutoRecord } from '../functions/auto-daily.js';
const html=fs.readFileSync('index.html','utf8');
const ctx=vm.createContext({uid:()=> 'new-id'});
const a=html.indexOf('const isTaiwanSymbol =');
const b=html.indexOf('\n}',html.indexOf('function tradeAmountNtd(',a))+2;
vm.runInContext(html.slice(a,b)+'\nglobalThis.api={holdingShareCount,mergeLegacyUsHoldings,tradeAmountNtd,isStockSymbol};',ctx);
const {holdingShareCount,mergeLegacyUsHoldings,tradeAmountNtd,isStockSymbol}=ctx.api;
test('migration retains fractional US shares without double-counting prior trades and is idempotent',()=>{
 const trades=[{symbol:'AAPL',action:'buy',shares:3},{symbol:'AAPL',action:'sell',shares:.5}];
 const legacy=[{id:'us1',symbol:'aapl',name:'Apple',shares:1.25}];
 const merged=mergeLegacyUsHoldings([{id:'tw',symbol:'0050',initialShares:100}],legacy,trades);
 assert.equal(merged.length,2); assert.equal(holdingShareCount(merged[1],trades),1.25);
 assert.equal(holdingShareCount(merged[1],[...trades,{symbol:'AAPL',action:'buy',shares:.75}]),2);
 assert.equal(mergeLegacyUsHoldings(merged,legacy,trades).length,2);
});
test('USD trades preserve transaction FX and fees while old TWD amounts are unchanged',()=>{
 assert.equal(tradeAmountNtd({symbol:'AAPL',action:'buy',shares:.5,price:200,fee:1},32),3232);
 assert.equal(tradeAmountNtd({symbol:'AAPL',action:'sell',shares:.5,price:200,fee:1,tax:.1},31),3065.9);
 assert.equal(tradeAmountNtd({symbol:'0050',action:'buy',shares:10,price:100,fee:1},undefined),1001);
 assert.equal(tradeAmountNtd({symbol:'AAPL',action:'buy',shares:1,price:100},undefined),null);
 assert.equal(isStockSymbol('BRK.B'),true);assert.equal(isStockSymbol('USDTWD'),false);
});
test('one mixed-market automatic record includes both markets and TWD costs',()=>{
 const portfolio={holdings:[{symbol:'0050',shares:10,costBasis:800},{symbol:'AAPL',shares:1.25,costBasis:7000}],dataset:{dailyRecords:[]}};
 const result=buildAutoRecord(portfolio,{'0050':100,AAPL:200,USDTWD:32},'2026-10-05');
 assert.equal(result.ok,true);assert.equal(result.record.valuationVersion,2);assert.equal(result.record.twValue,1000);assert.equal(result.record.usValue,8000);
 assert.equal(result.record.twCost,800);assert.equal(result.record.usCost,7000);
 assert.equal(buildAutoRecord(portfolio,{'0050':100,AAPL:200},'2026-10-05').ok,false);
});
test('US-only automatic record works, and a missing US quote blocks a partial record',()=>{
 const portfolio={holdings:[{symbol:'AAPL',shares:.5,costBasis:3000}],dataset:{dailyRecords:[]}};
 const record=buildAutoRecord(portfolio,{AAPL:200,USDTWD:32},'2026-10-05');
 assert.equal(record.record.twValue,0);assert.equal(record.record.usValue,3200);
 assert.equal(buildAutoRecord(portfolio,{USDTWD:32},'2026-10-05').ok,false);
});
test('background recording uses previous US session and current TW close in a single record',()=>{
 const c=vm.createContext({self:{}});vm.runInContext(fs.readFileSync('bg-core.js','utf8'),c);
 const tw={price:100,asOfDate:'2026-10-05T05:30:00Z'};
 const us={price:200,asOfDate:'2026-10-02T20:00:00Z'};
 const fx={price:32,asOfDate:'2026-10-05T05:30:00Z'};
 const p={holdings:[{symbol:'0050',shares:10,costBasis:800},{symbol:'AAPL',shares:1.25,costBasis:7000}]};
 const r=c.self.ZinfBg.buildRecord(p,{'0050':tw,AAPL:us,USDTWD:fx},'2026-10-05');
 assert.equal(r.ok,true);assert.equal(r.record.valuationVersion,2);assert.equal(r.record.usValue,8000);
 assert.equal(c.self.ZinfBg.buildRecord(p,{'0050':tw,AAPL:us},'2026-10-05').ok,false);
 assert.equal(c.self.ZinfBg.buildRecord(p,{'0050':tw,AAPL:{...us,asOfDate:'2026-09-01T20:00:00Z'},USDTWD:fx},'2026-10-05').ok,false);
});
function formHarness(name, form, props, extra={}) {
 const start=html.indexOf(`function ${name}(`), end=html.indexOf('  const remove =',start);
 const code=html.slice(start,end)+'  return { add, form };\n}';
 let first=true;
 const c=vm.createContext({UI_SHOW_ENGLISH:false,todayStr:()=> '2026-10-05',uid:()=> 'new-record',uiText:x=>x,useState:initial=>{const value=first?(first=false,form):initial;return[value,()=>{}];},useEffect:()=>{},useRef:v=>({current:v}),...extra});
 vm.runInContext(html.slice(a,b),c);vm.runInContext(code,c);
 return c[name](props);
}
test('the shared trade form writes one USD transaction and updates the same holding',()=>{
 let writes=0,rows=[];
 const form={date:'2026-10-05',symbol:'aapl',action:'buy',shares:'.5',price:'200',fee:'1',tax:'',note:'',fxRate:''};
 const panel=formHarness('TradesPanel',form,{usLive:{state:{fx:32}},setTrades:fn=>{writes++;rows=fn(rows);}});
 panel.add();assert.equal(writes,1);assert.equal(rows[0].symbol,'AAPL');assert.equal(rows[0].amount,3232);assert.equal(rows[0].currency,'USD');assert.equal(rows[0].fxRate,32);
 assert.equal(holdingShareCount({symbol:'AAPL',initialShares:1.25},rows),1.75);
});
test('the shared dividend form saves net USD income as TWD with its exchange rate',()=>{
 let rows=[];
 const panel=formHarness('DividendsPanel',{date:'2026-10-05',symbol:'AAPL',shares:'2',perShare:'.5',fxRate:'32',withholdingTax:'.1'},{holdings:[],usLive:{state:{fx:33}},setDividends:fn=>rows=fn(rows)});
 panel.add();assert.equal(rows.length,1);assert.equal(rows[0].amount,28.8);assert.equal(rows[0].nativeAmount,.9);assert.equal(rows[0].fxRate,32);
});
test('past USD trades require an entered transaction exchange rate',()=>{
 let writes=0;
 const panel=formHarness('TradesPanel',{date:'2026-09-30',symbol:'AAPL',action:'buy',shares:'1',price:'200',fee:'',tax:'',fxRate:''},{usLive:{state:{fx:32}},setTrades:()=>writes++});
 panel.add();assert.equal(writes,0);
});
test('backup validation accepts USD transaction amounts with saved FX',()=>{
 const c=vm.createContext({UI_SHOW_ENGLISH:false,BACKUP_SCHEMA_VERSION:2,parseLocalDate:s=>new Date(s+'T00:00:00')});
 const begin=html.indexOf('function isObject('), finish=html.indexOf('\n}',html.indexOf('function inspectBackupPayload('))+2;
 vm.runInContext(html.slice(begin,finish),c);
 const payload={schemaVersion:2,data:{holdings:[{id:'a',symbol:'AAPL',initialShares:1.25,target2035:0}],dailyRecords:[],trades:[{id:'t',date:'2026-10-05',symbol:'AAPL',action:'buy',shares:.5,price:200,fee:1,tax:0,amount:3232,currency:'USD',fxRate:32}],dividends:[],planItems:[],goal:{targetAmount:100000,targetYear:2035},planSchedule:{startDate:'2026-10-05',monthlyAmount:0}}};
 const checked=c.inspectBackupPayload(payload);assert.equal(checked.ok,true);assert.equal(checked.warnings.length,0);
 payload.data.trades[0].fxRate=0;assert.equal(c.inspectBackupPayload(payload).ok,false);
});
test('a buy in the shared trade form creates the holding without a second entry',async()=>{
 let hs=[],rows=[];
 const panel=formHarness('TradesPanel',{date:'2026-10-05',symbol:'aapl',action:'buy',shares:'.5',price:'200',fee:'0',tax:'',note:'',fxRate:'32'},{holdings:[],setHoldings:fn=>hs=fn(hs),setTrades:fn=>rows=fn(rows),usLive:{state:{}}},{fetchWithTimeout:async()=>({ok:true,json:async()=>({found:true,name:'Apple Inc.'})})});
 panel.add();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(hs.length,1);assert.equal(hs[0].name,'Apple Inc.');assert.equal(holdingShareCount(hs[0],rows),.5);
});
test('mixed holdings reject old background calculations and import one compatible record',()=>{
 const start=html.indexOf('  const insertAutoRecords ='),end=html.indexOf('  useEffect(',start);
 let rows=[];const c=vm.createContext({usHoldings:[{symbol:'AAPL',shares:1}],uid:()=> 'daily-id',setDailyRecords:fn=>rows=fn(rows)});
 vm.runInContext(html.slice(start,end)+'\nthis.insert=insertAutoRecords;',c);
 const old={date:'2026-10-05',twValue:1000,usValue:0,twCost:800,usCost:0};
 c.insert([old]);assert.equal(rows.length,0);
 c.insert([{...old,usValue:8000,valuationVersion:2}]);assert.equal(rows.length,1);assert.equal(rows[0].usValue,8000);
 c.insert([{...old,usValue:8000,valuationVersion:2}]);assert.equal(rows.length,1);
});
