# Tasks and Tests Breakdown

## Implementation Tasks

### Phase 1 – Project Scaffolding

- [ ] **T-01** Create `package.json` with dependencies:
  - `express`, `commander`, `cors`
  - Dev: `typescript`, `@types/express`, `@types/node`, `vitest`, `tsup`
- [ ] **T-02** Create `tsconfig.json` for strict TypeScript compilation
- [ ] **T-03** Create `.gitignore` (node_modules, dist, coverage)
- [ ] **T-04** Add npm scripts: `build`, `start`, `dev`, `test`, `lint`

### Phase 2 – Type Definitions (`src/types.ts`)

- [ ] **T-05** Define `AnthropicMessage` type (role + content variants)
- [ ] **T-06** Define `AnthropicRequest` type (model, messages, system, max_tokens, stream, …)
- [ ] **T-07** Define `AnthropicResponse` type (non-streaming)
- [ ] **T-08** Define Anthropic SSE event types:
  - `MessageStartEvent`, `ContentBlockStartEvent`, `PingEvent`
  - `ContentBlockDeltaEvent`, `ContentBlockStopEvent`
  - `MessageDeltaEvent`, `MessageStopEvent`
- [ ] **T-09** Define `OllamaRequest` type
- [ ] **T-10** Define `OllamaResponse` type (non-streaming)
- [ ] **T-11** Define `OllamaStreamChunk` type
- [ ] **T-12** Define `ProxyConfig` type (port, ollamaUrl, modelMap, defaultModel)

### Phase 3 – Request/Response Translation (`src/translator.ts`)

- [ ] **T-13** Implement `anthropicToOllama(req, config)` — translate full request
  - Map model name via config.modelMap
  - Move `system` field to first message with role "system"
  - Map `max_tokens` → `options.num_predict`
  - Map `temperature` → `options.temperature`
  - Map `top_p` → `options.top_p`
- [ ] **T-14** Implement `ollamaToAnthropic(ollamaRes, requestedModel)` — translate response
  - Build content array with text block
  - Map `eval_count` → `usage.output_tokens`
  - Map `prompt_eval_count` → `usage.input_tokens`
  - Map `done_reason` → `stop_reason` ("stop" → "end_turn", "length" → "max_tokens")
- [ ] **T-15** Implement `generateMessageId()` — create `msg_<random>` IDs
- [ ] **T-16** Implement `mapModel(claudeModel, modelMap)` — model name mapping with defaults

### Phase 4 – Streaming Translation (`src/streaming.ts`)

- [ ] **T-17** Implement `createStreamTransformer(messageId, model, inputTokens)`:
  - Returns a transform function: `OllamaStreamChunk → SSE string[]`
  - First call: emit `message_start` + `content_block_start` + `ping`
  - Subsequent non-done calls: emit `content_block_delta`
  - Final done call: emit `content_block_stop` + `message_delta` (with token counts) + `message_stop`
- [ ] **T-18** Implement `formatSSEEvent(eventType, data)` — format a single SSE event string
- [ ] **T-19** Implement `parseOllamaNDJSON(buffer)` — parse partial/complete NDJSON lines
- [ ] **T-20** Implement streaming pipeline:
  - Read Ollama NDJSON response stream
  - Transform each chunk to SSE events
  - Write to response with correct headers (`text/event-stream`)

### Phase 5 – Ollama Client (`src/ollama-client.ts`)

- [ ] **T-21** Implement `ollamaChat(url, request)` — non-streaming chat
- [ ] **T-22** Implement `ollamaChatStream(url, request)` — streaming chat (returns readable)
- [ ] **T-23** Implement `ollamaListModels(url)` — list available models
- [ ] **T-24** Handle Ollama connection errors with informative messages
- [ ] **T-25** Implement request timeout support

### Phase 6 – Proxy Server (`src/server.ts`)

- [ ] **T-26** Create Express app with JSON body parsing
- [ ] **T-27** Add CORS middleware (allow all origins by default)
- [ ] **T-28** Implement `POST /v1/messages` handler:
  - Parse and validate Anthropic request
  - Translate to Ollama format
  - Route to streaming or non-streaming path
  - Translate response back and return
- [ ] **T-29** Implement `GET /v1/models` handler — proxy Ollama model list to Anthropic format
- [ ] **T-30** Implement `GET /health` handler — return `{"status":"ok","ollama":"<url>"}`
- [ ] **T-31** Add global error handler middleware (Anthropic error format)
- [ ] **T-32** Add request logging middleware

### Phase 7 – CLI (`src/cli.ts`)

