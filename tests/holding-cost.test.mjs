import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const ctx=vm.createContext({todayStr:()=> '2026-10-06',nf:x=>Number(x).toLocaleString('en-US',{maximumFractionDigits:6})});
const a=html.indexOf('const isTaiwanSymbol =');
const b=html.indexOf('\n}',html.indexOf('function tradeAmountNtd(',a))+2;
vm.runInContext(html.slice(a,b),ctx);
const start=html.indexOf('function executeReadTool('),end=html.indexOf('// AI 助手專用：查即時股價',start);
vm.runInContext(html.slice(start,end),ctx);
const holding={symbol:'VOO',initialShares:3.81853,costOverride:{amount:84941,asOfDate:'2026-10-05',asOfShares:3.81853}};
test('total holding cost and per-share TWD average use the same source in the card and cost query',()=>{
 const result=ctx.holdingCostAt(holding,[]);
 assert.equal(result.estCostBasis,84941);assert.equal(result.avgCost,84941/3.81853);
 const answer=ctx.executeReadTool({name:'query_app_data',arguments:{source:'holding_cost',symbol:'voo',asOfDate:'2026-10-06'}},{holdings:[holding],trades:[]});
 assert.match(answer,/每股平均成本NT\$22244.42\/股/);assert.match(answer,/總持有成本NT\$84,941/);assert.doesNotMatch(answer,/沒有記錄/);
});
test('editing share count repairs old snapshot denominators and subsequent sales remove proportional cost',()=>{
 const edited={...holding,initialShares:4};
 assert.equal(ctx.holdingCostAt(edited,[]).avgCost,84941/4);
 const result=ctx.holdingCostAt(edited,[{id:'s',symbol:'VOO',date:'2026-10-06',action:'sell',shares:1,amount:25000}]);
 assert.equal(result.current,3);assert.equal(result.estCostBasis,63706);assert.equal(result.avgCost,63706/3);
});
test('new snapshots include existing same-day trades exactly once and apply a later same-day purchase',()=>{
 const trades=[{id:'a',symbol:'VOO',date:'2026-10-06',action:'buy',shares:1,amount:20000}];
 const h={symbol:'VOO',initialShares:1,costOverride:{amount:40000,asOfDate:'2026-10-06',asOfShares:2,includedTradeIds:['a']}};
 assert.equal(ctx.holdingCostAt(h,trades).estCostBasis,40000);
 const result=ctx.holdingCostAt(h,[...trades,{id:'b',symbol:'VOO',date:'2026-10-06',action:'buy',shares:.5,amount:11000}]);
 assert.equal(result.estCostBasis,51000);assert.equal(result.current,2.5);assert.equal(result.avgCost,20400);
});
test('a future snapshot is not used for historical costs and a valid snapshot overrides legacy manual average',()=>{
 const h={...holding,manualAvgCost:''};
 assert.equal(ctx.holdingCostAt(h,[],'2026-10-04').estCostBasis,0);
 assert.equal(ctx.holdingCostAt({...holding,manualAvgCost:1},[]).estCostBasis,84941);
 assert.equal(ctx.holdingCostAt({...holding,costOverride:{...holding.costOverride,amount:0}},[]).estCostBasis,0);
});
test('card labels distinguish a total amount from a per-share amount',()=>{
 assert.match(html,/<UiLabel zh="每股平均成本" inline/);assert.match(html,/<UiLabel zh="總持有成本" inline/);
 assert.match(html,/h\.avgCost\.toLocaleString[\s\S]{0,150}／股/);
});
