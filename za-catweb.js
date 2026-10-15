// Z∞ Assets「蜘蛛圖」：中間一隻真的小白貓，線連到六個參數點（殖利率、本益比、股價淨值比、波動度、配息穩定、持股比重）。
// 只管畫面：讀 GET /api/spider（草稿格式，後端尚未完成）；讀不到、404 或格式不對就用內建示意資料。不寫任何資料。
// 格式：{ ok, asOf, axes[], mood:'up'|'flat'|'down', holdings:[{ code, name, raw:{...}, score:{0-100} }] }；null 一律顯示「—」。
(function () {
  if (window.ZaSpider) return;
  var AXES = ["yield", "pe", "pb", "volatility", "divStability", "weight"];
  var LABEL = { yield: "殖利率", pe: "本益比", pb: "股價淨值比", volatility: "波動度", divStability: "配息穩定", weight: "持股比重" };
  var EN = { yield: "Yield", pe: "P/E", pb: "P/B", volatility: "Volatility", divStability: "Div. stability", weight: "Weight" };
  var UNIT = { yield: "%", volatility: "%", weight: "%", divStability: "%" };
  var MOOD = { up: "開心", flat: "悠閒", down: "不太開心" };
  var FIXTURE = {
    ok: true, asOf: "2026-10-15T13:30:00+08:00", axes: AXES, mood: "flat", mock: true,
    holdings: [
      { code: "0056", name: "元大高股息", raw: { yield: 7.1, pe: 14.2, pb: 1.6, volatility: 12.4, divStability: 92, weight: 38.5 },
        score: { yield: 88, pe: 64, pb: 58, volatility: 72, divStability: 90, weight: 80 } },
      { code: "00878", name: "國泰永續高股息", raw: { yield: 6.4, pe: 13.1, pb: 1.5, volatility: 11.2, divStability: 88, weight: 31.0 },
        score: { yield: 80, pe: 70, pb: 62, volatility: 78, divStability: 86, weight: 66 } },
      { code: "2884", name: "玉山金", raw: { yield: 4.3, pe: null, pb: 1.9, volatility: 18.7, divStability: null, weight: 12.2 },
        score: { yield: 55, pe: null, pb: 44, volatility: 40, divStability: null, weight: 30 } }
    ]
  };
  function qp(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function fmtRaw(axis, v) { v = num(v); return v == null ? "—" : (Math.round(v * 100) / 100) + (UNIT[axis] || ""); }
  function fmtScore(v) { v = num(v); return v == null ? "—" : String(Math.round(v)); }
  function fmtAsOf(s) {
    if (!s) return "—";
    var d = new Date(s); if (isNaN(d)) return "—";
    return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function normalize(j) {
    if (!j || j.ok !== true || !Array.isArray(j.holdings)) return null;
    var axes = Array.isArray(j.axes) && j.axes.length ? j.axes.filter(function (a) { return typeof a === "string"; }) : AXES;
    return { asOf: j.asOf || null, axes: axes.slice(0, 8), mood: (j.mood === "up" || j.mood === "down") ? j.mood : "flat",
      mock: !!j.mock, holdings: j.holdings.filter(Boolean).map(function (h) { return { code: h.code || "—", name: h.name || "", raw: h.raw || {}, score: h.score || {} }; }) };
  }
  // 只有網址帶 ?spiderMock=1 才用示意資料；其他任何失敗都不拿假數字頂替。
  // token 是 App 的同步 token（zinfSyncToken，跟 /api/portfolio-sync 同一份），只放 Authorization header，不放網址、不記錄。
  // 沒 token：不呼叫 API，直接請使用者去設定；401／403 也一樣。其餘失敗顯示「讀取失敗」。
  function load(token) {
    if (qp("spiderMock") === "1") return Promise.resolve(normalize(FIXTURE));
    if (typeof token !== "string" || !token.trim()) return Promise.resolve({ error: "auth" });
    if (typeof fetch !== "function") return Promise.resolve({ error: true });
    return fetch("/api/spider", { cache: "no-store", headers: { accept: "application/json", authorization: "Bearer " + token.trim() } })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) return { error: "auth" };
        if (!r.ok) throw 0;
        return r.json().then(function (j) {
          // token 認不得時後端回 200 + found:false：當成 token 問題，不畫空圖、不用示意資料。
          if (j && j.found === false) return { error: "notfound" };
          return normalize(j) || { error: true };
        });
      })
      .catch(function () { return { error: true }; });
  }
  function ensureCss() {
    if (document.getElementById("za-catweb-css")) return;
    var l = document.createElement("link"); l.id = "za-catweb-css"; l.rel = "stylesheet"; l.href = "/za-catweb.css?v=1";
    document.head.appendChild(l);
  }

  function mount(root, opts) {
    opts = opts || {};
    ensureCss();
    var st = { data: null, sel: 0, axis: null, dead: false };
    root.className = "forma-spider";
    root.setAttribute("data-forma-theme", "portfolio");
    root.innerHTML = '<div class="forma-spider-loading">讀取中…</div>';
    function render() {
      if (st.dead || !st.data) return;
      var d = st.data.error ? { error: st.data.error, asOf: null, axes: AXES, mood: "flat", holdings: [] } : st.data;
      var mood = qp("spiderMood") || d.mood;
      var noChart = d.error === "notfound"; // 查無資料：只留小貓與提示，不畫空的蜘蛛圖
      if (mood !== "up" && mood !== "down") mood = "flat";
      var h = d.holdings[st.sel] || null, n = d.axes.length;
      var nodes = d.axes.map(function (a, i) {
        var ang = -Math.PI / 2 + i * 2 * Math.PI / n, R = 40;
        var x = 50 + R * Math.cos(ang), y = 50 + R * Math.sin(ang);
        var sc = h ? num(h.score[a]) : null, k = sc == null ? 0 : Math.max(0, Math.min(100, sc)) / 100;
        return { a: a, x: x, y: y, sc: sc, k: k, i: i };
      });
      var lines = nodes.map(function (p) {
        return '<line class="fs-line" x1="50" y1="50" x2="' + p.x.toFixed(2) + '" y2="' + p.y.toFixed(2) + '" style="opacity:' + (0.35 + 0.65 * p.k).toFixed(2) + '"/>' +
          '<line class="fs-flow" pathLength="100" x1="50" y1="50" x2="' + p.x.toFixed(2) + '" y2="' + p.y.toFixed(2) + '" style="animation-delay:-' + (p.i * 0.37).toFixed(2) + 's;opacity:' + (p.sc == null ? 0 : 0.4 + 0.6 * p.k).toFixed(2) + '"/>';
      }).join("");
      var dots = nodes.map(function (p) {
        var size = 40 + Math.round(18 * p.k);
        return '<button type="button" class="fs-node' + (st.axis === p.a ? " is-on" : "") + (p.sc == null ? " is-null" : "") + '" data-axis="' + esc(p.a) + '"' +
          ' style="left:' + p.x.toFixed(2) + '%;top:' + p.y.toFixed(2) + '%;--fs-size:' + size + 'px;--fs-k:' + p.k.toFixed(2) + '"' +
          ' aria-label="' + esc((LABEL[p.a] || p.a) + " 分數 " + fmtScore(p.sc)) + '" aria-pressed="' + (st.axis === p.a) + '">' +
          '<span class="fs-dot">' + fmtScore(p.sc) + '</span><span class="fs-lbl">' + esc(LABEL[p.a] || p.a) + '</span></button>';
      }).join("");
      var chips = d.holdings.length ? d.holdings.map(function (x, i) {
        return '<button type="button" class="fs-chip' + (i === st.sel ? " is-on" : "") + '" data-sel="' + i + '" aria-pressed="' + (i === st.sel) + '">' +
          '<b>' + esc(x.code) + '</b> ' + esc(x.name) + '</button>';
      }).join("") : (d.error === "auth" || d.error === "notfound")
        ? '<div class="fs-err" role="alert"><b>' + (d.error === "notfound" ? '同步 token 無效或查無資料，請到計畫設定重新設定' : '同步 token 無效或未設定，請到計畫設定重新設定') + '</b>' +
          (typeof opts.onGoSettings === "function" ? '<button type="button" class="fs-chip fs-retry" data-settings="1">前往計畫設定</button>' : '') + '</div>'
        : d.error
        ? '<div class="fs-err" role="alert"><b>讀取失敗</b><span class="fs-muted">暫時拿不到蜘蛛圖資料，沒有顯示任何數字</span><button type="button" class="fs-chip fs-retry" data-retry="1">重新讀取</button></div>'
        : '<span class="fs-muted fs-empty">目前沒有持股資料</span>';
      var tip = "";
      if (st.axis && h) {
        tip = '<div class="fs-tip" role="status"><b>' + esc(LABEL[st.axis] || st.axis) + '</b><span class="fs-muted"> ' + esc(EN[st.axis] || "") + '</span>' +
          '<div>原始值 <b>' + fmtRaw(st.axis, h.raw[st.axis]) + '</b>　分數 <b>' + fmtScore(h.score[st.axis]) + '</b> / 100</div></div>';
      } else tip = h ? '<div class="fs-tip fs-muted">點參數看原始數字；點小貓摸摸頭</div>' : '';
      root.innerHTML =
        '<div class="fs-head"><div><div class="fs-title">持股蜘蛛圖</div><div class="fs-muted">資料時間 ' + fmtAsOf(d.asOf) + (d.mock ? '・示意資料' : '') + '</div></div>' +
        (h ? '<span class="fs-mood fs-mood-' + mood + '">' + MOOD[mood] + '</span>' : '') + '</div>' +
        '<div class="fs-chips" role="group" aria-label="選擇持股">' + chips + '</div>' +
        '<div class="fs-stage" data-mood="' + mood + '">' +
          (noChart ? '' : '<svg class="fs-web" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + lines + '</svg>') +
          '<button type="button" class="fs-cat" aria-label="小白貓（' + MOOD[mood] + '）">' +
            '<span class="fs-cat-body"><img src="/spider-cat.webp?v=1" alt="" width="400" height="503" draggable="false" decoding="async"/>' +
            '<i class="fs-lid fs-lid-l"></i><i class="fs-lid fs-lid-r"></i></span></button>' +
          (noChart ? '' : dots) + '</div>' + tip;
    }
    function onClick(e) {
      var t = e.target.closest ? e.target.closest("button") : null; if (!t || !root.contains(t)) return;
      if (t.hasAttribute("data-retry")) { st.data = null; root.innerHTML = '<div class="forma-spider-loading">讀取中…</div>'; load(opts.token).then(function (d) { st.data = d; render(); }); return; }
      if (t.hasAttribute("data-settings")) { if (typeof opts.onGoSettings === "function") opts.onGoSettings(); return; }
      if (t.hasAttribute("data-sel")) { st.sel = +t.getAttribute("data-sel"); render(); return; }
      if (t.hasAttribute("data-axis")) { var a = t.getAttribute("data-axis"); st.axis = st.axis === a ? null : a; render(); return; }
      if (t.classList.contains("fs-cat")) {
        var b = t.querySelector(".fs-cat-body"); if (!b) return;
        b.classList.remove("is-tap"); void b.offsetWidth; b.classList.add("is-tap");
      }
    }
    root.addEventListener("click", onClick);
    document.documentElement.classList.add("za-catweb-open");
    load(opts.token).then(function (d) { st.data = d; render(); });
    return function () { st.dead = true; document.documentElement.classList.remove("za-catweb-open"); root.removeEventListener("click", onClick); root.innerHTML = ""; };
  }
  // 樣式一載入就掛上：分頁列在窄螢幕的字級修正也在這支 CSS 裡。
  try { ensureCss(); } catch (e) {}
  window.ZaSpider = { mount: mount, _normalize: normalize, _fixture: FIXTURE };
})();
