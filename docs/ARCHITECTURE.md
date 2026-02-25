# Architecture Overview

## System Context

`claude-code-ollama-proxy` sits between **Claude Code** (or any Anthropic API
client) and a locally-running **Ollama** instance. It provides full
Anthropic-to-Ollama protocol translation so that no changes to Claude Code are
required.

```
┌──────────────────────────┐
│      Claude Code         │
│  (Anthropic API client)  │
└───────────┬──────────────┘
            │  POST /v1/messages
            │  POST /v1/messages/count_tokens
            │  GET  /v1/models
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  claude-code-ollama-proxy                            │
│                                                                      │
│  ┌──────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│  │  CLI (cli.ts)│  │  Server         │  │  Token Counter       │   │
│  │  Commander.js│  │  (server.ts)    │  │  (token-counter.ts)  │   │
│  └──────┬───────┘  └────────┬────────┘  └──────────────────────┘   │
│         │                   │                                        │
│         │         ┌─────────▼──────────────────┐                   │
│         │         │       Request Router        │                   │
│         │         │  • request/response logging │                   │
│         │         │  • thinking validation      │                   │
│         │         │  • non-stream / stream fork │                   │
│         │         └────────┬───────────────────┘                   │
│         │                  │                                        │
│         │    ┌─────────────┼─────────────────┐                     │
│         │    ▼             ▼                 ▼                     │
│         │ ┌──────────┐ ┌────────────┐ ┌──────────────┐            │
│         │ │Translator│ │ Streaming  │ │Ollama Client │            │
│         │ │(trans-   │ │(streaming  │ │(ollama-      │            │
│         │ │lator.ts) │ │.ts)        │ │client.ts)    │            │
│         │ └──────────┘ └────────────┘ └──────────────┘            │
│         │         │                                                 │
│  ┌──────▼──────┐  │  ┌─────────────┐  ┌──────────────┐           │
│  │ ProxyConfig │  │  │Tool Healing │  │   Logger     │           │
│  │             │  │  │(tool-       │  │ (logger.ts)  │           │
│  │ • port      │  │  │ healing.ts) │  │ OTEL NDJSON  │           │
│  │ • ollamaUrl │  │  └─────────────┘  └──────────────┘           │
│  │ • modelMap  │  │                                                 │
│  │ • default-  │  │  ┌─────────────┐                              │
│  │   Model     │  │  │ Thinking    │                              │
│  │ • logLevel  │  │  │(thinking.ts)│                              │
│  └─────────────┘  └──└─────────────┘                              │
└────────────────────────────────────────────┬─────────────────────┘
                                             │
                                             │  POST /api/chat
                                             │  GET  /api/tags
                                             ▼
                               ┌──────────────────────┐
                               │        Ollama         │
                               │   (local LLM server)  │
                               └──────────────────────┘
```

---

## Module Descriptions

