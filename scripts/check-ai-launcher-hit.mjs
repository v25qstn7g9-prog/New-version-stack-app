// 本機用：檢查右下角 AI 貓咪按鈕（固定在畫面右側）不會蓋住「即時股價」重新整理鈕。
// 需要本機的 Chrome 與 playwright-core（CI 沒有瀏覽器，所以 npm test 只做 tests/ai-dialog.test.mjs 的靜態檢查）。
// 用法：
//   python3 -m http.server 8765   # 在 repo 根目錄起靜態伺服器（不需要後端）
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/usr/bin/google-chrome \
//     node scripts/check-ai-launcher-hit.mjs http://localhost:8765/ [輸出截圖資料夾]
// 做法：在 320／375／390／430px，把即時股價區捲到重新整理鈕與 AI 按鈕同高，
// 用 document.elementFromPoint 確認重新整理鈕中心點命中的是重新整理鈕本身；
// 另外列出總覽頁所有「水平落在 AI 按鈕欄」的可點元素（捲到同高時會被蓋住）。
import { createRequire } from "node:module";

const base = process.argv[2] || "http://localhost:8765/";
const shotDir = process.argv[3] || "";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core")); }
catch { console.error("需要 playwright-core（設定 PLAYWRIGHT_CORE 指到它的資料夾）"); process.exit(2); }

const seed = () => {
  const recs = Array.from({ length: 40 }, (_, i) => ({ id: "r" + i, date: new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10), twValue: 1000000 + i * 3000, usValue: 0, twCost: 900000, usCost: 0 }));
  localStorage.setItem("dailyRecords", JSON.stringify(recs));
  localStorage.setItem("holdings", JSON.stringify([{ id: "h", symbol: "0050", name: "元大台灣50", initialShares: 1000 }, { id: "h2", symbol: "0056", name: "元大高股息", initialShares: 2000 }]));
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
let failed = false;
const report = [];
for (const scheme of ["light", "dark"]) for (const w of [320, 375, 390, 430]) {
  const page = await browser.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  await page.addInitScript(seed);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => {
    const ai = document.querySelector(".premium-ai-launcher").getBoundingClientRect();
    const btn = document.querySelector(".live-refresh-icon");
    if (!btn) return { error: "no refresh button" };
    // 捲到重新整理鈕中心與 AI 按鈕中心同高
    const r0 = btn.getBoundingClientRect();
    window.scrollBy(0, (r0.top + r0.height / 2) - (ai.top + ai.height / 2));
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const box = (b) => ({ x: +b.left.toFixed(1), y: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1) });
    // 總覽頁上水平落在 AI 按鈕欄（含 8px 間距）的可點元素
    const laneLeft = ai.left - 8;
    const inLane = [...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")]
      .filter((el) => !el.closest(".premium-ai-launcher") && !el.closest(".premium-tabbar") && !el.closest("[role=dialog]"))
      .filter((el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && b.right > laneLeft; })
      .map((el) => ({ label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 24), x: +el.getBoundingClientRect().left.toFixed(1), r: +el.getBoundingClientRect().right.toFixed(1) }));
    return { ai: box(ai), refresh: box(r), center: [+cx.toFixed(1), +cy.toFixed(1)], hitIsRefresh: !!(hit && hit.closest(".live-refresh-icon")), hitWhat: hit ? (hit.className && String(hit.className.baseVal ?? hit.className)).slice(0, 40) || hit.tagName : null, laneGap: +(ai.left - r.right).toFixed(1), inLane };
  });
  const ok = res.hitIsRefresh === true;
  if (!ok) failed = true;
  report.push({ scheme, w, ...res });
  console.log(`${ok ? "OK " : "NG "} ${scheme} ${w}px  refresh ${JSON.stringify(res.refresh)}  AI ${JSON.stringify(res.ai)}  center ${JSON.stringify(res.center)}  hit=${res.hitWhat}  gap=${res.laneGap}px  rightLaneClickables=${res.inLane ? res.inLane.length : "?"}`);
  if (res.inLane && res.inLane.length) for (const e of res.inLane) console.log(`      lane: ${e.label} [${e.x}–${e.r}]`);
  if (shotDir && w === 390 && scheme === "light") await page.screenshot({ path: `${shotDir}/scroll-overlap-check.png` });
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
