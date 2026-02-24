import { randomBytes } from "node:crypto";
import type {
  AnthropicContentBlock,
  AnthropicContentBlockToolResult,
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
  ToolParamRename,
  ToolParamCoercion,
  ToolSchemaInfo,
} from "./types.js";
import {
  healToolArguments,
  healToolParameterNames,
  healToolParameterTypes,
  generateToolUseId,
} from "./tool-healing.js";

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
 * Rewrite parallel tool-call patterns into sequential assistant/user pairs.
 *
 * Small local models struggle when an assistant message contains multiple
 * tool_use blocks followed by a user message with multiple tool_result blocks.
 * This function expands each such pair into N sequential rounds so the model
 * sees one tool call and one result at a time.
 *
 * Only rewrites when an assistant message has 2+ tool_use blocks AND the
 * immediately following user message carries matching tool_result blocks.
 * Text/thinking blocks from the original assistant message are preserved on
 * the first expanded assistant message.
 */
export function sequentializeToolCalls(
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role !== "assistant" || typeof msg.content === "string") {
      result.push(msg);
      continue;
    }

    const toolUseBlocks = msg.content.filter(
      (b): b is AnthropicContentBlockToolUse => b.type === "tool_use",
    );

    if (toolUseBlocks.length < 2) {
      result.push(msg);
      continue;
    }

    const nextMsg = messages[i + 1];
    if (!nextMsg || nextMsg.role !== "user" || typeof nextMsg.content === "string") {
      result.push(msg);
      continue;
    }

    const resultById = new Map(
      nextMsg.content
        .filter((b): b is AnthropicContentBlockToolResult => b.type === "tool_result")
        .map((b) => [b.tool_use_id, b]),
    );

    const nonToolBlocks = msg.content.filter((b) => b.type !== "tool_use");

    for (let j = 0; j < toolUseBlocks.length; j++) {
      const toolUse = toolUseBlocks[j];
      const assistantContent: AnthropicContentBlock[] =
        j === 0 ? [...nonToolBlocks, toolUse] : [toolUse];

      result.push({ role: "assistant", content: assistantContent });

      const matchedResult = resultById.get(toolUse.id);
      if (matchedResult) {
        result.push({ role: "user", content: [matchedResult] });
      }
    }

    i++; // skip the consumed user message
  }

  return result;
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
  const toolResultBlocks = msg.content.filter(
    (b): b is AnthropicContentBlockToolResult => b.type === "tool_result",
  );

  if (msg.role === "user" && toolResultBlocks.length > 0) {
    // Each tool_result becomes a separate "tool" role message
    return toolResultBlocks.map((b) => {
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
  sequentialToolCalls = true,
): OllamaRequest {
  const ollamaModel = mapModel(req.model, modelMap, defaultModel);

  const messages: OllamaMessage[] = [];

  if (req.system) {
    const systemText =
      typeof req.system === "string"
        ? req.system
        : extractMessageText(req.system);
    messages.push({ role: "system", content: systemText });
  }

  const effectiveMessages = sequentialToolCalls
    ? sequentializeToolCalls(req.messages)
    : req.messages;

  // Convert Anthropic messages (may expand to multiple Ollama messages)
  for (const msg of effectiveMessages) {
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
 * Applies three-phase healing for each call: JSON format, parameter names,
 * and parameter types.
 *
 * @param toolSchemaMap - Optional map from tool name → schema info (names + types).
 *   When provided, argument keys and types that don't match the schema are corrected.
 * @returns The translated blocks and any healing actions (renames, coercions) applied.
 */
export function ollamaToolCallsToAnthropic(
  toolCalls: OllamaToolCall[],
  toolSchemaMap?: Map<string, ToolSchemaInfo>,
): { blocks: AnthropicContentBlock[]; renames: ToolParamRename[]; coercions: ToolParamCoercion[] } {
  const allRenames: ToolParamRename[] = [];
  const allCoercions: ToolParamCoercion[] = [];

  const blocks = toolCalls.map((tc) => {
    let args = healToolArguments(tc.function.arguments);

    if (toolSchemaMap) {
      const schema = toolSchemaMap.get(tc.function.name);
      if (schema) {
        const { healed: namedArgs, renames } = healToolParameterNames(args, schema.names);
        args = namedArgs;
        for (const [from, to] of renames) {
          allRenames.push({ tool: tc.function.name, from, to });
        }

        const { healed: typedArgs, coercions } = healToolParameterTypes(args, schema.types);
        args = typedArgs;
        for (const [param, from, to] of coercions) {
          allCoercions.push({ tool: tc.function.name, param, from, to });
        }
      }
    }

    return {
      type: "tool_use" as const,
      id: generateToolUseId(),
      name: tc.function.name,
      input: args,
    };
  });

  return { blocks, renames: allRenames, coercions: allCoercions };
}

/**
 * Translate a non-streaming Ollama response to an Anthropic response.
 *
 * @param toolSchemaMap - Optional schema map for parameter healing (names + types).
 * @returns The Anthropic response and any healing actions (renames, coercions) applied.
 */
export function ollamaToAnthropic(
  ollamaRes: OllamaResponse,
  requestedModel: string,
  messageId?: string,
  toolSchemaMap?: Map<string, ToolSchemaInfo>,
): { response: AnthropicResponse; renames: ToolParamRename[]; coercions: ToolParamCoercion[] } {
  const id = messageId ?? generateMessageId();
  let renames: ToolParamRename[] = [];
  let coercions: ToolParamCoercion[] = [];

  const content: AnthropicContentBlock[] = [];

  // Prepend thinking block if present
  if (ollamaRes.message.thinking) {
    content.push({ type: "thinking", thinking: ollamaRes.message.thinking });
  }

  // Add tool_use blocks if any
  if (ollamaRes.message.tool_calls && ollamaRes.message.tool_calls.length > 0) {
    const result = ollamaToolCallsToAnthropic(ollamaRes.message.tool_calls, toolSchemaMap);
    content.push(...result.blocks);
    renames = result.renames;
    coercions = result.coercions;
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
    response: {
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
    },
    renames,
    coercions,
  };
}
