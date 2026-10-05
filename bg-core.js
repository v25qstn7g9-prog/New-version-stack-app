/* bg-core.js — 背景自動記錄的純邏輯（Service Worker 與 App 共用，也方便單元測試）。
 * 不碰網路、不碰 IndexedDB；輸入都由呼叫端傳入。 */
(function (root) {
  var TZ_MS = 8 * 3600 * 1000;
  var RECORD_FROM_MINUTE = 13 * 60 + 50; // 13:50 之後的推播視為「14:00 那一則」

  function taipei(now) {
    var t = new Date(now.getTime() + TZ_MS);
    return { date: t.toISOString().slice(0, 10), minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(), weekday: t.getUTCDay() };
  }
  function taipeiDay(iso) {
    var t = Date.parse(iso || "");
    return isFinite(t) ? new Date(t + TZ_MS).toISOString().slice(0, 10) : "";
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /** 這則推播該做什麼：reminder（13:45）或 record（14:00）；以及今天是否已有記錄。 */
  function decide(mirror, now) {
    var t = taipei(now);
    if (!mirror || !Array.isArray(mirror.holdings)) return { mode: "no_data", date: t.date };
    var recorded = (mirror.recordDates || []).indexOf(t.date) >= 0;
    return { mode: t.minuteOfDay >= RECORD_FROM_MINUTE ? "record" : "reminder", recorded: recorded, date: t.date };
  }

  /** 把 /quote 回應轉成 { 代號: 報價 }；支援 quotes 是物件或陣列兩種格式。 */
  function quoteMap(payload) {
    var q = payload && payload.quotes, out = {};
    if (Array.isArray(q)) q.forEach(function (r) { if (r && r.symbol) out[String(r.symbol).toUpperCase()] = r; });
    else if (q && typeof q === "object") Object.keys(q).forEach(function (k) { out[k.toUpperCase()] = q[k]; });
    return out;
  }

  /** 每一檔都要有「今天、非過期」的價格才記，不然寧可不記（和 App 內 tryLocal 同一套規則）。 */
  function buildRecord(mirror, quotes, date) {
    var held = (mirror.holdings || []).filter(function (h) { return h && h.symbol && num(h.shares) > 0; });
    if (!held.length) return { ok: false, reason: "no_holdings" };
    var total = 0;
    for (var i = 0; i < held.length; i++) {
      var q = quotes[String(held[i].symbol).toUpperCase()];
      if (!q || !(num(q.price) > 0) || q.isStale || taipeiDay(q.asOfDate) !== date) return { ok: false, reason: "quote_not_ready" };
      total += num(q.price) * num(held[i].shares);
    }
    var prior = mirror.prior || {};
    var costSum = Math.round(held.reduce(function (s, h) { return s + num(h.costBasis); }, 0));
    return {
      ok: true,
      record: {
        date: date, twValue: Math.round(total), twCost: costSum > 0 ? costSum : num(prior.twCost),
        usValue: num(prior.usValue), usCost: num(prior.usCost), source: "auto", autoAt: new Date().toISOString(),
      },
    };
  }

  function nf(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /** 依情況產生通知文字。 */
  function message(decision, built) {
    if (decision.mode === "no_data") return { title: "📒 收盤提醒已開啟", body: "請打開 App 一次，之後才能在背景自動記錄。" };
    if (decision.recorded) return { title: "✓ 今天已記錄好了", body: "不用再記，辛苦了。" };
    if (decision.mode === "reminder") return { title: "📒 記帳提醒", body: "今天還沒記錄。14:00 前沒記的話，會用收盤價自動幫你記。" };
    if (built && built.ok) return { title: "🤖 已自動記錄今天的資產", body: "台股 NT$ " + nf(built.record.twValue) + "（美股沿用上一筆）。打開 App 會收進每日紀錄，要改直接改。" };
    return { title: "⚠️ 沒能自動記錄", body: "報價還沒更新或暫時抓不到。打開 App 會再試一次。" };
  }

  function addDays(date, n) { return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10); }

  /** 最後一筆記錄到今天之間，有沒有「平日」可能漏記（沒有的話連網路都不用打）。 */
  function hasWeekdayGap(lastDate, today) {
    for (var d = addDays(lastDate, 1); d < today; d = addDays(d, 1)) {
      var wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (wd !== 0 && wd !== 6) return true;
    }
    return false;
  }

  /**
   * 補齊缺漏的交易日（不含今天，今天另有規則）。
   * 只在「最後一筆記錄之後完全沒有買賣」時才補，因為股數沒變才能用今天的股數回推；有買賣就不補，交給使用者。
   * 一天要所有持股都有收盤價才補；Yahoo 沒有那一天＝休市，自然跳過。
   */
  function planBackfill(input) {
    var records = (input.dailyRecords || []).filter(function (r) { return r && r.date < input.today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var last = records[records.length - 1];
    if (!last) return { records: [], reason: "no_anchor" };
    if ((input.trades || []).some(function (t) { return t && t.date > last.date; })) return { records: [], reason: "trades_since_last_record" };
    var held = (input.holdings || []).filter(function (h) { return h && h.symbol && num(h.shares) > 0; });
    if (!held.length) return { records: [], reason: "no_holdings" };
    var have = {};
    (input.dailyRecords || []).forEach(function (r) { have[r.date] = true; });
    var dates = {};
    held.forEach(function (h) { Object.keys((input.closes || {})[h.symbol] || {}).forEach(function (d) { dates[d] = true; }); });
    var out = Object.keys(dates).sort().filter(function (d) { return d > last.date && d < input.today && !have[d]; }).slice(0, 20).filter(function (d) {
      return held.every(function (h) { return num(((input.closes || {})[h.symbol] || {})[d]) > 0; });
    }).map(function (d) {
      var total = held.reduce(function (s, h) { return s + num(input.closes[h.symbol][d]) * num(h.shares); }, 0);
      return { date: d, twValue: Math.round(total), twCost: num(last.twCost), usValue: num(last.usValue), usCost: num(last.usCost), source: "auto" };
    });
    return { records: out, reason: out.length ? null : "nothing_to_fill" };
  }

  root.ZinfBg = { addDays: addDays, hasWeekdayGap: hasWeekdayGap, planBackfill: planBackfill, taipei: taipei, decide: decide, quoteMap: quoteMap, buildRecord: buildRecord, message: message, RECORD_FROM_MINUTE: RECORD_FROM_MINUTE };
})(typeof self !== "undefined" ? self : globalThis);
