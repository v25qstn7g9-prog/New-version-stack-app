// Z∞ Assets 小白貓（真貓照片版，只管畫面：不碰儲存、不寫任何資料）。
// 用 Johnny 家那隻白貓的去背照片，坐在標題列「存股資產追蹤」跟右上角按鈕之間的空位上，跟著標題列一起捲動，
// 所以不會蓋到任何數字或資產曲線；空位放不下 36px 的可點範圍就先不顯示（不會擋到標題或右上角按鈕）。
// 心情來自 GET /api/spider 的 mood（up→開心、flat→悠閒、down→難過），只在載入時讀一次、只記在記憶體；
// token 跟 portfolio-sync 同一份（index.html 提供 window.zaGetSyncToken），只放 Authorization header。
// 沒 token、401／403、found:false、任何失敗 → 固定「悠閒」，絕不用假資料。
// 摸摸：點一下依心情隨機反應；2 秒內點超過 4 下會哈氣、冷靜 3 秒；長按約 0.6 秒會呼嚕、冒愛心。
// 「減少動態效果」：反應改成不動的樣子變化＋短短的文字泡泡，不做任何動畫。
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
  document.head.appendChild(css);

  var box = document.createElement("button");
  box.type = "button";
  box.className = "za-photocat";
  var img = document.createElement("img");
  img.alt = ""; img.width = 400; img.height = 503; img.decoding = "async"; img.draggable = false;
  img.src = "/za-cat-photo.webp?v=1";
  img.onerror = function () { if (box.parentNode) box.parentNode.removeChild(box); api.shown = false; api.failed = true; };
  box.appendChild(img);
  var bubble = null, bubbleTimer = 0, clsTimer = 0;
  function setMood(m) {
    api.mood = MOOD_LABEL[m] ? m : "relaxed";
    box.setAttribute("data-mood", api.mood);
    box.setAttribute("aria-label", "白貓，心情：" + MOOD_LABEL[api.mood]);
  }
  setMood("relaxed");
  api.setMood = setMood;

  // ── 心情：讀一次 /api/spider（只記在記憶體） ──
  var moodLoaded = false;
  function loadMood() {
    if (moodLoaded) return;
    var get = window.zaGetSyncToken;
    if (typeof get !== "function") return;               // App 還沒讀到 token，等 za-sync-token 事件
    moodLoaded = true;
    var tok = String(get() || "").trim();
    if (!tok || typeof fetch !== "function") { setMood("relaxed"); return; }
    api.moodPromise = fetch("/api/spider", { cache: "no-store", headers: { accept: "application/json", authorization: "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { setMood(moodFrom(j)); }, function () { setMood("relaxed"); });
  }
  window.addEventListener("za-sync-token", loadMood);
  loadMood();

  // ── 反應 ──
  var taps = [], coolUntil = 0;
  function now() { return Date.now(); }
  function show(r) {
    api.last = r.k;
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

  // ── 位置：只坐在標題與右上角按鈕之間的空位 ──
  function place() {
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
})();
