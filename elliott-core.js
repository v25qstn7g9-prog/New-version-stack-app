/* 艾略特波浪圖層的純計算（加權指數／0050／0056 日線）。瀏覽器與測試共用。
   沒有任何網路請求、不讀寫儲存、不改帳本；輸入只有日K（day/high/low/close），輸出轉折、計數、規則檢查、關卡與失效價。
   所有價位都由輸入資料算出來，程式裡不寫任何實際指數或股價。結果不確定時明說「不確定」，不硬套。 */
(function(root){
  // ---------- 可調常數（集中在這裡） ----------
  const CANDIDATE_THRESHOLDS=[3,4,5,6,7,8,10,12];   // zigzag 候選門檻（%）
  const ATR_DAYS=60;                                // 波動度：近 60 個交易日平均真實波幅（ATR%）
  const ATR_BAND=[1.5,4.5];                         // 門檻落在 ATR% 的 1.5～4.5 倍之間不扣分，太小＝雜訊、太大＝看不到結構
  const MIN_BARS=60;                                // 少於這麼多根日K就不算
  const MIN_SCORE=0.55;                             // 主要計數分數低於這個值 → 不確定
  const CLOSE_MARGIN=0.06;                          // 主要與替代分數差距小於這個值 → 不確定
  const MAX_ALTERNATIVES=2;
  const SCENARIO_RATES={pessimistic:0.02,neutral:0.05,optimistic:0.08}; // 2055 情境的假設年化報酬（價格指數，不含股息）
  const SCENARIO_YEAR=2055;
  const FIB=[0.382,0.5,0.618];
  const STATUS_TEXT={valid:'成立',uncertain:'不確定',invalid:'計數不成立',insufficient:'資料不足'};
  const DISCLAIMER='僅供參考，不構成投資建議。轉折點與比例由程式計算。';
  const SCENARIO_NOTE='假設情境，不是預測';

  const DAY=86400000;
  const fin=v=>v!=null&&v!==''&&Number.isFinite(Number(v));
  const r2=v=>Math.round(v*100)/100;
  const r4=v=>Math.round(v*10000)/10000;
  // 真實日期：格式 YYYY-MM-DD，且 UTC 解析後的年月日要和原字串一致（擋掉 2025-13-01、2025-04-31、2025-02-29 這種不存在的日期）。
  const ymd=s=>{
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const t=Date.parse(s+'T00:00:00Z');
    return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
  };
  const calDays=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/DAY);
  const fmt=v=>{const n=Number(v);return Math.abs(n)>=1000?n.toLocaleString('en-US',{maximumFractionDigits:0}):String(r2(n));};

  // ---------- 資料整理 ----------
  // 只留完整的日K；盤中未收盤的「今天」那根不算（照 App 既有 historyPhase：台北 820 分鐘（13:40）以後才算收盤）。
  function completedBars(bars,todayKey,minute){
    const list=(Array.isArray(bars)?bars:[]).filter(b=>b&&ymd(b.day)&&[b.high,b.low,b.close].every(v=>fin(v)&&Number(v)>0)&&Number(b.high)>=Number(b.low))
      .map(b=>({day:b.day,high:Number(b.high),low:Number(b.low),close:Number(b.close)}))
      .sort((a,b)=>a.day<b.day?-1:a.day>b.day?1:0);
    const out=[];
    for(const b of list){
      if(out.length&&out[out.length-1].day===b.day)continue;
      if(ymd(todayKey)){
        if(b.day>todayKey)continue;
        if(b.day===todayKey&&!(fin(minute)&&Number(minute)>=820))continue;
      }
      out.push(b);
    }
    return out;
  }

  function atrPct(bars,n=ATR_DAYS){
    if(!Array.isArray(bars)||bars.length<3)return null;
    const from=Math.max(1,bars.length-n);let s=0,k=0;
    for(let i=from;i<bars.length;i++){const pc=bars[i-1].close;if(!(pc>0))continue;s+=(Math.max(bars[i].high,pc)-Math.min(bars[i].low,pc))/pc;k++;}
    return k?s/k*100:null;
  }

  // ---------- 1. 轉折點（zigzag） ----------
  // 反轉超過 pct% 才確認轉折；高點用 high、低點用 low，並記錄當天 close。最後一個極值尚未被反轉確認 → confirmed:false（進行中）。
  function zigzag(bars,pct){
    const p=Number(pct)/100;
    if(!Array.isArray(bars)||bars.length<2||!(p>0))return {pivots:[],inProgress:null};
    const mk=(i,type)=>({i,day:bars[i].day,type,price:type==='H'?bars[i].high:bars[i].low,close:bars[i].close,confirmed:true});
    const piv=[];let trend=0,hi=0,lo=0,ext=0;
    // 初始化依時間順序：同時追蹤到目前為止的候選高點 hi、候選低點 lo；之後某一根相對其中一個候選反向達 pct%，
    // 就確立第一個轉折（候選本身），延伸端取該候選之後到這一根為止的最極端價。
    // 只看「這一根」是否從較早的候選反轉，所以首根（或初始化期間）是涵蓋後續區間的外包日K時，後續反轉仍會被確認。
    const extAfter=(from,to,t)=>{let k=from+1;for(let j=from+2;j<=to;j++)if(t===1?bars[j].high>bars[k].high:bars[j].low<bars[k].low)k=j;return k;};
    for(let i=1;i<bars.length;i++){
      const b=bars[i];
      if(trend===0){
        if(b.high>bars[hi].high)hi=i;
        if(b.low<bars[lo].low)lo=i;
        // 只認「從較早的候選」反轉：這一根自己創新高（hi===i）就不能拿它確認下跌，反之亦然。
        const upOk=lo<i&&b.high>=bars[lo].low*(1+p), dnOk=hi<i&&b.low<=bars[hi].high*(1-p);
        // 同一根同時達到兩個方向（大外包日K）：較早的候選先確立；同一根候選時取超過門檻較多的方向。
        const up=upOk&&(!dnOk||lo<hi||(lo===hi&&b.high/bars[lo].low>=bars[hi].high/b.low));
        if(up){piv.push(mk(lo,'L'));trend=1;ext=extAfter(lo,i,1);}
        else if(dnOk){piv.push(mk(hi,'H'));trend=-1;ext=extAfter(hi,i,-1);}
        continue;
      }
      if(trend===1){
        if(b.high>bars[ext].high)ext=i;
        else if(b.low<=bars[ext].high*(1-p)){piv.push(mk(ext,'H'));trend=-1;ext=i;}
      }else{
        if(b.low<bars[ext].low)ext=i;
        else if(b.high>=bars[ext].low*(1+p)){piv.push(mk(ext,'L'));trend=1;ext=i;}
      }
    }
    if(trend===0)return {pivots:[],inProgress:null};
    const last=mk(ext,trend===1?'H':'L');last.confirmed=false;
    piv.push(last);
    const lb=bars[bars.length-1];
    const prev=piv.length>1?piv[piv.length-2]:null;
    // 進行中＝最後一個已確認轉折 → 目前極值（還沒被反向 pct% 確認，可能再延伸）；之後的小幅反向走勢收在 lastClose。
    return {pivots:piv,inProgress:{from:prev?{day:prev.day,price:prev.price,close:prev.close,i:prev.i}:null,extreme:{day:last.day,price:last.price,close:last.close,i:last.i},
      direction:trend===1?'up':'down',lastDay:lb.day,lastClose:lb.close,note:'最後一段（到目前的'+(trend===1?'最高點':'最低點')+'）尚未被反向走勢確認，仍在進行中'}};
  }

  // ---------- 小工具 ----------
  // x 落在 [lo,hi] 給 1，往外線性遞減，距離 w 時為 0。
  const fit=(x,lo,hi,w)=>!Number.isFinite(x)?0:x>=lo&&x<=hi?1:Math.max(0,1-(x<lo?lo-x:x-hi)/w);
  const nearAny=(x,targets,tol)=>Math.max(0,...targets.map(t=>fit(x,t*(1-tol),t*(1+tol),t*0.5)));
  const pt=pv=>({day:pv.day,price:r2(pv.price),close:r2(pv.close),i:pv.i});
  function fibLevels(s,e){const d=e-s;return {r382:r2(e-0.382*d),r500:r2(e-0.5*d),r618:r2(e-0.618*d)};}
  function wave(label,a,b,inProgress){
    return {label,start:pt(a),end:pt(b),tradingDays:b.i-a.i,calendarDays:calDays(a.day,b.day),change:r2(b.price-a.price),
      pct:r2((b.price/a.price-1)*100),fib:fibLevels(a.price,b.price),inProgress:!!inProgress};
  }
  const len=(a,b)=>Math.abs(b.price-a.price);
  const rule=(id,text,state,detail)=>({id,text,pass:state==='pass',state,detail});

  // 被修正的那段走勢的起點：從 A 浪起點往回找，直到出現比 A 浪起點更極端的價格為止，這中間最遠的反向極值。
  // （例如 A 浪從高點開始跌：往回找到第一根比這個高點還高的日K為止，中間的最低點就是這段漲勢的起點。）
  function priorTrendStart(bars,aIdx,d){
    if(!(aIdx>0))return null;
    const top=d===1?bars[aIdx].high:bars[aIdx].low;let ext=null;
    for(let i=aIdx-1;i>=0;i--){
      const b=bars[i];
      if(d===1?b.high>top:b.low<top)break;
      const v=d===1?b.low:b.high;
      if(ext==null||(d===1?v<ext.price:v>ext.price))ext={i,day:b.day,price:v};
    }
    return ext;
  }

  // ---------- 2～4. 計數候選、硬性規則、評分 ----------
  // 每種型態都「結束在最後一個轉折」（最後一段可能還在進行中）。方向由轉折型態決定。
  const PATTERNS=[
    {id:'I3',labels:['1','2','3'],kind:'impulse',text:'推動浪第 3 浪進行中'},
    {id:'I4',labels:['1','2','3','4'],kind:'impulse',text:'推動浪第 4 浪'},
    {id:'I5',labels:['1','2','3','4','5'],kind:'impulse',text:'推動浪第 5 浪'},
    {id:'I5A',labels:['1','2','3','4','5','A'],kind:'impulse+abc',text:'5 浪推動完成，A 浪修正'},
    {id:'I5AB',labels:['1','2','3','4','5','A','B'],kind:'impulse+abc',text:'5 浪推動完成，B 浪反彈'},
    {id:'I5ABC',labels:['1','2','3','4','5','A','B','C'],kind:'impulse+abc',text:'5 浪推動＋A–B–C 修正'},
    // 獨立的 A–B–C 修正（還沒出現新的第 1 浪）：方向＝被修正那段走勢的方向，修正必須留在那段走勢的起點之內
    {id:'A',labels:['A'],kind:'abc',text:'修正 A 浪進行中'},
    {id:'AB',labels:['A','B'],kind:'abc',text:'修正 A 浪完成，B 浪反彈'},
    {id:'ABC',labels:['A','B','C'],kind:'abc',text:'A–B–C 修正，C 浪進行中'},
    {id:'ABC1',labels:['A','B','C','1'],kind:'abc+new',text:'A–B–C 修正完成，新推動第 1 浪'},
    {id:'ABC12',labels:['A','B','C','1','2'],kind:'abc+new',text:'A–B–C 修正完成，新推動第 2 浪'},
    {id:'ABC123',labels:['A','B','C','1','2','3'],kind:'abc+new',text:'A–B–C 修正完成，新推動第 3 浪'},
  ];

  function evaluate(pattern,pv,bars){
    const n=pattern.labels.length;
    if(pv.length<n+1)return null;
    const P=pv.slice(pv.length-n-1);           // n+1 個點、n 段
    const lastOpen=!P[n].confirmed;            // 最後一段還在進行中
    const L={};pattern.labels.forEach((lb,k)=>{L[lb]=[P[k],P[k+1],k===n-1&&lastOpen];});
    // 推動方向：數字浪 1 的方向；只有 ABC 時以「修正之後的新推動」方向
    const first=P[0],second=P[1];
    const segDir=(a,b)=>b.price>a.price?1:-1;
    const corrFirst=pattern.kind==='abc+new'||pattern.kind==='abc';
    const d=corrFirst?-segDir(first,second):segDir(first,second); // 推動（數字浪）方向；獨立 A–B–C＝被修正那段走勢的方向
    const up=d===1, word=up?{beyond:'高於',below:'低於',break:'跌破',over:'突破'}:{beyond:'低於',below:'高於',break:'突破',over:'跌破'};
    const rules=[],ratios=[],soft=[];
    const done=lb=>L[lb]&&!L[lb][2];
    const W=lb=>L[lb]?len(L[lb][0],L[lb][1]):NaN;
    const dir=lb=>L[lb]?segDir(L[lb][0],L[lb][1]):0;
    const addSoft=(name,value,score,weight,ideal)=>{ratios.push({name,value:typeof value==='boolean'?value:r4(value),ideal,score:r4(score)});soft.push([score,weight]);};
    const T=lb=>L[lb]?L[lb][1].i-L[lb][0].i:NaN;

    // 推動浪 1-5
    if(L['1']&&L['2']&&(pattern.kind!=='abc+new'||true)){
      const s1=L['1'][0],e1=L['1'][1],e2=L['2'][1];
      const ok=d*(e2.price-s1.price)>0;
      rules.push(rule('w2_start','第 2 浪不可'+(up?'跌破':'突破')+'第 1 浪起點',ok?'pass':'fail',
        `第 2 浪${up?'低點':'高點'} ${fmt(e2.price)}；第 1 浪起點 ${fmt(s1.price)}`));
    }
    if(L['3']){
      const e1=L['1'][1],e3=L['3'][1],open3=L['3'][2];
      const ok=d*(e3.price-e1.price)>0;
      rules.push(rule('w3_beyond_w1','第 3 浪要超過第 1 浪終點',ok?'pass':open3?'pending':'fail',
        `第 3 浪${open3?'目前':''}${up?'高點':'低點'} ${fmt(e3.price)}；第 1 浪終點 ${fmt(e1.price)}${!ok&&open3?'（尚未超過，第 3 浪仍在進行中，未定）':''}`));
    }
    if(L['5']){
      const a=W('1'),b=W('3'),c=W('5');
      const ok=!(b<a&&b<c);
      rules.push(rule('w3_not_shortest','第 3 浪不可是 1、3、5 浪中最短的',ok?'pass':'fail',
        `幅度：第 1 浪 ${fmt(a)}、第 3 浪 ${fmt(b)}、第 5 浪 ${fmt(c)}${L['5'][2]?'（第 5 浪進行中）':''}`));
    }
    if(L['4']){
      const e1=L['1'][1],e4=L['4'][1];
      const ok=d*(e4.price-e1.price)>0;
      rules.push(rule('w4_overlap','第 4 浪不可進入第 1 浪價格區',ok?'pass':'fail',
        `第 4 浪${up?'低點':'高點'} ${fmt(e4.price)}；第 1 浪終點 ${fmt(e1.price)}`));
    }
    // A-B-C：B 不超過 A 起點（超過只能算擴張平台）
    let expandedFlat=false;
    if(L['B']){
      const sA=L['A'][0],eB=L['B'][1];
      const dA=dir('A');
      const ok=dA*(eB.price-sA.price)>0; // B 沒有回到 A 起點之外（A 下跌時 B 高點要低於 A 起點）
      expandedFlat=!ok;
      rules.push(rule('b_not_beyond_a','B 浪不可超過 A 浪起點（超過只能算擴張平台）',ok?'pass':'flat',
        `B 浪${dA<0?'高點':'低點'} ${fmt(eB.price)}；A 浪起點 ${fmt(sA.price)}${ok?'':'（已超過：只能算擴張平台）'}`));
    }

    // 新推動前的 A–B–C 必須是「修正」：不可超過被修正那段走勢的起點（超過就是新趨勢，不是修正）
    // 獨立 A–B–C（還沒有新第 1 浪）也一樣：修正到目前的最遠點（A、B、C 浪終點中最極端者）不可超過那段走勢的起點。
    if(corrFirst){
      const sA=L['A'][0];
      const corrLabels=['A','B','C'].filter(lb=>L[lb]);
      const extLb=corrLabels.reduce((m,lb)=>(!m||-d*(L[lb][1].price-L[m][1].price)>0)?lb:m,null);
      const eX=L[extLb][1],openX=L[extLb][2];
      const name=pattern.kind==='abc'?'修正':'A–B–C 修正';
      const ps=priorTrendStart(bars,sA.i,d);
      if(!ps)rules.push(rule('corr_within_prior',name+'不可超過被修正那段走勢的起點','pending','A 浪起點之前資料不足，無法判斷'));
      else{const ok=d*(eX.price-ps.price)>0;
        rules.push(rule('corr_within_prior',name+'不可超過被修正那段走勢的起點',ok?'pass':'fail',
          `${extLb} 浪${openX?'目前':''}${up?'低點':'高點'} ${fmt(eX.price)}；被修正那段走勢起點 ${ps.day} ${fmt(ps.price)}`));
        const v=len(sA,eX)/Math.abs(sA.price-ps.price);
        if(ok)addSoft(name+(openX?'（到目前）':'')+' ÷ 被修正那段走勢',v,fit(v,0.236,0.786,0.3),0.8,'23.6%–78.6%');
      }
    }
    // ---- 軟性評分（只用已完成的浪） ----
    if(L['1']&&done('2')){const v=W('2')/W('1');addSoft('第 2 浪回檔 ÷ 第 1 浪',v,fit(v,0.5,0.618,0.3),1.2,'50%–61.8%');}
    if(done('1')&&done('3')){const v=W('3')/W('1');addSoft('第 3 浪 ÷ 第 1 浪',v,Math.max(fit(v,1.5,1.75,0.6),fit(v,2.4,2.8,0.5)),1.2,'≈1.618（或 2.618）');}
    if(done('3')&&done('4')){const v=W('4')/W('3');addSoft('第 4 浪回檔 ÷ 第 3 浪',v,fit(v,0.236,0.5,0.25),1,'≈38.2%（23.6%–50%）');}
    if(done('5')){const v=W('5')/W('1');addSoft('第 5 浪 ÷ 第 1 浪',v,nearAny(v,[1,0.618,1.618],0.1),0.8,'≈1.0（或 0.618、1.618）');
      const trunc=d*(L['5'][1].price-L['3'][1].price)>0;addSoft('第 5 浪超過第 3 浪終點',trunc,trunc?1:0.3,0.5,'超過（否則為失敗的第 5 浪）');}
    if(done('2')&&done('4')){
      const r2v=W('2')/W('1'),r4v=W('4')/W('3');
      const alt=(r2v>=0.5)!==(r4v>=0.5);addSoft('交替原則（2、4 浪深淺不同）',alt,alt?1:0.4,0.6,'一深一淺');
      const tr=T('4')/T('2');addSoft('時間比例：第 4 浪 ÷ 第 2 浪天數',tr,fit(Math.log(tr),Math.log(0.382),Math.log(2.618),1.2),0.5,'0.382–2.618 倍');
    }
    if(done('1')&&done('3')&&done('5')){const ok=W('3')>=W('1')&&W('3')>=W('5');addSoft('第 3 浪為最長',ok,ok?1:0.6,0.4,'通常最長');}
    if(done('A')&&done('B')){const v=W('B')/W('A');
      addSoft('B 浪反彈 ÷ A 浪',v,expandedFlat?Math.max(0,1-(v-1)/0.5)*0.7:Math.max(fit(v,0.382,0.786,0.25),fit(v,0.9,1.0,0.1)*0.8),1,'38.2%–78.6%（平台型 90%–100%）');}
    if(done('A')&&done('C')){const v=W('C')/W('A');addSoft('C 浪 ÷ A 浪',v,nearAny(v,[1,1.618,0.618],0.12),1.2,'≈1.0（或 1.618、0.618）');
      const beyond=dir('A')*(L['C'][1].price-L['A'][1].price)>0;addSoft('C 浪超過 A 浪終點',beyond,beyond?1:0.5,0.4,'通常超過');}
    if(pattern.id==='I5ABC'&&done('C')){
      const imp=len(L['1'][0],L['5'][1]),corr=len(L['A'][0],L['C'][1]);const v=corr/imp;
      addSoft('A–B–C 修正 ÷ 整段推動',v,fit(v,0.382,0.618,0.3),0.8,'38.2%–61.8%');
    }
    if(pattern.kind==='abc+new'&&done('1')){
      // 新第 1 浪要有份量：至少收復 C 浪幅度的 38.2%
      const v=W('1')/W('C');addSoft('新第 1 浪 ÷ C 浪',v,fit(v,0.382,1.0,0.3),0.6,'≥38.2%');
    }

    // 起點要是一個像樣的極值：往前看同樣長度（至少 20 根），不可有比起點更極端的價格；否則這組計數只是更大一段走勢中間的小段。
    const span0=P[n].i-P[0].i,look=Math.max(20,span0),firstUp=segDir(P[0],P[1])===1;
    let anchorOk=true;
    for(let i=Math.max(0,P[0].i-look);i<P[0].i;i++){if(firstUp?bars[i].low<P[0].price:bars[i].high>P[0].price){anchorOk=false;break;}}
    ratios.push({name:'起點是前 '+look+' 根日K內的'+(firstUp?'最低點':'最高點'),value:anchorOk,ideal:'是',score:anchorOk?1:0.8});

    const failed=rules.filter(r=>r.state==='fail');
    const pending=rules.filter(r=>r.state==='pending');
    const nSoft=soft.length;
    const sw=soft.reduce((a,[,w])=>a+w,0);
    const base=sw?soft.reduce((a,[s,w])=>a+s*w,0)/sw:0.5;
    const evidence=nSoft/(nSoft+1.5);
    const span=P[n].i-P[0].i;
    const degree=Math.min(1,0.8+0.2*span/120);
    let score=base*(0.55+0.45*evidence)*degree;
    if(pending.length)score*=0.85;
    if(expandedFlat)score*=0.9;
    if(!anchorOk)score*=0.8;
    if(pattern.id==='A')score*=0.85; // 只有一段 A 浪：任何回檔都套得上，證據最少
    const waves=pattern.labels.map((lb,k)=>wave(lb,P[k],P[k+1],k===n-1&&lastOpen));
    // 只差「第 4 浪進入第 1 浪價格區」這一條：可能是斜三角（本程式不處理斜三角例外），只能當替代計數，不當主要。
    const diagonal=failed.length===1&&failed[0].id==='w4_overlap'&&!corrFirst;
    return {id:pattern.id,kind:pattern.kind,diagonal,text:pattern.text+(expandedFlat?'（B 浪超過 A 起點：擴張平台）':'')+(diagonal?'（替代：可能是斜三角，第 4 浪與第 1 浪重疊）':''),direction:d===1?'up':'down',
      directionText:pattern.kind==='abc'?(d===1?'上漲後的修正（向下）':'下跌後的修正（向上）'):d===1?'上漲推動':'下跌推動',valid:failed.length===0,expandedFlat,rules,ratios,score:r4(failed.length?0:score),rawScore:r4(score),
      waves,points:P.map(pt),lastOpen,_P:P,_L:L,_d:d,_word:word};
  }

  // ---------- 5. 失效價位與關卡（程式依規則產生理由） ----------
  function levels(c,bars){
    const P=c._P,L=c._L,d=c._d,up=d===1,w=c._word,lv=[],inv=[];
    const price=x=>r2(x);
    const W=lb=>len(L[lb][0],L[lb][1]);
    const okPrice=p=>Number.isFinite(p)&&p>0;
    const add=(kind,p,why)=>{if(okPrice(p))lv.push({kind,price:price(p),why});};
    // 失效／下一個參考價也一樣：只輸出有限且大於 0 的價位
    const addInv=(p,why,next)=>{if(!okPrice(p))return false;inv.push(next?{price:price(p),why,next:true}:{price:price(p),why});return true;};
    const notes=[];
    const addTarget1=(p,why)=>addTargets([{p,why}],[],'第 3 浪目標');
    // 硬性上限：目標不可越過（side＝這條界線擋住的方向：1＝不可高於、−1＝不可低於）
    const caps=[];
    const within=p=>caps.every(c=>c.side*(p-c.price)<=1e-9);
    // 依序嘗試比例，只留不越界的目標；全部越界就省略並說明
    // main 先試；都不行才試 fallback（較保守的比例）；仍沒有就不列目標並說明原因
    const addTargets=(main,fallback,what)=>{
      const ok=t=>okPrice(t.p)&&within(t.p);
      let list=main.filter(ok);if(!list.length)list=fallback.filter(ok);
      for(const t of list)add('target',t.p,t.why);
      if(!list.length){
        const crossed=caps.filter(c=>[...main,...fallback].some(t=>Number.isFinite(t.p)&&c.side*(t.p-c.price)>1e-9));
        notes.push(`${what}：常見比例目標${crossed.length?`都會越過硬性界線 ${crossed.map(c=>fmt(c.price)).join('、')}（${crossed.map(c=>c.rule).join('；')}）`:'都不是合理價位（≤0）'}，故不列目標`);
      }
      return list.length;
    };
    const lastLabel=c.waves[c.waves.length-1].label;
    // 更大浪級：被修正那段走勢（priorTrendStart → 修正起點）的 50%／61.8% 回檔位
    const largerRetrace=(startIdx,topPrice)=>{
      const ps=priorTrendStart(bars,startIdx,d);if(!ps)return null;
      const s=ps.price,e=topPrice;return {start:{day:ps.day,price:r2(s)},r500:r2(e-0.5*(e-s)),r618:r2(e-0.618*(e-s))};
    };
    if(c.kind==='abc'){
      // 獨立 A–B–C：失效＝修正超過被修正那段走勢的起點（那就是新趨勢，不是修正）
      const sA=L['A'][0],eA=L['A'][1];
      const ps=priorTrendStart(bars,sA.i,d);
      if(ps)caps.push({price:ps.price,side:-d,rule:'修正不可超過被修正那段走勢的起點'});
      const cT=k=>({p:L['B'][1].price-d*k*W('A')});
      if(lastLabel==='B'){
        const eB=L['B'][1];
        addInv(sA.price,`A 浪起點（修正起點）：B 浪${w.over}這裡只能算擴張平台，再${up?'創新高':'創新低'}則修正計數要重算`);
        add('confirm',eA.price,`A 浪終點：C 浪通常會${w.break}這裡`);
        addTargets([{...cT(1),why:`C 浪常見目標：B 浪終點 ${up?'−':'+'} 1.0×A 浪幅度（不是保證）`}],
          [{...cT(0.618),why:`C 浪目標：B 浪終點 ${up?'−':'+'} 0.618×A 浪幅度（1.0 倍會越過硬性界線，改用較小比例；不是保證）`}],'C 浪目標');
      } else if(lastLabel==='C'){
        const eB=L['B'][1];
        addInv(eB.price,`B 浪${up?'高點':'低點'}：C 浪期間${w.over}這裡，C 浪計數失效`);
        addTargets([{...cT(1),why:`C＝1.0×A：B 浪終點 ${up?'−':'+'} A 浪幅度（不是保證）`},{...cT(1.618),why:`C＝1.618×A：B 浪終點 ${up?'−':'+'} 1.618×A 浪幅度（不是保證）`}],
          [{...cT(0.618),why:`C＝0.618×A：B 浪終點 ${up?'−':'+'} 0.618×A 浪幅度（較大比例會越過硬性界線；不是保證）`}],'C 浪目標');
        add('confirm',eA.price,`A 浪終點：C 浪通常會${w.break}這裡`);
        add('confirm',sA.price,`整段修正起點（前${up?'高':'低'}）：${w.over}代表修正結束、回到原趨勢`);
      } else {
        add('reference',sA.price,`修正起點（前${up?'高':'低'}）：A 浪期間${w.over}這裡代表還沒進入修正`);
      }
      if(ps){
        addInv(ps.price,`被修正那段走勢的起點 ${ps.day}：修正${w.break}這裡就不是修正、是新趨勢，此計數不成立`,lastLabel!=='A');
        const f=fibLevels(ps.price,sA.price);
        if(lastLabel!=='B'){add('support',f.r382,`被修正那段走勢（${ps.day} ${fmt(ps.price)} → ${sA.day} ${fmt(sA.price)}）的 38.2% 回檔位`);
          add('support',f.r500,`被修正那段走勢的 50% 回檔位`);add('support',f.r618,`被修正那段走勢的 61.8% 回檔位`);}
      }
    } else if(c.kind==='abc+new'){
      const sA=L['A'][0],eA=L['A'][1],eB=L['B'][1],eC=L['C'][1];
      const A=W('A');
      addInv(eC.price,`C 浪${up?'低點':'高點'}（新推動起點）：第 2 浪不可${up?'跌破':'突破'}第 1 浪起點，${w.break}這個價位此計數失效`);
      // 失效後下一個參考價：C 浪延伸（從 B 浪終點量 1.0／1.618／2.618 倍 A 浪，取第一個還沒到的）
      // 延伸價必須是有限且 > 0 的價位；都不合理就不列，並說明
      const beyondC=[1,1.618,2.618].map(k=>({k,p:eB.price-d*k*A})).filter(o=>Number.isFinite(o.p)&&d*(o.p-eC.price)<0);
      const ext=beyondC.find(o=>okPrice(o.p));
      if(ext)addInv(ext.p,`若${w.break} C 浪${up?'低點':'高點'}：C 浪延伸到 ${ext.k}×A 浪（從 B 浪終點 ${fmt(eB.price)} 量 A 浪幅度 ${fmt(A)}）的參考價`,true);
      else if(beyondC.length)notes.push(`若${w.break} C 浪${up?'低點':'高點'}：C 浪延伸（從 B 浪終點 ${fmt(eB.price)} 量 1.0／1.618／2.618×A 浪幅度 ${fmt(A)}）算出的價位 ≤ 0，沒有可用的延伸參考價`);
      const lr=largerRetrace(sA.i,sA.price);
      if(lr)for(const [k,v] of [['50%',lr.r500],['61.8%',lr.r618]])if(d*(v-eC.price)<0)
        addInv(v,`更大浪級參考：被修正那段走勢（${lr.start.day} ${fmt(lr.start.price)} → ${sA.day} ${fmt(sA.price)}）的 ${k} 回檔位`,true);
      if(L['1']){const e1=L['1'][1],s1=L['1'][0];
        if(!(L['3']&&!L['3'][2]&&d*(L['3'][1].price-e1.price)>0))add('confirm',e1.price,`新第 1 浪${up?'高點':'低點'}：${w.over}這裡，第 3 浪才算初步確認`);
        if(lastLabel==='1'||lastLabel==='2'){const f=fibLevels(s1.price,e1.price);
          add('support',f.r500,`第 1 浪幅度的 50% 回檔位（第 2 浪常見落點）`);add('support',f.r618,`第 1 浪幅度的 61.8% 回檔位（第 2 浪常見落點，再過去就要小心）`);}
        if(L['2']&&!L['2'][2]){const e2=L['2'][1];addTarget1(e2.price+d*1.618*W('1'),`第 3 浪常見目標：第 2 浪終點 ${fmt(e2.price)} ${up?'+':'−'} 1.618×第 1 浪幅度（常見比例，不是保證）`);}
      }
      add('confirm',eB.price,`前一段修正的 B 浪${up?'高點':'低點'}：${w.over}這裡，${up?'底部':'頭部'}較可信（新推動較可信）`);
      add('confirm',sA.price,`整段修正起點（前${up?'高':'低'}）：${w.over}代表修正結束、回到原趨勢`);
      add('reference',eA.price,`A 浪終點（修正第一段的${up?'低點':'高點'}）：第 2 浪${up?'跌破':'突破'}這裡代表回檔已深，下一道防線是 C 浪${up?'低點':'高點'}`);
    } else {
      const s1=L['1'][0],e1=L['1'][1];
      if(lastLabel==='3'){
        const e2=L['2'][1];
        addInv(e2.price,`第 2 浪${up?'低點':'高點'}：${w.break}這裡，第 3 浪計數失效`);
        addInv(s1.price,`第 1 浪起點：第 2 浪不可${up?'跌破':'突破'}，${w.break}則整段推動計數不成立`,true);
        if(d*(L['3'][1].price-e1.price)<=0)add('confirm',e1.price,`第 1 浪終點：第 3 浪必須超過這裡`);
        addTarget1(e2.price+d*1.618*W('1'),`第 3 浪常見目標：第 2 浪終點 ${up?'+':'−'} 1.618×第 1 浪幅度（不是保證）`);
      } else if(lastLabel==='4'){
        addInv(e1.price,`第 1 浪終點：第 4 浪不可進入第 1 浪價格區，${w.break}這裡計數不成立`);
        const f=fibLevels(L['3'][0].price,L['3'][1].price);
        add('support',f.r382,`第 3 浪幅度的 38.2% 回檔位（第 4 浪常見落點）`);
        add('confirm',L['3'][1].price,`第 3 浪終點：第 5 浪通常會超過這裡（沒超過＝失敗的第 5 浪）`);
      } else if(lastLabel==='5'){
        const e4=L['4'][1],e3=L['3'][1];
        addInv(e4.price,`第 4 浪${up?'低點':'高點'}：${w.break}代表第 5 浪可能已結束、進入修正`);
        if(W('3')<W('1')){const cap=e4.price+d*W('3');
          addInv(cap,`第 3 浪短於第 1 浪，第 5 浪不可比第 3 浪長（否則第 3 浪成為最短）：${up?'超過':'低於'}這個價位此計數不成立`);
          caps.push({price:cap,side:d,rule:'第 3 浪不可最短，第 5 浪不可比第 3 浪長'});}
        add('confirm',e3.price,`第 3 浪終點：第 5 浪超過這裡才不算失敗的第 5 浪`);
        addTargets([{p:e4.price+d*W('1'),why:`第 5 浪常見目標：第 4 浪終點 ${up?'+':'−'} 1.0×第 1 浪幅度（不是保證）`}],
          [{p:e4.price+d*0.618*W('1'),why:`第 5 浪目標：第 4 浪終點 ${up?'+':'−'} 0.618×第 1 浪幅度（1.0 倍會超過第 5 浪上限，改用較小比例；不是保證）`}],'第 5 浪目標');
      } else {
        // 推動完成後的修正（A、B、C）
        const e5=L['5'][1],e4=L['4'][1];
        const imp=fibLevels(s1.price,e5.price);
        if(lastLabel==='A'){
          addInv(e5.price,`第 5 浪終點：A 浪期間${up?'突破':'跌破'}這裡，代表推動還沒結束，此計數不成立`);
          add('support',e4.price,`第 4 浪${up?'低點':'高點'}：修正常回到第 4 浪附近`);
          add('support',imp.r382,`整段推動的 38.2% 回檔位`);add('support',imp.r500,`整段推動的 50% 回檔位`);add('support',imp.r618,`整段推動的 61.8% 回檔位`);
        } else if(lastLabel==='B'){
          const eA=L['A'][1];
          addInv(e5.price,`A 浪起點（第 5 浪終點）：B 浪超過這裡只能算擴張平台，${up?'再創新高':'再創新低'}則修正計數要重算`);
          add('confirm',eA.price,`A 浪終點：C 浪通常會${up?'跌破':'突破'}這裡`);
          addTargets([{p:L['B'][1].price-d*W('A'),why:`C 浪常見目標：B 浪終點 ${up?'−':'+'} 1.0×A 浪幅度（不是保證）`}],[],'C 浪目標');
        } else if(lastLabel==='C'){
          const eA=L['A'][1],eB=L['B'][1];
          addInv(eB.price,`B 浪${up?'高點':'低點'}：C 浪期間${up?'突破':'跌破'}這裡，C 浪計數失效`);
          addTargets([{p:eB.price-d*W('A'),why:`C＝1.0×A：B 浪終點 ${up?'−':'+'} A 浪幅度`},{p:eB.price-d*1.618*W('A'),why:`C＝1.618×A：B 浪終點 ${up?'−':'+'} 1.618×A 浪幅度`}],[],'C 浪目標');
          add('support',e4.price,`推動第 4 浪${up?'低點':'高點'}：修正常落在第 4 浪附近`);
          add('confirm',e5.price,`整段修正起點（第 5 浪${up?'高點':'低點'}）`);
          void eA;
        }
      }
    }
    // 依價格由高到低排列，方便畫面閱讀
    lv.sort((a,b)=>b.price-a.price);
    return {keyLevels:lv,invalidation:inv,levelNotes:notes};
  }

  // 計數的關鍵還沒被價格確認時，不說「成立」。
  function confirmation(c,bars){
    const L=c._L,d=c._d,up=d===1,last=bars[bars.length-1];
    const extreme=(from)=>{let v=null;for(let i=from;i<bars.length;i++){const x=up?bars[i].high:bars[i].low;if(v==null||(up?x>v:x<v))v=x;}return v;};
    if(c.kind==='abc+new'&&L['1']){
      const e1=L['1'][1];
      const after=e1.i+1<bars.length?extreme(e1.i+1):null;
      if(!(L['3']&&after!=null&&d*(after-e1.price)>0))return `新推動尚未確認：要${up?'突破':'跌破'}第 1 浪${up?'高點':'低點'} ${fmt(e1.price)} 才算第 3 浪啟動`;
    }
    if(c.kind==='impulse+abc'&&L['A']&&!L['B']){
      const e4=L['4'][1],eA=L['A'][1];
      // 上漲推動後的 A 浪（向下）：A 浪低點要低於第 4 浪低點才算跌破；剛好相等不算。下跌推動反之。
      if(!(d*(e4.price-eA.price)>0))return `推動結束尚未確認：A 浪還沒${up?'跌破':'突破'}第 4 浪${up?'低點':'高點'} ${fmt(e4.price)}`;
    }
    if(c.kind==='abc'){
      const n=c.waves.length,lab=c.waves[n-1].label;
      if(lab==='A')return '只有 A 浪：修正型態還沒成形，可能只是原趨勢中的回檔';
      if(lab==='B')return 'B 浪進行中：C 浪還沒出現，修正尚未完成';
      const eA=L['A'][1];
      let after=null;for(let i=L['C'][0].i;i<bars.length;i++){const x=up?bars[i].low:bars[i].high;if(after==null||(up?x<after:x>after))after=x;}
      if(!(d*(eA.price-after)>0))return `C 浪還沒${up?'跌破':'突破'} A 浪${up?'低點':'高點'} ${fmt(eA.price)}，修正結構尚未確認`;
      return 'C 浪仍在進行中，修正何時結束尚未確認';
    }
    void last;return null;
  }

  function strip(c){const {_P,_L,_d,_word,...rest}=c;return rest;}
  const sig=c=>c.id+'|'+c.waves.map(w=>w.start.day+'>'+w.end.day).join(',');
  // 同一個「解讀」：目前這段推動的方向與第 1 浪起點相同（例如只差最後一小段要不要再細分成 1、2 浪、或 A 浪起點取在哪個小高點），
  // 只是解析度不同，不算互相競爭的替代計數；每個解讀只留分數最高的一個。
  // 獨立 A–B–C 與「5 浪＋A–B–C」若 A 浪起點相同，也算同一個修正解讀（只差前面要不要數成 5 浪）。回傳這個候選所屬的所有解讀鍵。
  const family=c=>{
    if(c.kind==='abc')return ['corr|'+c.direction+'|'+c._P[0].day];
    const start=c.kind==='abc+new'?c._P[3]:c._P[0];
    const keys=[(c.kind==='impulse+abc'?'post':'imp')+'|'+c.direction+'|'+start.day];
    if(c.kind==='impulse+abc')keys.push('corr|'+c.direction+'|'+c._P[5].day);
    return keys;
  };

  // 分數面的「不確定」理由：主要分數太低、或和第一個替代計數太接近。
  function scoreReasons(primaryScore,altScore,opts={}){
    const minScore=fin(opts.minScore)?Number(opts.minScore):MIN_SCORE,margin=fin(opts.closeMargin)?Number(opts.closeMargin):CLOSE_MARGIN;
    const out=[];
    if(primaryScore<minScore)out.push(`主要計數分數 ${primaryScore} 偏低（< ${minScore}）`);
    if(altScore!=null&&primaryScore-altScore<margin)out.push(`主要與替代計數分數接近（${primaryScore} vs ${altScore}，差距 < ${margin}）`);
    return out;
  }

  // 測試與檢查用：某個門檻下每種型態的候選（含沒通過硬性規則的），附規則檢查結果。
  function candidates(barsIn,thresholdPct,opts={}){
    const bars=completedBars(barsIn,opts.today,opts.minute);
    if(bars.length<2)return [];
    const z=zigzag(bars,thresholdPct);
    return PATTERNS.map(p=>evaluate(p,z.pivots,bars)).filter(Boolean).map(c=>({...strip(c),...levels(c,bars)}));
  }

  function emptyResult(reason,extra){
    return {ok:false,status:'insufficient',statusText:STATUS_TEXT.insufficient,reason,thresholdPct:null,atrPct:null,pivots:[],inProgress:null,
      primary:null,alternatives:[],keyLevels:[],invalidation:[],levelNotes:[],candidatesTried:[],uncertainReasons:[reason],...extra};
  }

  // ---------- 主函式 ----------
  function analyze(barsIn,opts={}){
    const bars=completedBars(barsIn,opts.today,opts.minute);
    if(bars.length<MIN_BARS)return emptyResult(`日K只有 ${bars.length} 根，少於 ${MIN_BARS} 根，不計算波浪`,{barsUsed:bars.length});
    const atr=atrPct(bars);
    const thresholds=(opts.thresholds||CANDIDATE_THRESHOLDS).filter(t=>t>0);
    const lb=bars[bars.length-1];
    const all=[],tried=[];
    for(const t of thresholds){
      const z=zigzag(bars,t);
      // 門檻相對波動度：太小＝把雜訊當轉折、太大＝看不到結構
      const ratio=atr?t/atr:NaN;
      const prior=!Number.isFinite(ratio)?0.9:ratio<ATR_BAND[0]?Math.max(0.6,1-(ATR_BAND[0]-ratio)*0.35):ratio>ATR_BAND[1]?Math.max(0.6,1-(ratio-ATR_BAND[1])*0.12):1;
      let best=null,validCount=0;
      for(const p of PATTERNS){
        const c=evaluate(p,z.pivots,bars);if(!c)continue;
        c.thresholdPct=t;c.prior=r4(prior);c.finalScore=r4(c.score*prior);
        c._z=z;
        if(c.diagonal)c.finalScore=r4(c.rawScore*0.7*prior);
        if(c.valid)validCount++;
        all.push(c);
        if(c.valid&&(!best||c.finalScore>best.finalScore))best=c;
      }
      tried.push({thresholdPct:t,pivots:z.pivots.length,atrMultiple:Number.isFinite(ratio)?r2(ratio):null,validCounts:validCount,bestScore:best?best.finalScore:0,best:best?best.id:null});
    }
    const valid=all.filter(c=>c.valid).sort((a,b)=>b.finalScore-a.finalScore||b.thresholdPct-a.thresholdPct);
    const seen=new Set(),uniq=[];
    for(const c of valid){const s=sig(c),f=family(c);if(seen.has(s)||f.some(k=>seen.has(k)))continue;seen.add(s);f.forEach(k=>seen.add(k));uniq.push(c);}
    // 斜三角候選（只違反第 4 浪重疊）：只放進替代計數
    const diag=[];
    for(const c of all.filter(c=>c.diagonal).sort((a,b)=>b.finalScore-a.finalScore)){const s=sig(c),f=family(c)[0]+'|diag';if(seen.has(s)||seen.has(f))continue;seen.add(s);seen.add(f);diag.push(c);}
    // role 明確標出「主要／替代」，畫面不靠陣列位置判斷；沒通過硬性規則的候選（valid:false，例如斜三角）永遠只能是替代。
    const out=(c,role)=>{const {_z,...o}={...strip(c),role,thresholdPct:c.thresholdPct,prior:c.prior,finalScore:c.finalScore,...levels(c,bars)};void _z;return o;};
    const asAlt=c=>out(c,'alternative');
    if(!uniq.length){
      // 沒有任何候選通過硬性規則：只畫轉折，不貼浪名
      const t=thresholds.slice().sort((a,b)=>Math.abs(a/(atr||1)-2.5)-Math.abs(b/(atr||1)-2.5))[0];
      const z=zigzag(bars,t);
      const rejected=all.filter(c=>c.thresholdPct===t).map(c=>({id:c.id,text:c.text,direction:c.direction,rules:c.rules}));
      // 兩種情況要分開講：
      // - 沒有任何候選（每個門檻的轉折都太少，例如整段同價、或振幅低於所有門檻）→ 不確定，理由是轉折不足，不是「違反規則」
      // - 有候選但全部違反硬性規則 → 計數不成立
      const noCandidates=all.length===0;
      const maxPivots=tried.reduce((m,x)=>Math.max(m,x.pivots),0);
      const minT=thresholds.length?Math.min(...thresholds):null;
      const why=noCandidates
        ?[`轉折不足：在所有候選門檻（最小 ${minT}%）下最多只有 ${maxPivots} 個轉折，振幅不夠形成任何候選計數，無法判斷波浪`]
        :['所有候選計數都違反至少一條硬性規則，不硬貼浪名'];
      const st=noCandidates?'uncertain':'invalid';
      return {ok:true,status:st,statusText:STATUS_TEXT[st],noCandidates,thresholdPct:t,atrPct:atr!=null?r2(atr):null,barsUsed:bars.length,
        lastBar:{day:lb.day,close:lb.close},pivots:z.pivots.map(p=>({...pt(p),type:p.type,confirmed:p.confirmed})),inProgress:z.inProgress,
        primary:null,alternatives:diag.filter(c=>c.finalScore>=0.4).slice(0,MAX_ALTERNATIVES).map(asAlt),rejected,keyLevels:[],invalidation:[],levelNotes:[],candidatesTried:tried,
        uncertainReasons:why};
    }
    const primary=uniq[0];
    // 替代計數要有一定份量：分數至少 0.4，且不低於主要計數的 55%，太弱的不列（避免把雜訊當選項）
    const alts=[...uniq.slice(1),...diag].sort((a,b)=>b.finalScore-a.finalScore).filter(c=>c.finalScore>=Math.max(0.4,primary.finalScore*0.55)).slice(0,MAX_ALTERNATIVES);
    const reasons=scoreReasons(primary.finalScore,alts[0]?alts[0].finalScore:null,opts);
    const pend=primary.rules.filter(r=>r.state==='pending');
    if(pend.length)reasons.push('尚待確認：'+pend.map(r=>r.text).join('、'));
    if(primary.expandedFlat)reasons.push('B 浪超過 A 浪起點，只能當擴張平台看');
    const conf=confirmation(primary,bars);
    if(conf)reasons.push(conf);
    const status=reasons.length?'uncertain':'valid';
    const lvPrimary=levels(primary,bars);
    const z=primary._z;
    return {ok:true,status,statusText:STATUS_TEXT[status],noCandidates:false,thresholdPct:primary.thresholdPct,atrPct:atr!=null?r2(atr):null,barsUsed:bars.length,
      lastBar:{day:lb.day,close:lb.close},
      pivots:z.pivots.map(p=>({...pt(p),type:p.type,confirmed:p.confirmed})),inProgress:z.inProgress,
      primary:out(primary,'primary'),alternatives:alts.map(asAlt),
      keyLevels:lvPrimary.keyLevels,invalidation:lvPrimary.invalidation,levelNotes:lvPrimary.levelNotes,candidatesTried:tried,uncertainReasons:reasons};
  }

  // ---------- 6. 2055 長期情境（純計算，假設情境，不是預測） ----------
  function scenarios(lastClose,lastDay,rates=SCENARIO_RATES,targetYear=SCENARIO_YEAR){
    const c=Number(lastClose);
    if(!(c>0)||!ymd(lastDay))return null;
    const end=`${targetYear}-12-31`;
    const years=calDays(lastDay,end)/365.25;
    if(!(years>0))return null;
    const label={pessimistic:'悲觀',neutral:'中性',optimistic:'樂觀'};
    const rows=['optimistic','neutral','pessimistic'].filter(k=>fin(rates?.[k])).map(k=>({key:k,label:label[k],rate:Number(rates[k]),price:r2(c*Math.pow(1+Number(rates[k]),years))}));
    return {targetYear,targetDay:end,fromDay:lastDay,fromClose:c,years:r2(years),rows,note:SCENARIO_NOTE+'；價格指數不含股息'};
  }

  // ---------- 給 AI 解讀用的純文字（只放程式算好的數字） ----------
  function summaryText(name,res){
    if(!res||!res.ok)return `${name}：${res?.reason||'資料不足，沒有波浪計數'}`;
    const L=[`${name} 日線艾略特波浪（程式計算，門檻 ${res.thresholdPct}%，ATR ${res.atrPct}%，最後一根 ${res.lastBar.day} 收 ${fmt(res.lastBar.close)}）`,`狀態：${res.statusText}${res.uncertainReasons.length?'（'+res.uncertainReasons.join('；')+'）':''}`];
    const wv=c=>c.waves.map(w=>`${w.label}浪 ${w.start.day} ${fmt(w.start.price)} → ${w.end.day} ${fmt(w.end.price)}（${w.pct>0?'+':''}${w.pct}%，${w.tradingDays} 交易日${w.inProgress?'，進行中':''}）`).join('；');
    if(res.primary){
      L.push(`主要計數：${res.primary.text}（${res.primary.directionText}，分數 ${res.primary.finalScore}）`,wv(res.primary));
      L.push('規則：'+res.primary.rules.map(r=>`${r.text}＝${r.state==='pass'?'通過':r.state==='pending'?'未定':r.state==='flat'?'擴張平台':'失敗'}（${r.detail}）`).join('；'));
      L.push('比例：'+res.primary.ratios.map(r=>`${r.name} ${typeof r.value==='boolean'?(r.value?'是':'否'):r.value}（理想 ${r.ideal}）`).join('；'));
    }
    res.alternatives.forEach((a,k)=>L.push(`替代計數 ${k+1}：${a.text}（分數 ${a.finalScore}，門檻 ${a.thresholdPct}%）`));
    if(res.invalidation.length)L.push('失效價位：'+res.invalidation.map(v=>`${fmt(v.price)}（${v.why}）`).join('；'));
    if(res.keyLevels.length)L.push('關卡：'+res.keyLevels.map(v=>`${fmt(v.price)}（${v.why}）`).join('；'));
    if(res.levelNotes&&res.levelNotes.length)L.push('說明：'+res.levelNotes.join('；'));
    return L.join('\n');
  }

  root.ZinfElliott={CANDIDATE_THRESHOLDS,ATR_DAYS,MIN_BARS,MIN_SCORE,CLOSE_MARGIN,SCENARIO_RATES,SCENARIO_YEAR,FIB,STATUS_TEXT,DISCLAIMER,SCENARIO_NOTE,
    isValidDay:ymd,completedBars,atrPct,zigzag,fibLevels,analyze,candidates,scoreReasons,scenarios,summaryText,PATTERNS:PATTERNS.map(p=>p.id)};
})(globalThis);
