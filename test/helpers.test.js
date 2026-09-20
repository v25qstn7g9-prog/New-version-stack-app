import { describe, it, expect } from "vitest";
import { validateToolCall, buildSchedule, findCrossing, isValidDateStr, finiteNonNegative, isObject } from "../src/lib/helpers.js";

describe("validateToolCall — the gate before an AI-proposed write is applied", () => {
  it("accepts a well-formed add_trade call", () => {
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "buy", shares: 1000, price: 900 } })).toBeNull();
  });

  it("rejects an add_trade with a malformed symbol", () => {
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330; DROP TABLE", action: "buy", shares: 1, price: 1 } })).not.toBeNull();
  });

  it("rejects a non-buy/sell action", () => {
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "transfer", shares: 1, price: 1 } })).not.toBeNull();
  });

  it("rejects non-positive or absurdly large share counts and prices", () => {
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "buy", shares: 0, price: 100 } })).not.toBeNull();
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "buy", shares: -5, price: 100 } })).not.toBeNull();
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "buy", shares: 1e12, price: 100 } })).not.toBeNull();
  });

  it("rejects a malformed trade date", () => {
    expect(validateToolCall({ name: "add_trade", arguments: { symbol: "2330", action: "buy", shares: 1, price: 1, date: "2026/13/40" } })).not.toBeNull();
  });

  it("rejects update_goal when neither field is provided", () => {
    expect(validateToolCall({ name: "update_goal", arguments: {} })).not.toBeNull();
  });

  it("rejects an out-of-range target year", () => {
    expect(validateToolCall({ name: "update_goal", arguments: { targetYear: 1899 } })).not.toBeNull();
  });

  it("passes through unknown tool names (read-only tools have nothing to validate here)", () => {
    expect(validateToolCall({ name: "query_app_data", arguments: {} })).toBeNull();
  });
});

describe("buildSchedule / findCrossing — the plan projection math", () => {
  it("compounds monthly contributions at the given annual return", () => {
    const rows = buildSchedule({
      startDate: "2026-01-01", initialPrincipal: 0, initialAssets: 0,
      monthlyAmount: 10000, annualReturn: 0, horizonMonths: 12,
    });
    expect(rows).toHaveLength(13); // month 0..12 inclusive
    expect(rows[12].principal).toBe(120000);
    expect(rows[12].assets).toBe(120000); // 0% return: assets track principal exactly
  });

  it("findCrossing interpolates the fractional month a target is first reached", () => {
    const schedule = [{ index: 0, assets: 0 }, { index: 1, assets: 100 }, { index: 2, assets: 200 }];
    const hit = findCrossing(schedule, "assets", 150);
    expect(hit.index).toBeCloseTo(1.5, 5);
  });

  it("findCrossing reports beyond:true when the schedule never reaches the target", () => {
    const schedule = [{ index: 0, assets: 0 }, { index: 1, assets: 50 }];
    expect(findCrossing(schedule, "assets", 1000)).toEqual({ index: 1, beyond: true });
  });
});

describe("backup-import validation guards", () => {
  it("isValidDateStr accepts YYYY-MM-DD and rejects garbage", () => {
    expect(isValidDateStr("2026-09-20")).toBe(true);
    expect(isValidDateStr("2026/09/20")).toBe(false);
    expect(isValidDateStr("not-a-date")).toBe(false);
  });

  it("finiteNonNegative rejects negatives, NaN and Infinity", () => {
    expect(finiteNonNegative(0)).toBe(true);
    expect(finiteNonNegative(5)).toBe(true);
    expect(finiteNonNegative(-1)).toBe(false);
    expect(finiteNonNegative(NaN)).toBe(false);
    expect(finiteNonNegative(Infinity)).toBe(false);
  });

  it("isObject distinguishes plain objects from arrays/null/primitives", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);
    expect(isObject("x")).toBe(false);
  });
});
