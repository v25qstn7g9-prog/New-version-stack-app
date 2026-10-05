/* sw.js — 收盤推播的背景程式。
 * 伺服器在開盤日 13:45、14:00 各推一次（推播不帶內容）。這裡用手機上的資料副本（IndexedDB "zinf-bg"）：
 *   13:45：提醒（已記錄就說已記錄）
 *   14:00：沒記錄 → 抓即時報價、算今天的記錄、存成「待收進 App」，並跳通知；有記錄 → 只通知。
 * iPhone 規定每次推播都必須顯示通知，所以每條路徑都會 showNotification。 */
importScripts("/bg-core.js?v=1");

const DB = "zinf-bg", STORE = "kv";
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(value, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

async function handlePush() {
  const now = new Date();
  let mirror = null;
  try { mirror = await idbGet("mirror"); } catch (e) { mirror = null; }
  const decision = self.ZinfBg.decide(mirror, now);
  let built = null;
  if (decision.mode === "record" && !decision.recorded) {
    try {
      const symbols = mirror.holdings.filter((h) => h && h.symbol && Number(h.shares) > 0).map((h) => h.symbol).join(",");
      const res = await fetch("/quote?force=1&symbols=" + encodeURIComponent(symbols), { cache: "no-store" });
      built = self.ZinfBg.buildRecord(mirror, self.ZinfBg.quoteMap(res.ok ? await res.json() : null), decision.date);
    } catch (e) {
      built = { ok: false, reason: "fetch_failed" };
    }
    if (built.ok) {
      try {
        const pending = (await idbGet("pendingAuto")) || [];
        await idbSet("pendingAuto", [...pending.filter((r) => r.date !== built.record.date), built.record]);
        await idbSet("mirror", { ...mirror, recordDates: [...(mirror.recordDates || []), decision.date] });
      } catch (e) {
        built = { ok: false, reason: "store_failed" };
      }
    }
  }
  const msg = self.ZinfBg.message(decision, built);
  await self.registration.showNotification(msg.title, { body: msg.body, tag: "zinf-daily-" + decision.date + "-" + decision.mode, data: { url: "/" } });
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  event.waitUntil(handlePush().catch((e) => self.registration.showNotification("⚠️ 收盤提醒", { body: "背景處理失敗，打開 App 會再試。", tag: "zinf-daily-error" })));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow((event.notification.data && event.notification.data.url) || "/");
  }));
});
