// Z∞ Assets 小白貓（真貓照片版，只管畫面：不碰儲存、不寫任何資料）。
// 用 Johnny 家那隻白貓的去背照片，坐在標題列「存股資產追蹤」跟右上角按鈕之間的空位上，跟著標題列一起捲動，
// 所以不會蓋到任何數字或資產曲線；空位放不下 36px 的可點範圍就先不顯示（不會擋到標題或右上角按鈕）。
// 心情來自 GET /api/spider 的 mood（up→開心、flat→悠閒、down→難過），只在載入時讀一次、只記在記憶體；
// token 跟 portfolio-sync 同一份（index.html 提供 window.zaGetSyncToken），只放 Authorization header。
// 沒 token、401／403、found:false、任何失敗 → 固定「悠閒」，絕不用假資料。
// 摸摸：點一下依心情隨機反應；2 秒內點超過 4 下會哈氣、冷靜 3 秒；長按約 0.6 秒會呼嚕、冒愛心。
// 「減少動態效果」：反應改成不動的樣子變化＋短短的文字泡泡，不做任何動畫，也不會到處走。
// 真貓動作：Johnny 給的兩段影片，去背後切成坐著眨眼、盯著你、走路、低頭、翹尾巴走過來、趴著呼嚕六段（za-cat-sprite.webp）；
// 依心情、走路／休息、你點牠或摸牠來挑要播哪段。圖載不到時維持原本的照片。
// 沒開「減少動態效果」時，za-catroam.js 會讓牠在畫面上走來走去，只停在沒有數字／圖表的空白處。
(function () {
  if (window.__zaPhotoCat) return;
  var api = window.__zaPhotoCat = { shown: false, mood: "relaxed", last: null };
  var RATIO = 503 / 400, PAD = 6, MAXW = 36, MINW = 36, BUBBLE_MS = 1500, LONG_MS = 600, RAPID_N = 4, RAPID_MS = 2000, COOL_MS = 3000;
  var MOOD_LABEL = { happy: "開心", relaxed: "悠閒", sad: "難過，想撒嬌" };
  var REACT = {
    happy: [{ k: "jump", t: "呼嚕呼嚕～" }, { k: "wiggle", t: "喵！好開心" }],
    relaxed: [{ k: "blink", t: "喵~" }, { k: "stretch", t: "伸個懶腰～" }],
    sad: [{ k: "shrink", t: "蹭蹭…" }, { k: "cling", t: "需要秀秀" }],
    hiss: { k: "hiss", t: "哈～！別一直戳" },
    pet: { k: "pet", t: "呼嚕～♥" }
  };
  function moodFrom(j) {
    if (!j || j.ok !== true || j.found !== true) return "relaxed";
    return j.mood === "up" ? "happy" : j.mood === "down" ? "sad" : "relaxed";
  }
  api.moodFrom = moodFrom;

  var css = document.createElement("style");
  css.textContent =
    ".za-photocat{position:absolute;z-index:1;padding:0;margin:0;border:0;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;transform-origin:50% 100%;animation:za-pc-sway 7s ease-in-out infinite;border-radius:10px}" +
    // 標題列的按鈕樣式（最小寬度 58px、深藍主題的底色）不要套到小貓身上：小貓的大小就是照片大小
    "html .premium-header button.za-photocat.za-photocat.za-photocat{min-width:0!important;min-height:0!important;background:none!important;border:0!important;box-shadow:none!important;padding:0!important;color:inherit!important}" +
    ".za-photocat:focus-visible{outline:2px solid var(--c-accent,#44749d);outline-offset:2px}" +
    ".za-pc-face{display:block;width:100%;height:100%;pointer-events:none}" +
    ".za-photocat img{display:block;width:100%;height:auto;transform-origin:50% 100%;animation:za-pc-breathe 3.8s ease-in-out infinite;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));-webkit-user-drag:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;pointer-events:none}" +
    ".za-photocat[data-mood=happy] img{animation-duration:2.6s}" +
    ".za-photocat[data-mood=sad] img{filter:drop-shadow(0 2px 3px rgba(0,0,0,.28)) saturate(.75) brightness(.95);transform:scale(.97,.94)}" +
    ".za-pc-bubble{position:absolute;bottom:calc(100% - 4px);left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;line-height:1.3;font-weight:700;padding:2px 6px;border-radius:8px;background:var(--c-card,#fff);color:var(--c-ink,#19233d);box-shadow:0 2px 6px rgba(0,0,0,.25);pointer-events:none;animation:za-pc-pop .2s ease-out}" +
    ".za-pc-heart{position:absolute;top:0;font-size:10px;color:#ff6b8a;pointer-events:none;animation:za-pc-heart 1.2s ease-out forwards}" +
    "@keyframes za-pc-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03,1.045)}}" +
    "@keyframes za-pc-sway{0%,70%,100%{transform:rotate(0)}78%{transform:rotate(-4deg)}86%{transform:rotate(3deg)}92%{transform:rotate(-1deg)}}" +
    "@keyframes za-pc-pop{from{opacity:0;transform:translate(-50%,3px)}to{opacity:1;transform:translate(-50%,0)}}" +
    "@keyframes za-pc-heart{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-14px)}}" +
    ".za-photocat.r-jump img{animation:za-pc-jump .6s ease-out}@keyframes za-pc-jump{30%{transform:translateY(-8px) scale(1.02,.98)}60%{transform:translateY(0) scale(1.05,.94)}}" +
    ".za-photocat.r-wiggle img{animation:za-pc-wig .6s ease-in-out}@keyframes za-pc-wig{25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}" +
    ".za-photocat.r-blink img{animation:za-pc-blink 1s ease-in-out}@keyframes za-pc-blink{50%{transform:scale(1,.96);filter:brightness(.92)}}" +
    ".za-photocat.r-stretch img{animation:za-pc-stretch 1.1s ease-in-out}@keyframes za-pc-stretch{40%{transform:scale(1.12,.9)}}" +
    ".za-photocat.r-shrink img{animation:za-pc-shrink 1.2s ease-in-out}@keyframes za-pc-shrink{50%{transform:scale(.88)}}" +
    ".za-photocat.r-cling img{animation:za-pc-cling 1.2s ease-in-out}@keyframes za-pc-cling{25%,75%{transform:translateX(-3px) rotate(-5deg)}50%{transform:translateX(2px) rotate(3deg)}}" +
    ".za-photocat.r-hiss img{animation:za-pc-hiss .5s ease-out;filter:drop-shadow(0 0 4px rgba(255,92,92,.8))}@keyframes za-pc-hiss{20%{transform:scale(1.1,.92)}40%{transform:scale(1.06) translateX(-2px)}60%{transform:scale(1.06) translateX(2px)}}" +
    ".za-photocat.r-pet img{animation:za-pc-pet 1.2s ease-in-out;filter:drop-shadow(0 0 5px rgba(255,150,180,.8))}@keyframes za-pc-pet{50%{transform:scale(1.04,.96)}}" +
    // 減少動態效果：沒有任何動畫，只換成不動的樣子
    "@media (prefers-reduced-motion:reduce){.za-photocat,.za-photocat img,.za-pc-bubble,.za-pc-heart{animation:none!important}" +
    ".za-photocat.r-jump img,.za-photocat.r-wiggle img{transform:scale(1.04)}.za-photocat.r-blink img{filter:brightness(.92)}.za-photocat.r-stretch img{transform:scale(1.08,.94)}" +
    ".za-photocat.r-shrink img,.za-photocat.r-cling img{transform:scale(.9)}.za-photocat.r-hiss img{transform:scale(1.06)}.za-photocat.r-pet img{transform:scale(1.03)}}";
  css.textContent += css.textContent.replace(/ img/g, " canvas.za-pc-sprite");   // 真貓動作的畫布套用同一組樣式與反應
  document.head.appendChild(css);

  var box = document.createElement("button");
  box.type = "button";
  box.className = "za-photocat";
  var img = document.createElement("img");
  img.alt = ""; img.width = 400; img.height = 503; img.decoding = "async"; img.draggable = false;
  img.src = "/za-cat-photo.webp?v=1";
  img.onerror = function () { if (box.parentNode) box.parentNode.removeChild(box); api.shown = false; api.failed = true; };
  var face = document.createElement("span"); face.className = "za-pc-face"; // 走路轉向時只翻轉照片，不翻轉泡泡文字
  face.appendChild(img); box.appendChild(face); api.box = box; api.face = face;

  // ── 真貓動作（影片去背的雪碧圖） ──
  var SPRITE = {"frame":[128,160],"fps":12,"actions":{"sit":{"start":0,"count":24,"play":"pingpong"},"look":{"start":24,"count":24,"play":"pingpong"},"walk":{"start":48,"count":18,"play":"loop"},"sad":{"start":66,"count":12,"play":"pingpong"},"happy":{"start":78,"count":12,"play":"once"},"loaf":{"start":90,"count":7,"play":"pingpong"}},"cols":12,"rows":9,"total":97};
  var FPS = { happy: 15, relaxed: 12, sad: 8 };
  var REACT_SPRITE = { jump: "happy", wiggle: "happy", blink: "look", stretch: "look", shrink: "sad", cling: "sad", pet: "loaf" };
  // 現在要播哪一段：你點／摸牠的反應優先，其次走路，再來依心情休息（t 是秒）
  function spriteAction(mood, motion, reaction, nap, t) {
    if (reaction && SPRITE.actions[reaction]) return reaction;
    if (motion === "walk") return "walk";
    if (mood === "sad") return Math.floor(t / 7) % 2 ? "loaf" : "sad";
    if (nap) return "loaf";
    return Math.floor(t / 6) % 3 === 2 ? "look" : "sit";
  }
  // 第幾格：loop 循環、pingpong 來回、once 播完停在最後一格
  function spriteFrame(name, elapsed, fps) {
    var a = SPRITE.actions[name], k = Math.max(0, Math.floor(elapsed * fps)), n = a.count;
    if (a.play === "once") return a.start + Math.min(k, n - 1);
    if (a.play === "pingpong" && n > 1) { var per = 2 * n - 2, j = k % per; return a.start + (j < n ? j : per - j); }
    return a.start + (k % n);
  }
  api.spriteAction = spriteAction; api.spriteFrame = spriteFrame; api.sprite = SPRITE;
  var spr = null, sctx = null, atlas = null, cur = null, curSince = 0, lastIdx = -1, reaction = null, reactUntil = 0, t0 = 0;
  var still = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function drawIdx(i) {
    if (!sctx || i === lastIdx) return;
    lastIdx = i;
    var fw = SPRITE.frame[0], fh = SPRITE.frame[1], c = i % SPRITE.cols, r = Math.floor(i / SPRITE.cols);
    sctx.clearRect(0, 0, fw, fh); sctx.drawImage(atlas, c * fw, r * fh, fw, fh, 0, 0, fw, fh);
  }
  function tick() {
    if (!sctx) return;
    var ms = Date.now(), t = ms / 1000; if (!t0) t0 = t;
    if (reaction && ms > reactUntil) reaction = null;
    var roam = api.roam && api.roam.core && api.roam.core.state;
    var name = spriteAction(api.mood, roam ? roam.mode : "rest", reaction, box.classList.contains("za-nap"), t - t0);
    if (name !== cur) { cur = name; curSince = t; api.action = name; }
    drawIdx(still ? SPRITE.actions[name].start : spriteFrame(name, t - curSince, FPS[api.mood] || 12));
    if (!still) requestAnimationFrame(tick);
  }
  api.spriteReact = function (k, ms) {
    var n = REACT_SPRITE[k]; if (!n || !SPRITE.actions[n]) return null;
    var a = SPRITE.actions[n];
    reaction = n; reactUntil = (ms == null ? Date.now() : ms) + Math.max(1500, a.count / 12 * 1000 * (a.play === "pingpong" ? 2 : 1));
    if (still && sctx) tick();
    return n;
  };
  if (typeof Image === "function") {
    atlas = new Image(); atlas.decoding = "async";
    atlas.onload = function () {
      spr = document.createElement("canvas"); spr.className = "za-pc-sprite";
      spr.width = SPRITE.frame[0]; spr.height = SPRITE.frame[1];
      spr.setAttribute("aria-hidden", "true");
      sctx = spr.getContext && spr.getContext("2d");
      if (!sctx) return;
      spr.style.cssText = "display:block;width:100%;height:auto;pointer-events:none";
      face.appendChild(spr); img.style.display = "none"; api.spriteReady = true;
      api.onMood = function () { if (still) tick(); };
      requestAnimationFrame(tick);
    };
    atlas.src = "/za-cat-sprite.webp?v=1";
  }
  var bubble = null, bubbleTimer = 0, clsTimer = 0;
  function setMood(m) {
    api.mood = MOOD_LABEL[m] ? m : "relaxed";
    box.setAttribute("data-mood", api.mood);
    box.setAttribute("aria-label", "白貓，心情：" + MOOD_LABEL[api.mood]);
    if (api.onMood) api.onMood();
  }
  setMood("relaxed");
  api.setMood = setMood;

  // ── 心情：讀一次 /api/spider（只記在記憶體） ──
  // 每個 token 只讀一次：token 還沒讀到（空的）就先悠閒、不上鎖；之後 token 出現或在計畫設定換掉時，
  // App 會再發 za-sync-token 事件，這時才讀（同一個 token 不重讀；沒有定時輪詢）。
  var lastTok = null, seq = 0;
  function loadMood() {
    var get = window.zaGetSyncToken;
    if (typeof get !== "function") return;               // App 還沒讀到 token，等 za-sync-token 事件
    var tok = String(get() || "").trim();
    if (tok === lastTok) return;                          // 同一個 token：不重讀
    lastTok = tok;
    var my = ++seq;                                       // 換 token 時，舊的回應作廢
    if (!tok || typeof fetch !== "function") { setMood("relaxed"); return; }
    api.moodPromise = fetch("/api/spider", { cache: "no-store", headers: { accept: "application/json", authorization: "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (my === seq) setMood(moodFrom(j)); }, function () { if (my === seq) setMood("relaxed"); });
  }
  // 在計畫設定打字時 token 每個字都會變：等停手 0.8 秒再讀，避免一路打一路送。
  var tokTimer = 0;
  window.addEventListener("za-sync-token", function () { clearTimeout(tokTimer); tokTimer = setTimeout(loadMood, 800); });
  loadMood();

  // ── 反應 ──
  var taps = [], coolUntil = 0;
  function now() { return Date.now(); }
  function show(r) {
    api.last = r.k;
    if (api.spriteReady) api.spriteReact(r.k);
    box.classList.remove("r-" + (api.lastCls || "x")); void box.offsetWidth;
    box.classList.add("r-" + r.k); api.lastCls = r.k;
    clearTimeout(clsTimer); clsTimer = setTimeout(function () { box.classList.remove("r-" + r.k); }, BUBBLE_MS);
    if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble);
    bubble = document.createElement("span"); bubble.className = "za-pc-bubble"; bubble.setAttribute("aria-hidden", "true");
    bubble.textContent = r.t; box.appendChild(bubble); api.bubble = r.t;
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(function () { if (bubble && bubble.parentNode) bubble.parentNode.removeChild(bubble); bubble = null; api.bubble = null; }, BUBBLE_MS);
    if (r.k === "pet") for (var i = 0; i < 3; i++) {
      var h = document.createElement("span"); h.className = "za-pc-heart"; h.setAttribute("aria-hidden", "true"); h.textContent = "♥";
      h.style.left = (6 + i * 10) + "px"; h.style.animationDelay = (i * 0.15) + "s"; box.appendChild(h);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, BUBBLE_MS); })(h);
    }
    try { if (navigator.vibrate) navigator.vibrate(r.k === "hiss" ? [20, 40, 20] : 10); } catch (e) {}
    return r.k;
  }
  // 點一下：t = 現在時間（測試可傳入），rnd = 亂數（測試可傳入）
  api.tap = function (t, rnd) {
    t = t == null ? now() : t;
    if (t < coolUntil) return null;                       // 生氣冷靜中：不理你
    taps = taps.filter(function (x) { return t - x < RAPID_MS; }); taps.push(t);
    if (taps.length > RAPID_N) { taps = []; coolUntil = t + COOL_MS; return show(REACT.hiss); }
    var list = REACT[api.mood] || REACT.relaxed;
    return show(list[Math.floor((rnd == null ? Math.random() : rnd) * list.length) % list.length]);
  };
  api.pet = function (t) { t = t == null ? now() : t; if (t < coolUntil) return null; return show(REACT.pet); };

  var pressTimer = 0, longFired = false;
  box.addEventListener("pointerdown", function () { longFired = false; clearTimeout(pressTimer); pressTimer = setTimeout(function () { longFired = true; api.pet(); }, LONG_MS); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (n) { box.addEventListener(n, function () { clearTimeout(pressTimer); }); });
  box.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  box.addEventListener("click", function (e) { e.preventDefault(); if (longFired) { longFired = false; return; } api.tap(); });  // Enter／Space 也會觸發 click

  // ── 位置：只坐在標題與右上角按鈕之間的空位（會走動的版本 za-catroam.js 接手時，這裡只負責算空位） ──
  // 回傳標題列空位在畫面上的位置（給走動版當「回家」的休息點）；放不下寬 w 的貓就回 null。
  api.headerGap = function (w) {
    var row = document.querySelector(".premium-header .justify-between");
    var h1 = row && row.querySelector("h1"), btns = h1 && h1.nextElementSibling;
    if (!row || !h1 || !btns) return null;
    var title = h1.firstElementChild || h1;
    var rr = row.getBoundingClientRect(), tr = title.getBoundingClientRect(), br = btns.getBoundingClientRect();
    var gap = br.left - tr.right - PAD * 2;
    if (gap < w) return null;
    var h = w * RATIO;
    return { x: tr.right + PAD + (gap - w) / 2, y: rr.bottom - h, w: w, h: h, gapL: tr.right, gapR: br.left };
  };
  function place() {
    if (api.roam) { api.roam.refresh(); return; }
    var row = document.querySelector(".premium-header .justify-between");
    var h1 = row && row.querySelector("h1"), btns = h1 && h1.nextElementSibling;
    if (!row || !h1 || !btns || api.failed) { hide(); return; }
    var title = h1.firstElementChild || h1;
    var rr = row.getBoundingClientRect(), tr = title.getBoundingClientRect(), br = btns.getBoundingClientRect();
    var gap = br.left - tr.right - PAD * 2, w = Math.min(MAXW, gap);
    if (w < MINW) { hide(); return; }
    if (getComputedStyle(row).position === "static") row.style.position = "relative";
    if (box.parentNode !== row) row.appendChild(box);
    var h = w * RATIO;
    box.style.width = w.toFixed(1) + "px";
    box.style.height = h.toFixed(1) + "px";
    box.style.left = (tr.right - rr.left + PAD + (gap - w) / 2).toFixed(1) + "px";
    box.style.top = (rr.height - h).toFixed(1) + "px";
    box.style.display = "";
    api.shown = true; api.width = w;
  }
  function hide() { box.style.display = "none"; api.shown = false; }
  var queued = false;
  function soon() { if (queued) return; queued = true; requestAnimationFrame(function () { queued = false; place(); }); }
  api.place = place;
  window.addEventListener("resize", soon);
  // 畫面是 React 畫的：標題文字（中／英切換）或標題列重畫時重新找位置（自己的泡泡、愛心變動不算）。
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) if (!box.contains(list[i].target)) { soon(); return; }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (img.complete) place(); else img.addEventListener("load", place);
  place();
  // 沒開「減少動態效果」才讓貓到處走（za-catroam.js）；開了就一直坐在標題列空位。
  var rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!(rm && rm.matches) && !window.__zaNoRoam) {
    var sc = document.createElement("script"); sc.src = "/za-catroam.js?v=1"; sc.defer = true;
    document.body.appendChild(sc);
  }
})();
