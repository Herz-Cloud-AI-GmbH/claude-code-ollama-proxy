# Detailed Task List and Tests: v2 Extensions

## Review of Implementation Plan

The implementation plan (see `docs/implementation-plan.md`) covers three features:
1. **Thinking model support** — route thinking requests only to capable models
2. **Tool call healing** — fix escaped JSON in Ollama tool call responses
3. **Token count endpoint** — serve `POST /v1/messages/count_tokens`

Each task below references test cases (T-N) and has an acceptance criterion.

---

## Phase 1 – Type System Updates (`src/types.ts`)

### Tasks

- [x] **T-01** Add `AnthropicContentBlockToolUse` type:
  ```typescript
  { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  ```

- [x] **T-02** Add `AnthropicContentBlockToolResult` type:
  ```typescript
  { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] }
  ```

- [x] **T-03** Add `AnthropicContentBlockThinking` type:
  ```typescript
  { type: "thinking"; thinking: string }
  ```

- [x] **T-04** Update `AnthropicContentBlock` union to include new types

- [x] **T-05** Update `AnthropicMessage.content` — already `string | AnthropicContentBlock[]` (no change needed structurally)

- [x] **T-06** Add `AnthropicToolDefinition` type:
  ```typescript
  { name: string; description: string; input_schema: Record<string, unknown> }
  ```

- [x] **T-07** Add `thinking` and `tools` fields to `AnthropicRequest`

- [x] **T-08** Add `OllamaToolDefinition` type (function wrapper format)

- [x] **T-09** Add `OllamaToolCall` type with `function.name` and `function.arguments`

- [x] **T-10** Update `OllamaMessage` — add optional `tool_calls?` field; add `"tool"` to role union

- [x] **T-11** Update `OllamaRequest` — add optional `tools?` and `think?` fields

- [x] **T-12** Update `OllamaStreamChunk.message` — add optional `thinking?` and `tool_calls?`

- [x] **T-13** Add thinking SSE event types:
  - `ContentBlockStartThinkingEvent` — `content_block: {type: "thinking", thinking: ""}`
  - `ContentBlockDeltaThinkingEvent` — `delta: {type: "thinking_delta", thinking: string}`
  - `ContentBlockDeltaInputJsonEvent` — `delta: {type: "input_json_delta", partial_json: string}`
  - `ContentBlockStartToolUseEvent` — `content_block: {type: "tool_use", id, name, input: {}}`
  - Update `AnthropicSSEEvent` union

---

## Phase 2 – Thinking Support (`src/thinking.ts`)

### Tasks

- [x] **T-14** Define `THINKING_CAPABLE_PREFIXES`: `["qwen3", "deepseek-r1", "magistral", "nemotron", "glm4", "qwq"]`

- [x] **T-15** Implement `isThinkingCapable(ollamaModel: string): boolean`:
  - Strip tag suffix (e.g., `:8b`) for comparison
  - Check if model name starts with any prefix in the list

- [x] **T-16** Implement `needsThinkingValidation(req: AnthropicRequest): boolean`:
  - Returns true if `req.thinking` is defined (regardless of type)

### Tests (`tests/thinking.test.ts`)

- [ ] **TT-01** `isThinkingCapable("qwen3:8b")` → `true`
- [ ] **TT-02** `isThinkingCapable("qwen3")` → `true`
- [ ] **TT-03** `isThinkingCapable("deepseek-r1:14b")` → `true`
- [ ] **TT-04** `isThinkingCapable("magistral:24b")` → `true`
- [ ] **TT-05** `isThinkingCapable("llama3.1:8b")` → `false`
- [ ] **TT-06** `isThinkingCapable("mistral:latest")` → `false`
- [ ] **TT-07** `isThinkingCapable("nemotron:latest")` → `true`
- [ ] **TT-08** `needsThinkingValidation` returns true when thinking field is set
- [ ] **TT-09** `needsThinkingValidation` returns false when thinking field is absent

