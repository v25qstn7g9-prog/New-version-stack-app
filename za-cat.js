// Z∞ Assets 小白貓載入器（純畫面：不碰儲存、不寫資料）。
// 現在用的是 Johnny 家白貓的去背照片（za-catphoto.js），坐在標題列的空位上，不蓋到數字或圖表，可以摸。
// 舊的立體版（za-cat3d.js）與手繪版（za-cat2d.js）會在畫面上到處跑、蓋住資產曲線，所以不再載入（檔案先留著）。
// 開了「減少動態效果」照樣載入，但所有動畫都關掉（反應只換成不動的樣子）。等頁面載入完再慢慢載，不拖慢開啟速度。
(function () {
  if (window.__zaCatLoader) return;
  window.__zaCatLoader = true;
  function go() {
    var s = document.createElement("script");
    s.src = "/za-catphoto.js?v=10"; s.defer = true;
    document.body.appendChild(s);
  }
  function later() { setTimeout(go, 1200); }
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later);
})();
