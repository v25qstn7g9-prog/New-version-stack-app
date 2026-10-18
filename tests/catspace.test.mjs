import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file = new URL('../za-catspace.js', import.meta.url);
function core() { const window = {}; if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file,'utf8'), {window,Math}); assert.ok(window.__zaCatSpaceCore, 'pure full-screen planner is exported'); return window.__zaCatSpaceCore; }
const rng = seed => () => ((seed = (1664525*seed+1013904223)>>>0)/4294967296);
function check(c,l,route) {
  assert.equal(route.ok,true,route.reason);
  assert.equal(c.validateRoute(l,route),true);
  for(let i=0;i<=2000;i++) assert.ok(c.isLegalPosition(l,c.sampleRoute(route,route.duration*i/2000)), `unsafe frame ${i}`);
}
test('targets cover all screen quadrants and respect safe areas on desktop and mobile',()=>{
  const c=core();
  for(const [width,height] of [[1440,900],[390,844],[280,620]]) {
    const l=c.normalizeLayout({width,height,safeTop:35,safeBottom:40});
    const targets=c.findTargets(l); assert.ok(targets.length>10);
    const quadrants=new Set();
    for(const p of targets) {assert.ok(c.isLegalPosition(l,p)); quadrants.add(`${p.x+l.footprint.w/2<width/2}:${p.y+l.footprint.h/2<height/2}`);}
    assert.equal(quadrants.size,4);
    assert.ok(l.footprint.w<=150); assert.ok(l.footprint.h<=65);
  }
});
test('walks stay horizontal; elevation changes have a deliberate curved hop',()=>{
  const c=core(), l=c.normalizeLayout({width:900,height:700});
  const walk=c.planRoute(l,{x:80,y:400},{x:230,y:400}); check(c,l,walk);
  assert.ok(walk.segments.every(s=>s.kind==='walk'));
  const hop=c.planRoute(l,{x:80,y:400},{x:500,y:180});check(c,l,hop);
  assert.equal(hop.segments[0].kind,'hop');
  const middle=c.sampleRoute(hop,hop.duration/2);assert.ok(middle.y<290-5);
});
test('protect and forbid rectangles exclude rests and every route frame, including thin barriers',()=>{
  const c=core();
  for(let seed=1;seed<=12;seed++) {
    const random=rng(seed), width=seed%2?1000:390,height=850;
    const l=c.normalizeLayout({width,height,safeTop:24,safeBottom:30,forbid:[{x:width*(.35+random()*.2),y:180+random()*80,w:1,h:120+random()*90}],protect:[{x:width*(.1+random()*.15),y:490+random()*60,w:width*.5,h:60+random()*30}]});
    const targets=c.findTargets(l);assert.ok(targets.length>3);
    let from=targets[0];
    for(let i=0;i<8;i++) {
      const to=c.chooseTarget(l,from,[from],random);assert.ok(to);assert.ok(c.isLegalPosition(l,to));
      const route=c.planRoute(l,from,to);
      if(route.ok){check(c,l,route);from=to;}else{assert.equal(route.fallback,'remain');assert.ok(route.reason);}
    }
  }
});
test('a continuous forbidden wall cannot be crossed and invalid start hides',()=>{
  const c=core(),l=c.normalizeLayout({width:1000,height:800,forbid:[{x:490,y:0,w:1,h:800}]});
  const route=c.planRoute(l,{x:50,y:400},{x:700,y:400});assert.equal(route.ok,false);assert.equal(route.fallback,'remain');
  assert.equal(c.planRoute(l,{x:480,y:400},{x:700,y:400}).fallback,'hide');
});
test('blocked or too-small layouts have no target and hide safely',()=>{
  const c=core();
  for(const raw of [{width:390,height:844,protect:[{x:0,y:0,w:390,h:844}]},{width:30,height:25},{width:NaN,height:600}]){
    const l=c.normalizeLayout(raw);assert.equal(c.findTargets(l).length,0);assert.equal(c.chooseTarget(l,{x:0,y:0}),null);
    assert.equal(c.planRoute(l,{x:0,y:0},{x:20,y:20}).fallback,'hide');
  }
});
test('recent target memory favors new screen areas and explicit waypoint routes are validated',()=>{
  const c=core(),l=c.normalizeLayout({width:1000,height:800}),from={x:30,y:600};
  const p=c.chooseTarget(l,from,[{x:800,y:600},{x:800,y:40}],()=>0);
  assert.ok(Math.hypot(p.x-from.x,p.y-from.y)>150);
  const route=c.planRoute(l,from,{x:700,y:200},{waypoints:[{x:30,y:200}]});check(c,l,route);assert.equal(route.segments.length,2);
  const bad=c.planRoute(l,from,{x:700,y:200},{waypoints:[{x:-20,y:200}]});assert.equal(bad.ok,false);
});