---

## Phase 3 – Tool Call Healing (`src/tool-healing.ts`)

### Tasks

- [x] **T-17** Implement `generateToolUseId(): string` — returns `toolu_<16 random hex chars>`

- [x] **T-18** Implement `healToolArguments(args: unknown): Record<string, unknown>`:
  - If `args` is already an object: return as-is
  - If `args` is a string:
    1. Try `JSON.parse(args)` → success → return parsed object
    2. If that fails, try fixing double-escaped backslashes (`\\\"` → `\"`) and re-parse
    3. If still fails, wrap in `{ raw: args }`

### Tests (`tests/tool-healing.test.ts`)

- [ ] **TT-10** `healToolArguments({command: "ls"})` → `{command: "ls"}` (already object)
- [ ] **TT-11** `healToolArguments('{"command":"ls"}')` → `{command: "ls"}` (JSON string)
- [ ] **TT-12** `healToolArguments('{\\"command\\":\\"ls\\"}')` → `{command: "ls"}` (double-escaped)
- [ ] **TT-13** `healToolArguments("not-json")` → `{raw: "not-json"}` (unrecoverable)
- [ ] **TT-14** `generateToolUseId()` matches `/^toolu_[0-9a-f]{16}$/`
- [ ] **TT-15** `generateToolUseId()` returns unique IDs (100 calls → 100 unique)

---

## Phase 4 – Token Counter (`src/token-counter.ts`)

### Tasks

- [x] **T-19** Implement `countTokens(text: string): number`:
  - Split by whitespace (any whitespace run)
  - Filter empty strings
  - For each word: if `word.length <= 4`, count 1; else count `Math.ceil(word.length / 4)`
  - Return total

- [x] **T-20** Implement `countRequestTokens(req: AnthropicRequest): number`:
  - Extract: `req.system` if present
  - Extract all message content (text blocks, tool_result content, tool_use input as JSON string)
  - Concatenate all text with spaces
  - Call `countTokens`

### Tests (`tests/token-counter.test.ts`)

- [ ] **TT-16** `countTokens("")` → `0`
- [ ] **TT-17** `countTokens("hi")` → `1` (word ≤ 4)
- [ ] **TT-18** `countTokens("four")` → `1` (exactly 4 chars)
- [ ] **TT-19** `countTokens("hello")` → `2` (5 chars → 2 chunks)
- [ ] **TT-20** `countTokens("hello world")` → `3` (5+5 chars → 2+2 = 4? No: "hello"=2, "world"=2 → total=4... wait: 5/4 = ceil = 2 each → 4 total). Wait let me re-read.
  
  Re-reading: "cut the string in words and the word is longer than **four** characters cut the word into chunks of 4". So:
  - "hello" (5 chars > 4) → ["hell","o"] → 2 tokens
  - "world" (5 chars > 4) → ["worl","d"] → 2 tokens
  - `countTokens("hello world")` → 4

- [ ] **TT-21** `countTokens("abcd efgh")` → `2` (4-char words = 1 each)
- [ ] **TT-22** `countTokens("abcdefgh")` → `2` (8-char word → 2 chunks of 4)
- [ ] **TT-23** `countTokens("abcdefghi")` → `3` (9-char word → "abcd"+"efgh"+"i" = 3 chunks)
- [ ] **TT-24** `countTokens("  multiple   spaces  ")` → handles whitespace runs
- [ ] **TT-25** `countRequestTokens` counts tokens from system prompt
- [ ] **TT-26** `countRequestTokens` counts tokens from messages
- [ ] **TT-27** `countRequestTokens` handles tool_result content

---

## Phase 5 – Translator Updates (`src/translator.ts`)

### Tasks

