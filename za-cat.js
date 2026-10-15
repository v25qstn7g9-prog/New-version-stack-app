// Z∞ Assets 小白貓（純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 一隻白色小貓在畫面上到處跑、跑累了坐下來眨眼甩尾巴、有時候整隻縮成一球滾過去。
// 畫在一張固定在畫面上的透明 canvas（層級低於底部分頁列與所有彈出視窗）；開了「減少動態效果」就完全不啟動。
(function () {
  if (window.__zaCat) return;
  var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq && mq.matches) return;
  var api = window.__zaCat = { state: "sit" };

  var OUT = "#b3bccb", FUR = "#ffffff", SHADE = "#eef1f7", PINK = "#ffa9c0", EYE = "#2b2e3b";
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

  // ── 繪圖：貓朝右畫（本地座標，腳底在 y=0），朝左時整個水平翻轉 ──
  function stroke2(w, col, fn) { ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); fn(); ctx.stroke(); }
  // 有外框的線條（腿、尾巴）：先畫粗的灰框，再畫細的白色
  function limb(w, fn) { stroke2(w + 2.4, OUT, fn); stroke2(w, FUR, fn); }
  function blob(x, y, rx, ry, rot, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, 6.2832);
    ctx.fillStyle = fill || FUR; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.stroke();
  }
  function ear(x, y, tilt) {
    ctx.beginPath(); ctx.moveTo(x - 4.6, y + 2); ctx.lineTo(x + tilt, y - 8.2); ctx.lineTo(x + 4.8, y + 2.4); ctx.closePath();
    ctx.fillStyle = FUR; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = OUT; ctx.lineJoin = "round"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 2.2, y + 0.6); ctx.lineTo(x + tilt * 0.8, y - 5); ctx.lineTo(x + 2.6, y + 1); ctx.closePath();
    ctx.fillStyle = PINK; ctx.fill();
  }
  function head(x, y, blinking, look) {
    ear(x - 5.5, y - 7.4, -1.2); ear(x + 5.8, y - 7.4, 1.4);
    blob(x, y, 10.4, 9.2, 0, FUR);
    // 臉頰紅暈、眼睛、鼻子、嘴、鬍鬚
    ctx.globalAlpha = 0.55; ctx.fillStyle = PINK;
    ctx.beginPath(); ctx.arc(x - 6.2, y + 2.8, 2.1, 0, 6.2832); ctx.arc(x + 6.6, y + 2.8, 2.1, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    var ex1 = x - 3.8 + look, ex2 = x + 4.4 + look, ey = y - 0.6;
    if (blinking) {
      stroke2(1.4, EYE, function () { ctx.moveTo(ex1 - 1.8, ey); ctx.quadraticCurveTo(ex1, ey + 1.6, ex1 + 1.8, ey); ctx.moveTo(ex2 - 1.8, ey); ctx.quadraticCurveTo(ex2, ey + 1.6, ex2 + 1.8, ey); });
    } else {
      ctx.fillStyle = EYE; ctx.beginPath(); ctx.ellipse(ex1, ey, 1.9, 2.5, 0, 0, 6.2832); ctx.ellipse(ex2, ey, 1.9, 2.5, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex1 + 0.6, ey - 0.9, 0.8, 0, 6.2832); ctx.arc(ex2 + 0.6, ey - 0.9, 0.8, 0, 6.2832); ctx.fill();
    }
    var nx = x + 0.4 + look * 0.6, ny = y + 2.6;
    ctx.fillStyle = PINK; ctx.beginPath(); ctx.moveTo(nx - 1.5, ny - 0.6); ctx.lineTo(nx + 1.5, ny - 0.6); ctx.lineTo(nx, ny + 1); ctx.closePath(); ctx.fill();
    stroke2(0.9, OUT, function () { ctx.moveTo(nx, ny + 1); ctx.lineTo(nx, ny + 2.2); ctx.moveTo(nx, ny + 2.2); ctx.quadraticCurveTo(nx - 1.6, ny + 3.6, nx - 3, ny + 2.4); ctx.moveTo(nx, ny + 2.2); ctx.quadraticCurveTo(nx + 1.6, ny + 3.6, nx + 3, ny + 2.4); });
    stroke2(0.7, OUT, function () {
      ctx.moveTo(x - 8, y + 2); ctx.lineTo(x - 15, y + 0.6); ctx.moveTo(x - 8, y + 3.4); ctx.lineTo(x - 14.6, y + 4.6);
      ctx.moveTo(x + 8.6, y + 2); ctx.lineTo(x + 15.6, y + 0.6); ctx.moveTo(x + 8.6, y + 3.4); ctx.lineTo(x + 15.2, y + 4.6);
    });
  }
  function shadow(rx) {
    ctx.fillStyle = "rgba(20,24,40,0.16)"; ctx.beginPath(); ctx.ellipse(0, 1.5, rx, 3.2, 0, 0, 6.2832); ctx.fill();
  }
  function paw(x, y) { blob(x, y, 3.4, 2.4, 0, FUR); }

  function drawRun() {
    var p = cat.phase, bob = Math.abs(Math.sin(p)) * -2.2;
    shadow(22);
    ctx.save(); ctx.translate(0, bob);
    // 尾巴：翹高、隨步伐甩
    var sw = Math.sin(p * 0.5) * 4;
    limb(4.2, function () { ctx.moveTo(-15, -17); ctx.bezierCurveTo(-27, -19 + sw, -31, -33 + sw, -24, -38 + sw * 0.5); });
    // 後腿（先畫，在身體後面）與前腿
    function leg(hx, off, back) {
      var s = Math.sin(p + off), c = Math.cos(p + off);
      var fx = hx + s * 9 * (back ? 1 : 1), fy = -2 - Math.max(0, c) * 6 - bob;
      limb(4.6, function () { ctx.moveTo(hx, -11); ctx.lineTo(fx, fy); });
      paw(fx + 1, fy);
    }
    leg(-11, Math.PI * 0.9, true); leg(11, 0.2, false);
    blob(0, -17, 18, 10.5, 0, FUR);
    ctx.globalAlpha = 0.7; ctx.fillStyle = SHADE; ctx.beginPath(); ctx.ellipse(-1, -12, 13, 4.2, 0, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    leg(-8, Math.PI * 1.1, true); leg(14, Math.PI * 0.05 + 0.2, false);
    head(20, -23 - Math.abs(Math.sin(p)) * 0.6, false, 1.2);
    ctx.restore();
  }

  function drawSit() {
    var t = cat.t, wag = Math.sin(cat.wag * 3.2) * 5;
    var blinking = (cat.blink < 0.14 && cat.blink > 0);
    if (cat.blink < -0.1) cat.blink = rnd(1.6, 3.4);
    shadow(15);
    // 尾巴貼著地捲在身旁，尖端輕輕擺
    limb(4.2, function () { ctx.moveTo(-8, -3); ctx.bezierCurveTo(-26, -1, -30, -14 + wag * 0.4, -23, -19 + wag); });
    // 後腿（坐著的大腿）與身體
    blob(-4, -9.5, 12.5, 9.5, 0, FUR);
    blob(5, -18, 9.6, 13.4, -0.12, FUR);
    ctx.globalAlpha = 0.7; ctx.fillStyle = SHADE; ctx.beginPath(); ctx.ellipse(8, -14, 5, 9, -0.12, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    limb(4.6, function () { ctx.moveTo(9, -14); ctx.lineTo(10, -2.6); }); paw(11, -2);
    limb(4.6, function () { ctx.moveTo(3, -14); ctx.lineTo(4, -2.6); }); paw(5, -2);
    paw(-12, -2);
    // 頭：偶爾歪一下
    var tilt = Math.sin(t * 1.3) * 0.08;
    ctx.save(); ctx.translate(8, -35); ctx.rotate(tilt); head(0, 0, blinking, Math.sin(t * 0.9) * 1.2); ctx.restore();
  }

  function drawRoll() {
    shadow(15);
    ctx.save(); ctx.translate(0, -13);
    ctx.rotate(cat.ang);
    // 縮成一球：尾巴繞一圈、四隻小腳、頭靠在前面，整隻一起轉
    limb(4, function () { ctx.arc(0, 0, 11.5, 2.4, 5.1); });
    blob(0, 0, 13, 12, 0, FUR);
    ctx.globalAlpha = 0.7; ctx.fillStyle = SHADE; ctx.beginPath(); ctx.ellipse(-1.5, 4, 8, 5, 0, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    paw(-9, 9); paw(-3, 11.5); paw(5, 11); paw(10, 7);
    head(10, -6.5, false, 0);
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var b = bounds(), depth = 0.88 + 0.28 * ((cat.y - b.t) / Math.max(1, b.b - b.t)); // 越靠下越大一點，有遠近感
    ctx.save();
    ctx.translate(cat.x, cat.y);
    ctx.scale(cat.dir * depth * 1.15, depth * 1.15);
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
