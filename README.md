# claude-code-ollama-proxy

A lightweight CLI proxy server that lets **Claude Code** — and any
[Anthropic Messages API](https://docs.anthropic.com/en/api/messages) compatible
client — use locally-running models served by [Ollama](https://ollama.com/).

```
Claude Code ──(Anthropic API)──► claude-code-ollama-proxy ──(Ollama API)──► Ollama ──► llama3.1
```

## Features

- 🔌 **Drop-in proxy** — serve the full Anthropic `/v1/messages` endpoint
- 🌊 **Streaming support** — full SSE event sequence including token counts
- 🔢 **Token counting** — `POST /v1/messages/count_tokens` endpoint for context management
- 🧠 **Extended thinking** — route thinking requests to capable Ollama models (qwen3, deepseek-r1, etc.)
- 🛠️ **Tool call support** — translate Anthropic tool use blocks ↔ Ollama tool calls
- 🩹 **Tool call healing** — automatically repair escaped JSON in model tool call responses
- 🗺️ **Model mapping** — automatic Claude → Ollama model name translation
- 📊 **Structured logging** — OTEL-compatible NDJSON log records; configurable level
- ⚙️ **Configurable** — CLI flags + environment variables + `proxy.config.json`
- 📦 **Zero Anthropic key required** — use any placeholder key

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Ollama](https://ollama.com/) running locally with at least one model pulled

```bash
# Pull a model in Ollama (example)
ollama pull qwen3:8b
```

### Run with npx (no installation)

```bash
npx claude-code-ollama-proxy --default-model qwen3:8b
```

### Install globally

```bash
npm install -g claude-code-ollama-proxy
claude-code-ollama-proxy --default-model qwen3:8b
```

### AI-Agent-First Setup (Recommended)

Set `ANTHROPIC_MODEL` to your Ollama model name when launching Claude Code.
The proxy passes non-Claude model names through directly — no model map needed:

```bash
# Terminal 1 – start proxy
claude-code-ollama-proxy --default-model qwen3:8b

# Terminal 2 – run Claude Code
ANTHROPIC_API_KEY=any-value \
ANTHROPIC_MODEL=qwen3:8b \
ANTHROPIC_SMALL_FAST_MODEL=qwen3:1.7b \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

`ANTHROPIC_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` are Claude Code environment
variables. Setting them to Ollama model names means Claude Code sends those
names in API requests, which the proxy passes through directly to Ollama.

### Persistent Config File

Generate and edit a `proxy.config.json` for a persistent setup:

```bash
claude-code-ollama-proxy --init
$EDITOR proxy.config.json
claude-code-ollama-proxy      # auto-discovers proxy.config.json
```

## Extended Thinking

Some Ollama models support extended chain-of-thought reasoning (the `think: true` API
parameter). The proxy automatically routes thinking requests to these models and returns
thinking blocks in the Anthropic format.

**Thinking-capable Ollama model prefixes:**

| Model family | Example | Notes |
|---|---|---|
| `qwen3` | `qwen3:8b`, `qwen3:235b-a22b` | All sizes including VL |
| `deepseek-r1` | `deepseek-r1:14b`, `deepseek-r1:latest` | |
| `magistral` | `magistral:24b` | |
| `nemotron` | `nemotron:latest` | |
| `glm4` | `glm4:9b` | |
| `qwq` | `qwq:32b` | |

> ⚠️ **By default the proxy silently strips the `thinking` field for non-thinking
> models** so that Claude Code sessions stay alive (Claude Code auto-generates
> thinking requests). Use `--strict-thinking` to return HTTP 400 instead.

### Setup for thinking

```bash
# Step 1: pull a thinking-capable model
ollama pull qwen3:8b

# Step 2: map the Claude model to qwen3
claude-code-ollama-proxy \
  -m claude-3-5-sonnet-20241022=qwen3:8b \
  --default-model qwen3:8b
```

## Tool Calling

Claude Code uses tools (bash, file edit, etc.) extensively. The proxy handles the
full Anthropic tool call flow:

- Translates Anthropic `tools` definitions → Ollama function tool format
- Translates `tool_use` content blocks (in assistant messages) → `message.tool_calls`
- Translates `tool_result` content blocks (in user messages) → `role: "tool"` messages
- Translates Ollama `tool_calls` responses → Anthropic `tool_use` content blocks

### Tool Call Healing

When Ollama models return tool call `arguments` as an escaped JSON string instead of
an object (a common model output bug), the proxy automatically repairs it:

1. Already an object → pass through unchanged
2. Valid JSON string → parse to object
3. Double-escaped JSON → unescape then parse
4. Unrecoverable → `{ raw: <original> }`

## Token Counting

Claude Code calls `POST /v1/messages/count_tokens` to estimate context window usage.
The proxy serves this endpoint locally without calling Ollama.

**Algorithm:** split all request text into words, count words ≤ 4 chars as 1 token,
split longer words into 4-char chunks (each chunk = 1 token).

## Configuration

| CLI Flag | Environment Variable | Default | Description |
|---|---|---|---|
| `--config, -c` | — | auto-discovers `proxy.config.json` | Config file path |
| `--init` | — | — | Write default config file and exit |
| `--port, -p` | `PORT` | `3000` | Port to listen on |
| `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `--model-map, -m` | — | empty | Claude→Ollama model mapping (repeatable) |
| `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback model |
| `--strict-thinking` | — | `false` | Return 400 for thinking on non-thinking models |
| `--log-level` | `LOG_LEVEL` | `info` | Log level: error\|warn\|info\|debug |
| `--verbose, -v` | — | `false` | Equivalent to `--log-level debug` |

### Claude Code Environment Variables

Set these when launching Claude Code (not the proxy):

| Variable | Effect |
|---|---|
| `ANTHROPIC_MODEL` | Model name Claude Code uses in all API requests |
| `ANTHROPIC_SMALL_FAST_MODEL` | Model name for Claude Code's background/fast tasks |
| `ANTHROPIC_BASE_URL` | Point Claude Code at the proxy (`http://localhost:3000`) |
| `ANTHROPIC_API_KEY` | Any non-empty value works (proxy ignores it) |

### Model Mapping

The default model map is **empty** — all Claude model names fall through to
`--default-model`. This is intentional: tier-specific mappings like
`claude-opus → llama3.1:70b` assume Ollama models that may not be installed.

**Recommended approach** (AI-agent-first): set `ANTHROPIC_MODEL=<your-ollama-model>`
in Claude Code. The proxy passes non-Claude model names through directly.

For tier-based routing, configure `proxy.config.json`:

```json
{
  "defaultModel": "qwen3:8b",
  "modelMap": {
    "claude-opus-4-5":   "qwen3:32b",
    "claude-sonnet-4-5": "qwen3:8b",
    "claude-haiku-4-5":  "qwen3:1.7b"
  }
}
```

## Logging

The proxy emits structured **OTEL-compatible NDJSON** log records to stdout:

```json
{"Timestamp":"2024-01-01T12:00:00.000Z","SeverityNumber":9,"SeverityText":"INFO","Body":"Request completed","Attributes":{"http.method":"POST","http.target":"/v1/messages","http.status_code":200,"proxy.latency_ms":42},"Resource":{"service.name":"claude-code-ollama-proxy","service.version":"0.1.0"}}
```

```bash
# Development: full bodies
claude-code-ollama-proxy --log-level debug

# Production minimum: errors only
claude-code-ollama-proxy --log-level error

# Pretty-print with jq
claude-code-ollama-proxy | jq -r '"[\(.SeverityText)] \(.Body)"'
```

See [docs/LOGGING.md](docs/LOGGING.md) for the full reference including otelcol integration.

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [CLI Reference](docs/CLI.md)
- [API Endpoints](docs/API.md)
- [Logging Reference](docs/LOGGING.md)
- [Streaming Architecture](docs/STREAMING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [AI Agent Onboarding](AGENTS.md)

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload via tsx)
npm run dev

# Run tests (166 tests)
npm test

# Build for production
npm run build
```

## License

MIT — © 2026 Herz Cloud & AI GmbH
