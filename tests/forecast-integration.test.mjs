import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../forecast-core.js';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const effectStart=html.indexOf('  useEffect(() => {',html.indexOf('function TrendRadar('));
const bodyStart=effectStart+'  useEffect(() => {'.length;
const bodyEnd=html.indexOf('  },[holdings]);',bodyStart);
const effectBody=html.slice(bodyStart,bodyEnd);
const RealDate=Date;
async function mount(time,{blocked=false,lock=null}={}){
 const timers=[],events=new Map(),storage=new Map(),rows=[],markets=[];let cleanup;
 const fixed=new RealDate(time);
 const D=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed.getTime()]));}static now(){return fixed.getTime();}};
 const tick=time.slice(0,10)+'T'+(time.includes('T05:')?'05:25:00Z':time.includes('T06:')?'05:30:00Z':'01:59:45Z');
 const q={price:101,prevClose:100,high:102,low:99,asOfDate:tick};
 storage.set('livePrices',{map:{2330:q},marketIndex:q});
 if(lock)storage.set('trendRadarTomorrowLock',lock);
 const daily=Array.from({length:80},(_,i)=>({day:new RealDate(RealDate.UTC(2026,5,1+i)).toISOString().slice(0,10),open:100,high:102,low:98,close:100+Math.sin(i)}));
 let networkCalls=0;
 const never=new Promise(()=>{});
 const c=vm.createContext({Date:D,console,globalThis:null,holdings:[{symbol:'2330',name:'台積電',current:2}],ZinfForecast:globalThis.ZinfForecast,
 TREND_RADAR_VERSION:'2.47',TREND_MODEL_VERSION:'2.47-fresh-source-audit',
 loadKey:async(k,def)=>storage.get(k)??def,saveKey:async(k,v)=>storage.set(k,v),
 fetchQuotesWithFallback:async()=>({quotes:{SPX:{...q,asOfDate:'2026-10-05T20:00:00Z'},SOX:{...q,asOfDate:'2026-10-05T20:00:00Z'}}}),
 fetchWithTimeout:async url=>{networkCalls++;if(blocked)return never;return Response.json(url.startsWith('/daily-history')?{ok:true,bars:{2330:daily,TAIEX:daily}}:url.startsWith('/intraday-metrics')?{ok:true,metrics:{}}:url.startsWith('/market-breadth')?{ok:true,available:false}:url.startsWith('/taifex')?{ok:false}:{data:[],fields:[]});},
 isTaiwanSymbol:s=>/^\d/.test(s),isNonTradingDay:()=>false,readTwseHolidayCache:()=>({days:{}}),
 marginStats:()=>null,marginForRecord:()=>null,parseMarginRows:()=>null,
 setRows:v=>rows.push(v),setMarketRow:v=>markets.push(v),setAsOf:()=>{},setInstStatus:()=>{},setMarginStatus:()=>{},setGlobalStatus:()=>{},setGlobalRow:()=>{},setTomorrowMap:v=>storage.set('renderedTomorrow',v),
 setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},setInterval:()=>1,clearInterval:()=>{},
 window:{addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:()=>{}},document:{visibilityState:'visible',addEventListener:()=>{},removeEventListener:()=>{}}
 });
 c.globalThis=c;
 cleanup=vm.runInContext('(function(){'+effectBody+'})()',c);
 // Let the initial calculation finish independently of slow jobs.
 for(let i=0;i<40;i++)await Promise.resolve();
 if(!blocked){for(let pass=0;pass<5;pass++){const todo=timers.splice(0);for(const fn of todo)fn();for(let i=0;i<50;i++)await Promise.resolve();}}
 return {storage,rows,markets,events,cleanup,networkCalls};
}
test('first prediction renders even when every slow endpoint is blocked',async()=>{
 const a=await mount('2026-10-06T02:00:00Z',{blocked:true});
 assert.ok(a.networkCalls>=4);assert.ok(a.rows.length,'render must not wait for network');assert.equal(a.rows[0][0].symbol,'2330');a.cleanup();
});
test('opening after the close cannot invent a same-day closing prediction',async()=>{
 const a=await mount('2026-10-06T06:00:00Z');
 assert.equal(a.storage.has('trendRadarCloseLock'),false);
 assert.ok(!(a.storage.get('trendRadarHistory')?.records||[]).some(r=>r.phase==='closeLock'));
 a.cleanup();
});
test('premarket continues the prior target-day lock without rewriting its audit record',async()=>{
 const lock={targetDay:'2026-10-06',predictedOn:'2026-10-05',phase:'final',at:'2026-10-05T05:25:00Z',modelVersion:'2.47-fresh-source-audit',globalAtLock:{spxPct:0,soxPct:0},predictions:{TAIEX:{probability:55,direction:'稍偏漲'},2330:{probability:55,direction:'稍偏漲'}}};
 const a=await mount('2026-10-05T23:50:00Z',{lock});
 assert.equal(a.storage.get('trendRadarTomorrowLock'),lock);
 const pred=a.storage.get('renderedTomorrow').TAIEX;
 assert.equal(pred.targetDay,'2026-10-06');assert.equal(pred.phase,'night');assert.equal(pred.baseProbability,55);
 a.cleanup();
});
test('preclose lock and postclose forecast are audited as different phases',async()=>{
 const pre=await mount('2026-10-06T05:25:00Z');
 assert.equal(pre.storage.get('trendRadarCloseLock')?.day,'2026-10-06');
 assert.equal(pre.storage.get('trendRadarTomorrowLock')?.phase,'final');
 assert.ok((pre.storage.get('trendRadarHistory')?.records||[]).some(r=>r.symbol==='TAIEX'&&r.phase==='closeLock'));
 pre.cleanup();
 const post=await mount('2026-10-06T06:00:00Z');
 assert.equal(post.storage.get('trendRadarTomorrowLock')?.phase,'postClose');post.cleanup();
});
