import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const pair=fs.readFileSync(new URL('../za-catpair.js',import.meta.url),'utf8');
const photo=fs.readFileSync(new URL('../za-catphoto.js',import.meta.url),'utf8');
function harness() {
  const nodes=[],images=[],rafs=new Map(),events={}; let id=0;
  const ctx={clearRect(){},save(){},restore(){},translate(){},scale(){},drawImage(){}};
  function el(tag){
    const n={tag,style:{},children:[],listeners:{},attrs:{},parentNode:null,clientWidth:358,offsetWidth:0,
      classList:{add(){},remove(){},contains(){return false;}},
      appendChild(c){if(c.parentNode)c.parentNode.removeChild(c);this.children.push(c);c.parentNode=this;return c;},
      removeChild(c){this.children=this.children.filter(x=>x!==c);c.parentNode=null;},
      addEventListener(k,f){(this.listeners[k]??=[]).push(f);},setAttribute(k,v){this.attrs[k]=v;},
      contains(c){return c===this||this.children.some(x=>x.contains(c));},getContext(){return ctx;},
      getBoundingClientRect(){return {left:0,right:358,top:0,bottom:46,width:358,height:46};}};
    Object.defineProperty(n,'isConnected',{get(){return n===body||!!n.parentNode?.isConnected;}});nodes.push(n);return n;
  }
  const body=el('body'),head=el('head'),header=el('header'),row=el('row');body.appendChild(header);header.appendChild(row);
  row.querySelector=()=>({firstElementChild:{getBoundingClientRect:()=>({right:150})},nextElementSibling:{getBoundingClientRect:()=>({left:300})}});
  const document={body,head,hidden:false,createElement:el,querySelector:s=>s==='.premium-header'?header:row,addEventListener(k,f){(events[k]??=[]).push(f);}};
  const window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}};
  function Image(){this.width=this.height=640;images.push(this);}
  const sandbox={window,document,Image,Math,Date,Promise,String,navigator:{},getComputedStyle:()=>({position:'relative'}),
    requestAnimationFrame(f){rafs.set(++id,f);return id;},cancelAnimationFrame(i){rafs.delete(i);},
    setTimeout(){return 1;},clearTimeout(){},MutationObserver:function(){this.observe=()=>{};}};
  vm.createContext(sandbox);vm.runInContext(photo,sandbox);vm.runInContext(pair,sandbox);
  return {window,document,images,nodes,events,rafs,run(ts){const fs=[...rafs.values()];rafs.clear();fs.forEach(f=>f(ts));}};
}
test('same-width remount preserves tapped wake location and follow-on approach',()=>{
  const window={};vm.runInNewContext(pair,{window,Math});const c=window.__zaCatPairCore,s=c.create(358);
  while(s.phase!=='chaseRight'||s.time<4)c.step(s,.05);
  c.wake(s);const x=[s.white.x,s.tabby.x];c.resize(s,358);
  assert.deepEqual([s.white.x,s.tabby.x],x);
  while(s.phase==='wake')c.step(s,.05);
  c.step(s,.05);const y=[s.white.x,s.tabby.x];c.resize(s,358);
  assert.deepEqual([s.white.x,s.tabby.x],y);
});
test('late legacy atlas cannot add a second displayed renderer after companion loads',()=>{
  const h=harness();const white=h.images.find(x=>x.src?.includes('white-companion'));white.onload();
  const face=h.window.__zaPhotoCat.face;const before=face.children.filter(x=>x.style.display!=='none').length;
  h.images.find(x=>x.src?.includes('cat-sprite')).onload();
  assert.equal(face.children.filter(x=>x.style.display!=='none').length,before);
});
test('late fallback photo failure does not remove an active white companion',()=>{
  const h=harness();h.images.find(x=>x.src?.includes('white-companion')).onload();
  h.nodes.find(x=>x.tag==='img').onerror();
  assert.equal(h.window.__zaPhotoCat.box.isConnected,true);
});
test('pair stops animation while hidden and resumes only one loop when visible',()=>{
  const h=harness();h.images.find(x=>x.src?.includes('white-companion')).onload();h.run(100);h.run(140);
  h.document.hidden=true;h.events.visibilitychange.forEach(f=>f());h.run(180);assert.equal(h.rafs.size,0);
  h.document.hidden=false;h.events.visibilitychange.forEach(f=>f());assert.equal(h.rafs.size,1);
  h.events.visibilitychange.forEach(f=>f());assert.equal(h.rafs.size,1);
});
test('manual pause survives asset arrival and visibility restoration',()=>{
  const h=harness();const pause=h.nodes.find(x=>x.className==='za-pair-pause');pause.listeners.click[0]();
  assert.equal(pause.attrs['aria-pressed'],'true');assert.equal(h.rafs.size,0);
  h.images.find(x=>x.src?.includes('white-companion')).onload();
  h.document.hidden=true;h.events.visibilitychange.forEach(f=>f());h.document.hidden=false;h.events.visibilitychange.forEach(f=>f());
  assert.equal(h.rafs.size,0);pause.listeners.click[0]();assert.equal(h.rafs.size,1);
});
test('companion asset recovers white removed by earlier fallback photo failure',()=>{
  const h=harness();h.nodes.find(x=>x.tag==='img').onerror();
  h.images.find(x=>x.src?.includes('white-companion')).onload();
  assert.equal(h.window.__zaPhotoCat.box.isConnected,true);
});
