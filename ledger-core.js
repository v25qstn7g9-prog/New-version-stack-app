/* Issue #90：持股紀錄的純邏輯（估值來源／可比較漲跌／記交易草稿／配息／計畫進度／AI 事實核對）。
   瀏覽器與測試共用；沒有任何網路請求、不讀寫儲存、不改帳本。缺資料一律回 null（未知），不當成 0。 */
(function(root){
  const DAY=86400000;
  const fin=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
  const pos=v=>fin(v)&&Number(v)>0;
  const pad=n=>String(n).padStart(2,'0');
  const normSymbol=s=>String(s||'').trim().toUpperCase();
  const marketOf=s=>/^[0-9]/.test(normSymbol(s))?'TW':'US';
  const validYmd=s=>{
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const d=new Date(s+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
  };

  // ---------- 時區：台灣固定 +8；美股用紐約當地日期（含日光節約）----------
  function zoneClock(at,timeZone){
    const d=new Date(at);
    if(!Number.isFinite(d.getTime()))return null;
    if(timeZone==='Asia/Taipei'){
      const t=new Date(d.getTime()+8*3600000);
      return {day:t.toISOString().slice(0,10),minute:t.getUTCHours()*60+t.getUTCMinutes(),weekday:t.getUTCDay()};
    }
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(d);
    const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return {day:`${o.year}-${o.month}-${o.day}`,minute:(Number(o.hour)%24)*60+Number(o.minute),weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(o.weekday)};
  }
  const taipeiDay=at=>zoneClock(at,'Asia/Taipei')?.day||null;
  const MARKETS={TW:{zone:'Asia/Taipei',open:540,label:'台股'},US:{zone:'America/New_York',open:570,label:'美股'}};
  const shiftDay=(ymd,n)=>new Date(Date.parse(ymd+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
  const weekdayOf=ymd=>new Date(ymd+'T00:00:00Z').getUTCDay();
  const isSession=(ymd,holidays)=>![0,6].includes(weekdayOf(ymd))&&!(holidays&&holidays[ymd]);
  // 「現在應該看得到的最新一場交易」的市場當地日期：今天是交易日且已開盤→今天，否則往回找上一個交易日。
  function expectedSessionDay(market,now,holidays){
    const m=MARKETS[market],c=zoneClock(now,m.zone);
    if(!c)return null;
    let day=c.day;
    if(!(isSession(day,holidays)&&c.minute>=m.open))day=shiftDay(day,-1);
    for(let i=0;i<14&&!isSession(day,holidays);i++)day=shiftDay(day,-1);
    return day;
  }

  // ---------- 單檔報價事實 ----------
  // quote：{price, prevClose, isStale, asOfDate, source, priceSource}（App 既有 /quote 回傳的形狀）
  function quoteFact(symbol,quote,now,holidays){
    const sym=normSymbol(symbol),market=marketOf(sym),m=MARKETS[market];
    const ts=Date.parse(quote&&quote.asOfDate||'');
    const hasPrice=pos(quote&&quote.price),hasTime=Number.isFinite(ts);
    const marketDate=hasTime?zoneClock(ts,m.zone).day:null;
    const expected=expectedSessionDay(market,now,holidays&&holidays[market]);
    const src=String(quote&&quote.source||'');
    const fallback=hasPrice&&(/cache/i.test(src)||['last-seen','open','bid','ask'].includes(quote.priceSource));
    const future=hasTime&&ts>new Date(now).getTime()+60000;
    const stale=hasPrice&&(quote.isStale===true||!hasTime||future||(expected!=null&&marketDate<expected));
    return {symbol:sym,market,marketLabel:m.label,provider:src||null,priceSource:quote&&quote.priceSource||null,
      price:hasPrice?Number(quote.price):null,currency:market==='US'?'USD':'TWD',
      quoteTime:hasTime?new Date(ts).toISOString():null,marketDate,twDate:hasTime?taipeiDay(ts):null,expectedMarketDate:expected,
      missing:!hasPrice,stale,fallback};
  }

  // ---------- 持股總市值（新台幣）與來源 ----------
  // 規則與 App 既有算法一致：台股全部有報價才用即時價，否則整個台股改用「最近一筆每日紀錄」並明講；
  // 美股需要每檔報價＋匯率，否則用每日紀錄的美股市值。兩邊都沒有 → 未知（null），不是 0。
  // 匯率只乘一次：美元價 × 股數 × 匯率（× 券商校準係數）。每日紀錄的 twValue／usValue 已是新台幣，不再換算。
  function valuation(input){
    const {positions=[],quotes={},usQuotes={},fx=null,usFactor=1,now=new Date(),holidays=null,record=null}=input||{};
    const held=positions.map(p=>({symbol:normSymbol(p.symbol),name:p.name||'',shares:Number(p.shares)})).filter(p=>p.shares>0);
    const rows=held.map(p=>{
      const f=quoteFact(p.symbol,p.symbol&&marketOf(p.symbol)==='US'?usQuotes[p.symbol]:quotes[p.symbol],now,holidays);
      return {...f,name:p.name,shares:p.shares,valueNtd:null,fxRate:null};
    });
    const fxRate=pos(fx&&fx.rate)?Number(fx.rate):null;
    const fxTs=Date.parse(fx&&fx.asOf||'');
    const fxFact={rate:fxRate,source:fxRate?(fx.source||null):null,asOf:Number.isFinite(fxTs)?new Date(fxTs).toISOString():null,
      twDate:Number.isFinite(fxTs)?taipeiDay(fxTs):null,
      stale:fxRate!=null&&(!Number.isFinite(fxTs)||new Date(now).getTime()-fxTs>4*DAY)};
    const factor=pos(usFactor)?Number(usFactor):1;
    const part=(market)=>{
      const list=rows.filter(r=>r.market===market);
      if(!list.length){
        // 這個市場完全沒建持股、但每日紀錄有金額（只記每日資產的舊用法）→ 照 App 原本的做法沿用那筆紀錄，並標明來源。
        const k=market==='TW'?'twValue':'usValue';
        if(!positions.some(p=>marketOf(p.symbol)===market)&&record&&validYmd(record.date)&&pos(record[k]))return {market,mode:'record',valueNtd:Math.round(Number(record[k])),missing:[],reason:'no_positions',recordDate:record.date};
        return {market,mode:'none',valueNtd:0,missing:[]};
      }
      const missing=list.filter(r=>r.missing).map(r=>r.symbol);
      const liveOk=!missing.length&&(market==='TW'||fxRate!=null);
      if(liveOk){
        let sum=0;
        for(const r of list){
          r.fxRate=market==='US'?fxRate:null;
          r.valueNtd=market==='US'?r.price*r.shares*fxRate*factor:r.price*r.shares;
          sum+=r.valueNtd;
        }
        return {market,mode:'live',valueNtd:Math.round(sum),missing:[]};
      }
      const key=market==='TW'?'twValue':'usValue';
      const reason=missing.length?'missing_quote':'missing_fx';
      if(record&&validYmd(record.date)&&fin(record[key]))return {market,mode:'record',valueNtd:Math.round(Number(record[key])),missing,reason,recordDate:record.date};
      return {market,mode:'unknown',valueNtd:null,missing,reason};
    };
    const tw=part('TW'),us=part('US');
    const parts=[tw,us].filter(p=>p.mode!=='none');
    const unknown=parts.some(p=>p.mode==='unknown');
    const usedRecord=parts.some(p=>p.mode==='record');
    const liveRows=rows.filter(r=>r.valueNtd!=null);
    const stale=liveRows.some(r=>r.stale)||(us.mode==='live'&&fxFact.stale);
    const fallbackPrice=liveRows.some(r=>r.fallback);
    const twDates=[...new Set(liveRows.map(r=>r.twDate).filter(Boolean))].sort();
    const marketDates={};
    for(const mk of ['TW','US']){const ds=[...new Set(liveRows.filter(r=>r.market===mk).map(r=>r.marketDate).filter(Boolean))].sort();if(ds.length)marketDates[mk]=ds;}
    // 同一個市場裡出現不同交易日的價格＝日期混用（台美本來就差一個交易日，不算混用）
    const mixedDates=Object.values(marketDates).some(ds=>ds.length>1);
    const times=liveRows.map(r=>r.quoteTime).filter(Boolean).sort();
    const status=!parts.length?'empty':unknown?'unknown':usedRecord?(parts.every(p=>p.mode==='record')?'fallback':'partial'):stale||mixedDates?'stale':'complete';
    return {status,totalNtd:!parts.length?0:unknown?null:parts.reduce((s,p)=>s+p.valueNtd,0),
      complete:status==='complete',tw,us,rows,fx:us.mode==='none'?null:fxFact,usFactor:factor,
      flags:{partial:parts.some(p=>p.missing.length>0)||usedRecord&&!parts.every(p=>p.mode==='record'),stale,fallbackPrice,fallbackRecord:usedRecord,mixedDates,unknown},
      missing:parts.flatMap(p=>p.missing),
      asOf:{oldest:times[0]||null,newest:times[times.length-1]||null,twDates,marketDates,recordDate:usedRecord?(record&&record.date)||null:null}};
  }
  const STATUS_TEXT={complete:'即時報價完整',stale:'報價不是最新',partial:'部分用每日紀錄',fallback:'用最近一筆每日紀錄',unknown:'資料不足',empty:'尚無持股'};
  function hhmm(iso){const c=zoneClock(iso,'Asia/Taipei');return c?`${pad(Math.floor(c.minute/60))}:${pad(c.minute%60)}`:'';}
  const md=ymd=>ymd?`${Number(ymd.slice(5,7))}/${Number(ymd.slice(8,10))}`:'';
  // 首頁那一行「資料時間・來源」：只用 valuation 裡已核對的欄位組字。
  function asOfLine(v){
    if(!v||v.status==='empty')return '尚無持股';
    if(v.status==='unknown')return `資料不足：${v.missing.length?v.missing.join('、')+' 沒有報價':'缺匯率'}，也沒有每日紀錄可用`;
    if(v.status==='fallback')return `${md(v.asOf.recordDate)} 每日紀錄（即時報價不完整）`;
    const t=v.asOf.newest?`${md(taipeiDay(v.asOf.newest))} ${hhmm(v.asOf.newest)} 報價`:'報價時間不明';
    if(v.status==='partial')return `${t}＋${md(v.asOf.recordDate)} 每日紀錄（部分缺報價）`;
    if(v.status==='stale')return `${t}（${v.flags.mixedDates?'各檔日期不一致':'不是最新'}）`;
    return t;
  }

  // ---------- 可比較的當日漲跌 ----------
  // 只回兩種可比較的結果：①每檔「(現價−昨收)×同一股數」②同一批持股、完整即時市值對上一筆每日紀錄（中間沒有買賣）。
  // 其他情況（部分報價、日期混用、中間有買賣＝摻了現金流）一律 comparable:false，畫面顯示「—」。
  function comparableChange(input){
    const {valuation:v,quoteDay=null,prevRecord=null,trades=[],today=null}=input||{};
    if(!v||v.status==='empty')return {comparable:false,reason:'empty'};
    if(v.status==='unknown')return {comparable:false,reason:'unknown'};
    if(v.flags.partial||v.flags.fallbackRecord)return {comparable:false,reason:'partial'};
    if(v.flags.mixedDates)return {comparable:false,reason:'mixed_dates'};
    if(quoteDay&&fin(quoteDay.change)&&fin(quoteDay.pct))return {comparable:true,basis:'prevClose',change:Math.round(Number(quoteDay.change)),pct:Number(quoteDay.pct),vsDate:null};
    if(!prevRecord||!validYmd(prevRecord.date)||!fin(prevRecord.twValue))return {comparable:false,reason:'no_baseline'};
    const base=Number(prevRecord.twValue)+Number(prevRecord.usValue||0);
    if(!(base>0))return {comparable:false,reason:'no_baseline'};
    const flow=trades.some(t=>t&&typeof t.date==='string'&&t.date>prevRecord.date&&(!today||t.date<=today));
    if(flow)return {comparable:false,reason:'cash_flow',vsDate:prevRecord.date};
    const change=v.totalNtd-base;
    return {comparable:true,basis:'record',change,pct:change/base*100,vsDate:prevRecord.date};
  }
  const CHANGE_REASON={empty:'尚無持股',unknown:'資料不足，無法比較',partial:'報價不完整，不比較',mixed_dates:'各檔報價日期不同，不比較',no_baseline:'沒有可比較的前一筆紀錄',cash_flow:'期間有買賣，漲跌不含在內'};

  // ---------- 記交易草稿 ----------
  const DRAFT_FIELDS=['date','action','symbol','shares','price','fee','tax','note'];
  function defaultTradeDraft(now=new Date(),preset={}){
    return {date:taipeiDay(now),action:'buy',symbol:'',shares:'',price:'',fee:'',tax:'',note:'',...preset};
  }
  // 預設值更新（跨日、換預選代號）時只覆蓋「使用者沒碰過」的欄位。
  function refreshDraft(draft,touched,defaults){
    const out={...draft};
    for(const k of Object.keys(defaults||{}))if(!(touched&&touched[k]))out[k]=defaults[k];
    return out;
  }
  // 小數字串 → 數字；接受千分位與全形數字；空白、負數、非數字 → null（不是 0）。
  function parseDecimal(value){
    if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
    const s=String(value??'').trim().replace(/[０-９．]/g,c=>c==='．'?'.':String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/,/g,'');
    if(!/^\d*\.?\d+$|^\d+\.$/.test(s))return null;
    const n=Number(s);
    return Number.isFinite(n)?n:null;
  }
  const SYMBOL_RE=/^(?:[0-9]{4,6}[A-Z]?|[A-Z][A-Z0-9]{0,9}(?:[.-][A-Z0-9]+)?)$/;
  function validateTrade(draft){
    const missing=[],errors=[];
    const symbol=normSymbol(draft&&draft.symbol);
    const shares=parseDecimal(draft&&draft.shares),price=parseDecimal(draft&&draft.price);
    const feeRaw=String(draft&&draft.fee!=null?draft.fee:'').trim(),taxRaw=String(draft&&draft.tax!=null?draft.tax:'').trim();
    const fee=feeRaw===''?0:parseDecimal(feeRaw),tax=draft&&draft.action==='sell'?(taxRaw===''?0:parseDecimal(taxRaw)):0;
    if(!symbol)missing.push('代號');else if(!SYMBOL_RE.test(symbol)||['TAIEX','SPX','SOX','USDTWD'].includes(symbol))errors.push('代號格式不對');
    if(!(shares>0))missing.push('股數');
    if(!(price>0))missing.push('成交價');
    if(!validYmd(draft&&draft.date))errors.push('日期不正確');
    if(!['buy','sell'].includes(draft&&draft.action))errors.push('買賣別不正確');
    if(fee==null)errors.push('手續費不正確');
    if(tax==null)errors.push('交易稅不正確');
    const ok=!missing.length&&!errors.length;
    if(ok){
      const gross=shares*price,amount=draft.action==='buy'?gross+fee:gross-fee-tax;
      if(!(amount>=0))return {ok:false,missing,errors:['費用超過成交金額']};
      return {ok:true,missing,errors,fields:{date:draft.date,symbol,action:draft.action,shares,price,fee,tax,amount,note:String(draft.note||'')}};
    }
    return {ok:false,missing,errors};
  }
  // 與既有「交易紀錄」新增表單同一個資料形狀（不改帳本格式）。
  function buildTrade(draft,id){
    const v=validateTrade(draft);
    if(!v.ok||!id)return null;
    const f=v.fields;
    return {id,date:f.date,symbol:f.symbol,action:f.action,shares:f.shares,price:f.price,fee:f.fee,tax:f.tax,amount:f.amount,nativeAmount:f.amount,currency:'TWD',fxRate:1,note:f.note};
  }
  // 連點／重送去重：同一份草稿（draftKey）只會成立一次，之後回傳第一次的結果。
  function createSubmitGate(){
    const done=new Map();
    return {
      submit(draftKey,fn){
        if(done.has(draftKey))return {accepted:false,duplicate:true,result:done.get(draftKey)};
        const result=fn();
        if(result==null)return {accepted:false,duplicate:false,result:null};
        done.set(draftKey,result);
        return {accepted:true,duplicate:false,result};
      },
      has:k=>done.has(k),
    };
  }
  // 畫面排序（日期新到舊，同一天維持輸入順序）下，用 id 找「剛剛那一筆」；同日多筆也不會找錯。
  function sortTradesForDisplay(trades){
    return (trades||[]).map((t,i)=>({t,i})).sort((a,b)=>String(b.t.date).localeCompare(String(a.t.date))||a.i-b.i).map(x=>x.t);
  }
  function locateTrade(trades,id){
    const list=sortTradesForDisplay(trades),index=list.findIndex(t=>t&&t.id===id);
    return index<0?null:{index,row:list[index],sameDay:list.filter(t=>t.date===list[index].date).length};
  }
  // 交易的新台幣金額：已存的 amount 就是新台幣，直接用；只有舊的美元紀錄才用「當時存的匯率」換一次，沒有就未知。
  function tradeNtd(t,opts={}){
    if(!t)return null;
    if(fin(t.amount))return Number(t.amount);
    const native=fin(t.nativeAmount)?Number(t.nativeAmount):null;
    if(native==null)return null;
    if(t.currency!=='USD')return native;
    const rate=pos(t.fxRate)?Number(t.fxRate):pos(opts.historicalFx&&opts.historicalFx[t.date])?Number(opts.historicalFx[t.date]):null;
    return rate==null?null:native*rate;
  }
  // 現金流（買進付出、賣出收回）與損益分開：這裡只算現金流，不含任何漲跌。
  function cashFlow(trades,from,to){
    let out=0,inn=0,unknown=0;
    for(const t of trades||[]){
      if(!t||(from&&t.date<from)||(to&&t.date>to))continue;
      const n=tradeNtd(t);
      if(n==null){unknown++;continue;}
      if(t.action==='buy')out+=n;else inn+=n;
    }
    return {paidNtd:Math.round(out),receivedNtd:Math.round(inn),netNtd:Math.round(out-inn),unknownCount:unknown};
  }

  // ---------- 配息：公告 vs 實際入帳 ----------
  // 查公告是非同步的：回來時只填使用者沒碰過的欄位；代號已經改掉、或不是最新一次查詢 → 整包丟掉。
  function applyPrefill(draft,touched,patch,guard={}){
    if(guard.symbol!=null&&normSymbol(draft&&draft.symbol)!==normSymbol(guard.symbol))return draft;
    if(guard.seq!=null&&guard.latestSeq!=null&&guard.seq!==guard.latestSeq)return draft;
    let changed=false;const out={...draft};
    for(const k of Object.keys(patch||{})){
      if(patch[k]==null||patch[k]===''||(touched&&touched[k])||out[k]===patch[k])continue;
      out[k]=patch[k];changed=true;
    }
    return changed?out:draft;
  }
  // 公告金額（每股、可能是預估）與「實際入帳的新台幣」分開列；沒記入帳就是未知，不拿公告去估。
  function dividendFacts(symbol,announcement,logged){
    const sym=normSymbol(symbol);
    const mine=(logged||[]).filter(d=>d&&normSymbol(d.symbol)===sym);
    const known=mine.filter(d=>fin(d.amount));
    const a=announcement&&announcement.found!==false?announcement:null;
    return {symbol:sym,
      announced:a?{date:a.date||null,perShare:fin(a.cashDividend)?Number(a.cashDividend):fin(a.estimatedDividend)?Number(a.estimatedDividend):null,
        estimated:!fin(a.cashDividend)&&fin(a.estimatedDividend),official:fin(a.cashDividend)}:null,
      actual:{count:mine.length,ntd:known.length?Math.round(known.reduce((s,d)=>s+Number(d.amount),0)):null,unknownCount:mine.length-known.length,lastDate:mine.map(d=>d.date).filter(Boolean).sort().pop()||null}};
  }

  // ---------- 計畫進度 ----------
  const daysInMonth=(y,m0)=>new Date(Date.UTC(y,m0+1,0)).getUTCDate();
  // 第 n 個月的日期一律從「原始開始日」算：1/31 → 2/28 → 3/31，不會因為二月變短就一路卡在 28 號。
  function scheduleDate(anchor,n){
    if(!validYmd(anchor)||!Number.isFinite(Number(n)))return null;
    const [y,m,d]=anchor.split('-').map(Number),total=(m-1)+Math.trunc(Number(n));
    const yy=y+Math.floor(total/12),mm=((total%12)+12)%12;
    return `${yy}-${pad(mm+1)}-${pad(Math.min(d,daysInMonth(yy,mm)))}`;
  }
  const scheduleLabel=(anchor,n)=>{const s=scheduleDate(anchor,n);return s?`${s.slice(0,4)}/${s.slice(5,7)}`:'—';};
  // 從開始日到某一天過了幾個月（整月數用上面的日期算，剩下的天數按該期實際天數比例）。
  function elapsedMonths(anchor,date){
    if(!validYmd(anchor)||!validYmd(date)||date<anchor)return null;
    const [ay,am]=anchor.split('-').map(Number),[dy,dm]=date.split('-').map(Number);
    let k=(dy-ay)*12+(dm-am);
    if(scheduleDate(anchor,k)>date)k--;
    const a=Date.parse(scheduleDate(anchor,k)+'T00:00:00Z'),b=Date.parse(scheduleDate(anchor,k+1)+'T00:00:00Z');
    return k+(Date.parse(date+'T00:00:00Z')-a)/(b-a);
  }
  function planAt(schedule,months,key){
    if(!Array.isArray(schedule)||!schedule.length||!fin(months)||months<0||months>schedule.length-1)return null;
    const i=Math.floor(months),f=months-i,a=Number(schedule[i][key]);
    if(f===0||i+1>=schedule.length)return a;
    return a+(Number(schedule[i+1][key])-a)*f;
  }
  function crossing(schedule,key,target){
    if(!Array.isArray(schedule)||!schedule.length||!fin(target))return null;
    if(target<=schedule[0][key])return {index:0};
    for(let i=1;i<schedule.length;i++)if(schedule[i][key]>=target){
      const p=schedule[i-1][key],c=schedule[i][key];
      return {index:i-1+(c===p?0:(target-p)/(c-p))};
    }
    return {index:schedule.length-1,beyond:true};
  }
  // 「實際」與「計畫」一定用同一天：actual = {date, value, complete}，計畫取同一天的排程值。
  // 資料不完整／沒有日期 → unknown；超出推算年限 → 不給精確的領先月數。
  function progressCompare(input){
    const {schedule,startDate,key,actual}=input||{};
    if(!actual||!validYmd(actual.date)||!fin(actual.value)||actual.complete===false)return {status:'unknown',lead:null,planValue:null,diff:null,reason:!actual||!validYmd(actual&&actual.date)?'no_date':actual.complete===false?'incomplete':'no_value'};
    const months=elapsedMonths(startDate,actual.date);
    if(months==null)return {status:'unknown',lead:null,planValue:null,diff:null,reason:'before_start',date:actual.date};
    const horizon=(schedule||[]).length-1;
    if(!(horizon>=0))return {status:'unknown',lead:null,planValue:null,diff:null,reason:'no_plan',date:actual.date};
    if(months>horizon)return {status:'beyond_horizon',lead:null,planValue:null,diff:null,months,horizon,date:actual.date};
    const planValue=planAt(schedule,months,key),c=crossing(schedule,key,Number(actual.value));
    const diff=Number(actual.value)-planValue;
    if(c.beyond)return {status:'ahead_beyond_horizon',lead:null,leadAtLeast:horizon-months,planValue,diff,months,horizon,date:actual.date};
    const lead=c.index-months;
    return {status:Math.abs(lead)<0.05?'on_track':lead>0?'ahead':'behind',lead,planValue,diff,months,horizon,date:actual.date,crossingIndex:c.index};
  }
  // 已投入本金：只認使用者自己設定的起始本金＋計畫開始後的買賣現金流；沒有設定就是未知，不拿「持有成本」來當本金。
  function contributedPrincipal(input){
    const {initialPrincipal,startDate,trades=[],asOf=null}=input||{};
    if(!fin(initialPrincipal)||!validYmd(startDate))return {ntd:null,reason:'no_principal_baseline'};
    const flow=cashFlow(trades.filter(t=>t&&t.date>startDate),null,asOf);
    if(flow.unknownCount)return {ntd:null,reason:'unknown_trade_amount'};
    return {ntd:Math.round(Number(initialPrincipal)+flow.netNtd),basis:'initial_plus_net_trades',since:startDate};
  }

  // 抽屜不把舊報價說成「當日」；保留原本的估值與首頁比較演算法。
  function sourceDrawerChange(v,change){
    let reasonText=change&&!change.comparable?CHANGE_REASON[change.reason]:null;
    if(v?.flags?.mixedDates)reasonText=CHANGE_REASON.mixed_dates;
    else if(v?.status==='stale'||v?.flags?.stale)reasonText=STATUS_TEXT.stale;
    else if(v?.flags?.fallbackPrice)reasonText='部分使用備援價，暫不比較';
    if(reasonText||v?.status!=='complete'||!change?.comparable||!Number.isFinite(change.change)||!Number.isFinite(change.pct)||(change.basis==='record'&&!validYmd(change.vsDate))){
      return {comparable:false,reasonText:reasonText||'無法比較'};
    }
    return change;
  }
  function sourceDrawerCashFlow(flow){
    const partial=flow?.unknownCount>0;
    const subtotal=n=>Number.isFinite(n)&&(!partial||n!==0)?n:null;
    return {partial,paidNtd:subtotal(flow?.paidNtd),receivedNtd:subtotal(flow?.receivedNtd)};
  }

  // 來源抽屜的白話摘要，只呈現同一次畫面的既有數值，不重新估值／計算報酬。
  function sourceDrawerExplanation({valuation:v,totalNtd,change,cashFlow:flow}={}){
    const known=n=>typeof n==='number'&&Number.isFinite(n);
    const money=(n,signed=false)=>known(n)?`NT$ ${n>0&&signed?'+':''}${n.toLocaleString('zh-TW',{maximumFractionDigits:0})}`:'未知';
    const total=v&&v.status!=='unknown'&&known(totalNtd)
      ? `持股總市值 ${money(totalNtd)}`
      : '持股總市值目前未知';
    const context=v?[STATUS_TEXT[v.status],asOfLine(v)].filter(Boolean):[];
    const lines=[`${total}${context.length?`（${context.join('；')}）`:''}。`];

    const showChange=sourceDrawerChange(v,change);
    if(showChange.comparable){
      // 先收斂到顯示精度；避免把四捨五入後的零寫成上漲或下跌。
      const amount=Math.sign(showChange.change)*Math.round(Math.abs(showChange.change))||0;
      const pct=Number(showChange.pct.toFixed(2))||0;
      const pctText=`${pct>0?'+':''}${pct.toFixed(2)}%`;
      const scope=showChange.basis==='record'?`較 ${showChange.vsDate} 每日紀錄`:'當日';
      const direction=amount>0&&pct>0?'上漲':amount<0&&pct<0?'下跌':
        amount===0&&pct===0?'漲跌在顯示精度下為':showChange.basis==='record'?'的差額':'價格變動';
      lines.push(`${scope}${direction} ${money(amount,true)}（${pctText}）。`);
    }else{
      lines.push(`當日漲跌暫不顯示：${showChange.reasonText}。`);
    }

    if(v?.us&&v.us.mode!=='none'){
      const fx=v.fx;
      const detail=[fx?.source,fx?.twDate,fx?.stale?'不是最新':null].filter(Boolean);
      const rate=known(fx?.rate)&&fx.rate>0?fx.rate:null;
      lines.push(`美元匯率：${rate??'未知'}${rate!=null&&detail.length?`（${detail.join('；')}）`:''}。`);
    }

    if(flow){
      const {partial,paidNtd,receivedNtd}=sourceDrawerCashFlow(flow);
      lines.push(`${partial?'已知部分：':''}今天買進付出 ${money(paidNtd)}，賣出收回 ${money(receivedNtd)}；這是現金流，不是損益。${partial?'另有交易金額未知，不算入上述小計。':''}`);
    }
    return lines.join('\n');
  }

  root.ZinfLedger={marketOf,taipeiDay,zoneClock,expectedSessionDay,quoteFact,valuation,asOfLine,STATUS_TEXT,comparableChange,CHANGE_REASON,
    DRAFT_FIELDS,defaultTradeDraft,refreshDraft,parseDecimal,validateTrade,buildTrade,createSubmitGate,sortTradesForDisplay,locateTrade,tradeNtd,cashFlow,
    applyPrefill,dividendFacts,scheduleDate,scheduleLabel,elapsedMonths,planAt,crossing,progressCompare,contributedPrincipal,
    sourceDrawerChange,sourceDrawerCashFlow,sourceDrawerExplanation,validYmd,hhmm};
})(globalThis);
