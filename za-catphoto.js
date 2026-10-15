// Z∞ Assets 小白貓（真貓照片版，純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 用 Johnny 家那隻白貓的去背照片，坐在標題列「存股資產追蹤」跟右上角按鈕之間的空位上，跟著標題列一起捲動，
// 所以不會蓋到任何數字或資產曲線；空位不夠（例如英文標題太長）就先不顯示。
// 會輕輕呼吸、偶爾左右晃一下（CSS 動畫）；開了「減少動態效果」根本不會載入（見 za-cat.js）。
(function () {
  if (window.__zaPhotoCat) return;
  var api = window.__zaPhotoCat = { shown: false };
  var RATIO = 503 / 400, PAD = 6, MAXW = 36, MINW = 26;

  var css = document.createElement("style");
  css.textContent =
    ".za-photocat{position:absolute;pointer-events:none;z-index:1;transform-origin:50% 100%;animation:za-pc-sway 7s ease-in-out infinite}" +
    ".za-photocat img{display:block;width:100%;height:auto;transform-origin:50% 100%;animation:za-pc-breathe 3.8s ease-in-out infinite;filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));-webkit-user-drag:none;user-select:none}" +
    "@keyframes za-pc-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.03,1.045)}}" +
    "@keyframes za-pc-sway{0%,70%,100%{transform:rotate(0)}78%{transform:rotate(-4deg)}86%{transform:rotate(3deg)}92%{transform:rotate(-1deg)}}" +
    "@media (prefers-reduced-motion:reduce){.za-photocat,.za-photocat img{animation:none!important}}";
  document.head.appendChild(css);

  var box = document.createElement("span");
  box.className = "za-photocat";
  box.setAttribute("aria-hidden", "true");
  var img = document.createElement("img");
  img.alt = ""; img.width = 400; img.height = 503; img.decoding = "async"; img.draggable = false;
  img.src = "/za-cat-photo.webp?v=1";
  img.onerror = function () { if (box.parentNode) box.parentNode.removeChild(box); api.shown = false; api.failed = true; };
  box.appendChild(img);

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
  // 畫面是 React 畫的：標題文字（中／英切換）或標題列重畫時重新找位置。
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) if (!box.contains(list[i].target)) { soon(); return; }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  if (img.complete) place(); else img.addEventListener("load", place);
  place();
})();
