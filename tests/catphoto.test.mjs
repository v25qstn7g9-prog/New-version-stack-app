// 真貓照片版小白貓：坐在標題列空位（不蓋數字與圖表、不擋右上角按鈕），可以摸；心情只來自 /api/spider 的 mood。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readAppSource } from './_app-source.mjs';
const code = fs.readFileSync(new URL("../za-catphoto.js", import.meta.url), "utf8");
const html = readAppSource();
const body = code.replace(/^\s*\/\/.*$/gm, "");

test("no storage / page-text reads, only one fetch (GET /api/spider), token header-only, never fixed-position", () => {
  for (const bad of ["XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "sendBeacon", "innerHTML", "innerText", "?token", "console."]) assert.ok(!body.includes(bad), bad);
  assert.equal((body.match(/fetch\(/g) || []).length, 1);
  assert.match(body, /var init = \{ cache: "no-store", headers: \{ accept: "application\/json", authorization: "Bearer " \+ tok \} \};/);
  assert.match(body, /fetch\("\/api\/spider", init\)/);
  assert.ok(!/position:fixed/.test(body), "header mode sits inside the header row (roaming lives in za-catroam.js)");
  assert.ok(!/setInterval/.test(body), "no polling");
  assert.ok(fs.statSync(new URL("../za-cat-photo.webp", import.meta.url)).size < 150000);
  // App 端只給「問 token」的函式，跟 portfolio-sync 同一份 zinfSyncToken
  assert.match(html, /window\.zaGetSyncToken = \(\) => zinfSyncTokenRef\.current \|\| ""/);
  assert.match(html, /zinfSyncTokenRef\.current = zinfSyncToken/);
});

test("reduced motion: every animation off, reactions become static transforms", () => {
  const rm = code.slice(code.indexOf("@media (prefers-reduced-motion:reduce)"));
  assert.match(rm, /animation:none!important/);
  for (const k of ["jump", "blink", "stretch", "shrink", "hiss", "pet"]) assert.match(rm, new RegExp("r-" + k + " img[^{]*\\{(transform|filter)"));
});

// ── 假的畫面環境 ──
function mkEl(tag) {
  const el = { tag, style: {}, children: [], attrs: {}, listeners: {}, parentNode: null, textContent: "", offsetWidth: 0,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
    addEventListener(n, f) { (this.listeners[n] ||= []).push(f); }, contains(x) { return x === el; } };
  return el;
}
function env({ titleRight = 210, btnLeft = 300, token, fetchImpl, reduce = false, clock = null } = {}) {
  const rect = (l, r, t = 10, b = 46) => ({ left: l, right: r, top: t, bottom: b, width: r - l, height: b - t });
  const kids = [], wl = {}, timers = [];
  const title = { getBoundingClientRect: () => rect(16, titleRight) };
  const btns = { getBoundingClientRect: () => rect(btnLeft, 374) };
  const h1 = { firstElementChild: title, nextElementSibling: btns };
  const row = { style: {}, getBoundingClientRect: () => rect(16, 374), querySelector: () => h1, appendChild(c) { kids.push(c); c.parentNode = row; } };
  const scripts = [];
  const dl = {};
  const doc = { hidden: false, head: { appendChild() {} }, body: { appendChild: (c) => scripts.push(c) }, createElement: mkEl, querySelector: () => row, addEventListener(n, f) { (dl[n] ||= []).push(f); } };
  const calls = [];
  const win = { addEventListener(n, f) { (wl[n] ||= []).push(f); }, matchMedia: () => ({ matches: reduce }) };
  if (token !== undefined) win.zaGetSyncToken = () => token;
  const vib = [];
  vm.runInNewContext(code, { window: win, document: doc, navigator: { vibrate: (p) => vib.push(p) },
    fetch: (u, init) => { calls.push({ u, init }); return fetchImpl ? fetchImpl(u, init) : Promise.reject(new Error("x")); },
    getComputedStyle: () => ({ position: "static" }), requestAnimationFrame: (f) => f(), setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {},
    MutationObserver: function () { this.observe = () => {}; }, Date: clock ? { now: () => clock.t } : Date, AbortController, Math, Promise, String });
  const out = { doc, dl, scripts, api: win.__zaPhotoCat, box: kids[0], row, calls, wl, win, timers, vib, btnLeft, titleRight };
  Object.defineProperty(out, "timers", { get: () => timers, set: (v) => { timers.length = 0; timers.push(...v); } });
  return out;
}
function fire(e) { e.wl["za-sync-token"].forEach((f) => f()); const t = e.timers.filter((x) => x.ms === 800); e.timers = e.timers.filter((x) => x.ms !== 800); t.slice(-1).forEach((x) => x.f()); }
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const res = (status, j) => () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(j) });

test("sits in the gap; whole tappable box (≥36px) stays clear of the title and the 深色/中英 buttons", () => {
  for (const [tr, bl] of [[210, 300], [170, 260], [150, 200]]) {
    const { api, box } = env({ titleRight: tr, btnLeft: bl });
    assert.equal(api.shown, true);
    const left = parseFloat(box.style.left) + 16, w = parseFloat(box.style.width), h = parseFloat(box.style.height);
    assert.ok(w >= 36 && w <= 36 && h >= 36, "touch target at least 36px");
    assert.ok(left >= tr && left + w <= bl, `box ${left}-${left + w} inside gap ${tr}-${bl}`);
    assert.ok(parseFloat(box.style.top) + h <= 36 + 0.5, "feet on the row bottom");
  }
});
test("gap too small for a 36px target -> hidden (never squeezes over the buttons)", () => {
  assert.equal(env({ titleRight: 260, btnLeft: 300 }).api.shown, false);
});
test("real button: role, aria-label with mood", () => {
  const { box } = env();
  assert.equal(box.tag, "button"); assert.equal(box.type, "button");
  assert.equal(box.attrs["aria-label"], "白貓，心情：悠閒");
  assert.ok(box.listeners.click && box.listeners.pointerdown, "click covers mouse/touch and Enter/Space on a <button>");
});

test("mood mapping from /api/spider: up/flat/down -> happy/relaxed/sad; anything else -> relaxed", () => {
  const { api } = env();
  const m = api.moodFrom;
  assert.equal(m({ ok: true, found: true, mood: "up" }), "happy");
  assert.equal(m({ ok: true, found: true, mood: "flat" }), "relaxed");
  assert.equal(m({ ok: true, found: true, mood: "down" }), "sad");
  assert.equal(m({ ok: true, found: false, mood: "up" }), "relaxed");
  assert.equal(m({ ok: false, mood: "down" }), "relaxed");
  assert.equal(m(null), "relaxed");
  assert.equal(m({ ok: true, found: true, mood: "weird" }), "relaxed");
});
test("fetch once with Bearer token (header only), result sets mood + aria-label", async () => {
  const e = env({ token: "tok-1234567890abcdef", fetchImpl: res(200, { ok: true, found: true, mood: "down" }) });
  await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].u, "/api/spider");
  assert.equal(e.calls[0].init.headers.authorization, "Bearer tok-1234567890abcdef");
  assert.equal(e.api.mood, "sad"); assert.equal(e.box.attrs["aria-label"], "白貓，心情：難過，想撒嬌");
  fire(e); await flush();
  assert.equal(e.calls.length, 1, "only once, no polling");
});
for (const [name, opts] of [
  ["no token", { token: "" }],
  ["401", { token: "t", fetchImpl: res(401, { ok: false }) }],
  ["403", { token: "t", fetchImpl: res(403, { ok: false }) }],
  ["found:false", { token: "t", fetchImpl: res(200, { ok: true, found: false, mood: "up", holdings: [] }) }],
  ["500", { token: "t", fetchImpl: res(500, {}) }],
  ["network", { token: "t", fetchImpl: () => Promise.reject(new Error("offline")) }],
]) {
  test(`${name} -> relaxed${name === "no token" ? ", no fetch" : ""}`, async () => {
    const e = env(opts); await flush();
    assert.equal(e.api.mood, "relaxed");
    if (name === "no token") assert.equal(e.calls.length, 0);
  });
}
test("waits for the app's token (za-sync-token) before fetching", async () => {
  const e = env({ fetchImpl: res(200, { ok: true, found: true, mood: "up" }) });
  assert.equal(e.calls.length, 0);
  e.win.zaGetSyncToken = () => "tok"; fire(e); await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.api.mood, "happy");
});

