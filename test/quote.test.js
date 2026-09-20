import { describe, it, expect } from "vitest";
import { isAllowedSymbol, firstNumber, parseTwseItem } from "../functions/quote.js";

describe("isAllowedSymbol", () => {
  it("allows plain 4-digit stock codes", () => {
    expect(isAllowedSymbol("2330")).toBe(true);
  });
  it("allows 6-digit ETF codes with an optional trailing letter", () => {
    expect(isAllowedSymbol("00919")).toBe(true);
    expect(isAllowedSymbol("00679B")).toBe(true);
  });
  it("allows the special TAIEX symbol", () => {
    expect(isAllowedSymbol("TAIEX")).toBe(true);
  });
  it("rejects anything else, including injection-shaped input", () => {
    expect(isAllowedSymbol("../../etc/passwd")).toBe(false);
    expect(isAllowedSymbol("2330;DROP")).toBe(false);
    expect(isAllowedSymbol("")).toBe(false);
    expect(isAllowedSymbol("abcd")).toBe(false);
  });
});

describe("firstNumber", () => {
  it("parses a plain numeric string", () => {
    expect(firstNumber("123.45")).toBe(123.45);
  });
  it("picks the first non-placeholder segment of an underscore-joined TWSE field", () => {
    expect(firstNumber("123.00_124.00_125.00")).toBe(123);
    expect(firstNumber("-_124.00")).toBe(124);
  });
  it("returns NaN for empty/placeholder input", () => {
    expect(firstNumber("-")).toBeNaN();
    expect(firstNumber("")).toBeNaN();
    expect(firstNumber(undefined)).toBeNaN();
  });
});

describe("parseTwseItem", () => {
  it("returns null when prevClose (y) is missing or non-positive", () => {
    expect(parseTwseItem({ y: "-", z: "100" })).toBeNull();
    expect(parseTwseItem({ y: "0", z: "100" })).toBeNull();
  });
  it("prefers the last trade price (z) when present", () => {
    const out = parseTwseItem({ y: "95.5", z: "96.0", tlong: "1700000000000" });
    expect(out.prevClose).toBe(95.5);
    expect(out.price).toBe(96);
    expect(out.priceSource).toBe("last");
  });
  it("falls back to the bid/ask midpoint when there is no last trade", () => {
    const out = parseTwseItem({ y: "95.5", z: "-", b: "94.0_93.9", a: "94.2_94.3" });
    expect(out.price).toBe(94.1);
    expect(out.priceSource).toBe("mid");
  });
  it("falls back to ask-only, then bid-only, when only one side is quoted", () => {
    expect(parseTwseItem({ y: "95.5", z: "-", b: "-", a: "94.2" }).priceSource).toBe("ask");
    expect(parseTwseItem({ y: "95.5", z: "-", b: "94.0", a: "-" }).priceSource).toBe("bid");
  });
  it("marks the quote stale (price: null) when nothing usable is quoted", () => {
    const out = parseTwseItem({ y: "95.5", z: "-", b: "-", a: "-" });
    expect(out.price).toBeNull();
  });
});
