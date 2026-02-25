import { describe, expect, it } from "vitest";
import {
  createStreamTransformer,
  formatSSEEvent,
  parseOllamaNDJSON,
} from "../src/streaming.js";
import type { OllamaStreamChunk } from "../src/types.js";

describe("formatSSEEvent", () => {
  it("formats a message_stop event correctly", () => {
    const result = formatSSEEvent({ type: "message_stop" });
    expect(result).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });

  it("formats a ping event correctly", () => {
    const result = formatSSEEvent({ type: "ping" });
    expect(result).toBe('event: ping\ndata: {"type":"ping"}\n\n');
  });

  it("formats a content_block_delta event correctly", () => {
    const result = formatSSEEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    });
    expect(result).toContain("event: content_block_delta");
    expect(result).toContain('"text":"Hello"');
  });
});

describe("parseOllamaNDJSON", () => {
  it("parses a single complete line", () => {
    const line = '{"model":"llama3","message":{"role":"assistant","content":"Hi"},"done":false}\n';
    const { chunks, remaining } = parseOllamaNDJSON(line);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].model).toBe("llama3");
    expect(chunks[0].done).toBe(false);
    expect(remaining).toBe("");
  });

  it("handles partial line (no trailing newline)", () => {
    const partial = '{"model":"llama3","message":{"role":"assistant","content":"Hi"},"done":false}';
    const { chunks, remaining } = parseOllamaNDJSON(partial);
    expect(chunks).toHaveLength(0);
    expect(remaining).toBe(partial);
  });

  it("parses multiple complete lines", () => {
    const lines =
      '{"model":"llama3","message":{"role":"assistant","content":"Hello"},"done":false}\n' +
      '{"model":"llama3","message":{"role":"assistant","content":" world"},"done":false}\n';
    const { chunks, remaining } = parseOllamaNDJSON(lines);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].message.content).toBe("Hello");
    expect(chunks[1].message.content).toBe(" world");
    expect(remaining).toBe("");
  });

  it("returns partial line as remaining after multiple complete lines", () => {
    const data =
      '{"model":"llama3","message":{"role":"assistant","content":"Hi"},"done":false}\n' +
      '{"partial":true}';
    const { chunks, remaining } = parseOllamaNDJSON(data);
    expect(chunks).toHaveLength(1);
    expect(remaining).toBe('{"partial":true}');
  });

  it("skips empty lines", () => {
    const data = '\n\n{"model":"x","message":{"role":"assistant","content":"y"},"done":false}\n\n';
    const { chunks } = parseOllamaNDJSON(data);
    expect(chunks).toHaveLength(1);
  });

  it("skips malformed JSON lines", () => {
    const data = 'not-json\n{"model":"x","message":{"role":"assistant","content":"y"},"done":false}\n';
    const { chunks } = parseOllamaNDJSON(data);
    expect(chunks).toHaveLength(1);
  });
});

describe("createStreamTransformer", () => {
  const makeChunk = (content: string, done: boolean, extra = {}): OllamaStreamChunk => ({
    model: "llama3",
    created_at: "2024-01-01T00:00:00Z",
    message: { role: "assistant", content },
    done,
    ...extra,
  });

  it("emits message_start on the first chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    const events = transform(makeChunk("Hello", false));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("message_start");
  });

  it("emits content_block_start on the first chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    const events = transform(makeChunk("Hello", false));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("content_block_start");
  });

  it("emits ping on the first chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    const events = transform(makeChunk("Hello", false));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("ping");
  });

  it("does NOT emit message_start on subsequent chunks", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false)); // first
    const events = transform(makeChunk(" world", false)); // second
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).not.toContain("message_start");
  });

  it("emits content_block_delta for text content", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false)); // first (sets up state)
    const events = transform(makeChunk(" world", false));
    const deltaEvent = events.find((e) => e.includes("content_block_delta"));
    expect(deltaEvent).toBeDefined();
    expect(deltaEvent).toContain('" world"');
  });

  it("emits content_block_stop on final chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false));
    const events = transform(makeChunk("", true, { eval_count: 5, done_reason: "stop" }));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("content_block_stop");
  });

  it("emits message_delta with token counts on final chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false));
    const events = transform(makeChunk("", true, { eval_count: 15, done_reason: "stop" }));
    const deltaEvent = events.find((e) => e.includes("message_delta"));
    expect(deltaEvent).toBeDefined();
    expect(deltaEvent).toContain('"output_tokens":15');
  });

  it("maps done_reason 'stop' → stop_reason 'end_turn' in message_delta", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false));
    const events = transform(makeChunk("", true, { eval_count: 5, done_reason: "stop" }));
    const deltaEvent = events.find((e) => e.includes("message_delta"));
    expect(deltaEvent).toContain('"stop_reason":"end_turn"');
  });

  it("maps done_reason 'length' → stop_reason 'max_tokens' in message_delta", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false));
    const events = transform(makeChunk("", true, { eval_count: 5, done_reason: "length" }));
    const deltaEvent = events.find((e) => e.includes("message_delta"));
    expect(deltaEvent).toContain('"stop_reason":"max_tokens"');
  });

  it("emits message_stop on final chunk", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false));
    const events = transform(makeChunk("", true, { eval_count: 5, done_reason: "stop" }));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("message_stop");
  });

  it("handles empty content chunk gracefully (done: false, empty string)", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 10);
    transform(makeChunk("Hello", false)); // first
    const events = transform(makeChunk("", false)); // empty, non-final
    // Should not emit content_block_delta for empty text
    const deltaEvents = events.filter((e) => e.includes("content_block_delta"));
    expect(deltaEvents).toHaveLength(0);
  });

  it("uses the provided messageId in message_start", () => {
    const transform = createStreamTransformer("msg_myid123", "claude-3-5-sonnet-20241022", 10);
    const events = transform(makeChunk("Hi", false));
    const startEvent = events.find((e) => e.includes("message_start"));
    expect(startEvent).toContain('"id":"msg_myid123"');
  });

  it("uses the provided inputTokens in message_start usage", () => {
    const transform = createStreamTransformer("msg_test", "claude-3-5-sonnet-20241022", 42);
    const events = transform(makeChunk("Hi", false));
    const startEvent = events.find((e) => e.includes("message_start"));
    expect(startEvent).toContain('"input_tokens":42');
  });
});