test("tap reactions per mood (both variants) with a short bubble", () => {
  const exp = { happy: [["jump", "呼嚕呼嚕～"], ["wiggle", "喵！好開心"]], relaxed: [["blink", "喵~"], ["stretch", "伸個懶腰～"]], sad: [["shrink", "蹭蹭…"], ["cling", "需要秀秀"]] };
  for (const mood of Object.keys(exp)) {
    exp[mood].forEach(([k, txt], i) => {
      const e = env(); e.api.setMood(mood);
      assert.equal(e.api.tap(1000, i === 0 ? 0 : 0.99), k);
      assert.equal(e.api.bubble, txt);
      assert.ok(e.box.classList.contains("r-" + k));
      const b = e.box.children.find((c) => c.className === "za-pc-bubble"); assert.ok(b);
      assert.ok(e.timers.some((t) => t.ms === 1500), "bubble removed after 1.5s");
    });
  }
});
test("rapid taps: 5th tap within 2s hisses, then 3s cooldown ignores taps, then normal again", () => {
  const e = env(); e.api.setMood("happy");
  for (let i = 0; i < 4; i++) assert.notEqual(e.api.tap(1000 + i * 300, 0), "hiss");
  assert.equal(e.api.tap(2300, 0), "hiss"); assert.equal(e.api.bubble, "哈～！別一直戳");
  assert.equal(e.api.tap(3000, 0), null); assert.equal(e.api.tap(5200, 0), null);
  assert.equal(e.api.tap(5400, 0), "jump");
  // 慢慢點不會哈氣
  const f = env(); for (let i = 0; i < 10; i++) assert.notEqual(f.api.tap(i * 600, 0), "hiss");
});
test("long press (600ms) -> pet with hearts, and the click after it does not also tap", () => {
  const e = env();
  e.box.listeners.pointerdown[0]();
  const t = e.timers.find((x) => x.ms === 600); assert.ok(t); t.f();
  assert.equal(e.api.last, "pet"); assert.equal(e.api.bubble, "呼嚕～♥");
  assert.equal(e.box.children.filter((c) => c.className === "za-pc-heart").length, 3);
  const before = e.api.last; e.box.listeners.click[0]({ preventDefault() {} });
  assert.equal(e.api.last, before);
  assert.ok(e.vib.length >= 1, "light haptic when available");
});

