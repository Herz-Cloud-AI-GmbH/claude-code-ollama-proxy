import { describe, expect, it } from "vitest";
import { generateToolUseId, healToolArguments } from "../src/tool-healing.js";

describe("generateToolUseId", () => {
  it("generates an ID matching the toolu_ prefix pattern", () => {
    const id = generateToolUseId();
    expect(id).toMatch(/^toolu_[0-9a-f]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateToolUseId()));
    expect(ids.size).toBe(100);
  });
});

describe("healToolArguments", () => {
  it("returns an object as-is when already an object", () => {
    const input = { command: "ls", flag: "-la" };
    expect(healToolArguments(input)).toEqual(input);
  });

  it("parses a valid JSON string to an object", () => {
    const input = '{"command":"ls","flag":"-la"}';
    expect(healToolArguments(input)).toEqual({ command: "ls", flag: "-la" });
  });

  it("handles JSON string with nested object", () => {
    const input = '{"options":{"recursive":true},"path":"/tmp"}';
    expect(healToolArguments(input)).toEqual({
      options: { recursive: true },
      path: "/tmp",
    });
  });

  it("repairs double-escaped JSON string (backslash before quotes)", () => {
    // Simulate: model returned {\"command\":\"ls\"} (backslash-escaped quotes without outer quotes)
    const input = '{\\"command\\":\\"ls\\"}';
    const result = healToolArguments(input);
    expect(result).toEqual({ command: "ls" });
  });

  it("repairs double-stringified JSON (outer quotes wrapping JSON string)", () => {
    // Simulate: model returned "{\"command\":\"ls\"}" (string containing JSON)
    const inner = JSON.stringify({ command: "ls" }); // '{"command":"ls"}'
    const outer = JSON.stringify(inner); // '"{\\"command\\":\\"ls\\"}"'
    const result = healToolArguments(outer);
    expect(result).toEqual({ command: "ls" });
  });

  it("wraps unrecoverable input in {raw: ...}", () => {
    expect(healToolArguments("not-json")).toEqual({ raw: "not-json" });
  });

  it("wraps null in {raw: null}", () => {
    expect(healToolArguments(null)).toEqual({ raw: null });
  });

  it("wraps number in {raw: 42}", () => {
    expect(healToolArguments(42)).toEqual({ raw: 42 });
  });

  it("returns empty object unchanged", () => {
    expect(healToolArguments({})).toEqual({});
  });

  it("handles JSON string with unicode characters", () => {
    const input = '{"message":"héllo wörld"}';
    expect(healToolArguments(input)).toEqual({ message: "héllo wörld" });
  });

  it("handles JSON string with backslash paths (windows-style)", () => {
    const input = '{"path":"C:\\\\Users\\\\test"}';
    expect(healToolArguments(input)).toEqual({ path: "C:\\Users\\test" });
  });
});
