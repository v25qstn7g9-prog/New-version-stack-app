// Z∞ Assets 小白貓「到處走」（只管畫面：不呼叫 API、不碰儲存）。由 za-catphoto.js 在沒開「減少動態效果」時載入。
// 規則：
// - 只在「空白處」停下：休息點用畫面上真正的位置算（文字、數字、圖表、按鈕、輸入框、圖片都算禁區），走過內容時不停留。
// - 完全不碰底部分頁列和右下角的對話按鈕：活動範圍的下緣在它們上面，直線走路也不會穿過去。
// - 找不到空白處就回標題列空位；標題列也不在畫面上就先躲起來。
// - 自然的作息（狀態機 plan()）：睡覺 40–90 秒、坐著／理毛 10–25 秒，起身後慢慢走（起步、停下都有緩衝），
//   腳步影格依走過的距離前進（不滑步）、面向前進方向；偶爾小跑一段、或跳到高低不同的休息點（真的跳躍影格＋拋物線）。
// - 心情：開心＝比較常跑跟跳；悠閒＝慢慢散步、常睡；難過＝走得少又慢、多半趴著、待在標題列附近、不跑不跳。
// - 點牠：停下來、原地跳一下（睡著會被叫醒、坐起來）。
// - 只用 CSS transform + requestAnimationFrame；版面位置只在捲動／縮放／畫面重畫時（有節流）重新量，每一幀不量版面；分頁切到背景就暫停。
(function () {
  var RATIO = 160 / 128, GRID = 12, M = 4;
  // 手機上約 60–76px 寬（貓本身約 55–65px）；寬螢幕不再變大
  function sizeFor(vw) { return Math.max(60, Math.min(76, Math.round((vw || 390) * 0.17))); }
  var W = sizeFor(typeof window !== "undefined" && window.innerWidth), H = Math.round(W * RATIO);
  // 走路速度（px/秒，最快時）；跑步只在不難過時偶爾出現
  var SPEED = { happy: 52, relaxed: 40, sad: 28 }, RUN = 150;
  // 一個走路循環（18 格）前進的距離＝貓寬的倍數：影格跟距離綁在一起，腳不會滑
  var STRIDE = 0.8, RUN_STRIDE = 1.9, WALK_FRAMES = 18;
  var DUR = { sleep: [40, 90], sit: [10, 25], groom: [10, 25] };
  // 休息時做什麼的機率（sleep / sit / groom）
  var REST_MIX = { happy: [0.25, 0.5, 0.25], relaxed: [0.45, 0.3, 0.25], sad: [0.65, 0.35, 0] };
  var RUN_P = { happy: 0.45, relaxed: 0.15, sad: 0 }, JUMP_P = { happy: 0.7, relaxed: 0.5, sad: 0 };
  var JUMP = { crouch: 0.28, air: 0.5, land: 0.3, maxD: 200, minDy: 36 };
  var ACCEL = 0.7, BRAKE = 0.9;   // 起步加速、停下減速各大約幾秒
  var SAD_NEAR = 220;

  // ── 純計算（測試直接呼叫） ──
  function hit(a, b, m) { m = m || 0; return a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y; }
  // 在活動範圍裡用格點找出所有不碰到禁區的休息點（左上角座標）
  function findSpots(L) {
    var out = [], x, y, i, r, ok;
    for (y = L.top; y + H <= L.floor; y += GRID) for (x = M; x + W <= L.vw - M; x += GRID) {
      r = { x: x, y: y, w: W, h: H }; ok = true;
      for (i = 0; i < L.protect.length; i++) if (hit(r, L.protect[i], M)) { ok = false; break; }
      if (ok) for (i = 0; i < L.forbid.length; i++) if (hit(r, L.forbid[i], M)) { ok = false; break; }
      if (ok) out.push({ x: x, y: y });
    }
    return out;
  }
  function pick(L, cur, mood, rnd) {
    rnd = rnd || Math.random;
    var spots = findSpots(L), home = L.home;
    if (mood === "sad" && home) spots = spots.filter(function (s) { return Math.hypot(s.x - home.x, s.y - home.y) <= SAD_NEAR; });
    if (cur && mood !== "happy") {                                       // 悠閒／難過：不跑太遠
      var near = spots.filter(function (s) { var d = Math.hypot(s.x - cur.x, s.y - cur.y); return d > 30 && d < (mood === "sad" ? 120 : 260); });
      if (near.length) spots = near;
    }
    var homeOk = home && validSpot(L, home);
    if (homeOk && (!spots.length || rnd() < (mood === "sad" ? 0.45 : 0.12))) return { x: home.x, y: home.y, home: true };
    if (!spots.length) return null;
    var s = spots[Math.floor(rnd() * spots.length) % spots.length];
    return { x: s.x, y: s.y };
  }
  // 休息點還是空的嗎？（標題列空位是特例：本來就算好在標題與按鈕之間）
  function validSpot(L, s) {
    if (s.y < 0 || s.x < 0 || s.x + W > L.vw || s.y + H > L.floor) return false;
    var r = { x: s.x, y: s.y, w: W, h: H }, i;
    for (i = 0; i < L.forbid.length; i++) if (hit(r, L.forbid[i], 0)) return false;
    if (s.home) return true;
    for (i = 0; i < L.protect.length; i++) if (hit(r, L.protect[i], 0)) return false;
    return true;
  }
  // ── 作息狀態機（純計算） ──
  function rand(r, rnd) { return r[0] + (rnd || Math.random)() * (r[1] - r[0]); }
  // 休息：要做什麼、做多久
  function planRest(mood, rnd) {
    rnd = rnd || Math.random;
    var mix = REST_MIX[mood] || REST_MIX.relaxed, u = rnd(), kind = u < mix[0] ? "sleep" : u < mix[0] + mix[1] ? "sit" : "groom";
    return { mode: kind, wait: rand(DUR[kind], rnd) };
  }
  // 移動：走、跑、還是跳（dx, dy 是到目的地的距離）
  function planTravel(mood, dx, dy, urgent, rnd) {
    rnd = rnd || Math.random;
    var d = Math.hypot(dx, dy);
    if (mood !== "sad" && Math.abs(dy) >= JUMP.minDy && d <= JUMP.maxD && rnd() < (JUMP_P[mood] || 0)) return "jump";
    if (urgent || (d > 160 && rnd() < (RUN_P[mood] || 0))) return "run";
    return "walk";
  }
  // 緩起步、緩停：已走時間 t、剩下距離 left、最高速 vmax → 這一刻速度
  function easedSpeed(vmax, t, left) {
    var up = Math.min(1, t / ACCEL), down = Math.min(1, left / Math.max(1, vmax * BRAKE * 0.5));
    up = up * up * (3 - 2 * up);
    return Math.max(vmax * 0.12, vmax * Math.min(up, Math.sqrt(down)));
  }
  // 腳步：走 dist 像素前進幾格
  function framesFor(dist, w, run) { return dist / (w * (run ? RUN_STRIDE : STRIDE)) * WALK_FRAMES; }
  // 跳：0..1 進度 → 位移比例、離地高度比例、影格（6 格：蹲 0-1、起跳 2、空中 3、落地 4-5）
  function jumpAt(t) {
    var T = JUMP.crouch + JUMP.air + JUMP.land;
    if (t < JUMP.crouch) return { p: 0, lift: 0, frame: t < JUMP.crouch / 2 ? 0 : 1, done: false };
    if (t < JUMP.crouch + JUMP.air) { var q = (t - JUMP.crouch) / JUMP.air; return { p: q * q * (3 - 2 * q), lift: 4 * q * (1 - q), frame: q < 0.3 ? 2 : 3, done: false }; }
    return { p: 1, lift: 0, frame: t < T - JUMP.land / 2 ? 4 : 5, done: t >= T };
  }
  var core = { W: W, H: H, sizeFor: sizeFor, hit: hit, findSpots: findSpots, pick: pick, validSpot: validSpot, SPEED: SPEED, RUN: RUN, DUR: DUR, JUMP: JUMP,
    planRest: planRest, planTravel: planTravel, easedSpeed: easedSpeed, framesFor: framesFor, jumpAt: jumpAt };
  window.__zaCatRoamCore = core;

  var cat = window.__zaPhotoCat;
  if (!cat || !cat.box || typeof document === "undefined" || !document.body || !document.body.getBoundingClientRect) return;
  var box = cat.box, face = cat.face;

  var css = document.createElement("style");
  css.textContent =
    "html .za-photocat.za-roaming.za-roaming{position:fixed;left:0;top:0;z-index:20;animation:none;will-change:transform}" +
    ".za-roaming .za-pc-face{transition:transform .18s ease}.za-roaming.za-face-r .za-pc-face{transform:scaleX(-1)}" +
    ".za-roaming.za-nap img{animation-duration:6.5s!important;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28)) brightness(.96)}" +
    "@media (prefers-reduced-motion:reduce){.za-roaming .za-pc-face{transition:none}}";
  document.head.appendChild(css);

  // ── 量版面（有節流，不是每一幀） ──
  var PROTECT_SEL = "svg,canvas,img,input,select,textarea,button,a,[role=button],.recharts-wrapper,video,iframe";
  var L = null;
  function rectOf(r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function measure() {
    var vw = window.innerWidth, vh = window.innerHeight, protect = [], forbid = [];
    W = core.W = sizeFor(vw); H = core.H = Math.round(W * RATIO);
    box.style.width = W + "px"; box.style.height = H + "px"; cat.width = W;
    var tab = document.querySelector(".premium-tabbar"), chat = document.querySelector(".premium-ai-launcher");
    var floor = vh;
    [tab, chat].forEach(function (el) {
      if (!el) return; var r = el.getBoundingClientRect(); if (!r.width) return;
      forbid.push(rectOf(r)); floor = Math.min(floor, r.top - M);
    });
    var tw = document.createTreeWalker(document.body, 4 /* 文字 */), n, rg = document.createRange(), rs, i, q;
    while ((n = tw.nextNode())) {
      if (!n.nodeValue || !/\S/.test(n.nodeValue) || box.contains(n)) continue;
      var pe = n.parentElement; if (!pe || pe.closest("script,style")) continue;
      rg.selectNodeContents(n); rs = rg.getClientRects();
      for (i = 0; i < rs.length; i++) { q = rs[i]; if (q.width && q.bottom > 0 && q.top < vh) protect.push(rectOf(q)); }
    }
    var els = document.querySelectorAll(PROTECT_SEL);
    for (i = 0; i < els.length; i++) {
      if (box.contains(els[i])) continue;
      q = els[i].getBoundingClientRect(); if (q.width && q.height && q.bottom > 0 && q.top < vh && q.right > 0 && q.left < vw) protect.push(rectOf(q));
    }
    var hg = cat.headerGap && cat.headerGap(W);
    var top = Math.max(0, hg ? hg.y : 0);
    L = { vw: vw, vh: vh, top: top, floor: floor, protect: protect, forbid: forbid, home: hg ? { x: hg.x, y: hg.y, home: true } : null };
    core.last = L;
    return L;
  }
  var dirty = true, lastMeasure = 0;
  function markDirty() { dirty = true; }

  // ── 走路狀態 ──
  var st = { x: 0, y: 0, mode: "sit", t: 0, wait: 1, target: null, from: null, phase: 0, frame: null, spot: null, hidden: false, lift: 0, hop: 0, pause: 0 };
  core.state = st;
  function setNap(on) { if (on) box.classList.add("za-nap"); else box.classList.remove("za-nap"); }
  function isRest(m) { return m === "sit" || m === "groom" || m === "sleep"; }
  core.isRest = isRest;
  function go(urgent) {
    var mood = cat.mood || "relaxed", s = pick(L, st.spot ? { x: st.x, y: st.y } : null, mood);
    if (!s) { hideCat(true); return; }
    hideCat(false);
    st.target = s; st.from = { x: st.x, y: st.y }; st.t = 0; st.urgent = !!urgent; st.frame = 0;
    st.mode = planTravel(mood, s.x - st.x, s.y - st.y, urgent);
    setNap(false);
    if (Math.abs(s.x - st.x) > 2) box.classList.toggle("za-face-r", s.x > st.x);   // 面向前進方向（影格本來朝左）
  }
  function arrive() {
    var r = planRest(cat.mood || "relaxed");
    st.x = st.target.x; st.y = st.target.y; st.spot = st.target; st.lift = 0; st.frame = null;
    st.mode = r.mode; st.wait = r.wait; st.t = 0;
    setNap(r.mode === "sleep");
  }
  function hideCat(h) { if (st.hidden === h) return; st.hidden = h; box.style.visibility = h ? "hidden" : ""; }
  function step(dt) {
    var mood = cat.mood || "relaxed";
    if (st.hop > 0) st.hop = Math.max(0, st.hop - dt);
    if (st.pause > 0) { st.pause = Math.max(0, st.pause - dt); return; }     // 被點了：停一下
    if (isRest(st.mode)) {
      st.t += dt;
      if (st.spot && !validSpot(L, st.spot)) { go(true); return; }   // 捲動後腳下變成內容了：馬上走開
      if (st.t >= st.wait) go(false);
      return;
    }
    st.t += dt;
    if (st.mode === "jump") {
      var j = jumpAt(st.t);
      st.x = st.from.x + (st.target.x - st.from.x) * j.p; st.y = st.from.y + (st.target.y - st.from.y) * j.p;
      st.lift = j.lift * (24 + Math.abs(st.target.y - st.from.y) * 0.35); st.frame = j.frame;
      if (j.done) arrive();
      return;
    }
    var dx = st.target.x - st.x, dy = st.target.y - st.y, d = Math.hypot(dx, dy), run = st.mode === "run";
    var v = easedSpeed(run ? RUN : (SPEED[mood] || 40), st.t, d), mv = v * dt;
    if (d <= mv || d < 1) { arrive(); return; }
    st.x += dx / d * mv; st.y += dy / d * mv;
    st.frame += framesFor(mv, W, run); st.phase += mv / 18;
  }
  // 點牠：停一下、原地跳一下；睡覺中被叫醒就改成坐著
  function react(k) {
    st.hop = 0.45; st.pause = isRest(st.mode) ? 0 : 1.2;
    if (st.mode === "sleep") { st.mode = "sit"; st.t = 0; st.wait = rand(DUR.sit); setNap(false); }
    return k;
  }
  core.step = step; core.go = go; core.measure = measure; core.react = react;
  function draw() {
    var bob = 0, mood = cat.mood || "relaxed";
    if (st.mode === "walk" && !st.pause) bob = -Math.abs(Math.sin(st.phase)) * (mood === "happy" ? 1.6 : 1);
    if (st.mode === "run" && !st.pause) bob = -Math.abs(Math.sin(st.phase * 0.6)) * 4;
    if (st.hop > 0) { var q = 1 - st.hop / 0.45; bob -= Math.sin(Math.PI * q) * 16; }
    box.style.transform = "translate3d(" + st.x.toFixed(1) + "px," + (st.y - st.lift + bob).toFixed(1) + "px,0)";
  }

  // ── 接手位置 ──
  box.classList.add("za-roaming");
  box.style.left = box.style.top = ""; box.style.display = "";
  if (box.parentNode !== document.body) document.body.appendChild(box);
  measure(); dirty = false; lastMeasure = performance.now();
  var start = L.home || pick(L, null, "relaxed");
  if (start) { st.x = start.x; st.y = start.y; st.spot = start; st.mode = "sit"; st.wait = 3; } else hideCat(true);
  cat.shown = true; cat.width = W;
  cat.roam = { refresh: markDirty, core: core, react: react };
  draw();

  var raf = 0, lastT = 0;
  function frame(ts) {
    raf = 0;
    if (document.hidden) return;                                   // 背景分頁：停
    if (dirty && ts - lastMeasure > 250) { measure(); dirty = false; lastMeasure = ts; }
    var dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016; lastT = ts;
    step(dt); draw();
    raf = requestAnimationFrame(frame);
  }
  function resume(remeasure) { if (!raf && !document.hidden) { lastT = 0; if (remeasure) dirty = true; raf = requestAnimationFrame(frame); } }
  document.addEventListener("visibilitychange", function () { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else resume(true); });
  window.addEventListener("scroll", markDirty, { passive: true, capture: true });
  window.addEventListener("resize", markDirty);
  core.isRunning = function () { return !!raf; };
  resume(false);
})();
