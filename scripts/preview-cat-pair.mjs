// Offline, no-data demo using the exact production scripts and images.
// Usage: node scripts/preview-cat-pair.mjs /tmp/cat-pair-preview.html
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const data=name=>'data:image/webp;base64,'+fs.readFileSync(path.join(root,name)).toString('base64');
let photo=read('za-catphoto.js').replace('/za-cat-photo.webp?v=1',data('za-cat-photo.webp')).replace('/za-cat-sprite.webp?v=3',data('za-cat-sprite.webp'));
let pair=read('za-catpair.js').replace('/za-white-companion.webp?v=1',data('za-white-companion.webp')).replace('/za-tabby-companion.webp?v=1',data('za-tabby-companion.webp'));
pair=pair.replace('/za-white-actions.webp?v=1',data('za-white-actions.webp')).replace('/za-tabby-actions.webp?v=1',data('za-tabby-actions.webp'));
let life=read('za-catlife.js');
const demo = `
(function(){
 var active='natural',raf=0,started=0;
 var buttons=document.querySelectorAll('[data-mode]');
 function choose(mode){
  if(raf)cancelAnimationFrame(raf);raf=0;active=mode;
  buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
  var pair=window.__zaCatPairCore,life=window.__zaCatLifeCore,rt=pair.runtime;
  if(mode==='natural'){life.reduce(life.state,false);rt.onControl();return;}
  life.reduce(life.state,true);started=performance.now();
  function tick(now){
   var t=(now-started)/1000,w=innerWidth,size=Math.min(136,(w-44)/2),ground=Math.min(innerHeight-320,innerHeight*.42);
   pair.state.size=size;pair.state.time=t;pair.state.reduced=false;
   [pair.state.white,pair.state.tabby].forEach(function(c,i){
    var elapsed=Math.max(0,t-i*.3),progress=Math.min(1,elapsed/(mode==='hop'?1.65:mode==='wake'?3.3:2.5));
    var moving=mode==='walk'||mode==='run',distance=moving?Math.min(elapsed,2.8)*(mode==='run'?75:55):0;
    c.mode=moving&&elapsed>3?'observe':mode;c.index=i;c.clock=elapsed;c.progress=progress;
    c.frame=distance/(size*(mode==='run'?1.15:.72))*8;c.facing=1;
    c.x=moving?w-size-20-distance:(w-size)/2;
    c.y=ground+i*(size+24);
    if(mode==='hop'){var r={ok:true,duration:1.65,segments:[{from:{x:c.x,y:c.y},to:{x:c.x-30,y:c.y},kind:'hop',arc:45,duration:1.65}]},pos=window.__zaCatSpaceCore.sampleRoute(r,progress*1.65);c.x=pos.x;c.y=pos.y;}
    (i?rt.tabby:rt.white).style.visibility='';
   });
   rt.arena.style.visibility='';rt.render();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
 }
 buttons.forEach(function(b){b.addEventListener('click',function(){choose(b.dataset.mode);});});
})();`;
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>白貓與狸花的小日常</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f1f0ec;color:#19233d;font-family:-apple-system,"PingFang TC",sans-serif}
.premium-header{padding:20px 16px;background:#fff;border-bottom:1px solid #e4e7e2}.justify-between{display:flex;align-items:center;justify-content:space-between}h1{font-size:20px;margin:0 0 10px}button{font:inherit;color:inherit;background:transparent;border:1px solid #d6dcd5;border-radius:12px;padding:8px;min-height:44px}
.note{margin:28px 24px;max-width:460px;font-size:14px;line-height:1.8;color:#5b6780}.demo-controls{position:fixed;bottom:0;left:0;right:0;padding:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#fff;border-top:1px solid #e4e7e2;z-index:30}.demo-controls button{font-size:12px}.demo-controls button[aria-pressed=true]{background:#3f6b91;color:#fff;border-color:#3f6b91}.za-cat-pair-bar{font-size:11px!important;gap:6px!important}.za-cat-pair-bar>span{flex-basis:100%}
</style><div class="premium-header"><div class="justify-between"><h1><span>白貓與狸花的小日常</span></h1><div></div></div></div><p class="note">白貓喜歡慢慢觀察、找地方打盹；狸花比較好奇，偶爾走走、理毛，或靠近同伴。<br>可以切換下方動作，仔細看看腳步與姿勢。</p><div class="demo-controls">
${[['natural','自然生活'],['walk','慢慢走'],['run','小跑步'],['hop','跳一下'],['groom','理毛'],['sleep','打盹'],['wake','伸懶腰'],['pounce','玩一下']].map(([mode,label])=>`<button data-mode="${mode}" aria-pressed="${mode==='natural'}">${label}</button>`).join('')}
</div><script>window.__zaNoRoam=true;</script><script>${photo}</script><script>${read('za-catspace.js')}</script><script>${pair}</script><script>${life}</script><script>${demo}</script></html>`;
fs.writeFileSync(process.argv[2]||'/tmp/cat-fullscreen-preview.html',html);
console.log('Wrote self-contained full-screen preview');
