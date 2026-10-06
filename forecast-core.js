/* Pure forecasting guards shared by the browser and replay tests. No API calls. */
(function(root){
  const valid=v=>(typeof v==='number'||(typeof v==='string'&&v.trim()!==''))&&Number.isFinite(Number(v));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function clock(now=new Date()){
    const d=new Date(new Date(now).getTime()+8*3600000);
    return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes(),weekday:d.getUTCDay()};
  }
  function nextSession(day,holidays={}){
    const d=new Date(day+'T12:00:00+08:00');
    do{d.setUTCDate(d.getUTCDate()+1);}while([0,6].includes(clock(d).weekday)||holidays[clock(d).day]);
    return clock(d).day;
  }
  function sourceTime(q){return Date.parse(q?.asOfDate||'');}
  function quoteFresh(q,now=new Date()){
    if(!(Number(q?.price)>0&&Number(q?.prevClose)>0)||q?.isStale)return false;
    const ts=sourceTime(q),t=clock(now),age=new Date(now).getTime()-ts;
    if(!Number.isFinite(ts)||age<0||clock(new Date(ts)).day!==t.day)return false;
    return t.minute>=540&&t.minute<810?age<=180000:clock(new Date(ts)).minute>=810;
  }
  function outcome(q,day,now=new Date()){
    const ts=sourceTime(q),t=clock(now);
    if(!Number.isFinite(ts)||q?.isStale||!(Number(q?.price)>0&&Number(q?.prevClose)>0))return null;
    const qt=clock(new Date(ts));
    if(qt.day!==day||qt.minute<810||t.day<day||(t.day===day&&t.minute<815)||ts>new Date(now).getTime())return null;
    const pct=(Number(q.price)/Number(q.prevClose)-1)*100;
    return {pct:Math.round(pct*1e8)/1e8,up:Math.abs(pct)<1e-8?null:pct>0,sourceAt:new Date(ts).toISOString()};
  }
  function metricsFresh(m,now=new Date()){
    const t=clock(now),minute=Number(m?.lastMinute);
    return m?.day===t.day&&valid(m?.lastMinute)&&minute>=540&&minute<=810&&
      (t.minute>=810?minute>=807:t.minute-minute>=0&&t.minute-minute<=3);
  }
  function micro(tape,sym,px,now=new Date()){
    const empty={available:false,m1:null,m3:null,m8:null,score:0,agreement:0};
    const end=new Date(now).getTime(),day=clock(now).day;
    const observations=(tape||[]).filter(p=>p.day===day&&Number(p.quotes?.[sym])>0&&Number(p.ts)<=end&&end-Number(p.ts)<=15*60000)
      .map(p=>({ts:Number(p.sourceTimes?.[sym]??p.ts),observedAt:Number(p.ts),px:Number(p.quotes[sym])})).filter(p=>p.ts<=p.observedAt&&p.ts<=end&&end-p.ts<=15*60000);
    const base=[...new Map(observations.map(p=>[p.ts,p])).values()].sort((a,b)=>a.ts-b.ts);
    if(!(px>0)||base.length<2||end-base.at(-1).ts>180000)return empty;
    const ret=mins=>{
      const target=end-mins*60000;
      const eligible=base.filter(p=>p.ts<=target);
      const ref=eligible.at(-1);
      return ref&&target-ref.ts<=60000?(px/ref.px-1)*100:null;
    };
    const m1=ret(1),m3=ret(3),m8=ret(8);
    const terms=[[m1,12,2.5],[m3,8,3],[m8,5,3.5]].filter(([v])=>valid(v));
    if(!terms.length)return empty;
    const signs=terms.filter(([v])=>Math.abs(v)>=0.02).map(([v])=>Math.sign(v));
    const agreement=signs.length>=2&&signs.every(v=>v===signs[0])?signs[0]:0;
    const score=terms.reduce((sum,[v,w,c])=>sum+clamp(v*w,-c,c),0)+agreement*0.8;
    return {available:true,m1,m3,m8,score:clamp(score,-8,8),agreement,horizons:terms.length};
  }
  function outcomeKnownBefore(r,beforeDay){
    for(const field of ['closedAt','checkedAt']){
      const value=r.actual?.[field];if(!value)continue;
      const ts=Date.parse(value);if(!Number.isFinite(ts)||clock(new Date(ts)).day>=beforeDay)return false;
    }
    return true;
  }
  function verified(records,{symbol,phase,modelVersion,beforeDay}){
    return (records||[]).filter(r=>r.symbol===symbol&&r.phase===phase&&r.modelVersion===modelVersion&&
      (r.targetDay||r.day)<beforeDay&&outcomeKnownBefore(r,beforeDay)&&!r.lateCreated&&valid(r.actual?.pct)&&Math.abs(Number(r.actual.pct))>1e-8&&valid(r.probability));
  }
  function calibrate(raw,records,options){
    // Bin boundaries fixed in advance; earlier outcomes only, with a 30-observation prior.
    const bin=p=>p<40?0:p<47?1:p<=53?2:p<=60?3:4;
    const rows=verified(records,options).filter(r=>bin(Number(r.rawProbability??r.probability))===bin(raw)).slice(-120);
    const n=rows.length;
    if(n<40)return {probability:raw,n,calibrated:false};
    const up=rows.filter(r=>Number(r.actual.pct)>0).length;
    const probability=Math.round(clamp(100*(up+30*raw/100)/(n+30),25,75));
    return {probability,n,calibrated:true};
  }
  function auditStats(records,{modelVersion,phase,beforeDay}){
    const rows=(records||[]).filter(r=>r.modelVersion===modelVersion&&(!phase||r.phase===phase)&&!r.lateCreated&&
      (r.targetDay||r.day)<beforeDay&&outcomeKnownBefore(r,beforeDay)&&valid(r.actual?.pct)&&Math.abs(Number(r.actual.pct))>1e-8&&valid(r.probability)).slice(-120);
    if(!rows.length)return null;
    const calls=rows.filter(r=>r.direction!=='方向不明');
    const hits=calls.filter(r=>(Number(r.probability)>=50)===(Number(r.actual.pct)>0)).length;
    const brier=rows.reduce((s,r)=>s+(Number(r.probability)/100-(Number(r.actual.pct)>0?1:0))**2,0)/rows.length;
    const baselineHits=calls.filter(r=>Number(r.actual.pct)>0).length;
    return {total:rows.length,n:calls.length,hits,coverage:calls.length/rows.length,brier,baselineHits};
  }
  function returns(bars,beforeDay){
    const sorted=(bars||[]).filter(b=>b.day<beforeDay&&Number(b.close)>0).slice().sort((a,b)=>a.day.localeCompare(b.day));
    const out=[];
    for(let i=1;i<sorted.length;i++){
      const prev=sorted[i-1],cur=sorted[i];
      const adjusted=Number(cur.adjustedClose)>0&&Number(prev.adjustedClose)>0;
      const r=(adjusted?Number(cur.adjustedClose)/Number(prev.adjustedClose):Number(cur.close)/Number(prev.close))-1;
      // Unadjusted structural breaks (splits/bad prints) cannot drive volatility estimates.
      if(Number.isFinite(r)&&Math.abs(r)<0.3)out.push(r);
    }
    return out;
  }
  function quantile(sorted,q){const x=(sorted.length-1)*q,i=Math.floor(x);return sorted[i]+(sorted[Math.ceil(x)]-sorted[i])*(x-i);}
  function priceBand(bars,price,{beforeDay,remainingMinutes=270}={}){
    if(!(price>0)||remainingMinutes<=0)return null;
    const rs=returns(bars,beforeDay).slice(-120).sort((a,b)=>a-b);
    if(rs.length<40)return null;
    const scale=Math.sqrt(clamp(remainingMinutes,5,270)/270);
    const lower=price*(1+Math.min(-0.001,quantile(rs,0.1)*scale));
    const upper=price*(1+Math.max(0.001,quantile(rs,0.9)*scale));
    return {lower,upper,sampleN:rs.length,method:'historical-80-reference',calibrated:false};
  }
  function replayBands(bars){
    const sorted=(bars||[]).filter(b=>Number(b.close)>0).slice().sort((a,b)=>a.day.localeCompare(b.day));
    let n=0,hits=0,mae=0;
    for(let i=41;i<sorted.length;i++){
      const prior=sorted.slice(0,i),next=sorted[i],last=prior.at(-1);
      const band=priceBand(prior,Number(last.close),{beforeDay:next.day});
      if(!band)continue;
      const r=Number(next.close)/Number(last.close)-1;
      if(Math.abs(r)>=0.3)continue;
      n++;hits+=Number(next.close)>=band.lower&&Number(next.close)<=band.upper?1:0;mae+=Math.abs(r)*100;
    }
    return {n,coverage:n?hits/n:null,persistenceMaePct:n?mae/n:null,method:'walk-forward-persistence-reference'};
  }
  function resourcePool(){
    const jobs=new Map();
    return {run(name,key,ttl,loader){
      const old=jobs.get(name);
      if(old?.key===key){if(old.promise)return old.promise;if(Date.now()-old.at<ttl)return Promise.resolve(old.value);}
      const entry={key,at:0,promise:null};
      const promise=Promise.resolve().then(loader).then(value=>{entry.value=value;entry.at=Date.now();entry.promise=null;return value;},error=>{entry.promise=null;if(jobs.get(name)===entry)jobs.delete(name);throw error;});
      entry.promise=promise;jobs.set(name,entry);return promise;
    }};
  }
  root.ZinfForecast={clock,nextSession,quoteFresh,outcome,metricsFresh,micro,calibrate,auditStats,priceBand,replayBands,resourcePool,valid};
})(globalThis);
