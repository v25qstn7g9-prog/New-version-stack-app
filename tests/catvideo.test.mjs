// 寫實影片小貓（za-catvideo.js）：開關條件、片段對應、延遲載入、暫停／背景、一次性片段交棒、失敗退回精靈圖。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const videoSrc = read('za-catvideo.js'), pairSrc = read('za-catpair.js'), photoSrc = read('za-catphoto.js');
// Values cross a vm realm boundary: compare plain JSON copies.
const plain = x => JSON.parse(JSON.stringify(x));
function core() {
  const window = {}; vm.runInNewContext(videoSrc, {window, Math}); const c = window.__zaCatVideoCore;
  return {...c, shouldUseVideo: e => plain(c.shouldUseVideo(e)), planLoads: m => plain(c.planLoads(m))};
}
const tick = () => new Promise(r => setImmediate(r));

// ── 純函式 ──
test('embedded manifest equals za-cats/za-cat-clips.json and every clip file matches its byte count', () => {
  const c = core(), json = JSON.parse(read('za-cats/za-cat-clips.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(c.manifest)), json);
  for (const cat of ['white', 'tabby']) {
    assert.deepEqual(Object.keys(json.cats[cat]).sort(), ['groom', 'idle', 'liedown', 'look', 'play', 'react', 'sleep', 'trot', 'wake', 'walk']);
    for (const clip of Object.values(json.cats[cat])) assert.equal(fs.statSync(new URL('../za-cats/' + clip.src, import.meta.url)).size, clip.bytes, clip.src);
  }
  assert.ok(c.totalBytes() < 1100000, 'all twenty clips stay about 1 MB in total');
});

test('shouldUseVideo: every rule, including reduced motion winning over a manual "on"', () => {
  const {shouldUseVideo: use} = core(), base = {webgl: true, deviceMemory: 8};
  assert.deepEqual(use(base), {ok: true, reason: 'ok'});
  assert.deepEqual(use({...base, reducedMotion: true}), {ok: false, reason: 'reduced-motion'});
  assert.deepEqual(use({...base, reducedMotion: true, flag: 'on'}), {ok: false, reason: 'reduced-motion'});
  assert.deepEqual(use({...base, webgl: false}), {ok: false, reason: 'no-webgl'});
  assert.deepEqual(use({...base, webgl: false, flag: 'on'}), {ok: false, reason: 'no-webgl'});
  assert.deepEqual(use({...base, flag: 'off'}), {ok: false, reason: 'flag-off'});
  assert.deepEqual(use({...base, failed: true}), {ok: false, reason: 'failed'});
  assert.deepEqual(use({...base, saveData: true}), {ok: false, reason: 'save-data'});
  assert.deepEqual(use({...base, deviceMemory: 2}), {ok: false, reason: 'low-memory'});
  assert.deepEqual(use({...base, deviceMemory: 4}), {ok: true, reason: 'ok'});
  assert.deepEqual(use({webgl: true}), {ok: true, reason: 'ok'}, 'unknown deviceMemory (Safari) is allowed');
  for (const extra of [{saveData: true}, {deviceMemory: 1}, {failed: true}]) assert.equal(use({...base, ...extra, flag: 'on'}).ok, true, 'flag on forces video');
  assert.equal(use().ok, false);
});

test('clipFor maps state-machine modes, uses trot for run, and alternates idle/look deterministically', () => {
  const {clipFor} = core();
  const cases = {walk: 'walk', run: 'trot', chase: 'trot', trot: 'trot', jump: 'play', hop: 'play', pounce: 'play', respond: 'play', play: 'play', invite: 'play',
    groom: 'groom', settle: 'liedown', sleep: 'sleep', wake: 'wake', react: 'react', tap: 'react', turn: 'idle', bogus: 'idle', undefined: 'idle'};
  for (const [mode, clip] of Object.entries(cases)) assert.equal(clipFor(mode === 'undefined' ? undefined : mode, {clock: 0, index: 0}), clip, mode);
  for (const mode of ['observe', 'sit', 'look']) {
    const seen = new Set();
    for (let t = 0; t < 40; t += .5) seen.add(clipFor(mode, {clock: t, index: 0}));
    assert.deepEqual([...seen].sort(), ['idle', 'look'], mode + ' alternates');
    assert.equal(clipFor(mode, {clock: 3, index: 0}), clipFor(mode, {clock: 3, index: 0}), 'deterministic');
  }
  assert.equal(clipFor('observe', {clock: 0, index: 0}), 'idle');
  assert.equal(clipFor('observe', {clock: 10, index: 0}), 'look');
  assert.notEqual(clipFor('observe', {clock: 5, index: 0}), clipFor('observe', {clock: 5, index: 1}), 'the two cats are out of step');
});

test('planLoads preloads only idle + walk for both cats; everything else is lazy', () => {
  const c = core(), plan = c.planLoads(c.manifest);
  assert.deepEqual(plan.initial.map(p => p.cat + ':' + p.clip).sort(), ['tabby:idle', 'tabby:walk', 'white:idle', 'white:walk']);
  assert.ok(plan.initial.every(p => p.preload === 'auto'));
  assert.equal(plan.lazy.length, 16);
  assert.ok(plan.lazy.every(p => p.preload === 'none' && p.clip !== 'idle' && p.clip !== 'walk'));
});

test('shouldRun stops for hidden tab, collapsed cats, manual pause and reduced motion', () => {
  const {shouldRun} = core();
  assert.equal(shouldRun({}), true);
  for (const k of ['hidden', 'collapsed', 'paused', 'reducedMotion', 'reduced']) assert.equal(shouldRun({[k]: true}), false, k);
});

test('one-shot handover: liedown plays to the end then sleep; wake plays to the end then idle; walking interrupts', () => {
  const {nextClip} = core();
  assert.equal(nextClip(null, 'liedown', false), 'liedown');
  assert.equal(nextClip('liedown', 'liedown', false), 'liedown');
  assert.equal(nextClip('liedown', 'sleep', false), 'liedown', 'state already says sleep: finish lying down first');
  assert.equal(nextClip('liedown', 'liedown', true), 'sleep');
  assert.equal(nextClip('liedown', 'sleep', true), 'sleep');
  assert.equal(nextClip('sleep', 'liedown', false), 'sleep', 'never replay the lie-down once asleep');
  assert.equal(nextClip('wake', 'wake', false), 'wake');
  assert.equal(nextClip('wake', 'idle', false), 'wake');
  assert.equal(nextClip('wake', 'wake', true), 'idle');
  assert.equal(nextClip('idle', 'wake', false), 'idle', 'already up: do not replay waking');
  assert.equal(nextClip('wake', 'walk', false), 'walk', 'departure interrupts the one-shot');
  assert.equal(nextClip('liedown', 'walk', false), 'walk');
  assert.equal(nextClip('sleep', 'wake', false), 'wake');
  assert.equal(nextClip('walk', 'trot', false), 'trot');
});

test('frame pacing never exceeds 30 fps, even when asked for more', () => {
  const {frameDue, MAX_FPS} = core();
  assert.equal(MAX_FPS, 30);
  assert.equal(frameDue(0, 5, 60), true, 'first frame draws');
  let drawn = 0, last = 0;
  for (let t = 1; t <= 1000; t += 1000 / 120) if (frameDue(last, t, 120)) { drawn++; last = t; }
  assert.ok(drawn <= 31 && drawn >= 28, drawn + ' frames in one second at 120Hz');
  drawn = 0; last = 0;
  for (let t = 1; t <= 1000; t += 1000 / 60) if (frameDue(last, t, 24)) { drawn++; last = t; }
  assert.ok(drawn <= 25 && drawn >= 20, drawn + ' frames at 24fps');
});

test('mirroring follows clip facing and the sprite facing convention (1 = facing left)', () => {
  const {flipFor, placement, manifest} = core();
  assert.equal(flipFor('left', 1), false); assert.equal(flipFor('left', -1), true);
  assert.equal(flipFor('right', 1), true); assert.equal(flipFor('right', -1), false);
  // Seated cat is drawn at the sprite cat size (about 0.8 of the box) with paws on the sprite ground line.
  const idle = manifest.cats.white.idle, p = placement(idle, 60, false);
  const groundInBox = p.canvasTop + p.top + idle.groundY * p.scale;
  assert.ok(Math.abs(groundInBox - 60 * 152 / 160) < 1e-9);
  assert.ok(Math.abs(250 * p.scale - 48) < 1e-9);
  const walk = manifest.cats.tabby.walk;
  for (const flip of [false, true]) { const q = placement(walk, 60, flip); assert.ok(q.left >= 0 && q.left + q.width <= q.W, 'walking cat fits the video canvas'); }
});

test('title-bar loop: sleep shortened to 12s of a 50.5s cycle with groom/look/react added', () => {
  const window = {}; vm.runInNewContext(pairSrc, {window, Math}); const c = window.__zaCatPairCore, s = c.create(358);
  while (s.phase !== 'approach') c.step(s, .05);
  const time = {}, modes = new Set();
  let cycle = s.cycle, total = 0;
  while (s.cycle === cycle) { c.step(s, .05); time[s.phase] = (time[s.phase] || 0) + .05; total += .05; modes.add(s.white.mode); modes.add(s.tabby.mode); }
  assert.ok(Math.abs(total - 47.5) < .6, 'approach..wake = 50.5 - 3s greet: ' + total);
  assert.ok(Math.abs(time.sleep - 12) < .2, 'sleep ' + time.sleep);
  assert.ok(time.sleep / 50.5 < .25, 'sleep share under a quarter of the cycle');
  for (const m of ['groom', 'react', 'observe', 'play', 'walk', 'settle', 'sleep', 'wake']) assert.ok(modes.has(m), m);
});

// ── 全螢幕可以點的貓 ──
function life() { const window = {}; const ctx = vm.createContext({window, Math}); for (const f of ['za-catspace.js', 'za-catlife.js']) vm.runInContext(read(f), ctx); return window.__zaCatLifeCore; }
function rng(seed = 7) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }
const layout = {width: 390, height: 844, safeTop: 30, safeBottom: 85, footprint: {w: 53, h: 53}, protect: [], forbid: [{x: 300, y: 790, w: 80, h: 44}]};
test('tapping a fullscreen cat: sleeping wakes; otherwise alternates react and groom; reduced/moving cats ignore taps', () => {
  const L = life(), s = L.create(layout, rng()), a = s.actors[1];
  Object.assign(a, {hidden: false, route: null, mode: 'sleep', x: 100, y: 300});
  assert.equal(L.tap(s, 1), 'wake'); assert.equal(a.mode, 'wake');
  assert.equal(L.tap(s, 1), 'react'); assert.equal(a.mode, 'react');
  assert.equal(L.tap(s, 1), 'groom'); assert.equal(a.mode, 'groom');
  assert.equal(L.tap(s, 1), 'react');
  for (let i = 0; i < 80; i++) L.step(s, .05);
  assert.notEqual(a.mode, 'react', 'reaction ends on its own');
  a.route = {}; assert.equal(L.tap(s, 1), null); a.route = null;
  L.reduce(s, true); assert.equal(L.tap(s, 1), null);
});
test('a cat box is hit-testable only when it does not overlap a protected control', () => {
  const L = life(), s = L.create(layout, rng()), a = s.actors[0];
  Object.assign(a, {hidden: false, x: 100, y: 300});
  assert.equal(L.hitTestable(s, a, false), true);
  assert.equal(L.hitTestable(s, a, true), false, 'paused');
  Object.assign(a, {x: 290, y: 770});
  assert.equal(L.hitTestable(s, a, false), false, 'over a control: taps go to the control');
  a.hidden = true; assert.equal(L.hitTestable(s, a, false), false);
});

// ── 瀏覽器整合（假的 DOM／WebGL／video） ──
function fakeGL(log) {
  const base = {isContextLost: () => false, getShaderParameter: () => true, getProgramParameter: () => true, getUniformLocation: () => ({}), getAttribLocation: () => 0,
    texImage2D() { log.push('tex'); }, drawArrays() { log.push('draw'); },
    deleteTexture() { log.push('deleteTexture'); }, deleteBuffer() { log.push('deleteBuffer'); }, deleteProgram() { log.push('deleteProgram'); },
    deleteShader() { log.push('deleteShader'); }, detachShader() { log.push('detachShader'); },
    getExtension(name) { return name === 'WEBGL_lose_context' ? {loseContext() { log.push('loseContext'); }} : null; }};
  return new Proxy(base, {get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1; return () => ({}); }});
}
function harness({reduced = false, webgl = true, play = 'ok', session = {}, local = {}, deviceMemory = 8, withLife = false, fetchMode = 'ok'} = {}) {
  const nodes = [], rafs = new Map(), events = {}, glLog = [], mediaListeners = [], images = [], timers = new Map(), windowEvents = {};
  // Fake fetch + object URLs: clips arrive as Blobs and are played from blob: URLs (no HTTP Range needed on iOS).
  const fetches = [], blobUrls = {created: [], revoked: []};
  function fetch(url, opts) {
    fetches.push({url, opts});
    if (fetchMode === 'error') return Promise.reject(new TypeError('network'));
    if (fetchMode === 'status') return Promise.resolve({ok: false, status: 404, blob: () => Promise.resolve({})});
    return Promise.resolve({ok: true, status: 200, blob: () => Promise.resolve({blobOf: url})});
  }
  const URL = {createObjectURL(b) { const u = 'blob:fake/' + blobUrls.created.length + '#' + b.blobOf.replace(/^.*\//, ''); blobUrls.created.push(u); return u; },
    revokeObjectURL(u) { blobUrls.revoked.push(u); }};
  let obstacles = [];
  let id = 0; const clock = {t: 1000};
  const ctx2d = {clearRect() {}, save() {}, restore() {}, translate() {}, scale() {}, drawImage() {}};
  function el(tag) {
    const n = {tag, tagName: tag.toUpperCase(), style: {}, children: [], listeners: {}, attrs: {}, parentNode: null, clientWidth: 358, offsetWidth: 0,
      classList: {set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); }, toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); }},
      appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; },
      addEventListener(k, f) { (this.listeners[k] ??= []).push(f); }, removeEventListener() {},
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this._src = ''; }, getAttribute(k) { return this.attrs[k] ?? null; },
      contains(c) { return c === this || this.children.some(x => x.contains(c)); },
      getContext(type) { if (type === 'webgl') return webgl ? fakeGL(glLog) : null; return ctx2d; },
      getBoundingClientRect() { return {left: 0, right: 358, top: 0, bottom: 46, width: 358, height: 46}; }};
    Object.defineProperty(n, 'isConnected', {get() { return n === body || !!n.parentNode?.isConnected; }});
    if (tag === 'video') {
      Object.assign(n, {paused: true, readyState: 0, currentTime: 0, ended: false, muted: false, playsInline: false, autoplay: false, srcLog: [], plays: 0,
        play() { n.plays++; if (play === 'reject') return Promise.reject(Object.assign(new Error('blocked'), {name: 'NotAllowedError'}));
          if (play === 'abort') return Promise.reject(Object.assign(new Error('interrupted'), {name: 'AbortError'}));
          n.paused = false; if (play !== 'stall') n.readyState = 4; n.currentTime += .04; return Promise.resolve(); },
        pause() { n.paused = true; }, load() {},
        // Like a browser: an autoplay video starts by itself once it can play.
        fire(k) { if (k === 'canplay') { n.readyState = 4; if (n.autoplay || 'autoplay' in n.attrs) n.paused = false; } (n.listeners[k] || []).forEach(f => f({preventDefault() {}})); }});
      Object.defineProperty(n, 'src', {get() { return n._src; }, set(v) { n._src = v; n.srcLog.push({muted: n.muted, playsInline: n.playsInline, mutedAttr: 'muted' in n.attrs, inlineAttr: 'playsinline' in n.attrs}); }});
    }
    nodes.push(n); return n;
  }
  const body = el('body'), head = el('head'), header = el('header'), row = el('row'); body.appendChild(header); header.appendChild(row);
  row.querySelector = () => ({firstElementChild: {getBoundingClientRect: () => ({right: 150})}, nextElementSibling: {getBoundingClientRect: () => ({left: 300})}});
  const document = {body, head, hidden: false, createElement: el, querySelector: s => s === '.premium-header' ? header : row, addEventListener(k, f) { (events[k] ??= []).push(f); },
    // Only used by the fullscreen life layer: obstacles are protected buttons covering parts of the viewport.
    querySelectorAll: () => obstacles.map(r => ({getBoundingClientRect: () => r, matches: () => true})), createTreeWalker: () => ({nextNode: () => null}), createRange: () => ({})};
  const media = {matches: reduced, addEventListener(k, f) { mediaListeners.push(f); }};
  const store = o => ({getItem: k => o[k] ?? null, setItem: (k, v) => { o[k] = String(v); }});
  const navigator = {deviceMemory, connection: {saveData: false}};
  const window = {matchMedia: () => media, addEventListener(k, f) { (windowEvents[k] ??= []).push(f); }, navigator, sessionStorage: store(session), localStorage: store(local), innerWidth: 390, innerHeight: 844,
    fetch, URL};
  function Image() { this.width = this.height = 640; images.push(this); }
  const sandbox = {window, document, Image, Math, Promise, String, Float32Array, navigator, Date: {now: () => clock.t},
    getComputedStyle: () => ({position: 'relative', paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0'}),
    requestAnimationFrame(f) { rafs.set(++id, f); return id; }, cancelAnimationFrame(i) { rafs.delete(i); },
    setTimeout(f) { timers.set(++id, f); return id; }, clearTimeout(i) { timers.delete(i); }, MutationObserver: function () { this.observe = () => {}; }};
  vm.createContext(sandbox); vm.runInContext(photoSrc, sandbox); vm.runInContext(pairSrc, sandbox);
  if (withLife) {
    images.forEach(im => im.onload && im.onload());
    for (const f of ['za-catspace.js', 'za-catlife.js']) vm.runInContext(read(f), sandbox);
  }
  const scripts = () => nodes.filter(n => n.tag === 'script').map(n => n.src);
  const loadVideoModule = () => vm.runInContext(videoSrc, sandbox);
  const h = {window, document, nodes, rafs, events, glLog, media, session, clock, scripts, loadVideoModule, fetches, blobUrls,
    clip: v => v.attrs['data-clip'],
    get rt() { return window.__zaCatPairCore.runtime; },
    videos: () => nodes.filter(n => n.tag === 'video' && n.parentNode),
    playing: () => nodes.filter(n => n.tag === 'video' && n.parentNode && !n.paused),
    run(ts) { clock.t = ts; const f = [...rafs.values()]; rafs.clear(); f.forEach(x => x(ts)); },
    visibility(hidden) { document.hidden = hidden; events.visibilitychange.forEach(f => f()); },
    motion(on) { media.matches = on; mediaListeners.forEach(f => f()); },
    get life() { return window.__zaCatLifeCore && window.__zaCatLifeCore.state; },
    obstacles(list) { obstacles = list; },
    resize() { (windowEvents.resize || []).forEach(f => f()); },
    flush() { for (let i = 0; i < 10 && timers.size; i++) { const f = [...timers.values()]; timers.clear(); f.forEach(x => x()); } },
    perCat() { const v = h.rt.video, out = {}; for (const n of ['white', 'tabby']) { const A = v.actors[n]; out[n] = A ? Object.values(A.videos).filter(x => !x.paused).length : 0; } return out; }};
  return h;
}

test('loader: reduced motion never requests za-catvideo.js (so no mp4 is fetched); otherwise it loads after za-catlife.js', () => {
  for (const reduced of [true, false]) {
    const h = harness({reduced});
    const space = h.nodes.find(n => n.tag === 'script' && /za-catspace/.test(n.src)); space.onload();
    const lifeScript = h.nodes.find(n => n.tag === 'script' && /za-catlife\.js\?v=9/.test(n.src));
    assert.ok(!h.scripts().some(s => /catvideo/.test(s)), 'not before the pair/life scripts');
    h.nodes.find(n => /za-catpair\.js\?v=8/.test(n.src || '')).onload();
    h.nodes.find(n => /za-catlife\.js\?v=9/.test(n.src || '')).onload();
    assert.equal(h.scripts().some(s => /za-catvideo\.js\?v=1/.test(s)), !reduced, 'reduced=' + reduced);
    void lifeScript;
    if (reduced) { h.motion(false); assert.ok(h.scripts().some(s => /za-catvideo\.js/.test(s)), 'loaded later when reduced motion is switched off'); }
  }
});

test('video module under reduced motion, no WebGL, failed session, low memory or flag off creates no video at all', () => {
  for (const opts of [{reduced: true}, {webgl: false}, {session: {'za-cat-video-failed': '1'}}, {deviceMemory: 2}, {local: {'za-cat-video': 'off'}}]) {
    const h = harness(opts); h.loadVideoModule();
    assert.equal(h.nodes.filter(n => n.tag === 'video').length, 0, JSON.stringify(opts));
    assert.equal(h.rt.video.active, false);
  }
});

test('initial load: only idle + walk per cat, muted/playsinline set before src, only the visible clip plays', async () => {
  // The standalone lane starts in its wake phase; start from the seated greeting so only initial clips are needed.
  const h = harness(), P = h.window.__zaCatPairCore; P.state.phase = 'greet'; P.state.time = 0; P.step(P.state, 0);
  h.loadVideoModule();
  assert.equal(h.rt.video.active, true);
  const vids = h.videos();
  assert.deepEqual(vids.map(h.clip).sort(), ['za-tabby-idle.mp4', 'za-tabby-walk.mp4', 'za-white-idle.mp4', 'za-white-walk.mp4']);
  assert.deepEqual(h.fetches.map(f => f.url).sort(), ['/za-cats/za-tabby-idle.mp4?v=1', '/za-cats/za-tabby-walk.mp4?v=1', '/za-cats/za-white-idle.mp4?v=1', '/za-cats/za-white-walk.mp4?v=1']);
  await tick();
  assert.ok(vids.every(v => v.srcLog[0].muted && v.srcLog[0].playsInline && v.srcLog[0].mutedAttr && v.srcLog[0].inlineAttr), 'attributes before src');
  assert.ok(vids.every(v => v.src.startsWith('blob:') && v.src.endsWith(h.clip(v) + '?v=1')), 'played from the blob of its own clip');
  h.run(100); h.run(140); await tick(); h.run(180);
  assert.deepEqual(h.playing().map(h.clip).sort(), ['za-tabby-idle.mp4', 'za-white-idle.mp4']);
  assert.ok(h.glLog.includes('draw'), 'video frames are drawn through WebGL');
  assert.ok(h.nodes.filter(n => n.className === 'za-pair-sprite').every(c => c.style.visibility === 'hidden'), 'sprite canvases hand over to video');
  assert.equal(h.rafs.size, 1, 'still exactly one animation loop');
});

test('hidden tab pauses every video and stops the loop; visible resumes one loop and the current clip', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); h.run(140); await tick(); h.run(180);
  assert.ok(h.playing().length > 0);
  h.visibility(true); assert.equal(h.playing().length, 0); assert.equal(h.rafs.size, 0);
  h.run(300); assert.equal(h.playing().length, 0);
  h.visibility(false); assert.equal(h.rafs.size, 1); h.run(400); await tick();
  assert.equal(h.playing().length, 2); assert.equal(h.rafs.size, 1);
});

