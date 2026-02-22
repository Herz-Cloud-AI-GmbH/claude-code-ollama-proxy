import { randomBytes } from "node:crypto";
import type {
  AnthropicContentBlock,
  AnthropicContentBlockToolUse,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicToolDefinition,
  ModelMap,
  OllamaMessage,
  OllamaOptions,
  OllamaRequest,
  OllamaResponse,
  OllamaToolCall,
  OllamaToolDefinition,
} from "./types.js";
import { healToolArguments, generateToolUseId } from "./tool-healing.js";

/**
 * Default model name mapping: Claude model names → Ollama model names.
 *
 * This map is intentionally **empty** by default.  Every Claude model name
 * falls through to `defaultModel` (configured via --default-model or
 * proxy.config.json) unless the user adds explicit entries.
 *
 * AI-agent-first approach (recommended):
 *   Set ANTHROPIC_MODEL=<your-ollama-model> when launching Claude Code so
 *   the model name it sends is already an Ollama name; the proxy passes it
 *   through directly without consulting this map.
 *
 * Custom tier routing example (proxy.config.json):
 *   "modelMap": {
 *     "claude-opus-4-5":          "qwen3:32b",
 *     "claude-sonnet-4-5":        "qwen3:8b",
 *     "claude-haiku-4-5":         "qwen3:1.7b",
 *     "claude-3-5-sonnet-20241022": "qwen3:8b"
 *   }
 */
export const DEFAULT_MODEL_MAP: ModelMap = {};

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
 * Handles: text, thinking, tool_use (input as JSON), tool_result.
 */
export function extractMessageText(
  content: AnthropicMessage["content"],
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return block.thinking;
        case "tool_use":
          return JSON.stringify(block.input);
        case "tool_result":
          if (typeof block.content === "string") return block.content;
          return extractMessageText(block.content);
        default:
          return "";
      }
    })
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
 * Translate Anthropic tool definitions to Ollama format.
 */
export function anthropicToolsToOllama(
  tools: AnthropicToolDefinition[],
): OllamaToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Convert an Anthropic message (potentially containing tool_use or tool_result
 * blocks) into one or more Ollama messages.
 */
function anthropicMessageToOllamaMessages(msg: AnthropicMessage): OllamaMessage[] {
  if (typeof msg.content === "string") {
    return [{ role: msg.role, content: msg.content }];
  }

  // Collect tool_use blocks separately (for assistant messages)
  const toolUseBlocks = msg.content.filter(
    (b): b is AnthropicContentBlockToolUse => b.type === "tool_use",
  );
  // Collect tool_result blocks (for user messages)
  const toolResultBlocks = msg.content.filter((b) => b.type === "tool_result");

  if (msg.role === "user" && toolResultBlocks.length > 0) {
    // Each tool_result becomes a separate "tool" role message
    return toolResultBlocks.map((b) => {
      if (b.type !== "tool_result") return { role: "tool" as const, content: "" };
      const content = typeof b.content === "string"
        ? b.content
        : extractMessageText(b.content);
      return { role: "tool" as const, content };
    });
  }

  if (msg.role === "assistant" && toolUseBlocks.length > 0) {
    // Build text content (non-tool blocks)
    const textContent = msg.content
      .filter((b) => b.type === "text" || b.type === "thinking")
      .map((b) => (b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : ""))
      .join("");

    const toolCalls: OllamaToolCall[] = toolUseBlocks.map((b) => ({
      function: { name: b.name, arguments: b.input },
    }));

    return [{ role: "assistant", content: textContent, tool_calls: toolCalls }];
  }

  // Fallback: collapse all blocks to text
  return [{ role: msg.role, content: extractMessageText(msg.content) }];
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

  // Prepend system message if present.
  // Claude Code sends system as an array of text blocks (with optional
  // cache_control) — flatten to a plain string for Ollama.
  if (req.system) {
    const systemText =
      typeof req.system === "string"
        ? req.system
        : extractMessageText(req.system);
    messages.push({ role: "system", content: systemText });
  }

  // Convert Anthropic messages (may expand to multiple Ollama messages)
  for (const msg of req.messages) {
    messages.push(...anthropicMessageToOllamaMessages(msg));
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
    ...(req.tools && req.tools.length > 0 && { tools: anthropicToolsToOllama(req.tools) }),
    ...(req.thinking !== undefined && { think: true }),
  };
}

/**
 * Translate Ollama tool_calls to Anthropic tool_use content blocks.
 * Applies tool argument healing for each call.
 */
export function ollamaToolCallsToAnthropic(
  toolCalls: OllamaToolCall[],
): AnthropicContentBlock[] {
  return toolCalls.map((tc) => ({
    type: "tool_use" as const,
    id: generateToolUseId(),
    name: tc.function.name,
    input: healToolArguments(tc.function.arguments),
  }));
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

  const content: AnthropicContentBlock[] = [];

  // Prepend thinking block if present
  if (ollamaRes.message.thinking) {
    content.push({ type: "thinking", thinking: ollamaRes.message.thinking });
  }

  // Add tool_use blocks if any
  if (ollamaRes.message.tool_calls && ollamaRes.message.tool_calls.length > 0) {
    content.push(...ollamaToolCallsToAnthropic(ollamaRes.message.tool_calls));
  }

  // Add text block only if there is text content
  if (ollamaRes.message.content) {
    content.push({ type: "text", text: ollamaRes.message.content });
  }

  // If content is completely empty (can happen with tool-only responses), add empty text
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  // Determine stop reason
  const hasToolUse = content.some((b) => b.type === "tool_use");
  const stopReason = hasToolUse ? "end_turn" : mapStopReason(ollamaRes.done_reason);

  return {
    id,
    type: "message",
    role: "assistant",
    content,
    model: requestedModel,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: ollamaRes.prompt_eval_count ?? 0,
      output_tokens: ollamaRes.eval_count ?? 0,
    },
  };
}
