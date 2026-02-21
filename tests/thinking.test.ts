import { describe, expect, it } from "vitest";
import {
  THINKING_CAPABLE_PREFIXES,
  isThinkingCapable,
  needsThinkingValidation,
} from "../src/thinking.js";
import type { AnthropicRequest } from "../src/types.js";

describe("THINKING_CAPABLE_PREFIXES", () => {
  it("includes expected model prefixes", () => {
    expect(THINKING_CAPABLE_PREFIXES).toContain("qwen3");
    expect(THINKING_CAPABLE_PREFIXES).toContain("deepseek-r1");
    expect(THINKING_CAPABLE_PREFIXES).toContain("magistral");
    expect(THINKING_CAPABLE_PREFIXES).toContain("nemotron");
    expect(THINKING_CAPABLE_PREFIXES).toContain("glm4");
    expect(THINKING_CAPABLE_PREFIXES).toContain("qwq");
  });
});

describe("isThinkingCapable", () => {
  it("returns true for qwen3 with tag", () => {
    expect(isThinkingCapable("qwen3:8b")).toBe(true);
  });

  it("returns true for bare qwen3", () => {
    expect(isThinkingCapable("qwen3")).toBe(true);
  });

  it("returns true for qwen3 large variant", () => {
    expect(isThinkingCapable("qwen3:235b-a22b")).toBe(true);
  });

  it("returns true for deepseek-r1 with tag", () => {
    expect(isThinkingCapable("deepseek-r1:14b")).toBe(true);
  });

  it("returns true for deepseek-r1:latest", () => {
    expect(isThinkingCapable("deepseek-r1:latest")).toBe(true);
  });

  it("returns true for magistral", () => {
    expect(isThinkingCapable("magistral:24b")).toBe(true);
  });

  it("returns true for nemotron", () => {
    expect(isThinkingCapable("nemotron:latest")).toBe(true);
  });

  it("returns true for glm4", () => {
    expect(isThinkingCapable("glm4:9b")).toBe(true);
  });

  it("returns true for qwq", () => {
    expect(isThinkingCapable("qwq:32b")).toBe(true);
  });

  it("returns false for llama3.1", () => {
    expect(isThinkingCapable("llama3.1:8b")).toBe(false);
  });

  it("returns false for mistral", () => {
    expect(isThinkingCapable("mistral:latest")).toBe(false);
  });

  it("returns false for phi4", () => {
    expect(isThinkingCapable("phi4:latest")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isThinkingCapable("Qwen3:8b")).toBe(true);
    expect(isThinkingCapable("DeepSeek-R1:14b")).toBe(true);
  });
});

describe("needsThinkingValidation", () => {
  const baseReq: AnthropicRequest = {
    model: "claude-3-5-sonnet-20241022",
    messages: [{ role: "user", content: "Hi" }],
  };

  it("returns true when thinking field is set to enabled", () => {
    const req: AnthropicRequest = {
      ...baseReq,
      thinking: { type: "enabled", budget_tokens: 5000 },
    };
    expect(needsThinkingValidation(req)).toBe(true);
  });

  it("returns true when thinking field is set to adaptive", () => {
    const req: AnthropicRequest = {
      ...baseReq,
      thinking: { type: "adaptive", effort: "high" },
    };
    expect(needsThinkingValidation(req)).toBe(true);
  });

  it("returns false when thinking field is absent", () => {
    expect(needsThinkingValidation(baseReq)).toBe(false);
  });
});
