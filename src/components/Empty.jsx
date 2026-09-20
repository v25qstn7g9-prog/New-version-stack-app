import { COLORS } from "../lib/constants.js";

function Empty({ text }) {
  return <div className="text-center text-xs py-6" style={{ color: COLORS.sub }}>{text}</div>;
}

// ---------------- AI 聊天/問答（浮動按鈕，任何分頁都叫得出來） ----------------
// 把 AI 提議的動作翻成人看得懂的一句話，讓使用者在按確定前知道到底要發生什麼事。

export default Empty;
export { Empty };
