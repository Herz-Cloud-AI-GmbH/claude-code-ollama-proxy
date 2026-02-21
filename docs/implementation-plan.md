# Implementation Plan: Three Feature Extensions

## Overview

This document describes the detailed design for three feature extensions to
`claude-code-ollama-proxy`, discovered through analysis of Ollama docs, Anthropic
API docs, and real-world proxy issues.

---

## Feature 1: Thinking Model Support

### Background

**Anthropic side (Claude Code):** The client sends a `thinking` field in the request:
```json
{ "thinking": { "type": "enabled", "budget_tokens": 5000 } }
```
In streaming, thinking blocks are emitted as `content_block_start/delta/stop` with
`type: "thinking"`. In non-streaming, the response has content blocks of `type: "thinking"`.

**Ollama side:** Only specific models support thinking (chain-of-thought) mode. The
request gets a `think: true` boolean. The response/streaming chunks have a
`message.thinking` field alongside `message.content`.

**Thinking-capable model prefixes** (Ollama tag `thinking`):
- `qwen3` (all sizes, including VL variants)
- `deepseek-r1`
- `magistral`
- `nemotron`
- `glm4`
- `qwq`

### Design

**New file: `src/thinking.ts`**
- `THINKING_CAPABLE_PREFIXES: string[]` — list of Ollama model prefixes
- `isThinkingCapable(ollamaModel: string): boolean` — prefix check
- Translation functions for request/response

**Validation in `server.ts`:**
- If Anthropic request has `thinking` field AND the mapped Ollama model is NOT thinking-capable → return HTTP 400 error with Anthropic error format
- If `thinking` is absent or Ollama model is thinking-capable → proceed normally

**Request translation:**
- `thinking: { type: "enabled" | "adaptive" }` → `think: true` in Ollama request

**Non-streaming response translation:**
- If `ollamaRes.message.thinking` is non-empty → prepend a `{ type: "thinking", thinking: "..." }` content block before the `text` block

**Streaming translation:**
The stream transformer gains a new state machine:
- State: `"none"` | `"thinking"` | `"text"` | `"tool_use"`
- When first chunk arrives with `message.thinking` non-empty: open a `thinking` content block
- When chunk arrives with `message.content` non-empty and we were in `"thinking"` state: close thinking block, open text block
- All other logic remains as before

**CLI startup message:** Print a box showing which model prefixes support thinking.

---

## Feature 2: Tool Call Healing

### Background

**The problem:** When Ollama models return tool calls, the `arguments` field can be:
1. Correctly an object: `{"command": "ls"}` ✅
2. A JSON-encoded string: `"{\"command\":\"ls\"}"` ❌ (needs to be parsed)
3. A doubly-escaped string: `"{\\\"command\\\":\\\"ls\\\"}"` ❌ (needs more repair)

Additionally, the proxy currently does NOT translate:
- Anthropic `tools` definitions → Ollama tools format
- Anthropic `tool_use` content blocks in messages → Ollama message format
- Anthropic `tool_result` content blocks in messages → Ollama tool message
- Ollama `tool_calls` in response → Anthropic `tool_use` content blocks

Claude Code uses tools extensively (bash, file editing, etc.), so this is critical.

### Design

**New file: `src/tool-healing.ts`**
- `healToolArguments(args: unknown): Record<string, unknown>` — if `args` is a string, try JSON.parse; if that fails, try fixing common escape issues (unescape double-escaped backslashes) then re-parse; if all fails, return `{ raw: args }`
- `generateToolUseId(): string` — generates `toolu_<random>`

**Type updates (`src/types.ts`):**
- `AnthropicContentBlockToolUse` type
- `AnthropicContentBlockToolResult` type  
- `AnthropicToolDefinition` type
- `OllamaToolDefinition` type
- `OllamaToolCall` type
- Update `AnthropicContentBlock` to include tool_use and tool_result
- Update `OllamaMessage` to include `tool_calls?`
- Update `OllamaRequest` to include `tools?`
- Update `OllamaStreamChunk.message` to include `tool_calls?`

