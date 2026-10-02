/**
 * intraday-metrics.js
 * 5-day, 1-minute intraday volume/VWAP metrics for Trend Radar.
 * Uses Yahoo chart data as an independent supplement to the TWSE quote stream.
 * Edge cached for 45 seconds so the radar can refresh frequently without
 * repeatedly downloading the same 1-minute history.
 */
const SYMBOL_PATTERN=/^[0-9]{4,6}[A-Z]?$/;

function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
  }});
}
function allowed(s){return s==="TAIEX"||SYMBOL_PATTERN.test(s);}
function yahooSymbol(s){return s==="TAIEX"?"^TWII":`${s}.TW`;}
function taipeiParts(unixSeconds){
  const d=new Date((Number(unixSeconds)+8*3600)*1000);
  return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes()};
}
async function fetchJson(url,timeoutMs=8000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{
      "accept":"application/json,text/plain,*/*",
      "user-agent":"Mozilla/5.0 (compatible; StockTracker/4.7)",
    }});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(t);}
}
async function metricFor(sym){
  const ys=yahooSymbol(sym);
  const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?interval=1m&range=5d&includePrePost=false&_ts=${Date.now()}`;
  const j=await fetchJson(url);
  const r=j?.chart?.result?.[0];
  const ts=Array.isArray(r?.timestamp)?r.timestamp:[];
  const q=r?.indicators?.quote?.[0]||{};
  const bars=[];
  for(let i=0;i<ts.length;i++){
    const close=Number(q.close?.[i]),high=Number(q.high?.[i]),low=Number(q.low?.[i]),vol=Number(q.volume?.[i]);
    if(!(close>0) || !(vol>=0)) continue;
    const p=taipeiParts(ts[i]);
    if(p.minute<540||p.minute>810) continue;
    bars.push({day:p.day,minute:p.minute,close,high:Number.isFinite(high)?high:close,low:Number.isFinite(low)?low:close,vol});
  }
  if(!bars.length) return null;
  const days=[...new Set(bars.map(b=>b.day))].sort();
  const today=days[days.length-1];
  const cur=bars.filter(b=>b.day===today).sort((a,b)=>a.minute-b.minute);
  if(!cur.length) return null;
  const lastMinute=cur[cur.length-1].minute;
  const cumVolume=cur.reduce((a,b)=>a+b.vol,0);
  const pv=cur.reduce((a,b)=>a+(((b.high+b.low+b.close)/3)*b.vol),0);
  const vwap=cumVolume>0?pv/cumVolume:null;

  const recent15=cur.filter(b=>b.minute>=lastMinute-15);
  const vol15=recent15.reduce((a,b)=>a+b.vol,0);
  const pv15=recent15.reduce((a,b)=>a+(((b.high+b.low+b.close)/3)*b.vol),0);
  const vwap15=vol15>0?pv15/vol15:null;
  const vwapSlopePct=(vwap&&vwap15)?((vwap15-vwap)/vwap)*100:null;

  const priorDays=days.slice(0,-1).slice(-4);
  const comparable=priorDays.map(day=>bars.filter(b=>b.day===day&&b.minute<=lastMinute).reduce((a,b)=>a+b.vol,0)).filter(v=>v>0);
  const avgSameTime=comparable.length?comparable.reduce((a,b)=>a+b,0)/comparable.length:null;
  const rvol=(cumVolume>0&&avgSameTime>0)?cumVolume/avgSameTime:null;

  return {day,lastMinute,cumVolume,vwap,vwap15,vwapSlopePct,rvol,comparisonDays:comparable.length,lastClose:cur[cur.length-1].close};
}
async function cacheGet(key){
  try{const hit=await caches.default.match(new Request(key));return hit?await hit.json():null;}catch{return null;}
}
async function cachePut(key,val){
  try{await caches.default.put(new Request(key),new Response(JSON.stringify(val),{headers:{"content-type":"application/json","cache-control":"public,max-age=45,s-maxage=45"}}));}catch{}
}
export async function onRequestGet(context){
  try{
    const url=new URL(context.request.url);
    const symbols=[...new Set((url.searchParams.get("symbols")||"").split(",").map(s=>s.trim().toUpperCase()).filter(allowed))].slice(0,12);
    if(!symbols.length) return json({ok:false,error:"沒有允許的股票代號"},400);
    const key=`https://intraday-metrics-cache.local/${symbols.slice().sort().join(",")}`;
    const cached=await cacheGet(key);
    if(cached) return json({...cached,cached:true});
    const entries=await Promise.all(symbols.map(async s=>{try{return [s,await metricFor(s),null];}catch(e){return [s,null,String(e?.message||e)];}}));
    const metrics={},errors=[];
    for(const [s,m,e] of entries){if(m)metrics[s]=m;if(e)errors.push(`${s}: ${e}`);}
    const out={ok:true,at:new Date().toISOString(),metrics,errors};
    await cachePut(key,out);
    return json(out);
  }catch(e){return json({ok:false,error:"盤中量價資料暫時無法使用"},500);}
}
