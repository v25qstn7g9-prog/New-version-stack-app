// Offline, no-data preview of the video cats using the exact production scripts.
// Usage:
//   node scripts/preview-cat-video.mjs [out.html]           write the page; videos are referenced by a relative path to ./za-cats/
//   node scripts/preview-cat-video.mjs --serve [port]        serve the page + clips on http://127.0.0.1:<port>/ (default 8787)
// Query: ?force=video (ignore save-data / memory / earlier failure) or ?force=sprite (old sprite atlas only);
//        ?demo=<idle|look|groom|play|react|walk|trot|liedown|sleep|wake> starts that action (for screenshots).
// Browsers refuse WebGL textures from file:// videos, so use --serve when checking video mode; the page then
// falls back to sprites by design if opened from disk. No account data and no network calls besides these local files.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const data = name => 'data:image/webp;base64,' + fs.readFileSync(path.join(root, name)).toString('base64');

function page(videoBase) {
  const photo = read('za-catphoto.js').replace('/za-cat-photo.webp?v=1', data('za-cat-photo.webp')).replace('/za-cat-sprite.webp?v=3', data('za-cat-sprite.webp'));
  const pair = read('za-catpair.js')
    .replace('/za-white-companion.webp?v=1', data('za-white-companion.webp')).replace('/za-tabby-companion.webp?v=1', data('za-tabby-companion.webp'))
    .replace('/za-white-actions.webp?v=1', data('za-white-actions.webp')).replace('/za-tabby-actions.webp?v=1', data('za-tabby-actions.webp'));
  const actions = [['natural', '自然生活'], ['idle', '坐著'], ['look', '東張西望'], ['groom', '理毛'], ['play', '玩'], ['react', '歪頭'],
    ['walk', '走路'], ['trot', '小跑'], ['liedown', '趴下→睡'], ['sleep', '睡覺'], ['wake', '醒來']];
  const boot = `(function(){var q=new URLSearchParams(location.search).get('force');
window.__zaNoRoam=true;window.__zaCatVideoBase=${JSON.stringify(videoBase)};
if(q==='sprite')window.__zaCatVideoForce='off';else if(q==='video')window.__zaCatVideoForce='on';})();`;
  const demo = `(function(){
 var MODE={idle:'sit',look:'look',groom:'groom',play:'play',react:'react',walk:'walk',trot:'run',liedown:'settle',sleep:'sleep',wake:'wake'};
 var raf=0,started=0,buttons=document.querySelectorAll('[data-mode]'),status=document.getElementById('status');
 function report(){var v=window.__zaCatVideoCore&&window.__zaCatVideoCore.runtime;
  status.textContent=v&&v.active?'影片模式（WebGL）':'精靈圖模式'+(v&&v.reason?'（退回原因：'+v.reason+'）':v&&v.decision?'（'+v.decision.reason+'）':'');}
 setInterval(report,1000);report();
 var pair=window.__zaCatPairCore,rt=pair.runtime,render=rt.render,override=null;
 // The natural life loop keeps running underneath (it is re-enabled by every relayout), so a demo must not race it:
 // whoever calls render(), the demo state is applied right before drawing. Without this the two loops alternate
 // c.mode every frame and the video layer keeps switching clips.
 rt.render=function(){if(override)override(performance.now());return render.apply(this,arguments);};
 function choose(key){
  if(raf)cancelAnimationFrame(raf);raf=0;override=null;
  buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.mode===key));});
  var life=window.__zaCatLifeCore,video=rt.video;
  // Every button starts its clip from scratch (one-shot liedown/wake play in full, then hand over to sleep/idle),
  // even if the previous button left the cat in the clip it would hand over to.
  if(video&&video.active&&video.reset)video.reset();
  if(key==='natural'){if(life.state)life.reduce(life.state,false);if(rt.onControl)rt.onControl();return;}
  started=performance.now();var mode=MODE[key];
  override=apply;
  function tick(){rt.render();raf=requestAnimationFrame(tick);}
  function apply(now){
   var t=(now-started)/1000,w=innerWidth,size=Math.min(136,(w-44)/2),ground=Math.min(innerHeight-320,innerHeight*.42);
   pair.state.size=size;pair.state.time=t;pair.state.reduced=false;
   [pair.state.white,pair.state.tabby].forEach(function(c,i){
    var elapsed=Math.max(0,t-i*.3),moving=mode==='walk'||mode==='run',distance=moving?Math.min(elapsed,2.8)*(mode==='run'?75:55):0;
    // Seated idle/look alternate on a 9s clock (clipFor: (clock+5*index)/9). Pin each button to its own clip.
    var seatClock=mode==='look'?(i?4:9)+elapsed%9:(i?13:0)+elapsed%9;
    c.mode=moving&&elapsed>3?'sit':mode;c.index=i;c.hidden=false;c.clock=mode==='look'||mode==='sit'||(moving&&elapsed>3)?seatClock:elapsed;c.progress=Math.min(1,elapsed/2.5);
    c.frame=distance/(size*(mode==='run'?1.15:.72))*8;c.facing=1;c.x=moving?w-size-20-distance:(w-size)/2;c.y=ground+i*(size+24);
    (i?rt.tabby:rt.white).style.visibility='';
   });
   rt.arena.style.visibility='';
  }
  raf=requestAnimationFrame(tick);
 }
 buttons.forEach(function(b){b.addEventListener('click',function(){choose(b.dataset.mode);});});
 // ?demo=<action> selects an action on load (for screenshots without clicking).
 var start=new URLSearchParams(location.search).get('demo');if(start&&(MODE[start]||start==='natural'))setTimeout(function(){choose(start);},300);
})();`;
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>寫實影片小貓預覽</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f1f0ec;color:#19233d;font-family:-apple-system,"PingFang TC",sans-serif}
.premium-header{padding:20px 16px;background:#fff;border-bottom:1px solid #e4e7e2}.justify-between{display:flex;align-items:center;justify-content:space-between}h1{font-size:20px;margin:0 0 10px}button{font:inherit;color:inherit;background:transparent;border:1px solid #d6dcd5;border-radius:12px;padding:8px;min-height:44px}
.note{margin:28px 24px;max-width:460px;font-size:14px;line-height:1.8;color:#5b6780}#status{font-weight:700;color:#19233d}.demo-controls{position:fixed;bottom:0;left:0;right:0;padding:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;background:#fff;border-top:1px solid #e4e7e2;z-index:30}.demo-controls button{font-size:12px}.demo-controls button[aria-pressed=true]{background:#3f6b91;color:#fff;border-color:#3f6b91}.za-cat-pair-bar{font-size:11px!important;gap:6px!important}.za-cat-pair-bar>span{flex-basis:100%}
</style><div class="premium-header"><div class="justify-between"><h1><span>寫實影片小貓預覽</span></h1><div></div></div></div><p class="note"><span id="status">載入中…</span><br>網址加 <code>?force=video</code> 或 <code>?force=sprite</code> 可以切換。點下方按鈕看每個動作；「自然生活」是正式版的行為。</p><div class="demo-controls">
${actions.map(([mode, label]) => `<button data-mode="${mode}" aria-pressed="${mode === 'natural'}">${label}</button>`).join('')}
</div><script>${boot}</script><script>${photo}</script><script>${read('za-catspace.js')}</script><script>${pair}</script><script>${read('za-catlife.js')}</script><script>${read('za-catvideo.js')}</script><script>${demo}</script></html>`;
}

const args = process.argv.slice(2);
if (args[0] === '--serve') {
  const port = Number(args[1]) || 8787, html = page('./za-cats/');
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'), name = path.basename(url.pathname);
    if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end(html); return; }
    // Only the clip files are served — nothing else from the repository.
    if (url.pathname === '/za-cats/' + name && /^za-(white|tabby)-[a-z]+\.mp4$/.test(name) && fs.existsSync(path.join(root, 'za-cats', name))) {
      const file = path.join(root, 'za-cats', name), size = fs.statSync(file).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : size - 1;
        res.writeHead(206, {'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1});
        fs.createReadStream(file, {start, end}).pipe(res);
      } else { res.writeHead(200, {'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': size}); fs.createReadStream(file).pipe(res); }
      return;
    }
    res.writeHead(404); res.end();
  }).listen(port, '127.0.0.1', () => console.log(`Video cat preview on http://127.0.0.1:${port}/  (?force=video | ?force=sprite)`));
} else {
  const out = path.resolve(args[0] || '/tmp/cat-video-preview.html');
  let base = path.relative(path.dirname(out), path.join(root, 'za-cats')).split(path.sep).join('/') + '/';
  if (!base.startsWith('.')) base = './' + base;
  fs.writeFileSync(out, page(base));
  console.log('Wrote ' + out + ' (clips referenced at ' + base + '; use --serve for WebGL video mode)');
}