test("empty token first, then token arrives -> exactly one fetch and mood applied", async () => {
  let tok = "";
  const e = env({ token: "", fetchImpl: res(200, { ok: true, found: true, mood: "up" }) });
  e.win.zaGetSyncToken = () => tok;
  fire(e); await flush();
  assert.equal(e.calls.length, 0); assert.equal(e.api.mood, "relaxed");
  tok = "tok-a"; fire(e); await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].init.headers.authorization, "Bearer tok-a"); assert.equal(e.api.mood, "happy");
});
test("token changed in 計畫設定 -> refetch once; same token again -> no refetch", async () => {
  let tok = "tok-a", mood = "up";
  const e = env({ token: "tok-a", fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, found: true, mood }) }) });
  e.win.zaGetSyncToken = () => tok;
  await flush(); assert.equal(e.calls.length, 1); assert.equal(e.api.mood, "happy");
  fire(e); fire(e); await flush();
  assert.equal(e.calls.length, 1, "same token: no refetch");
  tok = "tok-b"; mood = "down"; fire(e); await flush();
  assert.equal(e.calls.length, 2); assert.equal(e.calls[1].init.headers.authorization, "Bearer tok-b"); assert.equal(e.api.mood, "sad");
  tok = ""; fire(e); await flush();
  assert.equal(e.calls.length, 2); assert.equal(e.api.mood, "relaxed", "token cleared -> relaxed, no fetch");
});
test("stale response from an old token is ignored", async () => {
  let tok = "tok-a"; const pending = [];
  const e = env({ token: "tok-a", fetchImpl: () => new Promise((r) => pending.push(r)) });
  e.win.zaGetSyncToken = () => tok;
  tok = "tok-b"; fire(e);
  pending[1]({ ok: true, json: () => Promise.resolve({ ok: true, found: true, mood: "down" }) }); await flush();
  pending[0]({ ok: true, json: () => Promise.resolve({ ok: true, found: true, mood: "up" }) }); await flush();
  assert.equal(e.api.mood, "sad");
});
test("failure after token arrives -> relaxed", async () => {
  let tok = "";
  const e = env({ token: "", fetchImpl: res(401, { ok: false }) });
  e.win.zaGetSyncToken = () => tok; tok = "bad"; fire(e); await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.api.mood, "relaxed");
});

