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
function n(v){const x=Number(String(v??"").replace(/[,()%]/g,"").trim());return Number.isFinite(x)?x:null;}
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
      if(label.includes("上漲")) up=n(row[1]);
      else if(label.includes("下跌")) down=n(row[1]);
      else if(label.includes("持平")) flat=n(row[1]);
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
export async function onRequestGet(){
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