### `src/cli.ts` — Command-Line Interface
Entry point. Uses [Commander.js](https://github.com/tj/commander.js) to parse
CLI flags and environment variables, then starts the HTTP server.

Responsibilities:
- Parse `--port`, `--ollama-url`, `--model-map`, `--default-model`, `--log-level`, `--verbose`
- Build `ProxyConfig`
- Call `createServer(config).listen(port)`
- Print startup banner (including thinking model list)
- Handle `SIGINT`/`SIGTERM` for graceful shutdown

### `src/server.ts` — HTTP Proxy Server
Creates an Express application with three routes:

| Route | Method | Purpose |
|-------|--------|---------|
| `/health` | GET | Health check — confirms proxy is up |
| `/v1/models` | GET | List Ollama models in Anthropic format |
| `/v1/messages/count_tokens` | POST | Token count (local, no Ollama call) |
| `/v1/messages` | POST | Core proxy — translates and forwards |

For `/v1/messages`:
1. **Request/response logging** — every request gets a unique `proxy.request_id`; INFO records emitted on arrival and completion; DEBUG records include full bodies
2. Run **thinking validation** — if `thinking` field present and mapped model is not thinking-capable: strip `thinking` field and continue (default), or reject with HTTP 400 (when `strictThinking: true`)
3. Build `toolSchemaMap` from request's tool definitions (names + types per property)
4. Call `anthropicToOllama()` to build the Ollama request — applies conversation history healing (strips failed parameter-error rounds) and sequential tool call rewriting
5. Fork to `handleNonStreaming` or `handleStreaming`

### `src/translator.ts` — Protocol Translation
Bidirectional translation between Anthropic and Ollama API shapes.

Key functions:
- `anthropicToOllama(req, modelMap, defaultModel, sequentialToolCalls?, toolSchemaMap?)` — translates full request including tools, thinking flag, tool_use/tool_result message blocks; applies conversation history healing and optionally sequentializes parallel tool calls
- `healConversationHistory(messages, toolSchemaMap)` — heals tool_use inputs in conversation history (parameter names + types) and strips failed tool_use/tool_result rounds caused by parameter validation errors, preventing the model from seeing a poisoned history of failures
- `sequentializeToolCalls(messages)` — rewrites parallel tool-call patterns (assistant with N tool_use + user with N tool_result) into N sequential assistant/user pairs so smaller models process one tool at a time
- `ollamaToAnthropic(res, model)` — translates response including thinking block, tool_calls
- `anthropicToolsToOllama(tools)` — converts tool definitions
- `ollamaToolCallsToAnthropic(toolCalls)` — converts tool calls with healing applied
- `mapModel(model, map, default)` — Claude → Ollama model name mapping
- `extractMessageText(content)` — handles all content block types

### `src/streaming.ts` — SSE Stream Transformer
Stateful conversion of Ollama NDJSON stream → Anthropic SSE event stream.

State machine tracks current open content block:
- `"none"` → `"thinking"` (when first chunk has `message.thinking`)
- `"none"` → `"text"` (default first chunk)
- `"thinking"` → `"text"` (when thinking is done, content begins)
- `"none"` / `"text"` → `"tool_use"` (tool calls emitted and immediately closed)

Key events emitted in order:
```
message_start → content_block_start → ping
→ [content_block_delta]* → content_block_stop
→ [content_block_start → content_block_delta* → content_block_stop]* (per block)
→ message_delta → message_stop
```

See [STREAMING.md](STREAMING.md) for the full protocol translation table.

### `src/thinking.ts` — Thinking Model Support
Validates and translates Anthropic `thinking` requests.

- `THINKING_CAPABLE_PREFIXES` — list of Ollama model name prefixes that support `think: true`
- `isThinkingCapable(ollamaModel)` — prefix-based check
- `needsThinkingValidation(req)` — true when request has a `thinking` field

### `src/tool-healing.ts` — Tool Call Healing
Three-phase healing for tool calls from Ollama models.

**Phase 1 — Argument format healing** (`healToolArguments`):
  1. Already an object → return as-is
  2. Valid JSON string → parse
  3. Double-escaped JSON string → unescape then parse
  4. Unrecoverable → `{ raw: args }`

**Phase 2 — Parameter name healing** (`healToolParameterNames`):
  When a model uses the wrong parameter name (e.g. `file` instead of `file_path`),
  this function matches against the tool's JSON schema. A wrong key is renamed
  when it is a contiguous substring of exactly one schema property (or vice versa).
  Zero-copy on the happy path (all keys valid).

**Phase 3 — Parameter type coercion** (`healToolParameterTypes`):
  When a model sends a value with the wrong JSON type (e.g. an array `["*.ts","*.js"]`
  where a string is expected), this function coerces the value to match the schema type.
  Supported coercions: array→string (join with ", "), number→string, string→number,
  string→boolean. Zero-copy on the happy path (all types valid).

- `buildToolSchemaMap(tools)` — builds a `Map<toolName, ToolSchemaInfo>` from the request's tool definitions, where `ToolSchemaInfo` contains both property names (`Set<string>`) and property types (`Map<string, string>`). Built once per request, only when tool calls are present.
- `generateToolUseId()` — creates `toolu_<16 hex>` IDs

### `src/token-counter.ts` — Token Counting
Simple approximation used for the `count_tokens` endpoint.

Algorithm:
1. Extract all text from request (system + messages)
2. Split by whitespace into words
3. Words ≤ 4 chars → 1 token; words > 4 chars → `⌈length/4⌉` tokens

### `src/ollama-client.ts` — Ollama HTTP Client
Typed fetch wrappers for Ollama's REST API:
- `ollamaChat(url, req)` — non-streaming chat
- `ollamaChatStream(url, req)` — streaming chat (returns raw `Response`)
- `ollamaListModels(url)` — list available models

### `src/logger.ts` — Structured OTEL Logger
Emits [OpenTelemetry LogRecord](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
NDJSON to stdout, consumable by the bundled `otelcol` or any OTLP-compatible
log pipeline.

- `createLogger(config)` — creates a `Logger` instance with level guard
- `Logger.error/warn/info/debug(body, attributes?)` — emits OTEL JSON record
- `parseLogLevel(value)` — validates and normalises log level strings
- `generateRequestId()` — creates `req_<8 hex>` correlation IDs

See [LOGGING.md](LOGGING.md) for the full reference.

### `src/types.ts` — Shared TypeScript Types
All API types for both Anthropic and Ollama, plus `ProxyConfig` and error types.

---

## Data Flow: Non-Streaming Request

```
1. Claude Code → POST /v1/messages
   { model: "claude-3-5-sonnet-20241022", messages: [...], tools: [...] }

2. server.ts: thinking validation (if req.thinking present)
   → non-thinking model + strictThinking=false: strip thinking field, continue
   → non-thinking model + strictThinking=true: return HTTP 400

3. translator.ts: anthropicToOllama()
   → sequentializeToolCalls(): parallel tool-call rounds expanded to sequential pairs
   { model: "llama3.1:8b", messages: [...], tools: [...], stream: false }

4. ollama-client.ts: ollamaChat() → Ollama /api/chat

5. Ollama returns:
   { message: { content: "...", thinking: "...", tool_calls: [...] }, eval_count: N }

6. translator.ts: ollamaToAnthropic()
   { content: [{ type:"thinking", ... }, { type:"tool_use", ... }, { type:"text", ... }] }

7. Claude Code ← 200 { content: [...], usage: { input_tokens, output_tokens } }
```

## Data Flow: Streaming Request

```
1. Claude Code → POST /v1/messages { stream: true }

2. server.ts: thinking validation + SSE headers

3. ollama-client.ts: ollamaChatStream() → Response stream

4. streaming.ts: createStreamTransformer()
   Reader loop:
     buffer += decoded chunk
     parseOllamaNDJSON(buffer) → [OllamaStreamChunk]
     for each chunk:
       transform(chunk) → [SSE event strings]
       res.write(event)

5. Claude Code receives real-time SSE events:
   message_start → ping → content_block_* → message_delta → message_stop
```

---

## Configuration

All configuration flows through `ProxyConfig`:

```typescript
type ProxyConfig = {
  port: number;              // HTTP port (default: 3000)
  ollamaUrl: string;         // Ollama base URL (default: http://localhost:11434)
  modelMap: ModelMap;        // Claude → Ollama model name map
  defaultModel: string;      // Fallback model (default: llama3.1)
  strictThinking: boolean;   // When true, return 400 for thinking on non-thinking models
  sequentialToolCalls: boolean; // Rewrite parallel tool calls to sequential (default: true)
  verbose: boolean;          // Shorthand for logLevel: "debug"
  logLevel?: LogLevel;       // "error" | "warn" | "info" | "debug" (default: "info")
  logFile?: string;          // Optional NDJSON log file path
};
```

Sources (lowest → highest): code defaults < config file (`proxy.config.json`) < environment variables < CLI flags.

---

## Error Handling

All errors are converted to Anthropic error format:

```json
{
  "type": "error",
  "error": {
    "type": "api_connection_error | api_error | thinking_not_supported",
    "message": "Human-readable description"
  }
}
```

| Error class | HTTP status | Trigger |
|-------------|-------------|---------|
| `OllamaConnectionError` | 502 | Ollama unreachable |
| `OllamaResponseError` | 4xx/502 | Ollama returned error |
| thinking not supported | 400 | `thinking` requested for non-thinking model |

---

## Security Considerations

- The proxy ignores `Authorization` / `x-api-key` headers entirely — any placeholder works
- No secrets are logged even in verbose mode (just request/response structure)
- Request body size limit: 10 MB (configurable via `express.json` limit)
- Timeout: 120 seconds per Ollama request
