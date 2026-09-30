// Paste after the existing zinf visibility/online useEffect in index.html.
// Quotes stay 15s on device. KV sync during TWSE hours at most every 5 minutes.

useEffect(() => {
  if (!ready || !zinfSyncToken) return;
  const inSession = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    if (["Sat", "Sun"].includes(map.weekday)) return false;
    const hm = Number(map.hour) * 60 + Number(map.minute);
    return hm >= 9 * 60 && hm <= 13 * 60 + 35;
  };
  const tick = () => { if (inSession()) runZinfSync({ rebuild: true }); };
  const id = setInterval(tick, 5 * 60 * 1000);
  const first = setTimeout(tick, 8000);
  return () => { clearInterval(id); clearTimeout(first); };
}, [ready, zinfSyncToken]);
