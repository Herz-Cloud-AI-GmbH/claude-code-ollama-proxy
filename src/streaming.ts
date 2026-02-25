import type {
  AnthropicSSEEvent,
  ContentBlockDeltaEvent,
  ContentBlockStartEvent,
  ContentBlockStopEvent,
  MessageDeltaEvent,
  MessageStartEvent,
  MessageStopEvent,
  OllamaStreamChunk,
  PingEvent,
  ToolSchemaInfo,
} from "./types.js";
import { mapStopReason, ollamaToolCallsToAnthropic } from "./translator.js";

/**
 * Format a single SSE event as a string ready to be written to the response.
 * Format:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 */
export function formatSSEEvent(event: AnthropicSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse a raw buffer string from Ollama's streaming response into
 * individual JSON chunk objects. Handles partial lines by returning
 * only fully terminated lines and the remaining partial buffer.
 */
export function parseOllamaNDJSON(buffer: string): {
  chunks: OllamaStreamChunk[];
  remaining: string;
} {
  const lines = buffer.split("\n");
  // The last element may be a partial line (no trailing newline yet)
  const remaining = lines.pop() ?? "";
  const chunks: OllamaStreamChunk[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      chunks.push(JSON.parse(trimmed) as OllamaStreamChunk);
    } catch {
      // Skip malformed lines
    }
  }

  return { chunks, remaining };
}

type BlockState = "none" | "thinking" | "text" | "tool_use";

/**
 * Stateful stream transformer factory.
 *
 * Creates a function that converts OllamaStreamChunks into SSE event strings.
 * Call `transform(chunk)` for each NDJSON chunk received from Ollama.
 *
 * State machine:
 *  - First chunk: emit message_start + content_block_start + ping
 *    - If thinking content present: open "thinking" block
 *    - Else: open "text" block
 *  - Thinking → text transition: close thinking block, open text block
 *  - Each chunk with text content: emit content_block_delta (text_delta)
 *  - Each chunk with thinking content: emit content_block_delta (thinking_delta)
 *  - Tool calls chunk: emit tool_use block(s) inline
 *  - Final chunk (done: true): emit content_block_stop + message_delta + message_stop
 */
