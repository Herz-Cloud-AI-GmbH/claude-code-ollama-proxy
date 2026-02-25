import type { AnthropicRequest } from "./types.js";

/**
 * Ollama model name prefixes that support extended thinking / chain-of-thought reasoning.
 * See: https://ollama.com/search?c=thinking
 */
export const THINKING_CAPABLE_PREFIXES: string[] = [
  "qwen3",
  "deepseek-r1",
  "magistral",
  "nemotron",
  "glm4",
  "qwq",
];

/**
 * Check whether a given Ollama model name supports the `think: true` parameter.
 * Matching is prefix-based (case-insensitive) and ignores tag suffixes like `:8b`.
 */
export function isThinkingCapable(ollamaModel: string): boolean {
  const lower = ollamaModel.toLowerCase();
  return THINKING_CAPABLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Return true if the Anthropic request has a `thinking` field set (regardless of type).
 */
export function needsThinkingValidation(req: AnthropicRequest): boolean {
  return req.thinking !== undefined;
}
