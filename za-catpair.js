// Two photo-style companions. Visual-only: no account or portfolio access.
// Generated poses are an approximation of movement, not footage of real cats.
(function () {
  'use strict';
  if (window.__zaCatPairCore) return;
  var phases = ['greet','approach','play','chaseRight','turn','chaseLeft','settle','sleep','wake'];
  var durations = [3,4,4,5,1.5,6,3,34,3];
  function ease(q) { q=Math.max(0,Math.min(1,q)); return q*q*(3-2*q); }
  function create(width) {
    var s={width:width,size:72,phase:'greet',time:0,cycle:0,reduced:false,approachFrom:null,wakeFrom:null,white:{x:0,y:0,facing:1,mode:'sit',frame:0},tabby:{x:0,y:0,facing:-1,mode:'sit',frame:0}};
    resize(s,width); pose(s); return s;
  }
  function resize(s,width) {
    width=Math.max(144,width);var size=Math.min(80,(width-32)/3);
    if(s.width===width&&s.size===size)return;
    var previous=s.width-s.size;
    function rebase(points){if(!points)return null;var a=Math.max(8,Math.min(width-2*size-20,points[0]/previous*(width-size)));var b=Math.min(width-size-8,Math.max(a+size+12,points[1]/previous*(width-size)));return [a,b];}
    s.wakeFrom=rebase(s.wakeFrom);s.approachFrom=rebase(s.approachFrom);
    s.width=width;s.size=size;pose(s);
  }
  function pose(s) {
    var gap=s.size+12, mid=(s.width-s.size-gap)/2, left=8, right=s.width-2*s.size-20;
    var q=ease(s.time/durations[phases.indexOf(s.phase)]), x=mid, distance=0;
    var a=s.white,b=s.tabby, mode='sit';
    if(s.phase==='greet') { a.x=left;b.x=s.width-s.size-8; }
    else if(s.phase==='approach') { var from=s.approachFrom||[left,s.width-s.size-8];a.x=from[0]+(mid-from[0])*q;b.x=from[1]+(mid+gap-from[1])*q; mode='walk'; }
    else {
      if(s.phase==='chaseRight') { x=mid+(right-mid)*q;distance=(right-mid)*q;mode='walk'; }
      if(s.phase==='turn') x=right;
      if(s.phase==='chaseLeft') { x=right+(left-right)*q;distance=(right-left)*q;mode='walk'; }
      if(s.phase==='settle') { x=left+(mid-left)*q;distance=(mid-left)*q;mode=q<.8?'walk':'settle'; }
      if(s.phase==='sleep') mode='sleep';
      if(s.phase==='wake') mode='wake';
      if(s.phase==='play') mode='play';
      a.x=x;b.x=x+gap;if(s.phase==='wake'&&s.wakeFrom){a.x=s.wakeFrom[0];b.x=s.wakeFrom[1];}
    }
    a.y=b.y=0; a.mode=b.mode=mode;
    if(s.phase==='approach') { a.facing=-1;b.facing=1;distance=Math.abs(a.x-left); }
    else if(s.phase==='chaseRight'||s.phase==='settle') a.facing=b.facing=-1;
    else if(s.phase==='chaseLeft') a.facing=b.facing=1;
    else if(s.phase==='turn') a.facing=b.facing=s.time<.75?-1:1;
    else {a.facing=-1;b.facing=1;}
    // Distance advances the walk cycle. Never animate feet while standing still.
    a.frame=b.frame=distance/(s.size*.65)*8;
    a.progress=b.progress=q;
  }
  function step(s,dt) {
    if(s.reduced)return;
    s.time+=Math.max(0,Math.min(.05,dt));
    var i=phases.indexOf(s.phase);
    if(s.time>=durations[i]){s.time=0;if(s.phase==='wake'){s.approachFrom=[s.white.x,s.tabby.x];s.wakeFrom=null;i=1;s.cycle++;}else{i=(i+1)%phases.length;}s.phase=phases[i];}
    pose(s);
  }
  function wake(s) { if(s.reduced)return;s.wakeFrom=[s.white.x,s.tabby.x];s.phase='wake';s.time=0;pose(s); }
  function reduce(s,on) { s.reduced=on;s.wakeFrom=null;s.approachFrom=null;s.phase=on?'sleep':'wake';s.time=0;pose(s); }
  // The atlas uses separate, grounded clips: walk, run, jump, idle, groom,
  // settle, wake and paw-play. Sampling is pure, so the renderer and tests
  // agree on which anatomy is visible at each point in an action.
  function samplePose(c,time,frozen) {
    var clock=frozen?0:Math.max(0,Number(c.clock)||0),p=Math.max(0,Math.min(1,Number(c.progress)||0));
    var offset=(c.index||0)*2.17,frame=24,mode=c.mode,breath=0,tail=0;
    if(mode==='walk')frame=((Math.floor(c.frame||0)%8)+8)%8;
    else if(mode==='run')frame=8+((Math.floor(c.frame||0)%8)+8)%8;
    else if(mode==='hop')frame=16+(p<.12?Math.min(2,Math.floor(p/.12*3)):p<.25?3:p<.78?(p<.5?4:5):p<.92?6:7);
    else if(mode==='groom') {var g=Math.floor(clock*4)%14;frame=32+(g<8?g:14-g);}
    else if(mode==='settle')frame=40+Math.min(7,Math.floor(p*8));
    else if(mode==='wake')frame=48+Math.min(7,Math.floor(p*8));
    else if(mode==='sleep')frame=47;
    else if(mode==='turn')frame=30;
    else if(mode==='pounce'||mode==='respond'||mode==='invite'||mode==='play')frame=56+Math.min(7,Math.floor(clock/1.6*8));
    else {
      var blink=(clock+offset)%6.7,look=(clock+offset)%17;
      frame=blink>2.82&&blink<2.96?26:blink>2.7&&blink<3.08?25:look>11&&look<11.6?28:look>12&&look<13.5?30:24;
    }
    if(!frozen&&['sleep','observe','sit','groom'].indexOf(mode)>=0){
      breath=Math.sin((clock+offset)*Math.PI*2/(mode==='sleep'?4.3:3.5))*.45;
      if(mode!=='sleep')tail=Math.sin((clock+offset)*1.2)*.7;
    }
    return {frame:frame,breath:breath,tail:tail};
  }
  var core=window.__zaCatPairCore={create:create,resize:resize,step:step,wake:wake,reduce:reduce,samplePose:samplePose};
  if(typeof document==='undefined')return;
  var cat=window.__zaPhotoCat;
  if(!cat||!cat.box)return;
  var style=document.createElement('style');
  style.textContent='.za-cat-pair{position:relative;margin-top:4px;contain:layout paint;isolation:isolate}' +
    '.za-cat-pair-bar{height:30px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--z-sub,#B3BDD8);font-size:10px}' +
    'html .premium-header button.za-pair-pause{min-width:76px!important;min-height:30px!important;padding:3px 8px!important;background:transparent!important;border:1px solid currentColor!important;border-radius:999px;color:inherit!important;font-size:10px!important}' +
    '.za-cat-arena{position:relative;height:88px;overflow:hidden;border-bottom:1px solid rgba(150,170,200,.16)}' +
    'html .za-cat-arena button.za-photocat{position:absolute!important;left:0!important;top:auto!important;bottom:0!important;margin:0!important;padding:0!important;min-width:0!important;min-height:0!important;animation:none!important;background:none!important;border:0!important;box-shadow:none!important;will-change:transform}' +
    '.za-cat-arena .za-pc-face,.za-cat-arena img,.za-cat-arena canvas{animation:none!important;transform:none!important;filter:none!important}' +
    '.za-cat-arena .za-pc-face{height:100%;width:100%}.za-pair-sprite{width:100%;height:100%;display:block;pointer-events:none}' +
    '.za-cat-arena .za-pc-bubble{display:none}.za-cat-arena .za-photocat:focus-visible{outline:2px solid #b7cfff!important;outline-offset:-2px}' +
    '@media(prefers-reduced-motion:reduce){.za-cat-arena *{animation:none!important;transition:none!important}}';
  document.head.appendChild(style);
  var host=document.createElement('section');host.className='za-cat-pair';host.setAttribute('aria-label','白貓與狸花貓的小天地');
  var bar=document.createElement('div');bar.className='za-cat-pair-bar';
  var label=document.createElement('span');label.textContent='白貓和狸花 · 一起休息';label.title='AI 生成寫實影格；原白貓照片保留為備援';
  var pause=document.createElement('button');pause.type='button';pause.className='za-pair-pause';pause.textContent='暫停小貓';pause.setAttribute('aria-pressed','false');
  bar.appendChild(label);bar.appendChild(pause);host.appendChild(bar);
  var arena=document.createElement('div');arena.className='za-cat-arena';host.appendChild(arena);
  var white=cat.box;white.classList.add('za-pair-white');white.style.display='';arena.appendChild(white);
  var tabby=document.createElement('button');tabby.type='button';tabby.className='za-photocat za-pair-tabby';tabby.setAttribute('aria-label','狸花貓，點一下叫醒兩隻小貓');arena.appendChild(tabby);
  var wc=document.createElement('canvas'),tc=document.createElement('canvas');
  [wc,tc].forEach(function(c){c.width=c.height=160;c.className='za-pair-sprite';c.setAttribute('aria-hidden','true');});
  cat.face.appendChild(wc);tabby.appendChild(tc);
  var wctx=wc.getContext('2d'),tctx=tc.getContext('2d');
  var state=create(320), manualPause=false, raf=0,last=0,visible=true;
  var runtime=core.runtime={external:false,host:host,arena:arena,white:white,tabby:tabby,pause:pause,bar:bar,label:label,state:state,isPaused:function(){return manualPause;}};
  core.state=state;
  var rm=window.matchMedia('(prefers-reduced-motion: reduce)');reduce(state,rm.matches);
    // Reuse existing pet/click semantics and mood label, without jumping or deforming the whole photograph.
  cat.spriteReact=function(){wake(state);resume();return 'look';};
  cat.roam={refresh:mount,react:function(){wake(state);resume();},core:{state:state.white}};
  // The pair owns animation from this point. Fallback is a still photo, so pause
  // and reduced motion cannot leave a second legacy RAF animating in the lane.
  cat.externalSprite=true;
  Array.prototype.forEach.call(cat.face.children,function(el){if(el!==wc)el.style.display=el.tagName==='IMG'?'block':'none';});
  var assets={white:null,tabby:null};
  function load(name,url) {
    var im=new Image();im.decoding='async';im.onload=function(){assets[name]=im;
      if(name==='white'){if(white.parentNode!==arena)arena.appendChild(white);cat.externalSprite=true;Array.prototype.forEach.call(cat.face.children,function(el){if(el!==wc)el.style.display='none';});wc.style.display='block';}
      render();resume();if(runtime.onAssetsReady)runtime.onAssetsReady();
    };im.onerror=function(){if(name==='white')wc.style.display='none';else if(name==='tabby'){tabby.style.display='none';label.textContent='白貓 · 狸花素材暫時載不到';}assets[name]=false;if(runtime.onAssetError)runtime.onAssetError(name);};im.src=url;
  }
  wc.style.display='none';
  load('white','/za-white-companion.webp?v=1');load('tabby','/za-tabby-companion.webp?v=1');
  // Enhanced clips are optional: a failed download keeps the existing atlas.
  function loadActions(name,url){var im=new Image();im.decoding='async';im.onload=function(){assets[name+'Actions']=im;render();if(runtime.onAssetsReady)runtime.onAssetsReady();};im.src=url;}
  loadActions('white','/za-white-actions.webp?v=1');loadActions('tabby','/za-tabby-actions.webp?v=1');
  function frameFor(c,tabbyCat) {
    if(c.mode==='walk'||c.mode==='run'||c.mode==='hop')return Math.floor(c.frame)%8;
    if(c.mode==='invite')return state.time%1.6<.8?14:15;
    if(c.mode==='respond')return state.time%2.1<1.2?12:14;
    if(c.mode==='pounce')return state.time%.9<.45?14:15;
    if(c.mode==='groom')return state.time%1.4<.9?9:8;
    if(c.mode==='observe')return 12;
    if(c.mode==='sleep')return 11;
    if(c.mode==='settle')return c.progress<.92?9:10;
    if(c.mode==='wake')return c.progress<.35?10:c.progress<.7?9:8;
    if(c.mode==='play')return tabbyCat?(state.time%2<1?14:15):(state.time%2<1?8:9);
    if(state.phase==='turn')return state.time<.75?8:9;
    return 8;
  }
  var previous=[null,null];
  function paint(ctx,im,c,isTabby,enhanced) {
    if(!ctx||!im)return;
    var frozen=manualPause||state.reduced,pose=samplePose(c,state.time,frozen);
    var n=enhanced?pose.frame:frameFor(c,isTabby),cols=enhanced?8:4,cw=im.width/cols,ch=im.height/cols;
    var index=isTabby?1:0,prev=previous[index],now=state.time,blendable=enhanced&&['walk','run','hop'].indexOf(c.mode)<0;
    if(!prev||prev.im!==im||!blendable)prev={im:im,frame:n,from:n,changed:now};
    else if(prev.frame!==n){prev.from=prev.frame;prev.frame=n;prev.changed=now;}
    previous[index]=prev;
    function frame(num,dx,dy){ctx.drawImage(im,(num%cols)*cw,Math.floor(num/cols)*ch,cw,ch,dx||0,dy||0,160,160);}
    ctx.clearRect(0,0,160,160);ctx.save();
    if(c.facing===-1){ctx.translate(160,0);ctx.scale(-1,1);}
    var mix=frozen?1:Math.max(0,Math.min(1,(now-prev.changed)/.1));
    if(blendable&&mix<1&&prev.from!==n){
      // Add weighted premultiplied pixels: source-over would dim shared opaque
      // body pixels to 75% alpha halfway through every transparent-sprite fade.
      ctx.globalAlpha=1-mix;frame(prev.from);ctx.globalCompositeOperation='lighter';
      ctx.globalAlpha=mix;frame(n);ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    }else frame(n);
    // Only a small chest/tail patch moves. Paws and the ground baseline never
    // scale or bounce with breathing; walking and flying have no idle warp.
    if(enhanced&&!frozen&&ctx.ellipse&&Math.abs(pose.breath)>.01){
      ctx.save();ctx.beginPath();ctx.ellipse(76,c.mode==='sleep'?122:103,28,19,0,0,Math.PI*2);ctx.clip();ctx.clearRect(0,0,160,160);frame(n,pose.breath,0);ctx.restore();
    }
    if(enhanced&&!frozen&&ctx.ellipse&&Math.abs(pose.tail)>.01){
      ctx.save();ctx.beginPath();ctx.ellipse(125,143,18,8,0,0,Math.PI*2);ctx.clip();ctx.clearRect(0,0,160,160);frame(n,0,pose.tail);ctx.restore();
    }
    ctx.restore();
  }
  var lastLabel='';
  function render() {
    [[white,state.white],[tabby,state.tabby]].forEach(function(p){p[0].style.width=state.size+'px';p[0].style.height=state.size+'px';p[0].style.transform='translate3d('+p[1].x.toFixed(2)+'px,'+(p[1].y||0).toFixed(2)+'px,0)';});
    function drawCat(ctx,c,name,isTabby){paint(ctx,assets[name+'Actions']||assets[name],c,isTabby,!!assets[name+'Actions']);}
    drawCat(wctx,state.white,'white',false);drawCat(tctx,state.tabby,'tabby',true);
    var text=state.phase==='sleep'?'白貓和狸花 · 一起睡覺':state.phase==='play'?'白貓和狸花 · 陪你玩':/^chase/.test(state.phase)?'白貓和狸花 · 你追我跑':'白貓和狸花 · 一起陪你';
    if(!runtime.external&&text!==lastLabel&&assets.tabby){label.textContent=text;lastLabel=text;}
  }
  function canRun(){return !runtime.external&&!document.hidden&&!manualPause&&!state.reduced&&visible&&host.isConnected;}
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
  function tick(ts){raf=0;if(!canRun())return;if(!last||ts-last>=1000/30){step(state,last?(ts-last)/1000:0);last=ts;render();}raf=requestAnimationFrame(tick);}
  function resume(){if(canRun()&&!raf){last=0;raf=requestAnimationFrame(tick);}else if(!canRun())stop();}
  function mount(){if(runtime.external){if(runtime.onLayout)runtime.onLayout();return;}var header=document.querySelector('.premium-header');if(!header)return;if(host.parentNode!==header)header.appendChild(host);resize(state,arena.clientWidth||320);white.style.display='';render();resume();}
  pause.addEventListener('click',function(){manualPause=!manualPause;pause.textContent=manualPause?'繼續小貓':'暫停小貓';pause.setAttribute('aria-pressed',String(manualPause));resume();if(runtime.onControl)runtime.onControl();});
  tabby.addEventListener('click',function(){wake(state);render();resume();});
  function motion(){if(runtime.external){if(runtime.onMotion)runtime.onMotion(rm.matches);return;}reduce(state,rm.matches);render();resume();}
  if(rm.addEventListener)rm.addEventListener('change',motion);else if(rm.addListener)rm.addListener(motion);
  document.addEventListener('visibilitychange',function(){if(document.hidden)stop();else resume();});
  window.addEventListener('resize',mount,{passive:true});
  if(typeof ResizeObserver==='function')new ResizeObserver(function(){if(!runtime.external){resize(state,arena.clientWidth||320);render();}}).observe(arena);
  if(typeof IntersectionObserver==='function')new IntersectionObserver(function(entries){visible=entries[0].isIntersecting;resume();}).observe(host);
  runtime.stop=stop;runtime.render=render;runtime.assets=assets;runtime.loadAsset=load;
  mount();render();resume();
})();
