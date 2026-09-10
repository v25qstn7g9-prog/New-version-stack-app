import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const version = JSON.parse(read("VERSION.json"));

function grab(text, re, label) {
  const m = text.match(re);
  if (!m) throw new Error(`找不到 ${label}`);
  return m[1];
}

const actual = {
  app: grab(read("index.html"), /const APP_VERSION = "([^"]+)"/, "APP_VERSION"),
  quote: grab(read("functions/quote.js"), /const QUOTE_VERSION = "([^"]+)"/, "QUOTE_VERSION"),
  ask: grab(read("functions/ask.js"), /const ASK_VERSION = "([^"]+)"/, "ASK_VERSION"),
  news: grab(read("functions/news.js"), /const NEWS_VERSION = "([^"]+)"/, "NEWS_VERSION"),
  health: grab(read("functions/health-check.js"), /const HEALTH_VERSION = "([^"]+)"/, "HEALTH_VERSION"),
  cfModel: grab(read("functions/ask.js"), /const MODEL = "([^"]+)"/, "Cloudflare MODEL"),
  fallbackCore: grab(read("fallback-vercel/lib/ask-core.js"), /const ASK_VERSION = "([^"]+)"/, "fallback ASK_VERSION"),
  fallbackModel: grab(read("fallback-vercel/api/ask.js"), /const DEFAULT_GEMINI_MODEL = "([^"]+)"/, "DEFAULT_GEMINI_MODEL"),
  fallbackPackage: JSON.parse(read("fallback-vercel/package.json")).version,
};

const expected = {
  app: version.cloudflare["index.html"],
  quote: version.cloudflare["quote.js"],
  ask: version.cloudflare["ask.js"],
  news: version.cloudflare["news.js"],
  health: version.cloudflare["health-check.js"],
  cfModel: version.cloudflare.model,
  fallbackCore: version.vercel["ask-core.js"],
  fallbackModel: version.vercel.model,
  fallbackPackage: version.vercel.package,
};

let failed = false;
for (const key of Object.keys(expected)) {
  const ok = actual[key] === expected[key];
  console.log(`${ok ? "✓" : "✗"} ${key}: ${actual[key]}`);
  if (!ok) {
    console.error(`  VERSION.json 預期：${expected[key]}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("\n版本一致性：全部通過");
