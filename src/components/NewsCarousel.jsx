import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Newspaper } from "../lib/icons.jsx";
import { COLORS } from "../lib/constants.js";
import { fetchStockNews, relativeTimeLabel, loadKey, saveKey } from "../lib/helpers.js";
import { Panel } from "./Panel.jsx";
import { useLanguage } from "../lib/i18n.jsx";

function NewsCarousel({ holdings }) {
  const { t } = useLanguage();
  const [newsList, setNewsList] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const touchStartX = useRef(null);

  const activeHoldings = holdings.filter((h) => Number(h.current || 0) > 0 && h.symbol);
  const activeKey = activeHoldings.map((h) => h.symbol).sort().join(",");

  const buildFlatList = (newsBySymbol) => {
    const list = [];
    for (const h of activeHoldings) {
      const items = newsBySymbol[h.symbol];
      if (!items) continue;
      for (const it of items) list.push({ ...it, symbol: h.symbol, name: h.name });
    }
    return list;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 快取 3 小時內、且持股組合沒變就直接沿用，避免每次開 App 都重新打新聞來源。
      const cached = await loadKey("stockNews", null);
      const freshEnough = cached && cached.symbolsKey === activeKey &&
        (Date.now() - new Date(cached.at).getTime()) < 3 * 3600 * 1000;

      if (freshEnough) {
        if (!cancelled) { setNewsList(buildFlatList(cached.news || {})); setIdx(0); setLoaded(true); }
        return;
      }
      if (!activeHoldings.length) { if (!cancelled) setLoaded(true); return; }

      try {
        const news = await fetchStockNews(activeHoldings);
        const freshList = buildFlatList(news);

        if (freshList.length > 0) {
          // 有抓到新內容：顯示並更新快取。
          if (!cancelled) { setNewsList(freshList); setIdx(0); setLoaded(true); }
          saveKey("stockNews", { news, at: new Date().toISOString(), symbolsKey: activeKey });
        } else {
          // API 正常回應但暫時沒有新聞時，不要把畫面清空；優先沿用最後一次成功快取。
          // 這是之前新聞卡會突然整張消失的主要漏洞。
          const cachedList = cached ? buildFlatList(cached.news || {}) : [];
          if (!cancelled) { setNewsList(cachedList); setIdx(0); setLoaded(true); }
        }
      } catch (e) {
        // API 失敗也沿用最後一次成功快取；沒有快取才維持空白。
        const cachedList = cached ? buildFlatList(cached.news || {}) : [];
        if (!cancelled) { setNewsList(cachedList); setIdx(0); setLoaded(true); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  if (!loaded || newsList.length === 0) return null;

  const goTo = (i) => setIdx(((i % newsList.length) + newsList.length) % newsList.length);
  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx > 40) goTo(idx - 1);
    else if (dx < -40) goTo(idx + 1);
    touchStartX.current = null;
  };

  const item = newsList[idx];

  return (
    <div data-no-page-swipe="true" className="rounded-2xl p-4" style={{
      background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}`,
      boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
    }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs" style={{ color: COLORS.sub }}>
          <Newspaper size={13} /> {t("持股新聞")}
        </div>
        {newsList.length > 1 && (
          <div className="flex items-center gap-2">
            <button onClick={() => goTo(idx - 1)} style={{ color: COLORS.sub }}><ChevronLeft size={16} /></button>
            <button onClick={() => goTo(idx + 1)} style={{ color: COLORS.sub }}><ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      <div className="text-xs font-bold mono" style={{ color: COLORS.gold }}>{item.symbol}｜{item.name}</div>
      <div className="text-sm font-bold mt-1 leading-snug">{item.title}</div>
      <div className="text-[11px] mt-1.5" style={{ color: COLORS.sub }}>
        {item.source ? `${item.source} · ` : ""}{relativeTimeLabel(item.pubDate)}
      </div>

      <a href={item.link} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 mt-2.5 text-xs font-bold rounded-lg px-3 py-1.5"
        style={{ background: COLORS.gold, color: COLORS.bg }}>
        {t("查看新聞")} <ExternalLink size={12} />
      </a>

      {newsList.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {newsList.map((_, i) => (
            <div key={i} className="rounded-full" style={{
              width: i === idx ? 14 : 6, height: 6,
              background: i === idx ? COLORS.gold : COLORS.panelBorder,
              transition: "width 0.2s",
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Live Price Panel (dashboard) ----------------

export default NewsCarousel;
export { NewsCarousel };
