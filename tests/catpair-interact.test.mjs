// 雙貓互動 v4：靠近減速 → 停下互看 → 依心情加權決定（玩／理毛／走開／靠著睡）；不同步、不重疊、可以靠著睡。全部固定 seed。
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';
function make(){const window={};const c=vm.createContext({window,Math});for(const f of ['za-catspace.js','za-catlife.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);return window.__zaCatLifeCore;}
function rng(seed=123){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const layout={width:390,height:844,safeTop:30,safeBottom:85,footprint:{w:44,h:44},protect:[{x:100,y:390,w:190,h:24}],forbid:[]};
const F=44,dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function sim(seed,steps,mood,fn){const c=make(),s=c.create(layout,rng(seed));if(mood!==undefined)c.setMood(s,mood);const all=[];for(let i=0;i<steps;i++){c.step(s,.05);all.push(...s.events.splice(0));fn&&fn(s,c,i);}return {c,s,events:all};}

test('approaching the partner slows down near it (full speed far away)',()=>{let near=[],far=[];
 for(const seed of [1,2,3])sim(seed,20000,'relaxed',s=>{for(const a of s.actors)if(a.route&&a.purpose==='social'){const d=dist(a,s.actors[1-a.index]);if(d<F*1.5)near.push(a.slow);if(d>F*4)far.push(a.slow);}});
 assert.ok(near.length>20&&far.length>20,'approaches observed');
 assert.ok(Math.max(...near)<=.6,'slow near partner');assert.ok(Math.min(...near)>=.3,'never stalls');assert.ok(far.every(v=>v===1),'full speed when far');
});

test('they always pause and look at each other (>=1.2s, facing each other) before deciding',()=>{let decides=0;
 for(const seed of [1,2,3,4]){let lookAt=null;const {events}=sim(seed,20000,'relaxed',s=>{if(s.social&&s.social.stage==='look'){const[a,b]=s.actors;assert.equal(a.mode,'observe');assert.equal(b.mode,'observe');assert.equal(a.facing,-b.facing,'face each other');}});
  for(const e of events){if(e.type==='look')lookAt=e.t;if(e.type==='decide'){decides++;assert.ok(lookAt!==null&&e.t-lookAt>=1.2-1e-9,'look pause before decision');lookAt=null;}}}
 assert.ok(decides>=10);
});

test('never the same action at the same time (desync), except curled-up sleeping together',()=>{let checked=0;
 for(const seed of [5,6,7]){const starts=[[],[]],prev=['',''];sim(seed,30000,'relaxed',s=>{const[a,b]=s.actors;
  if(s.social&&s.social.stage==='act'){checked++;assert.ok(a.mode!==b.mode||a.mode==='sleep'||a.mode==='observe',a.mode+'/'+b.mode);}
  s.actors.forEach((x,j)=>{if(x.mode!==prev[j]){starts[j].push([s.elapsed,x.mode]);prev[j]=x.mode;}});});
  const action=m=>['pounce','respond','groom','settle','invite','wake'].includes(m);
  for(const [t,m] of starts[0])if(action(m))for(const [u,n] of starts[1])assert.ok(!(n===m&&Math.abs(t-u)<.5),'both started '+m+' together at '+t.toFixed(2));}
 assert.ok(checked>500);
});

test('no overlap / passing through each other over a long simulation',()=>{
 for(const seed of [8,9,10]){const {c}=sim(seed,40000,'happy',(s,c)=>{const[a,b]=s.actors;assert.ok(!c.overlap(a,b,F,0),'overlap at '+s.elapsed.toFixed(2));});}
});

test('sleeping together: both curl up asleep right next to each other',()=>{let together=0;
 for(const seed of [1,2,3])sim(seed,24000,'sad',s=>{const[a,b]=s.actors;if(a.mode==='sleep'&&b.mode==='sleep'&&a.curl&&b.curl&&Math.abs(a.y-b.y)<1e-6&&dist(a,b)<=F+12)together++;});
 assert.ok(together>100,'curled together for a while: '+together);
});

test('decisions include play, groom, leave and sleep; mood shifts the weights',()=>{const c=make();
 const r=c.decisionWeights('relaxed'),h=c.decisionWeights('happy'),d=c.decisionWeights('sad');
 assert.deepEqual(c.decisionWeights(undefined),r);assert.deepEqual(c.decisionWeights('bogus'),r,'missing mood = relaxed');
 assert.ok(h.play>r.play&&r.play>d.play,'up = more play');assert.ok(d.sleep>r.sleep&&r.sleep>h.sleep,'down = more sleep');
 const count=m=>{const n={};for(const seed of [1,2,3,4,5,6])for(const e of sim(seed,24000,m).events)if(e.type==='decide')n[e.action]=(n[e.action]||0)+1;return n;};
 const R=count('relaxed');for(const k of ['play','groom','leave','sleep'])assert.ok(R[k]>0,k);
});

test('mood: sad rests more and dashes less; happy plays and hops more; missing = relaxed',()=>{
 const stat=m=>{const t={sleep:0,run:0,hop:0,play:0};for(const seed of [1,2,3,4]){sim(seed,24000,m,s=>{for(const a of s.actors){if(a.mode==='sleep'||a.mode==='settle')t.sleep++;if(a.mode==='run')t.run++;if(a.mode==='hop')t.hop++;if(a.mode==='pounce'||a.mode==='respond')t.play++;}});}return t;};
 const sad=stat('sad'),happy=stat('happy'),rel=stat('relaxed'),none=stat(undefined);
 assert.ok(sad.sleep>rel.sleep&&rel.sleep>happy.sleep,JSON.stringify({sad,rel,happy}));
 assert.ok(sad.run<happy.run,'less dash when down');assert.ok(happy.hop>sad.hop,'more jumps when up');assert.ok(happy.play>sad.play,'more play when up');
 assert.deepEqual(none,rel,'no mood attribute behaves exactly like relaxed');
});

test('runtime reads the white cat data-mood attribute only; no fetch/innerHTML/eval; versions bumped',()=>{
 const life=fs.readFileSync(new URL('../za-catlife.js',import.meta.url),'utf8'),pair=fs.readFileSync(new URL('../za-catpair.js',import.meta.url),'utf8'),photo=fs.readFileSync(new URL('../za-catphoto.js',import.meta.url),'utf8');
 assert.match(life,/getAttribute\('data-mood'\)/);
 for(const code of [life,pair])for(const bad of ['fetch(','innerHTML','eval(','new Function','localStorage'])assert.ok(!code.includes(bad),bad);
 assert.match(photo,/za-catpair\.js\?v=6/);assert.match(photo,/za-catlife\.js\?v=5/);
 assert.match(fs.readFileSync(new URL('../za-cat.js',import.meta.url),'utf8'),/za-catphoto\.js\?v=13/);
 assert.match(readAppSource(),/za-cat\.js\?v=13/);
 assert.match(photo,/authorization: "Bearer " \+ tok/);
});
