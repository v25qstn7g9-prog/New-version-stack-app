import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function make(){const window={};const c=vm.createContext({window,Math});for(const f of ['za-catspace.js','za-catlife.js'])vm.runInContext(fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),c);return window.__zaCatLifeCore;}
function rng(seed=123){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const layout={width:390,height:844,safeTop:30,safeBottom:85,footprint:{w:44,h:44},protect:[],forbid:[]};
test('independent personality timing, gait and trajectories never overlap or escape viewport',()=>{const c=make(),s=c.create(layout,rng());let distinct=0;const seen=[new Set(),new Set()];for(let i=0;i<12000;i++){c.step(s,.05);const [a,b]=s.actors;for(const [j,p] of s.actors.entries()){seen[j].add(p.mode);assert.ok(p.x>=8&&p.x+44<=382);assert.ok(p.y>=38&&p.y+44<=751);}assert.ok(!c.overlap(a,b,44,4));if(a.mode!==b.mode||a.clock!==b.clock)distinct++;}assert.ok(distinct>10000);assert.ok(seen[0].has('sleep'));assert.ok(seen[1].has('walk')||seen[1].has('run'));});
test('reduced motion freezes both and hide/no-space never permits unsafe travel',()=>{const c=make(),s=c.create(layout,rng());c.reduce(s,true);const before=JSON.stringify(s);for(let i=0;i<50;i++)c.step(s,.05);assert.equal(JSON.stringify(s),before);c.relayout(s,{...layout,forbid:[{x:0,y:0,w:390,h:844}]});assert.ok(s.actors.every(a=>a.hidden));});
test('partner gathering occurs but settling and waking are not synchronized copies',()=>{const c=make(),s=c.create(layout,rng(12));let together=0,apart=0;for(let i=0;i<16000;i++){c.step(s,.05);const[a,b]=s.actors;if(s.social)together++;if(a.mode!==b.mode)apart++;}assert.ok(together>0);assert.ok(apart>500);});
test('both cats can walk, run and jump using different timing rather than a shared state',()=>{
 const c=make(),s=c.create({...layout,width:900,height:700,safeBottom:35},rng(42)),seen=[new Set(),new Set()];
 for(let i=0;i<24000;i++){c.step(s,.05);s.actors.forEach((a,j)=>seen[j].add(a.mode));}
 for(const set of seen)for(const mode of ['walk','run','hop','sleep','wake'])assert.ok(set.has(mode),mode);
 assert.notEqual(s.actors[0].speed,s.actors[1].speed);assert.notEqual(s.actors[0].gait,s.actors[1].gait);
});
test('safe unrelated layout refresh preserves individual sleep timing',()=>{const c=make(),s=c.create(layout,rng());s.actors[0].mode='sleep';s.actors[0].wait=27;s.actors[1].mode='observe';s.actors[1].wait=4;c.relayout(s,layout);assert.equal(s.actors[0].mode,'sleep');assert.equal(s.actors[0].wait,27);assert.equal(s.actors[1].wait,4);});
test('390px synthetic text/control layout reaches multiple vertical regions without crossing protected content',()=>{
 const c=make(),l={...layout,protect:[{x:100,y:200,w:190,h:24},{x:100,y:390,w:190,h:24},{x:100,y:580,w:190,h:24}],forbid:[{x:250,y:100,w:100,h:40}]},s=c.create(l,rng(17)),regions=[new Set(),new Set()];
 for(let i=0;i<24000;i++){c.step(s,.05);for(const [j,a]of s.actors.entries()){if(a.hidden)continue;regions[j].add(Math.floor((a.y-38)/230));for(const r of [...l.protect,...l.forbid])assert.ok(!(a.x<r.x+r.w&&a.x+44>r.x&&a.y<r.y+r.h&&a.y+44>r.y));}}
 for(const set of regions)assert.ok(set.size>=3,'should visit top, middle and bottom, not only a header strip');
});
test('fullscreen slice reuses only the two existing companion assets',()=>{const code=fs.readFileSync(new URL('../za-catlife.js',import.meta.url),'utf8');assert.ok(!code.includes('whiteAction'));assert.ok(!code.includes('white-walk.webp'));});