test("typing a token in 計畫設定 (many events quickly) -> only the final token is fetched", async () => {
  let tok = "";
  const e = env({ token: "", fetchImpl: res(200, { ok: true, found: true, mood: "up" }) });
  e.win.zaGetSyncToken = () => tok;
  for (const t of ["a", "ab", "abc", "abcd"]) { tok = t; e.wl["za-sync-token"].forEach((f) => f()); }
  const pend = e.timers.filter((x) => x.ms === 800); assert.equal(pend.length, 4);
  pend[pend.length - 1].f(); await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.calls[0].init.headers.authorization, "Bearer abcd");
});

test("pair loads once in both motion modes; the pair owns reduced-motion behavior", () => {
  const r = env({ reduce: true }); assert.equal(r.scripts.length, 1); assert.equal(r.api.shown, true);
  const n = env(); assert.equal(n.scripts.length, 1); assert.match(n.scripts[0].src, /za-catspace\.js/);
});
test("headerGap() gives the gap position for the roaming cat, or null when too small", () => {
  const { api } = env({ titleRight: 169, btnLeft: 270 });
  const g = api.headerGap(48); assert.ok(g.x >= 169 && g.x + 48 <= 270); assert.ok(api.headerGap(200) === null);
});

// ── 盤中每 5 分鐘重讀心情 ──
const TPE = (iso) => Date.parse(iso + "+08:00");          // 台北時間
const ok = (mood) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, found: true, mood }) });
const pollTimers = (e) => e.timers.filter((x) => x.ms === 5 * 60 * 1000);
async function tickPoll(e, clock, ms = 5 * 60 * 1000) { clock.t += ms; const t = pollTimers(e).pop(); e.timers = e.timers.filter((x) => x !== t); t.f(); await flush(); }

test("market hours are computed in Asia/Taipei, Mon-Fri 09:00-13:30, regardless of device time zone", () => {
  const { api } = env({ token: "" });
  assert.equal(api.marketOpen(TPE("2026-10-16T09:00:00")), true, "Fri 09:00");
  assert.equal(api.marketOpen(TPE("2026-10-16T13:30:00")), true, "Fri 13:30");
  assert.equal(api.marketOpen(TPE("2026-10-16T13:31:00")), false);
  assert.equal(api.marketOpen(TPE("2026-10-16T08:59:00")), false);
  assert.equal(api.marketOpen(TPE("2026-10-17T10:00:00")), false, "Saturday");
  assert.equal(api.marketOpen(TPE("2026-10-18T10:00:00")), false, "Sunday");
  assert.equal(api.marketOpen(Date.parse("2026-10-16T02:00:00Z")), true, "02:00 UTC = 10:00 Taipei");
});

test("during market hours: refetches every 5 min with the Bearer header (never in the URL) and applies mood changes", async () => {
  const clock = { t: TPE("2026-10-16T10:00:00") }; let mood = "flat";
  const e = env({ token: "tok-1", clock, fetchImpl: () => ok(mood)() }); await flush();
  assert.equal(e.calls.length, 1); assert.equal(e.api.mood, "relaxed");
  mood = "down"; await tickPoll(e, clock);
  assert.equal(e.calls.length, 2); assert.equal(e.api.mood, "sad");
  for (const c of e.calls) { assert.equal(c.u, "/api/spider"); assert.equal(c.init.headers.authorization, "Bearer tok-1"); assert.ok(!c.u.includes("tok")); }
  mood = "up"; await tickPoll(e, clock); assert.equal(e.api.mood, "happy"); assert.equal(e.calls.length, 3);
});

