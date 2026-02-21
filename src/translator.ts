import { randomBytes } from "node:crypto";
import type {
  AnthropicMessage,
  AnthropicRequest,
  AnthropicResponse,
  ModelMap,
  OllamaMessage,
  OllamaOptions,
  OllamaRequest,
  OllamaResponse,
} from "./types.js";

/**
 * Default model name mapping: Claude model names → Ollama model names.
 * Users can override/extend via CLI or environment variables.
 */
export const DEFAULT_MODEL_MAP: ModelMap = {
  "claude-opus-4-5": "llama3.1:70b",
  "claude-sonnet-4-5": "llama3.1:8b",
  "claude-haiku-4-5": "llama3.2:3b",
  "claude-3-5-sonnet-20241022": "llama3.1:8b",
  "claude-3-5-haiku-20241022": "llama3.2:3b",
  "claude-3-opus-20240229": "llama3.1:70b",
  "claude-3-sonnet-20240229": "llama3.1:8b",
  "claude-3-haiku-20240307": "llama3.2:3b",
};

/**
 * Generate a unique message ID in the format `msg_<16 random hex chars>`.
 */
export function generateMessageId(): string {
  return `msg_${randomBytes(8).toString("hex")}`;
}

/**
 * Map a Claude model name to the corresponding Ollama model name.
 * Returns the mapped name, or the original if not found in the map,
 * then falls back to defaultModel if the original looks like a Claude model.
 */
export function mapModel(
  claudeModel: string,
  modelMap: ModelMap,
  defaultModel: string,
): string {
  if (modelMap[claudeModel]) {
    return modelMap[claudeModel];
  }
  // If model name doesn't start with "claude", assume it's already an Ollama model name
  if (!claudeModel.startsWith("claude")) {
    return claudeModel;
  }
  return defaultModel;
}

/**
 * Extract plain text from an Anthropic message content field.
 * Content can be a string or an array of content blocks.
 */
export function extractMessageText(
  content: AnthropicMessage["content"],
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Map Ollama done_reason to Anthropic stop_reason.
 */
export function mapStopReason(
  doneReason: string | undefined,
): "end_turn" | "max_tokens" | "stop_sequence" {
  switch (doneReason) {
    case "length":
      return "max_tokens";
    case "stop":
    default:
      return "end_turn";
  }
}

/**
 * Translate an Anthropic messages request to an Ollama chat request.
 */
export function anthropicToOllama(
  req: AnthropicRequest,
  modelMap: ModelMap,
  defaultModel: string,
): OllamaRequest {
  const ollamaModel = mapModel(req.model, modelMap, defaultModel);

  const messages: OllamaMessage[] = [];

  // Prepend system message if present
  if (req.system) {
    messages.push({ role: "system", content: req.system });
  }

  // Convert Anthropic messages
  for (const msg of req.messages) {
    messages.push({
      role: msg.role,
      content: extractMessageText(msg.content),
    });
  }

  const options: OllamaOptions = {};
  if (req.max_tokens !== undefined) {
    options.num_predict = req.max_tokens;
  }
  if (req.temperature !== undefined) {
    options.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    options.top_p = req.top_p;
  }
  if (req.top_k !== undefined) {
    options.top_k = req.top_k;
  }
  if (req.stop_sequences && req.stop_sequences.length > 0) {
    options.stop = req.stop_sequences;
  }

  return {
    model: ollamaModel,
    messages,
    stream: req.stream ?? false,
    ...(Object.keys(options).length > 0 && { options }),
  };
}

/**
 * Translate a non-streaming Ollama response to an Anthropic response.
 */
export function ollamaToAnthropic(
  ollamaRes: OllamaResponse,
  requestedModel: string,
  messageId?: string,
): AnthropicResponse {
  const id = messageId ?? generateMessageId();

  return {
    id,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: ollamaRes.message.content,
      },
    ],
    model: requestedModel,
    stop_reason: mapStopReason(ollamaRes.done_reason),
    stop_sequence: null,
    usage: {
      input_tokens: ollamaRes.prompt_eval_count ?? 0,
      output_tokens: ollamaRes.eval_count ?? 0,
    },
  };
}