test('manual pause pauses videos and the loop; unpausing resumes', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick(); h.run(140);
  const pause = h.nodes.find(x => x.className === 'za-pair-pause');
  pause.listeners.click[0](); assert.equal(h.rafs.size, 0); assert.equal(h.playing().length, 0);
  pause.listeners.click[0](); assert.equal(h.rafs.size, 1); h.run(300); await tick(); assert.equal(h.playing().length, 2);
});

test('collapsed (fullscreen hide) counts as not running', async () => {
  const h = harness(); h.loadVideoModule(); h.rt.isCollapsed = () => true;
  h.run(100); h.run(140); await tick(); assert.equal(h.playing().length, 0);
});

test('switching to reduced motion mid-session unloads videos and hands back to the sprite', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick(); h.run(140);
  const before = h.nodes.filter(n => n.tag === 'video');
  h.motion(true);
  assert.equal(h.rt.video.active, false); assert.equal(h.videos().length, 0);
  assert.ok(before.every(v => v.paused && !v._src), 'paused and released');
  assert.ok(h.nodes.filter(n => n.className === 'za-pair-sprite').every(c => c.style.visibility === ''), 'sprites visible again');
  assert.equal(h.session['za-cat-video-failed'], undefined, 'reduced motion is not a failure');
});

