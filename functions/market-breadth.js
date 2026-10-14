/**
 * market-breadth.js
 * Best-effort TWSE full-market breadth. Uses the official MI_INDEX report and
 * only exposes a breadth value when the returned report belongs to today's
 * Taiwan trading date. If TWSE has not published a same-day table yet, the
 * client receives available:false and the model applies zero breadth weight.
 */
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    "content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"
  }});
}
function taiwanDay(){
  const d=new Date(Date.now()+8*3600*1000); return d.toISOString().slice(0,10);
}
function ymd(){return taiwanDay().replace(/-/g,"");}
async function fetchJson(url,timeoutMs=7000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{signal:c.signal,headers:{
      "accept":"application/json,text/plain,*/*",
      "user-agent":"Mozilla/5.0 (compatible; StockTracker/4.7)",
      "referer":"https://www.twse.com.tw/"
    }});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }finally{clearTimeout(t);}
}
function n(v){
  const head=String(v??"").split("(")[0].replace(/,/g,"").trim();
  const x=Number(head);
  return Number.isFinite(x)?x:null;
}
function parseRows(payload){
  const tables=[];
  const walk=v=>{
    if(!v||typeof v!=="object") return;
    if(Array.isArray(v)){
      if(v.length&&Array.isArray(v[0])) tables.push(v);
      v.forEach(walk); return;
    }
    for(const [k,val] of Object.entries(v)){
      if(/data|rows/i.test(k)&&Array.isArray(val)&&val.length&&Array.isArray(val[0])) tables.push(val);
      walk(val);
    }
  };
  walk(payload);
  for(const rows of tables){
    let up=null,down=null,flat=null;
    for(const row of rows){
      const label=String(row?.[0]??"");
      const value=row.length>=3?row[2]:row[1]; // prefer "股票" column over whole-market warrants/ETFs
      if(label.includes("上漲")) up=n(value);
      else if(label.includes("下跌")) down=n(value);
      else if(label.includes("持平")) flat=n(value);
    }
    if(up!=null&&down!=null){
      const denom=up+down+(flat||0);
      return {up,down,flat:flat||0,breadth:denom>0?up/denom:null};
    }
  }
  return null;
}
function sameDay(payload,day){
  const text=JSON.stringify(payload);
  const roc=Number(day.slice(0,4))-1911;
  const rocDate=`${roc}年${Number(day.slice(5,7))}月${Number(day.slice(8,10))}日`;
  return text.includes(day.replace(/-/g,""))||text.includes(day.replace(/-/g,"/"))||text.includes(rocDate);
}
// 前一個（或指定日期之前最近一個）已收盤交易日的全市場廣度。盤後報表收盤後才公布，
// 盤中（09:00–10:00、13:25 鎖定）拿不到「今天」的，所以研究紀錄改記「開盤前就已知」的前一日廣度。
const MAX_LOOKBACK_DAYS = 7;
function dayMinus(day, n) {
  return new Date(Date.parse(day + "T12:00:00Z") - n * 86400000).toISOString().slice(0, 10);
}
async function breadthOn(day) {
  const ymdDay = day.replace(/-/g, "");
  const urls = [
    `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymdDay}&type=MS&response=json`,
    `https://www.twse.com.tw/exchangeReport/MI_INDEX?date=${ymdDay}&type=MS&response=json`,
  ];
  for (const u of urls) {
    try {
      const payload = await fetchJson(u);
      if (!payload) continue;
      const parsed = parseRows(payload);
      return parsed?.breadth != null && sameDay(payload, day) ? parsed : null; // 休市日：沒有表 → null
    } catch {}
  }
  throw new Error("TWSE unreachable");
}
export async function prevDayBreadth(before, deps = {}) {
  const fetchDay = deps.breadthOn || breadthOn;
  let unreachable = 0;
  for (let i = 1; i <= MAX_LOOKBACK_DAYS; i++) {
    const day = dayMinus(before, i);
    const wd = new Date(day + "T12:00:00Z").getUTCDay();
    if (wd === 0 || wd === 6) continue;
    try {
      const parsed = await fetchDay(day);
      if (parsed) return { ok: true, available: true, before, day, source: "TWSE MI_INDEX", ...parsed };
    } catch { unreachable++; if (unreachable >= 2) break; }
  }
  return { ok: true, available: false, before, source: "TWSE MI_INDEX", ...(unreachable ? { error: "TWSE 暫時連不上" } : {}) };
}
async function onPrevDay(before) {
  const key = new Request(`https://market-breadth-cache.local/before/${before}`);
  try {
    const hit = await caches.default.match(key);
    if (hit) { const c = await hit.json(); return json({ ...c, cached: true }); }
  } catch {}
  const out = await prevDayBreadth(before);
  // 已定案的歷史資料可以快取久一點；沒找到的只快取一下，稍後再試。
  const maxAge = out.available ? 6 * 3600 : 120;
  try { await caches.default.put(key, new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": `public,max-age=${maxAge},s-maxage=${maxAge}` } })); } catch {}
  return json(out);
}
export async function onRequestGet(context){
  const before=(()=>{try{return new URL(context?.request?.url).searchParams.get("before");}catch{return null;}})();
  if(before!=null){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(before)) return json({ok:false,error:"before 需為 YYYY-MM-DD"},400);
    return onPrevDay(before);
  }
  try{
    const day=taiwanDay();
    const key=new Request(`https://market-breadth-cache.local/${day}`);
    try{
      const hit=await caches.default.match(key);
      if(hit){const c=await hit.json();return json({...c,cached:true});}
    }catch{}
    const urls=[
      `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd()}&type=MS&response=json`,
      `https://www.twse.com.tw/exchangeReport/MI_INDEX?date=${ymd()}&type=MS&response=json`
    ];
    let payload=null,lastErr=null;
    for(const u of urls){try{payload=await fetchJson(u);if(payload)break;}catch(e){lastErr=e;}}
    if(!payload) throw lastErr||new Error("no response");
    const parsed=parseRows(payload);
    const current=sameDay(payload,day);
    const out={ok:true,available:Boolean(current&&parsed?.breadth!=null),day,source:"TWSE MI_INDEX",...(parsed||{})};
    try{await caches.default.put(key,new Response(JSON.stringify(out),{headers:{"content-type":"application/json","cache-control":"public,max-age=60,s-maxage=60"}}));}catch{}
    return json(out);
  }catch(e){return json({ok:true,available:false,day:taiwanDay(),source:"TWSE MI_INDEX",error:String(e?.message||e)},200);}
}