describe("createStreamTransformer – thinking mode", () => {
  const makeThinkingChunk = (thinking: string, content: string, done: boolean, extra = {}): OllamaStreamChunk => ({
    model: "qwen3",
    created_at: "2024-01-01T00:00:00Z",
    message: { role: "assistant", content, thinking },
    done,
    ...extra,
  });

  it("emits content_block_start with type 'thinking' when first chunk has thinking", () => {
    const transform = createStreamTransformer("msg_think", "claude-3-5-sonnet-20241022", 0);
    const events = transform(makeThinkingChunk("Let me think...", "", false));
    const startEvent = events.find((e) => e.includes("content_block_start"));
    expect(startEvent).toContain('"thinking"');
  });

  it("emits thinking_delta for thinking content", () => {
    const transform = createStreamTransformer("msg_think", "claude-3-5-sonnet-20241022", 0);
    transform(makeThinkingChunk("First thought", "", false)); // first (opens thinking block)
    const events = transform(makeThinkingChunk("More thinking", "", false));
    const deltaEvent = events.find((e) => e.includes("content_block_delta"));
    expect(deltaEvent).toContain('"thinking_delta"');
    expect(deltaEvent).toContain("More thinking");
  });

  it("closes thinking block and opens text block on transition", () => {
    const transform = createStreamTransformer("msg_think", "claude-3-5-sonnet-20241022", 0);
    transform(makeThinkingChunk("Thinking...", "", false)); // thinking block open
    const events = transform(makeThinkingChunk("", "The answer", false)); // transition
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("content_block_stop"); // thinking block closed
    expect(types).toContain("content_block_start"); // text block opened
    // The content_block_start should now be for text
    const startEvent = events.find((e) => e.includes("content_block_start"));
    expect(startEvent).toContain('"text"');
  });

  it("emits message_stop on final chunk after thinking", () => {
    const transform = createStreamTransformer("msg_think", "claude-3-5-sonnet-20241022", 0);
    transform(makeThinkingChunk("Thinking...", "", false));
    transform(makeThinkingChunk("", "The answer", false));
    const events = transform(makeThinkingChunk("", "", true, { eval_count: 5, done_reason: "stop" }));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("message_stop");
  });
});

describe("createStreamTransformer – tool calls", () => {
  const makeToolChunk = (done: boolean, extra = {}): OllamaStreamChunk => ({
    model: "llama3.1",
    created_at: "2024-01-01T00:00:00Z",
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "bash", arguments: { command: "ls" } } }],
    },
    done,
    ...extra,
  });

  it("emits tool_use content_block_start when tool_calls present", () => {
    const transform = createStreamTransformer("msg_tool", "claude-3-5-sonnet-20241022", 0);
    const events = transform(makeToolChunk(false));
    const startEvent = events.find((e) => e.includes("content_block_start"));
    expect(startEvent).toContain('"tool_use"');
    expect(startEvent).toContain('"bash"');
  });

  it("emits input_json_delta for tool call arguments", () => {
    const transform = createStreamTransformer("msg_tool", "claude-3-5-sonnet-20241022", 0);
    const events = transform(makeToolChunk(false));
    const deltaEvent = events.find((e) => e.includes("content_block_delta"));
    expect(deltaEvent).toContain('"input_json_delta"');
  });

  it("closes the tool_use block after emitting it", () => {
    const transform = createStreamTransformer("msg_tool", "claude-3-5-sonnet-20241022", 0);
    const events = transform(makeToolChunk(false));
    const types = events.map((e) => {
      const m = e.match(/^event: (\S+)/);
      return m?.[1] ?? "";
    });
    expect(types).toContain("content_block_stop");
  });
});