test('autoplay blocked (iOS Low Power Mode) falls back to sprites for the session; an interrupted play() does not', async () => {
  const h = harness({play: 'reject'}); h.loadVideoModule(); await tick(); h.run(100); await tick();
  assert.equal(h.rt.video.active, false); assert.equal(h.rt.video.reason, 'play-rejected');
  assert.equal(h.session['za-cat-video-failed'], '1');
  assert.ok(h.nodes.filter(n => n.className === 'za-pair-sprite').every(c => c.style.visibility === ''));
  h.run(140); assert.equal(h.rafs.size, 1, 'sprite loop keeps running');
  const ok = harness({play: 'abort'}); ok.loadVideoModule(); await tick(); ok.run(100); await tick();
  assert.equal(ok.rt.video.active, true);
});

test('a video error event or WebGL context loss falls back immediately', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick();
  h.videos()[0].fire('error'); assert.equal(h.rt.video.active, false); assert.equal(h.session['za-cat-video-failed'], '1');
  const g = harness(); g.loadVideoModule(); g.nodes.find(n => n.className === 'za-cat-video').listeners.webglcontextlost[0]({preventDefault() {}});
  assert.equal(g.rt.video.active, false); assert.equal(g.rt.video.reason, 'context-lost');
});

test('no first frame within ~4s of running falls back; time in a hidden tab does not count', async () => {
  const h = harness({play: 'stall'}); h.loadVideoModule(); await tick(); h.run(1000); await tick(); h.run(1040);
  h.visibility(true); h.clock.t = 20000; h.visibility(false); h.run(20000); await tick();
  assert.equal(h.rt.video.active, true, 'hidden time is not a timeout');
  h.run(22000); assert.equal(h.rt.video.active, true);
  h.run(24100); assert.equal(h.rt.video.active, false); assert.equal(h.rt.video.reason, 'first-frame-timeout');
});

