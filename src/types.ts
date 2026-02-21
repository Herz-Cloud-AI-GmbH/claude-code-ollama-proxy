// ─── Anthropic API Types ────────────────────────────────────────────────────

export type AnthropicContentBlockText = {
  type: "text";
  text: string;
};

export type AnthropicContentBlock = AnthropicContentBlockText;

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicRequest = {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
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
  content_block: { type: "text"; text: string };
};

export type PingEvent = {
  type: "ping";
};

export type ContentBlockDeltaEvent = {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
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

export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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
};

export type OllamaResponse = {
  model: string;
  created_at: string;
  message: OllamaMessage;
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
  message: { role: string; content: string };
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
};

// ─── Anthropic Error Types ───────────────────────────────────────────────────

export type AnthropicError = {
  type: "error";
  error: {
    type: string;
    message: string;
  };
};
