import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function UsHoldingsEditor(');
const code = html.slice(start, html.indexOf('  const add = () => {', start)) + '\n}';
function harness() {
  const values = [{symbol:'AAPL',name:'',shares:'2'}], refs = [];
  let stateIndex = 0, refIndex = 0, effect, timer, resolve;
  const ctx = vm.createContext({
    useState(initial) {const i = stateIndex++; if(values[i] === undefined) values[i] = initial; return [values[i], value => { values[i] = typeof value === 'function' ? value(values[i]) : value; }];},
    useRef(initial) {const i = refIndex++; return refs[i] ||= {current:initial};},
    useEffect(fn) {effect = fn;}, setTimeout(fn) {timer = fn; return 1;}, clearTimeout() {},
    fetchWithTimeout: () => new Promise(done => {resolve = done;})
  });
  vm.runInContext(code, ctx);
  const render = () => {stateIndex = refIndex = 0;ctx.UsHoldingsEditor({});};
  render();
  return {values, render, run: () => effect?.(), fire: () => timer?.(), reply: () => resolve({ok:true,json:async()=>({ok:true,found:true,name:'Apple Inc.'})})};
}
test('US editor fills the stock name after the debounce', async () => {
  const h = harness(); h.run(); const pending = h.fire();
  assert.ok(pending, 'US editor must start a stock-name lookup');
  h.reply(); await pending;
  assert.equal(h.values[0].name, 'Apple Inc.');
});
test('manual name entered while lookup is pending is preserved', async () => {
  const h = harness(); h.run(); const pending = h.fire();
  assert.ok(pending);
  h.values[0] = {...h.values[0],name:'我的蘋果'}; h.render();
  h.reply(); await pending;
  assert.equal(h.values[0].name, '我的蘋果');
});
test('an old lookup cannot fill the name after switching symbols', async () => {
  const h = harness(); const cleanup = h.run(); const pending = h.fire();
  assert.ok(pending); cleanup();
  h.values[0] = {...h.values[0],symbol:'MSFT'}; h.render();
  h.reply(); await pending;
  assert.equal(h.values[0].name, '');
});