test('runtime one-shot handover and lazy loading: settle → liedown (faster) → sleep, sleep prefetches wake, ≤3 loaded per cat', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick();
  const v = h.rt.video, el = h.rt.white, A = v.actors.white, c = {mode: 'settle', facing: 1, clock: 0, index: 0};
  v.draw('white', c, el, 60);
  assert.equal(A.want, 'liedown');
  const lie = A.videos.liedown; assert.ok(lie, 'liedown loaded lazily on first need'); assert.equal(lie.playbackRate, v.core.ONE_SHOT_RATE);
  assert.ok(A.videos.sleep, 'sleep prefetched as the handover');
  await tick(); v.draw('white', {...c, mode: 'sleep'}, el, 60); assert.equal(A.want, 'liedown', 'finish lying down');
  lie.fire('ended'); v.draw('white', {...c, mode: 'sleep'}, el, 60); assert.equal(A.want, 'sleep');
  assert.ok(A.videos.wake, 'waking prefetched while asleep');
  assert.ok(Object.keys(A.videos).length <= 2);
  await tick(); v.draw('white', {...c, mode: 'wake'}, el, 60); assert.equal(A.want, 'wake');
  A.videos.wake.fire('ended'); v.draw('white', {...c, mode: 'wake'}, el, 60); assert.equal(A.want, 'idle');
  assert.ok(Object.keys(A.videos).length <= 2);
  assert.ok(h.playing().length <= 2, 'one decoding video per cat');
});