**Request translation (`src/translator.ts`):**
- `anthropicToolsToOllama(tools)` — translate tool definitions
- `anthropicToolUseToOllama(toolUseBlock)` — included in message tool_calls
- `anthropicToolResultToOllama(toolResultBlock)` — becomes `{role: "tool", content: "..."}`
- `anthropicMessageToOllama(msg)` — update to handle tool_use/tool_result blocks

**Response translation (`src/translator.ts`):**
- `ollamaToolCallsToAnthropic(toolCalls)` — translate tool_calls → tool_use blocks, apply healing

**Streaming translation:**
- Tool calls in Ollama stream chunks → emit `content_block_start` (type: tool_use), `content_block_delta` (type: input_json_delta), `content_block_stop`
- Tool calls usually appear in the first non-done chunk or the final chunk

---

## Feature 3: Token Count Endpoint

### Background

Claude Code calls `POST /v1/messages/count_tokens` to estimate context window usage
before making inference calls. This endpoint must exist and return a reasonable estimate.

### Algorithm (as specified)

1. Extract all text from the request (system prompt + all message content)
2. Split by whitespace into "words"
3. For each word:
   - If `word.length <= 4`: count as 1 token
   - If `word.length > 4`: split into chunks of 4 characters → each chunk = 1 token
4. Return `{ "input_tokens": totalCount }`

### Design

**New file: `src/token-counter.ts`**
- `countTokens(text: string): number` — core word/chunk algorithm
- `countRequestTokens(req: AnthropicRequest): number` — extract all text, call countTokens

**Server route:**
```
POST /v1/messages/count_tokens
→ { "input_tokens": N }
```

The endpoint does not call Ollama — it is purely local computation.

---

## File Change Summary

| File | Action | Reason |
|------|--------|--------|
| `src/types.ts` | Update | Add tool types, thinking types, SSE event variants |
| `src/thinking.ts` | New | Thinking model detection and validation |
| `src/tool-healing.ts` | New | Tool argument JSON healing |
| `src/token-counter.ts` | New | Token counting algorithm |
| `src/translator.ts` | Update | Tool call translation, thinking translation |
| `src/streaming.ts` | Update | Thinking stream events, tool call stream events |
| `src/server.ts` | Update | Count tokens endpoint, thinking validation |
| `src/cli.ts` | Update | Startup banner lists thinking-capable models |
| `tests/thinking.test.ts` | New | Unit tests for thinking |
| `tests/tool-healing.test.ts` | New | Unit tests for tool healing |
| `tests/token-counter.test.ts` | New | Unit tests for token counter |
| `tests/server.test.ts` | Update | Integration tests for new endpoints |
| `docs/ARCHITECTURE.md` | New | Architecture overview |
| `AGENTS.md` | New | AI agent onboarding |
| `README.md` | Update | Document new features, thinking models |
| `docs/API.md` | Update | Document new endpoints |
| `docs/STREAMING.md` | Update | Document thinking streaming |

---

## Sequence Diagrams

### Thinking Request Flow
```
Claude Code → proxy: POST /v1/messages { thinking: {type:"enabled"} }
proxy: map Claude model → Ollama model
proxy: isThinkingCapable(ollamaModel) ?
  NO → return 400 { type:"error", error: { type:"thinking_not_supported" } }
  YES → set think: true in Ollama request
proxy → Ollama: POST /api/chat { think: true, ... }
Ollama → proxy: chunks with message.thinking / message.content
proxy: thinking chunks → SSE thinking_delta events
proxy: content chunks → SSE text_delta events
proxy → Claude Code: full SSE stream
```

### Tool Call Healing Flow
```
Claude Code → proxy: POST /v1/messages { tools: [...], messages: [...tool_result...] }
proxy: translate tools → Ollama format
proxy: translate tool_result blocks → { role: "tool", content: "..." }
proxy → Ollama: POST /api/chat { tools: [...], messages: [...] }
Ollama → proxy: response with tool_calls: [{ function: { name, arguments: "{...}" } }]
proxy: heal arguments (string → object, fix escaping)
proxy: translate tool_calls → Anthropic tool_use content blocks
proxy → Claude Code: { content: [{ type:"tool_use", ... }] }
```
