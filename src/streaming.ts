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
} from "./types.js";
import { mapStopReason } from "./translator.js";

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

/**
 * Stateful stream transformer factory.
 *
 * Creates a function that converts OllamaStreamChunks into SSE event strings.
 * Call `transform(chunk)` for each NDJSON chunk received from Ollama.
 *
 * State machine:
 *  - First non-done chunk: emit message_start + content_block_start + ping
 *  - Each chunk with content: emit content_block_delta
 *  - Final chunk (done: true): emit content_block_stop + message_delta + message_stop
 */
export function createStreamTransformer(
  messageId: string,
  requestedModel: string,
  inputTokens: number,
): (chunk: OllamaStreamChunk) => string[] {
  let isFirst = true;

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

      const contentBlockStart: ContentBlockStartEvent = {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      };
      events.push(formatSSEEvent(contentBlockStart));

      const ping: PingEvent = { type: "ping" };
      events.push(formatSSEEvent(ping));
    }

    // Emit text delta if there is content
    const text = chunk.message?.content ?? "";
    if (text && !chunk.done) {
      const delta: ContentBlockDeltaEvent = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      };
      events.push(formatSSEEvent(delta));
    }

    // Final chunk
    if (chunk.done) {
      // Emit remaining text if any (some models put text in the final chunk)
      if (text) {
        const delta: ContentBlockDeltaEvent = {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        };
        events.push(formatSSEEvent(delta));
      }

      const contentBlockStop: ContentBlockStopEvent = {
        type: "content_block_stop",
        index: 0,
      };
      events.push(formatSSEEvent(contentBlockStop));

      const outputTokens = chunk.eval_count ?? 0;
      const stopReason = mapStopReason(chunk.done_reason);

      const messageDelta: MessageDeltaEvent = {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
        },
        usage: { output_tokens: outputTokens },
      };
      events.push(formatSSEEvent(messageDelta));

      const messageStop: MessageStopEvent = { type: "message_stop" };
      events.push(formatSSEEvent(messageStop));
    }

    return events;
  };
}
