// Z∞ Assets 小白貓・手繪 2D 備用版（WebGL 不能用時才會用到；純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 一隻白色小貓在畫面上到處跑、跑累了坐下來眨眼甩尾巴、有時候整隻縮成一球滾過去。
// 畫在一張固定在畫面上的透明 canvas（層級低於底部分頁列與所有彈出視窗）；開了「減少動態效果」就完全不啟動。
(function () {
  if (window.__zaCat) return;
  var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq && mq.matches) return;
  var api = window.__zaCat = { state: "sit" };

  var canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:20";
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var dpr = 1, W = 0, H = 0, lastT = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  // 活動範圍：避開最上面的標題列和底部分頁列。
  function bounds() { return { l: 34, r: W - 34, t: Math.min(110, H * 0.2), b: Math.max(Math.min(110, H * 0.2) + 40, H - 96) }; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  var cat = { x: 0, y: 0, dir: 1, state: "sit", t: 0, wait: 1, phase: 0, tx: 0, ty: 0, speed: 0, rollLeft: 0, ang: 0, blink: 2, wag: 0 };

  function place() {
    var b = bounds();
    cat.x = rnd(b.l, b.r); cat.y = rnd(b.t, b.b);
    setState("sit", rnd(0.6, 1.4));
  }
  function setState(s, wait) { cat.state = s; api.state = s; cat.t = 0; cat.wait = wait || 0; }

  function next() {
    var b = bounds(), r = Math.random();
    if (r < 0.58) {
      cat.tx = rnd(b.l, b.r); cat.ty = rnd(b.t, b.b);
      if (Math.hypot(cat.tx - cat.x, cat.ty - cat.y) < 90) { cat.tx = Math.min(b.r, Math.max(b.l, cat.x + (cat.x > W / 2 ? -1 : 1) * rnd(120, 200))); }
      cat.speed = rnd(115, 170);
      setState("run");
    } else if (r < 0.86) {
      cat.dir = cat.x > W * 0.65 ? -1 : cat.x < W * 0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1);
      cat.rollLeft = rnd(110, 210); cat.ang = 0;
      setState("roll");
    } else {
      setState("sit", rnd(1.4, 2.8));
    }
  }

  function update(dt) {
    var b = bounds();
    cat.t += dt; cat.blink -= dt; cat.wag += dt;
    if (cat.state === "sit") {
      if (cat.t >= cat.wait) next();
    } else if (cat.state === "run") {
      var dx = cat.tx - cat.x, dy = cat.ty - cat.y, d = Math.hypot(dx, dy);
      if (d < 8) { setState(Math.random() < 0.35 ? "roll" : "sit", rnd(1.2, 2.6)); if (cat.state === "roll") { cat.rollLeft = rnd(110, 190); cat.ang = 0; cat.dir = cat.x > W / 2 ? -1 : 1; } return; }
      var ease = Math.min(1, cat.t / 0.35) * Math.min(1, d / 40 + 0.35); // 起跑慢慢加速、快到時放慢
      var v = cat.speed * ease;
      cat.x += dx / d * v * dt; cat.y += dy / d * v * dt;
      if (Math.abs(dx) > 4) cat.dir = dx > 0 ? 1 : -1;
      cat.phase += v * dt * 0.11;
    } else if (cat.state === "roll") {
      var v2 = 150, step = v2 * dt;
      var nx = cat.x + cat.dir * step;
      if (nx < b.l || nx > b.r) cat.dir = -cat.dir; else cat.x = nx;
      cat.ang += cat.dir * step / 13;
      cat.rollLeft -= step;
      if (cat.rollLeft <= 0) { setState("sit", rnd(1, 2)); }
    }
    cat.x = Math.min(b.r, Math.max(b.l, cat.x)); cat.y = Math.min(b.b, Math.max(b.t, cat.y));
  }

  // ── 繪圖：手繪風。每條線都有一點點抖動、每 0.14 秒換一次（動畫常見的「線條沸騰」），顏色填在外框稍微偏一點點的位置，像彩色筆畫的。
  // 貓朝右畫（本地座標，腳底在 y=0），朝左時整個水平翻轉。
  var OUTLINE = "#4d4660", FUR2 = "#fffaf4", SHADE2 = "rgba(165,176,214,0.34)", PINK2 = "#ff9fba", EYE2 = "#2a2438";
  var boil = 0, boilT = 0;
  function nz(i, k) { var v = Math.sin((i + 1) * 12.9898 + (k + boil) * 78.233) * 43758.5453; return (v - Math.floor(v)) - 0.5; }
  function jit(pts, k, amp) { return pts.map(function (p, i) { return [p[0] + nz(i, k) * amp, p[1] + nz(i, k + 57) * amp]; }); }
  // Catmull-Rom 曲線通過每個點
  function trace(P, closed) {
    var n = P.length, i, g = function (j) { return closed ? P[(j + n) % n] : P[Math.max(0, Math.min(n - 1, j))]; };
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    var last = closed ? n : n - 1;
    for (i = 0; i < last; i++) {
      var p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    if (closed) ctx.closePath();
  }
  function inkW(w) { ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = OUTLINE; }
  // 封閉的形狀：顏色稍微錯位 + 抖動的外框
  function shape(pts, fill, k, amp) {
    var P = jit(pts, k, amp == null ? 0.7 : amp);
    ctx.save(); ctx.translate(0.8, 0.6); trace(P, true); ctx.fillStyle = fill || FUR2; ctx.fill(); ctx.restore();
    trace(P, true); inkW(1.7); ctx.stroke();
  }
  function tint(pts, k, col) { trace(jit(pts, k, 0.5), true); ctx.fillStyle = col || SHADE2; ctx.fill(); }
  function ink(pts, k, w, amp) { trace(jit(pts, k, amp == null ? 0.5 : amp), false); inkW(w || 1.2); ctx.stroke(); }
  // 腿／尾巴：先畫粗的墨線外框，再畫細的毛色
  function limbPath(pts, w, k) {
    var P = jit(pts, k, 0.6);
    trace(P, false); inkW(w + 3.2); ctx.stroke();
    trace(P, false); ctx.strokeStyle = FUR2; ctx.lineWidth = w; ctx.stroke();
  }
  function paw2(x, y, k) { shape([[x - 3.4, y - 1], [x - 1.2, y - 2.8], [x + 2.2, y - 2.6], [x + 3.8, y - 0.4], [x + 3, y + 1.4], [x - 2.8, y + 1.5]], FUR2, k, 0.3); }
  function pawBall(x, y, k) { shape([[x - 2.6, y], [x, y - 2.8], [x + 2.6, y], [x, y + 2.8]], FUR2, k, 0.25); }
  function eye(x, y, rx, ry, blink) {
    if (blink) { ink([[x - rx, y], [x, y + 1.6], [x + rx, y]], 7, 1.3, 0.2); return; }
    ctx.fillStyle = EYE2; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + rx * 0.3, y - ry * 0.35, rx * 0.42, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(x - rx * 0.35, y + ry * 0.45, rx * 0.2, 0, 6.2832); ctx.fill();
  }
  function blush(x, y) { ctx.globalAlpha = 0.5; ctx.fillStyle = PINK2; ctx.beginPath(); ctx.ellipse(x, y, 3.2, 2.1, 0, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1; }
  function nose(x, y, s) {
    s = s || 1;
    shape([[x - 2 * s, y - 1 * s], [x + 2 * s, y - 1 * s], [x, y + 1.4 * s]], PINK2, 13, 0.1);
  }
  function mouth(x, y, s) {
    s = s || 1;
    ink([[x, y + 1.4 * s], [x, y + 3 * s]], 3, 1, 0.1);
    ink([[x - 3.6 * s, y + 3.4 * s], [x - 1.6 * s, y + 5 * s], [x, y + 3 * s], [x + 1.6 * s, y + 5 * s], [x + 3.6 * s, y + 3.4 * s]], 4, 1, 0.1);
  }
  function whiskers(x, y, w, dir) {
    for (var s = -1; s <= 1; s += 2) {
      var sx = x + s * w * 0.55;
      ink([[sx, y - 0.5], [sx + s * 6, y - 2.2], [sx + s * 12, y - 2.4]], 20 + s, 0.8, 0.2);
      ink([[sx, y + 1.4], [sx + s * 6, y + 2.6], [sx + s * 11.5, y + 5]], 30 + s, 0.8, 0.2);
    }
  }
  function earShape(base, tip, k, inner) {
    shape([base[0], tip, base[1]], FUR2, k, 0.5);
    var cx = (base[0][0] + base[1][0]) / 2, cy = (base[0][1] + base[1][1]) / 2;
    ctx.fillStyle = PINK2; ctx.globalAlpha = 0.85; ctx.beginPath();
    ctx.moveTo(cx * 0.9 + base[0][0] * 0.1 + (tip[0] - cx) * 0.05, cy + (tip[1] - cy) * 0.1);
    ctx.lineTo(cx + (tip[0] - cx) * 0.62, cy + (tip[1] - cy) * 0.62);
    ctx.lineTo(cx * 0.9 + base[1][0] * 0.1, cy + (tip[1] - cy) * 0.1);
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  }
  function floorShadow(rx) { ctx.fillStyle = "rgba(40,36,60,0.13)"; ctx.beginPath(); ctx.ellipse(0, 1.4, rx, 3.6, 0, 0, 6.2832); ctx.fill(); }
  function fur(x, y, dx, dy, k) { ink([[x, y], [x + dx * 0.5 + nz(k, 3) * 0.6, y + dy * 0.5], [x + dx, y + dy]], 40 + k, 0.9, 0.15); }

  // 坐著（正面，看著你）
  function drawSit() {
    var t = cat.t, blinking = (cat.blink < 0.14 && cat.blink > 0);
    if (cat.blink < -0.1) cat.blink = rnd(1.8, 3.6);
    var wag = Math.sin(cat.wag * 2.6) * 3.2, hy = Math.sin(t * 1.7) * 0.5;
    floorShadow(19);
    // 尾巴：從右側繞出來、尖端輕輕擺
    limbPath([[10, -3], [19, -2], [27, -8], [28, -17 + wag * 0.4], [24, -25 + wag]], 5.2, 1);
    // 後腿（身體兩側的大腿）
    shape([[-17, -3], [-18, -9], [-15, -15], [-9, -15], [-6, -8], [-8, -2], [-13, 0]], FUR2, 2);
    shape([[17, -3], [18, -9], [15, -15], [9, -15], [6, -8], [8, -2], [13, 0]], FUR2, 3);
    // 身體（梨形）
    shape([[-10, -1], [-12, -9], [-11, -19], [-8, -28], [0, -31], [8, -28], [11, -19], [12, -9], [10, -1], [0, 1.2]], FUR2, 4);
    tint([[-5.5, -3], [-6.5, -12], [-4, -22], [0, -25], [4, -22], [6.5, -12], [5.5, -3], [0, -1.6]], 5);
    fur(-8, -26, -2.2, 3, 1); fur(8, -26, 2.2, 3, 2); fur(-9, -20, -2.4, 2.5, 3); fur(9, -20, 2.4, 2.5, 4);
    // 前腳（兩條，腳掌有小趾線）
    limbPath([[-4.6, -17], [-4.4, -9], [-4.8, -2.4]], 5, 6); limbPath([[4.6, -17], [4.4, -9], [4.8, -2.4]], 5, 7);
    paw2(-4.8, -1.2, 8); paw2(4.8, -1.2, 9);
    ink([[-5.8, -0.4], [-5.8, 1]], 11, 0.7, 0.05); ink([[-3.6, -0.4], [-3.6, 1]], 12, 0.7, 0.05);
    ink([[3.6, -0.4], [3.6, 1]], 13, 0.7, 0.05); ink([[5.8, -0.4], [5.8, 1]], 14, 0.7, 0.05);
    // 頭
    ctx.save(); ctx.translate(0, -39 + hy); ctx.rotate(Math.sin(t * 1.1) * 0.06);
    earShape([[-12.5, -5.5], [-4, -9]], [-12.6, -17.5], 15);
    earShape([[4, -9], [12.5, -5.5]], [12.6, -17.5], 16);
    shape([[-13.5, -1], [-14.2, 4.5], [-10, 8.6], [-4, 10.4], [0, 10.7], [4, 10.4], [10, 8.6], [14.2, 4.5], [13.5, -1], [10.5, -6.5], [4, -9.6], [-4, -9.6], [-10.5, -6.5]], FUR2, 17, 0.6);
    fur(-13, 5.5, -3, 1.6, 5); fur(13, 5.5, 3, 1.6, 6);
    blush(-8.4, 3.6); blush(8.4, 3.6);
    var look = Math.sin(t * 0.9) * 0.9;
    eye(-5.4 + look, -0.8, 2.5, 3.1, blinking); eye(5.4 + look, -0.8, 2.5, 3.1, blinking);
    nose(look * 0.6, 3.4, 1.05); mouth(look * 0.6, 3.6, 1.05); whiskers(look * 0.6, 4.4, 15, 1);
    ctx.restore();
  }

  // 跑步（側面，四隻腳一前一後）
  function drawRun() {
    var p = cat.phase, bob = Math.abs(Math.sin(p)) * -2.4, sw = Math.sin(p * 0.5) * 4;
    floorShadow(25);
    ctx.save(); ctx.translate(0, bob);
    // 尾巴：翹高、隨步伐甩
    limbPath([[-18, -22], [-27, -25 + sw * 0.4], [-32, -35 + sw], [-27, -43 + sw * 0.6]], 5, 20);
    // 遠側的兩隻腳（先畫，在身體後面）
    function leg(hx, off, k) {
      var s = Math.sin(p + off), c = Math.cos(p + off);
      var fx = hx + s * 10, fy = -2.4 - Math.max(0, c) * 6.5 - bob * 0.5;
      limbPath([[hx, -14], [(hx + fx) / 2 + 2.4, -8.5 - Math.max(0, c) * 3.2], [fx, fy]], 4.2, k);
      paw2(fx + 1.2, fy + 0.8, k + 40);
    }
    leg(-12, Math.PI * 0.95, 21); leg(11, 0.25, 22);
    // 身體
    shape([[-21, -21], [-19, -28], [-9, -31.5], [4, -31], [14, -28.5], [19.5, -22.5], [18, -14.5], [10, -10], [-2, -9], [-12, -9.4], [-19.5, -13]], FUR2, 23);
    tint([[-12, -11], [0, -10.4], [10, -11.4], [14, -15], [4, -14], [-8, -14]], 24);
    fur(-19, -17, -3, 1.8, 7); fur(-17, -26, -2.6, -1.6, 8); fur(16, -25, 2.5, -1.2, 9);
    leg(-7, Math.PI * 1.15, 25); leg(15, 0.05, 26);
    // 頭（側面）＋兩隻耳朵
    ctx.save(); ctx.translate(24.5, -28.5 - Math.abs(Math.sin(p)) * 0.8); ctx.rotate(0.05);
    earShape([[-8, -7], [-1, -8.6]], [-6.4, -17], 27);
    earShape([[1, -8.6], [8, -5.5]], [8.6, -15.8], 28);
    shape([[-10, -2], [-10.5, 3.5], [-6, 8], [0, 9.6], [6, 9], [11.6, 5], [13, 0.4], [10, -5], [4, -8.6], [-4, -8.8]], FUR2, 29, 0.6);
    fur(-9.5, 5, -3, 1.8, 10);
    blush(-3.8, 4.4);
    eye(3.6, -0.6, 2.2, 2.9, false); eye(-4.2, -0.8, 1.9, 2.6, false);
    nose(11.8, 2.6, 0.9);
    ink([[11.6, 3.6], [10, 5.8], [7.6, 5.4]], 31, 0.9, 0.1);
    ink([[9, 2.2], [13.6, 0.6], [17.6, 0.8]], 32, 0.7, 0.15); ink([[9, 3.4], [14, 4.6], [17.4, 6.6]], 33, 0.7, 0.15);
    ctx.restore();
    ctx.restore();
  }

  // 縮成一球打滾：整隻一起轉
  function drawRoll() {
    floorShadow(16);
    ctx.save(); ctx.translate(0, -14.5); ctx.rotate(cat.ang);
    limbPath([[-12.5, 4], [-14, -6], [-6, -13.5], [4, -14.5], [12, -10.5]], 4.6, 50);
    shape([[-14, 0], [-12.5, -8.5], [-5, -13.8], [4, -14.2], [11.8, -9.5], [14.6, -0.5], [11.8, 9.5], [3, 14.2], [-6, 13.6], [-12, 8.2]], FUR2, 51);
    tint([[-9, 4], [-3, 8], [4, 9], [10, 5], [4, 5], [-4, 4.5]], 52);
    fur(-12, -4, -3, -1, 11); fur(-9, 10, -2.6, 2.6, 12);
    pawBall(-9.5, 10, 53); pawBall(-2.5, 13, 54); pawBall(5.5, 12.4, 55); pawBall(11.6, 8, 56);
    ctx.save(); ctx.translate(9.5, -5.5); ctx.scale(0.8, 0.8);
    earShape([[-12.5, -5.5], [-4, -9]], [-12.6, -17.5], 57);
    earShape([[4, -9], [12.5, -5.5]], [12.6, -17.5], 58);
    shape([[-13.5, -1], [-14.2, 4.5], [-10, 8.6], [-4, 10.4], [0, 10.7], [4, 10.4], [10, 8.6], [14.2, 4.5], [13.5, -1], [10.5, -6.5], [4, -9.6], [-4, -9.6], [-10.5, -6.5]], FUR2, 59, 0.6);
    blush(-8.4, 3.6); blush(8.4, 3.6);
    eye(-5.4, -0.8, 2.5, 3.1, false); eye(5.4, -0.8, 2.5, 3.1, false);
    nose(0, 3.4, 1.05); mouth(0, 3.6, 1.05);
    ctx.restore();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var b = bounds(), depth = 0.9 + 0.26 * ((cat.y - b.t) / Math.max(1, b.b - b.t)); // 越靠下越大一點，有遠近感
    ctx.save();
    ctx.translate(cat.x, cat.y);
    ctx.scale(cat.dir * depth * 1.12, depth * 1.12);
    if (cat.state === "run") drawRun(); else if (cat.state === "roll") drawRoll(); else drawSit();
    ctx.restore();
  }

  api.force = function (s) { if (s === "roll") { cat.rollLeft = 200; cat.ang = 0; } if (s === "run") { var b = bounds(); cat.tx = b.r; cat.ty = cat.y; cat.speed = 140; } setState(s, 99); };

  function frame(ts) {
    window.requestAnimationFrame(frame);
    if (ts - lastT < 33) return; // 約 30 幀就夠，省電
    var dt = lastT ? Math.min(0.06, (ts - lastT) / 1000) : 0.033;
    lastT = ts;
    update(dt);
    boilT += dt; if (boilT > 0.14) { boilT = 0; boil = (boil + 1) % 6; }
    draw();
  }
  function start() {
    document.body.appendChild(canvas);
    resize(); place();
    window.addEventListener("resize", resize);
    window.requestAnimationFrame(frame);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
