// 把 src/app.jsx 預先編譯成 app.js（取代瀏覽器端 @babel/standalone 的即時轉譯）。
// 用和舊頁面同版本的 @babel/standalone 在 Node 端轉譯；設定與舊的 <script type="text/babel" data-presets="env,react"> 相同：
// presets env,react + standalone 預設外掛（class-properties、object-rest-spread、flow-strip-types），standalone 不讀任何設定檔。
// 用法：npm run build:app（改過 src/app.jsx 後一定要跑；tests/app-build.test.mjs 會檢查是否同步）。
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
export const SRC = fileURLToPath(new URL("src/app.jsx", root));
export const OUT = fileURLToPath(new URL("app.js", root));

export function header(src) {
  const h = crypto.createHash("sha256").update(src).digest("hex");
  return `/* 自動產生，請勿手動修改：由 src/app.jsx 經 scripts/build-app.mjs 編譯（npm run build:app）。src-sha256: ${h} */\n`;
}

export async function build(src) {
  // 用和舊頁面完全同一版的 @babel/standalone（7.25.6，自帶全部外掛，版本鎖死在 package.json），
  // 產出與瀏覽器先前即時轉譯的程式碼逐字相同（只是不附 inline source map）。
  const { createRequire } = await import("node:module");
  const Babel = createRequire(import.meta.url)("@babel/standalone");
  const out = Babel.transform(src, {
    filename: "app.jsx",
    presets: ["env", "react"],
    plugins: ["transform-class-properties", "transform-object-rest-spread", "transform-flow-strip-types"],
  });
  return header(src) + out.code + "\n";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = fs.readFileSync(SRC, "utf8");
  fs.writeFileSync(OUT, await build(src));
  console.log(`已產生 app.js（${fs.statSync(OUT).size} bytes）`);
}
