import { describe, expect, it } from "vitest";
import { countTokens, countRequestTokens } from "../src/token-counter.js";
import type { AnthropicRequest } from "../src/types.js";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts a single short word as 1 token", () => {
    expect(countTokens("hi")).toBe(1);
  });

  it("counts a 4-char word as 1 token", () => {
    expect(countTokens("four")).toBe(1);
  });

  it("counts a 5-char word as 2 tokens", () => {
    // "hello" → ["hell","o"] → 2 tokens
    expect(countTokens("hello")).toBe(2);
  });

  it("counts two 4-char words as 2 tokens", () => {
    expect(countTokens("abcd efgh")).toBe(2);
  });

  it("counts an 8-char word as 2 tokens", () => {
    // "abcdefgh" → ["abcd","efgh"] → 2
    expect(countTokens("abcdefgh")).toBe(2);
  });

  it("counts a 9-char word as 3 tokens", () => {
    // "abcdefghi" → ["abcd","efgh","i"] → 3
    expect(countTokens("abcdefghi")).toBe(3);
  });

  it("counts a 12-char word as 3 tokens", () => {
    // "abcdefghijkl" → 3 chunks of 4
    expect(countTokens("abcdefghijkl")).toBe(3);
  });

  it("handles multiple spaces between words", () => {
    expect(countTokens("  hello   world  ")).toBe(4); // 2+2
  });

  it("handles newlines as whitespace", () => {
    expect(countTokens("hello\nworld")).toBe(4); // 2+2
  });

  it("handles tabs as whitespace", () => {
    expect(countTokens("ab\tcd")).toBe(2);
  });

  it("counts a mix of short and long words correctly", () => {
    // "hi" (1) + "hello" (2) + "four" (1) = 4
    expect(countTokens("hi hello four")).toBe(4);
  });
});

describe("countRequestTokens", () => {
  it("counts tokens from a simple user message", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "hello world" }],
    };
    // "hello" (2) + "world" (2) = 4
    expect(countRequestTokens(req)).toBe(4);
  });

  it("counts tokens from the system prompt", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [],
      system: "You are a bot",
    };
    // "You" (1) + "are" (1) + "a" (1) + "bot" (1) = 4
    expect(countRequestTokens(req)).toBe(4);
  });

  it("counts tokens from both system and messages", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      system: "Sys",
    };
    // "Sys" (1) + "Hi" (1) = 2
    expect(countRequestTokens(req)).toBe(2);
  });

  it("counts tokens from content blocks", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hi there" }],
        },
      ],
    };
    // "Hi" (1) + "there" (2) = 3
    expect(countRequestTokens(req)).toBe(3);
  });

  it("counts tokens from tool_result content", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01",
              content: "done ok",
            },
          ],
        },
      ],
    };
    // "done" (1) + "ok" (1) = 2
    expect(countRequestTokens(req)).toBe(2);
  });

  it("returns 0 for empty messages and no system", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [],
    };
    expect(countRequestTokens(req)).toBe(0);
  });

  it("accumulates tokens across multiple messages", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user", content: "Hi" },      // 1
        { role: "assistant", content: "Hello" }, // 2
        { role: "user", content: "Go" },         // 1
      ],
    };
    expect(countRequestTokens(req)).toBe(4);
  });
});
