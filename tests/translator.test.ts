import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_MAP,
  anthropicToOllama,
  anthropicToolsToOllama,
  extractMessageText,
  generateMessageId,
  healConversationHistory,
  mapModel,
  mapStopReason,
  ollamaToAnthropic,
  sequentializeToolCalls,
} from "../src/translator.js";
import { buildToolSchemaMap } from "../src/tool-healing.js";
import type { AnthropicMessage, AnthropicRequest, OllamaResponse, ToolSchemaInfo } from "../src/types.js";

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

  it("flattens array system (with cache_control) to a plain string for Ollama", () => {
    // Claude Code sends system as an array of text blocks with cache_control.
    // Ollama requires content to be a string — sending an array causes a 400.
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: "say hello" }],
      system: [
        {
          type: "text",
          text: "You are a helpful assistant.",
          cache_control: { type: "ephemeral" },
        },
      ],
    };
    const result = anthropicToOllama(req, modelMap, defaultModel);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
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
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.type).toBe("message");
    expect(response.role).toBe("assistant");
  });

  it("extracts text content correctly", () => {
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.content).toEqual([{ type: "text", text: "Hello there!" }]);
  });

  it("maps token counts to usage", () => {
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.usage.input_tokens).toBe(10);
    expect(response.usage.output_tokens).toBe(5);
  });

  it("maps stop_reason 'stop' → 'end_turn'", () => {
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.stop_reason).toBe("end_turn");
  });

  it("maps stop_reason 'length' → 'max_tokens'", () => {
    const res = { ...baseOllamaRes, done_reason: "length" };
    const { response } = ollamaToAnthropic(res, "claude-3-5-sonnet-20241022");
    expect(response.stop_reason).toBe("max_tokens");
  });

  it("uses provided message ID", () => {
    const { response } = ollamaToAnthropic(
      baseOllamaRes,
      "claude-3-5-sonnet-20241022",
      "msg_testid",
    );
    expect(response.id).toBe("msg_testid");
  });

  it("generates a message ID when not provided", () => {
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.id).toMatch(/^msg_[0-9a-f]{16}$/);
  });

  it("defaults token counts to 0 when not provided", () => {
    const res = { ...baseOllamaRes, eval_count: undefined, prompt_eval_count: undefined };
    const { response } = ollamaToAnthropic(res, "claude-3-5-sonnet-20241022");
    expect(response.usage.input_tokens).toBe(0);
    expect(response.usage.output_tokens).toBe(0);
  });

  it("uses the requestedModel in the response, not Ollama's model name", () => {
    const { response } = ollamaToAnthropic(baseOllamaRes, "claude-3-5-sonnet-20241022");
    expect(response.model).toBe("claude-3-5-sonnet-20241022");
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

describe("sequentializeToolCalls", () => {
  it("expands parallel tool calls into sequential assistant/user pairs", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "read two files" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "A", name: "Read", input: { path: "README.md" } },
          { type: "tool_use", id: "B", name: "Read", input: { path: "HOWTO.md" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "A", content: "readme contents" },
          { type: "tool_result", tool_use_id: "B", content: "howto contents" },
        ],
      },
    ];

    const result = sequentializeToolCalls(messages);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ role: "user", content: "read two files" });

    // First pair
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toEqual([
      { type: "tool_use", id: "A", name: "Read", input: { path: "README.md" } },
    ]);
    expect(result[2].role).toBe("user");
    expect(result[2].content).toEqual([
      { type: "tool_result", tool_use_id: "A", content: "readme contents" },
    ]);

    // Second pair
    expect(result[3].role).toBe("assistant");
    expect(result[3].content).toEqual([
      { type: "tool_use", id: "B", name: "Read", input: { path: "HOWTO.md" } },
    ]);
    expect(result[4].role).toBe("user");
    expect(result[4].content).toEqual([
      { type: "tool_result", tool_use_id: "B", content: "howto contents" },
    ]);
  });

  it("preserves text/thinking blocks on the first expanded assistant message", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "I should read both files" },
          { type: "text", text: "Let me read those." },
          { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
          { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "A", content: "aaa" },
          { type: "tool_result", tool_use_id: "B", content: "bbb" },
        ],
      },
    ];

    const result = sequentializeToolCalls(messages);

    expect(result).toHaveLength(4);

    // First assistant message gets the text + thinking blocks
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toEqual([
      { type: "thinking", thinking: "I should read both files" },
      { type: "text", text: "Let me read those." },
      { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
    ]);

    // Second assistant message only has the tool_use
    expect(result[2].role).toBe("assistant");
    expect(result[2].content).toEqual([
      { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
    ]);
  });

  it("does not rewrite single tool_use messages", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "A", content: "aaa" },
        ],
      },
    ];

    const result = sequentializeToolCalls(messages);
    expect(result).toEqual(messages);
  });

  it("does not rewrite when next message is not a user tool_result", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
          { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
        ],
      },
      { role: "user", content: "thanks" },
    ];

    const result = sequentializeToolCalls(messages);
    expect(result).toEqual(messages);
  });

  it("passes through plain text messages unchanged", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];

    const result = sequentializeToolCalls(messages);
    expect(result).toEqual(messages);
  });

  it("handles multiple consecutive parallel rounds independently", () => {
    const messages: AnthropicMessage[] = [
      // Round 1: parallel
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
          { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "A", content: "aaa" },
          { type: "tool_result", tool_use_id: "B", content: "bbb" },
        ],
      },
      // Round 2: parallel
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "C", name: "Write", input: { path: "c.txt" } },
          { type: "tool_use", id: "D", name: "Write", input: { path: "d.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "C", content: "ccc" },
          { type: "tool_result", tool_use_id: "D", content: "ddd" },
        ],
      },
    ];

    const result = sequentializeToolCalls(messages);

    // Each round expands from 2 messages to 4 messages
    expect(result).toHaveLength(8);
    expect(result[0].role).toBe("assistant");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");
    expect(result[3].role).toBe("user");
    expect(result[4].role).toBe("assistant");
    expect(result[5].role).toBe("user");
    expect(result[6].role).toBe("assistant");
    expect(result[7].role).toBe("user");
  });

  it("handles three parallel tool calls", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
          { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
          { type: "tool_use", id: "C", name: "Read", input: { path: "c.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "A", content: "aaa" },
          { type: "tool_result", tool_use_id: "B", content: "bbb" },
          { type: "tool_result", tool_use_id: "C", content: "ccc" },
        ],
      },
    ];

    const result = sequentializeToolCalls(messages);
    expect(result).toHaveLength(6);
  });
});

