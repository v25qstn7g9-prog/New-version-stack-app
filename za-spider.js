// Z∞ Assets 機械蜘蛛（純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 一隻用線條組成的蜘蛛在畫面上慢慢爬：藍色身體、青色兩節的腿、粉紅色關節。
// 腳會一步一步踩到卡片的角落與邊緣，踩到的卡片會亮起一圈細框和一小條粉紅標記，之後慢慢淡掉。
// 畫在一張固定在畫面上的透明 canvas（層級低於底部分頁列與所有彈出視窗）；開了「減少動態效果」就完全不啟動。
(function () {
  if (window.__zaSpider) return;
  window.__zaSpider = true;
  var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq && mq.matches) return;

  var L1 = 32, L2 = 38;          // 腿的兩節長度
  var HALF_W = 8;                // 身體半寬（髖關節離中線的距離）
  var BODY_L = 15, BODY_W = 9;   // 身體半長、半寬（畫出來的方塊）
  var STEP_DIST = 36, STEP_TIME = 0.17, SPEED = 38, TURN = 3.2;
  var TOUCH_LIFE = 1600;
  var HIP_U = [-11, -4, 4, 11];

  var canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:20";
  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  var dpr = 1, W = 0, H = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  var anchors = [], touches = [];
  var body = { x: 0, y: 0, a: Math.PI / 2, target: null, wait: 0 };
  var legs = [];
  var lastAnchorScan = -1e9, lastT = 0;

  function sx() { return window.scrollX || 0; }
  function sy() { return window.scrollY || 0; }

  function scanAnchors() {
    var els = document.querySelectorAll(".premium-panel,.premium-asset-hero,.rounded-2xl");
    var ox = sx(), oy = sy(), out = [];
    for (var i = 0; i < els.length && out.length < 320; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width < 110 || r.height < 36 || r.width > W * 1.2) continue;
      if (r.bottom < -200 || r.top > H + 200) continue;
      var rect = { l: r.left + ox, t: r.top + oy, r: r.right + ox, b: r.bottom + oy };
      var cx = (rect.l + rect.r) / 2, cy = (rect.t + rect.b) / 2;
      var pts = [[rect.l, rect.t], [rect.r, rect.t], [rect.l, rect.b], [rect.r, rect.b], [cx, rect.t], [cx, rect.b], [rect.l, cy], [rect.r, cy]];
      for (var k = 0; k < pts.length; k++) out.push({ x: pts[k][0], y: pts[k][1], rect: rect });
    }
    anchors = out;
  }

  function restPos(leg) {
    var c = Math.cos(body.a), s = Math.sin(body.a);
    var u = HIP_U[leg.i] * 3.3 + 8, v = leg.side * 54;
    return { x: body.x + c * u - s * v, y: body.y + s * u + c * v };
  }
  function hipPos(leg) {
    var c = Math.cos(body.a), s = Math.sin(body.a);
    var u = HIP_U[leg.i], v = leg.side * HALF_W;
    return { x: body.x + c * u - s * v, y: body.y + s * u + c * v };
  }

  function resetLegs() {
    legs = [];
    for (var k = 0; k < 8; k++) {
      var side = k < 4 ? -1 : 1, i = k % 4;
      var leg = { side: side, i: i, group: (i + (side < 0 ? 0 : 1)) % 2, x: 0, y: 0, step: null };
      var p = restPos(leg);
      leg.x = p.x; leg.y = p.y;
      legs.push(leg);
    }
  }

  function place() {
    body.x = W * (0.25 + Math.random() * 0.5) + sx();
    body.y = sy() + H * 0.45;
    body.a = Math.PI / 2;
    body.target = null;
    resetLegs();
  }

  function pickTarget() {
    var cy = sy();
    var near = [];
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i], ry = a.y - cy;
      if (ry < 50 || ry > H - 70 || a.x < 20 || a.x > W - 20) continue;
      if (Math.hypot(a.x - body.x, a.y - body.y) < 90) continue;
      near.push(a);
    }
    if (near.length) return near[Math.floor(Math.random() * near.length)];
    return { x: 40 + Math.random() * (W - 80) + sx(), y: cy + 80 + Math.random() * (H - 200), rect: null };
  }

  function ease(t) { return t * t * (3 - 2 * t); }

  function update(dt, now) {
    if (now - lastAnchorScan > 700) { scanAnchors(); lastAnchorScan = now; }
    var cy = sy();
    if (body.y - cy < -120 || body.y - cy > H + 120) place(); // 畫面捲走了：從新位置重新出發

    // 走向目標
    if (!body.target) {
      if (body.wait > 0) body.wait -= dt;
      else body.target = pickTarget();
    }
    var moving = false;
    if (body.target) {
      var dx = body.target.x - body.x, dy = body.target.y - body.y, dist = Math.hypot(dx, dy);
      if (dist < 22) {
        body.target = null;
        body.wait = 0.5 + Math.random() * 0.9;
      } else {
        var want = Math.atan2(dy, dx), diff = want - body.a;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        var turn = TURN * dt;
        body.a += Math.abs(diff) < turn ? diff : (diff > 0 ? turn : -turn);
        var sp = Math.abs(diff) > 1.1 ? SPEED * 0.25 : SPEED;
        body.x += Math.cos(body.a) * sp * dt;
        body.y += Math.sin(body.a) * sp * dt;
        moving = true;
      }
    }

    // 腳：走遠了就換一步，左右交替；踩點盡量吸附到附近的卡片邊緣
    var stepping = [false, false];
    for (var k = 0; k < legs.length; k++) if (legs[k].step) stepping[legs[k].group] = true;
    for (k = 0; k < legs.length; k++) {
      var leg = legs[k];
      if (leg.step) {
        leg.step.t += dt / STEP_TIME;
        var e = ease(Math.min(1, leg.step.t));
        leg.x = leg.step.fx + (leg.step.tx - leg.step.fx) * e;
        leg.y = leg.step.fy + (leg.step.ty - leg.step.fy) * e;
        if (leg.step.t >= 1) {
          if (leg.step.anchor) touches.push({ rect: leg.step.anchor.rect, x: leg.step.tx, y: leg.step.ty, born: now });
          leg.step = null;
        }
        continue;
      }
      var rest = restPos(leg), hip = hipPos(leg);
      var off = Math.hypot(leg.x - rest.x, leg.y - rest.y);
      var over = Math.hypot(leg.x - hip.x, leg.y - hip.y) > L1 + L2 - 2;
      if ((off > STEP_DIST && moving && !stepping[1 - leg.group]) || over) {
        var tx = rest.x + Math.cos(body.a) * 10, ty = rest.y + Math.sin(body.a) * 10, snap = null, best = 30;
        for (var i = 0; i < anchors.length; i++) {
          var d = Math.hypot(anchors[i].x - tx, anchors[i].y - ty);
          if (d < best) { best = d; snap = anchors[i]; }
        }
        if (snap) { tx = snap.x; ty = snap.y; }
        leg.step = { fx: leg.x, fy: leg.y, tx: tx, ty: ty, t: 0, anchor: snap };
        stepping[leg.group] = true;
      }
    }
    var fresh = [];
    for (k = 0; k < touches.length; k++) if (now - touches[k].born < TOUCH_LIFE) fresh.push(touches[k]);
    touches = fresh.slice(-8);
  }

  // 兩節腿的反向運動學：給髖關節與腳，算出膝蓋（膝蓋往身體外側彎）
  function knee(hx, hy, fx, fy) {
    var dx = fx - hx, dy = fy - hy, d = Math.hypot(dx, dy) || 0.001;
    d = Math.min(Math.max(d, Math.abs(L1 - L2) + 1), L1 + L2 - 0.1);
    var ux = dx / d, uy = dy / d;
    var a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    var h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    var mx = hx + ux * a, my = hy + uy * a;
    var k1 = { x: mx - uy * h, y: my + ux * h }, k2 = { x: mx + uy * h, y: my - ux * h };
    var bx = body.x, by = body.y;
    return Math.hypot(k1.x - bx, k1.y - by) > Math.hypot(k2.x - bx, k2.y - by) ? k1 : k2;
  }

  function palette() {
    var light = document.documentElement.getAttribute("data-theme") === "grey";
    return light
      ? { line: "#168a9e", joint: "#d6336c", body: "#2b3f9a", eye: "#bfe3ff" }
      : { line: "#4fd6e8", joint: "#ff5c8a", body: "#1a2670", eye: "#7fc4ff" };
  }

  function draw(now) {
    var c = palette(), ox = sx(), oy = sy();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = "round";

    // 踩過的卡片：細框＋粉紅小標記，慢慢淡掉
    for (var i = 0; i < touches.length; i++) {
      var t = touches[i], f = 1 - (now - t.born) / TOUCH_LIFE;
      if (f <= 0) continue;
      ctx.globalAlpha = 0.5 * f;
      ctx.strokeStyle = c.line; ctx.lineWidth = 1.5;
      ctx.strokeRect(t.rect.l - ox + 0.5, t.rect.t - oy + 0.5, t.rect.r - t.rect.l, t.rect.b - t.rect.t);
      ctx.globalAlpha = 0.9 * f;
      ctx.fillStyle = c.joint;
      ctx.fillRect(t.x - ox - 9, t.y - oy - 2.5, 18, 5);
    }
    ctx.globalAlpha = 1;

    // 腿
    ctx.lineWidth = 2; ctx.strokeStyle = c.line;
    for (var k = 0; k < legs.length; k++) {
      var leg = legs[k], hip = hipPos(leg), kn = knee(hip.x, hip.y, leg.x, leg.y);
      ctx.beginPath();
      ctx.moveTo(hip.x - ox, hip.y - oy);
      ctx.lineTo(kn.x - ox, kn.y - oy);
      ctx.lineTo(leg.x - ox, leg.y - oy);
      ctx.stroke();
      ctx.fillStyle = c.joint;
      ctx.beginPath(); ctx.arc(kn.x - ox, kn.y - oy, 3, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(leg.x - ox, leg.y - oy, leg.step ? 2.5 : 3.5, 0, 6.2832); ctx.fill();
    }

    // 身體：藍色方塊、青色外框、前端一顆亮藍的眼睛
    ctx.save();
    ctx.translate(body.x - ox, body.y - oy);
    ctx.rotate(body.a);
    ctx.fillStyle = c.body; ctx.strokeStyle = c.line; ctx.lineWidth = 2;
    ctx.fillRect(-BODY_L, -BODY_W, BODY_L * 2, BODY_W * 2);
    ctx.strokeRect(-BODY_L, -BODY_W, BODY_L * 2, BODY_W * 2);
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(BODY_L - 5, 0, 3, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  function frame(ts) {
    window.requestAnimationFrame(frame);
    if (ts - lastT < 33) return; // 約 30 幀就夠，省電
    var dt = lastT ? Math.min(0.06, (ts - lastT) / 1000) : 0.033;
    lastT = ts;
    update(dt, ts);
    draw(ts);
  }

  function start() {
    document.body.appendChild(canvas);
    resize();
    scanAnchors();
    place();
    window.addEventListener("resize", function () { resize(); lastAnchorScan = -1e9; });
    window.requestAnimationFrame(frame);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
