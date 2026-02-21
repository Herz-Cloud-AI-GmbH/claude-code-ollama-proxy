import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_MAP,
  anthropicToOllama,
  anthropicToolsToOllama,
  extractMessageText,
  generateMessageId,
  mapModel,
  mapStopReason,
  ollamaToAnthropic,
} from "../src/translator.js";
import type { AnthropicRequest, OllamaResponse } from "../src/types.js";

describe("generateMessageId", () => {
  it("generates an ID with the msg_ prefix", () => {
    const id = generateMessageId();
    expect(id).toMatch(/^msg_[0-9a-f]{16}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()));
    expect(ids.size).toBe(100);
  });
});

describe("mapModel", () => {
  it("falls through to defaultModel when DEFAULT_MODEL_MAP is empty", () => {
    // DEFAULT_MODEL_MAP is intentionally empty; all Claude models fall through
    // to defaultModel unless the user configures explicit mappings.
    const result = mapModel(
      "claude-3-5-sonnet-20241022",
      DEFAULT_MODEL_MAP,
      "llama3.1",
    );
    expect(result).toBe("llama3.1");
  });

  it("passes through non-Claude model names directly (AI-agent-first pass-through)", () => {
    // Users can set ANTHROPIC_MODEL=qwen3:8b in Claude Code; the proxy passes it through.
    expect(mapModel("qwen3:8b", {}, "llama3.1")).toBe("qwen3:8b");
    expect(mapModel("mistral:latest", {}, "llama3.1")).toBe("mistral:latest");
  });

  it("falls back to defaultModel for unknown Claude models", () => {
    const result = mapModel("claude-unknown-9999", {}, "my-default");
    expect(result).toBe("my-default");
  });

  it("uses provided modelMap override over default", () => {
    const customMap = { "claude-3-5-sonnet-20241022": "custom-model:latest" };
    const result = mapModel("claude-3-5-sonnet-20241022", customMap, "llama3.1");
    expect(result).toBe("custom-model:latest");
  });
});

describe("mapStopReason", () => {
  it("maps 'stop' → 'end_turn'", () => {
    expect(mapStopReason("stop")).toBe("end_turn");
  });

  it("maps 'length' → 'max_tokens'", () => {
    expect(mapStopReason("length")).toBe("max_tokens");
  });

  it("maps undefined → 'end_turn'", () => {
    expect(mapStopReason(undefined)).toBe("end_turn");
  });
});

describe("extractMessageText", () => {
  it("returns string content as-is", () => {
    expect(extractMessageText("hello")).toBe("hello");
  });

  it("extracts text from content block array", () => {
    expect(
      extractMessageText([{ type: "text", text: "hello world" }]),
    ).toBe("hello world");
  });

  it("concatenates multiple text blocks", () => {
    expect(
      extractMessageText([
        { type: "text", text: "hello" },
        { type: "text", text: " world" },
      ]),
    ).toBe("hello world");
  });
});

describe("anthropicToOllama", () => {
  const modelMap = DEFAULT_MODEL_MAP;
  const defaultModel = "llama3.1";

  it("prepends system message when system field is present", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
      system: "You are a helpful assistant",
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("does not add system message when system is absent", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hello" }],
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  it("maps max_tokens to options.num_predict", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 512,
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.options?.num_predict).toBe(512);
  });

  it("maps temperature to options.temperature", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      temperature: 0.7,
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.options?.temperature).toBe(0.7);
  });

  it("maps top_p to options.top_p", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      top_p: 0.9,
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.options?.top_p).toBe(0.9);
  });

  it("maps stop_sequences to options.stop", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
      stop_sequences: ["STOP", "END"],
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.options?.stop).toEqual(["STOP", "END"]);
  });

  it("sets stream: false when not streaming", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.stream).toBe(false);
  });

  it("does not add options when none specified", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "Hi" }],
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.options).toBeUndefined();
  });
});

describe("ollamaToAnthropic", () => {
  const baseOllamaRes: OllamaResponse = {
    model: "llama3.1:8b",
    created_at: "2024-01-01T00:00:00Z",
    message: { role: "assistant", content: "Hello there!" },
    done: true,
    done_reason: "stop",
    eval_count: 5,
    prompt_eval_count: 10,
  };

  it("returns an Anthropic response with correct structure", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
  });

  it("extracts text content correctly", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.content).toEqual([{ type: "text", text: "Hello there!" }]);
  });

  it("maps token counts to usage", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
  });

  it("maps stop_reason 'stop' → 'end_turn'", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.stop_reason).toBe("end_turn");
  });

  it("maps stop_reason 'length' → 'max_tokens'", () => {
    const res = { ...baseOllamaRes, done_reason: "length" };
    const result = ollamaToAnthropic(res, "claude-3-5-sonnet-20241022");
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("uses provided message ID", () => {
    const result = ollamaToAnthropic(
      baseOllamaRes,
      "claude-3-5-sonnet-20241022",
      "msg_testid",
    );
    expect(result.id).toBe("msg_testid");
  });

  it("generates a message ID when not provided", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.id).toMatch(/^msg_[0-9a-f]{16}$/);
  });

  it("defaults token counts to 0 when not provided", () => {
    const res = { ...baseOllamaRes, eval_count: undefined, prompt_eval_count: undefined };
    const result = ollamaToAnthropic(res, "claude-3-5-sonnet-20241022");
    expect(result.usage.input_tokens).toBe(0);
    expect(result.usage.output_tokens).toBe(0);
  });

  it("uses the requestedModel in the response, not Ollama's model name", () => {
    const result = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(result.model).toBe("claude-3-5-sonnet-20241022");
  });
});

describe("anthropicToolsToOllama", () => {
  it("converts tool definitions to Ollama function format", () => {
    const tools = [
      {
        name: "bash",
        description: "Run bash commands",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"],
        },
      },
    ];
    const result = anthropicToolsToOllama(tools);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("function");
    expect(result[0].function.name).toBe("bash");
    expect(result[0].function.description).toBe("Run bash commands");
    expect(result[0].function.parameters).toEqual(tools[0].input_schema);
  });
});