describe("anthropicToOllama with sequentialToolCalls option", () => {
  const modelMap = DEFAULT_MODEL_MAP;
  const defaultModel = "llama3.1";

  it("sequentializes parallel tool calls by default", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
            { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "A", content: "aaa" },
            { type: "tool_result", tool_use_id: "B", content: "bbb" },
          ],
        },
      ],
    };

    const result = anthropicToOllama(req, modelMap, defaultModel);
    // 4 Ollama messages: assistant+tool, assistant+tool (sequentialized)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].tool_calls).toHaveLength(1);
    expect(result.messages[1].role).toBe("tool");
    expect(result.messages[2].role).toBe("assistant");
    expect(result.messages[2].tool_calls).toHaveLength(1);
    expect(result.messages[3].role).toBe("tool");
  });

  it("preserves parallel tool calls when sequentialToolCalls is false", () => {
    const req: AnthropicRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "A", name: "Read", input: { path: "a.txt" } },
            { type: "tool_use", id: "B", name: "Read", input: { path: "b.txt" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "A", content: "aaa" },
            { type: "tool_result", tool_use_id: "B", content: "bbb" },
          ],
        },
      ],
    };

    const result = anthropicToOllama(req, modelMap, defaultModel, false);
    // 3 Ollama messages: assistant (2 tool_calls), tool, tool
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe("assistant");
    expect(result.messages[0].tool_calls).toHaveLength(2);
    expect(result.messages[1].role).toBe("tool");
    expect(result.messages[2].role).toBe("tool");
  });
});