test('long horizontal travel runs with acceleration and hops expose crouch takeoff air landing',()=>{
  const c=core(),l=c.normalizeLayout({width:1000,height:800});
  const run=c.planRoute(l,{x:40,y:600},{x:700,y:600});check(c,l,run);assert.equal(run.segments[0].kind,'run');
  const a=c.sampleRoute(run,run.duration*.05),b=c.sampleRoute(run,run.duration*.1),m=c.sampleRoute(run,run.duration*.5),n=c.sampleRoute(run,run.duration*.55);
  assert.ok(b.x-a.x<n.x-m.x);
  const hop=c.planRoute(l,{x:40,y:600},{x:300,y:400});check(c,l,hop);
  assert.deepEqual([.05,.18,.5,.95].map(t=>c.sampleRoute(hop,hop.duration*t).phase),['crouch','takeoff','air','landing']);
});
test('routes detour around a central control and preserve continuity at every segment boundary',()=>{
  const c=core(),l=c.normalizeLayout({width:1000,height:800,forbid:[{x:450,y:300,w:60,h:220}]});
  const route=c.planRoute(l,{x:50,y:400},{x:700,y:400});check(c,l,route);assert.ok(route.segments.length>1);
  let time=0;for(const s of route.segments){time+=s.duration;const before=c.sampleRoute(route,time-1e-5),after=c.sampleRoute(route,time+1e-5);assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<.01);}
  const end=c.sampleRoute(route,route.duration+100);assert.equal(end.x,700);assert.equal(end.y,400);
});
test('custom pair footprints and lateral safe areas remain contained throughout motion',()=>{
  const c=core(),l=c.normalizeLayout({width:390,height:844,safeLeft:12,safeRight:16,safeTop:30,safeBottom:40,footprint:{w:164,h:44}});
  const targets=c.findTargets(l);assert.ok(targets.length>10);
  for(const p of targets){assert.ok(p.x>=20&&p.x+164<=366);assert.ok(p.y>=38&&p.y+44<=796);}
  check(c,l,c.planRoute(l,targets[0],targets.at(-1)));
});
test('route validator rejects malformed segments instead of silently accepting invalid geometry',()=>{
  const c=core(),l=c.normalizeLayout({width:1000,height:800});
  assert.equal(c.validateRoute(l,{ok:true,segments:[{from:{x:10,y:100},to:{x:800,y:500},duration:1,kind:'hop'}]}),false);
});
test('single-cat footprints run on mobile with configurable threshold and legal same-row candidates',()=>{
  const c=core();
  for(const size of [44,56]) {
    const l=c.normalizeLayout({width:390,height:844,footprint:{w:size,h:size},forbid:[{x:170,y:200,w:56,h:56}]});
    assert.equal(l.runThreshold,Math.max(90,size*3));
    const row=c.findRowTargets(l,400);assert.ok(row.length>=9);
    for(const p of row){assert.equal(p.y,400);assert.ok(c.isLegalPosition(l,p));}
    const route=c.planRoute(l,{x:20,y:400},{x:300,y:400},{maxNodes:24});check(c,l,route);assert.equal(route.segments[0].kind,'run');
    const slow=c.normalizeLayout({...l,runThreshold:400});assert.equal(c.planRoute(slow,{x:20,y:400},{x:300,y:400}).segments[0].kind,'walk');
    for(const p of c.findRowTargets(l,220))assert.ok(p.x+size<=170||p.x>=226);
    assert.equal(c.findRowTargets(l,-10).length,0);
  }
});
test('a partner is a hard dynamic obstacle and mobile detours remain safe with 24 nodes',()=>{
  const c=core(),raw={width:390,height:844,footprint:{w:44,h:44}};
  const initial=c.normalizeLayout(raw),from={x:20,y:400},to={x:300,y:400};
  const original=c.planRoute(initial,from,to);
  const withPartner=c.normalizeLayout({...raw,forbid:[{x:178,y:400,w:44,h:44}]});
  assert.equal(c.validateRoute(withPartner,original),false);
  const detour=c.planRoute(withPartner,from,to,{maxNodes:24});check(c,withPartner,detour);assert.ok(detour.segments.length>1);
  const movedPartner=c.normalizeLayout({...raw,forbid:[{x:20,y:400,w:44,h:44}]});
  assert.equal(c.planRoute(movedPartner,from,to,{maxNodes:24}).fallback,'hide');
});
test('direct-only planning rejects a blocked segment without attempting a detour',()=>{
  const c=core(),l=c.normalizeLayout({width:390,height:844,footprint:{w:44,h:44},forbid:[{x:178,y:400,w:44,h:44}]});
  const route=c.planRoute(l,{x:20,y:400},{x:300,y:400},{directOnly:true});
  assert.equal(route.ok,false);assert.equal(route.reason,'blocked-direct-path');assert.equal(route.fallback,'remain');
  check(c,l,c.planRoute(l,{x:20,y:600},{x:300,y:600},{directOnly:true}));
});
test('dense layouts keep target collision work bounded instead of crossing every obstacle edge',()=>{
  const c=core(),random=rng(712),forbid=Array.from({length:200},()=>({x:random()*970,y:random()*820,w:14,h:14}));
  const l=c.normalizeLayout({width:1000,height:850,footprint:{w:44,h:44},forbid});
  let reads=0;
  l.obstacles=l.obstacles.map(r=>new Proxy(r,{get(target,key){if(key==='x')reads++;return target[key];}}));
  const targets=c.findTargets(l);
  assert.ok(reads<500000,`target enumeration used ${reads} rectangle reads`);
  assert.ok(targets.length>0&&targets.length<=192);
  for(const p of targets)assert.ok(c.isLegalPosition(l,p));
});
test('opt-in text transit opens disconnected screen regions without resting over text or crossing controls',()=>{
 const c=core(),raw={width:390,height:844,footprint:{w:53,h:53},protect:[{x:0,y:320,w:390,h:32}]},from={x:20,y:100},to={x:300,y:650};
 assert.equal(c.planRoute(raw,from,to,{directOnly:true}).ok,false);
 const l=c.normalizeLayout({...raw,allowTextTransit:true}),r=c.planRoute(l,from,to,{directOnly:true});
 assert.equal(r.ok,true);assert.equal(c.validateRoute(l,r),true);
 assert.equal(c.isLegalPosition(l,{x:20,y:320}),false);
 for(let i=0;i<=200;i++)assert.equal(c.isLegalTransitPosition(l,c.sampleRoute(r,r.duration*i/200)),true);
 assert.equal(c.planRoute({...raw,allowTextTransit:true,forbid:raw.protect},from,to,{directOnly:true}).ok,false);
});
