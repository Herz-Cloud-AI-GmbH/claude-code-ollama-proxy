// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * Supported log levels in ascending severity order.
 * Maps to OTEL SeverityNumber values: DEBUG=5, INFO=9, WARN=13, ERROR=17.
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

// ─── Anthropic API Types ────────────────────────────────────────────────────

export type AnthropicContentBlockText = {
  type: "text";
  text: string;
  cache_control?: { type: string };
};

export type AnthropicContentBlockThinking = {
  type: "thinking";
  thinking: string;
};

export type AnthropicContentBlockToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AnthropicContentBlockToolResult = {
  type: "tool_result";
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | AnthropicContentBlockText
  | AnthropicContentBlockThinking
  | AnthropicContentBlockToolUse
  | AnthropicContentBlockToolResult;

export type AnthropicToolDefinition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type AnthropicThinking = {
  type: "enabled" | "adaptive";
  budget_tokens?: number;
  effort?: string;
};

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  tool_choice?: { type: "auto" | "any" | "none" } | { type: "tool"; name: string };
  thinking?: AnthropicThinking;
};

export type AnthropicUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type AnthropicResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
};

// Streaming SSE event types
export type MessageStartEvent = {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: [];
    model: string;
    stop_reason: null;
    stop_sequence: null;
    usage: AnthropicUsage;
  };
};

export type ContentBlockStartEvent = {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
};

export type PingEvent = {
  type: "ping";
};

export type ContentBlockDeltaEvent = {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "input_json_delta"; partial_json: string };
};

export type ContentBlockStopEvent = {
  type: "content_block_stop";
  index: number;
};

export type MessageDeltaEvent = {
  type: "message_delta";
  delta: {
    stop_reason: "end_turn" | "max_tokens" | "stop_sequence";
    stop_sequence: string | null;
  };
  usage: { output_tokens: number };
};

export type MessageStopEvent = {
  type: "message_stop";
};

export type AnthropicSSEEvent =
  | MessageStartEvent
  | ContentBlockStartEvent
  | PingEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent
  | MessageDeltaEvent
  | MessageStopEvent;

// ─── Ollama API Types ────────────────────────────────────────────────────────

export type OllamaToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type OllamaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
};

export type OllamaOptions = {
  num_predict?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop?: string[];
};

export type OllamaRequest = {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: OllamaOptions;
  tools?: OllamaToolDefinition[];
  think?: boolean;
};

export type OllamaResponse = {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: true;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
};

export type OllamaStreamChunk = {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  eval_count?: number;
  prompt_eval_count?: number;
};

export type OllamaModel = {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
};

export type OllamaModelList = {
  models: OllamaModel[];
};

// ─── Proxy Configuration ─────────────────────────────────────────────────────

export type ModelMap = Record<string, string>;

export type ProxyConfig = {
  port: number;
  ollamaUrl: string;
  modelMap: ModelMap;
  defaultModel: string;
  verbose: boolean;
  /**
   * When true, requests with a `thinking` field sent to a non-thinking-capable
   * model return HTTP 400.  When false (default), the `thinking` field is
   * silently stripped and the request proceeds — this keeps AI coding agent
   * sessions alive when they auto-generate thinking requests.
   */
  strictThinking: boolean;
  /**
   * Minimum log level to emit.  Records below this threshold are suppressed
   * before any serialisation work is done (zero-cost at prod INFO level).
   * If absent, derived from `verbose`: true → "debug", false → "info".
   */
  logLevel?: LogLevel;
};

// ─── Anthropic Error Types ───────────────────────────────────────────────────

export type AnthropicError = {
  type: "error";
  error: {
    type: string;
    message: string;
  };
};
