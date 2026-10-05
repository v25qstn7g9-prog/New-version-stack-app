import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function select(props){
 const start=html.indexOf('function HoldingsWorkspace(');
 assert.ok(start>=0,'holdings workspace must select the visible market');
 const code=html.slice(start,html.indexOf('  return (',start))+'return {activeMarket,visibleHoldings};}';
 const ctx=vm.createContext({isTaiwanSymbol:s=>/^\d/.test(s)});
 vm.runInContext(code,ctx);return ctx.HoldingsWorkspace(props);
}
const holdings=[{id:'tw',symbol:'0050'},{id:'us',symbol:'VOO',current:3.81853}];
test('unchecked US preference hides US even if previously selected and holds fractional shares',()=>{
 const result=select({holdings,market:'us',showUsFields:false});
 assert.equal(result.activeMarket,'tw');assert.deepEqual(Array.from(result.visibleHoldings,h=>h.symbol),['0050']);
 assert.equal(holdings[1].current,3.81853);
});
test('checking US uses the existing shared holding data and permits switching back to TW',()=>{
 const result=select({holdings,market:'us',showUsFields:true});
 assert.equal(result.activeMarket,'us');assert.equal(result.visibleHoldings[0],holdings[1]);
 assert.equal(result.visibleHoldings[0].current,3.81853);
 assert.deepEqual(Array.from(select({holdings,market:'tw',showUsFields:true}).visibleHoldings,h=>h.symbol),['0050']);
});
