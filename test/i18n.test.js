import { describe, it, expect, afterEach } from "vitest";
import { translate, setLang, getLang } from "../src/lib/i18n.jsx";

afterEach(() => {
  setLang("zh");
});

describe("translate — placeholder substitution must happen in both languages", () => {
  it("substitutes {vars} into the zh (default) text, not just the en translation", () => {
    // This is a real string from the app that has no "en" dictionary entry
    // registered in this test's scope — the point is that even a raw,
    // untranslated key must still get its own {placeholders} filled in.
    const out = translate("測試 {n} 筆", { n: 3 });
    expect(out).toBe("測試 3 筆");
    expect(out).not.toContain("{n}");
  });

  it("substitutes {vars} into the en translation when a dictionary entry exists", () => {
    setLang("en");
    // A real, known dictionary entry with a placeholder.
    const out = translate("{n} 分鐘前", { n: 5 });
    expect(out).toBe("5 min ago");
  });

  it("falls back to the zh key (with vars substituted) when no en entry exists", () => {
    setLang("en");
    const out = translate("這個字串沒有翻譯 {n}", { n: 1 });
    expect(out).toBe("這個字串沒有翻譯 1");
  });

  it("returns the key unchanged when there are no vars to substitute", () => {
    expect(translate("固定文字")).toBe("固定文字");
  });

  it("getLang reflects the current language", () => {
    expect(getLang()).toBe("zh");
    setLang("en");
    expect(getLang()).toBe("en");
  });
});