- [ ] **T-33** Create Commander.js program with description and version
- [ ] **T-34** Add `--port` / `-p` option (default: 3000, env: PORT)
- [ ] **T-35** Add `--ollama-url` / `-u` option (default: http://localhost:11434, env: OLLAMA_URL)
- [ ] **T-36** Add `--model-map` option — JSON string or `claude-model=ollama-model` pairs
- [ ] **T-37** Add `--default-model` option — fallback Ollama model when no map entry exists
- [ ] **T-38** Add `--verbose` / `-v` flag — enable request/response logging
- [ ] **T-39** Start server and print startup banner with config summary
- [ ] **T-40** Handle `SIGINT`/`SIGTERM` for graceful shutdown

### Phase 8 – Tests

#### Unit Tests: Translator (`tests/translator.test.ts`)

- [ ] **T-41** Test model mapping: known Claude model maps correctly
- [ ] **T-42** Test model mapping: unknown model falls back to default
- [ ] **T-43** Test `anthropicToOllama`: system prompt added as first message
- [ ] **T-44** Test `anthropicToOllama`: max_tokens maps to num_predict
- [ ] **T-45** Test `anthropicToOllama`: temperature maps correctly
- [ ] **T-46** Test `ollamaToAnthropic`: text content extracted correctly
- [ ] **T-47** Test `ollamaToAnthropic`: token counts mapped
- [ ] **T-48** Test `ollamaToAnthropic`: stop_reason mapped ("stop" → "end_turn")
- [ ] **T-49** Test `ollamaToAnthropic`: stop_reason mapped ("length" → "max_tokens")

#### Unit Tests: Streaming (`tests/streaming.test.ts`)

- [ ] **T-50** Test `formatSSEEvent` outputs correct SSE format
- [ ] **T-51** Test `parseOllamaNDJSON` parses single complete line
- [ ] **T-52** Test `parseOllamaNDJSON` handles partial lines (buffer split)
- [ ] **T-53** Test `parseOllamaNDJSON` handles multiple lines in one chunk
- [ ] **T-54** Test stream transformer emits `message_start` on first chunk
- [ ] **T-55** Test stream transformer emits `content_block_start` on first chunk
- [ ] **T-56** Test stream transformer emits `content_block_delta` for each text chunk
- [ ] **T-57** Test stream transformer emits `content_block_stop` on final chunk
- [ ] **T-58** Test stream transformer emits `message_delta` with token counts on final chunk
- [ ] **T-59** Test stream transformer emits `message_stop` on final chunk
- [ ] **T-60** Test empty content chunk (done: false, empty string) is handled gracefully

#### Integration Tests: Server (`tests/server.test.ts`)

- [ ] **T-61** `GET /health` returns 200 with JSON status
- [ ] **T-62** `POST /v1/messages` with valid non-streaming request returns Anthropic response
- [ ] **T-63** `POST /v1/messages` with streaming request returns SSE events
- [ ] **T-64** `POST /v1/messages` streaming response contains `message_start` event
- [ ] **T-65** `POST /v1/messages` streaming response contains token counts in `message_delta`
- [ ] **T-66** `GET /v1/models` returns Anthropic-format model list
- [ ] **T-67** `POST /v1/messages` when Ollama is unreachable returns proper error

### Phase 9 – Documentation

- [ ] **T-68** `README.md` — project overview, quick start, usage
- [ ] **T-69** `docs/CLI.md` — CLI reference (all flags, env vars, examples)
- [ ] **T-70** `docs/API.md` — supported API endpoints and translation details
- [ ] **T-71** `docs/STREAMING.md` — streaming architecture, event mapping, token counting
- [ ] **T-72** `docs/DEPLOYMENT.md` — Docker, systemd, Docker Compose setup

---

## Test Strategy

| Test Type | Tool | Coverage Goal |
|---|---|---|
| Unit – translation logic | Vitest | All translator functions, edge cases |
| Unit – streaming | Vitest | All stream transformer states |
| Integration – server | Vitest + mock Ollama | All endpoints, streaming, error paths |

### Mock Strategy for Integration Tests

Integration tests mock Ollama using `vi.mock` or an in-process HTTP server (MSW or native
`http.createServer`) to return deterministic NDJSON responses, avoiding any real Ollama
dependency in CI.

---

## Definition of Done

A feature is "done" when:
1. Implementation matches the type definitions.
2. Corresponding tests pass (`npm test`).
3. `npm run build` succeeds with zero TypeScript errors.
4. The proxy correctly translates a real Claude Code streaming request end-to-end.
5. Token counts are present in the streaming `message_delta` event.
