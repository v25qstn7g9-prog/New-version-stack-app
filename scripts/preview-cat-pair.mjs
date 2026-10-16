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
let life=read('za-catlife.js');
const html=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>雙貓全螢幕預覽</title><style>body{margin:0;min-height:100vh;background:#29385b;color:#fff;font-family:system-ui,sans-serif}.premium-header{padding:12px;background:#33446b}.justify-between{display:flex;align-items:center;justify-content:space-between}h1{font-size:16px;margin:0}button{color:inherit;background:none;border:1px solid #8799b9;border-radius:12px;padding:8px}.note{position:absolute;top:42%;left:18%;max-width:64%;font-size:12px;line-height:1.7;color:#c8d2e7}.footer{position:fixed;bottom:12px;left:16px;font-size:11px;color:#c8d2e7}</style><div class="premium-header"><div class="justify-between"><h1><span>白貓悠閒 · 狸花好奇</span></h1><div></div></div></div><p class="note">離線示範，沒有資產資料。兩隻會獨立移動、休息，偶爾邀玩與靠著睡。沿用已有 AI 走路姿勢，跨區移動仍有滑動感，並非真貓錄影。請觀察一段時間。</p><span class="footer">全螢幕空白區可穿透點擊 · 系統減少動態會停止活動</span><script>window.__zaNoRoam=true;</script><script>${photo}</script><script>${read('za-catspace.js')}</script><script>${pair}</script><script>${life}</script></html>`;
fs.writeFileSync(process.argv[2]||'/tmp/cat-fullscreen-preview.html',html);
console.log('Wrote self-contained full-screen preview');
