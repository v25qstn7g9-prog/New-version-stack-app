// Z∞ Assets 小白貓「到處走」（只管畫面：不呼叫 API、不碰儲存）。由 za-catphoto.js 在沒開「減少動態效果」時載入。
// 規則：
// - 只在「空白處」停下：休息點用畫面上真正的位置算（文字、數字、圖表、按鈕、輸入框、圖片都算禁區），走過內容時不停留。
// - 完全不碰底部分頁列和右下角的對話按鈕：活動範圍的下緣在它們上面，直線走路也不會穿過去。
// - 找不到空白處就回標題列空位；標題列也不在畫面上就先躲起來。
// - 自然的作息（狀態機 plan()）：睡覺 40–90 秒、坐著／理毛 10–25 秒，起身後慢慢走（起步、停下都有緩衝），
//   腳步影格依走過的距離前進（不滑步）、面向前進方向；偶爾小跑一段、或跳到高低不同的休息點（真的跳躍影格＋拋物線）。
// - 心情：開心＝比較常跑跟跳；悠閒＝慢慢散步、常睡；難過＝走得少又慢、多半趴著、待在標題列附近、不跑不跳。
// - 不會瞬間換姿勢：站→坐（真的「站起來」影格倒著播）→ 低頭趴下（真的影格）→ 淡入睡覺；
//   醒來：抬頭（倒著播）→ 伸懶腰（合成：拉長壓扁）→ 站起來（真的影格）→ 才開始走。
// - 轉身：先減速停下，原地用約 0.4 秒把身體「壓扁再翻過去」，不會走路中瞬間鏡像。
// - v3：範圍＝整個可見畫面（position:fixed，捲動後重新量）；目的地用加權隨機，偏好邊緣／角落
//   （卡片邊緣、標題列下緣、畫面四邊），並有「空間記憶」：最近去過的格子權重大降，不會一直回同一處。
// - v3 行為（加權隨機、沒有固定循環）：多半原地休息（睡／發呆／理毛／盯著某處），偶爾巡邏到新地點（可能連走幾段），
//   偶爾突然暴衝（zoomies：連跑幾段），偶爾跳上卡片邊緣；理毛、盯著看沒有專屬影格，用既有影格＋小幅 CSS 動作。
// - 點牠：停下來、原地跳一下（睡著會被叫醒、慢慢坐起來）。
// - 只用 CSS transform + requestAnimationFrame；版面位置只在捲動／縮放／畫面重畫時（有節流）重新量，每一幀不量版面；分頁切到背景就暫停。
(function () {
  var RATIO = 160 / 128, GRID = 12, M = 4;
  // 手機上約 60–76px 寬（貓本身約 55–65px）；寬螢幕不再變大
  function sizeFor(vw) { return Math.max(60, Math.min(76, Math.round((vw || 390) * 0.17))); }
  var W = sizeFor(typeof window !== "undefined" && window.innerWidth), H = Math.round(W * RATIO);
  // 走路速度（px/秒，最快時）；跑步只在不難過時偶爾出現
  var SPEED = { happy: 52, relaxed: 40, sad: 28 }, RUN = 150;
  // 一個走路循環前進的距離＝貓寬的倍數：影格跟距離綁在一起，腳不會滑
  // v4：走路影格 12→14（接縫補了兩格光流過渡），每格前進距離不變，所以一個循環的步幅跟著放大 14/12
  var WALK_FRAMES = 14, STRIDE = 0.8 * WALK_FRAMES / 12, RUN_STRIDE = 1.9 * WALK_FRAMES / 12;
  var DUR = { sleep: [40, 90], sit: [10, 25], groom: [10, 25], stare: [10, 25] };
  // 休息時做什麼的機率（sleep / sit 發呆 / groom 理毛 / stare 盯著某處）
  var REST_MIX = { happy: [0.25, 0.35, 0.2, 0.2], relaxed: [0.45, 0.25, 0.15, 0.15], sad: [0.65, 0.3, 0, 0.05] }, REST_K = ["sleep", "sit", "groom", "stare"];
  var RUN_P = { happy: 0.45, relaxed: 0.15, sad: 0 }, JUMP_P = { happy: 0.7, relaxed: 0.5, sad: 0 };
  var JUMP = { crouch: 0.28, air: 0.5, land: 0.3, maxD: 200, minDy: 36 };
  var ACCEL = 0.7, BRAKE = 0.9;
  // 姿勢轉換（秒）。rise/settle 是影片裡真的影格；stretch 是合成的（沒有伸懶腰的影片）
  var TRANS = { rise: 0.85, settle: 1.25, stretch: 1.1, fade: 0.35 }, TURN = 0.42;   // 起步加速、停下減速各大約幾秒
  var SAD_NEAR = 220;
  // v3：醒來後做什麼（stay 原地換姿勢／patrol 巡邏／zoom 暴衝／jump 跳上卡片邊）
  var BEHAVE = { happy: [0.30, 0.35, 0.15, 0.20], relaxed: [0.46, 0.36, 0.07, 0.11], sad: [0.68, 0.32, 0, 0] }, BEHAVE_K = ["stay", "patrol", "zoom", "jump"];
  var CELL = 48, MEM_N = 10, MEM_PEN = 0.18, EDGE_NEAR = 14;

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
  // 格子（給空間記憶與統計用）：以貓腳下中心點算
  function cellOf(s) { return Math.floor((s.x + W / 2) / CELL) + "," + Math.floor((s.y + H) / CELL); }
  // 邊緣分數：靠畫面左右邊、活動範圍上下緣、卡片（含標題列）四邊；角落（兩種以上邊）再加成。0＝不是邊緣
  function edgeScore(L, s) {
    var n = 0, i, c, b = s.y + H, r = s.x + W, E = EDGE_NEAR + GRID;
    if (s.x <= M + E || r >= L.vw - M - E) n++;
    if (s.y <= L.top + E || b >= L.floor - E) n++;
    var cards = L.cards || [];
    for (i = 0; i < cards.length; i++) {
      c = cards[i];
      var hx = s.x < c.x + c.w && r > c.x, vy = s.y < c.y + c.h && b > c.y;
      if (hx && (Math.abs(b - c.y) <= E || Math.abs(b - (c.y + c.h)) <= E)) { n++; break; }
      if (vy && (Math.abs(r - c.x) <= E || Math.abs(s.x - (c.x + c.w)) <= E)) { n++; break; }
    }
    return n;
  }
  // 記憶懲罰：最近去過的格子（越近期罰越重；相鄰格子輕罰）
  function memPenalty(mem, s) {
    if (!mem || !mem.length) return 1;
    var k = cellOf(s).split(","), cx = +k[0], cy = +k[1], w = 1, i;
    for (i = 0; i < mem.length; i++) {
      var m = mem[i].split(","), dx = Math.abs(+m[0] - cx), dy = Math.abs(+m[1] - cy);
      if (!dx && !dy) w *= MEM_PEN; else if (dx <= 1 && dy <= 1) w *= 0.6;
    }
    return w;
  }
  function spotWeight(L, s, cur, mood, mem) {
    var e = edgeScore(L, s), w = e ? 1 + 2.2 * e * e : 0.35;
    w *= memPenalty(mem, s);
    if (cur && mood !== "happy") w /= 1 + Math.hypot(s.x - cur.x, s.y - cur.y) / (mood === "sad" ? 120 : 420);
    return w;
  }
  function wpick(list, ws, rnd) {
    var t = 0, i; for (i = 0; i < ws.length; i++) t += ws[i];
    if (!(t > 0)) return list[Math.floor(rnd() * list.length) % list.length];
    var u = rnd() * t; for (i = 0; i < ws.length; i++) { u -= ws[i]; if (u <= 0) return list[i]; }
    return list[list.length - 1];
  }
  // opts.jump：只挑跳得到（高低差夠、距離不遠）的點；opts.far：暴衝時偏好遠一點
  function pick(L, cur, mood, rnd, mem, opts) {
    rnd = rnd || Math.random; opts = opts || {};
    var spots = findSpots(L), home = L.home;
    if (mood === "sad" && home) spots = spots.filter(function (s) { return Math.hypot(s.x - home.x, s.y - home.y) <= SAD_NEAR; });
    if (cur) { var cc = cellOf(cur);                                     // 不原地（也不在同一格）；難過：不跑太遠（其他心情改用權重，範圍＝整個畫面）
      var near = spots.filter(function (s) { var d = Math.hypot(s.x - cur.x, s.y - cur.y); return d > 30 && cellOf(s) !== cc && (mood !== "sad" || d < 120); });
      if (near.length) spots = near;
      if (opts.jump) { var js = spots.filter(function (s) { var dy = Math.abs(s.y - cur.y); return dy >= JUMP.minDy && Math.hypot(s.x - cur.x, s.y - cur.y) <= JUMP.maxD; }); if (!js.length) return null; spots = js; }
    }
    var homeOk = home && validSpot(L, home);
    if (homeOk && !opts.jump && (!spots.length || rnd() < (mood === "sad" ? 0.45 : 0.12) * memPenalty(mem, home))) return { x: home.x, y: home.y, home: true };
    if (!spots.length) return null;
    var ws = spots.map(function (s) { var w = spotWeight(L, s, cur, mood, mem); if (opts.far && cur) w *= 1 + Math.hypot(s.x - cur.x, s.y - cur.y) / 150; return w; });
    var s = wpick(spots, ws, rnd);
    return { x: s.x, y: s.y, edge: edgeScore(L, s) > 0 };
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
    var mix = REST_MIX[mood] || REST_MIX.relaxed, kind = wpick(REST_K, mix, rnd);
    return { mode: kind, wait: rand(DUR[kind], rnd) };
  }
  // 醒來後要做什麼（加權隨機，不是固定循環）
  function planNext(mood, rnd) { return wpick(BEHAVE_K, BEHAVE[mood] || BEHAVE.relaxed, rnd || Math.random); }
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
    down = 1 - (1 - down) * (1 - down);                              // v4：停下改成 ease-out（越接近越慢，不會一下煞住）
    return Math.max(vmax * 0.06, vmax * Math.min(up, down));
  }
  // v4 真實感（全部是整張圖的 transform：平面雪碧圖沒辦法單獨動尾巴，所以用身體微擺代替）
  // 落地：0..1 進度 → 壓扁再回彈（sx 變寬、sy 變矮，最後小小回彈一次）
  var LAND = 0.38, SETTLE = 0.7;
  function landAt(q) {
    q = Math.max(0, Math.min(1, q)); if (q >= 1) return { sx: 1, sy: 1 };
    var k = Math.exp(-4 * q) * Math.cos(Math.PI * 1.5 * q) * (1 - q);
    return { sx: 1 + 0.09 * k, sy: 1 - 0.13 * k };
  }
  // 停下／轉身後：身體前後微微晃一下再定住（衰減振盪，度）
  function settleAt(t, amp) {
    if (!(t >= 0) || t >= SETTLE) return 0;
    return amp * Math.exp(-5 * t / SETTLE) * Math.sin(2 * Math.PI * 1.6 * t / SETTLE + 0.4) * (1 - t / SETTLE);
  }
  // 走路時身體跟著步伐微微左右擺（±0.9 度，一個循環一次）：代替尾巴擺動
  function swayFor(frame, amp) { return Math.sin(frame / WALK_FRAMES * 2 * Math.PI) * amp; }
  // 腳步：走 dist 像素前進幾格
  function framesFor(dist, w, run) { return dist / (w * (run ? RUN_STRIDE : STRIDE)) * WALK_FRAMES; }
  // 跳：0..1 進度 → 位移比例、離地高度比例、影格（6 格：蹲 0-1、起跳 2、空中 3、落地 4-5）
  function jumpAt(t) {
    var T = JUMP.crouch + JUMP.air + JUMP.land;
    if (t < JUMP.crouch) return { p: 0, lift: 0, frame: t < JUMP.crouch / 2 ? 0 : 1, done: false };
    if (t < JUMP.crouch + JUMP.air) { var q = (t - JUMP.crouch) / JUMP.air; return { p: q * q * (3 - 2 * q), lift: 4 * q * (1 - q), frame: q < 0.3 ? 2 : 3, done: false }; }
    return { p: 1, lift: 0, frame: t < T - JUMP.land / 2 ? 4 : 5, done: t >= T };
  }
  // 從一個姿勢到另一個：回傳要依序播的步驟 [{clip, dur, rev, synth}]
  function transition(from, to) {
    var out = [];
    var stand = function (m) { return m === "walk" || m === "run" || m === "jump" || m === "turn" || m === "stand"; };
    if (from === "sleep") { out.push({ clip: "settle", dur: TRANS.settle, rev: true }); out.push({ clip: "stretch", dur: TRANS.stretch, synth: true }); from = "sit"; }
    if (stand(from) && !stand(to)) { out.push({ clip: "rise", dur: TRANS.rise, rev: true }); from = "sit"; }
    if (!stand(from) && stand(to)) out.push({ clip: "rise", dur: TRANS.rise });
    if (from !== "sleep" && to === "sleep") { out.push({ clip: "settle", dur: TRANS.settle }); out.push({ clip: "loaf", dur: TRANS.fade, fade: true }); }
    return out;
  }
  // 轉身：0..1 進度 → 水平縮放（+1 朝左 → -1 朝右）與壓扁
  function turnAt(q, fromS, toS) {
    q = Math.max(0, Math.min(1, q)); var e = q * q * (3 - 2 * q), sx = fromS + (toS - fromS) * e;
    if (Math.abs(sx) < 0.18) sx = sx < 0 || (sx === 0 && toS < 0) ? -0.18 : 0.18;
    return { sx: sx, sy: 1 - 0.07 * Math.sin(Math.PI * q) };
  }
  // 走路上下起伏跟著影格（一個循環兩次，前後腳各一次），振幅很小
  function bobFor(frame, amp) { return -Math.abs(Math.sin(frame / WALK_FRAMES * 2 * Math.PI)) * amp; }
  var core = { W: W, STRIDE: STRIDE, LAND: LAND, SETTLE: SETTLE, landAt: landAt, settleAt: settleAt, swayFor: swayFor, TRANS: TRANS, TURN: TURN, transition: transition, turnAt: turnAt, bobFor: bobFor, WALK_FRAMES: WALK_FRAMES, H: H, sizeFor: sizeFor, hit: hit, findSpots: findSpots, pick: pick, validSpot: validSpot, SPEED: SPEED, RUN: RUN, DUR: DUR, JUMP: JUMP,
    planRest: planRest, planNext: planNext, edgeScore: edgeScore, cellOf: cellOf, memPenalty: memPenalty, spotWeight: spotWeight, CELL: CELL, MEM_N: MEM_N, BEHAVE: BEHAVE, REST_MIX: REST_MIX, planTravel: planTravel, easedSpeed: easedSpeed, framesFor: framesFor, jumpAt: jumpAt };
  window.__zaCatRoamCore = core;

  var cat = window.__zaPhotoCat;
  if (!cat || !cat.box || typeof document === "undefined" || !document.body || !document.body.getBoundingClientRect) return;
  var box = cat.box, face = cat.face;

  var css = document.createElement("style");
  css.textContent =
    "html .za-photocat.za-roaming.za-roaming{position:fixed;left:0;top:0;z-index:20;animation:none;will-change:transform}" +
    ".za-roaming .za-pc-face{transform-origin:50% 100%}" +
    ".za-roaming.za-nap img{animation-duration:6.5s!important;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28)) brightness(.96)}" +
    "@media (prefers-reduced-motion:reduce){.za-roaming .za-pc-face{transition:none}}";
  document.head.appendChild(css);

  // ── 量版面（有節流，不是每一幀） ──
  var PROTECT_SEL = "svg,canvas,img,input,select,textarea,button,a,[role=button],.recharts-wrapper,video,iframe";
  var CARD_SEL = ".premium-header,[class*=rounded-xl],[class*=rounded-2xl],[class*=rounded-3xl]";   // 卡片（只用來找邊緣，不是禁區）
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
    var els = document.querySelectorAll(PROTECT_SEL + "," + CARD_SEL), cards = [], el, isCard;   // 一次查詢：禁區＋卡片
    for (i = 0; i < els.length; i++) {
      el = els[i]; if (box.contains(el)) continue;
      isCard = !!(el.matches && el.matches(CARD_SEL) && !el.matches(PROTECT_SEL));
      q = el.getBoundingClientRect(); if (!(q.width && q.height && q.bottom > 0 && q.top < vh && q.right > 0 && q.left < vw)) continue;
      if (isCard) { if (q.width >= 120 && q.height >= 32) cards.push(rectOf(q)); } else protect.push(rectOf(q));
    }
    var hg = cat.headerGap && cat.headerGap(W);
    var top = Math.max(0, hg ? hg.y : 0);
    L = { vw: vw, vh: vh, top: top, floor: floor, protect: protect, forbid: forbid, cards: cards, home: hg ? { x: hg.x, y: hg.y, home: true } : null };
    core.last = L;
    return L;
  }
  var dirty = true, lastMeasure = 0;
  function markDirty() { dirty = true; }

  // ── 走路狀態 ──
  // faceS：+1 朝左（影格原本的方向）、-1 朝右；clip/clipP/clipRev：姿勢轉換時播哪段、播到哪
  var st = { x: 0, y: 0, mode: "sit", t: 0, wait: 1, target: null, from: null, phase: 0, frame: null, spot: null, hidden: false, lift: 0, hop: 0, pause: 0,
    faceS: 1, sy: 1, sx2: 1, land: -1, settle: -1, settleAmp: 0, seq: [], after: null, clip: null, clipP: 0, clipRev: false, turnFrom: 1, turnTo: 1 };
  core.state = st;
  function setNap(on) { if (on) box.classList.add("za-nap"); else box.classList.remove("za-nap"); }
  function isRest(m) { return m === "sit" || m === "groom" || m === "sleep" || m === "stare"; }
  var mem = []; core.memory = mem;
  function remember(s) { mem.push(cellOf(s)); while (mem.length > MEM_N) mem.shift(); }
  core.isRest = isRest;
  // 依序播轉換步驟，播完進入 after（"travel" 或休息狀態）
  function runSeq(steps, after) {
    st.seq = steps.slice(); st.after = after; st.t = 0;
    if (!st.seq.length) { finishSeq(); return; }
    st.mode = "trans"; st.clip = st.seq[0].clip; st.clipRev = !!st.seq[0].rev; st.clipP = 0;
  }
  function finishSeq() {
    var a = st.after; st.after = null; st.clip = null; st.sx2 = 1; st.sy = 1; st.t = 0;
    if (a === "travel") startTravel();
    else if (a) { st.mode = a.mode; st.wait = a.wait; setNap(a.mode === "sleep"); }
  }
  function go(urgent) {
    var mood = cat.mood || "relaxed", cur = st.spot ? { x: st.x, y: st.y } : null, b = urgent ? "patrol" : planNext(mood), s = null;
    if (b === "stay" && st.spot) { stay(mood); return; }
    if (b === "jump" && cur) s = pick(L, cur, mood, null, mem, { jump: true });
    if (!s) { if (b === "jump") b = "patrol"; s = pick(L, cur, mood, null, mem, { far: b === "zoom" }); }
    if (!s) { hideCat(true); return; }
    st.behave = b; st.chain = b === "zoom" ? 1 + Math.floor(Math.random() * 3) : b === "patrol" && Math.random() < 0.3 ? 1 : 0;
    st.forceTravel = b === "zoom" ? "run" : b === "jump" ? "jump" : null;
    hideCat(false);
    st.target = s; st.urgent = !!urgent;
    setNap(false);
    if (urgent) { startTravel(); return; }                         // 腳下變成內容：直接走開
    runSeq(transition(st.mode, "stand"), "travel");
  }
  // 原地換個休息姿勢（一定跟現在不同；有時先伸個懶腰）
  function stay(mood) {
    var r = planRest(mood), n = 0;
    while (r.mode === st.mode && n++ < 8) r = planRest(mood);
    if (r.mode === st.mode) r = { mode: st.mode === "sit" ? "stare" : "sit", wait: rand(DUR.sit) };
    var seq = transition(st.mode, r.mode);
    if (st.mode !== "sleep" && r.mode !== "sleep" && Math.random() < 0.35) seq.unshift({ clip: "stretch", dur: TRANS.stretch, synth: true });
    setNap(false); st.behave = "stay";
    runSeq(seq, { mode: r.mode, wait: r.wait });
  }
  function startTravel() {
    var s = st.target, mood = cat.mood || "relaxed";
    st.from = { x: st.x, y: st.y }; st.t = 0; st.frame = 0; st.clip = null;
    st.travel = st.forceTravel || planTravel(mood, s.x - st.x, s.y - st.y, st.urgent);
    var want = Math.abs(s.x - st.x) > 2 ? (s.x > st.x ? -1 : 1) : st.faceS;
    if (Math.abs(s.x - st.x) > 2) box.classList.toggle("za-face-r", s.x > st.x);   // 面向前進方向
    if (want !== (st.faceS > 0 ? 1 : -1) && !st.urgent) { st.mode = "turn"; st.turnFrom = st.faceS; st.turnTo = want; return; }
    st.faceS = want; st.mode = st.travel;
  }
  function arrive() {
    var r = planRest(cat.mood || "relaxed");
    if (st.mode === "jump") st.land = 0;                             // 落地：壓扁回彈
    if (st.mode === "walk" || st.mode === "run" || st.mode === "jump") { st.settle = 0; st.settleAmp = st.mode === "walk" ? -1.6 : -3; }  // 停下：往前晃一下再定住
    st.x = st.target.x; st.y = st.target.y; st.spot = st.target; st.lift = 0; st.frame = null;
    remember(st.spot); if (core.onLand) core.onLand(st.spot, st.behave);
    if (st.chain > 0) {                                               // 巡邏／暴衝：不停下，接著去下一個點
      st.chain--; var nx = pick(L, { x: st.x, y: st.y }, cat.mood || "relaxed", null, mem, { far: st.behave === "zoom" });
      if (nx) { st.target = nx; startTravel(); return; }
    }
    st.forceTravel = null;
    runSeq(transition("stand", r.mode), { mode: r.mode, wait: r.wait });
  }
  function hideCat(h) { if (st.hidden === h) return; st.hidden = h; box.style.visibility = h ? "hidden" : ""; }
  function step(dt) {
    var mood = cat.mood || "relaxed";
    if (st.hop > 0) st.hop = Math.max(0, st.hop - dt);
    if (st.land >= 0) { st.land += dt; if (st.land >= LAND) st.land = -1; }
    if (st.settle >= 0) { st.settle += dt; if (st.settle >= SETTLE) st.settle = -1; }
    if (st.pause > 0) { st.pause = Math.max(0, st.pause - dt); return; }     // 被點了：停一下
    if (isRest(st.mode)) {
      st.t += dt;
      if (st.spot && !validSpot(L, st.spot)) { go(true); return; }   // 捲動後腳下變成內容了：馬上走開
      if (st.t >= st.wait) go(false);
      return;
    }
    st.t += dt;
    if (st.mode === "trans") {
      var cs = st.seq[0], q = Math.min(1, st.t / cs.dur);
      st.clip = cs.clip; st.clipRev = !!cs.rev; st.clipP = q;
      if (cs.synth) { var k = Math.sin(Math.PI * q); st.sx2 = 1 + 0.14 * k; st.sy = 1 - 0.1 * k; st.clip = "settle"; st.clipP = 1; st.clipRev = false; }  // 伸懶腰（合成）：趴低的那格拉長壓扁
      if (q >= 1) { st.seq.shift(); st.t = 0; st.sx2 = 1; st.sy = 1; if (!st.seq.length) finishSeq(); }
      return;
    }
    if (st.mode === "turn") {
      var tr = turnAt(st.t / TURN, st.turnFrom, st.turnTo); st.faceS = tr.sx; st.sy = tr.sy;
      if (st.t >= TURN) { st.faceS = st.turnTo; st.sy = 1; st.mode = st.travel; st.t = 0; st.settle = 0; st.settleAmp = 1.2; }  // 轉完：身體輕輕回正
      return;
    }
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
    st.frame += framesFor(mv, W, run); st.phase += mv / 18;          // 影格只跟走過的距離走：不會滑步
  }
  // 點牠：停一下、原地跳一下；睡覺中被叫醒會慢慢坐起來（抬頭、伸懶腰）
  function react(k) {
    st.hop = 0.45; st.pause = (st.mode === "walk" || st.mode === "run") ? 1.2 : 0;
    if (st.mode === "sleep") { setNap(false); runSeq(transition("sleep", "sit"), { mode: "sit", wait: rand(DUR.sit) }); }
    return k;
  }
  core.step = step; core.go = go; core.measure = measure; core.react = react;
  function draw() {
    var bob = 0;
    if (st.mode === "walk" && !st.pause && st.frame != null) bob = bobFor(st.frame, W * 0.02);
    if (st.mode === "run" && !st.pause && st.frame != null) bob = bobFor(st.frame, W * 0.05);
    if (st.hop > 0) { var q = 1 - st.hop / 0.45; bob -= Math.sin(Math.PI * q) * 16; }
    var sx2 = st.sx2, sy2 = st.sy;
    if (st.land >= 0) { var la = landAt(st.land / LAND); sx2 *= la.sx; sy2 *= la.sy; }
    var sc = (sx2 !== 1 || sy2 !== 1) ? " scale(" + sx2.toFixed(3) + "," + sy2.toFixed(3) + ")" : "";
    box.style.transform = "translate3d(" + st.x.toFixed(1) + "px," + (st.y - st.lift + bob).toFixed(1) + "px,0)" + sc;
    // 理毛／盯著看沒有專屬影格：既有影格＋小幅動作（理毛＝頭輕輕左右擺；盯著＝微微前傾不動）
    var extra = "";
    if (st.mode === "groom") extra = " rotate(" + (Math.sin(st.t * 5.2) * 3.5).toFixed(2) + "deg)";
    else if (st.mode === "stare") extra = " rotate(" + (-2 * Math.min(1, st.t / 0.6)).toFixed(2) + "deg)";
    var rot = 0;
    if ((st.mode === "walk" || st.mode === "run") && !st.pause && st.frame != null) rot += swayFor(st.frame, st.mode === "run" ? 1.4 : 0.9);
    if (st.settle >= 0) rot += settleAt(st.settle, st.settleAmp);
    if (rot) extra += " rotate(" + rot.toFixed(2) + "deg)";
    if (face && face.style) face.style.transform = "scaleX(" + st.faceS.toFixed(3) + ")" + extra;
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
