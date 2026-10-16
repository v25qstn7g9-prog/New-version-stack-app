// Independent cat lives: personality, routes and occasional voluntary interaction.
(function(){
 'use strict';
 if(window.__zaCatLifeCore)return;
 var space=window.__zaCatSpaceCore;if(!space)return;
 function overlap(a,b,size,pad){if(a.hidden||b.hidden)return false;pad=pad||0;return a.x<b.x+size+pad&&a.x+size+pad>b.x&&a.y<b.y+size+pad&&a.y+size+pad>b.y;}
 function create(layout,rng){var s={layout:space.normalizeLayout(layout),rng:rng||Math.random,reduced:false,elapsed:0,social:null,socialWait:14,actors:[]};
  s.actors=['white','tabby'].map(function(name,i){return{name:name,index:i,x:0,y:0,hidden:true,mode:'observe',clock:0,wait:i?2:7,route:null,routeTime:0,gait:i?3.5:0,facing:i?1:-1,progress:0,history:[],speed:i?1.08:.76,hold:0};});relayout(s,layout);return s;}
 function actorLayout(s,a){var other=s.actors[1-a.index],l=s.layout;var forbid=l.forbid.slice();if(!other.hidden)forbid.push({x:other.x-5,y:other.y-5,w:l.footprint.w+10,h:l.footprint.h+10});return space.normalizeLayout({width:l.width,height:l.height,safeLeft:l.minX-8,safeTop:l.minY-8,safeRight:l.width-l.maxX-l.footprint.w-8,safeBottom:l.height-l.maxY-l.footprint.h-8,footprint:l.footprint,runThreshold:a.index?l.runThreshold:l.runThreshold*1.6,protect:l.protect,forbid:forbid});}
 function relayout(s,raw){s.layout=space.normalizeLayout(raw);var size=s.layout.footprint.w;
  s.actors.forEach(function(a){var l=actorLayout(s,a),changed=false;if(a.route&&!space.validateRoute(l,a.route)){a.route=null;changed=true;s.social=null;}if(a.hidden||!space.isLegalPosition(l,a)){changed=true;s.social=null;a.route=null;a.hidden=true;var targets=space.findTargets(l);var p=targets.find(function(p){return !overlap(p,s.actors[1-a.index],size,6);});if(p){a.x=p.x;a.y=p.y;a.hidden=false;}}if(changed){a.hold=0;a.mode=s.reduced?'sleep':'observe';a.wait=2+s.rng()*5;a.clock=0;}});}
 function begin(s,a,target,directOnly){var l=actorLayout(s,a),r=space.planRoute(l,a,target,{maxNodes:12,directOnly:!!directOnly});if(!r.ok)return false;a.route=r;a.routeTime=0;a.clock=0;a.history.push({x:target.x,y:target.y});if(a.history.length>8)a.history.shift();return true;}
 function roam(s,a,forced){if(a.hidden)return false;if(forced&&begin(s,a,forced))return true;var l=actorLayout(s,a),row=space.findRowTargets?space.findRowTargets(l,a.y):[];var candidates=s.rng()<.72&&row.length?row:space.findTargets(l);var short=s.rng()<(a.index?.32:.58),ideal=short?55+s.rng()*65:Math.max(l.width,l.height)*.65;
  candidates.sort(function(p,q){function score(p){var d=Math.hypot(p.x-a.x,p.y-a.y),nov=a.history.length?Math.min.apply(null,a.history.map(function(h){return Math.hypot(p.x-h.x,p.y-h.y);})):200;return -Math.abs(d-ideal)+nov*.15;}return score(q)-score(p);});
  for(var i=0;i<Math.min(7,candidates.length);i++){var p=candidates[i];if(Math.hypot(p.x-a.x,p.y-a.y)<25)continue;if(begin(s,a,p,true))return true;}a.mode='observe';a.wait=6+s.rng()*7;return false;}
 function idle(s,a,mode,wait){a.mode=mode;a.clock=0;a.wait=wait;a.route=null;a.progress=0;}
 function wake(s,index){var a=s.actors[index];if(s.reduced||!a||a.hidden)return;s.social=null;idle(s,a,'wake',1.7+a.index*.3);a.hold=0;}
 function reduce(s,on){s.reduced=on;s.social=null;s.actors.forEach(function(a){if(on&&a.route){var l=actorLayout(s,a),ends=[a.route.from,a.route.to].sort(function(p,q){return Math.hypot(p.x-a.x,p.y-a.y)-Math.hypot(q.x-a.x,q.y-a.y);}),ground=ends.find(function(p){return space.isLegalPosition(l,p);});if(ground){a.x=ground.x;a.y=ground.y;}else a.hidden=true;}a.route=null;a.hold=0;idle(s,a,on?'sleep':'wake',on?999:1.7+a.index*.6);});}
 function gather(s){var initiator=s.rng()<.8?1:0,a=s.actors[initiator],b=s.actors[1-initiator];if(a.hidden||b.hidden||a.route||b.route||b.mode==='wake')return;
  var size=s.layout.footprint.w,gap=size+10,options=[{x:b.x+gap,y:b.y},{x:b.x-gap,y:b.y}];
  for(var p of options){if(begin(s,a,p)){var kind=s.rng()<.5?'sleep':'play';s.social={kind:kind,initiator:initiator,stage:'approach',time:0};b.hold=a.route.duration/a.speed+12;b.mode='observe';a.purpose='social';return;}}
 }
 function arrived(s,a){a.route=null;a.routeTime=0;a.clock=0;
  if(a.purpose==='social'&&s.social){a.purpose=null;s.social.stage='together';s.social.time=0;var b=s.actors[1-a.index];a.facing=a.x<b.x?-1:1;b.facing=-a.facing;
    if(s.social.kind==='sleep'){idle(s,a,'settle',1.5);idle(s,b,'observe',2.6);b.next='settle';b.hold=0;}else{idle(s,a,'invite',3.2);idle(s,b,'observe',1.1);b.next='respond';b.hold=0;}
  }else idle(s,a,'observe',(a.index?1:4)+s.rng()*(a.index?4:9));
 }
 function next(s,a){if(a.next){var n=a.next;a.next=null;idle(s,a,n,n==='settle'?1.7:3.6);return;}
  if(a.mode==='settle'){idle(s,a,'sleep',(a.index?12:24)+s.rng()*(a.index?16:30));return;}
  if(a.mode==='sleep'){idle(s,a,'wake',1.5+a.index*.5);return;}
  if(a.mode==='invite'||a.mode==='respond'){idle(s,a,'observe',a.index?1.8:3.2);return;}
  if(a.follow){var goal=a.follow;a.follow=null;if(roam(s,a,goal))return;}
  var r=s.rng();if(r<(a.index?.12:.36)){idle(s,a,'settle',1.4+s.rng()*.6);return;}if(r<(a.index?.25:.5)){idle(s,a,'observe',3+s.rng()*7);return;}roam(s,a);
 }
 function step(s,dt){if(s.reduced)return;dt=Math.max(0,Math.min(.05,dt));s.elapsed+=dt;s.socialWait-=dt;
  for(var a of s.actors){if(a.hidden)continue;a.clock+=dt;a.hold=Math.max(0,a.hold-dt);
   if(a.route){var old=a.routeTime;a.routeTime+=dt*a.speed;var p=space.sampleRoute(a.route,a.routeTime);var other=s.actors[1-a.index];
    if(overlap(p,other,s.layout.footprint.w,5)){a.routeTime=old;a.blocked=(a.blocked||0)+dt;if(a.blocked>1.2){a.purpose=null;idle(s,a,'observe',2+s.rng()*4);s.social=null;}continue;}
    a.blocked=0;a.gait+=Math.hypot(p.x-a.x,p.y-a.y)/(s.layout.footprint.w*(a.index?.62:.79))*8;a.x=p.x;a.y=p.y;a.mode=p.kind;a.progress=p.progress;a.jumpPhase=p.phase;a.facing=-p.facing;
    if(a.routeTime>=a.route.duration)arrived(s,a);
   }else{a.progress=Math.min(1,a.clock/(a.mode==='settle'?1.6:a.mode==='wake'?1.8:3));a.wait-=dt;if(a.wait<=0&&!a.hold)next(s,a);}
  }
  if(s.social){s.social.time+=dt;if(s.social.stage==='together'&&s.social.time>8){var lead=s.actors[s.social.initiator],follow=s.actors[1-s.social.initiator];if(s.social.kind==='play'&&!lead.route&&roam(s,lead)){var t=lead.route.to;follow.follow={x:t.x+(lead.x<follow.x?1:-1)*(s.layout.footprint.w+12),y:t.y};follow.wait=1.1;follow.hold=0;}s.social=null;}else if(s.social.time>20){s.social=null;s.actors.forEach(function(a){a.hold=0;});}}
  if(s.socialWait<=0&&!s.social){gather(s);s.socialWait=16+s.rng()*24;}
 }
 var core=window.__zaCatLifeCore={create:create,step:step,relayout:relayout,wake:wake,reduce:reduce,overlap:overlap,actorLayout:actorLayout};
 if(typeof document==='undefined')return;
 // DOM integration below is opt-in only once the existing renderer is ready.
 var pair=window.__zaCatPairCore,rt=pair&&pair.runtime;if(!rt)return;
 rt.external=true;rt.stop();
 var css=document.createElement('style');css.textContent=
 '.za-cat-arena.za-cat-fullscreen{position:fixed;inset:0;width:100%;height:100%;z-index:18;pointer-events:none;overflow:hidden;border:0;contain:layout paint}' +
 'html .za-cat-arena.za-cat-fullscreen button.za-photocat{top:0!important;bottom:auto!important;pointer-events:none!important;cursor:default}' +
 '.za-cat-pair{contain:layout style}.za-cat-pair-bar{height:auto;min-height:34px;flex-wrap:wrap;justify-content:flex-end}.za-cat-pair-bar>span{margin-right:auto}' +
 'html .premium-header button.za-cat-control{min-width:44px!important;min-height:34px!important;font-size:10px!important;padding:4px 8px!important;border-radius:999px;background:transparent!important;border:1px solid currentColor!important;color:inherit!important}' +
 '.za-cat-safe{position:fixed;pointer-events:none;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}';document.head.appendChild(css);
 rt.arena.classList.add('za-cat-fullscreen');document.body.appendChild(rt.arena);
 [rt.white,rt.tabby].forEach(function(el){el.tabIndex=-1;el.setAttribute('aria-hidden','true');});
 var hide=document.createElement('button');hide.type='button';hide.className='za-cat-control';hide.textContent='收起小貓';hide.setAttribute('aria-pressed','false');rt.bar.appendChild(hide);
 var pet=document.createElement('button');pet.type='button';pet.className='za-cat-control';pet.textContent='叫醒／逗貓';rt.bar.appendChild(pet);
 var safe=document.createElement('i');safe.className='za-cat-safe';document.body.appendChild(safe);
 var life=null,raf=0,last=0,userHidden=false,timer=0,dirty=true,assetError=false;
 var media=window.matchMedia('(prefers-reduced-motion: reduce)');
 function rect(r){return{x:r.left,y:r.top,w:r.width,h:r.height};}
 function measured(){
  var vp=window.visualViewport,w=vp?vp.width:window.innerWidth,h=vp?vp.height:window.innerHeight;var ox=vp?(vp.offsetLeft||0):0,oy=vp?(vp.offsetTop||0):0;rt.arena.style.left=ox+'px';rt.arena.style.top=oy+'px';rt.arena.style.width=w+'px';rt.arena.style.height=h+'px';function localRect(r){return{x:r.left-ox,y:r.top-oy,w:r.width,h:r.height};}function visible(r){return r.width&&r.height&&r.bottom>oy&&r.top<oy+h&&r.right>ox&&r.left<ox+w;}
  var insets=getComputedStyle(safe),protect=[],forbid=[],size=w<600?44:56;
  var els=document.querySelectorAll('button,a,input,select,textarea,[role=button],[role=dialog],.premium-tabbar,.premium-ai-launcher,svg,canvas,img,video,iframe');
  for(var el of els){if(rt.arena.contains(el)||rt.host.contains(el)||el===safe)continue;var r=el.getBoundingClientRect();if(visible(r)){(el.matches('button,a,input,select,textarea,[role=button],[role=dialog],.premium-tabbar,.premium-ai-launcher')?forbid:protect).push(localRect(r));}}
  // Visible text bounds protect the numbers as well as charts. Never read their values.
  var walker=document.createTreeWalker(document.body,4),node,range=document.createRange();
  while((node=walker.nextNode())){if(!node.nodeValue||!node.nodeValue.trim()||rt.arena.contains(node)||rt.host.contains(node))continue;var parent=node.parentElement;if(!parent||parent.closest('script,style,noscript'))continue;range.selectNodeContents(node);for(var r of range.getClientRects())if(visible(r))protect.push(localRect(r));}
  var hr=rt.host.getBoundingClientRect();if(hr.width&&hr.height)forbid.push(localRect(hr));
  return {width:w,height:h,footprint:{w:size,h:size},safeTop:parseFloat(insets.paddingTop)||0,safeBottom:parseFloat(insets.paddingBottom)||0,safeLeft:parseFloat(insets.paddingLeft)||0,safeRight:parseFloat(insets.paddingRight)||0,protect:protect,forbid:forbid};
 }
 function assetsReady(){return ['white','tabby'].every(function(n){return !!rt.assets[n];});}
 function draw(){if(!life)return;pair.state.size=life.layout.footprint.w;pair.state.time=life.elapsed;
  life.actors.forEach(function(a,i){var p=i?pair.state.tabby:pair.state.white;p.x=a.x;p.y=a.y;p.mode=a.mode;p.frame=a.gait;p.progress=a.progress;p.facing=a.facing;(i?rt.tabby:rt.white).style.visibility=a.hidden?'hidden':'';});
  pair.state.phase=life.actors.every(function(a){return a.mode==='sleep';})?'sleep':life.social?'play':'roaming';rt.render();
  var label=assetError?'部分動作素材載入失敗，活動已暫停':userHidden?'小貓已收起':life.actors.every(function(a){return a.hidden;})?'暫時沒有安全空位':life.social?'小貓正在互相陪伴':'白貓悠閒 · 狸花好奇';
  if(rt.label.textContent!==label)rt.label.textContent=label;
 }
 function running(){return life&&!document.hidden&&!userHidden&&!rt.isPaused()&&!life.reduced&&!assetError&&assetsReady()&&!dirty;}
 function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
 function tick(ts){raf=0;if(!running())return;if(!last||ts-last>=1000/30){step(life,last?(ts-last)/1000:0);last=ts;draw();}raf=requestAnimationFrame(tick);}
 function resume(){if(running()&&!raf){last=0;raf=requestAnimationFrame(tick);}else if(!running())stop();}
 function remeasure(){timer=0;var header=document.querySelector('.premium-header');if(header&&rt.host.parentNode!==header)header.appendChild(rt.host);var l=measured();if(life)relayout(life,l);else life=create(l,safeRandom);core.state=life;if(life.reduced!==media.matches)reduce(life,media.matches);dirty=false;rt.arena.style.visibility=userHidden||!assetsReady()||assetError?'hidden':'';draw();resume();}
 function safeRandom(){return Math.random();}
 function invalidate(){dirty=true;stop();rt.arena.style.visibility='hidden';if(!timer)timer=setTimeout(remeasure,120);}
 window.__zaPhotoCat.roam.ignoreMutation=function(target){return rt.host.contains(target)||rt.arena.contains(target)||target===safe;};
 rt.onLayout=invalidate;rt.onControl=resume;rt.onMotion=function(on){if(life){reduce(life,on);draw();resume();}};rt.onAssetError=function(){assetError=true;rt.arena.style.visibility='hidden';stop();draw();};
 hide.addEventListener('click',function(){userHidden=!userHidden;hide.textContent=userHidden?'顯示小貓':'收起小貓';hide.setAttribute('aria-pressed',String(userHidden));rt.arena.style.visibility=userHidden||!assetsReady()||assetError?'hidden':'';if(!userHidden)invalidate();draw();resume();});
 pet.addEventListener('click',function(){if(life){wake(life,life.rng()<.7?1:0);draw();resume();}});
 document.addEventListener('visibilitychange',function(){if(document.hidden)stop();else invalidate();});
 window.addEventListener('scroll',invalidate,{passive:true,capture:true});window.addEventListener('resize',invalidate,{passive:true});
 if(window.visualViewport){window.visualViewport.addEventListener('resize',invalidate,{passive:true});window.visualViewport.addEventListener('scroll',invalidate,{passive:true});}
 if(typeof MutationObserver!=='undefined'){new MutationObserver(function(records){if(records.some(function(r){return !window.__zaPhotoCat.roam.ignoreMutation(r.target);}))invalidate();}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','style','hidden','open']});}
 // Asset completions are rare. A separate callback does not poll or start extra RAFs.
 rt.onAssetsReady=function(){if(life&&!dirty){rt.arena.style.visibility=userHidden||!assetsReady()||assetError?'hidden':'';draw();}resume();};
 remeasure();
})();