test('pure plan: one playing clip per cat, the prefetched next clip stays paused, nothing else is kept', () => {
  const {videoPlan, prefetchFor, MAX_LIVE_PER_CAT} = core();
  assert.equal(MAX_LIVE_PER_CAT, 2);
  assert.deepEqual(plain(videoPlan('liedown', true)), {liedown: 'play', sleep: 'pause'});
  assert.deepEqual(plain(videoPlan('sleep', true)), {sleep: 'play', wake: 'pause'});
  assert.deepEqual(plain(videoPlan('wake', false)), {wake: 'pause', idle: 'pause'}, 'not running: nothing plays');
  assert.deepEqual(plain(videoPlan('walk', true)), {walk: 'play', idle: 'pause'});
  assert.deepEqual(plain(videoPlan(null, true)), {});
  for (const clip of Object.keys(core().manifest.cats.white)) {
    const plan = videoPlan(clip, true);
    assert.equal(Object.values(plan).filter(x => x === 'play').length, 1, clip);
    assert.ok(Object.keys(plan).length <= 2, clip);
    assert.notEqual(prefetchFor(clip), clip);
  }
  assert.equal(core().shouldRun({actorHidden: true}), false);
});

test('demo-style switching never decodes more than one clip per cat and keeps ≤4 live videos in total', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick();
  const v = h.rt.video, els = {white: h.rt.white, tabby: h.rt.tabby};
  // The browser check: look → wake → … left both cats' look + wake clips playing at once.
  const modes = [['observe', 10], ['wake', 0], ['look', 10], ['wake', 0], ['groom', 0], ['settle', 0], ['sleep', 0], ['wake', 0], ['walk', 0], ['play', 0], ['react', 0], ['run', 0], ['sit', 0]];
  for (const [mode, clock] of modes) {
    v.reset();
    for (let k = 0; k < 3; k++) {
      for (const [i, name] of ['white', 'tabby'].entries()) v.draw(name, {mode, clock, index: i, facing: 1}, els[name], 60);
      await tick();
      const per = h.perCat();
      assert.ok(per.white <= 1 && per.tabby <= 1, mode + ': ' + JSON.stringify(per));
      assert.ok(h.videos().length <= 4, mode + ': ' + h.videos().length + ' live <video> elements');
      for (const name of ['white', 'tabby']) {
        const A = v.actors[name];
        for (const [clip, el] of Object.entries(A.videos)) if (!el.paused) assert.equal(clip, A.want, mode + ': only the displayed clip plays');
        if (A.prefetch && A.videos[A.prefetch]) assert.equal(A.videos[A.prefetch].paused, true, 'prefetched clip is loaded but paused');
      }
    }
  }
  // Released clips really let go of their media.
  const released = h.nodes.filter(n => n.tag === 'video' && !n.parentNode);
  assert.ok(released.length > 0 && released.every(n => !n._src && n.paused), 'released videos have no src');
  // wake really shows on demand even after the cat was already sitting (deterministic demo buttons).
  v.reset(); v.draw('white', {mode: 'wake', clock: 0, index: 0, facing: 1}, els.white, 60); assert.equal(v.actors.white.want, 'wake');
  v.reset(); v.draw('white', {mode: 'settle', clock: 0, index: 0, facing: 1}, els.white, 60); assert.equal(v.actors.white.want, 'liedown');
});

