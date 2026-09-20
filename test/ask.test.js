import { describe, it, expect } from "vitest";
import { parseToolCalls, ALLOWED_TOOL_NAMES, normalizeAskCacheHistory, buildAskCacheKey } from "../functions/ask.js";

describe("parseToolCalls", () => {
  it("keeps a call whose name is on the allowlist", () => {
    const result = { tool_calls: [{ id: "1", name: "add_trade", arguments: { symbol: "2330" } }] };
    expect(parseToolCalls(result)).toEqual([{ id: "1", name: "add_trade", arguments: { symbol: "2330" } }]);
  });

  it("drops a call whose name is not on the allowlist — this is the actual security boundary", () => {
    expect(ALLOWED_TOOL_NAMES.has("delete_everything")).toBe(false);
    const result = { tool_calls: [{ id: "1", name: "delete_everything", arguments: {} }] };
    expect(parseToolCalls(result)).toEqual([]);
  });

  it("reads calls from the OpenAI-style choices[0].message.tool_calls shape too", () => {
    const result = {
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "update_goal", arguments: '{"targetYear":2035}' } }] } }],
    };
    expect(parseToolCalls(result)).toEqual([{ id: "c1", name: "update_goal", arguments: { targetYear: 2035 } }]);
  });

  it("parses arguments that arrive as a fenced JSON code block", () => {
    const result = { tool_calls: [{ id: "1", name: "add_trade", arguments: "```json\n{\"symbol\":\"2330\"}\n```" }] };
    expect(parseToolCalls(result)[0].arguments).toEqual({ symbol: "2330" });
  });

  it("falls back to an empty arguments object when the JSON is malformed, instead of throwing", () => {
    const result = { tool_calls: [{ id: "1", name: "add_trade", arguments: "{not json" }] };
    expect(parseToolCalls(result)[0].arguments).toEqual({});
  });

  it("returns an empty array when there are no tool calls", () => {
    expect(parseToolCalls({})).toEqual([]);
    expect(parseToolCalls({ tool_calls: [] })).toEqual([]);
  });
});

describe("normalizeAskCacheHistory", () => {
  it("keeps only the last 2 turns and truncates long content", () => {
    const history = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c".repeat(500) },
    ];
    const out = normalizeAskCacheHistory(history);
    expect(out).toHaveLength(2);
    expect(out[1].content.length).toBe(300);
  });

  it("drops entries with an invalid role or non-string content", () => {
    const history = [{ role: "system", content: "x" }, { role: "user", content: 123 }];
    expect(normalizeAskCacheHistory(history)).toEqual([]);
  });
});

describe("buildAskCacheKey", () => {
  it("produces different keys for private-context vs no-context requests", () => {
    const withContext = buildAskCacheKey("hi", [], "持股：2330 x 1000", []);
    const withoutContext = buildAskCacheKey("hi", [], "", []);
    expect(withContext).not.toBe(withoutContext);
  });

  it("is stable for the same effective inputs", () => {
    const a = buildAskCacheKey("hi", [{ role: "user", content: "x" }], "", []);
    const b = buildAskCacheKey("hi", [{ role: "user", content: "x" }], "", []);
    expect(a).toBe(b);
  });
});
