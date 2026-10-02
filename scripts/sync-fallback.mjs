// 把主 AI 助手（functions/ask.js）原封不動複製成 Vercel 備援的核心。
// 備援只多了 api/ask.js 這層「把 env.AI.run 轉成 Gemini」的轉接，邏輯全部共用，
// 所以主程式改了提示詞、工具或限制之後，跑一次這支就能讓備援同步；
// tests/fallback-vercel.test.mjs 會在兩邊不一致時讓 npm test 失敗，避免備援悄悄落後。
import fs from "node:fs";

fs.copyFileSync("functions/ask.js", "fallback-vercel/lib/ask-core.js");
const ver = fs.readFileSync("functions/ask.js", "utf8").match(/const ASK_VERSION = "([^"]+)"/)?.[1];
console.log(`已同步 fallback-vercel/lib/ask-core.js（ASK_VERSION ${ver}）`);
console.log("記得把 VERSION.json 的 cloudflare.ask.js 與 vercel.ask-core.js 改成同一個版本，再跑 npm run check:version。");
