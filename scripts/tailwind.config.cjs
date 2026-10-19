// 以前用 cdn.tailwindcss.com 在手機上即時編譯（每次開 App 先下載約 407 KB 的編譯器）；
// 現在改成先編好 tw.css。設定和 CDN 一樣是 Tailwind v3 預設值，只指定要掃描的檔案。
// 用法：npm run build:css（改過 class 後要跑；tests/tw-css.test.mjs 會檢查是否同步）。
module.exports = {
  content: [
    "./index.html",
    "./src/app.jsx",
    "./clean-ui.js",
    "./bg-core.js",
    "./forecast-core.js",
    "./za-cat.js",
    "./za-catphoto.js",
    "./za-catpair.js",
    "./za-catlife.js",
    "./za-catspace.js",
  ],
  theme: { extend: {} },
  plugins: [],
};
