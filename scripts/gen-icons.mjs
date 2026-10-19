// 只把 App 用到的 lucide 圖示（src/app.jsx 裡的 LR.Xxx）抄成 src/lucide-icons.js，
// 取代整包 lucide-react UMD（約 707 KB）。圖形資料與元件寫法照 lucide-react 0.344.0（ISC 授權）。
// 用法：node scripts/gen-icons.mjs（App 新增圖示時跑一次，再 npm run build:app）。
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
export const ICONS_OUT = fileURLToPath(new URL("src/lucide-icons.js", root));
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

export function usedIcons(src) {
  return [...new Set([...src.matchAll(/\bLR\.([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))].sort();
}

// 照 lucide-react 的匯出表找檔案（例如 Loader2 → icons/loader-2.js），名稱和舊的 UMD 全域完全一樣。
export function iconNode(name) {
  const index = fs.readFileSync(fileURLToPath(new URL("node_modules/lucide-react/dist/esm/lucide-react.js", root)), "utf8");
  const hit = index.split("\n").find((l) => new RegExp(`default as ${name}[,\\s}]`).test(l));
  const file = hit && hit.match(/from '\.\/(icons\/[^']+)'/);
  if (!file) throw new Error("找不到圖示 " + name);
  const code = fs.readFileSync(fileURLToPath(new URL(`node_modules/lucide-react/dist/esm/${file[1]}`, root)), "utf8");
  const m = code.match(/createLucideIcon\("([^"]+)", (\[[\s\S]*?\])\);\n/);
  if (!m) throw new Error("讀不到圖示 " + name);
  return { iconName: m[1], nodes: new Function("return " + m[2])() };
}

export function generate(src) {
  const names = usedIcons(src);
  const data = Object.fromEntries(names.map((n) => [n, iconNode(n)]));
  return `/* 自動產生，請勿手動修改：node scripts/gen-icons.mjs。lucide-react 0.344.0 的 ${names.length} 個圖示（ISC License, Copyright (c) Lucide Contributors）。 */
(function () {
  if (window.LucideReact) return;
  var React = window.React; if (!React) return;
  var kebab = function (s) { return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); };
  var base = { xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" };
  var make = function (name, icon) {
    var nodes = icon.nodes; name = icon.iconName;
    var C = React.forwardRef(function (props, ref) {
      var color = props.color === undefined ? "currentColor" : props.color, size = props.size === undefined ? 24 : props.size;
      var strokeWidth = props.strokeWidth === undefined ? 2 : props.strokeWidth, className = props.className || "", children = props.children;
      var rest = {}; for (var k in props) if (["color", "size", "strokeWidth", "absoluteStrokeWidth", "className", "children"].indexOf(k) < 0) rest[k] = props[k];
      var attrs = Object.assign({ ref: ref }, base, { width: size, height: size, stroke: color,
        strokeWidth: props.absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size) : strokeWidth,
        className: ["lucide", "lucide-" + kebab(name), className].join(" ") }, rest);
      return React.createElement("svg", attrs, nodes.map(function (n) { return React.createElement(n[0], n[1]); }).concat(Array.isArray(children) ? children : [children]));
    });
    C.displayName = name; return C;
  };
  var data = ${JSON.stringify(data)};
  var out = {}; for (var n in data) out[n] = make(n, data[n]);
  window.LucideReact = out;
})();
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const src = fs.readFileSync(fileURLToPath(new URL("src/app.jsx", root)), "utf8");
  fs.writeFileSync(ICONS_OUT, generate(src));
  console.log(`已產生 src/lucide-icons.js（${usedIcons(src).length} 個圖示，${fs.statSync(ICONS_OUT).size} bytes）`);
}
