// Issue #90 隔離預覽：用 tests/fixtures/ledger-90.json 的假資料把 App 跑起來，檢查首頁、記交易、資料時間與匯率，並截手機圖。
// - 只讀這個 repo 的檔案；/quote 等 API 一律由本腳本用假資料回應；任何對外連線都擋掉並記錄（必須是 0）。
// - 不讀任何正式帳本、不需要登入或金鑰。
// 用法：node scripts/preview-ledger-90.mjs [輸出資料夾]（預設 docs/screenshots/issue-90）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
// Playwright 不是這個 repo 的相依套件（npm test 不需要它）；用執行環境已安裝的那一份。
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'docs/screenshots/issue-90'));
fs.mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ledger-90.json'), 'utf8'));
const ORIGIN = 'http://ledger-preview.local';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const results = [];
// App 既有功能（字型、趨勢雷達的法人／融資資料）會想連的網域：預覽裡一律擋下不送出，只記錄。
const KNOWN_BLOCKED = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'www.twse.com.tw']);
const blockedHosts = new Set();
const assertIsolated = (s) => { const hosts = [...new Set(s.external.map((u) => new URL(u).host))]; hosts.forEach((h) => blockedHosts.add(h)); assert.deepEqual(hosts.filter((h) => !KNOWN_BLOCKED.has(h)), [], '出現預期外的對外連線'); assert.deepEqual(s.errors, []); };
const check = (name, fn) => Promise.resolve().then(fn).then(() => { results.push({ name, ok: true }); console.log(`ok   ${name}`); }, (e) => { results.push({ name, ok: false, error: e.message }); console.log(`FAIL ${name}\n     ${e.message}`); });

async function scene(browser, { width, name, us = false, dropQuote = null }) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, locale: 'zh-TW', timezoneId: 'Asia/Taipei', isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const external = [], apiCalls = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) { external.push(url.href); return route.abort(); }
    if (url.pathname === '/quote') {
      apiCalls.push(url.pathname);
      const quotes = {};
      for (const s of (url.searchParams.get('symbols') || '').split(',')) {
        if (s === dropQuote) continue;
        if (fx.quotes[s]) quotes[s] = fx.quotes[s];
        else if (fx.usQuotes[s]) quotes[s] = fx.usQuotes[s];
        else if (s === 'USDTWD') quotes[s] = { price: fx.fx.rate, prevClose: fx.fx.rate, isStale: false, asOfDate: fx.fx.asOf, source: fx.fx.source };
      }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, quotes, source: 'fixture' }) });
    }
    const file = path.join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile() && TYPES[path.extname(file)]) {
      return route.fulfill({ contentType: TYPES[path.extname(file)], body: fs.readFileSync(file) });
    }
    apiCalls.push(url.pathname);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false,"error":"fixture preview"}' });
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(fx.now) });
  const seed = {
    holdings: us ? [...fx.holdings, fx.usHolding] : fx.holdings, trades: us ? fx.trades : fx.trades.filter((t) => t.symbol !== 'VOO'),
    dividends: fx.dividends, dailyRecords: us ? fx.dailyRecords.map((r) => ({ ...r, usValue: 37000, usCost: 30000 })) : fx.dailyRecords,
    planSchedule: fx.plan, showUsFields: us, advancedMode: true, lastBackupAt: fx.now,
  };
  await page.addInitScript((data) => {
    if (localStorage.getItem('__ledgerPreviewSeeded')) return;
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem('uiLanguage', 'zh');
    localStorage.setItem('__ledgerPreviewSeeded', '1');
  }, seed);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/');
  await page.waitForSelector('[data-ledger-asof]');
  const shot = async (label, opts = {}) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(outDir, `${name}-${label}.png`), ...opts }); };
  const noOverflow = async (label) => {
    const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    assert.ok(w <= width, `${label}：內容寬 ${w}px 超出 ${width}px`);
    const off = await page.evaluate((vw) => [...document.querySelectorAll('.forma-ledger-sheet *, .premium-asset-hero *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).map((el) => el.className || el.tagName).slice(0, 3), width);
    assert.deepEqual(off, [], `${label}：有元素超出畫面`);
  };
  return { page, context, external, apiCalls, errors, shot, noOverflow, seed };
}
const heroTotal = (page) => page.locator('.forma-asset-total').innerText();
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ''));