- [x] **T-21** Update `extractMessageText` to handle `tool_use` blocks → format as JSON string
- [x] **T-22** Update `extractMessageText` to handle `tool_result` blocks → extract content
- [x] **T-23** Implement `anthropicToolsToOllama(tools)` → OllamaToolDefinition[]
- [x] **T-24** Update `anthropicToOllama` to:
  - Include `tools` in Ollama request when present
  - Set `think: true` when `req.thinking` is present
  - Handle `tool_use` blocks in messages → `tool_calls` in Ollama message
  - Handle `tool_result` blocks in messages → `role: "tool"` Ollama message
- [x] **T-25** Implement `ollamaToolCallsToAnthropic(toolCalls)`:
  - For each tool_call: create `tool_use` block with healed arguments
  - Generate tool_use IDs
- [x] **T-26** Update `ollamaToAnthropic` to:
  - Handle `message.thinking` → prepend thinking content block
  - Handle `message.tool_calls` → append tool_use content blocks

---

## Phase 6 – Streaming Updates (`src/streaming.ts`)

### Tasks

- [x] **T-27** Update stream transformer state machine:
  - Track current block type: `"none" | "thinking" | "text" | "tool_use"`
  - Track current block index
  - On first chunk with `thinking` content: open thinking block
  - On chunk where state was thinking and now has text content: close thinking, open text
  - On chunk with tool_calls: close current block (if any), emit tool_use block
  - On final chunk: close current block, emit message_delta + message_stop

- [x] **T-28** Add `formatThinkingStartEvents(messageId, model, inputTokens)` — emits message_start + content_block_start(thinking) + ping

### Tests (additions to `tests/streaming.test.ts`)

- [ ] **TT-28** Stream transformer with thinking chunk emits `content_block_start` with type `"thinking"`
- [ ] **TT-29** Stream transformer thinking delta emits `thinking_delta` delta type
- [ ] **TT-30** Stream transformer transitions from thinking to text block correctly
- [ ] **TT-31** Stream transformer tool_calls chunk emits `tool_use` content block

---

## Phase 7 – Server Updates (`src/server.ts`)

### Tasks

- [x] **T-29** Add `POST /v1/messages/count_tokens` handler:
  - Parse body as `AnthropicRequest`
  - Call `countRequestTokens(req)`
  - Return `{ "input_tokens": N }`

- [x] **T-30** Add thinking validation to `POST /v1/messages` handler:
  - If request has `thinking` field and mapped Ollama model is not thinking-capable:
    → return 400 with `{ type: "error", error: { type: "thinking_not_supported", message: "..." } }`

### Tests (additions to `tests/server.test.ts`)

- [ ] **TT-32** `POST /v1/messages/count_tokens` returns `input_tokens` number
- [ ] **TT-33** `POST /v1/messages/count_tokens` counts system prompt tokens
- [ ] **TT-34** `POST /v1/messages` with thinking on non-thinking model returns 400
- [ ] **TT-35** `POST /v1/messages` with thinking on thinking-capable model proceeds normally

---

## Phase 8 – CLI Banner Update (`src/cli.ts`)

### Tasks

- [x] **T-31** Add thinking models section to startup banner:
  ```
    Thinking-capable models: qwen3, deepseek-r1, magistral, nemotron, glm4, qwq
    Thinking requests for other models will be rejected (400).
  ```

---

## Phase 9 – Documentation

- [ ] **T-32** Create `docs/ARCHITECTURE.md` — system architecture overview
- [ ] **T-33** Create `AGENTS.md` — AI agent onboarding guide  
- [ ] **T-34** Update `README.md` — new features, thinking setup
- [ ] **T-35** Update `docs/API.md` — count_tokens endpoint, thinking error
- [ ] **T-36** Update `docs/STREAMING.md` — thinking blocks in stream

---

## Definition of Done

- All `npm test` tests pass (zero failures)
- `npm run build` succeeds with zero TypeScript errors
- Integration test confirms count_tokens endpoint returns a number
- Integration test confirms thinking validation works
- Tool call healing handles all three argument formats
