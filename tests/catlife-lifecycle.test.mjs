import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({reduced=false,viewport=null,delayedAssets=false,obstacles=[]}={}) {
  const rafs=new Map(),timers=new Map(),events={},windowEvents={},viewportEvents={},mediaEvents=[],observers=[];
  let id=0,now=0;const due=new Map();
  const bounds={left:0,top:0,right:390,bottom:35,width:390,height:35};
  function el(tag){return {tag,style:{},children:[],listeners:{},attrs:{},parentNode:null,
    classList:{add(){}},appendChild(c){if(c.parentNode)c.parentNode.children=c.parentNode.children.filter(x=>x!==c);this.children.push(c);c.parentNode=this;return c;},
    contains(n){return n===this||this.children.some(c=>c.contains(n));},
    setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){(this.listeners[k]??=[]).push(f);},
    getBoundingClientRect(){return bounds;}};}
  const body=el('body'),header=el('header'),host=el('section'),arena=el('div'),bar=el('div'),white=el('button'),tabby=el('button'),label=el('span');
  body.appendChild(header);header.appendChild(host);host.appendChild(bar);bar.appendChild(label);host.appendChild(arena);arena.appendChild(white);arena.appendChild(tabby);
  const media={matches:reduced,addEventListener(k,f){mediaEvents.push(f);}};
  let paused=false;
  const state={white:{},tabby:{},reduced};
  const rt={host,arena,bar,white,tabby,label,assets:delayedAssets?{}:{white:true,tabby:true},stop(){},isPaused:()=>paused,render(){},loadAsset(name){if(!delayedAssets)this.assets[name]=true;}};
  const document={body,head:el('head'),hidden:false,createElement:el,querySelector:()=>header,querySelectorAll:()=>obstacles.map(r=>({getBoundingClientRect:()=>r,matches:()=>true})),createTreeWalker:()=>({nextNode:()=>null}),createRange:()=>({}),addEventListener(k,f){(events[k]??=[]).push(f);}};
  const window={__zaPhotoCat:{roam:{}},__zaCatPairCore:{runtime:rt,state},innerWidth:390,innerHeight:844,visualViewport:viewport&&{...viewport,addEventListener(k,f){(viewportEvents[k]??=[]).push(f);}},matchMedia:()=>media,addEventListener(k,f){(windowEvents[k]??=[]).push(f);}};
  const sandbox={window,document,Math,MutationObserver:function(fn){observers.push({fn,options:null});this.observe=(target,options)=>{observers.at(-1).options=options;};},getComputedStyle:()=>({paddingTop:'0',paddingBottom:'0',paddingLeft:'0',paddingRight:'0'}),requestAnimationFrame(f){rafs.set(++id,f);return id;},cancelAnimationFrame(i){rafs.delete(i);},setTimeout(f,delay=0){timers.set(++id,f);due.set(id,now+delay);return id;},clearTimeout(i){timers.delete(i);due.delete(i);}};
  vm.createContext(sandbox);
  for(const f of ['za-catspace.js','za-catlife.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),sandbox);
  return {window,document,rt,rafs,timers,media,observers,life:window.__zaCatLifeCore.state,
    click(text){const button=bar.children.find(x=>x.textContent===text);assert.ok(button);button.listeners.click.forEach(f=>f());},
    visibility(hidden){document.hidden=hidden;events.visibilitychange.forEach(f=>f());},
    flush(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(f=>f());},
    advance(ms){const end=now+ms;for(;;){const next=[...timers.keys()].filter(i=>due.get(i)<=end).sort((a,b)=>due.get(a)-due.get(b))[0];if(!next)break;now=due.get(next);const f=timers.get(next);timers.delete(next);due.delete(next);f();}now=end;},
    frame(ts){const callbacks=[...rafs.values()];rafs.clear();callbacks.forEach(f=>f(ts));},
    pause(on){paused=on;rt.onControl();},
    resize(width,height){window.innerWidth=width;window.innerHeight=height;(windowEvents.resize||[]).forEach(f=>f());},
    viewportEvent(type,patch){Object.assign(window.visualViewport,patch);(viewportEvents[type]||[]).forEach(f=>f());},
    scroll(){(windowEvents.scroll||[]).forEach(f=>f());},
    motion(on){media.matches=on;rt.onMotion(on);}};
}

test('full-screen lifecycle owns one loop and stops/resumes around visibility',()=>{
  const h=harness();assert.equal(h.rafs.size,1);h.frame(100);h.frame(140);
  h.visibility(true);assert.equal(h.rafs.size,0);
  h.visibility(false);h.visibility(false);assert.equal(h.timers.size,1);assert.equal(h.rafs.size,0);
  h.flush();assert.equal(h.rafs.size,1);h.rt.onAssetsReady();assert.equal(h.rafs.size,1);
});
test('manual pause survives invalidation, asset callback and visibility restoration',()=>{
  const h=harness();h.pause(true);h.rt.onLayout();h.flush();h.rt.onAssetsReady();h.visibility(true);h.visibility(false);h.flush();assert.equal(h.rafs.size,0);
  h.pause(false);assert.equal(h.rafs.size,1);
});
test('hide survives layout and visibility changes; restore remeasures before movement',()=>{
  const h=harness();h.click('收起小貓');assert.equal(h.rafs.size,0);assert.equal(h.rt.arena.style.visibility,'hidden');
  h.rt.onLayout();h.visibility(true);h.visibility(false);h.flush();assert.equal(h.rafs.size,0);assert.equal(h.rt.arena.style.visibility,'hidden');
  h.click('顯示小貓');assert.equal(h.rafs.size,0);h.flush();assert.equal(h.rafs.size,1);assert.equal(h.rt.arena.style.visibility,'');
});
test('reduced motion blocks initial animation, waking, and asset-ready restarts',()=>{
  const h=harness({reduced:true});assert.equal(h.rafs.size,0);assert.ok(h.life.actors.every(a=>a.mode==='sleep'));
  h.click('叫醒／逗貓');h.rt.onAssetsReady();assert.equal(h.rafs.size,0);
  h.motion(false);assert.equal(h.rafs.size,1);h.motion(true);assert.equal(h.rafs.size,0);
});
test('asset failure stops all motion even when further assets arrive',()=>{
  const h=harness();h.rt.onAssetError('tabbyAction');assert.equal(h.rafs.size,0);h.rt.onAssetsReady();h.rt.onLayout();h.flush();assert.equal(h.rafs.size,0);assert.match(h.rt.label.textContent,/載入失敗/);
});
test('self mutations are ignored, unrelated changes invalidate',()=>{
  const h=harness(),ignore=h.window.__zaPhotoCat.roam.ignoreMutation;
  assert.equal(ignore(h.rt.white),true);assert.equal(ignore(h.rt.label),true);
  assert.equal(ignore(h.rt.bar),true);assert.equal(ignore(h.document.body),false);
});

test('visual viewport offsets translate arena and protected controls into local coordinates',()=>{
  const h=harness({viewport:{width:240,height:500,offsetLeft:70,offsetTop:120},obstacles:[{left:100,top:200,right:150,bottom:230,width:50,height:30}]});
  assert.equal(h.rt.arena.style.left,'70px');assert.equal(h.rt.arena.style.top,'120px');assert.equal(h.rt.arena.style.width,'240px');assert.equal(h.rt.arena.style.height,'500px');
  const r=h.life.layout.forbid[0];assert.equal(r.x,30);assert.equal(r.y,80);assert.equal(r.w,50);assert.equal(r.h,30);
});
test('arena remains hidden until every required asset has loaded',()=>{
  const h=harness({delayedAssets:true});assert.equal(h.rt.arena.style.visibility,'hidden');assert.equal(h.rafs.size,0);
  for(const name of ['white']){h.rt.assets[name]=true;h.rt.onAssetsReady();assert.equal(h.rt.arena.style.visibility,'hidden');assert.equal(h.rafs.size,0);}
  h.rt.assets.tabby=true;h.rt.onAssetsReady();assert.equal(h.rt.arena.style.visibility,'');assert.equal(h.rafs.size,1);
  h.rt.onAssetError('white');assert.equal(h.rt.arena.style.visibility,'hidden');assert.equal(h.rafs.size,0);
});
test('attribute observer invalidates external geometry but ignores its own render mutations',()=>{
  const h=harness(),o=h.observers.find(o=>o.options.attributes);assert.ok(o);assert.ok(o.options.attributeFilter.includes('style'));assert.ok(o.options.attributeFilter.includes('class'));
  o.fn([{target:h.rt.white},{target:h.rt.arena},{target:h.rt.bar}]);assert.equal(h.timers.size,0);assert.equal(h.rafs.size,1);
  o.fn([{target:h.document.body}]);assert.equal(h.timers.size,1);assert.equal(h.rafs.size,1);assert.equal(h.rt.arena.style.visibility,'');h.flush();assert.equal(h.rafs.size,1);
});
test('enabling reduced motion mid-hop settles at a legal route endpoint before freezing',()=>{
  const h=harness(),space=h.window.__zaCatSpaceCore,a=h.life.actors[0];
  h.life.actors[1].hidden=true;
  const route=space.planRoute(h.life.layout,{x:90,y:200},{x:220,y:350});assert.ok(route.ok);
  const p=space.sampleRoute(route,route.duration*.5);Object.assign(a,{x:p.x,y:p.y,mode:'hop',route,routeTime:route.duration*.5});
  h.motion(true);assert.equal(h.rafs.size,0);assert.equal(a.route,null);assert.equal(a.mode,'sleep');assert.equal(a.hidden,false);
  assert.ok((a.x===route.from.x&&a.y===route.from.y)||(a.x===route.to.x&&a.y===route.to.y));assert.ok(space.isLegalPosition(h.life.layout,a));
  const before=JSON.stringify(h.life.actors);h.window.__zaCatLifeCore.step(h.life,.05);assert.equal(JSON.stringify(h.life.actors),before);
});

test('frequent unrelated text/style updates never blank the arena or starve animation',()=>{
 const h=harness(),o=h.observers.find(o=>o.options.attributes);let last=0;
 for(let i=1;i<=30;i++){o.fn([{target:h.document.body}]);h.rt.onLayout();assert.equal(h.rt.arena.style.visibility,'','routine update must not flash hidden');h.frame(i*50);h.flush();last=h.life.elapsed;}
 assert.ok(last>.5,'unrelated update stream must not continually reset frame timing');assert.equal(h.rafs.size,1);
});
test('cat footprint grows 20 percent while arena remains the full visual viewport',()=>{const h=harness();assert.equal(h.life.layout.footprint.w,53);assert.equal(h.life.layout.width,390);assert.equal(h.life.layout.height,844);assert.equal(h.rt.arena.style.width,'390px');});

test('desktop resize and repeated scroll retain visible cats, coalesce measurement and resume one loop',()=>{
 const h=harness();h.resize(1200,800);for(let i=0;i<10;i++)h.scroll();
 assert.equal(h.rt.arena.style.visibility,'');assert.equal(h.timers.size,1);assert.equal(h.rafs.size,0);h.flush();
 assert.equal(h.life.layout.footprint.w,67);assert.equal(h.life.layout.width,1200);assert.equal(h.life.layout.height,800);assert.equal(h.rafs.size,1);
 h.resize(240,400);h.flush();const space=h.window.__zaCatSpaceCore;
 for(const a of h.life.actors)if(!a.hidden)assert.ok(space.isLegalTransitPosition(h.life.layout,a));
 assert.equal(h.rafs.size,1);assert.equal(h.rt.arena.style.visibility,'');
});


test('renderer follows reduced-motion changes in both directions after life takes over',()=>{
 const h=harness({reduced:true}),renderer=h.window.__zaCatPairCore.state;
 assert.equal(renderer.reduced,true);
 h.motion(false);assert.equal(h.life.reduced,false);assert.equal(renderer.reduced,false,'renderer must resume its idle/action animation clock');
 h.motion(true);assert.equal(h.life.reduced,true);assert.equal(renderer.reduced,true);
});


test('scrolling freezes both cats across moving controls and unrelated layout notifications',()=>{
 const obstacles=[],h=harness({obstacles});h.frame(100);h.frame(150);
 const before=JSON.stringify(h.life.actors),a=h.life.actors[0];
 obstacles.push({left:a.x,top:a.y,right:a.x+53,bottom:a.y+53,width:53,height:53});
 for(let i=0;i<8;i++){
  h.scroll();h.rt.onLayout();h.advance(90);h.frame(200+i*100);
  assert.equal(JSON.stringify(h.life.actors),before,'scrolling must not relocate or reset either cat');
  assert.equal(h.rafs.size,0,'animation waits for the final scroll event');
 }
 h.advance(90);assert.equal(JSON.stringify(h.life.actors),before,'unsafe relocation waits until faded out');
 assert.equal(h.rt.arena.style.opacity,'0');assert.equal(h.rafs.size,0);
 h.advance(140);assert.notEqual(JSON.stringify(h.life.actors),before);
 const space=h.window.__zaCatSpaceCore;
 for(const cat of h.life.actors)if(!cat.hidden)assert.ok(space.isLegalPosition(h.window.__zaCatLifeCore.actorLayout(h.life,cat),cat));
 assert.equal(h.rt.arena.style.opacity,'1');assert.equal(h.rafs.size,1);
});

test('scrolling with unchanged safe positions preserves routes, action clocks and one animation loop',()=>{
 const obstacles=[],h=harness({obstacles});h.frame(100);h.frame(150);
 const core=h.window.__zaCatLifeCore,space=h.window.__zaCatSpaceCore,a=h.life.actors[1];
 const route=space.planRoute(core.actorLayout(h.life,a),a,{x:250,y:300});assert.ok(route.ok);
 const p=space.sampleRoute(route,.4);Object.assign(a,{x:p.x,y:p.y,route,routeTime:.4,mode:'hop',clock:.4,progress:p.progress});
 const before=JSON.stringify(h.life.actors);
 obstacles.push({left:100,top:700,right:130,bottom:730,width:30,height:30});
 for(let i=0;i<5;i++){h.scroll();h.advance(100);assert.equal(h.rafs.size,0);}
 h.advance(80);assert.equal(JSON.stringify(h.life.actors),before);assert.equal(h.rafs.size,1);
});

test('a new scroll cancels an in-progress relocation and reuses the original positions',()=>{
 const obstacles=[],h=harness({obstacles}),a=h.life.actors[0],before=JSON.stringify(h.life.actors);
 obstacles.push({left:a.x,top:a.y,right:a.x+53,bottom:a.y+53,width:53,height:53});
 h.scroll();h.advance(180);assert.equal(h.rt.arena.style.opacity,'0');
 h.scroll();h.advance(150);assert.equal(JSON.stringify(h.life.actors),before);assert.equal(h.rafs.size,0);
 obstacles.length=0;h.advance(170);assert.equal(JSON.stringify(h.life.actors),before);assert.equal(h.rafs.size,1);assert.equal(h.rt.arena.style.opacity,'1');
});


test('visual viewport origin changes never shift the visible arena before it has faded out',()=>{
 const h=harness({viewport:{width:390,height:844,offsetLeft:0,offsetTop:0}}),before=JSON.stringify(h.life.actors);
 h.viewportEvent('scroll',{offsetTop:100});h.advance(100);
 assert.equal(h.rt.arena.style.top,'0px');assert.equal(JSON.stringify(h.life.actors),before);
 h.viewportEvent('resize',{height:744});h.advance(180);
 assert.equal(h.rt.arena.style.top,'0px','measurements must not shift the visible arena');assert.equal(h.rt.arena.style.opacity,'0');
 h.advance(140);assert.equal(h.rt.arena.style.top,'100px');assert.equal(h.rt.arena.style.height,'744px');assert.equal(h.rt.arena.style.opacity,'1');assert.equal(h.rafs.size,1);
});