describe("healConversationHistory", () => {
  const toolSchemaMap = buildToolSchemaMap([
    {
      name: "Read",
      input_schema: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "Glob",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string" },
        },
      },
    },
  ]);

  it("passes through messages with no tool_use blocks", () => {
    const messages: AnthropicMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual(messages);
  });

  it("strips Read({path}) + parameter error from history", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/foo.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: Read failed due to the following issues:\nThe required parameter `file_path` is missing\nAn unexpected parameter `path` was provided</tool_use_error>",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual([]);
  });

  it("strips Read({file}) + parameter error from history", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { file: "/tmp/foo.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: Read failed\nThe required parameter `file_path` is missing\nAn unexpected parameter `file` was provided</tool_use_error>",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual([]);
  });

  it("strips Glob({pattern: [...]}) + type error from history", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Glob", input: { pattern: ["*.ts", "*.js"] } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: Glob failed\nThe parameter `pattern` type is expected as `string` but provided as `array`</tool_use_error>",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual([]);
  });

  it("strips sibling tool call errors alongside healed errors", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/a.txt" } },
          { type: "tool_use", id: "t2", name: "Read", input: { path: "/tmp/b.txt" } },
          { type: "tool_use", id: "t3", name: "Read", input: { path: "/tmp/c.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: Read failed\nThe required parameter `file_path` is missing\nAn unexpected parameter `path` was provided</tool_use_error>",
          },
          {
            type: "tool_result",
            tool_use_id: "t2",
            is_error: true,
            content: "<tool_use_error>Sibling tool call errored</tool_use_error>",
          },
          {
            type: "tool_result",
            tool_use_id: "t3",
            is_error: true,
            content: "<tool_use_error>Sibling tool call errored</tool_use_error>",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual([]);
  });

  it("preserves successful tool calls alongside stripped failed ones", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/a.txt" } },
          { type: "tool_use", id: "t2", name: "Glob", input: { pattern: "*.ts" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: Read failed\nThe required parameter `file_path` is missing</tool_use_error>",
          },
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: "src/foo.ts\nsrc/bar.ts",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toHaveLength(2);
    // Glob call preserved
    expect(result[0]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "t2", name: "Glob", input: { pattern: "*.ts" } }],
    });
    // Glob result preserved
    expect(result[1]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t2", content: "src/foo.ts\nsrc/bar.ts" }],
    });
  });

  it("preserves text/thinking blocks when stripping tool_use from assistant message", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me read the file" },
          { type: "text", text: "I'll read the file for you." },
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/a.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: parameter `file_path` is missing</tool_use_error>",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toEqual([
      { type: "thinking", thinking: "Let me read the file" },
      { type: "text", text: "I'll read the file for you." },
    ]);
  });

  it("does not strip tool calls with non-parameter errors", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/nonexistent.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "File not found: /tmp/nonexistent.txt",
          },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toHaveLength(2);
    expect(result).toEqual(messages);
  });

  it("does not modify messages when tool_use inputs are already correct", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/tmp/foo.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "file contents here" },
        ],
      },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    expect(result).toEqual(messages);
  });

  it("strips the assistant error explanation that follows a stripped round", () => {
    const messages: AnthropicMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/tmp/a.txt" } },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            is_error: true,
            content: "<tool_use_error>InputValidationError: parameter `file_path` is missing</tool_use_error>",
          },
        ],
      },
      {
        role: "assistant",
        content: "The error occurred because the parameter name is incorrect.",
      },
      { role: "user", content: "Try again please" },
    ];
    const result = healConversationHistory(messages, toolSchemaMap);
    // The tool_use + error pair is stripped, but the text messages remain
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      role: "assistant",
      content: "The error occurred because the parameter name is incorrect.",
    });
    expect(result[1]).toEqual({ role: "user", content: "Try again please" });
  });

  it("handles the exact real-world failure sequence from proxy.log", () => {
    const messages: AnthropicMessage[] = [
      // User asks to onboard
      { role: "user", content: "onboard yourself by reading README.md, HOWTO.md, AGENTS.md" },
      // Attempt 1: Read with wrong param name (parallel)
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me read the files" },
          { type: "tool_use", id: "t1", name: "Read", input: { path: "/workspaces/proj/README.md" } },
          { type: "tool_use", id: "t2", name: "Read", input: { path: "/workspaces/proj/HOWTO.md" } },
          { type: "tool_use", id: "t3", name: "Read", input: { path: "/workspaces/proj/AGENTS.md" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", is_error: true, content: "<tool_use_error>InputValidationError: Read failed\nThe required parameter `file_path` is missing\nAn unexpected parameter `path` was provided</tool_use_error>" },
          { type: "tool_result", tool_use_id: "t2", is_error: true, content: "<tool_use_error>Sibling tool call errored</tool_use_error>" },
          { type: "tool_result", tool_use_id: "t3", is_error: true, content: "<tool_use_error>Sibling tool call errored</tool_use_error>" },
        ],
      },
      // Model explains the error
      { role: "assistant", content: "The error suggests an issue with a previous tool invocation." },
      // User retries
      { role: "user", content: "onboard yourself by reading the docs" },
      // Attempt 2: Glob succeeds, then Read with wrong param name
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me try Glob first" },
          { type: "tool_use", id: "t4", name: "Glob", input: { pattern: "/workspaces/proj/README.md" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t4", content: "/workspaces/proj/README.md" },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t5", name: "Read", input: { file: "/workspaces/proj/README.md" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t5", is_error: true, content: "<tool_use_error>InputValidationError: Read failed\nThe required parameter `file_path` is missing\nAn unexpected parameter `file` was provided</tool_use_error>" },
        ],
      },
      // Model explains again
      { role: "assistant", content: "The parameter name file is incorrect." },
      // User retries again
      { role: "user", content: "onboard yourself" },
    ];

    const result = healConversationHistory(messages, toolSchemaMap);

    // Failed rounds should be stripped, successful ones preserved
    // The model should see a clean history without parameter errors
    const toolErrors = result.flatMap((m) => {
      if (typeof m.content === "string") return [];
      return m.content.filter(
        (b) => b.type === "tool_result" && (b as any).is_error === true,
      );
    });
    expect(toolErrors).toHaveLength(0);

    // The successful Glob call should be preserved
    const toolUses = result.flatMap((m) => {
      if (typeof m.content === "string") return [];
      return m.content.filter((b) => b.type === "tool_use");
    });
    const globCalls = toolUses.filter((b) => (b as any).name === "Glob");
    expect(globCalls.length).toBeGreaterThanOrEqual(1);
  });
});
