// Z∞ Assets 外觀小幫手（從 Z∞ Training 的 clean-ui.js 移植；只管畫面，不碰資料、不呼叫 API）：
// 標題、摺疊列裡開頭的 emoji 換成一致的線條圖示（1.5px）；燈號圓點（🟢🟡🔴）換成小色點；按鈕上的 emoji 直接拿掉。
// 畫面是 React 產生的，所以用 MutationObserver 跟著處理；AI 助手的對話內容不動。
// 已經有圖示的位置不會重複插入（React 重新渲染同一段文字時）。
(function () {
  var P = {
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    list: '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.9 4.7-3.7 1.9 1.9-4.7z"/>',
    spark: '<path d="M12 3.5l1.8 4.9 4.9 1.8-4.9 1.8L12 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z"/><path d="M18.5 16.5v3M17 18h3"/>',
    lift: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    meal: '<path d="M7 3.5v17M4.5 3.5v5a2.5 2.5 0 0 0 5 0v-5M17 20.5V3.5c-2 1-3 3.5-3 6.5h3"/>',
    pill: '<rect x="3.2" y="8.6" width="17.6" height="6.8" rx="3.4" transform="rotate(-45 12 12)"/><path d="M9.6 9.6l4.8 4.8"/>',
    camera: '<path d="M4 8.5h3l1.5-2.5h7L17 8.5h3v10H4z"/><circle cx="12" cy="13" r="3.2"/>',
    down: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    flask: '<path d="M9.5 3.5h5M10.5 3.5v6L5 19a1.3 1.3 0 0 0 1.1 2h11.8a1.3 1.3 0 0 0 1.1-2l-5.5-9.5v-6"/>',
    trend: '<path d="M3.5 17 9 11.5l4 4 7.5-8M15 7.5h5.5V13"/>',
    bars: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3.4" height="6.5" rx="1"/><rect x="10.3" y="6.5" width="3.4" height="11" rx="1"/><rect x="15.1" y="9" width="3.4" height="8.5" rx="1"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    pencil: '<path d="M15.5 4.5l4 4L8 20H4v-4z"/>',
    signal: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    book: '<path d="M5 18.5V6.5a3 3 0 0 1 3-3h10v13H8a3 3 0 0 0-3 3 2 2 0 0 0 2 2h11"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    wallet: '<rect x="3.5" y="6.5" width="17" height="12.5" rx="2.5"/><path d="M15.5 12.75h2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.3l2.4 2.4 4.6-5"/>',
    warn: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
    pin: '<path d="M12 21v-6M7 15h10l-2-4V4.5H9V11z"/>',
    activity: '<path d="M3.5 12h4l2.5-6 5 12 2.5-6h3"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4.5v4h-4"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8M9 13v1M15 13v1"/>',
    drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/>'
  };
  var MAP = {
    "📝": "list", "📋": "list", "🗒": "list", "🧭": "compass", "🧠": "spark", "✨": "spark", "🔥": "spark",
    "📅": "cal", "🗓": "cal", "📆": "cal", "🏋": "lift", "💪": "lift", "🍽": "meal", "🍴": "meal", "🥗": "meal", "🍳": "meal",
    "💊": "pill", "📷": "camera", "📸": "camera", "📥": "down", "⬇": "down", "⚙": "sliders", "🛠": "sliders", "🔧": "sliders",
    "🧪": "flask", "📈": "trend", "📉": "trend", "📊": "bars", "😴": "moon", "🌙": "moon", "🛌": "moon", "🫀": "heart", "❤": "heart",
    "🙋": "user", "👤": "user", "✏": "pencil", "🚦": "signal", "📡": "signal", "💬": "chat", "🧬": "book", "📚": "book", "📖": "book",
    "🔍": "search", "🔎": "search", "☀": "sun", "🌞": "sun", "💰": "wallet", "💵": "wallet", "⏳": "clock", "⏱": "clock", "🕒": "clock",
    "✅": "check", "✔": "check", "⚠": "warn", "🎯": "target", "📌": "pin", "🏃": "activity", "🚶": "activity", "🫁": "activity", "⚡": "activity",
    "🔄": "refresh", "💧": "drop", "🔔": "bell", "🔐": "lock", "🔒": "lock", "🤖": "bot", "🎉": "spark", "💹": "trend", "🏦": "wallet", "💾": "down", "📦": "list"
  };
  var DOTS = { "🟢": "g", "🟡": "y", "🟠": "y", "🔴": "r", "⚪": "n", "⚫": "n" };
  var LEAD = /^(\s*)((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\uFE0E|\u200D(?:\p{Extended_Pictographic}))*)\s*/u;
  var SKIP = ".ai-panel-h .whitespace-pre-wrap, .chat-log, textarea, script, style, svg, option, input, .cl-ico, .cl-dot, [contenteditable]";
  function icon(name) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("class", "cl-ico");
    s.innerHTML = P[name]; return s;
  }
  function dot(c) { var i = document.createElement("i"); i.className = "cl-dot " + c; i.setAttribute("aria-hidden", "true"); return i; }
  function fixText(node) {
    var parent = node.parentElement; if (!parent || parent.closest(SKIP)) return;
    var inButton = !!parent.closest("button");
    var guard = 0;
    while (guard++ < 4) {
      var t = node.nodeValue, m = t && t.match(LEAD); if (!m) return;
      var em = m[2], base = em.replace(/[\uFE0F\uFE0E]/g, "").split("\u200D")[0];
      node.nodeValue = m[1] + t.slice(m[0].length);
      if (DOTS[base]) { var pd = node.previousSibling; if (!(pd && pd.nodeType === 1 && pd.classList && pd.classList.contains("cl-dot"))) parent.insertBefore(dot(DOTS[base]), node); }
      else if (!inButton && MAP[base]) { var prev = node.previousSibling; if (!(prev && prev.nodeType === 1 && prev.classList && prev.classList.contains("cl-ico"))) parent.insertBefore(icon(MAP[base]), node); }
      if (!node.nodeValue.trim() && !(node.nextSibling)) return;
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 || (root.closest && root.closest(SKIP))) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [], n;
    while ((n = w.nextNode())) list.push(n);
    list.forEach(fixText);
  }
  var queue = [], scheduled = false;
  function flush() { scheduled = false; var q = queue; queue = []; q.forEach(walk); }
  function enqueue(n) { queue.push(n); if (!scheduled) { scheduled = true; (window.requestAnimationFrame || setTimeout)(flush); } }
  walk(document.body);
  if (typeof MutationObserver !== "undefined") new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.type === "characterData") enqueue(m.target);
      else m.addedNodes.forEach(enqueue);
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
