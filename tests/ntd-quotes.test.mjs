import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const a=html.indexOf('const isTaiwanSymbol =');
const b=html.indexOf('\n}',html.indexOf('function tradeAmountNtd(',a))+2;
const q=html.indexOf('async function executeLiveQuoteTool('),qe=html.indexOf('async function executeAppSnapshotTool(',q);
function harness(quotes){let requested;const c=vm.createContext({fetchQuotesWithFallback:async symbols=>{requested=Array.from(symbols);return {quotes,missing:[]};}});vm.runInContext(html.slice(a,b)+html.slice(q,qe),c);return {c,get requested(){return requested;}};}
test('TWD per-share prices use thousands separators, two decimals and no fake zero for missing data',()=>{
 const {c}=harness({});assert.equal(c.formatNtdPrice(22244.42),'22,244.42');assert.equal(c.formatNtdPrice(81.5),'81.50');assert.equal(c.formatNtdPrice(0),'0.00');assert.equal(c.formatNtdPrice(null),'—');assert.equal(c.formatNtdPrice(undefined),'—');assert.equal(c.formatNtdPrice(NaN),'—');
});
test('assistant reports US stock prices in TWD exactly once and preserves Taiwanese prices',async()=>{
 const h=harness({VOO:{price:700,asOfDate:'2026-10-06'},'0050':{price:100},USDTWD:{price:32}});
 const r=await h.c.executeLiveQuoteTool({arguments:{symbols:['VOO','0050']}},[]);
 assert.deepEqual(h.requested,['VOO','0050','USDTWD']);assert.match(r,/VOO：NT\$ 22,400.00／股/);assert.match(r,/0050：NT\$ 100.00／股/);assert.doesNotMatch(r,/NT\$ 700.00/);
});
test('missing FX blocks a mislabeled US price without hiding the available TW quote',async()=>{
 const h=harness({VOO:{price:700},'0050':{price:100}});
 const r=await h.c.executeLiveQuoteTool({arguments:{symbols:['VOO','0050']}},[]);
 assert.match(r,/VOO：新台幣匯率暫時不可用/);assert.match(r,/0050：NT\$ 100.00/);assert.doesNotMatch(r,/NT\$ 700/);
});
test('market index points remain points and FX keeps its exchange-rate unit',async()=>{
 const h=harness({TAIEX:{price:50000},USDTWD:{price:32}});
 const r=await h.c.executeLiveQuoteTool({arguments:{symbols:['TAIEX','USDTWD']}},[]);
 assert.match(r,/TAIEX：50,000.00 點/);assert.match(r,/美元／台幣：NT\$ 32.00／美元/);
});

test('compact quote prices round to one decimal with thousands separators',()=>{
 const {c}=harness({});assert.equal(c.formatNtdPrice(22590.99,1),'22,591.0');assert.equal(c.formatNtdPrice(57.83,1),'57.8');assert.equal(c.formatNtdPrice(null,1),'—');
});
