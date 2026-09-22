/**
 * taifex-tx.js — official TAIFEX TX nearest-month quote proxy
 *
 * Uses TAIFEX's official daily market report. During the night session,
 * TAIFEX attributes 15:00~05:00 trading to the next trading date, so the
 * query date is advanced accordingly. This is a nearest-month TX contract,
 * used by the app as a practical "*TXFF / 台指近全" proxy; it is not a
 * vendor-specific continuous-contract symbol.
 */

const VERSION = "1.0-taifex-tx-near";

function jsonResponse(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store, no-cache, must-revalidate",
      "pragma":"no-cache",
      "x-content-type-options":"nosniff",
    },
  });
}

function taipeiParts(now=new Date()){
  const t=new Date(now.getTime()+8*3600*1000);
  return {y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate(),hh:t.getUTCHours(),mm:t.getUTCMinutes()};
}

function addDaysYmd({y,m,d},n){
  const x=new Date(Date.UTC(y,m-1,d+n));
  return {y:x.getUTCFullYear(),m:x.getUTCMonth()+1,d:x.getUTCDate()};
}
function weekday({y,m,d}){ return new Date(Date.UTC(y,m-1,d)).getUTCDay(); }
function fmt({y,m,d}){ return `${y}/${String(m).padStart(2,"0")}/${String(d).padStart(2,"0")}`; }
function nextWeekday(ymd){
  let x=addDaysYmd(ymd,1);
  while(weekday(x)===0||weekday(x)===6) x=addDaysYmd(x,1);
  return x;
}
function cleanText(html){
  return String(html||"")
    .replace(/<br\s*\/?\s*>/gi," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&#9650;|▲/g,"▲")
    .replace(/&#9660;|▼/g,"▼")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}
function num(s){
  const n=Number(String(s??"").replace(/[,▲▼%+]/g,"").trim());
  return Number.isFinite(n)?n:null;
}
function parseTxRows(html){
  const rows=[];
  for(const tr of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>cleanText(m[1]));
    if(cells.length<8) continue;
    if(cells[0]!=="TX" || !/^\d{6}$/.test(cells[1])) continue;
    const last=num(cells[5]), change=num(cells[6]), changePct=num(cells[7]);
    rows.push({
      symbol:"TX", expiry:cells[1],
      open:num(cells[2]), high:num(cells[3]), low:num(cells[4]),
      price:last,
      change: String(cells[6]).includes("▼") && change!=null ? -Math.abs(change) : change,
      changePct: String(cells[7]).includes("▼") && changePct!=null ? -Math.abs(changePct) : changePct,
      raw:cells.slice(0,10),
    });
  }
  return rows;
}

async function fetchReport(queryDate, marketCode){
  const body=new URLSearchParams({
    queryType:"2",
    marketCode:String(marketCode),
    dateaddcnt:"",
    commodity_id:"TX",
    commodity_id2:"",
    queryDate,
    MarketCode:String(marketCode),
    commodity_idt:"TX",
    commodity_id2t:"",
  });
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),7000);
  try{
    const res=await fetch("https://www.taifex.com.tw/cht/3/futDailyMarketReport",{
      method:"POST",
      body,
      signal:controller.signal,
      headers:{
        "content-type":"application/x-www-form-urlencoded;charset=UTF-8",
        "accept":"text/html,application/xhtml+xml",
        "user-agent":"Mozilla/5.0 (compatible; StockTracker/4.7)",
      },
    });
    if(!res.ok) throw new Error(`TAIFEX HTTP ${res.status}`);
    return parseTxRows(await res.text());
  }finally{ clearTimeout(timer); }
}

export async function onRequestGet(){
  try{
    const p=taipeiParts();
    const base={y:p.y,m:p.m,d:p.d};
    const minutes=p.hh*60+p.mm;
    let marketCode=0;
    let queryYmd=base;
    let session="regular";

    if(minutes>=15*60){
      marketCode=1; session="after_hours"; queryYmd=nextWeekday(base);
    }else if(minutes<5*60){
      marketCode=1; session="after_hours"; queryYmd=base;
    }else if(minutes>=13*60+45){
      marketCode=0; session="regular_closed"; queryYmd=base;
    }

    // Holidays can make the first candidate empty. Probe a few neighboring
    // weekdays and use the first valid TX table.
    const candidates=[queryYmd];
    let x=queryYmd;
    for(let i=0;i<4;i++){ x= marketCode===1 ? nextWeekday(x) : addDaysYmd(x,-1); candidates.push(x); }

    let rows=[], used=null;
    for(const c of candidates){
      try{
        rows=await fetchReport(fmt(c),marketCode);
        if(rows.length){ used=c; break; }
      }catch(e){}
    }
    if(!rows.length) return jsonResponse({ok:false,version:VERSION,error:"TAIFEX TX 暫無可用資料"},502);

    rows.sort((a,b)=>a.expiry.localeCompare(b.expiry));
    const near=rows[0];
    return jsonResponse({
      ok:true,
      version:VERSION,
      source:"TAIFEX",
      proxyFor:"*TXFF",
      note:"官方 TX 最近月合約，作為台指近全代理；非資料商連續合約代號",
      session,
      queryDate:fmt(used||queryYmd),
      fetchedAt:new Date().toISOString(),
      quote:near,
      contracts:rows.slice(0,6),
    });
  }catch(e){
    return jsonResponse({ok:false,version:VERSION,error:String(e?.message||e)},500);
  }
}
