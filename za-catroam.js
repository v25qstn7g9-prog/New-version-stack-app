// Z∞ Assets 小白貓「到處走」（只管畫面：不呼叫 API、不碰儲存）。由 za-catphoto.js 在沒開「減少動態效果」時載入。
// 規則：
// - 只在「空白處」停下：休息點用畫面上真正的位置算（文字、數字、圖表、按鈕、輸入框、圖片都算禁區），走過內容時不停留。
// - 完全不碰底部分頁列和右下角的對話按鈕：活動範圍的下緣在它們上面，直線走路也不會穿過去。
// - 找不到空白處就回標題列空位；標題列也不在畫面上就先躲起來。
// - 心情：開心＝小跑、會彈跳；悠閒＝慢慢散步、在空白處打盹；難過＝走得少又慢、待在標題列附近。
// - 只用 CSS transform + requestAnimationFrame；版面位置只在捲動／縮放／畫面重畫時（有節流）重新量，每一幀不量版面；分頁切到背景就暫停。
(function () {
  var W = 48, RATIO = 503 / 400, H = Math.round(W * RATIO), GRID = 12, M = 4;
  var SPEED = { happy: 190, relaxed: 70, sad: 42 };
  var REST = { happy: [1.4, 3], relaxed: [4, 9], sad: [3, 6] };
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
  var core = { W: W, H: H, hit: hit, findSpots: findSpots, pick: pick, validSpot: validSpot, SPEED: SPEED };
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
  var st = { x: 0, y: 0, mode: "rest", t: 0, wait: 1, tx: 0, ty: 0, target: null, phase: 0, spot: null, hidden: false };
  core.state = st;
  function restFor(m) { var r = REST[m] || REST.relaxed; return r[0] + Math.random() * (r[1] - r[0]); }
  function go(urgent) {
    var mood = cat.mood || "relaxed", s = pick(L, st.spot ? { x: st.x, y: st.y } : null, mood);
    if (!s) { hideCat(true); return; }
    hideCat(false);
    st.target = s; st.mode = "walk"; st.t = 0; st.urgent = !!urgent;
    box.classList.remove("za-nap");
    if (Math.abs(s.x - st.x) > 2) box.classList.toggle("za-face-r", s.x > st.x);
  }
  function hideCat(h) { if (st.hidden === h) return; st.hidden = h; box.style.visibility = h ? "hidden" : ""; }
  function step(dt) {
    var mood = cat.mood || "relaxed";
    if (st.mode === "rest") {
      st.t += dt;
      if (st.spot && !validSpot(L, st.spot)) { go(true); return; }   // 捲動後腳下變成內容了：馬上走開
      if (st.t >= st.wait) go(false);
      return;
    }
    var dx = st.target.x - st.x, dy = st.target.y - st.y, d = Math.hypot(dx, dy);
    var v = (SPEED[mood] || 70) * (st.urgent ? 1.8 : 1);
    if (d <= v * dt || d < 1) {
      st.x = st.target.x; st.y = st.target.y; st.spot = st.target; st.mode = "rest"; st.t = 0; st.wait = restFor(mood);
      if (mood === "relaxed" && st.wait > 6) box.classList.add("za-nap");
      return;
    }
    st.x += dx / d * v * dt; st.y += dy / d * v * dt; st.phase += v * dt / 18;
  }
  core.step = step; core.go = go; core.measure = measure;
  function draw() {
    var bob = 0, mood = cat.mood || "relaxed";
    if (st.mode === "walk") bob = mood === "happy" ? -Math.abs(Math.sin(st.phase)) * 7 : -Math.abs(Math.sin(st.phase)) * 2;
    box.style.transform = "translate3d(" + st.x.toFixed(1) + "px," + (st.y + bob).toFixed(1) + "px,0)";
  }

  // ── 接手位置 ──
  box.classList.add("za-roaming");
  box.style.left = box.style.top = ""; box.style.width = W + "px"; box.style.height = H + "px"; box.style.display = "";
  if (box.parentNode !== document.body) document.body.appendChild(box);
  measure(); dirty = false; lastMeasure = performance.now();
  var start = L.home || pick(L, null, "relaxed");
  if (start) { st.x = start.x; st.y = start.y; st.spot = start; st.wait = 1.5; } else hideCat(true);
  cat.shown = true; cat.width = W;
  cat.roam = { refresh: markDirty, core: core };
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
