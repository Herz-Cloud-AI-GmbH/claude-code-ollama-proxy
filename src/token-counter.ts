import type { AnthropicContentBlock, AnthropicRequest } from "./types.js";

/**
 * Count tokens in a string using the word-chunk algorithm:
 *  - Split text by any whitespace run into words.
 *  - Words with length ≤ 4 count as 1 token.
 *  - Words with length > 4 are split into chunks of 4 characters;
 *    the number of chunks (ceil(length / 4)) equals the token count.
 *
 * This is a lightweight approximation suitable for context-window management.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let total = 0;
  for (const word of words) {
    if (word.length <= 4) {
      total += 1;
    } else {
      total += Math.ceil(word.length / 4);
    }
  }
  return total;
}

/**
 * Extract all text content from an Anthropic content block array,
 * including text blocks, tool_result content, and tool_use input (as JSON).
 */
function extractTextFromBlocks(blocks: AnthropicContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "text":
          return block.text;
        case "thinking":
          return block.thinking;
        case "tool_use":
          return JSON.stringify(block.input);
        case "tool_result": {
          if (typeof block.content === "string") return block.content;
          return extractTextFromBlocks(block.content);
        }
        default:
          return "";
      }
    })
    .join(" ");
}

/**
 * Count the estimated token count for a full Anthropic messages request.
 * Includes: system prompt + all message content (text, tool_use inputs, tool results).
 */
export function countRequestTokens(req: AnthropicRequest): number {
  const parts: string[] = [];

  if (req.system) {
    if (typeof req.system === "string") {
      parts.push(req.system);
    } else {
      parts.push(extractTextFromBlocks(req.system));
    }
  }

  for (const msg of req.messages) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
    } else {
      parts.push(extractTextFromBlocks(msg.content));
    }
  }

  return countTokens(parts.join(" "));
}
