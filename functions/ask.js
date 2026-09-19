const ASK_CACHE_TTL_MS = 5 * 60 * 1000;
const ASK_CACHE = new Map();

function normalizeAskCacheHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-2)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 300).trim() }));
}

function buildAskCacheKey(message, history, contextText, toolTurns) {
  const safeMessage = String(message || "").trim();
  const normalizedHistory = normalizeAskCacheHistory(history);
  const safeContextFlag = typeof contextText === "string" && contextText.trim() ? "private-context" : "no-context";
  const toolCount = Array.isArray(toolTurns) ? toolTurns.length : 0;
  return JSON.stringify({
    message: safeMessage.slice(0, 500),
    history: normalizedHistory,
    context: safeContextFlag,
    toolTurns: toolCount,
  });
}

function readAskCache(key) {
  if (!key) return null;
  const hit = ASK_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.timestamp > ASK_CACHE_TTL_MS) {
    ASK_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function writeAskCache(key, value) {
  if (!key || !value || typeof value !== "object") return;
  ASK_CACHE.set(key, { value, timestamp: Date.now() });
  if (ASK_CACHE.size > 200) {
    const oldestKey = ASK_CACHE.keys().next().value;
    if (oldestKey) ASK_CACHE.delete(oldestKey);
  }
}
