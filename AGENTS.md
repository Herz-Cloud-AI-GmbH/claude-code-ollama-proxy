# AGENTS.md — AI Agent Onboarding

This file is the primary reference for AI coding agents working on this
repository. Read it fully before making any changes.

---

## Repository Summary

**`claude-code-ollama-proxy`** is a TypeScript/Node.js CLI tool and HTTP proxy
server. It translates [Anthropic Messages API](https://docs.anthropic.com/en/api/messages)
requests (sent by Claude Code or any Anthropic-compatible client) into
[Ollama chat API](https://docs.ollama.com/api) requests, so local LLMs can be
used as drop-in replacements for Claude.

---

## Technology Stack

| Component | Technology |
|---|---|
| Language | TypeScript (strict mode, ESM modules) |
| Runtime | Node.js ≥ 18 |
| HTTP server | Express 5 |
| CLI | Commander.js |
| Build | tsup (ESM bundle, `dist/`) |
| Tests | Vitest |
| Package manager | npm |
| Logging | OTEL-format NDJSON to stdout (`src/logger.ts`) |

---

## Repository Structure

```
/
├── src/
│   ├── cli.ts            # CLI entry point (Commander.js)
│   ├── server.ts         # Express app and route handlers
│   ├── translator.ts     # Anthropic ↔ Ollama protocol translation
│   ├── streaming.ts      # SSE stream transformer (NDJSON → SSE)
│   ├── thinking.ts       # Thinking model detection and validation
│   ├── tool-healing.ts   # Tool call JSON argument repair
│   ├── token-counter.ts  # Token counting algorithm
│   ├── ollama-client.ts  # Typed Ollama HTTP client
│   ├── logger.ts         # OTEL-format structured logger
│   └── types.ts          # All TypeScript types
├── tests/
│   ├── server.test.ts
│   ├── streaming.test.ts
│   ├── translator.test.ts
│   ├── thinking.test.ts
│   ├── tool-healing.test.ts
│   ├── token-counter.test.ts
│   └── logger.test.ts
├── docs/
│   ├── ARCHITECTURE.md   # Detailed architecture overview
│   ├── API.md            # Endpoint reference
│   ├── CLI.md            # CLI flag reference
│   ├── LOGGING.md        # Logging reference + otelcol integration
│   ├── STREAMING.md      # SSE streaming protocol docs
│   ├── DEPLOYMENT.md     # Docker, systemd, Nginx guides
│   ├── implementation-plan.md  # Design decisions for v2 features
│   ├── logging-plan.md   # Logging implementation design
│   └── tasks-and-tests-v2.md  # Task breakdown for v2 features
├── .devcontainer/        # Dev container (Node 20 + otelcol + Claude Code)
├── dist/                 # Built output (gitignored)
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── vitest.config.ts
```

---

## Essential Commands

```bash
# Install dependencies
npm install

# Build (TypeScript → ESM bundle in dist/)
npm run build

# Run tests (Vitest, all suites)
npm test

# Development mode (tsx, hot-reload)
npm run dev

# Generate a default config file in the current directory
node dist/cli.js --init

# Run the proxy (after build)
node dist/cli.js --port 3000 --default-model qwen3:8b

# Run with debug logging (full bodies)
node dist/cli.js --log-level debug

# Run with minimal logging (errors only)
node dist/cli.js --log-level error
```

---

## Key Design Principles

1. **Minimal surface**: Only translate what is needed. Pass unknown fields silently.
2. **Defensive input handling**: All incoming data may be malformed — use try/catch and defaults.
3. **Token streaming must work end-to-end**: SSE events must be flushed immediately.
4. **Anthropic error format**: All errors (4xx, 5xx) must return `{ type: "error", error: { type, message } }`.
5. **Model names preserved**: The original Claude model name is always returned in responses — Ollama model names are never exposed to clients.
6. **Thinking is AI-agent-friendly by default**: Thinking requests for non-capable models are silently stripped (not rejected with 400) to keep Claude Code sessions alive. `strictThinking: true` enables rejection.
7. **AI-agent-first config**: A `proxy.config.json` file is the primary config surface for AI agents. The proxy auto-discovers it in the working directory.
8. **Empty default model map**: `DEFAULT_MODEL_MAP = {}`. All Claude model names fall through to `defaultModel` unless explicitly mapped. The recommended setup is `ANTHROPIC_MODEL=<ollama-model>` in Claude Code (bypasses the map entirely).
9. **OTEL-first logging**: All operational log records are emitted as OTEL-compatible NDJSON to stdout. Log level is configurable (`--log-level error|warn|info|debug`). Bodies are only serialised at `debug` level to avoid prod performance impact.

---

## API Contracts

### Request from Claude Code (Anthropic format)

```typescript
// POST /v1/messages
{
  model: string;            // Claude model name (or any Ollama model name)
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicToolDefinition[];
  thinking?: { type: "enabled" | "adaptive"; budget_tokens?: number; effort?: string };
}

// POST /v1/messages/count_tokens
// Same body shape as above — returns { input_tokens: number }
```

### Request to Ollama

```typescript
// POST /api/chat
{
  model: string;       // Ollama model name (mapped from Claude model or passed through)
  messages: OllamaMessage[];
  stream: boolean;
  options?: { num_predict, temperature, top_p, top_k, stop };
  tools?: OllamaToolDefinition[];
  think?: boolean;     // only set when model is thinking-capable AND thinking was requested
}
```

---

## Claude Code Environment Variables

These are set when launching Claude Code (not the proxy):

| Variable | Effect |
|---|---|
| `ANTHROPIC_MODEL` | Model name Claude Code sends in all API requests |
| `ANTHROPIC_SMALL_FAST_MODEL` | Model name for Claude Code's background/fast tasks |
| `ANTHROPIC_BASE_URL` | Point Claude Code at the proxy |
| `ANTHROPIC_API_KEY` | Any non-empty value works |

**AI-agent-first pattern:**
```bash
ANTHROPIC_API_KEY=any-value \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_SMALL_FAST_MODEL=qwen3:1.7b \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

When `ANTHROPIC_MODEL` is a non-Claude model name (does not start with `claude`), the
proxy's `mapModel()` passes it through directly to Ollama — no config needed.

---

## Config File (`proxy.config.json`)

The proxy auto-discovers `proxy.config.json` in the current working directory.
Generate one with `--init`:

```bash
node dist/cli.js --init
```

Schema:

```json
{
  "version": "1",
  "port": 3000,
  "ollamaUrl": "http://localhost:11434",
  "defaultModel": "qwen3:8b",
  "modelMap": {
    "claude-opus-4-5":   "qwen3:32b",
    "claude-sonnet-4-5": "qwen3:8b",
    "claude-haiku-4-5":  "qwen3:1.7b"
  },
  "strictThinking": false,
  "verbose": false
}
```

Precedence: config file < environment variables < CLI flags.

---

| Anthropic block type | In message role | Ollama representation |
|---|---|---|
| `text` | any | `message.content` string |
| `thinking` | assistant | `message.thinking` string |
| `tool_use` | assistant | `message.tool_calls[]` |
| `tool_result` | user | `{ role: "tool", content: "..." }` message |

---

## Logging

The proxy emits **OTEL-compatible NDJSON** log records to stdout. Every record follows the [OpenTelemetry LogRecord](https://opentelemetry.io/docs/specs/otel/logs/data-model/) data model.

```json
{"Timestamp":"…","SeverityNumber":9,"SeverityText":"INFO","Body":"Request received","Attributes":{"http.method":"POST","http.target":"/v1/messages","proxy.request_id":"req_a1b2c3d4"},"Resource":{"service.name":"claude-code-ollama-proxy","service.version":"0.1.0"}}
```

### Log levels

| Level | Use case |
|-------|---------|
| `error` | Errors only (production minimum) |
| `warn` | Errors + warnings (e.g., thinking stripped) |
| `info` | + HTTP request in/out metadata — **default** |
| `debug` | + full request/response bodies, per-chunk SSE |

### Configure

```bash
node dist/cli.js --log-level debug   # full bodies (dev)
node dist/cli.js --log-level error   # errors only (prod)
LOG_LEVEL=info node dist/cli.js      # via env var
```

Config file: `{ "logLevel": "info" }`.

See [docs/LOGGING.md](docs/LOGGING.md) for the full reference and otelcol integration guide.

---



- When `thinking` is present in a request:
  - If the mapped Ollama model starts with a thinking-capable prefix → set `think: true` in Ollama request
  - If NOT thinking-capable and `strictThinking: false` (default) → **strip `thinking` field**, log warning, continue
  - If NOT thinking-capable and `strictThinking: true` → return HTTP 400 with `error.type = "thinking_not_supported"`
- The list is defined in `src/thinking.ts` and exported as `THINKING_CAPABLE_PREFIXES`.

---

## Tool Call Healing Rules

Ollama models sometimes return tool call `arguments` as a JSON-encoded string
instead of a plain object. The `healToolArguments` function (`src/tool-healing.ts`)
applies a three-stage repair:

1. Already an object → pass through
2. Valid JSON string → `JSON.parse`
3. Double-escaped JSON (`\"key\":\"val\"`) → unescape then parse
4. Unrecoverable → `{ raw: <original> }`

---

## Token Counting Algorithm

Used by `POST /v1/messages/count_tokens`. No Ollama call is made.

1. Extract all text: `system` + all `messages` content (text, tool_use input, tool_result)
2. Split by whitespace
3. For each word: if `length ≤ 4` → 1 token; else → `Math.ceil(length / 4)` tokens
4. Return `{ input_tokens: total }`

---

## SSE Streaming State Machine

The stream transformer (`src/streaming.ts`) tracks which content block is
currently open and emits close/open events on transitions:

```
Initial state: none

none → thinking   (first chunk has message.thinking)
none → text       (first chunk has message.content, no thinking)
thinking → text   (chunk has content but no more thinking)
any → tool_use    (chunk has message.tool_calls — emitted + closed immediately)
any → (done)      (final chunk: close current block → message_delta → message_stop)
```

---

## Testing Conventions

- Framework: **Vitest**
- Test files: `tests/<module>.test.ts`
- Import from source: `../src/<module>.js` (use `.js` extension for ESM compatibility)
- Test style: `describe/it` blocks with `expect`
- Mock Ollama: `tests/server.test.ts` creates an in-process mock HTTP server
- Logger: spy on `process.stdout.write` to capture OTEL records in unit tests
- No external services required for unit tests

---

## Adding a New Feature: Checklist

1. Update `src/types.ts` if new API fields are needed
2. Add the implementation module in `src/`
3. Wire it into `src/server.ts` and/or `src/translator.ts`
4. Add structured logging to new code paths using the `logger` instance in `createServer()`
5. Write tests in `tests/`
6. Run `npm test` — all 166+ tests must pass
7. Run `npm run build` — must succeed with zero errors
8. Update relevant docs in `docs/`
9. Update `AGENTS.md` if the architecture changes

---

## Common Gotchas

- **ESM imports**: All local imports must use `.js` extension (TypeScript ESM convention)
- **Streaming flush**: Always call `res.flushHeaders()` before starting to stream
- **Buffer handling**: Ollama may send partial NDJSON lines — always use the buffer + `parseOllamaNDJSON` pattern
- **Model map order**: CLI `--model-map` overrides the default map entries; it does not replace the whole map
- **Token counts in streaming**: Ollama only sends `eval_count` in the final `done: true` chunk — this is the authoritative output token count for `message_delta.usage`

---

## External API References

| API | Reference |
|---|---|
| Anthropic Messages API | https://docs.anthropic.com/en/api/messages |
| Anthropic Token Counting | https://platform.claude.com/docs/en/build-with-claude/token-counting |
| Anthropic Extended Thinking | https://platform.claude.com/docs/en/build-with-claude/extended-thinking |
| Ollama Chat API | https://docs.ollama.com/api |
| Ollama Thinking | https://docs.ollama.com/capabilities/thinking |
| Ollama Tool Calling | https://docs.ollama.com/capabilities/tool-calling |
| Ollama Thinking Models | https://ollama.com/search?c=thinking |
| OTEL LogRecord Data Model | https://opentelemetry.io/docs/specs/otel/logs/data-model/ |