export function createStreamTransformer(
  messageId: string,
  requestedModel: string,
  inputTokens: number,
  toolSchemaMap?: Map<string, ToolSchemaInfo>,
): (chunk: OllamaStreamChunk) => string[] {
  let isFirst = true;
  let blockState: BlockState = "none";
  let blockIndex = 0;

  function openBlock(state: BlockState, events: string[], chunk?: OllamaStreamChunk): void {
    blockState = state;
    if (state === "thinking") {
      const contentBlockStart: ContentBlockStartEvent = {
        type: "content_block_start",
        index: blockIndex,
        content_block: { type: "thinking", thinking: "" },
      };
      events.push(formatSSEEvent(contentBlockStart));
    } else if (state === "tool_use" && chunk?.message.tool_calls) {
      // Tool use blocks are emitted inline and closed immediately
      const { blocks: toolBlocks } = ollamaToolCallsToAnthropic(chunk.message.tool_calls, toolSchemaMap);
      for (const block of toolBlocks) {
        if (block.type !== "tool_use") continue;
        const startEvent: ContentBlockStartEvent = {
          type: "content_block_start",
          index: blockIndex,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
        };
        events.push(formatSSEEvent(startEvent));
        const deltaEvent: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        };
        events.push(formatSSEEvent(deltaEvent));
        const stopEvent: ContentBlockStopEvent = {
          type: "content_block_stop",
          index: blockIndex,
        };
        events.push(formatSSEEvent(stopEvent));
        blockIndex++;
      }
      // Don't change blockState to "tool_use" since we've already closed them
      blockState = "none";
      return;
    } else {
      // text
      const contentBlockStart: ContentBlockStartEvent = {
        type: "content_block_start",
        index: blockIndex,
        content_block: { type: "text", text: "" },
      };
      events.push(formatSSEEvent(contentBlockStart));
    }
  }

  function closeCurrentBlock(events: string[]): void {
    if (blockState === "none") return;
    const contentBlockStop: ContentBlockStopEvent = {
      type: "content_block_stop",
      index: blockIndex,
    };
    events.push(formatSSEEvent(contentBlockStop));
    blockIndex++;
    blockState = "none";
  }

  return function transform(chunk: OllamaStreamChunk): string[] {
    const events: string[] = [];

    if (isFirst) {
      isFirst = false;

      const messageStart: MessageStartEvent = {
        type: "message_start",
        message: {
          id: messageId,
          type: "message",
          role: "assistant",
          content: [],
          model: requestedModel,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: inputTokens,
            output_tokens: 1,
          },
        },
      };
      events.push(formatSSEEvent(messageStart));

      const ping: PingEvent = { type: "ping" };

      // Decide which block type to open first
      if (chunk.message?.thinking) {
        openBlock("thinking", events);
        events.push(formatSSEEvent(ping));
      } else if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
        openBlock("tool_use", events, chunk);
        events.push(formatSSEEvent(ping));
        // Tool blocks were already closed; nothing more to do for this chunk
        if (chunk.done) {
          const outputTokens = chunk.eval_count ?? 0;
          const stopReason = mapStopReason(chunk.done_reason);
          const messageDelta: MessageDeltaEvent = {
            type: "message_delta",
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: { output_tokens: outputTokens },
          };
          events.push(formatSSEEvent(messageDelta));
          const messageStop: MessageStopEvent = { type: "message_stop" };
          events.push(formatSSEEvent(messageStop));
        }
        return events;
      } else {
        openBlock("text", events);
        events.push(formatSSEEvent(ping));
      }
    }

    const thinkingText = chunk.message?.thinking ?? "";
    const contentText = chunk.message?.content ?? "";
    const hasToolCalls = (chunk.message?.tool_calls?.length ?? 0) > 0;

    if (!chunk.done) {
      // Handle thinking → text transition
      if (blockState === "thinking" && contentText && !thinkingText) {
        closeCurrentBlock(events);
        openBlock("text", events);
      }

      // Handle tool calls (non-done chunks)
      if (hasToolCalls && chunk.message.tool_calls) {
        closeCurrentBlock(events);
        openBlock("tool_use", events, chunk);
        return events;
      }

      // Emit thinking delta
      if (thinkingText && blockState === "thinking") {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "thinking_delta", thinking: thinkingText },
        };
        events.push(formatSSEEvent(delta));
      }

      // Emit text delta
      if (contentText && blockState === "text") {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: contentText },
        };
        events.push(formatSSEEvent(delta));
      }
    }

    // Final chunk
    if (chunk.done) {
      // Handle thinking → text transition if needed
      if (blockState === "thinking" && contentText) {
        closeCurrentBlock(events);
        openBlock("text", events);
      }

      // Handle tool calls in final chunk
      if (hasToolCalls && chunk.message.tool_calls) {
        closeCurrentBlock(events);
        openBlock("tool_use", events, chunk);
      }

      // Emit any remaining text in the final chunk
      if (contentText && blockState === "text") {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: contentText },
        };
        events.push(formatSSEEvent(delta));
      }

      // Emit any remaining thinking in the final chunk
      if (thinkingText && blockState === "thinking") {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "thinking_delta", thinking: thinkingText },
        };
        events.push(formatSSEEvent(delta));
      }

      closeCurrentBlock(events);

      const outputTokens = chunk.eval_count ?? 0;
      const stopReason = mapStopReason(chunk.done_reason);

      const messageDelta: MessageDeltaEvent = {
        type: "message_delta",
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      };
      events.push(formatSSEEvent(messageDelta));

      const messageStop: MessageStopEvent = { type: "message_stop" };
      events.push(formatSSEEvent(messageStop));
    }

    return events;
  };
}
