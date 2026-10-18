import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function cores(){const window={};const context=vm.createContext({window,Math});for(const f of ['za-catspace.js','za-catpair.js','za-catlife.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),context);return {pair:window.__zaCatPairCore,space:window.__zaCatSpaceCore,life:window.__zaCatLifeCore};}
function rng(seed=812){return()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);}
const layout={width:640,height:650,safeTop:30,safeBottom:60,footprint:{w:44,h:44},protect:[],forbid:[]};

test('jump feet stay planted while crouching and after landing; travelling only during flight',()=>{
 const {space}=cores();const r=space.planRoute(layout,{x:50,y:450},{x:200,y:300});assert.ok(r.ok);
 for(const t of [0,.04,.11]){const p=space.sampleRoute(r,r.duration*t);assert.equal(p.x,50,'launch paws must stay grounded');assert.equal(p.y,450);}
 for(const t of [.89,.95,1]){const p=space.sampleRoute(r,r.duration*t);assert.equal(p.x,200,'landing paws must stay planted');assert.equal(p.y,300);}
 assert.ok(space.sampleRoute(r,r.duration*.5).y<375);
});

test('walk, run and jump select genuinely different action rows; flight never cycles walking paws',()=>{
 const {pair}=cores();assert.equal(typeof pair.samplePose,'function');
 for(let n=0;n<24;n++){
  const c={frame:n+.2,clock:.3,progress:.5,facing:1,index:0};
  assert.ok(pair.samplePose({...c,mode:'walk'},4).frame<8);
  const run=pair.samplePose({...c,mode:'run'},4).frame;assert.ok(run>=8&&run<16);
  const hop=pair.samplePose({...c,mode:'hop',jumpPhase:'air'},4).frame;assert.ok(hop>=19&&hop<=21);
 }
});

test('idle has sparse blinks and subtle local breathing; a paused/reduced sample remains unchanged',()=>{
 const {pair}=cores();assert.equal(typeof pair.samplePose,'function');const c={mode:'observe',frame:0,clock:0,progress:0,index:0,facing:1};
 const samples=Array.from({length:300},(_,i)=>pair.samplePose({...c,clock:i/30},i/30));
 assert.ok(samples.filter(p=>p.frame===26).length>0,'occasionally closes eyes');
 assert.ok(samples.filter(p=>p.frame===26).length<25,'eyes are open most of the time');
 assert.ok(new Set(samples.map(p=>p.breath.toFixed(3))).size>10,'breathing is continuous');
 assert.ok(samples.every(p=>Math.abs(p.breath)<=.65),'no whole-body squashing');
 assert.equal(JSON.stringify(pair.samplePose(c,0,true)),JSON.stringify(pair.samplePose(c,99,true)));
});

test('jump pose advances from crouch to flight to landing and wake ends standing',()=>{
 const {pair}=cores();assert.equal(typeof pair.samplePose,'function');
 const frames=[.02,.17,.45,.7,.95].map(progress=>pair.samplePose({mode:'hop',progress,index:0,clock:progress},progress).frame);
 assert.ok(frames[0]>=16&&frames[0]<=18);assert.ok(frames[2]>=19&&frames[2]<=21);assert.ok(frames[4]>=22&&frames[4]<=23);
 assert.equal(pair.samplePose({mode:'wake',progress:1,index:0,clock:2},2).frame,55);
});

test('gait stops during takeoff preparation and landing, instead of walking in mid-air',()=>{
 const {life,space}=cores();const s=life.create(layout,rng());const a=s.actors[0];s.actors[1].hidden=true;
 const route=space.planRoute(layout,{x:50,y:450},{x:200,y:300});Object.assign(a,{x:50,y:450,mode:'hop',route,routeTime:0,gait:2.25,wait:1});
 for(let i=0;i<3;i++)life.step(s,.05);assert.equal(a.gait,2.25,'crouching does not advance a walk cycle');
});

test('each cat rests, observes and grooms independently; white spends longer resting',()=>{
 const {life}=cores();const totals=[{rest:0,groom:0},{rest:0,groom:0}];
 for(const seed of [17,3,9]){const s=life.create(layout,rng(seed));s.socialWait=Infinity;for(let i=0;i<10000;i++){life.step(s,.05);s.actors.forEach((a,j)=>{if(a.mode==='sleep'||a.mode==='settle')totals[j].rest++;if(a.mode==='groom')totals[j].groom++;});}}
 assert.ok(totals[0].rest>totals[1].rest*1.2);assert.ok(totals.every(t=>t.groom>30),'self-grooming is part of each cat’s own routine');
});

test('turning changes orientation with planted paws, never halfway through a moving step',()=>{
 const {life}=cores();const s=life.create(layout,rng(9));let turns=0;
 for(let i=0;i<10000;i++){
  const before=s.actors.map(a=>({x:a.x,y:a.y,facing:a.facing}));life.step(s,.05);
  s.actors.forEach((a,j)=>{if(a.facing!==before[j].facing&&!a.hidden){turns++;assert.ok(Math.hypot(a.x-before[j].x,a.y-before[j].y)<1e-8,'paws slide while the sprite flips');}});
 }
 assert.ok(turns>5,'the simulation actually exercised direction changes');
});

test('a multi-segment route holds its final landing despite floating-point duration rounding',()=>{
 const {space}=cores();const route={ok:true,duration:.7714285714285715+1.26875,segments:[{from:{x:8,y:225.5},to:{x:62,y:225.5},kind:'walk',arc:0,duration:.7714285714285715},{from:{x:62,y:225.5},to:{x:62,y:38},kind:'hop',arc:18.75,duration:1.26875}]};
 for(const t of [route.duration,route.duration+10]){const p=space.sampleRoute(route,t);assert.equal(p.x,62);assert.equal(p.y,38,'finishing must not reset to the last segment’s starting point');assert.equal(p.progress,1);}
});

test('both enhanced atlases contain 64 alpha cells and stay within a 600KB download budget',()=>{
 let total=0;
 for(const name of ['white','tabby']){
  const b=fs.readFileSync(new URL('../za-'+name+'-actions.webp',import.meta.url));total+=b.length;
  assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');assert.equal(b.toString('ascii',12,16),'VP8X');
  assert.equal(b.readUIntLE(24,3)+1,1280);assert.equal(b.readUIntLE(27,3)+1,1280);assert.ok(b[20]&0x10,'transparent alpha channel');
 }
 assert.ok(total<600000,`${total} bytes`);
});


test('a frozen pose preserves the current grooming or blink frame rather than resetting its clock',()=>{
 const {pair}=cores();
 for(const c of [{mode:'groom',clock:1.5,index:0},{mode:'observe',clock:2.9,index:0},{mode:'play',clock:1.2,index:1}]){
  assert.equal(pair.samplePose(c,10,true).frame,pair.samplePose(c,10,false).frame,'pause must hold the visible pose');
  assert.equal(pair.samplePose(c,99,true).frame,pair.samplePose(c,10,true).frame,'background/layout callbacks must not advance the held pose');
 }
});

test('standalone pair keeps blinking and paw-play animated when fullscreen modules are unavailable',()=>{
 const {pair}=cores(),s=pair.create(358);
 while(s.phase==='greet'&&s.time<2.85)pair.step(s,.05);
 assert.equal(pair.samplePose(s.white,s.time,false).frame,26,'fallback still blinks');
 while(s.phase!=='play')pair.step(s,.05);
 const frames=new Set();for(let i=0;i<30;i++){pair.step(s,.05);frames.add(pair.samplePose(s.white,s.time,false).frame);}
 assert.ok(frames.size>=4,'fallback paw-play must advance through its poses');
});
