import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('Trend Radar model constants exist before the component renders',()=>{
 const start=html.indexOf('function TrendRadar(');
 const defs=html.slice(0,start).match(/const TREND_(?:RADAR|MODEL)_VERSION\s*=\s*[^;]+;/g)||[];
 const c={}; vm.runInNewContext(defs.join('\n')+'\nthis.version=TREND_RADAR_VERSION;this.model=TREND_MODEL_VERSION;',c);
 assert.ok(c.version);assert.ok(c.model);
});
test('Vercel forwards both forecasting data endpoints to the Worker',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 for(const path of ['/intraday-metrics','/market-breadth']){
  assert.ok(config.rewrites.some(r=>r.source===path&&r.destination.endsWith(path)),path);
 }
});
