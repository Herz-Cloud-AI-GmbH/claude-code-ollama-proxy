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
- ⚙️ **Configurable** — CLI flags + environment variables
- 📦 **Zero Anthropic key required** — use any placeholder key

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Ollama](https://ollama.com/) running locally with at least one model pulled

```bash
# Pull a model in Ollama (example)
ollama pull llama3.1
```

### Run with npx (no installation)

```bash
npx claude-code-ollama-proxy
```

### Install globally

```bash
npm install -g claude-code-ollama-proxy
claude-code-ollama-proxy
```

### Use with Claude Code

```bash
ANTHROPIC_API_KEY=any-placeholder-value \
ANTHROPIC_BASE_URL=http://localhost:3000 \
claude
```

That's it — Claude Code will now route all requests through Ollama.

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

> ⚠️ **If you send a request with a `thinking` field to any other model, the proxy
> returns HTTP 400.** This prevents silent failures and surfaces configuration
> issues immediately.

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
| `--port, -p` | `PORT` | `3000` | Port to listen on |
| `--ollama-url, -u` | `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `--model-map, -m` | — | See below | Claude→Ollama model mapping |
| `--default-model, -d` | `DEFAULT_MODEL` | `llama3.1` | Fallback model |
| `--verbose, -v` | — | `false` | Enable debug logging |

### Default Model Map

| Claude Model | Ollama Model |
|---|---|
| `claude-opus-4-5` | `llama3.1:70b` |
| `claude-sonnet-4-5` | `llama3.1:8b` |
| `claude-haiku-4-5` | `llama3.2:3b` |
| `claude-3-5-sonnet-20241022` | `llama3.1:8b` |
| `claude-3-5-haiku-20241022` | `llama3.2:3b` |
| `claude-3-opus-20240229` | `llama3.1:70b` |
| `claude-3-sonnet-20240229` | `llama3.1:8b` |
| `claude-3-haiku-20240307` | `llama3.2:3b` |

Override with `-m claude-3-5-sonnet-20241022=mistral:latest` or pass a JSON map.

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [CLI Reference](docs/CLI.md)
- [API Endpoints](docs/API.md)
- [Streaming Architecture](docs/STREAMING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [AI Agent Onboarding](AGENTS.md)

## Development

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload via tsx)
npm run dev

# Run tests (122 tests)
npm test

# Build for production
npm run build
```

## License

MIT — © 2026 Herz Cloud & AI GmbH