test('no autoplay: paused or collapsed before the clips load → still paused after canplay; playback starts only via play() when running', async () => {
  for (const which of ['paused', 'collapsed']) {
    const h = harness();
    if (which === 'paused') h.nodes.find(x => x.className === 'za-pair-pause').listeners.click[0]();
    if (which === 'collapsed') h.rt.isCollapsed = () => true;
    h.loadVideoModule(); await tick();
    const vids = h.videos();
    assert.ok(vids.length > 0);
    assert.ok(vids.every(x => !x.autoplay && !('autoplay' in x.attrs)), 'no autoplay property or attribute');
    assert.ok(vids.every(x => x.srcLog[0].muted && x.srcLog[0].playsInline && x.srcLog[0].mutedAttr && x.srcLog[0].inlineAttr), 'muted/playsinline before src');
    h.rt.render(); vids.forEach(x => x.fire('canplay')); h.rt.render(); await tick(); h.run(200); await tick();
    assert.equal(h.playing().length, 0, which + ': nothing starts by itself');
    assert.ok(vids.every(x => x.plays === 0), which + ': play() never called');
    if (which === 'paused') { h.nodes.find(x => x.className === 'za-pair-pause').listeners.click[0](); h.run(300); await tick(); assert.equal(h.playing().length, 2); }
  }
});

