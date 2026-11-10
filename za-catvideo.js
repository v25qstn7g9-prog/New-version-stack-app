// 寫實影片小貓（選項 C）：純畫面，不碰持股、交易、報價或任何資產資料。
// 每段 MP4 是「上下疊」的去背影片：上半是已乘上透明度的彩色畫面，下半是灰階透明度遮罩；
// 用一張 WebGL 畫布（每隻貓一張，放在原本的貓按鈕裡，位置仍由原本的 CSS transform 決定）把兩半合成透明的貓。
// 沒有自己的 requestAnimationFrame：只在原本的小貓迴圈（za-catpair／za-catlife，最多 30fps）呼叫 render 時畫一格。
// 任何問題（WebGL 失敗或遺失、影片下載失敗、影片錯誤、自動播放被擋、4 秒內沒有第一格）→ 這個分頁剩下的時間都改回原本的精靈圖。
// 「減少動態效果」→ 完全不載入任何影片（載入器也不會載入這支檔案）。
(function () {
  'use strict';
  if (window.__zaCatVideoCore) return;

  // 與 za-cats/za-cat-clips.json 相同（測試會比對）。.json 不會被當成靜態檔發布，所以內嵌在這裡。
  var MANIFEST = {version: 1, fps: 24, cats: {
    white: {
      idle: {src: 'za-white-idle.mp4', w: 188, h: 278, frames: 96, duration: 4, loop: true, anchorX: 87.6, groundY: 267.6, facing: 'left', bytes: 20094},
      look: {src: 'za-white-look.mp4', w: 214, h: 270, frames: 96, duration: 4, loop: true, anchorX: 113.6, groundY: 259.6, facing: 'left', bytes: 28568},
      groom: {src: 'za-white-groom.mp4', w: 212, h: 266, frames: 96, duration: 4, loop: true, anchorX: 111.6, groundY: 255.6, facing: 'left', bytes: 41626},
      play: {src: 'za-white-play.mp4', w: 202, h: 284, frames: 96, duration: 4, loop: true, anchorX: 101.6, groundY: 273.6, facing: 'left', bytes: 35176},
      react: {src: 'za-white-react.mp4', w: 188, h: 284, frames: 72, duration: 3, loop: true, anchorX: 87.6, groundY: 274.9, facing: 'left', bytes: 19436},
      walk: {src: 'za-white-walk.mp4', w: 348, h: 204, frames: 72, duration: 3, loop: true, anchorX: 194.4, groundY: 194.6, facing: 'right', bytes: 63876},
      trot: {src: 'za-white-trot.mp4', w: 352, h: 206, frames: 48, duration: 2, loop: true, anchorX: 197.2, groundY: 194.6, facing: 'right', bytes: 44220},
      liedown: {src: 'za-white-liedown.mp4', w: 246, h: 280, frames: 97, duration: 4.042, loop: false, anchorX: 123.6, groundY: 260.8, facing: 'left', bytes: 42379},
      sleep: {src: 'za-white-sleep.mp4', w: 236, h: 166, frames: 96, duration: 4, loop: true, anchorX: 127.6, groundY: 156.5, facing: 'left', bytes: 15053},
      wake: {src: 'za-white-wake.mp4', w: 276, h: 284, frames: 97, duration: 4.042, loop: false, anchorX: 157.6, groundY: 264.5, facing: 'left', bytes: 46404}
    },
    tabby: {
      idle: {src: 'za-tabby-idle.mp4', w: 284, h: 268, frames: 96, duration: 4, loop: true, anchorX: 92.9, groundY: 256.4, facing: 'left', bytes: 43298},
      look: {src: 'za-tabby-look.mp4', w: 232, h: 264, frames: 96, duration: 4, loop: true, anchorX: 110.9, groundY: 256.4, facing: 'left', bytes: 56075},
      groom: {src: 'za-tabby-groom.mp4', w: 234, h: 268, frames: 96, duration: 4, loop: true, anchorX: 112.9, groundY: 258.4, facing: 'left', bytes: 69193},
      play: {src: 'za-tabby-play.mp4', w: 326, h: 338, frames: 96, duration: 4, loop: true, anchorX: 134.9, groundY: 328.4, facing: 'left', bytes: 81814},
      react: {src: 'za-tabby-react.mp4', w: 286, h: 268, frames: 72, duration: 3, loop: true, anchorX: 94.9, groundY: 260.4, facing: 'left', bytes: 42102},
      walk: {src: 'za-tabby-walk.mp4', w: 386, h: 206, frames: 72, duration: 3, loop: true, anchorX: 212, groundY: 193.4, facing: 'right', bytes: 92235},
      trot: {src: 'za-tabby-trot.mp4', w: 378, h: 208, frames: 48, duration: 2, loop: true, anchorX: 212, groundY: 193.4, facing: 'right', bytes: 59850},
      liedown: {src: 'za-tabby-liedown.mp4', w: 316, h: 276, frames: 97, duration: 4.042, loop: false, anchorX: 124.9, groundY: 258.7, facing: 'left', bytes: 69106},
      sleep: {src: 'za-tabby-sleep.mp4', w: 308, h: 168, frames: 96, duration: 4, loop: true, anchorX: 131.7, groundY: 159.5, facing: 'left', bytes: 44013},
      wake: {src: 'za-tabby-wake.mp4', w: 322, h: 278, frames: 97, duration: 4.042, loop: false, anchorX: 145.7, groundY: 265.5, facing: 'left', bytes: 70959}
    }
  }};
  var CATS = ['white', 'tabby'];
  var MAX_FPS = 30, FIRST_FRAME_MS = 4000, ONE_SHOT_RATE = 1.6, MAX_LIVE_PER_CAT = 2;
  // 一次性動作播完交給誰：趴下→睡、醒來→坐著
  var HANDOVER = {liedown: 'sleep', wake: 'idle'};
  // 每隻貓只留「正在用的」和「最可能的下一段」兩支影片（兩隻貓合計最多 4 支）；其他一律釋放。
  function prefetchFor(clip) {
    if (HANDOVER[clip]) return HANDOVER[clip];
    if (clip === 'sleep') return 'wake';
    return clip === 'walk' ? 'idle' : 'walk';
  }
  // 哪些影片要留著、哪一支可以播：每隻貓最多一支在播（正在顯示或即將顯示的那段），預載的下一段只載不播。
  function videoPlan(want, run) {
    var keep = {}, next = want ? prefetchFor(want) : null;
    if (want) keep[want] = run ? 'play' : 'pause';
    if (next && next !== want) keep[next] = 'pause';
    return keep;
  }
  // 坐著的貓在影片裡約 250px 高；畫成原本精靈圖貓的大小（約框高的 0.8），地面線在框的 152/160。
  var SEATED_CLIP_PX = 250, SEATED_BOX = 0.8, GROUND_IN_BOX = 152 / 160;
  // 影片畫布比貓的框大，讓走路時伸長的身體不會被切到；地面線在畫布高度 90% 處。
  var CANVAS_W = 2.4, CANVAS_H = 1.5, CANVAS_GROUND = 0.9;

  // ── 純函式（測試直接呼叫，不碰 DOM） ──
  // 判斷要不要用影片。順序有意義：減少動態效果與沒有 WebGL 永遠優先；手動 'on' 可以略過省流量／記憶體／先前失敗。
  function shouldUseVideo(env) {
    env = env || {};
    if (env.reducedMotion) return {ok: false, reason: 'reduced-motion'};
    if (!env.webgl) return {ok: false, reason: 'no-webgl'};
    if (env.flag === 'off') return {ok: false, reason: 'flag-off'};
    if (env.flag === 'on') return {ok: true, reason: 'flag-on'};
    if (env.failed) return {ok: false, reason: 'failed'};
    if (env.saveData) return {ok: false, reason: 'save-data'};
    if (typeof env.deviceMemory === 'number' && env.deviceMemory < 4) return {ok: false, reason: 'low-memory'};
    return {ok: true, reason: 'ok'};
  }
  // 狀態機的 mode → 影片名稱。坐著觀察時依貓自己的時鐘在 idle／look 之間輪流（固定、不亂數）。
  function clipFor(mode, actor) {
    switch (mode) {
      case 'walk': return 'walk';
      case 'run': case 'chase': case 'trot': return 'trot';
      case 'jump': case 'hop': case 'pounce': case 'respond': case 'play': case 'invite': return 'play';
      case 'groom': return 'groom';
      case 'settle': return 'liedown';
      case 'sleep': return 'sleep';
      case 'wake': return 'wake';
      case 'react': case 'tap': return 'react';
      case 'observe': case 'sit': case 'look': {
        var a = actor || {}, t = (Number(a.clock) || 0) + (Number(a.index) || 0) * 5;
        return Math.floor(t / 9) % 2 ? 'look' : 'idle';
      }
      default: return 'idle';
    }
  }
  // 一開始只載兩隻貓的 idle 與 walk，其餘第一次用到才載。
  function planLoads(manifest) {
    var m = manifest || MANIFEST, initial = [], lazy = [];
    Object.keys(m.cats || {}).forEach(function (cat) {
      Object.keys(m.cats[cat]).forEach(function (clip) {
        var entry = {cat: cat, clip: clip, src: m.cats[cat][clip].src, bytes: m.cats[cat][clip].bytes};
        if (clip === 'idle' || clip === 'walk') { entry.preload = 'auto'; initial.push(entry); }
        else { entry.preload = 'none'; lazy.push(entry); }
      });
    });
    return {initial: initial, lazy: lazy};
  }
  // 分頁在背景、小貓收起、手動暫停、減少動態效果、這隻貓暫時藏起來（沒有安全空位）→ 不播放也不畫。
  function shouldRun(state) {
    state = state || {};
    return !(state.hidden || state.collapsed || state.paused || state.reducedMotion || state.reduced || state.actorHidden);
  }
  // 最多 30fps（影片本身 24fps）：距離上一次畫超過一格的時間才畫。
  function frameDue(lastMs, nowMs, fps) {
    var f = Math.min(MAX_FPS, Math.max(1, Number(fps) || MAX_FPS));
    return !lastMs || nowMs - lastMs >= 1000 / f - 0.5;
  }
  // 一次性片段（趴下、醒來）要播完才交棒；被走路等別的動作打斷時立刻換。
  // current：正在播的片段；wanted：狀態機現在想要的；ended：current 是否已播完。
  function nextClip(current, wanted, ended) {
    if (!current) return wanted;
    var hand = HANDOVER[current];
    if (hand) {
      if (!ended) return (wanted === current || wanted === hand || (current === 'wake' && wanted === 'look')) ? current : wanted;
      if (wanted === current) return hand;
      return wanted;
    }
    // 已經交棒（例如已在睡）但狀態機還在「趴下中」：不要重播一次性片段。
    if (HANDOVER[wanted] && HANDOVER[wanted] === current) return current;
    return wanted;
  }
  // 影片裡貓朝哪邊 vs 狀態機的 facing（1＝朝左，跟精靈圖相同；-1＝鏡像成朝右）→ 要不要鏡像。
  function flipFor(clipFacing, actorFacing) {
    var actorLeft = actorFacing !== -1;
    return (clipFacing === 'left') !== actorLeft;
  }
  // 片段在貓框裡的位置（CSS px，相對於影片畫布左上角）。size＝貓框邊長。
  function placement(meta, size, flip) {
    var W = size * CANVAS_W, H = size * CANVAS_H, ground = H * CANVAS_GROUND, cx = W / 2;
    var k = size * SEATED_BOX / SEATED_CLIP_PX;
    var left = flip ? cx - (meta.w - meta.anchorX) * k : cx - meta.anchorX * k;
    var top = ground - meta.groundY * k;
    return {W: W, H: H, left: left, top: top, width: meta.w * k, height: meta.h * k, scale: k,
      canvasLeft: (size - W) / 2, canvasTop: size * GROUND_IN_BOX - ground};
  }
  function totalBytes(manifest) {
    var m = manifest || MANIFEST, n = 0;
    Object.keys(m.cats).forEach(function (c) { Object.keys(m.cats[c]).forEach(function (k) { n += m.cats[c][k].bytes || 0; }); });
    return n;
  }
  var core = window.__zaCatVideoCore = {manifest: MANIFEST, shouldUseVideo: shouldUseVideo, clipFor: clipFor, planLoads: planLoads,
    shouldRun: shouldRun, frameDue: frameDue, nextClip: nextClip, prefetchFor: prefetchFor, videoPlan: videoPlan, flipFor: flipFor, placement: placement, totalBytes: totalBytes,
    HANDOVER: HANDOVER, FIRST_FRAME_MS: FIRST_FRAME_MS, ONE_SHOT_RATE: ONE_SHOT_RATE, MAX_FPS: MAX_FPS, MAX_LIVE_PER_CAT: MAX_LIVE_PER_CAT};
  if (typeof document === 'undefined' || !document.createElement) return;

  // ── 瀏覽器整合 ──
  var pair = window.__zaCatPairCore, rt = pair && pair.runtime;
  if (!rt) return;
  var FAIL_KEY = 'za-cat-video-failed', FLAG_KEY = 'za-cat-video';
  var BASE = window.__zaCatVideoBase || '/za-cats/', VERSION = '?v=1';
  var media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches: false};
  function now() { return Date.now(); }
  function storageGet(kind, key) { try { var s = window[kind]; return s ? s.getItem(key) : null; } catch (e) { return null; } }
  function storageSet(kind, key, v) { try { var s = window[kind]; if (s) s.setItem(key, v); } catch (e) {} }
  function readEnv(webgl) {
    var nav = window.navigator || {}, conn = nav.connection || {};
    var force = window.__zaCatVideoForce;
    return {reducedMotion: !!media.matches, webgl: !!webgl, saveData: !!conn.saveData,
      deviceMemory: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined,
      flag: force === 'on' || force === 'off' ? force : storageGet('localStorage', FLAG_KEY),
      failed: storageGet('sessionStorage', FAIL_KEY) === '1'};
  }
  function runState() {
    return {hidden: !!document.hidden, collapsed: !!(rt.isCollapsed && rt.isCollapsed()),
      paused: !!(rt.isPaused && rt.isPaused()), reducedMotion: !!media.matches, reduced: !!(pair.state && pair.state.reduced)};
  }

  var VS = 'attribute vec2 p;uniform vec4 r;uniform float f;varying vec2 uv;' +
    'void main(){uv=vec2(f>0.5?1.0-p.x:p.x,p.y);gl_Position=vec4(mix(r.x,r.z,p.x),mix(r.y,r.w,p.y),0.0,1.0);}';
  // 上半＝彩色（已乘透明度）、下半＝透明度遮罩。e＝距離中線一個像素，避免取樣滲到另一半。
  var FS = 'precision mediump float;uniform sampler2D t;uniform float e;varying vec2 uv;' +
    'void main(){float y=clamp(uv.y,e,1.0-e)*0.5;vec3 c=texture2D(t,vec2(uv.x,y)).rgb;float a=texture2D(t,vec2(uv.x,y+0.5)).r;' +
    'gl_FragColor=vec4(min(c,vec3(a)),a);}';
  // 釋放一組 WebGL 物件（貼圖、緩衝、程式、著色器），最後把 context 也交還（WEBGL_lose_context）。
  // teardown、初始化失敗、退回精靈圖、切到減少動態效果、決定不用影片時的探測畫布都走這裡。
  function disposeGL(G) {
    if (!G || G.disposed || !G.gl) return;
    G.disposed = true;
    var gl = G.gl;
    try {
      if (G.tex) gl.deleteTexture(G.tex);
      if (G.buf) gl.deleteBuffer(G.buf);
      if (G.prog) { if (G.vs) gl.detachShader(G.prog, G.vs); if (G.fs) gl.detachShader(G.prog, G.fs); gl.deleteProgram(G.prog); }
      if (G.vs) gl.deleteShader(G.vs);
      if (G.fs) gl.deleteShader(G.fs);
    } catch (e) {}
    try { var lose = gl.getExtension && gl.getExtension('WEBGL_lose_context'); if (lose && lose.loseContext) lose.loseContext(); } catch (e) {}
    G.tex = G.buf = G.prog = G.vs = G.fs = null;
  }
  function makeGL(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl', {alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power'}); } catch (e) { gl = null; }
    if (!gl) return null;
    var G = {gl: gl};
    function bad() { disposeGL(G); return null; }
    function shader(type, src) { var x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); return x; }
    try {
      G.vs = shader(gl.VERTEX_SHADER, VS); G.fs = shader(gl.FRAGMENT_SHADER, FS);
      if (!gl.getShaderParameter(G.vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(G.fs, gl.COMPILE_STATUS)) return bad();
      var prog = G.prog = gl.createProgram(); gl.attachShader(prog, G.vs); gl.attachShader(prog, G.fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return bad();
      gl.useProgram(prog);
      G.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, G.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      G.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.clearColor(0, 0, 0, 0);
      G.r = gl.getUniformLocation(prog, 'r'); G.f = gl.getUniformLocation(prog, 'f'); G.e = gl.getUniformLocation(prog, 'e');
    } catch (e) { return bad(); }
    return G;
  }

  var css = document.createElement('style');
  css.textContent = '.za-cat-video{position:absolute;display:none;pointer-events:none;max-width:none}' +
    '.za-cat-video-pool{position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none}' +
    '.za-cat-video-pool video{width:1px;height:1px}';
  document.head.appendChild(css);

  var active = false, drawing = false, actors = {}, pool = null, failedReason = null;
  var api = {active: false, draw: draw, sleep: sleep, fail: fail, reset: reset, actors: actors, core: core};
  core.runtime = api;

  function hostFor(name) { return name === 'tabby' ? rt.tabby : rt.white; }
  // 還沒拿到影片（blob 還在下載）就不呼叫 play()：沒有 src 的 play() 不會開始，之後的 draw 再試。
  function playSafe(v) {
    if (!v.__src || !v.paused || v.__pending) return;
    var p;
    try { p = v.play(); } catch (e) { fail('play-threw'); return; }
    if (p && typeof p.then === 'function') {
      v.__pending = true;
      p.then(function () { v.__pending = false; }, function (e) {
        v.__pending = false;
        // pause() 打斷 play() 是正常的；只有自動播放被擋（低耗電模式）或格式不支援才算失敗。
        if (e && e.name === 'AbortError') return;
        if (!v.__retired) fail('play-rejected');
      });
    }
  }
  // 一律呼叫 pause()：還沒開始播（paused 仍是 true）時也要擋下任何已排隊的播放。
  function pauseSafe(v) { try { v.pause(); } catch (e) {} }
  function makeVideo(name, clip, preload) {
    var v = document.createElement('video');
    // 這些屬性與屬性值一定要在 src 之前設定，iOS 才允許靜音播放。不設 autoplay：只有 playSafe() 會開始播放。
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.autoplay = false;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    v.preload = preload; v.loop = !!MANIFEST.cats[name][clip].loop; v.crossOrigin = 'anonymous';
    v.width = 1; v.height = 1;
    v.addEventListener('error', function () { if (!v.__retired) fail('video-error'); });
    v.addEventListener('ended', function () { v.__ended = true; });
    var file = MANIFEST.cats[name][clip].src;
    v.setAttribute('data-clip', file);
    pool.appendChild(v);
    // src 一律是記憶體裡的 blob: 網址（見 clipBlob）；已經下載過就立刻設定，否則下載完才設定。
    var b = clipBlob(file);
    if (b.url) setSrc(v, b.url);
    else b.p.then(function (url) { if (url && !v.__retired && active) setSrc(v, url); });
    return v;
  }
  // 設定 src 會跑瀏覽器的載入流程，playbackRate 被重設成 defaultPlaybackRate：兩個都設，src 設好後再套一次。
  function setRate(v) { var r = v.__rate || 1; try { v.defaultPlaybackRate = r; v.playbackRate = r; } catch (e) {} }
  function setSrc(v, url) { v.__src = url; v.src = url; setRate(v); }
  // iOS Safari 不播放「不支援 Range（206）」伺服器上的 <video src>，而 Cloudflare Workers 靜態檔不回 206。
  // 所以每段影片先用 fetch 整個下載（15–92 KB），轉成 Blob 再用 URL.createObjectURL 當 src（blob: 不需要 Range）。
  // 每段只下載一次、留在記憶體重複用；teardown／退回精靈圖時全部 revoke。下載失敗或非 2xx → 跟影片錯誤一樣退回精靈圖。
  var blobs = {};
  function clipBlob(file) {
    var b = blobs[file];
    if (b) return b;
    b = blobs[file] = {url: null};
    var U = window.URL;
    if (typeof window.fetch !== 'function' || !U || typeof U.createObjectURL !== 'function') {
      b.p = Promise.resolve(null).then(function () { if (blobs[file] === b) fail('no-fetch'); return null; });
      return b;
    }
    b.p = window.fetch(BASE + file + VERSION, {credentials: 'same-origin'}).then(function (r) {
      if (!r || !r.ok) throw new Error('status ' + (r && r.status));
      return r.blob();
    }).then(function (blob) {
      // 這段期間已經 teardown：不建立網址，也就不會漏掉 revoke。
      if (blobs[file] !== b) return null;
      b.url = U.createObjectURL(blob);
      return b.url;
    }).then(null, function () {
      if (blobs[file] === b) fail('fetch');
      return null;
    });
    return b;
  }
  function revokeBlobs() {
    var U = window.URL, old = blobs;
    blobs = {};
    Object.keys(old).forEach(function (k) { if (old[k].url) { try { U.revokeObjectURL(old[k].url); } catch (e) {} } });
  }
  function ensure(A, clip, preload) {
    var v = A.videos[clip];
    if (!v) v = A.videos[clip] = makeVideo(A.name, clip, preload);
    else if (preload === 'auto' && v.preload !== 'auto') v.preload = 'auto';
    return v;
  }
  // 釋放影片：暫停、拿掉 src、load() 讓瀏覽器丟掉解碼緩衝，再從畫面移除（blob 留在快取，再用到不必重新下載）。
  function retire(v) { v.__retired = true; v.__src = null; pauseSafe(v); try { v.removeAttribute('src'); v.load(); } catch (e) {} if (v.parentNode) v.parentNode.removeChild(v); }
  // 照 videoPlan 套用：該播的播（只在 run 時）、其他暫停；不在計畫裡的影片釋放。
  // 畫面上的舊片段就算被釋放，WebGL 貼圖仍留著它最後一格，直到新片段第一格出來（不會閃回精靈圖）。
  function apply(A, run) {
    var plan = videoPlan(A.want, run);
    Object.keys(A.videos).forEach(function (k) {
      var x = A.videos[k];
      if (!plan[k]) { retire(x); delete A.videos[k]; return; }
      if (plan[k] === 'play' && !(x.__ended && !x.loop)) playSafe(x); else pauseSafe(x);
    });
  }
  function startClip(A, clip) {
    var v = ensure(A, clip, 'auto');
    var meta = MANIFEST.cats[A.name][clip];
    v.__ended = false;
    if (!meta.loop) { try { v.currentTime = 0; } catch (e) {} }
    v.__rate = meta.loop ? 1 : ONE_SHOT_RATE; setRate(v);
    A.waitSince = 0;
    // 預先載入下一段（只載不播）：一次性片段的接手片段；睡覺時先準備醒來；其他時候準備走路／坐著。
    var next = prefetchFor(clip);
    A.prefetch = next !== clip ? next : null;
    if (A.prefetch) ensure(A, A.prefetch, 'auto');
  }
  function resize(A, size) {
    if (A.size === size) return;
    A.size = size;
    var P = placement({w: 1, h: 1, anchorX: 0, groundY: 0}, size, false), c = A.canvas;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.width = P.W.toFixed(1) + 'px'; c.style.height = P.H.toFixed(1) + 'px';
    c.style.left = P.canvasLeft.toFixed(1) + 'px'; c.style.top = P.canvasTop.toFixed(1) + 'px';
    c.width = Math.max(1, Math.round(P.W * dpr)); c.height = Math.max(1, Math.round(P.H * dpr));
    A.gl.gl.viewport(0, 0, c.width, c.height);
    A.lastT = -1;
  }
  function paint(A, c) {
    var G = A.gl, gl = G.gl, v = A.videos[A.shown], meta = MANIFEST.cats[A.name][A.shown];
    var t = now();
    // 只上傳已有畫面的影片；舊片段已被釋放（或重建中還沒第一格）時沿用貼圖裡的最後一格。
    if (v && v.readyState >= 2 && v.currentTime !== A.lastT && frameDue(A.lastUpload, t, MAX_FPS)) {
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v); }
      catch (e) { fail('upload'); return false; }
      A.lastT = v.currentTime; A.lastUpload = t;
    }
    var flip = flipFor(meta.facing, c.facing), P = placement(meta, A.size, flip);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform4f(G.r, P.left / P.W * 2 - 1, 1 - P.top / P.H * 2, (P.left + P.width) / P.W * 2 - 1, 1 - (P.top + P.height) / P.H * 2);
    gl.uniform1f(G.f, flip ? 1 : 0);
    gl.uniform1f(G.e, 1 / meta.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
  // catpair 的 render 每隻貓呼叫一次。回傳 true＝這一格已用影片畫好（或這隻貓藏起來、不用畫）；false＝照舊畫精靈圖。
  function draw(name, c, el, size) {
    if (!active) return false;
    var A = actors[name];
    if (!A || !c) return false;
    drawing = true;
    try {
      // 沒有安全空位時貓會藏起來（c.hidden）：這隻貓的影片全部暫停、不計時、不畫。
      if (c.hidden) {
        apply(A, false); A.waitSince = 0;
        if (A.canvas.style.display !== 'none') A.canvas.style.display = 'none';
        return true;
      }
      var run = shouldRun(runState());
      resize(A, size);
      var cur = A.want, curVideo = cur && A.videos[cur];
      var ended = !!(curVideo && (curVideo.__ended || curVideo.ended));
      var want = nextClip(cur, clipFor(c.mode, c), ended);
      if (want !== A.want) { A.want = want; startClip(A, want); }
      // 每隻貓只有正在顯示（或即將顯示）的那段在播；預載的下一段暫停；其他釋放。
      apply(A, run);
      if (!active) return false;
      var v = A.videos[A.want];
      if (v.readyState >= 2 && A.shown !== A.want) { A.shown = A.want; A.lastT = -1; }
      // 4 秒內沒有第一格 → 改回精靈圖（只在真的在跑時計時；背景分頁不算）。
      if (run && v.readyState < 2) {
        if (!A.waitSince) A.waitSince = now();
        else if (now() - A.waitSince > FIRST_FRAME_MS) { fail('first-frame-timeout'); return false; }
      } else A.waitSince = 0;
      if (!A.shown) { if (A.canvas.style.display !== 'none') A.canvas.style.display = 'none'; return false; }
      if (!paint(A, c)) return false;
      if (A.canvas.style.display !== 'block') A.canvas.style.display = 'block';
      return true;
    } finally { drawing = false; }
  }
  // 迴圈停下來（背景、收起、暫停、看不到）時：所有影片暫停。
  function sleep() { Object.keys(actors).forEach(function (n) { var A = actors[n]; A.waitSince = 0; Object.keys(A.videos).forEach(function (k) { pauseSafe(A.videos[k]); }); }); }
  // 依狀態機重新挑片段（預覽頁切換動作用）：一次性片段從頭播；畫面先留在最後一格，不會閃回精靈圖。
  function reset() { Object.keys(actors).forEach(function (n) { actors[n].want = null; actors[n].waitSince = 0; }); }
  function teardown() {
    active = false; api.active = false;
    Object.keys(actors).forEach(function (n) {
      var A = actors[n];
      delete actors[n];
      Object.keys(A.videos).forEach(function (k) { retire(A.videos[k]); });
      A.videos = {};
      disposeGL(A.gl);
      if (A.canvas.parentNode) A.canvas.parentNode.removeChild(A.canvas);
    });
    if (pool && pool.parentNode) pool.parentNode.removeChild(pool);
    pool = null;
    revokeBlobs();
  }
  // 失敗：這個分頁之後都用精靈圖，並立刻重畫一次讓精靈圖接手。
  function fail(reason) {
    if (!active) return;
    failedReason = reason; api.reason = reason;
    storageSet('sessionStorage', FAIL_KEY, '1');
    teardown();
    if (!drawing && rt.render) rt.render();
  }
  function activate() {
    if (active) return true;
    var made = {};
    CATS.forEach(function (name) {
      var canvas = document.createElement('canvas');
      canvas.className = 'za-cat-video'; canvas.setAttribute('aria-hidden', 'true');
      var G = makeGL(canvas);
      if (G) made[name] = {canvas: canvas, gl: G};
    });
    var decision = shouldUseVideo(readEnv(made.white && made.tabby));
    api.decision = decision;
    // 不用影片（或只有一隻貓拿到 WebGL）：探測時建立的 context 立刻釋放。
    if (!decision.ok) { CATS.forEach(function (name) { if (made[name]) disposeGL(made[name].gl); }); return false; }
    pool = document.createElement('div'); pool.className = 'za-cat-video-pool'; pool.setAttribute('aria-hidden', 'true');
    document.body.appendChild(pool);
    active = true; api.active = true;
    CATS.forEach(function (name) {
      var A = actors[name] = {name: name, canvas: made[name].canvas, gl: made[name].gl, videos: {}, want: null, shown: null, prefetch: null, size: 0, lastT: -1, lastUpload: 0, waitSince: 0};
      // 自己 dispose（loseContext）後的事件不算失敗；只有目前這一組畫布真的遺失才退回。
      A.canvas.addEventListener('webglcontextlost', function (e) { if (e && e.preventDefault) e.preventDefault(); if (actors[name] === A && !A.gl.disposed) fail('context-lost'); });
      hostFor(name).appendChild(A.canvas);
    });
    // 一開始只準備 idle 與 walk（都不自動播放：第一次 draw 而且 shouldRun 時才由 playSafe 開始）；其他片段第一次用到才載。
    planLoads(MANIFEST).initial.forEach(function (p) { if (active) ensure(actors[p.cat], p.clip, p.preload); });
    if (active && rt.render) rt.render();
    return active;
  }
  rt.video = api;
  document.addEventListener('visibilitychange', function () { if (document.hidden) sleep(); });
  // 中途打開「減少動態效果」：暫停、釋放影片，交回不動的精靈圖；關掉時再試一次影片。
  function onMotion() {
    if (media.matches) { if (active) { teardown(); if (rt.render) rt.render(); } }
    else if (!active && !failedReason) activate();
  }
  if (media.addEventListener) media.addEventListener('change', onMotion); else if (media.addListener) media.addListener(onMotion);
  activate();
})();