const browser = await chromium.launch();
try {
  // ── A. 台股、報價完整：三種手機寬度 ──
  const twShares = { '0050': 1200, '2330': 100, '00878': 4000 };
  const expectTw = Math.round(Object.entries(twShares).reduce((s, [k, n]) => s + n * fx.quotes[k].price, 0));
  for (const width of [375, 390, 430]) {
    const s = await scene(browser, { width, name: `w${width}` });
    const { page } = s;
    await check(`[${width}] 首頁：持股總市值＝假資料 價格×股數（NT$ ${expectTw.toLocaleString()}）`, async () => {
      await page.waitForFunction((n) => document.querySelector('.forma-asset-total')?.textContent.replace(/[^\d]/g, '') === String(n), expectTw, { timeout: 15000 });
      assert.equal(num(await heroTotal(page)), expectTw);
    });
    await check(`[${width}] 估值日期：資料時間顯示原始報價時間 11/20 13:30，狀態完整`, async () => {
      const el = page.locator('[data-ledger-asof]');
      await page.waitForFunction(() => document.querySelector('[data-ledger-asof]')?.dataset.ledgerStatus === 'complete');
      assert.match(await el.innerText(), /11\/20 13:30 報價/);
    });
    await check(`[${width}] 首頁：當日漲跌可比較、只有一個「記交易」按鈕`, async () => {
      assert.equal(await page.locator('[data-ledger-change="comparable"]').count(), 1);
      const change = Math.round(1200 * 0.5 + 100 * 10 + 4000 * 0.1);
      assert.match((await page.locator('[data-ledger-change]').innerText()).replace(/,/g, ''), new RegExp(`NT\\$ ${change}`));
      assert.equal(await page.locator('[data-quick-trade-btn]').count(), 1);
    });
    await check(`[${width}] 首頁不左右超出`, () => s.noOverflow('首頁'));
    await s.shot('1-home');

    await page.locator('[data-quick-trade-btn]').click();
    await page.waitForSelector('[data-quick-field="symbol"]');
    await check(`[${width}] 記交易：預設台北今天（2026-11-20）＋買進`, async () => {
      assert.equal(await page.locator('[data-quick-field="date"]').inputValue(), '2026-11-20');
      assert.equal(await page.locator('[data-action="buy"]').getAttribute('aria-checked'), 'true');
      assert.equal(await page.locator('[data-quick-trade-submit]').isDisabled(), true);
    });
    await page.locator('[data-quick-field="symbol"]').fill('0050');
    await page.locator('[data-quick-field="shares"]').fill('10.5');
    await page.locator('[data-quick-field="price"]').fill('62.5');
    await page.locator('[data-quick-field="fee"]').fill('20');
    await check(`[${width}] 記交易：小數股數與手續費，金額＝10.5×62.5＋20＝676`, async () => {
      assert.equal(num(await page.locator('[data-quick-trade-amount] b').innerText()), 676);
    });
    await check(`[${width}] 記交易面板不左右超出、輸入框 ≥16px`, async () => {
      await s.noOverflow('記交易');
      const fs16 = await page.evaluate(() => [...document.querySelectorAll('.forma-ledger-field input')].every((i) => parseFloat(getComputedStyle(i).fontSize) >= 16));
      assert.equal(fs16, true);
    });
    await s.shot('2-quick-trade');
    await check(`[${width}] 草稿保留：關掉再打開，填過的還在`, async () => {
      await page.locator('.forma-ledger-x').click();
      await page.waitForSelector('.forma-ledger-sheet', { state: 'detached' });
      await page.locator('[data-quick-trade-btn]').click();
      assert.equal(await page.locator('[data-quick-field="shares"]').inputValue(), '10.5');
      assert.equal(await page.locator('[data-quick-field="symbol"]').inputValue(), '0050');
    });
    await check(`[${width}] 送出：連點兩下只多一筆，跳到交易紀錄並標出剛新增的那一筆`, async () => {
      await page.locator('[data-quick-trade-submit]').dblclick();
      await page.waitForSelector('[data-trade-new]');
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('trades')));
      assert.equal(stored.length, s.seed.trades.length + 1);
      const row = stored[stored.length - 1];
      assert.deepEqual({ d: row.date, s: row.symbol, a: row.action, n: row.shares, p: row.price, f: row.fee, amt: row.amount, c: row.currency }, { d: '2026-11-20', s: '0050', a: 'buy', n: 10.5, p: 62.5, f: 20, amt: 676.25, c: 'TWD' });
      assert.deepEqual(stored.slice(0, -1), s.seed.trades, '舊紀錄與 id 原封不動');
      assert.equal(await page.locator('[data-trade-new]').count(), 1);
      assert.equal(await page.locator(`[data-trade-id="${row.id}"] [data-trade-new]`).count(), 1);
    });
    await s.shot('3-trade-saved');
    await page.locator('[data-tab="dashboard"]').click();
    await page.waitForSelector('[data-ledger-asof]');
    await check(`[${width}] 記完後首頁：總市值加上新買的 10.5 股；今天有買賣仍用昨收算漲跌（不含買進的錢）`, async () => {
      const want = expectTw + Math.round(10.5 * 62.5);
      await page.waitForFunction((n) => Math.abs(Number(document.querySelector('.forma-asset-total')?.textContent.replace(/[^\d]/g, '')) - n) <= 1, want);
      assert.equal(await page.locator('[data-ledger-change="comparable"]').count(), 1);
    });
    await page.locator('[data-ledger-asof]').click();
    await page.waitForSelector('[data-ledger-summary]');
    await check(`[${width}] 資料來源抽屜：每檔來源／原始報價時間、今天買進付出 NT$ 676、配息實際入帳 NT$ 1,200`, async () => {
      const text = await page.locator('.forma-ledger-sheet').innerText();
      assert.match(text, /來源 TWSE・原始報價時間 2026-11-20 13:30（台灣時間）/);
      assert.match(text, /今天買進付出\s*NT\$ 676/);
      assert.match(text, /實際入帳（你記下的）\s*NT\$ 1,200/);
      await s.noOverflow('來源抽屜');
    });
    await s.shot('4-source');
    await page.locator('.forma-ledger-x').click();
    await page.locator('[data-tab="progress"]').click();
    await page.waitForSelector('[data-contributed-principal]');
    await check(`[${width}] 計畫進度：已投入本金＝起始 100,000＋開始後買進 35,225（不是持倉成本）；月份從 1/31 起算不跳過二月`, async () => {
      assert.match(await page.locator('[data-contributed-principal]').innerText(), /NT\$ 135,225/);
      const text = await page.locator('main').innerText();
      assert.match(text, /2026\/02/); assert.match(text, /算到 2026-11-20/);
      await s.noOverflow('計畫進度');
    });
    await s.shot('5-progress');
    await check(`[${width}] 對外連線全部擋下（沒有送出任何請求）、沒有程式錯誤`, () => assertIsolated(s));
    await s.context.close();
  }

  // ── B. 台股＋美股：匯率 ──
  {
    const s = await scene(browser, { width: 390, name: 'w390-us', us: true });
    const { page } = s;
    const usNtd = Math.round(2 * fx.usQuotes.VOO.price * fx.fx.rate);
    await check('[匯率] 美股市值＝2 股 × US$600 × 32＝NT$ 38,400，只換算一次；總市值＝台股＋美股', async () => {
      await page.waitForFunction((n) => document.querySelector('.forma-asset-total')?.textContent.replace(/[^\d]/g, '') === String(n), expectTw + usNtd, { timeout: 15000 });
      assert.match((await page.locator('.forma-asset-breakdown').innerText()).replace(/,/g, ''), new RegExp(`美股資產\\s*NT\\$ ${usNtd}`));
    });
    await s.shot('1-home');
    await page.locator('[data-ledger-asof]').click();
    await page.waitForSelector('[data-ledger-fx]');
    await check('[匯率] 來源抽屜：匯率 32、來源 Yahoo、日期 2026-11-20；美股交易日 11/19 與台灣日期 11/20 分開標示', async () => {
      const fxText = await page.locator('[data-ledger-fx]').innerText();
      assert.match(fxText, /32/); assert.match(fxText, /來源 Yahoo・日期 2026-11-20/);
      const voo = await page.locator('[data-ledger-row="VOO"]').innerText();
      assert.match(voo, /原始報價時間 2026-11-20 05:00（台灣時間）・美股交易日 2026-11-19/);
      assert.match(voo.replace(/,/g, ''), new RegExp(`NT\\$ ${usNtd}`));
      await s.noOverflow('來源抽屜');
    });
    await page.locator('[data-ledger-fx]').scrollIntoViewIfNeeded();
    await s.shot('2-source-fx');
    await check('[匯率] 對外連線全部擋下（沒有送出任何請求）、沒有程式錯誤', () => assertIsolated(s));
    await s.context.close();
  }

  // ── C. 缺一檔報價 ──
  {
    const s = await scene(browser, { width: 390, name: 'w390-partial', dropQuote: '2330' });
    const { page } = s;
    await check('[缺報價] 首頁改用 11/19 每日紀錄 NT$ 253,200 並寫明；當日漲跌不顯示數字', async () => {
      await page.waitForFunction(() => document.querySelector('[data-ledger-asof]')?.dataset.ledgerStatus === 'fallback', null, { timeout: 15000 });
      assert.equal(num(await heroTotal(page)), 253200);
      assert.match(await page.locator('[data-ledger-asof]').innerText(), /11\/19 每日紀錄（即時報價不完整）/);
      assert.match(await page.locator('[data-ledger-change="not-comparable"]').innerText(), /當日漲跌\s*—（報價不完整，不比較）/);
    });
    await s.shot('1-home');
    await page.locator('[data-ledger-asof]').click();
    await page.waitForSelector('[data-ledger-summary]');
    await check('[缺報價] 來源抽屜標出 2330 缺報價，且沒有任何一檔用即時價計入', async () => {
      assert.match(await page.locator('[data-ledger-row="2330"]').innerText(), /缺報價/);
      assert.equal(await page.locator('[data-ledger-part="TW"]').getAttribute('data-ledger-mode'), 'record');
    });
    await s.shot('2-source');
    await check('[缺報價] 對外連線全部擋下（沒有送出任何請求）、沒有程式錯誤', () => assertIsolated(s));
    await s.context.close();
  }
} finally { await browser.close(); }
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, 'preview-results.json'), JSON.stringify({ fixture: 'tests/fixtures/ledger-90.json', fixedNow: fx.now, passed: results.length - failed.length, failed: failed.length, blockedExternalHosts: [...blockedHosts].sort(), results }, null, 2) + '\n');
console.log(`\n預覽檢查：${results.length - failed.length} 通過／${failed.length} 失敗；截圖在 ${outDir}`);
process.exit(failed.length ? 1 : 0);
