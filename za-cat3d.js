// Z∞ Assets 3D 小白貓（純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 用 three.js 即時畫的立體小貓，照著 Johnny 家那隻貓畫：白底、背和尾巴帶一點奶油蜜桃色、額頭有淡橘色花紋、
// 藍灰色的眼睛（半瞇著的睏睏表情）、粉紅鼻子和粉紅肉球，圓圓胖胖的英短身材。
// 在畫面上到處跑（轉彎時整隻身體真的轉向）、坐下來看你、翻滾、偶爾四腳朝天躺著。
// 只畫在一個跟著貓移動的小 canvas 上（不是整個畫面），層級低於底部分頁列與所有彈出視窗；開了「減少動態效果」就不啟動。
// start(THREE, env) 由 za-cat.js 載入；env 可以換成假的畫面環境（測試用）。
export function start(THREE, env) {
  env = env || {};
  var win = env.window || window, doc = env.document || document;
  var SIZE = 300, FEET = 190;   // 小 canvas 的邊長（CSS px）與貓腳底在 canvas 裡的高度（下面會用相機算出實際值）
  var api = win.__zaCat3d = { state: "sit", ready: false };

  // ── 渲染器、場景、光 ──
  var canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;left:0;top:0;width:" + SIZE + "px;height:" + SIZE + "px;pointer-events:none;z-index:20;will-change:transform;transform-origin:" + SIZE / 2 + "px " + FEET + "px";
  var renderer = env.makeRenderer ? env.makeRenderer(canvas) : new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  var dpr = Math.min(win.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr); renderer.setSize(SIZE, SIZE, false);
  if (renderer.setClearColor) renderer.setClearColor(0x000000, 0);
  if (renderer.shadowMap) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping; renderer.toneMappingExposure = 1.05;

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(27, 1, 0.1, 40);
  camera.position.set(0, 2.75, 6.25); camera.lookAt(0, 0.45, 0); camera.updateMatrixWorld(true);
  try { var feet = new THREE.Vector3(0, 0, 0).project(camera); FEET = Math.round((1 - feet.y) / 2 * SIZE); canvas.style.transformOrigin = SIZE / 2 + "px " + FEET + "px"; } catch (e) {}
  scene.add(new THREE.HemisphereLight(0xffffff, 0xaab4d4, 1.15));
  var key = new THREE.DirectionalLight(0xfff6ec, 1.9);
  key.position.set(-2.2, 4.2, 3.2); key.castShadow = true;
  key.shadow.mapSize.set(512, 512); key.shadow.radius = 5; key.shadow.bias = -0.0008;
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 12 });
  scene.add(key);
  var rim = new THREE.DirectionalLight(0xdfe8ff, 0.8); rim.position.set(2.6, 2.2, -3); scene.add(rim);
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.26 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // ── 材質：細毛紋理（凹凸）＋絨毛光澤 ──
  function noiseTex(draw, size, repeat) {
    var c = doc.createElement("canvas"); c.width = c.height = size;
    var g = c.getContext("2d"); if (!g) return null;
    draw(g, size);
    var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
    return t;
  }
  var furBump = noiseTex(function (g, s) {
    g.fillStyle = "#808080"; g.fillRect(0, 0, s, s);
    for (var i = 0; i < 3200; i++) {
      var x = Math.random() * s, y = Math.random() * s, a = Math.random() * 6.283, l = 5 + Math.random() * 9, v = 40 + Math.random() * 190;
      g.strokeStyle = "rgba(" + v + "," + v + "," + v + ",0.55)"; g.lineWidth = 1 + Math.random() * 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  }, 256, 2.6);
  var matFur = new THREE.MeshPhysicalMaterial({ color: 0xfffbf6, roughness: 0.92, metalness: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xffffff), bumpMap: furBump, bumpScale: 1.6 });
  var matFurTint = matFur.clone(); matFurTint.vertexColors = true;          // 背上的蜜桃色用頂點顏色漸層
  var matTail = matFur.clone(); matTail.color = new THREE.Color(0xf9dcc4);   // 尾巴：奶油蜜桃色
  var matEarOut = matFur.clone(); matEarOut.color = new THREE.Color(0xfbe3d6);
  var matStripe = new THREE.MeshStandardMaterial({ color: 0xeeb27e, roughness: 0.9, transparent: true, opacity: 0.88 });
  var matPink = new THREE.MeshStandardMaterial({ color: 0xf7a6b4, roughness: 0.6 });
  var matInnerEar = new THREE.MeshStandardMaterial({ color: 0xffb8cb, roughness: 0.8, side: THREE.DoubleSide });
  var matWhisker = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  var irisTex = noiseTex(function (g, s) {
    var r = s / 2, grd = g.createRadialGradient(r, r, 2, r, r, r);
    grd.addColorStop(0, "#27355f"); grd.addColorStop(0.4, "#9db3df"); grd.addColorStop(0.8, "#6e86bf"); grd.addColorStop(1, "#2d3d6e");
    g.fillStyle = grd; g.beginPath(); g.arc(r, r, r - 1, 0, 6.2832); g.fill();
    g.fillStyle = "#08090d"; g.beginPath(); g.ellipse(r, r, r * 0.3, r * 0.62, 0, 0, 6.2832); g.fill();
    g.fillStyle = "rgba(255,255,255,0.95)"; g.beginPath(); g.arc(r * 0.62, r * 0.55, r * 0.17, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(r * 1.3, r * 1.4, r * 0.08, 0, 6.2832); g.fill();
  }, 128, 1);
  if (irisTex) irisTex.repeat.set(1, 1);
  var matIris = new THREE.MeshBasicMaterial({ map: irisTex || null, color: irisTex ? 0xffffff : 0x7d95c4 });
  var matEyeball = new THREE.MeshStandardMaterial({ color: 0xf6f7fb, roughness: 0.25 });

  var sphereGeo = new THREE.SphereGeometry(1, 28, 20);
  function ell(sx, sy, sz, mat, x, y, z, parent) {
    var m = new THREE.Mesh(sphereGeo, mat || matFur); m.scale.set(sx, sy, sz); m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true; if (parent) parent.add(m); return m;
  }
  function grp(parent, x, y, z) { var g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); if (parent) parent.add(g); return g; }

  // ── 骨架：root(位置、朝向) → rig(打滾) → body(身體俯仰、高度) → 頭／四肢／尾巴 ──
  var root = grp(scene), rig = grp(root), body = grp(rig, 0, 0.47, 0);
  // 毛茸茸的邊緣：同一個形狀往外放大幾層、半透明、帶細點狀透明圖（絨毛感）
  var fuzzTex = noiseTex(function (g, s) {
    g.fillStyle = "#000"; g.fillRect(0, 0, s, s);
    for (var i = 0; i < 2600; i++) { var v = 120 + Math.random() * 135; g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 1.4, 0, 6.2832); g.fill(); }
  }, 128, 5);
  var fuzzMats = [0, 1, 2, 3].map(function (i) { return new THREE.MeshBasicMaterial({ color: 0xfff7ee, transparent: true, opacity: 0.2 - i * 0.04, alphaMap: fuzzTex || null, depthWrite: false }); });
  function fuzz(mesh) {
    fuzzMats.forEach(function (m, i) {
      var f = new THREE.Mesh(mesh.geometry, m);
      var k = 1 + 0.02 * (i + 1);
      f.position.copy(mesh.position); f.rotation.copy(mesh.rotation); f.scale.set(mesh.scale.x * k, mesh.scale.y * k, mesh.scale.z * k);
      mesh.parent.add(f);
    });
  }
  // 身體：一整塊平滑的形狀（臀圓、腰細、胸寬），不是幾顆球拼起來
  var torsoGeo = new THREE.SphereGeometry(1, 44, 32), tp0 = torsoGeo.attributes.position;
  function bump(z, c, w) { var d = (z - c) / w; return Math.exp(-d * d); }
  for (var vi = 0; vi < tp0.count; vi++) {
    var ux = tp0.getX(vi), uy = tp0.getY(vi), uz = tp0.getZ(vi);
    var rr = 0.25 + 0.06 * bump(uz, -0.5, 0.4) + 0.05 * bump(uz, 0.5, 0.4);
    var ry2 = 0.25 + 0.05 * bump(uz, -0.5, 0.4) + 0.065 * bump(uz, 0.5, 0.4);
    tp0.setXYZ(vi, ux * rr * 1.1, uy * ry2 * (uy < 0 ? 1.12 : 1.04) + 0.0, uz * 0.58);
  }
  torsoGeo.computeVertexNormals();
  (function () {   // 背上、屁股帶蜜桃色，肚子和胸口是白的
    var n = torsoGeo.attributes.normal, cols = new Float32Array(tp0.count * 3), cw = new THREE.Color(0xfffbf6), cp = new THREE.Color(0xf6d2b6), c = new THREE.Color();
    for (var i = 0; i < tp0.count; i++) {
      var up = Math.max(0, n.getY(i)), back = Math.max(0, -tp0.getZ(i) / 0.58);
      var t = Math.min(1, Math.pow(up, 1.4) * (0.55 + 0.45 * Math.max(0, 1 - Math.abs(tp0.getZ(i) / 0.58 - 0.1)))) * 0.85 + back * 0.12;
      c.copy(cw).lerp(cp, Math.min(1, t));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    torsoGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  })();
  var torso = new THREE.Mesh(torsoGeo, matFurTint); torso.castShadow = true; torso.position.set(0, 0.0, -0.02); body.add(torso); fuzz(torso);

  // 頭：英短式的大圓臉、鼓鼓的臉頰、小耳朵、半瞇的藍灰色眼睛、額頭淡橘色花紋
  var head = grp(body, 0, 0.2, 0.5);
  fuzz(ell(0.335, 0.29, 0.275, matFur, 0, 0.12, 0.1, head));
  ell(0.14, 0.12, 0.13, matFur, -0.22, 0.04, 0.17, head); ell(0.14, 0.12, 0.13, matFur, 0.22, 0.04, 0.17, head); // 臉頰
  ell(0.105, 0.078, 0.095, matFur, 0, 0.03, 0.3, head);                                                         // 嘴巴部位
  ell(0.04, 0.03, 0.03, matPink, 0, 0.085, 0.39, head);                                                         // 鼻子
  [-0.075, 0, 0.075].forEach(function (x, k) {                                                                  // 額頭的三條花紋
    var st = new THREE.Mesh(sphereGeo, matStripe); st.scale.set(0.014, 0.085, 0.01);
    var phi = 0.95; st.position.set(x * 1.15, 0.12 + 0.288 * Math.sin(phi), 0.1 + 0.272 * Math.cos(phi) * 0.98);
    st.rotation.set(-(Math.PI / 2 - phi) * 1.0, 0, (k - 1) * -0.28); head.add(st);
  });
  var eyes = [];
  [-1, 1].forEach(function (s) {
    var eg = grp(head, s * 0.135, 0.165, 0.262);
    var ball = ell(0.088, 0.09, 0.075, matEyeball, 0, 0, 0, eg); ball.castShadow = false;
    var iris = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), matIris); iris.position.set(0, -0.006, 0.071); iris.rotation.y = s * 0.12; eg.add(iris);
    var lid = ell(0.1, 0.05, 0.088, matFur, 0, 0.082, 0.008, eg); lid.castShadow = false;                      // 上眼皮：半瞇的睏睏眼
    eyes.push(eg);
    // 耳朵（外面奶油色、裡面粉紅）
    var ear = grp(head, s * 0.2, 0.3, 0.03); ear.rotation.z = -s * 0.45; ear.rotation.x = -0.08;
    var outer = new THREE.Mesh(new THREE.ConeGeometry(0.108, 0.2, 4), matEarOut); outer.scale.z = 0.55; outer.rotation.y = Math.PI / 4; outer.position.y = 0.075; outer.castShadow = true; ear.add(outer);
    var inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.145, 4), matInnerEar); inner.scale.z = 0.45; inner.rotation.y = Math.PI / 4; inner.position.set(0, 0.062, 0.03); ear.add(inner);
    eyes[eyes.length - 1].userData.ear = ear;
    // 鬍鬚
    for (var w = 0; w < 3; w++) {
      var wh = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.002, 0.27, 4), matWhisker);
      wh.position.set(s * 0.2, 0.06 - w * 0.03, 0.34); wh.rotation.z = Math.PI / 2 + s * (w - 1) * -0.18; wh.rotation.y = s * 0.42 - s * (w - 1) * 0.05;
      head.add(wh);
    }
  });
  var ears = eyes.map(function (e) { return e.userData.ear; });

  // 四肢（肩／髖 → 膝 → 腳掌），腳底剛好碰地；腳掌下面有粉紅肉球（抬腳、翻滾時看得到）
  function makeLeg(px, py, pz, big) {
    var hip = grp(body, px, py, pz);
    ell(big ? 0.13 : 0.1, big ? 0.16 : 0.14, big ? 0.16 : 0.105, matFur, 0, -0.08, 0, hip);
    var knee = grp(hip, 0, -0.17, 0);
    ell(0.07, 0.115, 0.07, matFur, 0, -0.08, 0, knee);
    var paw = ell(0.088, 0.055, 0.115, matFur, 0, -0.178, 0.04, knee);
    ell(0.04, 0.012, 0.05, matPink, 0, -0.228, 0.045, knee); ell(0.014, 0.01, 0.016, matPink, -0.03, -0.226, 0.1, knee); ell(0.014, 0.01, 0.016, matPink, 0.0, -0.226, 0.106, knee); ell(0.014, 0.01, 0.016, matPink, 0.03, -0.226, 0.1, knee);
    return { hip: hip, knee: knee, paw: paw };
  }
  var legs = { fl: makeLeg(-0.15, -0.09, 0.24, false), fr: makeLeg(0.15, -0.09, 0.24, false), hl: makeLeg(-0.19, -0.04, -0.28, true), hr: makeLeg(0.19, -0.04, -0.28, true) };

  // 尾巴：一節一節接起來，可以甩動
  var tailBase = grp(body, 0, 0.06, -0.5), tail = [], tp = tailBase;
  for (var i = 0; i < 18; i++) {
    var seg = grp(tp, 0, i === 0 ? 0 : 0.04, 0), rad = 0.092 - i * 0.0021 - (i > 15 ? 0.01 : 0);
    ell(rad, 0.058, rad, matTail, 0, 0.02, 0, seg);
    tail.push(seg); tp = seg;
  }

  // ── 姿勢：每個關節的目標角度，動畫時平滑地靠過去 ──
  var POSE = {
    run: { bodyY: 0.47, bodyPitch: 0.0, head: 0.0, fHip: 0, fKnee: 0, hHip: 0, hKnee: 0, tailPitch: -2.15, tailCurl: 0.16, squash: 1, widen: 1, spin: 0 },
    sit: { bodyY: 0.31, bodyPitch: -1.05, head: -0.08, fHip: 1.05, fKnee: 0, hHip: -1.35, hKnee: 1.9, tailPitch: -1.65, tailCurl: 0.0, squash: 1, widen: 1.2, spin: 0 },
    lie: { bodyY: 0.34, bodyPitch: 0.0, head: -0.25, fHip: -0.55, fKnee: 1.7, hHip: -0.35, hKnee: 1.2, tailPitch: -1.85, tailCurl: 0.3, squash: 1, widen: 1, spin: 0 },
    roll: { bodyY: 0.34, bodyPitch: 0.0, head: 0.75, fHip: -1.15, fKnee: 2.2, hHip: -1.25, hKnee: 2.3, tailPitch: -1.2, tailCurl: 0.5, squash: 0.68, widen: 1, spin: 1 },
  };
  var cur = JSON.parse(JSON.stringify(POSE.sit)); cur.rigY = 0; cur.squash = 1; cur.flip = 0; cur.widen = 1;
  function approach(k, to, dt, rate) { cur[k] += (to - cur[k]) * Math.min(1, dt * rate); }

  // ── 行為：到處跑、坐下、打滾（座標是畫面像素） ──
  var W = 0, H = 0;
  function measure() { W = win.innerWidth; H = win.innerHeight; }
  function bounds() { var top = Math.min(130, H * 0.22); return { l: 70, r: W - 70, t: top, b: Math.max(top + 40, H - 100) }; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  var cat = { x: 0, y: 0, yaw: 0, state: "sit", t: 0, wait: 1, phase: 0, tx: 0, ty: 0, speed: 0, rollLeft: 0, rollDir: 1, spin: 0, lieDir: 1, blink: 2, ear: 3, earT: -1 };
  function setState(s, wait) { if (s === "lie") cat.lieDir = Math.random() < 0.5 ? -1 : 1; cat.state = s; api.state = s; cat.t = 0; cat.wait = wait || 0; }
  function place() { var b = bounds(); cat.x = rnd(b.l, b.r); cat.y = rnd(b.t, b.b); cat.yaw = 0; setState("sit", rnd(0.8, 1.6)); }
  function next() {
    var b = bounds(), r = Math.random();
    if (r < 0.6) {
      cat.tx = rnd(b.l, b.r); cat.ty = rnd(b.t, b.b);
      if (Math.hypot(cat.tx - cat.x, cat.ty - cat.y) < 110) cat.tx = Math.min(b.r, Math.max(b.l, cat.x + (cat.x > W / 2 ? -1 : 1) * rnd(140, 220)));
      cat.speed = rnd(120, 175); setState("run");
    } else if (r < 0.85) {
      cat.rollDir = cat.x > W * 0.65 ? -1 : cat.x < W * 0.35 ? 1 : (Math.random() < 0.5 ? -1 : 1);
      cat.rollLeft = rnd(120, 220); cat.spin = 0; setState("roll");
    } else if (r < 0.93) setState("lie", rnd(2.4, 4.2));
    else setState("sit", rnd(1.6, 3));
  }
  function turnTo(a, dt, rate) { var d = a - cat.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; cat.yaw += d * Math.min(1, dt * rate); }

  function update(dt) {
    var b = bounds();
    cat.t += dt; cat.blink -= dt; cat.ear -= dt;
    if (cat.state === "sit" || cat.state === "lie") {
      turnTo(cat.state === "lie" ? cat.lieDir * Math.PI / 2 : 0.35 * Math.sin(cat.t * 0.4), dt, 4);                       // 面向你，微微轉動
      if (cat.t >= cat.wait) { if (cat.state === "lie") setState("sit", rnd(0.8, 1.6)); else next(); }
    } else if (cat.state === "run") {
      var dx = cat.tx - cat.x, dy = cat.ty - cat.y, d = Math.hypot(dx, dy);
      if (d < 10) { if (Math.random() < 0.3) { cat.rollDir = cat.x > W / 2 ? -1 : 1; cat.rollLeft = rnd(120, 190); cat.spin = 0; setState("roll"); } else setState("sit", rnd(1.4, 3)); return; }
      var v = cat.speed * Math.min(1, cat.t / 0.4) * Math.min(1, d / 50 + 0.4);
      cat.x += dx / d * v * dt; cat.y += dy / d * v * dt;
      turnTo(Math.atan2(dx, dy), dt, 7);
      cat.phase += v * dt * 0.052;
    } else {
      var step = 135 * dt, nx = cat.x + cat.rollDir * step;
      turnTo(cat.rollDir * Math.PI / 2, dt, 8);
      if (nx < b.l || nx > b.r) cat.rollDir = -cat.rollDir; else cat.x = nx;
      cat.spin += step / 26; cat.rollLeft -= step;
      if (cat.rollLeft <= 0) setState(Math.random() < 0.45 ? "lie" : "sit", rnd(1.6, 3.2));
    }
    cat.x = Math.min(b.r, Math.max(b.l, cat.x)); cat.y = Math.min(b.b, Math.max(b.t, cat.y));
    api.x = cat.x; api.y = cat.y;
  }

  function animate(dt, now) {
    var P = POSE[cat.state] || POSE.sit, rate = 9;
    ["bodyY", "bodyPitch", "head", "fHip", "fKnee", "hHip", "hKnee", "tailPitch", "tailCurl", "squash", "widen"].forEach(function (k) { approach(k, P[k], dt, rate); });
    var running = cat.state === "run", ph = cat.phase;
    var sw = running ? 0.78 : 0, lift = running ? 1.05 : 0;
    var bob = running ? Math.abs(Math.sin(ph)) * 0.035 : 0;
    body.scale.set(cur.widen, 1 + (1 - cur.squash) * 0.25, cur.squash); body.position.y = cur.bodyY + bob; body.rotation.x = cur.bodyPitch + (running ? Math.sin(ph * 2) * 0.03 : 0);
    // 步態：對角兩隻腳同步（小跑步）
    var a1 = Math.sin(ph) * sw, a2 = Math.sin(ph + Math.PI) * sw;
    var k1 = running ? Math.max(0, Math.cos(ph)) * lift : 0, k2 = running ? Math.max(0, Math.cos(ph + Math.PI)) * lift : 0;
    legs.fl.hip.rotation.x = cur.fHip + a1; legs.hr.hip.rotation.x = cur.hHip + a1 * 0.9;
    legs.fr.hip.rotation.x = cur.fHip + a2; legs.hl.hip.rotation.x = cur.hHip + a2 * 0.9;
    legs.fl.knee.rotation.x = cur.fKnee + k1; legs.hr.knee.rotation.x = cur.hKnee - k1 * 0.9;
    legs.fr.knee.rotation.x = cur.fKnee + k2; legs.hl.knee.rotation.x = cur.hKnee - k2 * 0.9;
    // 頭：坐著時東張西望、跑步時朝前
    var lookY = cat.state === "sit" ? Math.sin(now * 0.0011) * 0.4 : 0;
    head.rotation.set(cur.head - body.rotation.x + (running ? Math.sin(ph * 2) * 0.03 : 0), lookY, cat.state === "sit" ? Math.sin(now * 0.0017) * 0.07 : 0);
    // 尾巴：根部朝後上方翹，每一節慢慢甩
    tailBase.rotation.x = cur.tailPitch;
    for (var i = 0; i < tail.length; i++) {
      tail[i].rotation.z = Math.sin(now * 0.0036 + i * 0.24) * (running ? 0.055 : 0.075);
      tail[i].rotation.x = cur.tailCurl * (i === 0 ? 0 : 0.2) + (cat.state === "sit" ? 0.045 : 0);
    }
    // 眨眼、耳朵抖一下
    var blinking = cat.blink < 0.13 && cat.blink > 0;
    if (cat.blink < -0.05) cat.blink = rnd(1.8, 4);
    eyes.forEach(function (e) { e.scale.y += ((blinking ? 0.08 : 1) - e.scale.y) * 0.7; });
    if (cat.ear < 0 && cat.earT < 0) { cat.earT = 0.28; cat.ear = rnd(2.5, 6); }
    if (cat.earT >= 0) { cat.earT -= dt; ears[Math.random() < 0.5 ? 0 : 1].rotation.z += Math.sin(cat.earT * 40) * 0.01; }
    // 打滾：整隻繞著身體的長軸轉
    // 打滾：縮成一球朝前翻滾（繞著身體左右軸轉），球心離地一個半徑
    var rolling = cat.state === "roll", lying = cat.state === "lie";
    cur.rigY += (((rolling || lying) ? 0.36 : 0) - cur.rigY) * Math.min(1, dt * 9);
    cur.flip += ((lying ? 1 : 0) - cur.flip) * Math.min(1, dt * 7);
    rig.rotation.z = cur.flip * Math.PI;
    if (lying) { var wg = Math.sin(now * 0.004) * 0.18; legs.fl.hip.rotation.x += wg; legs.fr.hip.rotation.x -= wg; legs.hl.hip.rotation.x -= wg * 0.7; legs.hr.hip.rotation.x += wg * 0.7; }
    rig.position.y = cur.rigY; body.position.y -= cur.rigY;
    if (rolling) rig.rotation.x = cat.spin; else rig.rotation.x += (Math.round(rig.rotation.x / 6.2832) * 6.2832 - rig.rotation.x) * Math.min(1, dt * 9);
    root.rotation.y = cat.yaw;
  }

  function place2d() {
    var b = bounds(), depth = 0.82 + 0.34 * ((cat.y - b.t) / Math.max(1, b.b - b.t)); // 越靠下越大一點，有遠近感
    canvas.style.transform = "translate3d(" + (cat.x - SIZE / 2).toFixed(1) + "px," + (cat.y - FEET).toFixed(1) + "px,0) scale(" + depth.toFixed(3) + ")";
  }

  api.force = function (s) {
    if (s === "roll") { cat.rollLeft = 260; cat.spin = 0; cat.rollDir = 1; }
    if (s === "run") { var b = bounds(); cat.tx = b.r; cat.ty = cat.y; cat.speed = 150; }
    setState(s, 99);
  };
  api.cat = cat; api.feet = FEET; api.size = SIZE;

  var lastT = 0, stopped = false;
  function frame(ts) {
    if (stopped) return;
    win.requestAnimationFrame(frame);
    if (ts - lastT < 33) return; // 約 30 幀就夠，省電
    var dt = lastT ? Math.min(0.06, (ts - lastT) / 1000) : 0.033; lastT = ts;
    update(dt); animate(dt, ts); place2d();
    renderer.render(scene, camera);
  }
  api.stop = function () { stopped = true; if (canvas.parentNode) canvas.parentNode.removeChild(canvas); if (renderer.dispose) renderer.dispose(); };
  if (canvas.addEventListener) canvas.addEventListener("webglcontextlost", function (e) { if (e.preventDefault) e.preventDefault(); api.stop(); if (env.onLost) env.onLost(); });
  measure(); place();
  doc.body.appendChild(canvas);
  win.addEventListener("resize", measure);
  api.ready = true;
  win.requestAnimationFrame(frame);
  return api;
}
