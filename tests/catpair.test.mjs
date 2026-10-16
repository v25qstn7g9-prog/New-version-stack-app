import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../za-catpair.js', import.meta.url), 'utf8');
function core() { const window = {}; vm.runInNewContext(source, {window, Math}); return window.__zaCatPairCore; }
test('pair stays grounded, within lane and separated throughout multiple complete cycles', () => {
  const c = core();
  for (const width of [180, 288, 358, 768, 1200]) {
    const s = c.create(width);
    const seen = new Set();
    for (let i = 0; i < 18000; i++) {
      c.step(s, .05); seen.add(s.phase);
      assert.ok(s.white.x >= -0.01 && s.tabby.x + s.size <= s.width + .01);
      assert.ok(s.tabby.x - s.white.x >= s.size + 8 - .01, `personal space at ${s.phase}`);
      for (const cat of [s.white,s.tabby]) { assert.equal(cat.y,0); assert.ok([-1,1].includes(cat.facing)); }
    }
    for (const phase of ['approach','play','chaseRight','turn','chaseLeft','settle','sleep','wake']) assert.ok(seen.has(phase),phase);
  }
});
test('reduced motion remains a static pair, wake is explicit and resizing preserves spacing', () => {
  const c=core(), s=c.create(358);
  c.reduce(s,true); const before=JSON.stringify(s);
  for(let i=0;i<100;i++) c.step(s,.05);
  assert.equal(JSON.stringify(s),before);
  c.resize(s,220); assert.ok(s.tabby.x+s.size<=220);
  c.reduce(s,false); c.wake(s); assert.equal(s.phase,'wake');
  c.step(s,.05); assert.ok(s.time>0);
});
test('sleep holds still and both cats wake together without moving through one another',()=>{
  const c=core(),s=c.create(358);
  while(s.phase!=='sleep') c.step(s,.05);
  const xs=[s.white.x,s.tabby.x];
  for(let i=0;i<100;i++){c.step(s,.05); assert.deepEqual([s.white.x,s.tabby.x],xs); assert.equal(s.white.mode,'sleep');assert.equal(s.tabby.mode,'sleep');}
  c.wake(s); assert.equal(s.white.mode,'wake'); assert.equal(s.tabby.mode,'wake');
});
test('pair has no storage, financial calls, whole-body deformation, or fixed overlay',()=>{
  for(const x of ['localStorage','sessionStorage','indexedDB','fetch(','position:fixed','rotate(','scaleY(']) assert.ok(!source.includes(x),x);
  assert.match(source,/visibilitychange/); assert.match(source,/prefers-reduced-motion/);
});
test('cycles and taps do not teleport either cat',()=>{
  const c=core(),s=c.create(358);
  for(let i=0;i<20000;i++){
    const before=[s.white.x,s.tabby.x];
    if(i%701===0)c.wake(s);
    c.step(s,.05);
    assert.ok(Math.abs(s.white.x-before[0])<4,`${s.phase}: white jumped`);
    assert.ok(Math.abs(s.tabby.x-before[1])<4,`${s.phase}: tabby jumped`);
  }
});
test('observer refresh at the same width preserves wake and approach anchors',()=>{
  const c=core(),s=c.create(358);
  while(s.phase!=='chaseLeft')c.step(s,.05);
  c.step(s,.05);c.wake(s);
  const before=[s.white.x,s.tabby.x];c.resize(s,358);
  assert.deepEqual([s.white.x,s.tabby.x],before);
  for(let i=0;i<100;i++){const prev=[s.white.x,s.tabby.x];c.resize(s,358);c.step(s,.05);assert.ok(Math.abs(s.white.x-prev[0])<4);assert.ok(Math.abs(s.tabby.x-prev[1])<4);}
  c.resize(s,220);assert.ok(s.tabby.x-s.white.x>=s.size+8);assert.ok(s.tabby.x+s.size<=220);
});
test('companion assets stay within mobile download budget',()=>{
  const names=['za-tabby-companion.webp','za-white-companion.webp'];let total=0;
  for(const name of names){const b=fs.readFileSync(new URL('../'+name,import.meta.url));total+=b.length;assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');}
  assert.ok(total<250000,`${total} bytes`);
});