test("outside market hours and on weekends: no refetch (timer keeps checking cheaply)", async () => {
  for (const iso of ["2026-10-16T14:00:00", "2026-10-16T07:00:00", "2026-10-17T10:00:00", "2026-10-18T11:00:00"]) {
    const clock = { t: TPE(iso) };
    const e = env({ token: "tok", clock, fetchImpl: ok("flat") }); await flush();
    for (let i = 0; i < 6; i++) await tickPoll(e, clock, 1000);   // 不跨過盤中
    assert.equal(e.calls.length, 1, iso + ": only the initial load");
  }
});

test("hidden tab: no refetch; back to visible after >5 min -> exactly one catch-up fetch; soon after -> none", async () => {
  const clock = { t: TPE("2026-10-16T10:00:00") };
  const e = env({ token: "tok", clock, fetchImpl: ok("flat") }); await flush();
  e.doc.hidden = true; await tickPoll(e, clock); await tickPoll(e, clock);
  assert.equal(e.calls.length, 1, "paused while hidden");
  e.doc.hidden = false; e.dl.visibilitychange.forEach((f) => f()); await flush();
  assert.equal(e.calls.length, 2, "stale -> one catch-up");
  clock.t += 60 * 1000; e.doc.hidden = true; e.dl.visibilitychange.forEach((f) => f()); e.doc.hidden = false; e.dl.visibilitychange.forEach((f) => f()); await flush();
  assert.equal(e.calls.length, 2, "fresh -> no extra fetch");
});

test("no overlapping requests: a slow response blocks the next poll", async () => {
  const clock = { t: TPE("2026-10-16T10:00:00") }; let release;
  const e = env({ token: "tok", clock, fetchImpl: () => new Promise((r) => { release = () => r({ ok: true, json: () => Promise.resolve({ ok: true, found: true, mood: "up" }) }); }) });
  await tickPoll(e, clock); await tickPoll(e, clock);
  assert.equal(e.calls.length, 1, "still waiting on the first one");
  release(); await flush(); assert.equal(e.api.mood, "happy");
  await tickPoll(e, clock); assert.equal(e.calls.length, 2);
});

test("refresh failure keeps the current mood (no flapping); first-load failure is still relaxed", async () => {
  const clock = { t: TPE("2026-10-16T10:00:00") }; let mode = "down";
  const e = env({ token: "tok", clock, fetchImpl: () => mode === "down" ? ok("down")() : mode === "500" ? Promise.resolve({ ok: false, status: 500 }) : mode === "nf" ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, found: false }) }) : Promise.reject(new Error("net")) });
  await flush(); assert.equal(e.api.mood, "sad");
  for (mode of ["500", "net", "nf"]) { await tickPoll(e, clock); assert.equal(e.api.mood, "sad", mode); }
  const f = env({ token: "tok", clock: { t: clock.t }, fetchImpl: () => Promise.reject(new Error("x")) }); await flush();
  assert.equal(f.api.mood, "relaxed");
});

test("hanging fetch is aborted after 10s -> treated as refresh failure (mood kept), and the next poll still runs", async () => {
  const clock = { t: TPE("2026-10-16T10:00:00") }; let n = 0, aborted = 0;
  const e = env({ token: "tok", clock, fetchImpl: (u, init) => {
    n++;
    if (n === 1) return ok("down")();
    return new Promise((res, rej) => init.signal.addEventListener("abort", () => { aborted++; rej(new Error("AbortError")); }));
  } });
  await flush(); assert.equal(e.api.mood, "sad");
  await tickPoll(e, clock);
  assert.equal(e.calls.length, 2); assert.ok(e.calls[1].init.signal, "request carries an AbortSignal");
  await tickPoll(e, clock); assert.equal(e.calls.length, 2, "no overlap while hanging");
  const k = e.timers.filter((x) => x.ms === 10000); assert.ok(k.length >= 1, "10s abort timer armed");
  k.forEach((x) => x.f()); await flush();
  assert.ok(aborted >= 1); assert.equal(e.api.mood, "sad", "failure path keeps the current mood");
  await tickPoll(e, clock); assert.equal(e.calls.length, 3, "next poll runs after the abort (inflight reset)");
});
