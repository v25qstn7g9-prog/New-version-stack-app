// Z∞ Assets 小白貓載入器（純裝飾，只管畫面：不呼叫 API、不碰儲存、不能點、不擋任何按鈕）。
// 優先載入立體版小貓（za-cat3d.js + vendor/three.module.min.js，WebGL）；裝置不支援、載入失敗或 WebGL 中途掛掉時，
// 改載手繪平面版（za-cat2d.js）。開了「減少動態效果」就完全不啟動。等頁面載入完再慢慢載，不拖慢開啟速度。
(function () {
  if (window.__zaCatLoader) return;
  window.__zaCatLoader = true;
  var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq && mq.matches) return;

  var fell = false;
  function fallback2d() {
    if (fell) return;
    fell = true;
    var s = document.createElement("script");
    s.src = "/za-cat2d.js?v=2"; s.defer = true;
    document.body.appendChild(s);
  }
  function hasWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
    } catch (e) { return false; }
  }
  function go() {
    if (!hasWebGL() || !("noModule" in HTMLScriptElement.prototype)) return fallback2d();
    var load;
    try { load = new Function("u", "return import(u)"); } catch (e) { return fallback2d(); }
    Promise.all([load("/vendor/three.module.min.js?v=160"), load("/za-cat3d.js?v=1")])
      .then(function (m) { m[1].start(m[0], { onLost: fallback2d }); })
      .catch(fallback2d);
  }
  function later() { setTimeout(go, 1200); }
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later);
})();