test('pauseSafe always calls pause(), even on a video whose play() has not settled yet', async () => {
  const h = harness(); h.loadVideoModule();
  const calls = []; h.videos().forEach(x => { const p = x.pause; x.pause = () => { calls.push(x); p(); }; });
  h.rt.video.sleep();
  assert.equal(calls.length, h.videos().length, 'pause() reaches every video even though paused===true');
});

test('WebGL resources are disposed on teardown, fallback, reduced motion and when the probe decides against video', async () => {
  const counts = log => ['deleteTexture', 'deleteBuffer', 'deleteProgram', 'deleteShader', 'loseContext'].map(k => log.filter(x => x === k).length);
  const m = harness(); m.loadVideoModule(); await tick(); m.run(100); await tick();
  assert.deepEqual(counts(m.glLog), [0, 0, 0, 0, 0]);
  m.motion(true); assert.deepEqual(counts(m.glLog), [2, 2, 2, 4, 2], 'reduced motion: both cats fully disposed');
  m.motion(false); assert.equal(m.rt.video.active, true, 'self-inflicted context loss is not a failure');
  const f = harness(); f.loadVideoModule(); await tick(); f.run(100); await tick(); f.videos()[0].fire('error');
  assert.deepEqual(counts(f.glLog), [2, 2, 2, 4, 2], 'fallback disposes');
  // Probe contexts created before the decision (flag off) are released too.
  const p = harness({local: {'za-cat-video': 'off'}}); p.loadVideoModule();
  assert.equal(p.rt.video.active, false); assert.deepEqual(counts(p.glLog), [2, 2, 2, 4, 2], 'probe contexts released');
  // A WebGL context lost event from an old, disposed canvas must not fail the new session.
  const oldCanvas = m.nodes.filter(n => n.className === 'za-cat-video')[0];
  oldCanvas.listeners.webglcontextlost[0]({preventDefault() {}});
  assert.equal(m.rt.video.active, true);
});

test('fullscreen: both cats hidden (no safe spot) → 0 playing videos and no RAF; a later relayout with room resumes', async () => {
  const h = harness({withLife: true}); h.flush(); h.loadVideoModule();
  assert.equal(h.rt.video.active, true);
  assert.ok(h.life.actors.every(a => !a.hidden), 'both cats placed');
  h.run(100); await tick(); h.run(140); await tick();
  assert.equal(h.playing().length, 2); assert.equal(h.rafs.size, 1);
  // A full-screen protected control leaves no legal position for either cat.
  h.obstacles([{left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844}]);
  h.resize(); h.flush();
  assert.ok(h.life.actors.every(a => a.hidden), 'both cats hidden');
  assert.equal(h.playing().length, 0, 'no hidden cat keeps decoding');
  // za-catphoto queues one non-repeating place() frame for the resize event; run it, then nothing may be left.
  h.run(400); await tick();
  assert.equal(h.rafs.size, 0, 'loop stopped: ' + [...h.rafs.values()].map(String).join('|').slice(0, 300));
  assert.equal(h.playing().length, 0);
  h.run(450); assert.equal(h.rafs.size, 0, 'stays stopped');
  // Room again: the existing relayout path resumes the single loop and the current clips.
  h.obstacles([]); h.resize(); h.flush();
  assert.ok(h.life.actors.some(a => !a.hidden));
  h.run(500); await tick(); assert.equal(h.rafs.size, 1, 'exactly one loop again'); h.run(540); await tick();
  assert.ok(h.playing().length >= 1); assert.equal(h.rafs.size, 1);
});

test('one hidden cat: its videos pause while the visible cat keeps playing', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick(); h.run(140); await tick();
  const v = h.rt.video;
  v.draw('tabby', {mode: 'sit', clock: 0, index: 1, facing: 1, hidden: true}, h.rt.tabby, 60);
  v.draw('white', {mode: 'sit', clock: 0, index: 0, facing: 1}, h.rt.white, 60); await tick();
  assert.deepEqual(h.perCat(), {white: 1, tabby: 0});
  assert.equal(v.actors.tabby.canvas.style.display, 'none');
});

