import { createContext, useContext, useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "ui-lang";

// 這個 App 原生就是繁體中文寫的，所以「原文」本身就是 zh 的內容——
// 不需要另外準備一份 zh 字典。en 字典的 key 是畫面上原本的中文字串，
// value 是對應的英文翻譯；t() 在語言是 zh，或英文字典查不到某個 key
// 時，直接回傳原本的中文字串（等於「找不到翻譯就顯示原文」，不會整個空白）。
import { en } from "./translations.js";

let currentLang = "zh";
try {
  const saved = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (saved === "en") currentLang = "en";
} catch {
  // localStorage 不可用（無痕模式等）就維持預設中文。
}

const listeners = new Set();

export function getLang() {
  return currentLang;
}

export function setLang(next) {
  if (next !== "zh" && next !== "en") return;
  currentLang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 存不進去就算了，這次操作內還是會切換語言，只是重新整理後會跑掉。
  }
  listeners.forEach((fn) => fn(next));
}

// 純函式（非 React 元件，例如 src/lib/helpers.js 裡回傳給使用者看的
// 驗證錯誤訊息）也可以直接呼叫這個，不用透過 hook。vars 用來替換
// 字串裡的 {name} 佔位符，給需要帶數字/日期等動態內容的句子用。
export function translate(key, vars) {
  // Vars must be substituted either way — `key` is itself the zh text to
  // render (it's the source language), not just a lookup token, so the
  // zh branch needs its {placeholder}s filled in exactly like the en one.
  let text = currentLang === "en" ? (en[key] ?? key) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(currentLang);

  useEffect(() => {
    const onChange = (next) => setLangState(next);
    listeners.add(onChange);
    return () => listeners.delete(onChange);
  }, []);

  const changeLang = useCallback((next) => setLang(next), []);
  const t = useCallback((key, vars) => translate(key, vars), [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LanguageContext.Provider value={{ lang, setLang: changeLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage 必須在 LanguageProvider 裡面使用");
  return ctx;
}