test('video code keeps its storage to the two documented keys and never touches account data', () => {
  const code = videoSrc.replace(/^\s*\/\/.*$/gm, '');
  // The only network call is the same-origin clip download (BASE + clip file).
  assert.deepEqual(code.match(/fetch\([^)]*\)/g), ["fetch(BASE + file + VERSION, {credentials: 'same-origin'})"]);
  for (const bad of ['XMLHttpRequest', 'innerHTML', 'eval(', 'new Function', 'indexedDB', 'requestAnimationFrame', '/api/']) assert.ok(!code.includes(bad), bad);
  assert.deepEqual([...new Set(videoSrc.match(/'za-cat-video[a-z-]*'/g))].sort(), ["'za-cat-video'", "'za-cat-video-failed'", "'za-cat-video-pool'"]);
});

// ── iOS：Cloudflare 靜態檔不回 206，所以影片先整段下載成 Blob，再用 blob: 網址播放 ──
test('blob path: clips are fetched same-origin, played from blob: URLs, and play() waits for the blob', async () => {
  const h = harness(), P = h.window.__zaCatPairCore; P.state.phase = 'greet'; P.state.time = 0; P.step(P.state, 0);
  h.loadVideoModule();
  assert.equal(h.fetches.length, 4, 'initial idle + walk only');
  assert.ok(h.fetches.every(f => f.opts && f.opts.credentials === 'same-origin' && /^\/za-cats\/za-(white|tabby)-(idle|walk)\.mp4\?v=1$/.test(f.url)));
  assert.ok(h.videos().every(v => !v._src), 'no direct (range-requiring) src is ever set');
  h.run(100); assert.ok(h.videos().every(v => v.plays === 0), 'play() is not called before the blob arrives');
  await tick();
  assert.ok(h.videos().every(v => /^blob:/.test(v.src)));
  assert.ok(h.nodes.filter(n => n.tag === 'video').every(v => v.srcLog.length <= 1), 'src set once per element');
  h.run(140); await tick();
  assert.equal(h.playing().length, 2);
});

test('blob cache: re-using a clip after it was released does not fetch it again', async () => {
  const h = harness(); h.loadVideoModule(); await tick(); h.run(100); await tick();
  const v = h.rt.video, el = h.rt.white, A = v.actors.white, c = {mode: 'groom', facing: 1, clock: 0, index: 0};
  v.draw('white', c, el, 60); await tick();
  assert.equal(h.fetches.filter(f => /white-groom/.test(f.url)).length, 1);
  const first = A.videos.groom.src;
  for (const mode of ['settle', 'sleep', 'wake']) { v.reset(); v.draw('white', {...c, mode}, el, 60); await tick(); }
  assert.equal(A.videos.groom, undefined, 'groom element released');
  v.reset(); v.draw('white', c, el, 60);
  assert.equal(A.videos.groom.src, first, 'new element gets the cached blob URL synchronously');
  assert.equal(h.fetches.filter(f => /white-groom/.test(f.url)).length, 1, 'fetched only once');
  assert.equal(new Set(h.fetches.map(f => f.url)).size, h.fetches.length, 'no clip is ever fetched twice');
  assert.equal(h.blobUrls.revoked.length, 0, 'cached blobs stay valid while video mode is active');
});

test('fetch failure (network error or non-OK status) falls back to sprites for the session', async () => {
  for (const fetchMode of ['error', 'status']) {
    const h = harness({fetchMode}); h.loadVideoModule();
    assert.equal(h.rt.video.active, true);
    await tick();
    assert.equal(h.rt.video.active, false, fetchMode);
    assert.equal(h.rt.video.reason, 'fetch');
    assert.equal(h.session['za-cat-video-failed'], '1');
    assert.equal(h.videos().length, 0);
    assert.equal(h.blobUrls.created.length, 0);
    assert.ok(h.nodes.filter(n => n.className === 'za-pair-sprite').every(c => c.style.visibility === ''), 'sprites visible again');
  }
});

test('object URLs are revoked on teardown and fallback; late downloads after teardown create none', async () => {
  const m = harness(); m.loadVideoModule(); await tick();
  assert.equal(m.blobUrls.created.length, m.fetches.length);
  assert.ok(m.blobUrls.created.length >= 4);
  m.motion(true);
  assert.deepEqual([...m.blobUrls.revoked].sort(), [...m.blobUrls.created].sort(), 'reduced motion revokes every blob URL');
  const f = harness(); f.loadVideoModule(); await tick(); f.run(100); await tick();
  f.videos()[0].fire('error');
  assert.deepEqual([...f.blobUrls.revoked].sort(), [...f.blobUrls.created].sort(), 'fallback revokes every blob URL');
  // Teardown while the downloads are still in flight: nothing is created, so nothing can leak.
  const l = harness(); l.loadVideoModule(); l.motion(true); await tick();
  assert.equal(l.blobUrls.created.length, 0);
  assert.ok(l.nodes.filter(n => n.tag === 'video').every(v => !v._src));
});

test('reduced motion: the video module fetches nothing', () => {
  const h = harness({reduced: true}); h.loadVideoModule();
  assert.equal(h.fetches.length, 0); assert.equal(h.blobUrls.created.length, 0);
});
